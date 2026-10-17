// Gjeldsplan: nedbetalingsplaner, scenarier og «nedbetale eller investere».

import { verdiPa } from './calc.js';
import { fastePoster } from './recurring.js';

const KATEGORI_FOR_TYPE = { studielan: 'lan/studielan', billan: 'lan/billan', boliglan: 'lan/boliglan', forbrukslan: 'lan/annet' };

// Simulerer nedbetaling måned for måned.
export function nedbetaling({ saldo, rente, termin = 0, ekstra = 0, gebyr = 0, maksMnd = 600 }) {
  let s = saldo;
  let totalRente = 0;
  let mnd = 0;
  const perAar = [];
  let aarRente = 0;
  let aarAvdrag = 0;
  while (s > 0.5 && mnd < maksMnd) {
    const r = (s * (rente || 0)) / 12;
    const betaling = termin + ekstra;
    const avdrag = Math.min(s, betaling - r - gebyr);
    if (avdrag <= 0) return { evig: true, renterPerMnd: r, maneder: Infinity, totalRente: Infinity, perAar };
    s -= avdrag;
    totalRente += r;
    aarRente += r;
    aarAvdrag += avdrag;
    mnd++;
    if (mnd % 12 === 0 || s <= 0.5) {
      perAar.push({ aar: Math.ceil(mnd / 12), renter: aarRente, avdrag: aarAvdrag, saldo: Math.max(0, s) });
      aarRente = 0;
      aarAvdrag = 0;
    }
  }
  return { evig: false, maneder: mnd, totalRente, perAar };
}

export function sluttdato(maneder, fra = new Date()) {
  if (!Number.isFinite(maneder)) return null;
  const d = new Date(Date.UTC(fra.getFullYear(), fra.getMonth() + maneder, 1));
  return d.toISOString().slice(0, 7);
}

// Henter lånene med saldo, rente og terminbeløp (registrert, eller funnet blant faste trekk).
export function laan(db) {
  const faste = fastePoster(db).filter((p) => !p.stoppet && p.type === 'utgift');
  const fradrag = db.innstillinger?.skatt?.rentefradrag ?? 0.22;
  return db.formue.poster.filter((p) => p.side === 'gjeld').map((p) => {
    const v = verdiPa(p);
    const kat = KATEGORI_FOR_TYPE[p.type];
    const funnet = kat ? faste.filter((f) => f.kategori === kat).sort((a, b) => a.belop - b.belop)[0] : null;
    const termin = p.terminbelop ?? (funnet ? -funnet.belop : 0);
    return {
      post: p,
      navn: p.navn,
      type: p.type,
      saldo: v?.verdi ?? 0,
      dato: v?.dato,
      rente: p.rente ?? 0,
      nettoRente: (p.rente ?? 0) * (1 - (p.rentefradrag ?? fradrag)),
      termin,
      terminKilde: p.terminbelop != null ? 'registrert' : funnet ? 'funnet i faste trekk' : 'ukjent',
      gebyr: p.gebyr ?? 0,
    };
  }).filter((l) => l.saldo > 0);
}

export function scenarier(l, ekstra = 0) {
  const base = nedbetaling({ saldo: l.saldo, rente: l.rente, termin: l.termin, gebyr: l.gebyr });
  const pluss1 = nedbetaling({ saldo: l.saldo, rente: l.rente + 0.01, termin: l.termin, gebyr: l.gebyr });
  const pluss2 = nedbetaling({ saldo: l.saldo, rente: l.rente + 0.02, termin: l.termin, gebyr: l.gebyr });
  const medEkstra = ekstra > 0 ? nedbetaling({ saldo: l.saldo, rente: l.rente, termin: l.termin, ekstra, gebyr: l.gebyr }) : null;
  return {
    base,
    pluss1: { ...pluss1, merkostnadPerMnd: (l.saldo * 0.01) / 12 },
    pluss2: { ...pluss2, merkostnadPerMnd: (l.saldo * 0.02) / 12 },
    medEkstra: medEkstra ? { ...medEkstra, sparteRenter: base.totalRente - medEkstra.totalRente, sparteMnd: base.maneder - medEkstra.maneder } : null,
  };
}

// Sammenligner sikker «avkastning» ved nedbetaling (netto rente) med forventet avkastning etter skatt.
export function nedbetaleEllerInvestere(lan, { forventetAvkastning = 0.07, skattAksjeinntekt = 0.3784 } = {}) {
  const etterSkatt = forventetAvkastning * (1 - skattAksjeinntekt);
  return lan
    .map((l) => ({ navn: l.navn, nettoRente: l.nettoRente, fordel: l.nettoRente - etterSkatt, anbefaling: l.nettoRente >= etterSkatt ? 'nedbetal' : 'invester' }))
    .sort((a, b) => b.nettoRente - a.nettoRente)
    .map((x) => ({ ...x, etterSkatt }));
}
