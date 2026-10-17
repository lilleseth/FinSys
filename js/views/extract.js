// Kontrollskjema for tall hentet fra dokumenter, og manuell registrering av lønnsslipp.

import { h, uid, kr, lesBelop, datoNo } from '../util.js';
import { dialog, felt, velg, toast } from '../ui.js';
import { store } from '../store.js';
import { tolkDokument, TOLKBARE } from '../model/extract.js';
import { hentDokument } from '../model/documents.js';
import { pdfLinjer } from '../import/pdf.js';
import { INVESTERING, verdiPa } from '../model/calc.js';
import { ruter } from '../main.js';
import { erLastDato, lastMelding } from '../model/years.js';

const LONN_FELT = [
  ['fastlonn', 'Fastlønn'], ['overtid50', 'Overtid 50 %'], ['overtid100', 'Overtid 100 %'], ['engang', 'Engangsposter'],
  ['andreTillegg', 'Andre tillegg/trekk'], ['brutto', 'Bruttolønn'], ['skattetrekk', 'Skattetrekk (negativt)'], ['trekkfrie', 'Trekkfrie tillegg'], ['netto', 'Utbetalt'],
];

const tallTekst = (v) => (v == null ? '' : kr(v, true));
const belopFelt = (etikett, funn, hjelp = 'Ikke funnet – fyll inn selv') => {
  const inp = h('input', { inputmode: 'decimal', value: tallTekst(funn?.verdi) });
  return { inp, el: felt(etikett, inp, funn?.linje ? `Fra: «${funn.linje.slice(0, 90)}»` : hjelp) };
};

export const kanTolkes = (d, kategori = d.kategori) => !!TOLKBARE[kategori] && (d.mime === 'application/pdf' || !!d.tekst);

async function linjerFra(d) {
  if (d.mime === 'application/pdf') {
    const blob = await hentDokument(d);
    return pdfLinjer(await blob.arrayBuffer());
  }
  return (d.tekst || '').split('\n');
}

export async function hentTallFraDokument(d, kategori = d.kategori) {
  if (d.mime?.startsWith('image/')) { toast('Bilder kan ikke leses uten AI – fyll inn tallene selv.', 'feil'); return; }
  let r;
  try {
    r = tolkDokument(await linjerFra(d), kategori, d.dato);
  } catch (e) {
    console.error(e);
    toast(`Kunne ikke lese dokumentet: ${e.message}`, 'feil');
    return;
  }
  if (!r) return;
  const funnet = Object.values(r.felt).filter(Boolean).length;
  if (!funnet) toast('Fant ingen kjente nøkkelord – fyll inn tallene selv.', 'feil');
  if (r.type === 'lonn') return lonnsslippDialog({ mnd: r.mnd, arbeidsgiver: r.arbeidsgiver, funn: r.felt, dokument: d });
  if (r.type === 'lan') return lanDialog(r, d);
  if (r.type === 'investering') return investeringDialog(r, d);
  if (r.type === 'skatt') return skattDialog(r, d);
}

function koble(d, postId) {
  if (d && postId && !d.koblinger.some((k) => k.type === 'post' && k.id === postId)) d.koblinger.push({ type: 'post', id: postId });
}

function settVerdi(post, dato, verdi, kilde) {
  if (erLastDato(store.db, dato)) throw new Error(lastMelding(dato.slice(0, 4)));
  post.verdier ||= [];
  const finnes = post.verdier.find((v) => v.dato === dato);
  if (finnes) Object.assign(finnes, { verdi, kilde });
  else post.verdier.push({ dato, verdi, kilde });
}

