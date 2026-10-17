// Oppstart: tilkobling -> passord -> last data -> vis app.

// Appen skal aldri vises inne i en annen side (beskytter mot «clickjacking»).
if (window.top !== window.self) {
  document.documentElement.textContent = 'FinSys kan ikke vises i en ramme.';
  throw new Error('FinSys kan ikke vises i en ramme');
}

import { h, clear, lastNed } from './util.js';
import { felt, toast, dialog, passordMaler } from './ui.js';
import { GitHubBackend } from './storage/github.js';
import { LocalBackend } from './storage/local.js';
import { Vault } from './vault.js';
import { encryptText, decryptText, passordProblem } from './crypto.js';
import { store, nyDatabase, SCHEMA } from './store.js';
import { STANDARD_KATEGORIER } from './model/categories.js';
import * as oversikt from './views/dashboard.js';
import * as transaksjoner from './views/transactions.js';
import * as kontantstrom from './views/cashflow.js';
import * as formue from './views/balance.js';
import * as budsjett from './views/budget.js';
import * as importer from './views/import.js';
import * as notater from './views/notes.js';
import * as dokumenter from './views/documents.js';
import * as innstillinger from './views/settings.js';
import * as rapport from './views/report.js';
import * as planlegging from './views/planning.js';
import * as husholdning from './views/household.js';
import * as utlegg from './views/outlays.js';
import * as innsikt from './views/insight.js';
import { erUtlegg } from './model/outlays.js';
import { oppgraderBudsjett, aarFor } from './model/years.js';

const TILKOBLING = 'finsys.tilkobling';
export const AUTOLAS_MIN = 15;
const app = document.getElementById('app');
let aktiv = null; // gjeldende tilkobling (uten token i klartekst)
let aktivToken = null; // token i minnet mens appen er låst opp

const RUTER = [
  { sti: 'oversikt', navn: 'Oversikt', vis: oversikt },
  { sti: 'transaksjoner', navn: 'Transaksjoner', vis: transaksjoner },
  { sti: 'kontantstrom', navn: 'Kontantstrøm', vis: kontantstrom },
  { sti: 'budsjett', navn: 'Budsjett', vis: budsjett },
  { sti: 'planlegging', navn: 'Planlegging', vis: planlegging },
  { sti: 'innsikt', navn: 'Innsikt', vis: innsikt },
  { sti: 'formue', navn: 'Formue', vis: formue },
  { sti: 'husholdning', navn: 'Husholdning', vis: husholdning, skjult: (db) => !db.husholdning?.aktiv },
  { sti: 'utlegg', navn: 'Utlegg', vis: utlegg, skjult: (db) => !db.transaksjoner.some(erUtlegg) },
  { sti: 'rapport', navn: 'Rapport', vis: rapport },
  { sti: 'import', navn: 'Import', vis: importer },
  { sti: 'dokumenter', navn: 'Dokumenter', vis: dokumenter },
  { sti: 'notater', navn: 'Notater', vis: notater },
  { sti: 'innstillinger', navn: 'Innstillinger', vis: innstillinger },
];

export function hentTilkobling() {
  try { return JSON.parse(localStorage.getItem(TILKOBLING) || 'null'); } catch { return null; }
}

function lagreTilkobling(t) {
  try { localStorage.setItem(TILKOBLING, JSON.stringify(t)); } catch { /* privat modus */ }
}

export function kobleFra() {
  try { localStorage.removeItem(TILKOBLING); } catch { /* ignore */ }
  location.hash = '';
  location.reload();
}

const tokenAad = (meta) => `token|${meta.id}`;

// Lagrer tilkoblingen med tokenen kryptert med datanøkkelen. Klartekst-token fjernes.
async function sikreTilkobling(vault, t, token) {
  if (t.type !== 'github') { aktiv = t; return; }
  if (vault.meta.format !== 2 || !token) { aktiv = t; return; }
  const ny = {
    type: 'github', owner: t.owner, repo: t.repo, branch: t.branch, basePath: t.basePath,
    meta: vault.meta,
    tokenEnc: await encryptText(vault.key, token, tokenAad(vault.meta)),
  };
  lagreTilkobling(ny);
  aktiv = ny;
}

