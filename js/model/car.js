// Bilkostnad: drift fra transaksjoner + renter på billån + forsikring + verditap, per år, måned og km.

import { verdiPa, sum } from './calc.js';
import { kategoriIndeks } from './categories.js';

const IKKE_BIL = new Set(['bil/kollektiv', 'bil/hobby']);
const dager = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

export function bilkostnad(db, { aar } = {}) {
  const b = db.bil || {};
  const biler = db.formue.poster.filter((p) => p.side === 'eiendel' && p.type === 'kjoretoy');
  const bil = biler.find((p) => p.id === b.postId) || biler[0] || null;
  const idx = kategoriIndeks(db.kategorier);
  const bilTrans = db.transaksjoner.filter((t) => t.kategori?.startsWith('bil/') && !IKKE_BIL.has(t.kategori));
  const aarListe = [...new Set(bilTrans.map((t) => (t.betalt || t.dato).slice(0, 4)))].sort();
  const valgtAar = String(aar || aarListe.at(-1) || new Date().getFullYear());
  const iAar = bilTrans.filter((t) => (t.betalt || t.dato).startsWith(valgtAar));
  const alleMnd = new Set(db.transaksjoner.filter((t) => (t.betalt || t.dato).startsWith(valgtAar)).map((t) => (t.betalt || t.dato).slice(0, 7)));
  const maneder = Math.max(1, alleMnd.size);
  const skala = 12 / maneder;

  const perKat = new Map();
  for (const t of iAar) perKat.set(t.kategori, (perKat.get(t.kategori) || 0) - t.belop);
  const drift = [...perKat.entries()].map(([id, v]) => ({ navn: idx.hent(id)?.navn || id, belop: v * skala }));

  // Renter på billån (saldo ved årets slutt × rente)
  const renter = sum(db.formue.poster.filter((p) => p.side === 'gjeld' && p.type === 'billan').map((p) => (verdiPa(p, `${valgtAar}-12-31`)?.verdi || 0) * (p.rente || 0)));

  // Verditap: registrert sats, ellers fra verdihistorikken, ellers 12 %
  const verdi = bil ? verdiPa(bil, `${valgtAar}-12-31`)?.verdi || 0 : 0;
  let verditap;
  let verditapKilde = 'sats';
  let verditapSats = b.verditapProsent ?? 0.12;
  const hist = (bil?.verdier || []).filter((v) => v.verdi > 0).sort((a, c) => a.dato.localeCompare(c.dato));
  if (b.verditapProsent == null && hist.length >= 2 && dager(hist[0].dato, hist.at(-1).dato) >= 180) {
    const d = dager(hist[0].dato, hist.at(-1).dato);
    verditap = Math.max(0, ((hist[0].verdi - hist.at(-1).verdi) / d) * 365);
    verditapSats = hist[0].verdi ? verditap / hist[0].verdi : 0;
    verditapKilde = 'verdier';
  } else {
    verditap = verdi * verditapSats;
  }

  const forsikring = b.forsikringPerAar || 0;
  const kontantAar = sum(drift.map((x) => x.belop)) + forsikring;
  const totalAar = kontantAar + renter + verditap;

  // Kilometer per år fra km-stander
  const km = (b.kmstand || []).slice().sort((a, c) => a.dato.localeCompare(c.dato));
  const kmPerAar = km.length >= 2 && dager(km[0].dato, km.at(-1).dato) >= 30 ? ((km.at(-1).km - km[0].km) / dager(km[0].dato, km.at(-1).dato)) * 365 : null;

  const poster = [
    ...drift,
    { navn: 'Renter billån', belop: renter },
    { navn: 'Forsikring', belop: forsikring },
    { navn: 'Verditap', belop: verditap },
  ].sort((a, c) => c.belop - a.belop);

  return {
    bil, aar: valgtAar, aarListe: aarListe.length ? aarListe : [valgtAar], maneder,
    poster, renter, verditap, verditapKilde, verditapSats, forsikring, forsikringFunnet: null,
    kontantAar, totalAar, perMnd: totalAar / 12, kmPerAar, perKm: kmPerAar ? totalAar / kmPerAar : null,
  };
}
