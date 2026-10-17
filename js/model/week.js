// Ukentlig oppsummering (etter kjøpsdato): forbruk mot snittuke, kategorier, største kjøp og hva som kommer.

import { kategoriIndeks } from './categories.js';
import { sum } from './calc.js';
import { fastePoster } from './recurring.js';
import { normaliser } from './rules.js';

const DAG = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export function mandag(dato) {
  const d = new Date(Date.parse(dato));
  return iso(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAG);
}

export function ukenummer(dato) {
  const d = new Date(Date.parse(dato));
  const torsdag = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * DAG);
  const jan4 = new Date(Date.UTC(torsdag.getUTCFullYear(), 0, 4));
  return { aar: torsdag.getUTCFullYear(), uke: 1 + Math.round(((torsdag - jan4) / DAG - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7) };
}

export function ukerMedData(db) {
  return [...new Set(db.transaksjoner.map((t) => mandag(t.dato)))].sort();
}

// Siste hele uke med data (en påbegynt uke tas bare med hvis det ikke finnes en hel før den)
export function sisteUke(db) {
  const uker = ukerMedData(db);
  const sisteDato = db.transaksjoner.reduce((m, t) => (t.dato > m ? t.dato : m), '');
  const siste = uker.at(-1);
  if (siste && sisteDato < iso(Date.parse(siste) + 6 * DAG) && uker.length > 1) return uker.at(-2);
  return siste;
}

export function ukeSammendrag(db, start = sisteUke(db)) {
  if (!start) return null;
  const idx = kategoriIndeks(db.kategorier);
  const slutt = iso(Date.parse(start) + 6 * DAG);
  const type = (t) => (t.kategori && idx.hent(t.kategori) ? idx.type(t.kategori) : 'utgift');
  const iUka = (fra, til) => db.transaksjoner.filter((t) => t.dato >= fra && t.dato <= til && type(t) !== 'overforing');
  const denne = iUka(start, slutt);
  const forbruk = (liste) => -sum(liste.filter((t) => type(t) === 'utgift').map((t) => t.belop));

  // Snitt for de 8 foregående ukene
  const tidligere = [];
  for (let i = 1; i <= 8; i++) {
    const fra = iso(Date.parse(start) - i * 7 * DAG);
    const liste = iUka(fra, iso(Date.parse(fra) + 6 * DAG));
    if (liste.length) tidligere.push(liste);
  }
  const snitt = tidligere.length ? sum(tidligere.map(forbruk)) / tidligere.length : null;

  const perHoved = (liste) => {
    const m = new Map();
    for (const t of liste.filter((x) => type(x) === 'utgift')) {
      const h = (t.kategori && idx.hovedFor(t.kategori)?.id) || '';
      m.set(h, (m.get(h) || 0) - t.belop);
    }
    return m;
  };
  const naa = perHoved(denne);
  const forHoved = tidligere.map(perHoved);
  const kategorier = [...naa.entries()].map(([id, belop]) => {
    const s = forHoved.length ? sum(forHoved.map((m) => m.get(id) || 0)) / forHoved.length : null;
    return { id, navn: idx.hoved.get(id)?.navn || 'Ukategorisert', belop, snitt: s, avvik: s != null ? belop - s : null };
  }).sort((a, b) => b.belop - a.belop);

  const storste = denne.filter((t) => type(t) === 'utgift').sort((a, b) => a.belop - b.belop).slice(0, 5);
  const sett = new Set(db.transaksjoner.filter((t) => t.dato < start).map((t) => normaliser(t.tekst)));
  const nyeSteder = [...new Map(denne.filter((t) => t.belop < 0 && !sett.has(normaliser(t.tekst))).map((t) => [normaliser(t.tekst), t])).values()].slice(0, 5);

  // Kommende faste trekk neste 7 dager etter uka
  const fra = iso(Date.parse(slutt) + DAG);
  const til = iso(Date.parse(slutt) + 7 * DAG);
  const kommende = fastePoster(db).filter((p) => !p.stoppet && p.neste >= fra && p.neste <= til);

  // Budsjett-tempo i måneden uka slutter i
  const mnd = slutt.slice(0, 7);
  const dagNr = Number(slutt.slice(8, 10));
  const dagerIMnd = new Date(Date.UTC(Number(mnd.slice(0, 4)), Number(mnd.slice(5, 7)), 0)).getUTCDate();
  const budsjett = sum(Object.entries(db.budsjett?.poster || {}).filter(([id]) => idx.hoved.get(id)?.type === 'utgift' || idx.type(id) === 'utgift').map(([, b]) => b));
  const brukt = forbruk(db.transaksjoner.filter((t) => t.dato >= `${mnd}-01` && t.dato <= slutt && type(t) !== 'overforing'));
  const tempo = budsjett ? { budsjett, brukt, forventet: budsjett * (dagNr / dagerIMnd), andel: brukt / budsjett } : null;

  const u = ukenummer(start);
  return {
    start, slutt, uke: u.uke, aar: u.aar, navn: `Uke ${u.uke} ${u.aar}`,
    antall: denne.length,
    forbruk: forbruk(denne),
    inntekt: sum(denne.filter((t) => type(t) === 'inntekt').map((t) => t.belop)),
    snitt, ukerISnitt: tidligere.length,
    kategorier, storste, nyeSteder, kommende, tempo,
    ukategorisert: denne.filter((t) => !t.kategori).length,
  };
}
