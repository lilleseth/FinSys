// Skatteprognose for lønnstaker: beregnet skatt for året mot forskuddstrekk.
// Satsene kan overstyres under Innstillinger. Kontroller alltid mot skatteetaten.no.

import { formue, verdiPa, sum } from './calc.js';

export const SKATTESATSER = {
  2025: {
    kilde: 'Vedtatt 2025',
    alminnelig: 0.22,
    personfradrag: 108550,
    minstefradrag: { sats: 0.46, maks: 92000, min: 4000 },
    trygdeavgift: { sats: 0.077, grense: 99650, opptrapping: 0.25 },
    trinn: [[217400, 0.017], [306050, 0.04], [697150, 0.137], [942400, 0.167], [1410750, 0.177]],
    formue: { bunnfradrag: 1760000, sats: 0.01, hoyGrense: 20700000, hoySats: 0.011, aksjerabatt: 0.2 },
    oppjustering: 1.72,
    fagforeningMaks: 8250,
    bsu: { sats: 0.1, maks: 27500 },
  },
  2026: {
    kilde: 'Statsbudsjettet 2026 etter budsjettforliket',
    alminnelig: 0.22,
    personfradrag: 114540,
    minstefradrag: { sats: 0.46, maks: 95700, min: 4000 },
    trygdeavgift: { sats: 0.076, grense: 99650, opptrapping: 0.25 },
    trinn: [[226100, 0.017], [318300, 0.04], [725050, 0.137], [980100, 0.168], [1467200, 0.178]],
    formue: { bunnfradrag: 1900000, sats: 0.01, hoyGrense: 21500000, hoySats: 0.011, aksjerabatt: 0.2 },
    oppjustering: 1.72,
    fagforeningMaks: 8250,
    bsu: { sats: 0.1, maks: 27500 },
  },
};

export function satserFor(db, aar) {
  const kjente = Object.keys(SKATTESATSER).map(Number).sort();
  const basis = SKATTESATSER[aar] || SKATTESATSER[kjente.filter((a) => a <= aar).pop() || kjente[0]];
  const overstyr = db.innstillinger?.skattesatser?.[aar];
  return overstyr ? { ...basis, ...overstyr, kilde: 'Egne satser' } : { ...basis, estimert: !SKATTESATSER[aar] };
}

export function trinnskatt(personinntekt, trinn) {
  let skatt = 0;
  for (let i = 0; i < trinn.length; i++) {
    const [fra, sats] = trinn[i];
    const til = trinn[i + 1]?.[0] ?? Infinity;
    if (personinntekt > fra) skatt += (Math.min(personinntekt, til) - fra) * sats;
  }
  return skatt;
}

export function trygdeavgift(personinntekt, t) {
  if (personinntekt <= t.grense) return 0;
  return Math.min(personinntekt * t.sats, (personinntekt - t.grense) * t.opptrapping);
}

const snitt = (a) => (a.length ? sum(a) / a.length : 0);

