// Nettoformue-mål: prognose ut fra trend og ut fra sparing + avkastning, og milepæler.

import { formue, sum, INVESTERING } from './calc.js';
import { mndSammendrag, manederMedData, flyttMnd } from './report.js';
import { kategoriIndeks } from './categories.js';

const mndNr = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

export function nettoformuePrognose(db, { avkastning = 0.06 } = {}) {
  const f = formue(db);
  const na = f.netto;
  const naMnd = (f.sisteDato || new Date().toISOString()).slice(0, 7);
  const investert = sum(f.eiendeler.filter((x) => INVESTERING.has(x.post.type) || x.post.type === 'pensjon').map((x) => x.verdi || 0));

  // Trend: endring per måned fra formueshistorikken (siste 12 mnd)
  const hist = (db.formue.historikk || []).filter((x) => x.nettoformue != null && x.komplett !== false).sort((a, b) => a.mnd.localeCompare(b.mnd));
  const punkter = [...hist.map((x) => ({ mnd: x.mnd, verdi: x.nettoformue }))];
  if (!punkter.some((p) => p.mnd === naMnd)) punkter.push({ mnd: naMnd, verdi: na });
  const siste = punkter.filter((p) => mndNr(p.mnd) >= mndNr(naMnd) - 12);
  const trend = siste.length >= 2 ? (siste.at(-1).verdi - siste[0].verdi) / Math.max(1, mndNr(siste.at(-1).mnd) - mndNr(siste[0].mnd)) : null;

  // Sparing: snitt netto kontantstrøm siste 12 måneder
  const idx = kategoriIndeks(db.kategorier);
  const mnd = manederMedData(db).slice(-12).map((m) => mndSammendrag(db, m, 'betalt', idx));
  const sparing = mnd.length ? sum(mnd.map((x) => x.netto)) / mnd.length : 0;

  const simuler = (mal, metode) => {
    if (na >= mal) return { mnd: naMnd, maneder: 0 };
    let v = na;
    let inv = investert;
    for (let i = 1; i <= 600; i++) {
      if (metode === 'trend') {
        if (!trend || trend <= 0) return null;
        v += trend;
      } else {
        const vekst = inv * (avkastning / 12);
        inv += vekst + Math.max(0, sparing);
        v += vekst + sparing;
      }
      if (v >= mal) return { mnd: flyttMnd(naMnd, i), maneder: i };
    }
    return null;
  };

  const steg = na < 1e6 ? 250000 : na < 5e6 ? 500000 : 1e6;
  const forste = Math.floor(na / steg) * steg + steg;
  const milepaler = [0, 1, 2, 3].map((i) => forste + i * steg);

  return { na, naMnd, investert, trend, sparing, avkastning, punkter, simuler, milepaler };
}