// Lønnsslipp: brukes både for tolkede dokumenter og manuell registrering.
export function lonnsslippDialog({ mnd, arbeidsgiver = '', funn = {}, dokument = null } = {}) {
  const db = store.db;
  db.inntekt.lonnsslipper ||= [];
  const mndInp = h('input', { type: 'month', value: mnd || new Date().toISOString().slice(0, 7), required: true });
  const arbInp = h('input', { value: arbeidsgiver || db.inntekt.lonnsslipper.at(-1)?.arbeidsgiver || '' });
  const eksisterende = () => db.inntekt.lonnsslipper.find((l) => l.mnd === mndInp.value);
  const felter = {};
  const status = h('p.dempet');
  const fyll = () => {
    const e = eksisterende();
    status.textContent = e ? `Det finnes allerede en lønnsslipp for denne måneden – den oppdateres${dokument ? ' med tallene som er fylt inn' : ''}.` : '';
    if (!dokument) for (const [k] of LONN_FELT) felter[k].inp.value = tallTekst(e?.[k]);
  };
  for (const [k, navn] of LONN_FELT) felter[k] = belopFelt(navn, funn[k], dokument ? 'Ikke funnet' : '');
  mndInp.addEventListener('change', fyll);
  fyll();
  dialog({
    tittel: dokument ? 'Tall fra lønnsslipp' : 'Registrer lønnsslipp',
    innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
      dokument ? h('p.dempet', 'Kontroller tallene mot dokumentet før du lagrer. Felt uten verdi lagres ikke.') : null,
      felt('Måned', mndInp), felt('Arbeidsgiver', arbInp), status,
      h('div.skjema-rutenett', LONN_FELT.map(([k]) => felter[k].el))),
    knapper: [
      { tekst: 'Avbryt' },
      { tekst: 'Lagre lønnsslipp', type: 'primar', onclick: () => {
        if (!mndInp.value) { toast('Velg måned', 'feil'); return false; }
        if (erLastDato(db, mndInp.value)) { toast(lastMelding(mndInp.value.slice(0, 4)), 'feil'); return false; }
        const verdier = {};
        for (const [k] of LONN_FELT) {
          const v = lesBelop(felter[k].inp.value);
          if (v != null) verdier[k] = k === 'skattetrekk' ? -Math.abs(v) : v;
        }
        if (verdier.brutto == null && verdier.netto == null) { toast('Fyll inn minst bruttolønn eller utbetalt', 'feil'); return false; }
        let s = eksisterende();
        if (!s) { s = { id: 'l-' + uid(), mnd: mndInp.value }; db.inntekt.lonnsslipper.push(s); }
        if (!dokument) for (const [k] of LONN_FELT) delete s[k];
        Object.assign(s, verdier, { arbeidsgiver: arbInp.value.trim() });
        if (dokument) { s.dokumentId = dokument.id; if (!dokument.koblinger.some((k) => k.type === 'lonnsslipp')) dokument.koblinger.push({ type: 'lonnsslipp', id: s.id }); }
        db.inntekt.lonnsslipper.sort((a, b) => a.mnd.localeCompare(b.mnd));
        store.changed();
        toast(`Lønnsslipp for ${mndInp.value} lagret`);
        ruter();
      } },
    ],
  });
}

function postVelger(poster, valgt) {
  return velg([{ verdi: '', tekst: 'Velg …' }, ...poster.map((p) => ({ verdi: p.id, tekst: `${p.navn}${verdiPa(p) ? ` (${kr(verdiPa(p).verdi)} kr pr. ${datoNo(verdiPa(p).dato)})` : ''}` }))], valgt);
}

function gjettPost(poster, d) {
  const koblet = poster.find((p) => d.koblinger.some((k) => k.type === 'post' && k.id === p.id));
  if (koblet) return koblet.id;
  const tekst = `${d.tittel} ${d.filnavn} ${(d.tekst || '').slice(0, 1500)}`.toLowerCase();
  const treff = poster.find((p) => tekst.includes(p.navn.toLowerCase().split(' (')[0]) || (p.gruppe && tekst.includes(p.gruppe.toLowerCase().split(' ')[0])));
  return treff?.id || (poster.length === 1 ? poster[0].id : '');
}

function lanDialog(r, d) {
  const db = store.db;
  const poster = db.formue.poster.filter((p) => p.side === 'gjeld');
  const post = postVelger(poster, gjettPost(poster, d));
  const dato = h('input', { type: 'date', value: r.dato || d.dato });
  const saldo = belopFelt('Restgjeld', r.felt.saldo);
  const rente = h('input', { inputmode: 'decimal', value: r.felt.rente ? String(Math.round(r.felt.rente.verdi * 100000) / 1000).replace('.', ',') : '' });
  const termin = belopFelt('Terminbeløp per måned', r.felt.termin);
  dialog({
    tittel: 'Tall fra lånedokument',
    innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
      h('p.dempet', 'Kontroller tallene mot dokumentet. Saldoen lagres som verdi på datoen, og rente/terminbeløp brukes i gjeldsplanen.'),
      felt('Lån', post), felt('Dato for saldo', dato),
      h('div.skjema-rutenett', saldo.el, felt('Nominell rente (%)', rente, r.felt.rente ? `Fra: «${r.felt.rente.linje.slice(0, 90)}»` : 'Ikke funnet'), termin.el)),
    knapper: [
      { tekst: 'Avbryt' },
      { tekst: 'Lagre', type: 'primar', onclick: () => {
        if (erLastDato(db, dato.value)) { toast(lastMelding(dato.value.slice(0, 4)), 'feil'); return false; }
        const p = poster.find((x) => x.id === post.value);
        if (!p) { toast('Velg hvilket lån tallene gjelder', 'feil'); return false; }
        const s = lesBelop(saldo.inp.value);
        if (s != null && dato.value) settVerdi(p, dato.value, Math.abs(s), `Dokument: ${d.tittel}`);
        const rt = lesBelop(rente.value);
        if (rt != null) p.rente = rt / 100;
        const t = lesBelop(termin.inp.value);
        if (t != null) p.terminbelop = Math.abs(t);
        koble(d, p.id);
        store.changed();
        toast(`${p.navn} oppdatert`);
        ruter();
      } },
    ],
  });
}