// Kalles når nøkkelinformasjonen endres (nytt passord, ny gjenopprettingsnøkkel).
export function oppdaterMetaCache() {
  if (aktiv?.type === 'github' && aktiv.tokenEnc) {
    aktiv.meta = store.vault.meta;
    lagreTilkobling(aktiv);
  }
}

export function aktivTilkobling() {
  return aktiv;
}

// Etter nøkkelrotasjon: krypter tokenen med den nye nøkkelen.
export async function etterRotasjon() {
  if (aktiv?.type === 'github' && aktivToken) await sikreTilkobling(store.vault, aktiv, aktivToken);
  else oppdaterMetaCache();
}

async function kobleTilGitHub(vault, t, token) {
  if (!/^github_pat_/.test(token)) {
    throw new Error('Bruk en finkornet token (starter med «github_pat_»). Klassiske tokens gir tilgang til alle repoene dine og godtas ikke.');
  }
  const backend = new GitHubBackend({ ...t, token });
  const info = await backend.check();
  if (!info.private) throw new Error(`Repoet ${t.owner}/${t.repo} er offentlig. Data-repoet må være privat – endre det under Settings → General → Danger Zone på GitHub.`);
  t.branch = backend.branch;
  vault.backend = backend;
  return backend;
}

function skjerm(...innhold) {
  clear(app);
  app.className = 'skjerm';
  app.append(h('div.skjerm-kort', h('div.logo', 'FinSys'), ...innhold));
}

function feilmelding() {
  return h('p.feil', { role: 'alert', hidden: true });
}

function visFeil(el, tekst) {
  el.textContent = tekst;
  el.hidden = !tekst;
}

function opptatt(knapp, tekst) {
  const gammel = knapp.textContent;
  knapp.disabled = true;
  knapp.textContent = tekst;
  return () => { knapp.disabled = false; knapp.textContent = gammel; };
}

