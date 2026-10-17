// Henter tall fra dokumenter uten AI: nøkkelord + beløp på samme linje.
// Resultatet er alltid et forslag som brukeren kontrollerer før det lagres.

// Beløp: 45 678,90 · 45.678,90 · -1 234,00 · 1 234,00- · 52000 · kr 1 234
const BELOP = /(?<![\d,.])-?\d{1,3}(?:[  .]\d{3})+(?:,\d{1,2})?-?(?![\d])|(?<![\d,.])-?\d+,\d{1,2}-?(?![\d])|(?<![\d,.%])-?\d{3,}(?![\d,%])/g;
const PROSENT = /(\d{1,2}(?:[.,]\d{1,4})?)\s*%/;

export function tallFra(s) {
  const neg = s.trim().startsWith('-') || s.trim().endsWith('-');
  const v = Number(s.replace(/[-\s ]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

export function belopI(linje) {
  // Ignorer datoer, kontonumre og årstall
  const vask = linje
    .replace(/\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})\b/g, ' ')
    .replace(/\b\d{4}[ .]\d{2}[ .]\d{5}\b/g, ' ')
    .replace(/\b(?:19|20)\d{2}-\d{2}(?:-\d{2})?\b/g, ' ')
    .replace(/\d{1,2}(?:[.,]\d{1,4})?\s*%/g, ' ')
    .replace(/\b(?:tabell|tabellnr\.?|tabellnummer)\s*\d{4}\b/gi, ' ');
  return [...vask.matchAll(BELOP)].filter((m) => !/^(19|20)\d{2}$/.test(m[0])).map((m) => tallFra(m[0])).filter((v) => v != null);
}

const MND = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];

