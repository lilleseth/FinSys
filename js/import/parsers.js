// Tolking av bankfiler: Nordea CSV, kortfakturaer (Nordea Premium, DNB, Trumf) og generell CSV/Excel.
// Resultatet er et felles format som importsiden viser og lagrer.

import { lesBelop } from '../util.js';
import { readXlsx, excelDate, numToCol } from './xlsx.js';
import { pdfLinjer } from './pdf.js';

const r2 = (x) => Math.round(x * 100) / 100;
const BELOP = '(-?\\d{1,3}(?:[. ]\\d{3})*,\\d{2})';

export function lesDato(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

// Gjør «KAFE SOLSIDEN OSLO» om til «Kafe Solsiden Oslo».
export function penTekst(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const bokstaver = t.replace(/[^A-Za-zÆØÅæøåÄÖäö]/g, '');
  if (bokstaver && bokstaver === bokstaver.toUpperCase()) {
    return t.toLowerCase().replace(/(^|[\s\-(/])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
      .replace(/\b(As|Asa|Nuf|Ab|Abp|Dnb|Sas|Ica|Ikea|Ab)\b/g, (w) => w.toUpperCase());
  }
  return t;
}

// --- CSV ---

export function dekodTekst(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function parseCsv(tekst) {
  const forste = tekst.split(/\r?\n/)[0] || '';
  const sep = [';', '\t', ','].map((s) => [s, forste.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rader = [];
  let rad = [];
  let felt = '';
  let iAnf = false;
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst[i];
    if (iAnf) {
      if (c === '"' && tekst[i + 1] === '"') { felt += '"'; i++; }
      else if (c === '"') iAnf = false;
      else felt += c;
    } else if (c === '"') iAnf = true;
    else if (c === sep) { rad.push(felt); felt = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && tekst[i + 1] === '\n') i++;
      rad.push(felt); felt = '';
      if (rad.some((f) => f.trim() !== '')) rader.push(rad);
      rad = [];
    } else felt += c;
  }
  rad.push(felt);
  if (rad.some((f) => f.trim() !== '')) rader.push(rad);
  return rader;
}

function nordeaCsv(rader, filnavn) {
  const h = rader[0].map((x) => x.trim());
  const i = (n) => h.indexOf(n);
  const kontonr = new Map();
  const ut = [];
  for (const r of rader.slice(1)) {
    const dato = lesDato(r[i('Bokføringsdato')]);
    const belop = lesBelop(r[i('Beløp')]);
    if (!dato || belop == null) continue;
    const egen = belop < 0 ? r[i('Avsender')] : r[i('Mottaker')];
    if (egen) kontonr.set(egen, (kontonr.get(egen) || 0) + 1);
    const ra = (r[i('Tittel')] || r[i('Navn')] || '').trim();
    ut.push({ dato, betalt: dato, tekstRa: ra, belop, detaljer: (r[i('Betalingstype')] || '').trim(), valuta: r[i('Valuta')] || 'NOK' });
  }
  const nr = [...kontonr.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const navnHint = (filnavn.match(/^([A-Za-zÆØÅæøå ]+?)[_ ]\d/) || [])[1] || '';
  return {
    format: 'nordea-csv',
    formatNavn: 'Nordea kontoutskrift (CSV)',
    kontoHint: { kontonr: nr, navn: navnHint.trim(), type: 'bank' },
    rader: ut,
    ignorert: [],
    kontroll: [],
  };
}

// Generell CSV/Excel med overskrifter. Finner kolonner for dato, beløp og tekst.
export function generiskeKolonner(h) {
  const finn = (re) => h.findIndex((x) => re.test(String(x || '').toLowerCase()));
  return {
    dato: finn(/bokf|dato|date/),
    belop: finn(/^beløp|beløp$|amount|^sum$/),
    inn: finn(/^inn|innskudd|kredit|credit/),
    ut: finn(/^ut|uttak|debet|debit/),
    tekst: finn(/tekst|beskrivelse|forklaring|tittel|mottaker|navn|description|spesifikasjon/),
  };
}

export function generisk(rader, kol, filnavn) {
  const ut = [];
  for (const r of rader.slice(1)) {
    const dato = typeof r[kol.dato] === 'number' ? excelDate(r[kol.dato]) : lesDato(r[kol.dato]);
    let belop = kol.belop >= 0 ? lesBelop(r[kol.belop]) : null;
    if (belop == null && (kol.inn >= 0 || kol.ut >= 0)) {
      const inn = lesBelop(r[kol.inn]) || 0;
      const utb = lesBelop(r[kol.ut]) || 0;
      belop = inn - Math.abs(utb);
    }
    if (!dato || belop == null || belop === 0) continue;
    const ra = String(r[kol.tekst] ?? '').trim();
    ut.push({ dato, betalt: dato, tekstRa: ra, belop, detaljer: '' });
  }
  return {
    format: 'generisk',
    formatNavn: 'Generell fil',
    kontoHint: { navn: (filnavn.match(/^([A-Za-zÆØÅæøå ]+)/) || [])[1]?.trim() || '' },
    rader: ut,
    ignorert: [],
    kontroll: [],
    kolonner: kol,
    overskrifter: rader[0],
    raRader: rader,
  };
}

// --- Kortfakturaer (PDF) ---

function nordeaKort(linjer) {
  const tekst = linjer.join('\n');
  const forfall = lesDato((tekst.match(/Forfallsdato\s+(\d{2}\.\d{2}\.\d{4})/) || [])[1]);
  const per = tekst.match(/Fakturaperiode\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/);
  const sumKjop = lesBelop((tekst.match(new RegExp('Sum kjøp og tilbakeføringer denne periode\\s+' + BELOP)) || [])[1]);
  const rader = [];
  const ignorert = [];
  let seksjon = '';
  let kjopSum = 0;
  for (const l of linjer) {
    const t = l.trim();
    if (/^Innbetalinger og tilbakeføringer denne periode/.test(t)) { seksjon = 'inn'; continue; }
    if (/^Oversikt over kjøp og tilbakeføringer/.test(t)) { seksjon = 'kjop'; continue; }
    if (/^Sum /.test(t)) { seksjon = ''; continue; }
    if (seksjon === 'inn') {
      const m = t.match(new RegExp('^(\\d{2}\\.\\d{2}\\.\\d{4})\\s+(.+?)\\s+' + BELOP + '$'));
      if (!m) continue;
      const belop = lesBelop(m[3]);
      if (/cashback|rabatt|bonus/i.test(m[2])) {
        rader.push({ dato: lesDato(m[1]), betalt: forfall, forfall, tekstRa: m[2].trim(), belop: r2(-belop), detaljer: 'Cashback trukket fra fakturaen' });
      } else {
        ignorert.push({ dato: lesDato(m[1]), tekst: m[2].trim(), belop: r2(-belop), grunn: 'Innbetaling til kortet (motposten ligger på brukskontoen)' });
      }
    } else if (seksjon === 'kjop') {
      const m = t.match(new RegExp('^(\\d{2}\\.\\d{2}\\.\\d{4})\\s+(\\d{2}\\.\\d{2}\\.\\d{4})\\s+(.+?)\\s+' + BELOP + '$'));
      if (!m) continue;
      let spes = m[3].trim();
      let valuta = '';
      const v = spes.match(/^(.*?)\s+([\d.,]+)\s+([A-Z]{3})\s+([\d.,]+)(?:\s+[\d.,]+)?$/);
      if (v) { spes = v[1].trim(); valuta = ` · ${v[4]} ${v[3]} @ ${v[2]}`; }
      const nok = lesBelop(m[4]);
      kjopSum += nok;
      rader.push({ dato: lesDato(m[1]), betalt: forfall, forfall, tekstRa: spes.replace(/\s{2,}/g, ' '), belop: r2(-nok), detaljer: `${spes.replace(/\s{2,}/g, ' ')} · Bokført ${m[2]}${valuta}` });
    }
  }
  return {
    format: 'nordea-kort',
    formatNavn: 'Nordea kredittkortfaktura',
    kontoHint: { kortType: 'nordea', navn: 'Nordea Premium', type: 'kredittkort' },
    periode: per ? { fra: lesDato(per[1]), til: lesDato(per[2]) } : null,
    forfall,
    rader,
    ignorert,
    kontroll: sumKjop != null ? [{ navn: 'Sum kjøp og tilbakeføringer', forventet: sumKjop, faktisk: r2(kjopSum) }] : [],
  };
}

function dnbKort(linjer) {
  const tekst = linjer.join('\n');
  const forfall = lesDato((tekst.match(/Forfallsdato\s+(\d{2}\.\d{2}\.\d{4})/) || [])[1]);
  const per = tekst.match(/Periode\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/);
  const sumBruk = lesBelop((tekst.match(new RegExp('Sum bruk denne perioden\\s+' + BELOP)) || [])[1]);
  const rader = [];
  const ignorert = [];
  let sum = 0;
  let iListe = false;
  let forrige = null;
  let fremmed = {};
  for (const l of linjer) {
    const t = l.trim();
    if (/^Oversikt over transaksjoner/.test(t)) { iListe = true; continue; }
    if (!iListe) continue;
    if (/^Økonomiske råd/.test(t)) { iListe = false; continue; }
    const m = t.match(new RegExp('^(\\d{2}\\.\\d{2}\\.\\d{4})\\s+(.+?)\\s+(\\d{6,})\\s+' + BELOP + '$'));
    if (m) {
      const deler = m[2].split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
      const belop = lesBelop(m[4]);
      fremmed = {};
      if (/^innbetaling/i.test(deler[0])) {
        ignorert.push({ dato: lesDato(m[1]), tekst: deler[0], belop, grunn: 'Innbetaling til kortet (motposten ligger på brukskontoen)' });
        forrige = null;
        continue;
      }
      sum += belop;
      forrige = { dato: lesDato(m[1]), betalt: forfall, forfall, tekstRa: deler[0], belop, ref: m[3], detaljer: `${deler.join(' | ')} · Ref ${m[3]}` };
      rader.push(forrige);
      continue;
    }
    const b = t.match(/^Beløp:\s*([\d.,]+)\s+([A-Z]{3})/);
    const k = t.match(/^Kurs:\s*([\d.,]+)/);
    if (forrige && b) { fremmed.belop = b[1]; fremmed.valuta = b[2]; }
    if (forrige && k) fremmed.kurs = k[1];
    if (forrige && fremmed.belop && fremmed.kurs && !forrige.detaljer.includes(fremmed.valuta)) {
      forrige.detaljer += ` · ${fremmed.belop} ${fremmed.valuta} @ ${fremmed.kurs}`;
    }
  }
  return {
    format: 'dnb-kort',
    formatNavn: 'DNB kredittkortfaktura',
    kontoHint: { kortType: 'dnb', navn: 'DNB', type: 'kredittkort' },
    periode: per ? { fra: lesDato(per[1]), til: lesDato(per[2]) } : null,
    forfall,
    rader,
    ignorert,
    kontroll: sumBruk != null ? [{ navn: 'Sum bruk denne perioden', forventet: sumBruk, faktisk: r2(sum) }] : [],
  };
}

function trumfKort(linjer) {
  const tekst = linjer.join('\n');
  const forfall = lesDato((tekst.match(/Forfallsdato\s+(\d{2}\.\d{2}\.\d{2,4})/) || [])[1]);
  const forrigeSaldo = lesBelop((tekst.match(new RegExp('Totalt skyldig beløp forrige periode\\s+' + BELOP)) || [])[1]);
  const nySaldo = lesBelop((tekst.match(new RegExp('Nytt skyldig beløp\\s+' + BELOP)) || [])[1]);
  const rader = [];
  const ignorert = [];
  let sumKjop = 0;
  let sumInn = 0;
  for (const l of linjer) {
    const t = l.trim();
    const m = t.match(new RegExp('^(\\d{2}\\.\\d{2}\\.\\d{2})\\s+(\\d{2}\\.\\d{2}\\.\\d{2})\\s+(.+?)\\s+' + BELOP + '(?:\\s+' + BELOP + ')?$'));
    if (!m) continue;
    const belop = lesBelop(m[5] ?? m[4]);
    let spes = m[3].replace(/\s+(?:[\d.,]+\s+)?[A-Z]{3}$/, '').replace(/\s{2,}/g, ' ').trim();
    if (/mobilbank|innbetaling|nettbank|avtalegiro|efaktura/i.test(spes) && belop > 0) {
      sumInn += belop;
      ignorert.push({ dato: lesDato(m[2]), tekst: spes, belop, grunn: 'Innbetaling til kortet (motposten ligger på brukskontoen)' });
      continue;
    }
    sumKjop += belop;
    rader.push({ dato: lesDato(m[2]), betalt: forfall, forfall, tekstRa: spes, belop, detaljer: `${spes} · Bokført ${m[1]}` });
  }
  const kontroll = forrigeSaldo != null && nySaldo != null
    ? [{ navn: 'Nytt skyldig beløp − forrige saldo − innbetalinger', forventet: r2(nySaldo - forrigeSaldo - sumInn), faktisk: r2(sumKjop) }]
    : [];
  return {
    format: 'trumf-kort',
    formatNavn: 'Trumf kredittkortfaktura',
    kontoHint: { kortType: 'trumf', navn: 'Trumf', type: 'kredittkort' },
    forfall,
    rader,
    ignorert,
    kontroll,
  };
}

// Leser en fil og finner riktig format.
export async function lesBankfil(fil) {
  const buffer = await fil.arrayBuffer();
  const navn = fil.name;
  const lav = navn.toLowerCase();
  let res;
  if (lav.endsWith('.pdf')) {
    const linjer = await pdfLinjer(buffer);
    const t = linjer.join('\n');
    if (/Nordea Premium|Faktura Nordea/i.test(t) && /Brukersted/.test(t)) res = nordeaKort(linjer);
    else if (/DNB/i.test(t) && /Oversikt over transaksjoner/.test(t)) res = dnbKort(linjer);
    else if (/Trumf/i.test(t) && /Transaksjonsoversikt/.test(t)) res = trumfKort(linjer);
    else {
      const e = new Error('Kjenner ikke igjen PDF-formatet. Foreløpig støttes kortfakturaer fra Nordea, DNB og Trumf. Andre PDF-er (lønnsslipp, lånebrev) kommer med AI-tolkning i fase 4.');
      e.linjer = linjer;
      throw e;
    }
  } else if (lav.endsWith('.xlsx')) {
    const wb = await readXlsx(buffer);
    const s = wb.sheet(wb.names[0]);
    const rader = [];
    for (let r = 1; r <= s.maxRow; r++) {
      const rad = [];
      for (let c = 1; c <= 20; c++) rad.push(s.cells.get(numToCol(c) + r) ?? '');
      if (rad.some((v) => v !== '')) rader.push(rad);
    }
    const hRad = rader.findIndex((r) => r.filter((v) => typeof v === 'string' && v).length >= 2);
    res = generisk(rader.slice(Math.max(hRad, 0)), generiskeKolonner(rader[Math.max(hRad, 0)]), navn);
  } else {
    const rader = parseCsv(dekodTekst(buffer));
    if (!rader.length) throw new Error('Filen er tom.');
    const h = rader[0].map((x) => x.trim());
    if (h.includes('Bokføringsdato') && h.includes('Beløp') && h.includes('Tittel')) res = nordeaCsv(rader, navn);
    else res = generisk(rader, generiskeKolonner(h), navn);
  }
  res.filnavn = navn;
  for (const r of res.rader) r.tekst = penTekst(r.tekstRa.replace(/^TrumfPay,\s*/i, '').replace(/,\s*\d{4}-\d{2}-\d{2}.*$/, ''));
  const datoer = res.rader.map((r) => r.dato).filter(Boolean).sort();
  if (!res.periode && datoer.length) res.periode = { fra: datoer[0], til: datoer[datoer.length - 1] };
  for (const k of res.kontroll) k.ok = Math.abs(k.forventet - k.faktisk) < 0.005;
  return res;
}