// 1. Tilkobling
function visTilkobling() {
  const eier = h('input', { autocomplete: 'username', placeholder: 'ditt GitHub-brukernavn', required: true });
  const repo = h('input', { value: 'finsys-data', required: true });
  const token = h('input', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…', required: true });
  const gren = h('input', { placeholder: 'standard (main)' });
  const mappe = h('input', { placeholder: 'tom = rotmappen' });
  const feil = feilmelding();
  const knapp = h('button.primar', { type: 'submit' }, 'Koble til');
  const skjema = h('form.skjema', {
    onsubmit: async (e) => {
      e.preventDefault();
      visFeil(feil, '');
      const ferdig = opptatt(knapp, 'Kobler til …');
      const t = { type: 'github', owner: eier.value.trim(), repo: repo.value.trim(), branch: gren.value.trim(), basePath: mappe.value.trim() };
      const tok = token.value.trim();
      try {
        const vault = new Vault(null);
        await kobleTilGitHub(vault, t, tok);
        const meta = await vault.loadMeta();
        if (!meta) return visOpprett(vault, t, tok);
        visLasOpp(vault, t, tok);
      } catch (err) {
        visFeil(feil, err.message);
        ferdig();
      }
    },
  },
  felt('GitHub-brukernavn (eier av data-repoet)', eier),
  felt('Navn på data-repoet (privat)', repo),
  felt('Tilgangstoken', token, 'Finkornet token med «Contents: Read and write» kun for data-repoet. Lagres kryptert med passordet ditt.'),
  h('details', h('summary', 'Avansert'), felt('Gren', gren), felt('Mappe i repoet', mappe, 'Brukes hvis flere personer deler samme data-repo.')),
  feil,
  knapp);

  skjerm(
    h('h1', 'Koble til datalageret'),
    h('p', 'Dataene dine lagres kryptert i et privat GitHub-repo som bare du har tilgang til.'),
    h('p', h('a', { href: 'https://github.com/lilleseth/FinSys/blob/main/docs/OPPSETT.md', target: '_blank', rel: 'noopener noreferrer' }, 'Steg-for-steg: slik lager du data-repo og token')),
    skjema,
    h('div.skille', 'eller'),
    h('button.sekundar.full', { type: 'button', onclick: async () => { lagreTilkobling({ type: 'lokal' }); await start(); } }, 'Prøv uten GitHub (lagres bare i denne nettleseren)')
  );
}

function huskBoks() {
  const boks = h('input', { type: 'checkbox' });
  return {
    boks,
    el: h('label.avkryss', boks, ' Husk meg på denne enheten'),
    hjelp: h('small.hjelp', `Kryss av bare på din egen, låste enhet. Uten avkrysning låses appen etter ${AUTOLAS_MIN} minutter uten aktivitet og når fanen lukkes.`),
  };
}

// 2a. Nytt hvelv
function visOpprett(vault, t, token) {
  const p1 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const husk = huskBoks();
  const feil = feilmelding();
  const knapp = h('button.primar', { type: 'submit' }, 'Opprett');
  skjerm(
    h('h1', 'Velg et passord'),
    h('p', `Datalageret (${vault.backend.label}) er tomt. Velg et passord som brukes til å kryptere alt.`),
    h('p.dempet', 'Bruk gjerne 5–6 tilfeldige ord, eller trykk «Foreslå et sterkt passord». Lagre passordet i en passordbehandler.'),
    h('form.skjema', {
      onsubmit: async (e) => {
        e.preventDefault();
        const problem = passordProblem(p1.value, [aktiv?.owner]);
        if (problem) return visFeil(feil, problem);
        if (p1.value !== p2.value) return visFeil(feil, 'Passordene er ikke like.');
        const ferdig = opptatt(knapp, 'Oppretter …');
        try {
          await vault.create(p1.value);
          const kode = await vault.lagGjenoppretting({ passord: p1.value });
          if (husk.boks.checked) await vault.rememberKey();
          await sikreTilkobling(vault, t, token);
          visKodeSkjerm(kode, () => apne(vault));
        } catch (err) {
          visFeil(feil, err.message);
          ferdig();
        }
      },
    },
    felt('Passord (minst 12 tegn)', p1),
    passordMaler(p1, p2, () => [aktiv?.owner]),
    felt('Gjenta passord', p2),
    husk.el, husk.hjelp,
    feil,
    knapp),
    h('button.lenke', { type: 'button', onclick: kobleFra }, 'Bytt datalager')
  );
}

// Viser gjenopprettingsnøkkelen én gang. Brukeren må bekrefte at den er lagret.
function kodeInnhold(kode) {
  const ok = h('input', { type: 'checkbox' });
  const el = h('div.kode-boks',
    h('p', 'Dette er gjenopprettingsnøkkelen din. Med den kan du låse opp og velge nytt passord hvis du glemmer passordet. Den vises bare nå.'),
    h('div.gjenopprettingskode', { 'aria-label': 'Gjenopprettingsnøkkel' }, kode),
    h('div.knapperad',
      h('button.sekundar', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(kode); toast('Kopiert'); } catch { toast('Kunne ikke kopiere – skriv den av', 'feil'); } } }, 'Kopier'),
      h('button.sekundar', { type: 'button', onclick: () => lastNed('FinSys-gjenopprettingsnokkel.txt', `FinSys gjenopprettingsnøkkel\n\n${kode}\n\nOppbevar trygt, f.eks. i passordbehandler eller utskrevet i en skuff. Den gir full tilgang til dataene sammen med tilgang til data-repoet.\n`, 'text/plain') }, 'Last ned som fil')),
    h('p.advarsel', 'Lagre den i passordbehandleren eller skriv den ut. Ikke lagre den i samme repo som dataene.'),
    h('label.avkryss', ok, ' Jeg har lagret gjenopprettingsnøkkelen et trygt sted'));
  return { el, ok };
}

