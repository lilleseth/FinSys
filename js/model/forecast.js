// Kontantstrømprognose: faste poster + snittforbruk (eller budsjett) + planlagte poster.

import { kategoriIndeks } from './categories.js';
import { fastePoster } from './recurring.js';
import { mndSammendrag, manederMedData, flyttMnd, mndTekst } from './report.js';
import { verdiPa, sum } from './calc.js';

// Likvide midler nå: bankkontoer med siste registrerte saldo + transaksjoner etter den datoen.
export function likvideNa(db) {
  let total = 0;
  const detaljer = [];
  for (const p of db.formue.poster) {
    if (p.side !== 'eiendel' || p.type !== 'bank') continue;
    const v = verdiPa(p);
    if (!v) continue;
    const etter = p.kontoId ? sum(db.transaksjoner.filter((t) => t.konto === p.kontoId && t.dato > v.dato).map((t) => t.belop)) : 0;
    total += v.verdi + etter;
    detaljer.push({ navn: p.navn, saldo: v.verdi + etter, dato: v.dato, justert: etter });
  }
  return { total, detaljer };
}

export function prognose(db, { maneder = 12, kilde = 'snitt' } = {}) {
  const idx = kategoriIndeks(db.kategorier);
  const alle = manederMedData(db);
  if (!alle.length) return null;
  const sisteData = alle[alle.length - 1];
  const start = flyttMnd(sisteData, 1);
  const historikk = alle.slice(-6).map((m) => mndSammendrag(db, m, 'betalt', idx));
  const faste = fastePoster(db).filter((p) => !p.stoppet);

  // Fast del per hovedkategori (snitt per måned), for å finne den variable delen
  const fastPerHoved = new Map();
  for (const p of faste.filter((x) => x.type === 'utgift')) {
    const h = (p.kategori || '').split('/')[0];
    fastPerHoved.set(h, (fastPerHoved.get(h) || 0) + -p.perMnd);
  }
  const variabelPerHoved = new Map();
  // Skatt (restskatt) er engangsposter og legges inn som planlagte poster i stedet
  for (const k of db.kategorier.filter((x) => x.type === 'utgift' && x.id !== 'skatt')) {
    const snitt = historikk.length ? -sum(historikk.map((s) => s.perHoved.get(k.id) || 0)) / historikk.length : 0;
    const budsjett = db.budsjett?.poster?.[k.id];
    const grunnlag = kilde === 'budsjett' && budsjett != null ? budsjett : snitt;
    const variabel = Math.max(0, grunnlag - (fastPerHoved.get(k.id) || 0));
    if (variabel >= 1) variabelPerHoved.set(k.id, variabel);
  }
  const ukategorisertSnitt = historikk.length ? Math.max(0, -sum(historikk.map((s) => s.perHoved.get('') || 0)) / historikk.length) : 0;
  const variabelTotal = sum([...variabelPerHoved.values()]) + ukategorisertSnitt;

  const planlagt = db.planlagt || [];
  const { total: startSaldo, detaljer: saldoDetaljer } = likvideNa(db);
  const buffer = db.innstillinger?.minstesaldo ?? db.innstillinger?.nodvendigeUtgifterPerMnd ?? 0;
  const rader = [];
  let saldo = startSaldo;
  for (let i = 0; i < maneder; i++) {
    const mnd = flyttMnd(start, i);
    const mndNr = Number(mnd.slice(0, 4)) * 12 + Number(mnd.slice(5, 7)) - 1;
    const iMnd = (p) => {
      const n = Number(p.neste.slice(0, 4)) * 12 + Number(p.neste.slice(5, 7)) - 1;
      return mndNr >= n && (mndNr - n) % p.intervall === 0;
    };
    const inntekter = sum(faste.filter((p) => p.type === 'inntekt' && iMnd(p)).map((p) => p.belop));
    const fasteUt = -sum(faste.filter((p) => p.type === 'utgift' && iMnd(p)).map((p) => p.belop));
    const sparing = -sum(faste.filter((p) => p.type === 'sparing' && iMnd(p)).map((p) => p.belop));
    const plan = planlagt.filter((p) => p.mnd === mnd);
    const planSum = sum(plan.map((p) => p.belop));
    const netto = inntekter - fasteUt - variabelTotal - sparing + planSum;
    saldo += netto;
    rader.push({ mnd, navn: mndTekst(mnd), inntekter, faste: fasteUt, variable: variabelTotal, sparing, planlagt: planSum, planListe: plan, netto, saldo, under: saldo < buffer });
  }
  return {
    start, sisteData, startSaldo, saldoDetaljer, buffer, kilde,
    variabelPerHoved: [...variabelPerHoved.entries()].map(([id, v]) => ({ id, navn: idx.hoved.get(id)?.navn || id, belop: v })).sort((a, b) => b.belop - a.belop),
    fasteUtPerMnd: -sum(faste.filter((p) => p.type === 'utgift').map((p) => p.perMnd)),
    inntektPerMnd: sum(faste.filter((p) => p.type === 'inntekt').map((p) => p.perMnd)),
    variabelTotal,
    rader,
    forsteUnder: rader.find((r) => r.under) || null,
    laveste: rader.reduce((m, r) => (r.saldo < m.saldo ? r : m), rader[0]),
    historikkMnd: historikk.length,
  };
}