// Finner måned (YYYY-MM) for lønnsperiode/utskriftsdato
export function finnMnd(linjer, reserve) {
  const tekst = linjer.join('\n');
  const periode = tekst.match(/(?:lønnsperiode|periode|lønn for|utbetaling for)[^\n]{0,40}?\b(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (periode) return `${periode[3]}-${periode[2].padStart(2, '0')}`;
  const ord = tekst.toLowerCase().match(new RegExp(`(?:lønn for|periode|for)\\s+(${MND.join('|')})\\s+(20\\d{2})`));
  if (ord) return `${ord[2]}-${String(MND.indexOf(ord[1]) + 1).padStart(2, '0')}`;
  const utb = tekst.match(/(?:utbetalingsdato|utbetalt|bokført|dato)[^\n]{0,20}?\b(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (utb) return `${utb[3]}-${utb[2].padStart(2, '0')}`;
  return reserve?.slice(0, 7) || null;
}

export function finnDato(linjer, nokkel, reserve) {
  for (const l of linjer) {
    if (nokkel && !nokkel.test(l)) continue;
    const m = l.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return reserve || null;
}

// Første linje som treffer et av mønstrene (i prioritert rekkefølge) og har et beløp.
function finn(linjer, monstre, { hittil = false, ikke = null, velg = 'siste' } = {}) {
  for (const m of monstre) {
    for (const l of linjer) {
      if (!m.test(l) || (ikke && ikke.test(l))) continue;
      const b = belopI(l.replace(m, ' '));
      if (!b.length) continue;
      let verdi;
      // Lønnsslipper har ofte kolonnene «denne periode» og «hittil i år»: periodebeløpet er det minste
      if (hittil && b.length >= 2) {
        const to = b.slice(-2);
        verdi = Math.abs(to[0]) <= Math.abs(to[1]) ? to[0] : to[1];
      } else verdi = velg === 'forste' ? b[0] : b[b.length - 1];
      return { verdi, linje: l.trim(), alle: b };
    }
  }
  return null;
}

function finnProsent(linjer, monstre, ikke) {
  for (const m of monstre) {
    for (const l of linjer) {
      if (!m.test(l) || (ikke && ikke.test(l))) continue;
      const p = l.match(PROSENT);
      if (p) return { verdi: Number(p[1].replace(',', '.')) / 100, linje: l.trim() };
    }
  }
  return null;
}

export const TOLKBARE = { lonn: 'Lønnsslipp', lan: 'Lån og kreditt', investering: 'Investering og pensjon', skatt: 'Skatt' };

export function tolkLonn(linjer, reserveDato) {
  const hittil = linjer.some((l) => /hittil|i år|akkumulert/i.test(l));
  const o = { hittil };
  const f = {
    brutto: finn(linjer, [/sum brutto|bruttolønn|brutto lønn|sum opptjent|brutto\b/i], o),
    skattetrekk: finn(linjer, [/forskuddstrekk|skattetrekk|tabelltrekk|prosenttrekk|trekk skatt/i], { ...o, ikke: /grunnlag|prosentsats/i }),
    netto: finn(linjer, [/til utbetaling|utbetalt|nettolønn|netto lønn|netto utbetalt|netto\b/i], o),
    fastlonn: finn(linjer, [/fastlønn|månedslønn|fast lønn|grunnlønn/i], o),
    overtid50: finn(linjer, [/overtid\s*50/i], o),
    overtid100: finn(linjer, [/overtid\s*100/i], o),
    trekkfrie: finn(linjer, [/trekkfri|reiseregning|diett|utlegg/i], o),
  };
  if (!f.brutto && f.fastlonn) {
    const deler = [f.fastlonn, f.overtid50, f.overtid100].filter(Boolean);
    f.brutto = { verdi: deler.reduce((a, d) => a + d.verdi, 0), linje: 'Beregnet: fastlønn + overtid (ingen bruttolinje funnet)' };
  }
  // Skattetrekk lagres negativt, som i regnearket
  if (f.skattetrekk) f.skattetrekk.verdi = -Math.abs(f.skattetrekk.verdi);
  const arb = linjer.find((l) => /\b(AS|ASA|SA|kommune|fylkeskommune|helse\s+\w+\s+HF|HF)\b/.test(l) && !/bank|nordea|dnb/i.test(l));
  return { type: 'lonn', mnd: finnMnd(linjer, reserveDato), arbeidsgiver: arb ? arb.trim().split(/\s{3,}/)[0] : '', felt: f };
}

export function tolkLan(linjer, reserveDato) {
  const f = {
    saldo: finn(linjer, [/restgjeld|gjenstående (gjeld|saldo|lån)|samlet gjeld|lånesaldo|utestående|gjeld per|saldo/i], { ikke: /opprinnelig|innvilget|lånebeløp\b/i }),
    termin: finn(linjer, [/terminbeløp|termin ?beløp|månedsbeløp|beløp å betale|å betale|sum å betale|månedlig betaling/i], { ikke: /totalt? å betale|sum (renter|kostnad)/i }),
    renter: finn(linjer, [/renter\b|rentebeløp/i], { ikke: /%|rentesats|nominell|effektiv/i }),
  };
  const rente = finnProsent(linjer, [/nominell rente|rentesats|lånerente|rente\s*:|^\s*rente\b/i], /effektiv/i);
  if (rente) f.rente = rente;
  if (f.saldo) f.saldo.verdi = Math.abs(f.saldo.verdi);
  if (f.termin) f.termin.verdi = Math.abs(f.termin.verdi);
  return { type: 'lan', dato: finnDato(linjer, /per|pr\.|saldo|dato/i, reserveDato), felt: f };
}

export function tolkInvestering(linjer, reserveDato) {
  const f = {
    verdi: finn(linjer, [/total markedsverdi|sum markedsverdi|porteføljeverdi|totalverdi|total verdi|samlet verdi|markedsverdi|verdi totalt|sum beholdning|sum verdi|totalt/i], { ikke: /kostpris|anskaffelse|gevinst|avkastning|kreditt/i }),
    kreditt: finn(linjer, [/kreditt|belåning|lån\b|saldo konto/i], { ikke: /ramme|grense|limit/i }),
    innskutt: finn(linjer, [/innskudd|innskutt|kostpris|anskaffelsesverdi/i]),
  };
  if (f.kreditt) f.kreditt.verdi = Math.abs(f.kreditt.verdi);
  return { type: 'investering', dato: finnDato(linjer, /per|pr\.|dato|verdi/i, reserveDato), felt: f };
}

export function tolkSkatt(linjer, reserveDato) {
  const f = {
    beregnet: finn(linjer, [/sum skatter og avgifter|beregnet skatt|utlignet skatt|samlet skatt|sum skatt/i], { ikke: /forskudd|trukket/i }),
    trukket: finn(linjer, [/forskuddstrekk|trukket skatt|innbetalt forskudd|sum forskudd/i]),
    restskatt: finn(linjer, [/restskatt|skatt å betale|du skal betale|å betale/i], { ikke: /forskudd/i }),
    tilgode: finn(linjer, [/til gode|tilgode|skatt til utbetaling|du får tilbake|tilbakebetaling/i]),
  };
  const aar = (linjer.join(' ').match(/(?:skatteoppgjør|skattemelding|inntektsåret|for)\s+(?:for\s+)?(20\d{2})/i) || [])[1];
  return { type: 'skatt', aar: aar ? Number(aar) : Number((reserveDato || new Date().toISOString()).slice(0, 4)) - 1, dato: reserveDato, felt: f };
}

export function tolkDokument(linjer, kategori, reserveDato) {
  if (kategori === 'lonn') return tolkLonn(linjer, reserveDato);
  if (kategori === 'lan') return tolkLan(linjer, reserveDato);
  if (kategori === 'investering') return tolkInvestering(linjer, reserveDato);
  if (kategori === 'skatt') return tolkSkatt(linjer, reserveDato);
  return null;
}
