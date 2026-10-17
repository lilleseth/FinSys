// Import av regnearket «Privatøkonomisk oversikt» til FinSys-databasen.

import { readXlsx, excelDate, numToCol } from './xlsx.js';
import { mapGammelKategori, etiketterFraGammel } from '../model/categories.js';
import { uid, slug } from '../util.js';

const MND = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];

function rows(wb, name) {
  const s = wb.sheet(name);
  if (!s) return [];
  const out = [];
  for (let r = 1; r <= s.maxRow; r++) {
    const row = [];
    let any = false;
    for (let c = 1; c <= 30; c++) {
      const v = s.cells.get(numToCol(c) + r);
      row.push(v ?? null);
      if (v != null) any = true;
    }
    out.push(any ? row : null);
  }
  return out; // out[r-1][c-1]
}

const str = (v) => (v == null ? '' : String(v).trim());
const num = (v) => (typeof v === 'number' ? v : null);

function datoFraTekst(t) {
  const m = str(t).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

function finnRad(rs, test) {
  return rs.findIndex((r) => r && test(str(r[0]), r));
}

function forsteTall(row) {
  return row ? row.slice(1).find((v) => typeof v === 'number') ?? null : null;
}

export async function lesRegneark(buffer) {
  return readXlsx(buffer);
}

export function migrer(wb) {
  const logg = [];
  const advarsler = [];
  if (!wb.has('Transaksjoner')) throw new Error('Fant ikke fanen «Transaksjoner». Er dette riktig regneark?');

  // --- Transaksjoner ---
  const tr = rows(wb, 'Transaksjoner');
  const hRad = finnRad(tr, (a, r) => a === 'ID' && r.some((v) => str(v) === 'Beløp'));
  if (hRad < 0) throw new Error('Fant ikke overskriftsraden i «Transaksjoner».');
  const kol = {};
  tr[hRad].forEach((v, i) => { if (v != null) kol[str(v)] = i; });
  const g = (r, navn) => (kol[navn] != null ? r[kol[navn]] : null);

  const kontoer = new Map();
  const transaksjoner = [];
  const sett = new Set();
  for (let i = hRad + 1; i < tr.length; i++) {
    const r = tr[i];
    if (!r || g(r, 'Beløp') == null) continue;
    const kontoNavn = str(g(r, 'Konto')) || '—';
    const kontoId = kontoNavn === '—' ? 'korreksjon' : slug(kontoNavn);
    if (!kontoer.has(kontoId)) kontoer.set(kontoId, lagKonto(kontoId, kontoNavn));
    const belop = Number(g(r, 'Beløp'));
    const katGammel = str(g(r, 'Kategori'));
    const underGammel = str(g(r, 'Underkategori'));
    let id = 't-' + (str(g(r, 'ID')) || uid());
    if (sett.has(id)) id = 't-' + uid();
    sett.add(id);
    const dato = excelDate(g(r, 'Transaksjonsdato'));
    const betalt = excelDate(g(r, 'Betalt')) || dato;
    transaksjoner.push({
      id,
      konto: kontoId,
      dato: dato || betalt,
      betalt,
      forfall: excelDate(g(r, 'Forfall')),
      tekst: str(g(r, 'Leverandør')),
      belop,
      kategori: mapGammelKategori(katGammel, underGammel, belop),
      etiketter: etiketterFraGammel(katGammel, underGammel),
      detaljer: str(g(r, 'Detaljer')),
      notat: str(g(r, 'Notat')),
      kilde: str(g(r, 'Kilde')),
      opprinnelig: { kategori: katGammel, underkategori: underGammel, type: str(g(r, 'Type')), mnd: str(g(r, 'Kontantstrøm-mnd')) },
    });
    const kmnd = str(g(r, 'Kontantstrøm-mnd'));
    if (kmnd && betalt && betalt.slice(0, 7) !== kmnd) {
      advarsler.push(`Transaksjon ${id}: betalingsdato ${betalt} er i en annen måned enn Kontantstrøm-mnd ${kmnd}.`);
    }
  }
  const ukat = transaksjoner.filter((t) => !t.kategori).length;
  logg.push(`${transaksjoner.length} transaksjoner importert (${ukat} uten kategori).`);

  // Hvilket år gjelder arket? Mest brukte betalingsår.
  const aarTelling = {};
  for (const t of transaksjoner) { const a = t.betalt?.slice(0, 4); if (a) aarTelling[a] = (aarTelling[a] || 0) + 1; }
  const hovedAar = Object.entries(aarTelling).sort((a, b) => b[1] - a[1])[0]?.[0] || String(new Date().getFullYear());

  // --- Formue ---
  const poster = [];
  const utbytte = [];
  const lagPost = (p) => { const post = { id: 'p-' + slug(p.navn) + '-' + uid().slice(0, 4), verdier: [], ...p }; poster.push(post); return post; };
  const settVerdi = (post, dato, verdi, kilde) => {
    if (verdi == null || !dato) return;
    post.verdier = post.verdier.filter((v) => v.dato !== dato);
    post.verdier.push({ dato, verdi: Math.round(verdi * 100) / 100, kilde });
    post.verdier.sort((a, b) => a.dato.localeCompare(b.dato));
  };

  // Sparing og pensjon
  const sp = rows(wb, 'Sparing og pensjon');
  if (sp.length) {
    const dato = datoFraTekst(sp[0]?.[0]) || `${hovedAar}-12-31`;
    for (const r of sp.slice(1)) {
      if (!r) continue;
      const navn = str(r[0]);
      const v = num(r[1]);
      if (!navn || v == null || /^sum/i.test(navn)) continue;
      let type = 'bank';
      let gruppe = 'Bank';
      let kontoId = slug(navn);
      if (/bsu/i.test(navn)) type = 'bsu';
      if (/epk|pensjon|ips/i.test(navn)) { type = 'pensjon'; gruppe = 'Pensjon'; kontoId = null; }
      // Samme konto kan ha litt ulikt navn i regnearket og i bankfilen (f.eks. «…konto» / «…spar»)
      if (kontoId && !kontoer.has(kontoId)) kontoId = [...kontoer.keys()].find((k) => k.length >= 6 && k.slice(0, 6) === kontoId.slice(0, 6)) || kontoId;
      const post = lagPost({ navn, side: 'eiendel', type, gruppe, kontoId: kontoer.has(kontoId) ? kontoId : null, notat: str(r[2]) });
      settVerdi(post, dato, v, 'Regneark: Sparing og pensjon');
    }
    logg.push('Bankkontoer, BSU og pensjon importert.');
  }

  // Investeringer
  const inv = rows(wb, 'Investeringer');
  if (inv.length) {
    const dato = datoFraTekst(inv[0]?.[0]) || `${hovedAar}-12-31`;
    const gruppeNavn = { 'Nordnet fond': 'Nordnet ASK', 'Nordea fond': 'Nordea fondsspareavtale' };
    for (let i = 1; i < inv.length; i++) {
      const r = inv[i];
      if (!r) continue;
      const navn = str(r[0]);
      if (/^brutto portef/i.test(navn)) break;
      const v = num(r[1]);
      const konto = str(r[3]);
      if (!navn || v == null || !konto) continue;
      const type = /kontant/i.test(navn) ? 'kontanter' : /fond/i.test(konto) ? 'fond' : 'aksjer';
      const rent = navn.replace(/\s*\(.*\)\s*$/, '').replace(/^Pareto ASK – /, '');
      const notat = (navn.match(/\((.*)\)/) || [])[1] || '';
      const post = lagPost({ navn: type === 'kontanter' ? 'Kontanter (utbytte)' : rent, side: 'eiendel', type, gruppe: gruppeNavn[konto] || konto, notat });
      settVerdi(post, dato, v, 'Regneark: Investeringer');
    }
    const ub = finnRad(inv, (a) => /^utbytte hittil/i.test(a));
    if (ub >= 0 && num(inv[ub][1]) != null) {
      utbytte.push({ id: 'u-' + uid(), aar: hovedAar, gruppe: 'Pareto ASK', belop: num(inv[ub][1]), dato, kilde: str(inv[ub][2]) || 'Regneark' });
    }
    logg.push('Investeringsportefølje importert.');
  }

  // Oversikt: selskap, biler, krypto
  const ov = rows(wb, 'Oversikt');
  const ovDato = datoFraTekst(ov[1]?.[0]) || `${hovedAar}-12-31`;
  const fs = rows(wb, 'Formuesskatt 2026').length ? rows(wb, 'Formuesskatt 2026') : rows(wb, wb.names.find((n) => /formuesskatt/i.test(n)) || '');
  for (const r of ov) {
    if (!r) continue;
    const a = str(r[0]);
    if (typeof r[1] !== 'number') continue;
    const m = a.match(/^(.*?)\s*\((.*)\)\s*$/);
    const navn = m ? m[1] : a;
    const notat = m ? m[2] : '';
    if (/invest as|\bas\b/i.test(navn) && !/verdipapir/i.test(navn)) {
      settVerdi(lagPost({ navn, side: 'eiendel', type: 'selskap', gruppe: 'Selskap', notat }), ovDato, r[1], 'Regneark: Oversikt (anslag)');
    } else if (/^biler?|bil\b/i.test(navn) && !/lån/i.test(navn)) {
      const fsRad = fs.find((x) => x && /^biler/i.test(str(x[0])));
      const post = lagPost({ navn, side: 'eiendel', type: 'kjoretoy', gruppe: 'Kjøretøy', notat, skattemessigVerdi: fsRad ? num(fsRad[1]) : null });
      settVerdi(post, ovDato, r[1], 'Regneark: Oversikt (anslag)');
    }
  }
  const kryptoRad = ov.find((r) => r && /krypto/i.test(str(r[0])));
  lagPost({ navn: 'Kryptovaluta', side: 'eiendel', type: 'krypto', gruppe: 'Krypto', notat: kryptoRad ? str(kryptoRad[0]) : 'Ikke registrert ennå' });

  // Gjeld
  const gj = rows(wb, 'Gjeld');
  let rentefradrag = 0.22;
  const gjeldPoster = {};
  for (const r of gj) {
    if (!r) continue;
    const a = str(r[0]);
    const saldo = num(r[1]);
    if (!a || saldo == null || /^sum/i.test(a) || typeof r[2] !== 'number') continue;
    const navn = a.split(' – ')[0].trim();
    const dato = datoFraTekst(a) || datoFraTekst(gj[0]?.[0]) || `${hovedAar}-12-31`;
    let type = 'annet';
    let gruppe = 'Annen gjeld';
    if (/studiel/i.test(navn)) { type = 'studielan'; gruppe = 'Lånekassen'; }
    else if (/billån/i.test(navn)) { type = 'billan'; gruppe = 'Billån'; }
    else if (/boliglån/i.test(navn)) { type = 'boliglan'; gruppe = 'Boliglån'; }
    else if (/kreditt/i.test(navn)) {
      type = 'kreditt';
      gruppe = /pareto/i.test(navn) ? 'Pareto aksjekonto' : /nordnet/i.test(navn) ? 'Nordnet ASK' : 'Verdipapirkreditt';
    }
    if (typeof r[3] === 'number') rentefradrag = r[3];
    const post = lagPost({ navn, side: 'gjeld', type, gruppe, rente: r[2], rentefradrag: typeof r[3] === 'number' ? r[3] : null });
    settVerdi(post, dato, saldo, 'Regneark: Gjeld');
    gjeldPoster[type] = gjeldPoster[type] || post;
  }
  logg.push(`${poster.filter((p) => p.side === 'gjeld').length} gjeldsposter og ${poster.filter((p) => p.side === 'eiendel').length} eiendeler importert.`);

  // Formueshistorikk
  const historikk = [];
  const fh = rows(wb, 'Formueshistorikk');
  const fhH = finnRad(fh, (a) => a === 'Måned');
  if (fhH >= 0) {
    const felt = [null, null, 'bank', 'aksjerFond', 'pensjon', 'selskap', 'kjoretoy', 'kreditt', 'billan', 'studielan'];
    for (const r of fh.slice(fhH + 1)) {
      if (!r || r[1] == null) continue;
      const dato = excelDate(r[1]);
      if (!dato) continue;
      const grupper = {};
      felt.forEach((f, i) => { if (f && typeof r[i] === 'number') grupper[f] = r[i]; });
      const netto = num(r[10]);
      historikk.push({ mnd: dato.slice(0, 7), dato, grupper, nettoformue: netto, komplett: netto != null, kilde: str(r[11]) });
      if (typeof r[8] === 'number' && gjeldPoster.billan) settVerdi(gjeldPoster.billan, dato, -r[8], 'Regneark: Formueshistorikk');
      if (typeof r[9] === 'number' && gjeldPoster.studielan) settVerdi(gjeldPoster.studielan, dato, -r[9], 'Regneark: Formueshistorikk');
    }
    logg.push(`${historikk.length} måneder formueshistorikk importert.`);
  }

  // Lønnsslipper
  const lonnsslipper = [];
  const inn = rows(wb, 'Inntekt');
  const innH = finnRad(inn, (a, r) => a === 'Post' && r.some((v) => /januar/i.test(str(v))));
  if (innH >= 0) {
    const arbeidsgiver = (str(inn[0]?.[0]).match(/\(lønnsslipper (.*)\)/i) || [])[1] || '';
    const feltFor = (a) => {
      if (/^fastlønn/i.test(a)) return 'fastlonn';
      if (/^overtid 50/i.test(a)) return 'overtid50';
      if (/^overtid 100/i.test(a)) return 'overtid100';
      if (/^engangs/i.test(a)) return 'engang';
      if (/^andre tillegg/i.test(a)) return 'andreTillegg';
      if (/^bruttolønn/i.test(a)) return 'brutto';
      if (/^skattetrekk/i.test(a)) return 'skattetrekk';
      if (/^trekkfrie/i.test(a)) return 'trekkfrie';
      if (/^nettolønn/i.test(a)) return 'netto';
      return null;
    };
    inn[innH].forEach((v, ci) => {
      const mi = MND.indexOf(str(v).toLowerCase());
      if (mi < 0) return;
      const slipp = { id: 'l-' + uid(), mnd: `${hovedAar}-${String(mi + 1).padStart(2, '0')}`, arbeidsgiver };
      for (const r of inn.slice(innH + 1)) {
        if (!r) continue;
        const f = feltFor(str(r[0]));
        if (f && typeof r[ci] === 'number') slipp[f] = r[ci];
      }
      if (slipp.brutto != null || slipp.netto != null) lonnsslipper.push(slipp);
    });
    logg.push(`${lonnsslipper.length} lønnsslipper importert.`);
  }

  // Notater og huskeliste fra fritekst i fanene
  const notater = [];
  const idag = new Date().toISOString().slice(0, 10);
  for (const navn of wb.names) {
    if (navn === 'Transaksjoner') continue;
    const rs = rows(wb, navn);
    const linjer = [];
    let husk = null;
    rs.forEach((r, i) => {
      if (!r || i < 2) return;
      const celler = r.filter((v) => v != null);
      if (celler.length !== 1 || typeof celler[0] !== 'string') { husk = null; return; }
      const t = celler[0].trim();
      if (/^huskeliste/i.test(t)) {
        const mi = MND.findIndex((m) => t.toLowerCase().includes(m));
        const rest = t.replace(/^huskeliste\s*/i, '').replace(/:$/, '').toLowerCase();
        husk = { mnd: mi >= 0 ? `${hovedAar}-${String(mi + 1).padStart(2, '0')}` : null, tittel: rest ? rest[0].toUpperCase() + rest.slice(1) : 'Huskeliste' };
        return;
      }
      if (husk && /^[-–•]/.test(t)) {
        notater.push({ id: 'n-' + uid(), type: 'huskeliste', dato: idag, mnd: husk.mnd, tittel: husk.tittel, tekst: t.replace(/^[-–•]\s*/, ''), ferdig: false, kilde: `Regneark: ${navn}` });
        return;
      }
      husk = null;
      if (t.length > 30 || /:$/.test(t)) linjer.push(t);
    });
    if (linjer.length) {
      notater.push({ id: 'n-' + uid(), type: 'notat', dato: idag, tittel: `Fra regnearket: ${navn}`, tekst: linjer.join('\n'), kilde: `Regneark: ${navn}`, etiketter: [navn] });
    }
  }
  logg.push(`${notater.filter((n) => n.type === 'notat').length} notater og ${notater.filter((n) => n.type === 'huskeliste').length} huskelistepunkter importert.`);

  // Innstillinger
  const finnTall = (rs, re) => {
    for (const r of rs) if (r && re.test(str(r[0])) && forsteTall(r) != null) return forsteTall(r);
    return null;
  };
  const bunnfradrag = finnTall(fs, /^bunnfradrag/i);
  const aksjeRad = fs.find((r) => r && /^aksjer og fond/i.test(str(r[0])));
  const dd = rows(wb, 'Dashboard-data');
  const nodvendig = finnTall(dd, /^nødvendige utgifter/i);

  return {
    logg,
    advarsler,
    data: {
      kontoer: [...kontoer.values()],
      transaksjoner,
      formue: { poster, historikk, utbytte },
      inntekt: { lonnsslipper },
      notater,
      innstillinger: {
        nodvendigeUtgifterPerMnd: nodvendig,
        skatt: {
          rentefradrag,
          bunnfradrag: bunnfradrag ?? 1900000,
          formuesskattSats: 0.01,
          rabattAksjer: aksjeRad && typeof aksjeRad[2] === 'number' ? aksjeRad[2] : 0.2,
        },
      },
    },
  };
}

function lagKonto(id, navn) {
  let type = 'annet';
  let bank = '';
  if (id === 'korreksjon') return { id, navn: 'Korreksjon (ingen konto)', type: 'annet', bank: '', aktiv: true };
  if (/kort|mastercard|premium|visa/i.test(navn)) type = 'kredittkort';
  else if (/brukskonto/i.test(navn)) type = 'brukskonto';
  else if (/spar|buffer/i.test(navn)) type = 'sparekonto';
  else if (/bsu/i.test(navn)) type = 'bsu';
  if (/nordea|brukskonto|buffer/i.test(navn)) bank = 'Nordea';
  if (/dnb/i.test(navn)) bank = 'DNB';
  return { id, navn, type, bank, aktiv: true };
}
