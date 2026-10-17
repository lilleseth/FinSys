// Innsikt: hvor kom formueendringen fra, stresstest av belåning, skjulte kostnader og uvanlige transaksjoner.

import { formue, verdiPa, sum, INVESTERING } from './calc.js';
import { kategoriIndeks } from './categories.js';
import { fastePoster, oppsummerFaste } from './recurring.js';
import { normaliser } from './rules.js';
import { utleggsoversikt } from './outlays.js';

const dagerMellom = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// ---------- Hvor kom formueendringen fra? ----------
// Identitet: Δnettoformue = Δbank + innskudd + avkastning + nedbetaling + Δpensjon + Δkjøretøy + Δannet,
// der avkastning = Δ(aksjer/fond) − innskudd − økning i verdipapirkreditt.

export const ENDRING_DELER = [
  ['bank', 'Bank og kontanter', 'sparing'],
  ['innskudd', 'Nye innskudd i aksjer og fond', 'sparing'],
  ['nedbetaling', 'Nedbetaling av lån', 'sparing'],
  ['avkastning', 'Avkastning aksjer og fond (etter kreditt)', 'marked'],
  ['pensjon', 'Pensjon (innskudd og avkastning)', 'marked'],
  ['kjoretoy', 'Kjøretøy (verdiendring)', 'verdi'],
  ['annet', 'Selskap og annet', 'verdi'],
];

function punkter(db) {
  const hist = (db.formue.historikk || [])
    .filter((x) => x.nettoformue != null && x.komplett !== false && x.grupper)
    .map((x) => ({ dato: x.dato, navn: x.mnd, g: x.grupper, netto: x.nettoformue }))
    .sort((a, b) => a.dato.localeCompare(b.dato));
  const f = formue(db);
  if (f.sisteDato && (!hist.length || f.sisteDato > hist.at(-1).dato) && f.poster.every((x) => x.verdi != null || x.post.type === 'krypto')) {
    hist.push({ dato: f.sisteDato, navn: 'nå', g: f.grupper, netto: f.netto });
  }
  return hist;
}

export function formueendring(db) {
  const p = punkter(db);
  const g = (x, k) => x.g?.[k] || 0;
  const perioder = [];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    const innskudd = -sum(db.transaksjoner.filter((t) => t.kategori?.startsWith('sparing/') && t.dato > a.dato && t.dato <= b.dato).map((t) => t.belop));
    const d = (k) => g(b, k) - g(a, k);
    const deler = {
      bank: d('bank'),
      innskudd,
      nedbetaling: d('billan') + d('studielan') + d('annenGjeld'),
      avkastning: d('aksjerFond') - innskudd + d('kreditt'),
      pensjon: d('pensjon'),
      kjoretoy: d('kjoretoy'),
      annet: d('selskap') + d('annet'),
    };
    perioder.push({ fra: a.dato, til: b.dato, endring: b.netto - a.netto, deler, kredittEndring: -d('kreditt') });
  }
  const total = Object.fromEntries(ENDRING_DELER.map(([k]) => [k, sum(perioder.map((x) => x.deler[k]))]));
  const grupper = { sparing: 0, marked: 0, verdi: 0 };
  for (const [k, , gr] of ENDRING_DELER) grupper[gr] += total[k];
  return { perioder, total, grupper, endring: sum(perioder.map((x) => x.endring)), fra: p[0]?.dato, til: p.at(-1)?.dato };
}

// ---------- Stresstest av belåning ----------

export const STANDARD_BELANING = { fond: 0.7, aksjer: 0.5, kontanter: 1 };