function visKodeSkjerm(kode, videre) {
  const { el, ok } = kodeInnhold(kode);
  const feil = feilmelding();
  skjerm(h('h1', 'Gjenopprettingsnøkkel'), el, feil,
    h('button.primar', { type: 'button', onclick: () => { if (!ok.checked) return visFeil(feil, 'Bekreft at du har lagret nøkkelen.'); videre(); } }, 'Fortsett'));
}

export function visKodeDialog(kode) {
  const { el, ok } = kodeInnhold(kode);
  dialog({ tittel: 'Ny gjenopprettingsnøkkel', innhold: el, knapper: [{ tekst: 'Ferdig', type: 'primar', onclick: () => { if (!ok.checked) { toast('Bekreft at du har lagret nøkkelen', 'feil'); return false; } } }] });
}

// 2b. Lås opp. token = klartekst-token ved ny tilkobling; ellers ligger den kryptert i t.tokenEnc.
function visLasOpp(vault, t, token) {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const husk = huskBoks();
  const feil = feilmelding();
  const knapp = h('button.primar', { type: 'submit' }, 'Lås opp');
  skjerm(
    h('h1', 'Lås opp'),
    h('p.dempet', t.type === 'github' ? `GitHub: ${t.owner}/${t.repo}` : 'Lokalt i denne nettleseren'),
    h('form.skjema', {
      onsubmit: async (e) => {
        e.preventDefault();
        visFeil(feil, '');
        const ferdig = opptatt(knapp, 'Låser opp …');
        try {
          if (!(await vault.unlock(pw.value))) {
            visFeil(feil, vault.backend ? 'Feil passord.' : 'Feil passord. Har du nylig byttet passord på en annen enhet, prøv det forrige passordet én gang – eller velg «Bytt datalager» og koble til på nytt med tokenen.');
            ferdig();
            return;
          }
          let tok = token;
          if (!vault.backend) {
            tok = await decryptText(vault.key, t.tokenEnc, tokenAad(t.meta));
            await kobleTilGitHub(vault, t, tok);
            if (!(await kontrollerMeta(vault, pw.value))) throw new Error('Passordet passer ikke med nøkkelinformasjonen i datalageret. Er passordet byttet på en annen enhet, bruk det nye passordet – eller velg «Bytt datalager» og koble til på nytt.');
          }
          if (husk.boks.checked) await vault.rememberKey();
          await apne(vault, t, tok, pw.value);
        } catch (err) {
          visFeil(feil, err.message);
          ferdig();
        }
      },
    },
    felt('Passord', pw),
    husk.el, husk.hjelp,
    feil,
    knapp),
    vault.harGjenoppretting ? h('button.lenke', { type: 'button', onclick: () => visGjenoppretting(vault, t, token) }, 'Glemt passordet? Bruk gjenopprettingsnøkkelen') : null,
    h('button.lenke', { type: 'button', onclick: kobleFra }, 'Bytt datalager')
  );
  pw.focus();
}