export function skatteprognose(db, aar) {
  const s = satserFor(db, aar);
  const egne = db.skatt?.[aar] || {};
  const slipper = (db.inntekt?.lonnsslipper || []).filter((l) => l.mnd.startsWith(String(aar))).sort((a, b) => a.mnd.localeCompare(b.mnd));
  const sisteMnd = slipper.length ? Number(slipper[slipper.length - 1].mnd.slice(5, 7)) : 0;
  const gjenstaende = 12 - sisteMnd;
  const bruttoHittil = sum(slipper.map((l) => l.brutto || 0));
  const trekkHittil = -sum(slipper.map((l) => l.skattetrekk || 0)) || 0;
  const siste3 = slipper.slice(-3);
  const snittBrutto = egne.snittBrutto ?? snitt(siste3.map((l) => l.brutto || 0));
  const snittTrekk = snitt(siste3.map((l) => -(l.skattetrekk || 0)));
  // Desember har normalt halv skatt
  const trekkMnd = gjenstaende > 0 ? gjenstaende - 0.5 : 0;
  const bruttoAar = bruttoHittil + snittBrutto * gjenstaende;
  const trekkLonnAar = trekkHittil + snittTrekk * trekkMnd;

  // Renteutgifter: registrert overstyring, ellers saldo × rente for alle lån
  const rentePoster = db.formue.poster.filter((p) => p.side === 'gjeld' && p.rente).map((p) => {
    const v = verdiPa(p, `${aar}-12-31`);
    return { navn: p.navn, renter: (v?.verdi || 0) * p.rente };
  });
  const renteutgifter = egne.renteutgifter ?? sum(rentePoster.map((r) => r.renter));

  // Fagforening: transaksjoner i året som ser ut som fagforeningskontingent
  const fagTrans = db.transaksjoner.filter((t) => (t.betalt || t.dato || '').startsWith(String(aar)) && t.belop < 0 && /forbund|fagforening|\bnito\b|\btekna\b|parat\b|\bdelta\b|negotia|\blo\b/i.test(t.tekst));
  const fagforening = Math.min(s.fagforeningMaks, egne.fagforening ?? (-sum(fagTrans.map((t) => t.belop)) || 0));

  const andreInntekter = egne.andreInntekter || 0;
  const andreTrekk = egne.andreTrekk || 0;
  const renteinntekter = egne.renteinntekter || 0;
  const aksjeinntekt = egne.aksjeinntekt || 0;
  const andreFradrag = egne.andreFradrag || 0;
  const bsuSparing = Math.min(s.bsu.maks, egne.bsu || 0);

  const personinntekt = bruttoAar + andreInntekter;
  const minstefradrag = Math.min(s.minstefradrag.maks, Math.max(s.minstefradrag.min, personinntekt * s.minstefradrag.sats));
  const alminneligInntekt = personinntekt - minstefradrag - renteutgifter - fagforening - andreFradrag + renteinntekter + aksjeinntekt * s.oppjustering;
  const skattAlminnelig = Math.max(0, alminneligInntekt - s.personfradrag) * s.alminnelig;
  const trygd = trygdeavgift(personinntekt, s.trygdeavgift);
  const trinn = trinnskatt(personinntekt, s.trinn);

  // Formuesskatt med årets satser
  const f = formue(db, `${aar}-12-31`);
  let skattemessig = 0;
  for (const x of f.eiendeler) {
    if (x.verdi == null) continue;
    const p = x.post;
    if (p.type === 'pensjon') continue;
    let v = p.type === 'kjoretoy' && p.skattemessigVerdi != null ? p.skattemessigVerdi : x.verdi;
    if (['fond', 'aksjer', 'selskap'].includes(p.type)) v *= 1 - s.formue.aksjerabatt;
    if (p.type === 'bolig') v *= 1 - (p.boligRabatt ?? 0.75);
    skattemessig += v;
  }
  const nettoFormue = skattemessig - f.sumGjeld;
  const formuesskatt = Math.max(0, Math.min(nettoFormue, s.formue.hoyGrense) - s.formue.bunnfradrag) * s.formue.sats
    + Math.max(0, nettoFormue - s.formue.hoyGrense) * (s.formue.hoySats - s.formue.sats);

  const bsuFradrag = bsuSparing * s.bsu.sats;
  const sumSkatt = skattAlminnelig + trygd + trinn + formuesskatt - bsuFradrag;
  const trukket = trekkLonnAar + andreTrekk;
  const differanse = sumSkatt - trukket; // positiv = restskatt
  const ekstraTrekkProsent = differanse > 0 && gjenstaende > 0 && snittBrutto > 0 ? differanse / (snittBrutto * gjenstaende) : null;

  return {
    aar, satser: s, egne,
    slipper: slipper.length, sisteMnd, gjenstaende,
    bruttoHittil, trekkHittil, snittBrutto, snittTrekk, bruttoAar, trekkLonnAar,
    rentePoster, renteutgifter, fagforening, fagTrans: fagTrans.length,
    andreInntekter, andreTrekk, renteinntekter, aksjeinntekt, andreFradrag, bsuSparing,
    personinntekt, minstefradrag, alminneligInntekt, skattAlminnelig, trygd, trinn,
    nettoFormue, formuesskatt, bsuFradrag, sumSkatt, trukket, differanse,
    effektivSats: personinntekt > 0 ? sumSkatt / personinntekt : null,
    ekstraTrekkProsent,
  };
}