export function belaning(db, fall = [0.1, 0.2, 0.3, 0.4, 0.5]) {
  const kreditter = db.formue.poster.filter((p) => p.side === 'gjeld' && p.type === 'kreditt');
  const depoter = kreditter.map((k) => {
    const saldo = verdiPa(k)?.verdi || 0;
    const poster = db.formue.poster.filter((p) => p.side === 'eiendel' && INVESTERING.has(p.type) && p.gruppe && p.gruppe === k.gruppe).map((p) => {
      const verdi = verdiPa(p)?.verdi || 0;
      const grad = p.belaningsgrad ?? STANDARD_BELANING[p.type] ?? 0.5;
      return { post: p, verdi, grad, registrert: p.belaningsgrad != null, kontant: p.type === 'kontanter' };
    });
    const verdi = sum(poster.map((x) => x.verdi));
    const kontant = sum(poster.filter((x) => x.kontant).map((x) => x.verdi));
    const svingende = sum(poster.filter((x) => !x.kontant).map((x) => x.verdi * x.grad));
    const belaningsverdi = kontant + svingende;
    const maksFall = svingende > 0 ? Math.max(0, Math.min(1, 1 - (saldo - kontant) / svingende)) : null;
    const scenarier = fall.map((f) => {
      const bv = kontant + svingende * (1 - f);
      const nyVerdi = kontant + sum(poster.filter((x) => !x.kontant).map((x) => x.verdi)) * (1 - f);
      return { fall: f, verdi: nyVerdi, belaningsverdi: bv, grad: nyVerdi ? saldo / nyVerdi : null, mangler: Math.max(0, saldo - bv) };
    });
    return {
      navn: k.gruppe || k.navn, kreditt: k, saldo, rente: k.rente || 0, renterAar: saldo * (k.rente || 0),
      poster, verdi, belaningsverdi, buffer: belaningsverdi - saldo,
      grad: verdi ? saldo / verdi : null, utnyttelse: belaningsverdi ? saldo / belaningsverdi : null,
      maksFall, scenarier, anslag: poster.some((x) => !x.registrert && !x.kontant),
    };
  });
  const f = formue(db);
  const eksponering = sum(f.eiendeler.filter((x) => ['fond', 'aksjer'].includes(x.post.type)).map((x) => x.verdi || 0));
  const totalKreditt = sum(depoter.map((d) => d.saldo));
  const totalt = fall.map((fa) => ({
    fall: fa,
    tap: eksponering * fa,
    nettoformue: f.netto - eksponering * fa,
    mangler: sum(depoter.map((d) => d.scenarier.find((s) => s.fall === fa)?.mangler || 0)),
  }));
  return { depoter, eksponering, totalKreditt, nettoformue: f.netto, totalt, renterAar: sum(depoter.map((d) => d.renterAar)) };
}

// ---------- Skjulte kostnader ----------

const GEBYR = /gebyr|omkostning|årspris|arspris|årsavgift|kortavgift|purr|inkasso|forsinkelsesrente|overtrekk|termingebyr|etableringsgebyr/i;
export const STANDARD_VALUTAPASLAG = 0.0175;

