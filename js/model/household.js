// Felles husholdning: delte utgifter, fordeling mellom to personer og oppgjør.
// Dine delte utgifter kommer fra transaksjonene; partnerens registreres som utlegg.

import { kategoriIndeks } from './categories.js';
import { sum } from './calc.js';
import { flyttMnd } from './report.js';

export function husholdning(db) {
  db.husholdning ||= {};
  const hh = db.husholdning;
  hh.fordeling ||= 'fast';
  hh.minAndel ??= 0.5;
  hh.delteKategorier ||= ['bolig', 'mat/dagligvarer'];
  hh.delteKontoer ||= [];
  hh.utlegg ||= [];
  hh.oppgjor ||= [];
  return hh;
}

const mndAv = (t) => (t.betalt || t.dato).slice(0, 7);

// Er transaksjonen en delt utgift? Egen markering vinner over kategori og konto.
export function erDelt(t, hh, idx) {
  if (t.husOppgjor) return false;
  if (t.delt === true) return true;
  if (t.delt === false) return false;
  if (!t.kategori) return false;
  const type = idx.type(t.kategori);
  if (type !== 'utgift') return false;
  if (hh.delteKontoer.includes(t.konto)) return true;
  const hoved = t.kategori.split('/')[0];
  return hh.delteKategorier.includes(t.kategori) || hh.delteKategorier.includes(hoved);
}

// Din andel av felles utgifter (0–1)
export function minAndel(db, hh = husholdning(db)) {
  if (hh.fordeling !== 'inntekt') return hh.minAndel;
  const slipper = (db.inntekt?.lonnsslipper || []).slice(-3).map((l) => l.netto || 0).filter(Boolean);
  const min = hh.minInntekt || (slipper.length ? sum(slipper) / slipper.length : 0);
  const partner = hh.partnerInntekt || 0;
  return min + partner > 0 ? min / (min + partner) : 0.5;
}

export function oppgjorsoversikt(db) {
  const hh = husholdning(db);
  const idx = kategoriIndeks(db.kategorier);
  const andel = minAndel(db, hh);
  const delte = db.transaksjoner.filter((t) => erDelt(t, hh, idx) && (!hh.start || mndAv(t) >= hh.start));
  const betalinger = [
    ...db.transaksjoner.filter((t) => t.husOppgjor).map((t) => ({ dato: t.betalt || t.dato, belop: -t.belop, tekst: t.tekst, kilde: 'transaksjon', ref: t })),
    // belop > 0: du betalte partneren; < 0: partneren betalte deg
    ...hh.oppgjor.map((o) => ({ dato: o.dato, belop: o.retning === 'fraPartner' ? -o.belop : o.belop, tekst: o.tekst || 'Oppgjør', kilde: 'manuell', ref: o })),
  ].filter((b) => !hh.start || b.dato.slice(0, 7) >= hh.start);
  const utlegg = hh.utlegg.filter((u) => !hh.start || u.dato.slice(0, 7) >= hh.start);

  const maneder = [...new Set([...delte.map(mndAv), ...utlegg.map((u) => u.dato.slice(0, 7)), ...betalinger.map((b) => b.dato.slice(0, 7))])].sort();
  if (maneder.length) {
    // fyll hull
    const alle = [];
    for (let m = maneder[0]; m <= maneder[maneder.length - 1]; m = flyttMnd(m, 1)) alle.push(m);
    maneder.splice(0, maneder.length, ...alle);
  }
  let saldo = 0;
  const rader = maneder.map((mnd) => {
    const dine = delte.filter((t) => mndAv(t) === mnd);
    const du = -sum(dine.map((t) => t.belop));
    const partner = sum(utlegg.filter((u) => u.dato.startsWith(mnd)).map((u) => u.belop));
    const total = du + partner;
    const dinAndel = total * andel;
    const diff = du - dinAndel; // positiv: partneren skylder deg
    const betalt = sum(betalinger.filter((b) => b.dato.startsWith(mnd)).map((b) => b.belop));
    saldo += diff + betalt;
    return { mnd, du, partner, total, dinAndel, partnerAndel: total - dinAndel, diff, betalt, saldo, transaksjoner: dine };
  });

  const perKategori = (mnd) => {
    const m = new Map();
    for (const t of delte.filter((x) => !mnd || mndAv(x) === mnd)) {
      const k = idx.hovedFor(t.kategori)?.navn || 'Annet';
      m.set(k, (m.get(k) || 0) - t.belop);
    }
    for (const u of utlegg.filter((x) => !mnd || x.dato.startsWith(mnd))) {
      const k = (u.kategori && idx.hovedFor(u.kategori)?.navn) || 'Annet';
      m.set(k, (m.get(k) || 0) + u.belop);
    }
    return [...m.entries()].map(([navn, belop]) => ({ navn, belop })).sort((a, b) => b.belop - a.belop);
  };

  return { hh, andel, rader, saldo, delte, utlegg, betalinger, perKategori };
}
