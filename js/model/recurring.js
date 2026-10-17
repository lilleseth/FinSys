// Gjenkjenning av faste (gjentakende) inntekter og utgifter: abonnementer, lån, forsikring, lønn …

import { kategoriIndeks } from './categories.js';
import { normaliser } from './rules.js';

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mndNr = (d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
const fraMndNr = (n, dag) => {
  const y = Math.floor(n / 12);
  const m = (n % 12) + 1;
  const sisteDag = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(dag, sisteDag)).padStart(2, '0')}`;
};

export const FREKVENS = { 1: 'Månedlig', 2: 'Annenhver måned', 3: 'Kvartalsvis', 6: 'Halvårlig', 12: 'Årlig' };

// Deler beløp i grupper der beløpene ligger innenfor ±15 % av hverandre.
function klyngeBelop(trans) {
  const sortert = [...trans].sort((a, b) => Math.abs(a.belop) - Math.abs(b.belop));
  const klynger = [];
  for (const t of sortert) {
    const k = klynger.find((x) => Math.abs(Math.abs(t.belop) - x.ref) <= x.ref * 0.15 + 1);
    if (k) { k.t.push(t); k.ref = median(k.t.map((x) => Math.abs(x.belop))); } else klynger.push({ ref: Math.abs(t.belop), t: [t] });
  }
  return klynger.map((k) => k.t);
}

// Finner faste poster. Typer: utgift, inntekt, sparing (overføringer og nøytrale poster tas ikke med).
export function fastePoster(db, { maneder = 13 } = {}) {
  const idx = kategoriIndeks(db.kategorier);
  const sisteDato = db.transaksjoner.reduce((m, t) => (t.dato > m ? t.dato : m), '');
  if (!sisteDato) return [];
  const grense = mndNr(sisteDato) - maneder + 1;
  const grupper = new Map();
  for (const t of db.transaksjoner) {
    if (!t.dato || mndNr(t.dato) < grense) continue;
    const type = t.kategori && idx.hent(t.kategori) ? idx.type(t.kategori) : 'utgift';
    if (type === 'overforing' || type === 'noytral') continue;
    if (type === 'utgift' && t.belop > 0) continue; // refusjoner o.l.
    const n = normaliser(t.tekst);
    if (!n) continue;
    const nokkel = `${type}|${n}`;
    if (!grupper.has(nokkel)) grupper.set(nokkel, []);
    grupper.get(nokkel).push(t);
  }
  const ut = [];
  const FASTE_HOVED = new Set(['bolig', 'lan', 'forsikring', 'abonnement', 'skatt']);
  for (const [nokkel, trans] of grupper) {
    const type = nokkel.split('|')[0];
    // Steder man handler hos mange ganger i måneden (dagligvare, drivstoff, kantine) er ikke faste trekk
    const aktiveMnd = new Set(trans.map((t) => mndNr(t.dato))).size;
    if (trans.length / aktiveMnd > 4.5) continue;
    const klynger = type === 'inntekt' ? [trans] : klyngeBelop(trans);
    for (const klynge of klynger) {
      // én forekomst per måned (flere trekk samme måned slås sammen)
      const perMnd = new Map();
      for (const t of klynge) {
        const m = mndNr(t.dato);
        if (!perMnd.has(m)) perMnd.set(m, []);
        perMnd.get(m).push(t);
      }
      const mnder = [...perMnd.keys()].sort((a, b) => a - b);
      if (mnder.length < 3) continue;
      const gap = median(mnder.slice(1).map((m, i) => m - mnder[i]));
      const intervall = [1, 2, 3, 6, 12].reduce((best, x) => (Math.abs(x - gap) < Math.abs(best - gap) ? x : best), 1);
      // Regelmessighet: de fleste mellomrommene skal være like intervallet
      const regelmessige = mnder.slice(1).filter((m, i) => Math.abs(m - mnder[i] - intervall) <= (intervall === 1 ? 0 : 1)).length;
      if (regelmessige < Math.max(2, Math.floor((mnder.length - 1) * 0.6))) continue;
      if (type !== 'inntekt' && klynge.length / mnder.length > 1.5) continue;
      const sortert = [...klynge].sort((a, b) => a.dato.localeCompare(b.dato));
      const belopPerForekomst = mnder.map((m) => perMnd.get(m).reduce((s, t) => s + t.belop, 0));
      // Faste trekk har stabilt beløp; lån, forsikring, bolig o.l. får større slingringsmonn
      const hoved = (klynge[0].kategori || '').split('/')[0];
      const grense = FASTE_HOVED.has(hoved) || klynge[0].kategori === 'bil/bompenger' ? 0.5 : 0.06;
      if (type !== 'inntekt') {
        const siste = sortert.slice(-4).map((t) => Math.abs(t.belop));
        const spredning = (Math.max(...siste) - Math.min(...siste)) / Math.max(1, median(siste));
        if (spredning > grense) continue;
      }
      const siste = sortert[sortert.length - 1];
      const sisteBelop = belopPerForekomst[belopPerForekomst.length - 1];
      const tidligere = belopPerForekomst.slice(0, -1);
      const typisk = median(belopPerForekomst.slice(-3));
      let endring = null;
      if (tidligere.length >= 2) {
        const før = median(tidligere.slice(-3));
        if (Math.abs(sisteBelop - før) > Math.max(5, Math.abs(før) * 0.03)) endring = { fra: før, til: sisteBelop, dato: siste.dato };
      }
      const dag = Math.round(median(sortert.slice(-3).map((t) => Number(t.dato.slice(8, 10)))));
      const sisteMnd = mnder[mnder.length - 1];
      const neste = fraMndNr(sisteMnd + intervall, dag);
      const forsinket = mndNr(sisteDato) - sisteMnd > intervall + (intervall === 1 ? 1 : 2);
      const alias = new Map();
      for (const t of klynge) alias.set(t.tekst, (alias.get(t.tekst) || 0) + 1);
      const kategorier = new Map();
      for (const t of klynge) kategorier.set(t.kategori, (kategorier.get(t.kategori) || 0) + 1);
      ut.push({
        id: `${nokkel}|${Math.round(Math.abs(typisk))}`,
        navn: [...alias.entries()].sort((a, b) => b[1] - a[1])[0][0],
        type,
        kategori: [...kategorier.entries()].sort((a, b) => b[1] - a[1])[0][0] || '',
        konto: siste.konto,
        intervall,
        frekvens: FREKVENS[intervall],
        belop: typisk, // med fortegn
        perMnd: typisk / intervall,
        perAar: (typisk * 12) / intervall,
        antall: mnder.length,
        forste: sortert[0].dato,
        sist: siste.dato,
        neste,
        dag,
        endring,
        stoppet: forsinket,
      });
    }
  }
  return ut.sort((a, b) => a.perAar - b.perAar);
}

export function oppsummerFaste(poster) {
  const aktive = poster.filter((p) => !p.stoppet);
  const sum = (liste) => liste.reduce((s, p) => s + p.perMnd, 0);
  return {
    utgifterPerMnd: -sum(aktive.filter((p) => p.type === 'utgift')),
    inntekterPerMnd: sum(aktive.filter((p) => p.type === 'inntekt')),
    sparingPerMnd: -sum(aktive.filter((p) => p.type === 'sparing')),
    prisendringer: aktive.filter((p) => p.endring && p.type === 'utgift' && p.endring.til < p.endring.fra),
    stoppet: poster.filter((p) => p.stoppet),
  };
}