export function skjulteKostnader(db, aar = new Date().getFullYear()) {
  const iAar = (t) => (t.betalt || t.dato).startsWith(String(aar));
  const T = db.transaksjoner.filter(iAar);
  const konto = new Map(db.kontoer.map((k) => [k.id, k]));

  const gebyrTrans = T.filter((t) => t.belop < 0 && (t.kategori === 'diverse/gebyrer' || GEBYR.test(`${t.tekst} ${t.detaljer || ''}`)) && !t.kategori?.startsWith('lan/'));
  const gebyrPer = new Map();
  for (const t of gebyrTrans) {
    const k = `${konto.get(t.konto)?.navn || t.konto}: ${t.tekst}`;
    gebyrPer.set(k, (gebyrPer.get(k) || 0) - t.belop);
  }

  const lan = db.formue.poster.filter((p) => p.side === 'gjeld' && p.rente).map((p) => {
    const saldo = verdiPa(p, `${aar}-12-31`)?.verdi || 0;
    const fradrag = p.rentefradrag ?? db.innstillinger?.skatt?.rentefradrag ?? 0.22;
    return { navn: p.navn, saldo, rente: p.rente, renter: saldo * p.rente, netto: saldo * p.rente * (1 - fradrag), gebyr: (p.gebyr || 0) * 12 };
  });

  const valuta = new Map();
  for (const t of T.filter((x) => x.belop < 0 && /@\s*[\d.,]+/.test(x.detaljer || ''))) {
    const v = valuta.get(t.konto) || { konto: t.konto, navn: konto.get(t.konto)?.navn || t.konto, belop: 0, antall: 0, valutaer: new Set() };
    v.belop += -t.belop;
    v.antall++;
    const m = (t.detaljer || '').match(/([A-Z]{3})\s*@/);
    if (m) v.valutaer.add(m[1]);
    valuta.set(t.konto, v);
  }
  const valutaListe = [...valuta.values()].map((v) => {
    const sats = db.innstillinger?.valutapaslag?.[v.konto] ?? STANDARD_VALUTAPASLAG;
    return { ...v, valutaer: [...v.valutaer], sats, paslag: (v.belop * sats) / (1 + sats) };
  });

  const fond = db.formue.poster.filter((p) => p.side === 'eiendel' && ['fond', 'pensjon'].includes(p.type)).map((p) => {
    const verdi = verdiPa(p)?.verdi || 0;
    return { post: p, navn: p.navn, verdi, sats: p.kostnadProsent ?? null, kostnad: p.kostnadProsent != null ? verdi * p.kostnadProsent : null };
  });

  const manuelt = db.kostnader?.[aar] || {};
  const deler = [
    { id: 'gebyr', navn: 'Bank- og kortgebyrer', belop: sum([...gebyrPer.values()]) },
    { id: 'renter', navn: 'Renter på lån og kreditt (etter fradrag)', belop: sum(lan.map((l) => l.netto)) },
    { id: 'lanegebyr', navn: 'Termingebyrer på lån', belop: sum(lan.map((l) => l.gebyr)) },
    { id: 'valuta', navn: 'Valutapåslag på kort (anslag)', belop: sum(valutaListe.map((v) => v.paslag)) },
    { id: 'fond', navn: 'Forvaltningskostnad fond og pensjon', belop: sum(fond.map((x) => x.kostnad || 0)) },
    { id: 'kurtasje', navn: 'Kurtasje og depotgebyr', belop: manuelt.kurtasje || 0 },
  ];
  return {
    aar, deler, total: sum(deler.map((d) => d.belop)),
    gebyrer: [...gebyrPer.entries()].map(([navn, belop]) => ({ navn, belop })).sort((a, b) => b.belop - a.belop),
    lan, valuta: valutaListe, fond, manuelt,
  };
}

