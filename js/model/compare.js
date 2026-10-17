// Sammenligning mellom år: nøkkeltall og kategorier for hele år eller samme periode (f.eks. jan–sep).

import { kategoriIndeks } from './categories.js';
import { mndSammendrag, manederMedData } from './report.js';
import { sum, MND_NAVN } from './calc.js';

const pad = (i) => String(i).padStart(2, '0');

export function aarMedTransaksjoner(db, grunnlag = 'betalt') {
  return [...new Set(manederMedData(db, grunnlag).map((m) => m.slice(0, 4)))].sort();
}

export function sammenlign(db, aarListe, { periode = 'samme', grunnlag = 'betalt' } = {}) {
  const idx = kategoriIndeks(db.kategorier);
  const aar = [...new Set(aarListe.map(String))].sort();
  const siste = aar.at(-1);
  const mndSiste = Math.max(0, ...manederMedData(db, grunnlag).filter((m) => m.startsWith(siste)).map((m) => Number(m.slice(5, 7))));
  const antallMnd = periode === 'samme' ? Math.max(1, mndSiste) : 12;

  const rader = aar.map((a) => {
    const mnder = Array.from({ length: antallMnd }, (_, i) => `${a}-${pad(i + 1)}`);
    const s = mnder.map((m) => mndSammendrag(db, m, grunnlag, idx));
    const perHoved = new Map();
    const perSub = new Map();
    for (const x of s) {
      for (const [id, v] of x.perHoved) perHoved.set(id, (perHoved.get(id) || 0) + v);
      for (const [id, v] of x.perSub) perSub.set(id, (perSub.get(id) || 0) + v);
    }
    const medData = s.filter((x) => x.antall).length;
    const inntekt = sum(s.map((x) => x.inntekt));
    const forbruk = sum(s.map((x) => x.forbruk));
    const netto = sum(s.map((x) => x.netto));
    const slipper = (db.inntekt?.lonnsslipper || []).filter((l) => mnder.includes(l.mnd));
    const snap = (db.formue.historikk || []).find((x) => x.mnd === `${a}-${pad(antallMnd)}` && x.nettoformue != null);
    const gjeld = snap?.grupper ? -sum(Object.values(snap.grupper).filter((v) => v < 0)) : null;
    return {
      aar: a, medData, inntekt, forbruk, netto,
      investert: -sum(s.map((x) => x.sparing)),
      sparerate: inntekt > 0 ? netto / inntekt : null,
      snittForbruk: medData ? forbruk / medData : null,
      perMnd: s.map((x) => x.forbruk),
      perHoved, perSub,
      lonnBrutto: slipper.length ? sum(slipper.map((l) => l.brutto || 0)) : null,
      skattetrekk: slipper.length ? -sum(slipper.map((l) => l.skattetrekk || 0)) : null,
      nettoformue: snap?.nettoformue ?? null,
      gjeld,
      utbytte: periode === 'hele' ? sum((db.formue.utbytte || []).filter((u) => String(u.aar) === a).map((u) => u.belop)) || null : null,
    };
  });

  // Kategorier: utgifter som positive tall, inntekter som positive tall
  const verdi = (r, id, type, sub = false) => {
    const v = (sub ? r.perSub : r.perHoved).get(id) || 0;
    return type === 'utgift' ? -v : v;
  };
  const kategorier = db.kategorier.filter((k) => ['utgift', 'inntekt'].includes(k.type)).map((k) => ({
    id: k.id, navn: k.navn, type: k.type,
    verdier: rader.map((r) => verdi(r, k.id, k.type)),
    under: k.under.map((u) => ({ id: u.id, navn: u.navn, verdier: rader.map((r) => verdi(r, u.id, k.type, true)) })).filter((u) => u.verdier.some((v) => Math.abs(v) >= 1)),
  })).filter((k) => k.verdier.some((v) => Math.abs(v) >= 1));
  const ukat = rader.map((r) => -(r.perHoved.get('') || 0));
  if (ukat.some((v) => Math.abs(v) >= 1)) kategorier.push({ id: '', navn: 'Ukategorisert', type: 'utgift', verdier: ukat, under: [] });

  // Største endringer siste år mot året før
  let endringer = [];
  if (rader.length >= 2) {
    endringer = kategorier.filter((k) => k.type === 'utgift').map((k) => {
      const na = k.verdier.at(-1);
      const for_ = k.verdier.at(-2);
      return { navn: k.navn, id: k.id, na, for_, diff: na - for_, pst: for_ > 0 ? (na - for_) / for_ : null };
    }).filter((x) => Math.abs(x.diff) >= 500).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 6);
  }

  const periodeTekst = antallMnd === 12 ? 'hele året' : antallMnd === 1 ? MND_NAVN[0].toLowerCase() : `${MND_NAVN[0].toLowerCase()}–${MND_NAVN[antallMnd - 1].toLowerCase()}`;
  return { aar, periode, antallMnd, mndSiste, periodeTekst, rader, kategorier, endringer, oppsummering: oppsummer(rader, endringer, periodeTekst) };
}

function oppsummer(rader, endringer, periodeTekst) {
  if (rader.length < 2) return '';
  const na = rader.at(-1);
  const for_ = rader.at(-2);
  const kr = (v) => Math.round(Math.abs(v)).toLocaleString('nb-NO');
  const pst = (a, b) => (b ? ` (${a >= b ? '+' : '−'}${Math.round(Math.abs((a - b) / b) * 100)} %)` : '');
  const deler = [];
  const df = na.forbruk - for_.forbruk;
  deler.push(`I ${periodeTekst} ${na.aar} brukte du ${kr(na.forbruk)} kr – ${kr(df)} kr ${df >= 0 ? 'mer' : 'mindre'} enn i samme periode ${for_.aar}${pst(na.forbruk, for_.forbruk)}.`);
  const di = na.inntekt - for_.inntekt;
  deler.push(`Inntektene ${di >= 0 ? 'økte' : 'gikk ned'} med ${kr(di)} kr${pst(na.inntekt, for_.inntekt)}, og du sparte ${kr(na.netto)} kr mot ${kr(for_.netto)} kr.`);
  if (na.sparerate != null && for_.sparerate != null) deler.push(`Sparerate ${Math.round(na.sparerate * 100)} % mot ${Math.round(for_.sparerate * 100)} %.`);
  const opp = endringer.filter((e) => e.diff > 0)[0];
  const ned = endringer.filter((e) => e.diff < 0)[0];
  if (opp) deler.push(`Størst økning: ${opp.navn.toLowerCase()} (+${kr(opp.diff)} kr).`);
  if (ned) deler.push(`Størst nedgang: ${ned.navn.toLowerCase()} (−${kr(ned.diff)} kr).`);
  return deler.join(' ');
}
