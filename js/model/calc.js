// Beregninger: kontantstrøm, formue, gjeld, nøkkeltall og formuesskatt.

import { kategoriIndeks } from './categories.js';

export const MND_NAVN = ['Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Desember'];
export const MND_KORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

export const r2 = (x) => Math.round(x * 100) / 100;

// Månedsnøkkel for en transaksjon etter valgt grunnlag ('betalt' eller 'kjopt').
export function mndFor(t, grunnlag = 'betalt') {
  const d = grunnlag === 'kjopt' ? t.dato || t.betalt : t.betalt || t.dato;
  return (d || '').slice(0, 7);
}

export function aarMedData(db) {
  const s = new Set();
  for (const t of db.transaksjoner) {
    if (t.betalt) s.add(t.betalt.slice(0, 4));
    if (t.dato) s.add(t.dato.slice(0, 4));
  }
  return [...s].filter(Boolean).sort();
}

// Kontantstrøm for et år: summer per underkategori og måned.
export function kontantstrom(db, aar, grunnlag = 'betalt') {
  const idx = kategoriIndeks(db.kategorier);
  const mnder = MND_NAVN.map((_, i) => `${aar}-${String(i + 1).padStart(2, '0')}`);
  const perSub = new Map(); // subId -> number[12]
  const tom = () => new Array(12).fill(0);
  const tot = { inntekt: tom(), utgift: tom(), noytral: tom(), sparing: tom(), overforing: tom() };
  const brukteMnd = new Set();
  for (const t of db.transaksjoner) {
    const m = mndFor(t, grunnlag);
    if (m.slice(0, 4) !== String(aar)) continue;
    const i = Number(m.slice(5, 7)) - 1;
    const id = t.kategori && idx.hent(t.kategori) ? t.kategori : '';
    if (!perSub.has(id)) perSub.set(id, tom());
    perSub.get(id)[i] += t.belop;
    tot[id ? idx.type(id) : 'utgift'][i] += t.belop;
    brukteMnd.add(i);
  }
  const netto = tom().map((_, i) => tot.inntekt[i] + tot.utgift[i] + tot.noytral[i]);
  const sparerate = netto.map((n, i) => (tot.inntekt[i] > 0 ? n / tot.inntekt[i] : null));
  const sist = brukteMnd.size ? Math.max(...brukteMnd) : -1;
  return { aar, grunnlag, mnder, perSub, tot, netto, sparerate, antallMnd: sist + 1, brukteMnd };
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
export { sum };

// Siste kjente verdi for en post på/før en dato.
export function verdiPa(post, dato = '9999-12-31') {
  let best = null;
  for (const v of post.verdier || []) {
    if (v.dato <= dato && (!best || v.dato >= best.dato)) best = v;
  }
  return best;
}

export const EIENDEL_TYPER = {
  bank: 'Bankinnskudd',
  bsu: 'BSU',
  fond: 'Fond',
  aksjer: 'Aksjer',
  kontanter: 'Kontanter i aksjesparekonto',
  pensjon: 'Pensjon (EPK/IPS)',
  selskap: 'Unotert selskap',
  kjoretoy: 'Kjøretøy',
  bolig: 'Bolig',
  krypto: 'Kryptovaluta',
  annet: 'Annen eiendel',
};

export const GJELD_TYPER = {
  studielan: 'Studielån',
  billan: 'Billån',
  boliglan: 'Boliglån',
  kreditt: 'Verdipapirkreditt',
  kredittkort: 'Kredittkort',
  forbrukslan: 'Forbrukslån',
  annet: 'Annen gjeld',
};

export const INVESTERING = new Set(['fond', 'aksjer', 'kontanter']);

// Grupper brukt i formueshistorikken (samme som i regnearket).
export const HISTORIKK_FELT = [
  ['bank', 'Bank'],
  ['aksjerFond', 'Aksjer og fond'],
  ['pensjon', 'Pensjon'],
  ['selskap', 'Selskap'],
  ['kjoretoy', 'Kjøretøy'],
  ['annet', 'Annet'],
  ['kreditt', 'Verdipapirkreditt'],
  ['billan', 'Billån'],
  ['studielan', 'Studielån'],
  ['annenGjeld', 'Annen gjeld'],
];

function historikkFelt(post) {
  if (post.side === 'gjeld') {
    if (post.type === 'kreditt') return 'kreditt';
    if (post.type === 'billan') return 'billan';
    if (post.type === 'studielan') return 'studielan';
    return 'annenGjeld';
  }
  if (post.type === 'bank' || post.type === 'bsu') return 'bank';
  if (INVESTERING.has(post.type)) return 'aksjerFond';
  if (post.type === 'pensjon') return 'pensjon';
  if (post.type === 'selskap') return 'selskap';
  if (post.type === 'kjoretoy') return 'kjoretoy';
  return 'annet';
}

export function formue(db, dato) {
  const poster = db.formue.poster.map((p) => {
    const v = verdiPa(p, dato);
    return { post: p, verdi: v ? v.verdi : null, dato: v?.dato || null, kilde: v?.kilde || '' };
  });
  const eiendeler = poster.filter((x) => x.post.side === 'eiendel');
  const gjeld = poster.filter((x) => x.post.side === 'gjeld');
  const sumE = sum(eiendeler.map((x) => x.verdi || 0));
  const sumG = sum(gjeld.map((x) => x.verdi || 0));
  const grupper = {};
  for (const [f] of HISTORIKK_FELT) grupper[f] = 0;
  for (const x of poster) {
    const f = historikkFelt(x.post);
    grupper[f] += x.post.side === 'gjeld' ? -(x.verdi || 0) : x.verdi || 0;
  }
  for (const f in grupper) grupper[f] = r2(grupper[f]);
  const sisteDato = poster.reduce((m, x) => (x.dato && x.dato > m ? x.dato : m), '');
  return { poster, eiendeler, gjeld, sumEiendeler: r2(sumE), sumGjeld: r2(sumG), netto: r2(sumE - sumG), grupper, sisteDato };
}

export function gjeldsdetaljer(db, f, standardFradrag) {
  return f.gjeld.map((x) => {
    const rente = x.post.rente ?? null;
    const fradrag = x.post.rentefradrag ?? standardFradrag;
    const nettoRente = rente != null ? rente * (1 - fradrag) : null;
    const aarlig = nettoRente != null && x.verdi != null ? x.verdi * nettoRente : null;
    return { ...x, rente, fradrag, nettoRente, aarlig };
  });
}

export function nokkeltall(db, aar) {
  const f = formue(db);
  const s = db.innstillinger?.skatt || {};
  const gjeld = gjeldsdetaljer(db, f, s.rentefradrag ?? 0.22);
  const likvide = sum(f.eiendeler.filter((x) => x.post.type === 'bank').map((x) => x.verdi || 0));
  const portefolje = sum(f.eiendeler.filter((x) => INVESTERING.has(x.post.type)).map((x) => x.verdi || 0));
  const kreditt = sum(f.gjeld.filter((x) => x.post.type === 'kreditt').map((x) => x.verdi || 0));
  const kf = kontantstrom(db, aar, 'betalt');
  const spart = sum(kf.netto);
  const inntekt = sum(kf.tot.inntekt);
  const forbruk = -sum(kf.tot.utgift);
  const utbytte = sum((db.formue.utbytte || []).filter((u) => String(u.aar) === String(aar)).map((u) => u.belop));
  const nodvendig = db.innstillinger?.nodvendigeUtgifterPerMnd || null;
  const forrige = [...(db.formue.historikk || [])]
    .filter((h) => h.nettoformue != null && h.dato < (f.sisteDato || '9999'))
    .sort((a, b) => a.dato.localeCompare(b.dato))
    .pop();
  return {
    formue: f,
    gjeld,
    nettoformue: f.netto,
    forrigeSnapshot: forrige || null,
    endringNettoformue: forrige ? r2(f.netto - forrige.nettoformue) : null,
    spart: r2(spart),
    investert: r2(-sum(kf.tot.sparing)),
    inntekt: r2(inntekt),
    forbruk: r2(forbruk),
    sparerate: inntekt > 0 ? spart / inntekt : null,
    antallMnd: kf.antallMnd,
    likvide: r2(likvide),
    bufferMnd: nodvendig ? likvide / nodvendig : null,
    totalGjeld: f.sumGjeld,
    kreditt: r2(kreditt),
    portefolje: r2(portefolje),
    belaningsgrad: portefolje > 0 ? kreditt / portefolje : null,
    nettoRentekostnad: r2(sum(gjeld.map((g) => g.aarlig || 0))),
    utbytte: r2(utbytte),
    kontantstrom: kf,
  };
}

// Formuesskatt (forenklet, som i regnearket): verdsettelsesrabatt per type, full gjeldsfradrag.
export function formuesskatt(db) {
  const s = db.innstillinger?.skatt || {};
  const rabattAksjer = s.rabattAksjer ?? 0.2;
  const f = formue(db);
  const linjer = [];
  for (const x of f.eiendeler) {
    const p = x.post;
    if (x.verdi == null) continue;
    let rabatt = 0;
    let grunnlag = x.verdi;
    let merknad = '';
    if (p.type === 'pensjon') { rabatt = 1; merknad = 'Unntatt formuesskatt'; }
    else if (p.type === 'fond' || p.type === 'aksjer' || p.type === 'selskap') rabatt = rabattAksjer;
    else if (p.type === 'kjoretoy' && p.skattemessigVerdi != null) { grunnlag = p.skattemessigVerdi; merknad = 'Skatteetatens fastsatte verdi'; }
    else if (p.type === 'bolig') rabatt = p.boligRabatt ?? 0.75;
    if (p.skatterabatt != null) rabatt = p.skatterabatt;
    linjer.push({ navn: p.navn, type: p.type, verdi: x.verdi, grunnlag, rabatt, skattemessig: r2(grunnlag * (1 - rabatt)), merknad });
  }
  const gjeld = f.gjeld.filter((x) => x.verdi != null).map((x) => ({ navn: x.post.navn, verdi: x.verdi }));
  const sumAktiva = sum(linjer.map((l) => l.skattemessig));
  const sumGjeld = sum(gjeld.map((g) => g.verdi));
  const nettoSkattemessig = r2(sumAktiva - sumGjeld);
  const bunnfradrag = s.bunnfradrag ?? 1900000;
  const sats = s.formuesskattSats ?? 0.01;
  return {
    linjer,
    gjeld,
    sumAktiva: r2(sumAktiva),
    sumGjeld: r2(sumGjeld),
    nettoSkattemessig,
    bunnfradrag,
    sats,
    margin: r2(bunnfradrag - nettoSkattemessig),
    skatt: r2(Math.max(0, nettoSkattemessig - bunnfradrag) * sats),
  };
}

// Lager et øyeblikksbilde (formueshistorikk) for en måned basert på verdier pr. månedsslutt.
export function lagSnapshot(db, mnd) {
  const [y, m] = mnd.split('-').map(Number);
  const dato = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const f = formue(db, dato);
  return { mnd, dato, grupper: f.grupper, nettoformue: f.netto, komplett: true, kilde: 'Beregnet fra registrerte verdier' };
}

// Avkastning per investeringsgruppe (konto): verdi mot registrert innskudd, kreditt og utbytte.
export function avkastning(db) {
  const grupper = new Map();
  for (const p of db.formue.poster) {
    if (p.side !== 'eiendel' || !(INVESTERING.has(p.type) || p.type === 'pensjon')) continue;
    const g = p.gruppe || 'Annet';
    if (!grupper.has(g)) grupper.set(g, []);
    grupper.get(g).push(p);
  }
  const innskudd = db.formue.innskudd || {};
  return [...grupper.entries()].map(([gruppe, poster]) => {
    const siste = poster.map((p) => verdiPa(p)).filter(Boolean);
    const verdi = sum(siste.map((v) => v.verdi));
    const dato = siste.reduce((m, v) => (v.dato > m ? v.dato : m), '');
    // Forrige felles verdidato (alle poster har verdi) for endring
    const datoer = [...new Set(poster.flatMap((p) => (p.verdier || []).map((v) => v.dato)))].sort();
    const forrigeDato = datoer.filter((d) => d < dato).reverse().find((d) => poster.every((p) => verdiPa(p, d)));
    const forrige = forrigeDato ? sum(poster.map((p) => verdiPa(p, forrigeDato).verdi)) : null;
    const kreditt = sum(db.formue.poster.filter((p) => p.side === 'gjeld' && p.type === 'kreditt' && p.gruppe === gruppe).map((p) => verdiPa(p)?.verdi || 0));
    const inn = innskudd[gruppe]?.belop ?? null;
    const utbytte = sum((db.formue.utbytte || []).filter((u) => u.gruppe === gruppe).map((u) => u.belop));
    // Innskudd i år: sparetransaksjoner med kontonavnet i teksten (eller første ord, hvis det er entydig)
    const aar = String(new Date().getFullYear());
    const spareTrans = db.transaksjoner.filter((t) => (t.kategori || '').startsWith('sparing/') && (t.betalt || t.dato || '').startsWith(aar));
    const tekstAv = (t) => `${t.tekst} ${t.ra || ''}`.toLowerCase();
    const fullt = gruppe.toLowerCase();
    const forsteOrd = fullt.split(' ')[0];
    const entydig = [...grupper.keys()].filter((g) => g.toLowerCase().split(' ')[0] === forsteOrd).length === 1;
    const treff = spareTrans.some((t) => tekstAv(t).includes(fullt))
      ? spareTrans.filter((t) => tekstAv(t).includes(fullt))
      : entydig ? spareTrans.filter((t) => tekstAv(t).includes(forsteOrd)) : [];
    const innskuddIAar = -sum(treff.map((t) => t.belop));
    return {
      gruppe, poster: poster.length, verdi, dato, forrige, forrigeDato, kreditt, netto: verdi - kreditt,
      innskutt: inn, innskuttDato: innskudd[gruppe]?.dato || null,
      gevinst: inn != null ? verdi - inn : null,
      avkastning: inn ? (verdi - inn) / inn : null,
      utbytte, innskuddIAar,
      pensjon: poster.every((p) => p.type === 'pensjon'),
    };
  }).sort((a, b) => b.verdi - a.verdi);
}