// ---------- Uvanlige transaksjoner ----------

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function avvik(db, { idag = new Date().toISOString().slice(0, 10), dager = 120 } = {}) {
  const idx = kategoriIndeks(db.kategorier);
  const fra = new Date(Date.parse(idag) - dager * 86400000).toISOString().slice(0, 10);
  const nylig = db.transaksjoner.filter((t) => t.dato >= fra);
  const ut = [];
  const ignorert = db.ignorerteAvvik || {};
  const legg = (x) => { if (!ignorert[x.id]) ut.push(x); };

  // Mulige dobbeltbelastninger
  const grupper = new Map();
  // Bare kjøp (utgifter) med «skjeve» beløp – runde beløp er nesten alltid overføringer og påfyll
  const erKjop = (x) => x.belop <= -200 && x.kategori && idx.type(x.kategori) === 'utgift' && x.kategori !== 'reise/revolut' && Math.round(x.belop * 100) % 10000 !== 0;
  for (const t of nylig.filter(erKjop)) {
    const k = `${t.konto}|${Math.round(t.belop * 100)}|${normaliser(t.tekst)}`;
    if (!grupper.has(k)) grupper.set(k, []);
    grupper.get(k).push(t);
  }
  for (const liste of grupper.values()) {
    liste.sort((a, b) => a.dato.localeCompare(b.dato));
    for (let i = 1; i < liste.length; i++) {
      const a = liste[i - 1];
      const b = liste[i];
      if (Math.abs(dagerMellom(a.dato, b.dato)) <= 2) {
        legg({ id: `dobbel-${a.id}-${b.id}`, type: 'dobbel', alvor: 'middels', dato: b.dato, tekst: `Mulig dobbeltbelastning: ${b.tekst} ${-b.belop} kr to ganger (${a.dato.slice(8)}. og ${b.dato.slice(8)}.)`, transaksjoner: [a, b], belop: -b.belop });
      }
    }
  }

  // Uvanlig store utgifter i forhold til kategorien
  const historikkFra = new Date(Date.parse(idag) - 365 * 86400000).toISOString().slice(0, 10);
  const perHoved = new Map();
  for (const t of db.transaksjoner.filter((x) => x.belop < 0 && x.dato >= historikkFra && x.kategori && idx.type(x.kategori) === 'utgift')) {
    const h = idx.hovedFor(t.kategori)?.id;
    if (!perHoved.has(h)) perHoved.set(h, []);
    perHoved.get(h).push(-t.belop);
  }
  for (const t of db.transaksjoner.filter((x) => x.belop <= -1000 && x.dato >= new Date(Date.parse(idag) - 60 * 86400000).toISOString().slice(0, 10) && x.kategori && idx.type(x.kategori) === 'utgift')) {
    const h = idx.hovedFor(t.kategori);
    if (!h || h.id === 'skatt') continue;
    const verdier = perHoved.get(h.id) || [];
    if (verdier.length < 5) continue;
    const med = median(verdier);
    const sortert = [...verdier].sort((a, b) => a - b);
    const p95 = sortert[Math.floor(sortert.length * 0.95)];
    if (-t.belop > Math.max(3 * med, p95)) {
      legg({ id: `stor-${t.id}`, type: 'stor', alvor: 'info', dato: t.dato, tekst: `Uvanlig stort beløp i ${h.navn.toLowerCase()}: ${t.tekst} ${Math.round(-t.belop)} kr (vanlig: ca. ${Math.round(med)} kr)`, transaksjoner: [t], belop: -t.belop });
    }
  }

  // Nye faste trekk og prisøkninger
  const faste = fastePoster(db);
  for (const p of faste.filter((x) => x.type === 'utgift' && !x.stoppet && x.forste >= fra && x.antall >= 2)) {
    legg({ id: `nyfast-${p.id}`, type: 'nyfast', alvor: 'info', dato: p.forste, tekst: `Nytt fast trekk: ${p.navn}, ca. ${Math.round(-p.belop)} kr ${p.intervall === 1 ? 'hver måned' : `hver ${p.intervall}. måned`} siden ${p.forste}`, belop: -p.perAar });
  }
  for (const p of oppsummerFaste(faste).prisendringer.filter((x) => x.endring.dato >= fra)) {
    legg({ id: `pris-${p.id}-${p.endring.dato}`, type: 'pris', alvor: 'info', dato: p.endring.dato, tekst: `Prisøkning: ${p.navn} fra ${Math.round(-p.endring.fra)} til ${Math.round(-p.endring.til)} kr`, belop: (p.endring.fra - p.endring.til) * 12 / p.intervall });
  }

  // Gebyrer som ikke er faste (purring, inkasso, overtrekk …)
  const fasteTekster = new Set(faste.map((p) => normaliser(p.navn)));
  for (const t of nylig.filter((x) => x.belop < 0 && /purr|inkasso|forsinkelsesrente|overtrekk|gebyr/i.test(`${x.tekst} ${x.detaljer || ''}`) && !fasteTekster.has(normaliser(x.tekst)) && x.kategori !== 'diverse/gebyrer')) {
    legg({ id: `gebyr-${t.id}`, type: 'gebyr', alvor: 'hoy', dato: t.dato, tekst: `Gebyr: ${t.tekst} ${-t.belop} kr – sjekk om det kan unngås`, transaksjoner: [t], belop: -t.belop });
  }

  // Refusjoner som mangler
  for (const g of utleggsoversikt(db, idag).grupper.filter((x) => x.id && x.utestaende >= 100 && x.dager > 30)) {
    legg({ id: `refusjon-${g.id}-${g.eldsteUbetalt}`, type: 'refusjon', alvor: 'middels', dato: g.eldsteUbetalt, tekst: `${g.navn} har ikke betalt tilbake ${Math.round(g.utestaende)} kr (eldste utlegg ${g.eldsteUbetalt})`, lenke: `#/utlegg?m=${encodeURIComponent(g.id)}`, belop: g.utestaende });
  }

  const rekkefolge = { hoy: 0, middels: 1, info: 2 };
  return ut.sort((a, b) => rekkefolge[a.alvor] - rekkefolge[b.alvor] || (b.dato || '').localeCompare(a.dato || ''));
}