// 2c. Gjenoppretting: lås opp med gjenopprettingsnøkkel og velg nytt passord.
function visGjenoppretting(vault, t, token) {
  const kode = h('input', { autocomplete: 'off', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', spellcheck: 'false' });
  const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const feil = feilmelding();
  const knapp = h('button.primar', { type: 'submit' }, 'Gjenopprett');
  skjerm(
    h('h1', 'Gjenopprett tilgang'),
    h('form.skjema', {
      onsubmit: async (e) => {
        e.preventDefault();
        const problem = passordProblem(p1.value, [aktiv?.owner]);
        if (problem) return visFeil(feil, problem);
        if (p1.value !== p2.value) return visFeil(feil, 'Passordene er ikke like.');
        const ferdig = opptatt(knapp, 'Gjenoppretter …');
        try {
          if (!(await vault.unlockGjenoppretting(kode.value))) { visFeil(feil, 'Feil gjenopprettingsnøkkel.'); ferdig(); return; }
          let tok = token;
          if (!vault.backend) {
            tok = await decryptText(vault.key, t.tokenEnc, tokenAad(t.meta));
            await kobleTilGitHub(vault, t, tok);
            if (!(await kontrollerMeta(vault))) throw new Error('Gjenopprettingsnøkkelen passer ikke lenger med datalageret (nøkkelen kan være rotert). Bruk den nyeste gjenopprettingsnøkkelen.');
          }
          await vault.byttPassord({ gjenoppretting: kode.value }, p1.value);
          await sikreTilkobling(vault, t, tok);
          toast('Nytt passord er satt');
          await apne(vault, t, tok);
        } catch (err) {
          visFeil(feil, err.message);
          ferdig();
        }
      },
    },
    felt('Gjenopprettingsnøkkel', kode),
    felt('Nytt passord (minst 12 tegn)', p1),
    passordMaler(p1, p2, () => [aktiv?.owner]),
    felt('Gjenta nytt passord', p2),
    feil,
    knapp),
    h('button.lenke', { type: 'button', onclick: () => visLasOpp(vault, t, token) }, 'Tilbake')
  );
}

// Sjekker nøkkelinformasjonen i datalageret mot den lokale kopien og tilpasser seg endringer
// (nytt passord, nøkkelrotasjon) gjort fra en annen enhet. Returnerer false hvis passordet trengs.
async function kontrollerMeta(vault, passord) {
  const lokal = vault.meta;
  const key = vault.key;
  const fraRepo = await vault.loadMeta();
  if (!fraRepo) { vault.meta = lokal; throw new Error('Fant ikke finsys.json i data-repoet. Er repoet tømt eller byttet?'); }
  if (fraRepo.id !== lokal.id) throw new Error('Data-repoet inneholder et annet hvelv enn denne enheten kjenner. Velg «Bytt datalager» og koble til på nytt.');
  let ok = (await vault.verify(key, fraRepo)) && !(fraRepo.rotasjon && !vault.gammelKey);
  if (!ok && passord != null) ok = await vault.unlock(passord);
  if (!ok) return false;
  if (aktiv?.tokenEnc && JSON.stringify(aktiv.meta) !== JSON.stringify(fraRepo)) {
    aktiv.meta = fraRepo;
    lagreTilkobling(aktiv);
  }
  return true;
}

function oppgrader(db) {
  db.schema = db.schema || SCHEMA;
  db.kontoer ||= [];
  db.kategorier ||= structuredClone(STANDARD_KATEGORIER);
  db.innstillinger ||= {};
  db.innstillinger.skatt ||= { rentefradrag: 0.22, bunnfradrag: 1900000, formuesskattSats: 0.01, rabattAksjer: 0.2 };
  db.budsjett ||= {};
  db.budsjett.poster ||= {};
  oppgraderBudsjett(db, db.transaksjoner?.reduce((m, t) => (aarFor(t) > m ? aarFor(t) : m), '') || String(new Date().getFullYear()));
  db.aarsavslutning ||= {};
  db.regler ||= [];
  db.formue ||= { poster: [], historikk: [], utbytte: [] };
  db.formue.utbytte ||= [];
  db.formue.historikk ||= [];
  db.inntekt ||= { lonnsslipper: [] };
  db.notater ||= [];
  db.dokumenter ||= [];
  db.planlagt ||= [];
  db.mal ||= [];
  db.skatt ||= {};
  return db;
}

async function apne(vault, t = aktiv, token, passord) {
  skjerm(h('p', 'Laster data …'));
  let db;
  try {
    db = oppgrader((await vault.load()) || nyDatabase());
  } catch (e) {
    console.error(e);
    skjerm(
      h('h1', 'Kunne ikke lese dataene'),
      h('p.feil', { role: 'alert' }, e.message),
      h('p', 'Ingenting er endret eller lagret. Hvis en fil i data-repoet er endret ved en feil, kan en tidligere versjon hentes fram fra historikken på GitHub.'),
      h('div.knapperad', h('button.primar', { type: 'button', onclick: () => location.reload() }, 'Prøv igjen'), h('button.sekundar', { type: 'button', onclick: kobleFra }, 'Bytt datalager')));
    return;
  }
  store.init(vault, db);
  // Eldre hvelv oppgraderes til nytt nøkkelformat når passordet er kjent
  if (vault.meta.format === 1 && passord) {
    await vault.oppgrader(passord);
    if (vault.husket) await vault.rememberKey();
    store.changed();
  }
  if (token) aktivToken = token;
  if (vault.meta.rotasjon) {
    skjerm(h('p', 'Fullfører nøkkelrotasjon …'));
    await vault.fullforRotasjon(db);
    await sikreTilkobling(vault, t, aktivToken);
  }
  await sikreTilkobling(vault, t, token);
  visApp();
  if (vault.meta.format === 1) sikkerhetsoppgradering(token);
  else if (!vault.harGjenoppretting) foreslaGjenoppretting();
}

// For eldre hvelv som ble låst opp med husket nøkkel: be om passordet én gang.
function sikkerhetsoppgradering(token) {
  const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  dialog({
    tittel: 'Sikkerhetsoppgradering',
    innhold: h('div', h('p', 'FinSys har fått bedre nøkkelhåndtering: passordet kan byttes, tokenen lagres kryptert, og du får en gjenopprettingsnøkkel i tilfelle du glemmer passordet. Skriv passordet ditt for å oppgradere.'), felt('Passord', pw)),
    knapper: [{ tekst: 'Senere' }, { tekst: 'Oppgrader', type: 'primar', onclick: async () => {
      try {
        await store.vault.oppgrader(pw.value);
        if (store.vault.husket) await store.vault.rememberKey();
        store.changed();
        await store.save();
        await sikreTilkobling(store.vault, aktiv, token);
        const kode = await store.vault.lagGjenoppretting({ passord: pw.value });
        oppdaterMetaCache();
        visKodeDialog(kode);
      } catch (e) {
        toast(e.message, 'feil');
        return false;
      }
    } }],
  });
}

function foreslaGjenoppretting() {
  const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  dialog({
    tittel: 'Lag gjenopprettingsnøkkel',
    innhold: h('div', h('p', 'Du har ingen gjenopprettingsnøkkel. Uten den er dataene tapt hvis du glemmer passordet. Skriv passordet for å lage en.'), felt('Passord', pw)),
    knapper: [{ tekst: 'Senere' }, { tekst: 'Lag nøkkel', type: 'primar', onclick: async () => {
      try {
        const kode = await store.vault.lagGjenoppretting({ passord: pw.value });
        oppdaterMetaCache();
        visKodeDialog(kode);
      } catch (e) {
        toast(e.message, 'feil');
        return false;
      }
    } }],
  });
}

export async function start() {
  const t = hentTilkobling();
  if (!t) return visTilkobling();
  aktiv = t;
  skjerm(h('p', 'Kobler til …'));
  try {
    if (t.type === 'github' && t.tokenEnc && t.meta) {
      // Tokenen er kryptert: lås opp først, deretter kobles det til GitHub.
      const vault = new Vault(null);
      vault.meta = t.meta;
      if (await vault.tryRememberedKey()) {
        const tok = await decryptText(vault.key, t.tokenEnc, tokenAad(t.meta));
        await kobleTilGitHub(vault, t, tok);
        if (await kontrollerMeta(vault)) return apne(vault, t, tok);
        // Nøkkelen er endret fra en annen enhet: krever passord
        await vault.forgetKey();
        const ny = new Vault(null);
        ny.meta = t.meta;
        return visLasOpp(ny, t);
      }
      return visLasOpp(vault, t);
    }
    // Lokal lagring, eller eldre oppsett med token i klartekst (oppgraderes ved neste opplåsing)
    const vault = new Vault(t.type === 'github' ? null : new LocalBackend({ name: t.navn || 'standard' }));
    if (t.type === 'github') await kobleTilGitHub(vault, t, t.token);
    const meta = await vault.loadMeta();
    if (!meta) return visOpprett(vault, t, t.token);
    if (await vault.tryRememberedKey()) return apne(vault, t, t.token);
    visLasOpp(vault, t, t.token);
  } catch (err) {
    const feil = h('p.feil', { role: 'alert' }, err.message);
    skjerm(h('h1', 'Kunne ikke koble til'), feil, h('div.knapperad', h('button.primar', { onclick: start }, 'Prøv igjen'), h('button.sekundar', { onclick: kobleFra }, 'Endre tilkobling')));
  }
}

// --- Selve appen ---

let hoved;
let statusEl;

function statusTekst() {
  switch (store.status) {
    case 'lagret': return ['Lagret', 'ok'];
    case 'endret': return ['Ulagrede endringer', 'venter'];
    case 'lagrer': return ['Lagrer …', 'venter'];
    case 'feil': return ['Lagring feilet', 'feil'];
    default: return ['', ''];
  }
}

function oppdaterStatus() {
  if (!statusEl) return;
  const [tekst, klasse] = statusTekst();
  statusEl.textContent = tekst;
  statusEl.className = `lagrestatus ${klasse}`;
  statusEl.title = store.feil || '';
  if (store.status === 'feil') toast(`Lagring feilet: ${store.feil}`, 'feil');
}

// Lås automatisk etter en periode uten aktivitet når nøkkelen ikke er husket på enheten.
function startAutolas() {
  if (store.vault.husket) return;
  let timer;
  const nullstill = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => { await store.save(); location.reload(); }, AUTOLAS_MIN * 60000);
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, nullstill, { passive: true });
  nullstill();
}

