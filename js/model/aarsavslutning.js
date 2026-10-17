// Årsavslutning: sjekkliste før låsing, sammendrag som lagres, og kontrollsum som avslører endringer etterpå.

import { kategoriIndeks } from './categories.js';
import { mndSammendrag } from './report.js';
import { sum } from './calc.js';
import { aarFor } from './years.js';
import { utleggsoversikt } from './outlays.js';

const mnderI = (aar) => Array.from({ length: 12 }, (_, i) => `${aar}-${String(i + 1).padStart(2, '0')}`);

export function aarssjekk(db, aar, idag = new Date().toISOString().slice(0, 10)) {
  const ut = [];
  const legg = (id, ok, tekst, lenke, alvor = 'advarsel') => ut.push({ id, ok, tekst, lenke, alvor: ok ? 'ok' : alvor });
  const T = db.transaksjoner.filter((t) => aarFor(t) === String(aar));

  legg('ferdig', idag >= `${Number(aar) + 1}-01-01`, idag >= `${Number(aar) + 1}-01-01` ? `${aar} er over` : `${aar} er ikke over ennå – lås først når alle transaksjoner for desember er importert`);

  const ukat = T.filter((t) => !t.kategori).length;
  legg('kategorier', !ukat, ukat ? `${ukat} transaksjoner mangler kategori` : 'Alle transaksjoner er kategorisert', `#/transaksjoner?aar=${aar}&kat=__ingen`);

  for (const k of db.kontoer.filter((x) => x.id !== 'korreksjon' && x.aktiv !== false)) {
    const egne = T.filter((t) => t.konto === k.id);
    if (!egne.length) continue;
    const siste = egne.reduce((m, t) => ((t.betalt || t.dato) > m ? t.betalt || t.dato : m), '');
    const senere = db.transaksjoner.some((t) => t.konto === k.id && aarFor(t) > String(aar));
    const ok = siste >= `${aar}-12-01` || senere;
    legg(`konto-${k.id}`, ok, ok ? `${k.navn}: importert ut året` : `${k.navn}: siste transaksjon ${siste.split('-').reverse().join('.')} – mangler resten av året?`, '#/import');
  }

  const des = (db.formue.historikk || []).find((x) => x.mnd === `${aar}-12` && x.nettoformue != null);
  legg('formue', !!des, des ? 'Formuen er fryst per 31. desember' : 'Frys formuen for desember (verdier per 31.12) – brukes i årsrapporten og sammenligningen', '#/formue');

  const slipper = new Set((db.inntekt?.lonnsslipper || []).filter((l) => l.mnd.startsWith(String(aar))).map((l) => l.mnd)).size;
  if (slipper) legg('lonn', slipper >= 12, `${slipper} av 12 lønnsslipper registrert`, `#/kontantstrom?aar=${aar}`, 'info');

  const harInvestering = db.formue.poster.some((p) => ['aksjer', 'fond'].includes(p.type));
  const utbytte = (db.formue.utbytte || []).some((u) => String(u.aar) === String(aar));
  if (harInvestering) legg('utbytte', utbytte, utbytte ? 'Utbytte er registrert' : 'Ingen utbytte registrert for året (se årsoppgaven fra megleren)', '#/formue', 'info');

  const ute = utleggsoversikt(db).grupper.filter((g) => g.id && g.utestaende >= 100);
  if (ute.length) legg('utlegg', false, `Utestående utlegg: ${ute.map((g) => `${g.navn} ${Math.round(g.utestaende)} kr`).join(', ')}`, '#/utlegg', 'info');

  return ut;
}

export function aarssammendrag(db, aar) {
  const idx = kategoriIndeks(db.kategorier);
  const s = mnderI(aar).map((m) => mndSammendrag(db, m, 'betalt', idx));
  const perHoved = {};
  for (const x of s) for (const [id, v] of x.perHoved) perHoved[id] = Math.round(((perHoved[id] || 0) + v) * 100) / 100;
  const slipper = (db.inntekt?.lonnsslipper || []).filter((l) => l.mnd.startsWith(String(aar)));
  const des = (db.formue.historikk || []).find((x) => x.mnd === `${aar}-12`);
  const r = (v) => Math.round(v * 100) / 100;
  return {
    inntekt: r(sum(s.map((x) => x.inntekt))),
    forbruk: r(sum(s.map((x) => x.forbruk))),
    netto: r(sum(s.map((x) => x.netto))),
    investert: r(-sum(s.map((x) => x.sparing))),
    antall: sum(s.map((x) => x.antall)),
    perHoved,
    lonnBrutto: r(sum(slipper.map((l) => l.brutto || 0))),
    skattetrekk: r(-sum(slipper.map((l) => l.skattetrekk || 0))),
    nettoformue: des?.nettoformue ?? null,
  };
}

// SHA-256 over årets transaksjoner (id, datoer, beløp, kategori, konto)
export async function sjekksum(db, aar) {
  const rader = db.transaksjoner.filter((t) => aarFor(t) === String(aar))
    .map((t) => [t.id, t.dato, t.betalt || '', Math.round(t.belop * 100), t.kategori || '', t.konto])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rader)));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function lasAar(db, aar) {
  db.aarsavslutning ||= {};
  db.aarsavslutning[String(aar)] = {
    last: true,
    lastDato: new Date().toISOString(),
    sammendrag: aarssammendrag(db, aar),
    sjekksum: await sjekksum(db, aar),
  };
}

export function lasOppAar(db, aar) {
  const info = db.aarsavslutning?.[String(aar)];
  if (info) { info.last = false; info.opplast = new Date().toISOString(); }
}

// Sammenligner med det som ble lagret ved låsing
export async function kontrollerLast(db, aar) {
  const info = db.aarsavslutning?.[String(aar)];
  if (!info?.last) return null;
  const na = aarssammendrag(db, aar);
  const avvik = [['inntekt', 'Inntekter'], ['forbruk', 'Forbruk'], ['netto', 'Netto'], ['antall', 'Antall transaksjoner']]
    .filter(([k]) => Math.abs((na[k] || 0) - (info.sammendrag?.[k] || 0)) >= 0.5)
    .map(([k, navn]) => ({ navn, lagret: info.sammendrag?.[k], na: na[k] }));
  return { transaksjonerEndret: (await sjekksum(db, aar)) !== info.sjekksum, avvik };
}
