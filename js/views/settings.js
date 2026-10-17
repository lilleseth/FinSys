// Innstillinger: datalager, import/eksport, kontoer, kategorier og skatteparametre.

import { h, clear, uid, slug, lesBelop, lastNed, datoNo } from '../util.js';
import { felt, velg, dialog, bekreft, sideTopp, toast } from '../ui.js';
import { store } from '../store.js';
import { lesRegneark, migrer } from '../import/migrate.js';
import { TYPER, TYPE_FORKLARING } from '../model/categories.js';
import { kobleFra, lasApp, hentTilkobling, oppdaterMetaCache, visKodeDialog, etterRotasjon, AUTOLAS_MIN, kanInstallere, erInstallert, installer } from '../main.js';
import { passordProblem } from '../crypto.js';
import { satserFor } from '../model/tax.js';
import { r2 } from '../model/calc.js';
import { xlsx, regnearkFraDb } from '../model/export.js';
import { lagKalender } from '../model/ical.js';

const KONTO_TYPER = { brukskonto: 'Brukskonto', sparekonto: 'Sparekonto', bsu: 'BSU', kredittkort: 'Kredittkort', annet: 'Annet' };

export function render(el, params) {
  const db = store.db;
  const tegnPaNytt = () => { clear(el); render(el, {}); };
  const t = hentTilkobling() || {};

  el.append(sideTopp('Innstillinger'));

  // Import
  const filInput = h('input', { type: 'file', accept: '.xlsx', hidden: true, onchange: (e) => importerRegneark(e.target.files[0]) });
  const jsonInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => importerJson(e.target.files[0]) });
  const importKort = h('section.kort#import',
    h('h2', 'Import'),
    h('p', 'Importer regnearket «Privatøkonomisk oversikt» (.xlsx). Transaksjoner, kontoer, formue, gjeld, formueshistorikk, lønnsslipper og notater flyttes over, og kategoriene oversettes til den nye strukturen.'),
    h('div.knapperad', h('button.primar', { type: 'button', onclick: () => filInput.click() }, 'Velg regneark (.xlsx)'), filInput),
    h('p.dempet', 'Kontoutskrifter og kortfakturaer (CSV, Excel og PDF) importeres under ', h('a', { href: '#/import' }, 'Import'), '.'));
  el.append(importKort);
  if (params.vis === 'import') requestAnimationFrame(() => importKort.scrollIntoView({ block: 'start' }));

  // Datalager
  el.append(h('section.kort',
    h('h2', 'Datalager og sikkerhet'),
    h('dl.fakta',
      h('dt', 'Lagring'), h('dd', store.vault.backend.label),
      t.type === 'github' ? [h('dt', 'Gren'), h('dd', t.branch || 'standard')] : null,
      h('dt', 'Kryptering'), h('dd', store.vault.meta.format === 2 ? 'AES-256-GCM med tilfeldig datanøkkel, pakket inn med passordet (PBKDF2-SHA256, 600 000 runder). Filene er bundet til filstien.' : 'AES-256-GCM, nøkkel fra passord (eldre format – oppgraderes når du skriver passordet)'),
      h('dt', 'Gjenopprettingsnøkkel'), h('dd', gjenoppTekst()),
      h('dt', 'Denne enheten'), h('dd', store.vault.husket ? 'Husket – forblir ulåst til du trykker «Lås nå»' : `Ikke husket – låses etter ${AUTOLAS_MIN} min uten aktivitet og når fanen lukkes`),
      t.type === 'github' ? [h('dt', 'Token'), h('dd', t.tokenEnc ? 'Lagret kryptert i nettleseren (kan bare leses etter opplåsing)' : 'Lagret i klartekst – lås opp med passord for å kryptere den')] : null,
      t.type === 'github' ? [h('dt', 'Token utløper'), h('dd', h('input.dato-liten', { type: 'date', value: db.innstillinger.tokenUtloper || '', 'aria-label': 'Tokenens utløpsdato', onchange: (e) => { db.innstillinger.tokenUtloper = e.target.value || null; store.changed(); } }), h('span.dempet', ' Du får en påminnelse tre uker før (se «Expiration» på github.com → Settings → Developer settings → Fine-grained tokens)'))] : null,
      h('dt', 'Data'), h('dd', `${db.transaksjoner.length} transaksjoner · ${db.formue.poster.length} formuesposter · ${db.notater.length} notater`)),
    t.type === 'lokal' ? h('p.advarsel', 'Du bruker lokal lagring. Dataene finnes bare i denne nettleseren og forsvinner hvis nettleserdata slettes. Koble til GitHub for varig lagring.') : null,
    h('div.knapperad',
      h('button.sekundar', { type: 'button', onclick: lasApp }, 'Lås nå'),
      store.vault.meta.format === 2 ? h('button.sekundar', { type: 'button', onclick: byttPassord }, 'Bytt passord') : null,
      store.vault.meta.format === 2 ? h('button.sekundar', { type: 'button', onclick: nyGjenoppretting }, store.vault.harGjenoppretting ? 'Lag ny gjenopprettingsnøkkel' : 'Lag gjenopprettingsnøkkel') : null,
      h('button.sekundar', { type: 'button', onclick: eksporter }, 'Last ned sikkerhetskopi'),
      h('button.sekundar', { type: 'button', onclick: () => jsonInput.click() }, 'Gjenopprett fra sikkerhetskopi'), jsonInput,
      h('button.fare', { type: 'button', onclick: async () => {
        if (await bekreft('Koble fra denne enheten?', 'Token og lagret nøkkel fjernes fra denne nettleseren. Dataene i GitHub-repoet berøres ikke.', 'Koble fra')) {
          await store.save();
          await store.vault.forgetKey();
          kobleFra();
        }
      } }, 'Koble fra denne enheten')),
    store.vault.meta.format === 2 ? h('details.avansert', h('summary', 'Avansert: roter datanøkkel'),
      h('p', 'Lager en ny datanøkkel og krypterer alle data og dokumenter på nytt. Gjør dette hvis du tror et tidligere passord eller en gjenopprettingsnøkkel kan være lekket – da kan heller ikke gamle versjoner i GitHub-historikken leses med den nye nøkkelen. Du får en ny gjenopprettingsnøkkel, og andre enheter må kobles til på nytt med tokenen.'),
      h('button.sekundar', { type: 'button', onclick: roter }, 'Roter datanøkkel …')) : null));

  // Eksport
  const medBelop = h('input', { type: 'checkbox', checked: true });
  const dato = () => new Date().toISOString().slice(0, 10);
  el.append(h('section.kort',
    h('h2', 'Eksport'),
    h('p', 'Regnearket inneholder transaksjoner, kontantstrøm per måned, formue, verdihistorikk, formueshistorikk, budsjett, faste poster og lønnsslipper. Kalenderfilen har faste trekk og inntekter, planlagte poster, skattefrister, sparemål, huskeliste, garantier og tokenutløp – åpne den på mobilen for å legge hendelsene inn i kalenderen.'),
    h('div.knapperad',
      h('button.sekundar', { type: 'button', onclick: () => {
        lastNed(`finsys-${dato()}.xlsx`, xlsx(regnearkFraDb(db)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        toast('Regneark lastet ned');
      } }, 'Last ned regneark (.xlsx)'),
      h('button.sekundar', { type: 'button', onclick: () => {
        const k = lagKalender(db, { medBelop: medBelop.checked });
        lastNed(`finsys-kalender-${dato()}.ics`, k.tekst, 'text/calendar;charset=utf-8');
        toast(`Kalender med ${k.antall} hendelser lastet ned`);
      } }, 'Last ned kalender (.ics)'),
      h('a.knapp.sekundar', { href: '#/transaksjoner' }, 'CSV fra transaksjoner')),
    h('label.avkryss', medBelop, ' Ta med beløp i kalenderen'),
    h('p.dempet', 'Filene er ukrypterte. Kalendere synkroniseres ofte til iCloud/Google – fjern haken over hvis du ikke vil ha beløp der.')));

  // Felles husholdning
  el.append(h('section.kort',
    h('h2', 'Felles husholdning'),
    h('p', db.husholdning?.aktiv ? `Slått på – felles med ${db.husholdning.partner || 'partner'}.` : 'Del utgifter med en annen person: velg felles kategorier/kontoer, registrer den andres utlegg og hold oversikt over oppgjør. Økonomien din forblir ellers separat.'),
    h('div.knapperad', h('a.knapp.sekundar', { href: '#/husholdning' }, db.husholdning?.aktiv ? 'Åpne husholdning' : 'Sett opp husholdning'))));

  // Installer som app
  el.append(h('section.kort',
    h('h2', 'Installer som app'),
    erInstallert()
      ? h('p', 'FinSys kjører som installert app på denne enheten.')
      : [h('p', 'FinSys kan legges på hjemskjermen eller i programmenyen og åpnes som en egen app – også uten nett (da vises sist lagrede versjon av appen, men data krever nett når du bruker GitHub).'),
        kanInstallere() ? h('div.knapperad', h('button.primar', { type: 'button', onclick: async () => { if (await installer()) toast('FinSys er installert'); tegnPaNytt(); } }, 'Installer FinSys')) : null,
        h('ul.dempet',
          h('li', 'iPhone/iPad (Safari): trykk Del-knappen → «Legg til på Hjem-skjerm».'),
          h('li', 'Android (Chrome): meny ⋮ → «Installer app» eller «Legg til på startskjermen».'),
          h('li', 'PC/Mac (Chrome/Edge): installer-ikonet i adressefeltet, eller meny → «Installer FinSys».'))],
    h('p.dempet', 'Låsing, kryptering og passord fungerer på samme måte i appen. Velg «Husk meg» bare på enheter du har kontroll over.')));

  // Kontoer
  el.append(h('section.kort',
    h('div.kort-topp', h('h2', 'Kontoer'), h('button.sekundar.liten', { type: 'button', onclick: () => redigerKonto(null) }, '+ Ny konto')),
    db.kontoer.length
      ? h('div.tabell-holder', h('table.tabell', h('thead', h('tr', h('th', 'Navn'), h('th', 'Type'), h('th', 'Bank'), h('th.tall', 'Transaksjoner'))),
        h('tbody', db.kontoer.map((k) => h('tr.klikkbar', { onclick: () => redigerKonto(k) },
          h('td', k.navn), h('td', KONTO_TYPER[k.type] || k.type), h('td', k.bank || '–'),
          h('td.tall', String(db.transaksjoner.filter((x) => x.konto === k.id).length)))))))
      : h('p.dempet', 'Ingen kontoer ennå.')));

  // Skatt og antakelser
  const s = db.innstillinger.skatt;
  const inp = {
    rentefradrag: h('input', { value: pctStr(s.rentefradrag), inputmode: 'decimal' }),
    bunnfradrag: h('input', { value: String(s.bunnfradrag ?? ''), inputmode: 'numeric' }),
    sats: h('input', { value: pctStr(s.formuesskattSats), inputmode: 'decimal' }),
    rabatt: h('input', { value: pctStr(s.rabattAksjer), inputmode: 'decimal' }),
    nodvendig: h('input', { value: db.innstillinger.nodvendigeUtgifterPerMnd ?? '', inputmode: 'numeric' }),
    minstesaldo: h('input', { value: db.innstillinger.minstesaldo ?? '', inputmode: 'numeric', placeholder: 'samme som nødvendige utgifter' }),
  };
  el.append(h('section.kort',
    h('h2', 'Skatt og antakelser'),
    h('form.skjema.to-kol', { onsubmit: (e) => e.preventDefault(), onchange: () => {
      const p = (x) => { const v = lesBelop(x.value); return v == null ? null : v / 100; };
      s.rentefradrag = p(inp.rentefradrag) ?? 0.22;
      s.bunnfradrag = lesBelop(inp.bunnfradrag.value) ?? 1900000;
      s.formuesskattSats = p(inp.sats) ?? 0.01;
      s.rabattAksjer = p(inp.rabatt) ?? 0.2;
      db.innstillinger.nodvendigeUtgifterPerMnd = lesBelop(inp.nodvendig.value);
      db.innstillinger.minstesaldo = lesBelop(inp.minstesaldo.value);
      store.changed();
      toast('Innstillinger lagret');
    } },
    felt('Rentefradrag (%)', inp.rentefradrag, 'Skatteverdi av gjeldsrenter (22 % i 2026)'),
    felt('Bunnfradrag formuesskatt (kr)', inp.bunnfradrag),
    felt('Formuesskattesats (%)', inp.sats),
    felt('Verdsettelsesrabatt aksjer/fond (%)', inp.rabatt),
    felt('Nødvendige utgifter per måned (kr)', inp.nodvendig, 'Brukes til å regne ut hvor mange måneder bufferen dekker'),
    felt('Minstesaldo i prognosen (kr)', inp.minstesaldo, 'Du varsles hvis prognosen viser lavere saldo enn dette'))));

  el.append(skattesatserKort());

  // Kategorier
  const katListe = h('div.kategorier');
  for (const g of db.kategorier) {
    const brukt = (id) => db.transaksjoner.filter((x) => x.kategori === id).length;
    const navn = h('input.kat-navn', { value: g.navn, 'aria-label': 'Navn på hovedkategori', onchange: (e) => { g.navn = e.target.value.trim() || g.navn; store.changed(); } });
    const type = velg(Object.entries(TYPER).map(([v, tk]) => ({ verdi: v, tekst: tk })), g.type, { 'aria-label': 'Type', title: TYPE_FORKLARING[g.type], onchange: (e) => { g.type = e.target.value; store.changed(); } });
    const subs = h('ul.kat-under', g.under.map((u) => h('li',
      h('input', { value: u.navn, 'aria-label': 'Navn på underkategori', onchange: (e) => { u.navn = e.target.value.trim() || u.navn; store.changed(); } }),
      h('span.dempet', `${brukt(u.id)} stk`),
      h('button.lenke', { type: 'button', onclick: async () => {
        const n = brukt(u.id);
        if (n) { toast(`Kan ikke slette – ${n} transaksjoner bruker kategorien. Flytt dem først.`, 'feil'); return; }
        if (!(await bekreft('Slette underkategori?', `«${u.navn}» slettes.`, 'Slett'))) return;
        g.under.splice(g.under.indexOf(u), 1);
        store.changed();
        tegnPaNytt();
      } }, 'slett'))));
    katListe.append(h('details.kat-gruppe', h('summary', h('strong', g.navn), h('span.dempet', ` · ${TYPER[g.type]} · ${g.under.length} underkategorier`)),
      h('div.kat-rad', navn, type),
      subs,
      h('button.lenke', { type: 'button', onclick: () => {
        const nyNavn = prompt('Navn på ny underkategori');
        if (!nyNavn) return;
        let id = `${g.id}/${slug(nyNavn)}`;
        if (g.under.some((u) => u.id === id)) id += '-' + uid().slice(0, 4);
        g.under.push({ id, navn: nyNavn.trim() });
        store.changed();
        tegnPaNytt();
      } }, '+ underkategori')));
  }
  el.append(h('section.kort',
    h('div.kort-topp', h('h2', 'Kategorier'), h('button.sekundar.liten', { type: 'button', onclick: () => {
      const nyNavn = prompt('Navn på ny hovedkategori');
      if (!nyNavn) return;
      let id = slug(nyNavn);
      if (db.kategorier.some((k) => k.id === id)) id += '-' + uid().slice(0, 4);
      db.kategorier.push({ id, navn: nyNavn.trim(), type: 'utgift', under: [{ id: `${id}/annet`, navn: 'Generelt' }] });
      store.changed();
      tegnPaNytt();
    } }, '+ Hovedkategori')),
    h('p.dempet', 'Typen bestemmer hvordan kategorien telles: inntekt, forbruk, nøytral (refusjoner/oppgjør), sparing eller overføring (teller ikke).'),
    katListe));

  // --- Skattesatser ---

  function skattesatserKort() {
    const aar = Number(params.skatteaar || new Date().getFullYear());
    const s0 = satserFor(db, aar);
    const egne = db.innstillinger.skattesatser?.[aar];
    const tall = (v) => h('input', { inputmode: 'decimal', value: String(v).replace('.', ',') });
    const f = {
      personfradrag: tall(s0.personfradrag),
      minsteMaks: tall(s0.minstefradrag.maks),
      trygd: tall(r2(s0.trygdeavgift.sats * 100)),
      bunnfradrag: tall(s0.formue.bunnfradrag),
      fagforening: tall(s0.fagforeningMaks),
      trinn: s0.trinn.map(([g, sats]) => [tall(g), tall(r2(sats * 100))]),
    };
    const lagre = () => {
      const n = (x) => lesBelop(x.value);
      db.innstillinger.skattesatser ||= {};
      db.innstillinger.skattesatser[aar] = {
        personfradrag: n(f.personfradrag),
        minstefradrag: { ...s0.minstefradrag, maks: n(f.minsteMaks) },
        trygdeavgift: { ...s0.trygdeavgift, sats: n(f.trygd) / 100 },
        formue: { ...s0.formue, bunnfradrag: n(f.bunnfradrag) },
        fagforeningMaks: n(f.fagforening),
        trinn: f.trinn.map(([g, sats]) => [n(g), n(sats) / 100]),
      };
      store.changed();
      toast(`Skattesatser for ${aar} lagret`);
      clear(el);
      render(el, { skatteaar: aar });
    };
    return h('section.kort',
      h('div.kort-topp', h('h2', `Skattesatser ${aar}`), velg([aar - 1, aar, aar + 1].map((a) => ({ verdi: String(a), tekst: String(a) })), String(aar), { 'aria-label': 'År', onchange: (e) => { clear(el); render(el, { skatteaar: e.target.value }); } })),
      h('p.dempet', egne ? 'Du bruker egne satser for dette året.' : `Forhåndsutfylt: ${s0.kilde}${s0.estimert ? ' (satser for et tidligere år – oppdater når statsbudsjettet er vedtatt)' : ''}. Kontroller mot skatteetaten.no.`),
      h('form.skjema.to-kol', { onsubmit: (e) => e.preventDefault() },
        felt('Personfradrag (kr)', f.personfradrag), felt('Minstefradrag, maks (kr)', f.minsteMaks),
        felt('Trygdeavgift lønn (%)', f.trygd), felt('Bunnfradrag formuesskatt (kr)', f.bunnfradrag),
        felt('Fagforeningsfradrag, maks (kr)', f.fagforening),
        h('div.hel', h('h3', 'Trinnskatt (innslagspunkt og sats)'),
          h('div.trinn-tabell', f.trinn.map(([g, sats], i) => h('div.trinn-rad', h('span', `Trinn ${i + 1}`), g, sats, h('span', '%'))))),
        h('div.hel.knapperad',
          h('button.primar', { type: 'button', onclick: lagre }, 'Lagre satser'),
          egne ? h('button.sekundar', { type: 'button', onclick: () => { delete db.innstillinger.skattesatser[aar]; store.changed(); tegnPaNytt(); } }, 'Tilbake til standard') : null)));
  }

  // --- Sikkerhet ---

  function gjenoppTekst() {
    const n = store.vault.meta.format === 2 && store.vault.meta.nokler.find((x) => x.type === 'gjenoppretting');
    return n ? `Laget ${datoNo((n.opprettet || '').slice(0, 10)) || 'tidligere'}` : 'Mangler – lag en nå, ellers er dataene tapt om du glemmer passordet';
  }

  function byttPassord() {
    const gammelt = h('input', { type: 'password', autocomplete: 'current-password' });
    const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
    dialog({
      tittel: 'Bytt passord',
      innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
        felt('Nåværende passord', gammelt), felt('Nytt passord (minst 12 tegn)', p1), felt('Gjenta nytt passord', p2),
        h('p.dempet', 'Andre enheter må låses opp med det nye passordet. Får du «feil passord» der, velg «Bytt datalager» og koble til på nytt.')),
      knapper: [{ tekst: 'Avbryt' }, { tekst: 'Bytt passord', type: 'primar', onclick: async () => {
        const problem = passordProblem(p1.value, [hentTilkobling()?.owner]);
        if (problem) { toast(problem, 'feil'); return false; }
        if (p1.value !== p2.value) { toast('Passordene er ikke like', 'feil'); return false; }
        try {
          await store.vault.byttPassord({ passord: gammelt.value }, p1.value);
          oppdaterMetaCache();
          toast('Passordet er byttet');
          tegnPaNytt();
        } catch (e) { toast(e.message, 'feil'); return false; }
      } }],
    });
  }

  function nyGjenoppretting() {
    const pw = h('input', { type: 'password', autocomplete: 'current-password' });
    dialog({
      tittel: 'Ny gjenopprettingsnøkkel',
      innhold: h('div', h('p', 'En ny nøkkel erstatter den gamle – den gamle slutter å virke. Skriv passordet for å fortsette.'), felt('Passord', pw)),
      knapper: [{ tekst: 'Avbryt' }, { tekst: 'Lag nøkkel', type: 'primar', onclick: async () => {
        try {
          const kode = await store.vault.lagGjenoppretting({ passord: pw.value });
          oppdaterMetaCache();
          visKodeDialog(kode);
          tegnPaNytt();
        } catch (e) { toast(e.message, 'feil'); return false; }
      } }],
    });
  }

  function roter() {
    const pw = h('input', { type: 'password', autocomplete: 'current-password' });
    const status = h('p.dempet');
    dialog({
      tittel: 'Roter datanøkkel',
      innhold: h('div', h('p', 'Alt krypteres på nytt. Ikke lukk siden mens det pågår. Blir det avbrutt, fullføres det neste gang du låser opp med passord.'), felt('Passord', pw), status),
      knapper: [{ tekst: 'Avbryt' }, { tekst: 'Roter nå', type: 'fare', onclick: async () => {
        try {
          await store.save();
          const kode = await store.vault.roterNokkel(pw.value, store.db, (t) => { status.textContent = t; });
          await etterRotasjon();
          toast('Ny datanøkkel er tatt i bruk');
          visKodeDialog(kode);
          tegnPaNytt();
        } catch (e) { toast(e.message, 'feil'); return false; }
      } }],
    });
  }

  // --- Handlinger ---

  async function importerRegneark(fil) {
    if (!fil) return;
    filInput.value = '';
    let res;
    try {
      res = migrer(await lesRegneark(await fil.arrayBuffer()));
    } catch (e) {
      console.error(e);
      toast(`Kunne ikke lese regnearket: ${e.message}`, 'feil');
      return;
    }
    const harData = db.transaksjoner.length || db.formue.poster.length;
    dialog({
      tittel: 'Importer regneark',
      bred: true,
      innhold: h('div',
        h('p', h('strong', fil.name)),
        h('ul', res.logg.map((l) => h('li', l))),
        res.advarsler.length ? h('details', h('summary', `${res.advarsler.length} advarsler`), h('ul', res.advarsler.slice(0, 50).map((a) => h('li', a)))) : null,
        harData ? h('p.advarsel', 'Du har allerede data i FinSys. Importen erstatter transaksjoner, kontoer, formue, lønnsslipper og notater. Kategorier og innstillinger beholdes. Last gjerne ned en sikkerhetskopi først.') : null),
      knapper: [{ tekst: 'Avbryt' }, { tekst: harData ? 'Erstatt og importer' : 'Importer', type: harData ? 'fare' : 'primar', onclick: async () => {
        const d = res.data;
        db.kontoer = d.kontoer;
        db.transaksjoner = d.transaksjoner;
        db.formue = d.formue;
        db.inntekt = d.inntekt;
        db.notater = d.notater;
        if (d.innstillinger.nodvendigeUtgifterPerMnd != null) db.innstillinger.nodvendigeUtgifterPerMnd = d.innstillinger.nodvendigeUtgifterPerMnd;
        Object.assign(db.innstillinger.skatt, d.innstillinger.skatt);
        store.changed();
        await store.save();
        toast(store.status === 'lagret' ? 'Import fullført og lagret' : 'Import fullført – lagring venter', store.status === 'feil' ? 'feil' : 'info');
        location.hash = '#/oversikt';
      } }],
    });
  }

  function eksporter() {
    dialog({
      tittel: 'Last ned sikkerhetskopi',
      innhold: h('div', h('p', 'Filen inneholder alle dataene dine ukryptert. Oppbevar den trygt (f.eks. kryptert disk eller passordbeskyttet mappe) og slett den når du ikke trenger den.'), h('p.dempet', 'Data-repoet på GitHub er allerede en kryptert sikkerhetskopi med full historikk, så denne filen trengs bare som ekstra kopi.')),
      knapper: [{ tekst: 'Avbryt' }, { tekst: 'Last ned', type: 'primar', onclick: () => {
        const dato = new Date().toISOString().slice(0, 10);
        lastNed(`finsys-sikkerhetskopi-${dato}.json`, JSON.stringify({ format: 'finsys-sikkerhetskopi', versjon: 1, eksportert: new Date().toISOString(), db }, null, 1));
      } }],
    });
  }

  async function importerJson(fil) {
    if (!fil) return;
    jsonInput.value = '';
    let data;
    try {
      data = JSON.parse(await fil.text());
      if (data.format !== 'finsys-sikkerhetskopi' || !data.db?.transaksjoner) throw new Error('Ikke en FinSys-sikkerhetskopi');
    } catch (e) {
      toast(`Ugyldig fil: ${e.message}`, 'feil');
      return;
    }
    if (!(await bekreft('Gjenopprette?', `Alle nåværende data erstattes med sikkerhetskopien fra ${data.eksportert?.slice(0, 10) || 'ukjent dato'} (${data.db.transaksjoner.length} transaksjoner).`, 'Gjenopprett'))) return;
    for (const k of Object.keys(db)) delete db[k];
    Object.assign(db, data.db);
    store.changed();
    await store.save();
    toast('Sikkerhetskopi gjenopprettet');
    location.hash = '#/oversikt';
  }

  function redigerKonto(konto) {
    const ny = !konto;
    const k = konto || { id: '', navn: '', type: 'brukskonto', bank: '', aktiv: true };
    const navn = h('input', { value: k.navn, required: true });
    const type = velg(Object.entries(KONTO_TYPER).map(([v, tk]) => ({ verdi: v, tekst: tk })), k.type);
    const bank = h('input', { value: k.bank || '' });
    const kontonr = h('input', { value: k.kontonr || '', placeholder: 'valgfritt – brukes til å kjenne igjen bankfiler' });
    const knapper = [];
    const antall = db.transaksjoner.filter((x) => x.konto === k.id).length;
    if (!ny) knapper.push({ tekst: 'Slett', type: 'fare venstre', onclick: async () => {
      if (antall) { toast(`Kontoen har ${antall} transaksjoner og kan ikke slettes.`, 'feil'); return false; }
      db.kontoer.splice(db.kontoer.indexOf(konto), 1);
      store.changed();
      tegnPaNytt();
    } });
    knapper.push({ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: () => {
      if (!navn.value.trim()) return false;
      Object.assign(k, { navn: navn.value.trim(), type: type.value, bank: bank.value.trim(), kontonr: kontonr.value.trim() });
      if (ny) {
        let id = slug(k.navn);
        if (db.kontoer.some((x) => x.id === id)) id += '-' + uid().slice(0, 4);
        k.id = id;
        db.kontoer.push(k);
      }
      store.changed();
      tegnPaNytt();
    } });
    dialog({ tittel: ny ? 'Ny konto' : k.navn, innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() }, felt('Navn', navn), felt('Type', type), felt('Bank', bank), felt('Kontonummer', kontonr)), knapper });
  }
}

function pctStr(v) {
  return v == null ? '' : String(Math.round(v * 10000) / 100).replace('.', ',');
}