export async function lasApp() {
  await store.save();
  await store.vault.forgetKey();
  location.reload();
}

function visApp() {
  clear(app);
  app.className = 'app';
  statusEl = h('button.lagrestatus', { type: 'button', onclick: () => store.save() });
  const nav = h('nav.hovednav', { 'aria-label': 'Hovedmeny' }, RUTER.map((r) => h('a', { href: `#/${r.sti}`, 'data-sti': r.sti }, r.navn)));
  hoved = h('main.innhold', { id: 'innhold', tabindex: '-1' });
  app.append(
    h('header.topp',
      h('a.logo', { href: '#/oversikt' }, 'FinSys'),
      nav,
      h('div.topp-hoyre', statusEl, h('button.ikon-knapp', { type: 'button', title: 'Lås', 'aria-label': 'Lås', onclick: lasApp }, '🔒'))),
    hoved
  );
  store.on((k) => { if (k === 'status') oppdaterStatus(); });
  oppdaterStatus();
  startAutolas();
  window.addEventListener('hashchange', ruter);
  window.addEventListener('beforeunload', (e) => {
    if (store.ulagret()) { store.save(); e.preventDefault(); e.returnValue = ''; }
  });
  ruter();
}

export function parseHash() {
  const [sti, q] = location.hash.replace(/^#\/?/, '').split('?');
  return { sti: sti || 'oversikt', params: Object.fromEntries(new URLSearchParams(q || '')) };
}

export function ruter() {
  const { sti, params } = parseHash();
  const r = RUTER.find((x) => x.sti === sti) || RUTER[0];
  for (const a of document.querySelectorAll('.hovednav a')) {
    a.classList.toggle('aktiv', a.dataset.sti === r.sti);
    const rute = RUTER.find((x) => x.sti === a.dataset.sti);
    a.hidden = !!rute?.skjult?.(store.db) && a.dataset.sti !== r.sti;
    if (a.dataset.sti === r.sti) a.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  clear(hoved);
  window.scrollTo(0, 0);
  document.title = `${r.navn} – FinSys`;
  try {
    r.vis.render(hoved, params);
  } catch (e) {
    console.error(e);
    hoved.append(h('p.feil', `Noe gikk galt: ${e.message}`));
  }
}

// Installerbar app: service worker for offline-start (bare appens egne filer mellomlagres)
let installHendelse = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installHendelse = e; });
window.addEventListener('appinstalled', () => { installHendelse = null; });
export const kanInstallere = () => !!installHendelse;
export const erInstallert = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export async function installer() {
  if (!installHendelse) return false;
  installHendelse.prompt();
  const { outcome } = await installHendelse.userChoice;
  installHendelse = null;
  return outcome === 'accepted';
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

start();