function investeringDialog(r, d) {
  const db = store.db;
  const poster = db.formue.poster.filter((p) => p.side === 'eiendel' && (INVESTERING.has(p.type) || ['pensjon', 'selskap', 'krypto', 'bsu', 'bank'].includes(p.type)));
  const valgtId = gjettPost(poster, d);
  const post = postVelger(poster, valgtId);
  const kredittPoster = db.formue.poster.filter((p) => p.side === 'gjeld' && p.type === 'kreditt');
  const gruppe = () => poster.find((p) => p.id === post.value)?.gruppe;
  const kredittValg = postVelger(kredittPoster, kredittPoster.find((p) => p.gruppe && p.gruppe === gruppe())?.id || '');
  post.addEventListener('change', () => { kredittValg.value = kredittPoster.find((p) => p.gruppe && p.gruppe === gruppe())?.id || ''; });
  const dato = h('input', { type: 'date', value: r.dato || d.dato });
  const verdi = belopFelt('Markedsverdi', r.felt.verdi);
  const kreditt = belopFelt('Kreditt (lån i depotet)', r.felt.kreditt, 'Valgfritt');
  dialog({
    tittel: 'Tall fra porteføljerapport',
    innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
      h('p.dempet', 'Kontroller tallene mot rapporten. Verdien lagres på datoen.'),
      felt('Konto/post', post), felt('Dato', dato),
      h('div.skjema-rutenett', verdi.el, kreditt.el, kredittPoster.length ? felt('Kreditt-post', kredittValg) : null)),
    knapper: [
      { tekst: 'Avbryt' },
      { tekst: 'Lagre', type: 'primar', onclick: () => {
        if (erLastDato(db, dato.value)) { toast(lastMelding(dato.value.slice(0, 4)), 'feil'); return false; }
        const p = poster.find((x) => x.id === post.value);
        const v = lesBelop(verdi.inp.value);
        if (!p || v == null || !dato.value) { toast('Velg post og fyll inn verdi og dato', 'feil'); return false; }
        settVerdi(p, dato.value, v, `Dokument: ${d.tittel}`);
        koble(d, p.id);
        const k = lesBelop(kreditt.inp.value);
        const kp = kredittPoster.find((x) => x.id === kredittValg.value);
        if (k != null && kp) { settVerdi(kp, dato.value, Math.abs(k), `Dokument: ${d.tittel}`); koble(d, kp.id); }
        store.changed();
        toast(`${p.navn} oppdatert`);
        ruter();
      } },
    ],
  });
}

function skattDialog(r, d) {
  const db = store.db;
  const aar = h('input', { type: 'number', value: r.aar, min: 2000, max: 2100 });
  const beregnet = belopFelt('Beregnet skatt', r.felt.beregnet);
  const trukket = belopFelt('Forskuddstrekk / innbetalt', r.felt.trukket);
  const rest = belopFelt('Restskatt', r.felt.restskatt);
  const gode = belopFelt('Til gode', r.felt.tilgode);
  const neste = new Date(Date.parse((d.dato || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'));
  neste.setUTCMonth(neste.getUTCMonth() + 1);
  const mnd = h('input', { type: 'month', value: neste.toISOString().slice(0, 7) });
  const leggInn = h('input', { type: 'checkbox', checked: true });
  dialog({
    tittel: 'Tall fra skatteoppgjør',
    innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
      h('p.dempet', 'Kontroller tallene mot oppgjøret. De lagres under skatteåret og kan legges inn i kontantstrømprognosen.'),
      felt('Inntektsår', aar),
      h('div.skjema-rutenett', beregnet.el, trukket.el, rest.el, gode.el),
      h('label.avkryss', leggInn, ' Legg restskatt/tilgode inn som planlagt post i prognosen'),
      felt('Måned for betaling/utbetaling', mnd)),
    knapper: [
      { tekst: 'Avbryt' },
      { tekst: 'Lagre', type: 'primar', onclick: () => {
        const a = Number(aar.value);
        if (!a) { toast('Fyll inn inntektsår', 'feil'); return false; }
        const o = { beregnet: lesBelop(beregnet.inp.value), trukket: lesBelop(trukket.inp.value), restskatt: lesBelop(rest.inp.value), tilgode: lesBelop(gode.inp.value), dokumentId: d.id, dato: d.dato };
        db.skatt ||= {};
        db.skatt[a] = { ...(db.skatt[a] || {}), oppgjor: o };
        const belop = o.restskatt ? -Math.abs(o.restskatt) : o.tilgode ? Math.abs(o.tilgode) : null;
        if (leggInn.checked && belop && mnd.value) {
          db.planlagt ||= [];
          db.planlagt = db.planlagt.filter((x) => x.kilde !== `skatteoppgjor-${a}`);
          db.planlagt.push({ id: 'pl-' + uid(), mnd: mnd.value, tekst: `${belop < 0 ? 'Restskatt' : 'Skatt til gode'} ${a}`, belop, kilde: `skatteoppgjor-${a}` });
        }
        store.changed();
        toast(`Skatteoppgjør ${a} lagret`);
        ruter();
      } },
    ],
  });
}
