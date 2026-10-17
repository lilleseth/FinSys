// Import av bankfiler (CSV/Excel/PDF), avstemming mot saldo og kategoriseringsregler.

import { h, clear, kr, datoNo, uid, slug, lesBelop } from '../util.js';
import { felt, velg, kategoriValg, dialog, bekreft, sideTopp, toast } from '../ui.js';
import { store } from '../store.js';
import { lesBankfil, generisk } from '../import/parsers.js';
import { finnKonto, merkDuplikater, foreslåAlle, tilTransaksjoner } from '../import/importer.js';
import { kategoriIndeks } from '../model/categories.js';
import { verdiPa } from '../model/calc.js';
import { lastOppDokument } from '../model/documents.js';
import { erLastTransaksjon } from '../model/years.js';

const SIKKERHET = {
  regel: ['Regel', 'sik-regel'],
  hoy: ['Sikker', 'sik-hoy'],
  middels: ['Sannsynlig', 'sik-middels'],
  lav: ['Usikker', 'sik-lav'],
  '': ['Ingen forslag', 'sik-ingen'],
};

const KONTO_TYPE_FRA_HINT = { bank: 'brukskonto', kredittkort: 'kredittkort' };

export function render(el) {
  const db = store.db;
  const filer = h('div.import-filer');
  const velger = h('input', { type: 'file', multiple: true, accept: '.csv,.txt,.xlsx,.pdf', hidden: true, onchange: (e) => { behandle([...e.target.files]); e.target.value = ''; } });
  const sone = h('div.slippsone', {
    tabindex: 0,
    role: 'button',
    'aria-label': 'Velg filer å importere',
    onclick: () => velger.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); velger.click(); } },
    ondragover: (e) => { e.preventDefault(); sone.classList.add('over'); },
    ondragleave: () => sone.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); sone.classList.remove('over'); behandle([...e.dataTransfer.files]); },
  },
  h('strong', 'Slipp filer her, eller klikk for å velge'),
  h('span', 'Nordea kontoutskrift (CSV) · kortfakturaer fra Nordea, DNB og Trumf (PDF) · andre CSV/Excel-filer'),
  velger);

  el.append(
    sideTopp('Import', 'Last opp kontoutskrifter og kortfakturaer. Duplikater hoppes over automatisk, og kategorier foreslås ut fra historikken.'),
    sone,
    filer,
    sistOppdatert(),
    avstemming(),
    reglerKort());

  async function behandle(liste) {
    for (const fil of liste) {
      const kort = h('section.kort.fil-kort', h('div.kort-topp', h('h2', fil.name), h('span.dempet', 'Leser …')));
      filer.prepend(kort);
      try {
        const res = await lesBankfil(fil);
        visFil(kort, res, fil);
      } catch (e) {
        console.error(e);
        clear(kort).append(h('div.kort-topp', h('h2', fil.name), h('button.lenke', { type: 'button', onclick: () => kort.remove() }, 'lukk')), h('p.feil', e.message));
      }
    }
  }

  function visFil(kort, res, fil) {
    let kontoId = finnKonto(db, res.kontoHint);
    let visDup = false;
    const allerede = db.dokumenter.find((d) => d.filnavn === fil.name && d.storrelse === fil.size);
    let arkiver = !allerede;

    const forbered = () => {
      if (!kontoId) return;
      merkDuplikater(res.rader, db, kontoId);
      foreslåAlle(res.rader.filter((r) => !r.duplikat), db, kontoId);
      for (const r of res.rader) if (r.velg === undefined) r.velg = true;
    };
    forbered();

    const tegn = () => {
      const nye = res.rader.filter((r) => !r.duplikat);
      const dup = res.rader.filter((r) => r.duplikat);
      const kontoValg = velg([{ verdi: '', tekst: '— velg konto —' }, ...db.kontoer.map((k) => ({ verdi: k.id, tekst: k.navn })), { verdi: '__ny', tekst: '+ Ny konto …' }], kontoId, {
        'aria-label': 'Konto',
        onchange: (e) => {
          if (e.target.value === '__ny') {
            const navn = prompt('Navn på ny konto', res.kontoHint.navn || '');
            if (!navn) { e.target.value = kontoId; return; }
            const id = db.kontoer.some((k) => k.id === slug(navn)) ? `${slug(navn)}-${uid().slice(0, 4)}` : slug(navn);
            db.kontoer.push({ id, navn: navn.trim(), type: KONTO_TYPE_FRA_HINT[res.kontoHint.type] || 'annet', bank: '', aktiv: true });
            store.changed();
            kontoId = id;
          } else kontoId = e.target.value;
          for (const r of res.rader) { delete r.duplikat; delete r.forslag; }
          forbered();
          tegn();
        },
      });
      const antallValgt = nye.filter((r) => r.velg).length;
      const importKnapp = h('button.primar', { type: 'button', disabled: !kontoId || !antallValgt, onclick: importer }, `Importer ${antallValgt} transaksjoner`);

      const rader = nye.map((r) => h('tr', { class: r.velg ? '' : 'valgt-bort' },
        h('td', h('input', { type: 'checkbox', checked: r.velg, 'aria-label': 'Ta med', onchange: (e) => { r.velg = e.target.checked; tegn(); } })),
        h('td.dato', datoNo(r.dato), r.betalt && r.betalt !== r.dato ? h('small', `betales ${datoNo(r.betalt)}`) : null),
        h('td.tekst', h('div', r.tekst), r.tekstRa !== r.tekst ? h('small', r.tekstRa) : null),
        h('td.kategori',
          kategoriValg(db.kategorier, r.kategori, { 'aria-label': 'Kategori', class: r.kategori ? '' : 'kat-valg', onchange: (e) => { r.kategori = e.target.value; r.forslag = { ...r.forslag, sikkerhet: 'manuell' }; tegn(); } }),
          r.forslag && r.forslag.sikkerhet !== 'manuell' ? h('span.sikkerhet', { class: SIKKERHET[r.forslag.sikkerhet]?.[1], title: r.forslag.grunn }, SIKKERHET[r.forslag.sikkerhet]?.[0]) : null),
        h('td.belop', { class: r.belop < 0 ? 'neg' : 'pos' }, kr(r.belop, true))));

      const mangler = nye.filter((r) => r.velg && !r.kategori).length;
      clear(kort).append(h('div.fil-innhold',
        h('div.kort-topp', h('h2', res.filnavn), h('button.lenke', { type: 'button', onclick: () => kort.remove() }, 'lukk')),
        h('p.dempet', [res.formatNavn, res.periode ? `${datoNo(res.periode.fra)}–${datoNo(res.periode.til)}` : '', res.forfall ? `forfall ${datoNo(res.forfall)}` : ''].filter(Boolean).join(' · ')),
        h('div.import-topp', felt('Konto', kontoValg), h('div.import-tall',
          h('span', h('strong', String(res.rader.length)), ' i filen'),
          h('span', h('strong', String(dup.length)), ' allerede importert'),
          h('span', h('strong', String(nye.length)), ' nye'),
          res.ignorert.length ? h('span', { title: res.ignorert.map((x) => `${datoNo(x.dato)} ${x.tekst} ${kr(x.belop, true)} – ${x.grunn}`).join('\n') }, h('strong', String(res.ignorert.length)), ' innbetalinger hoppet over') : null)),
        res.kontroll.map((k) => h('p', { class: k.ok ? 'kontroll-ok' : 'advarsel' },
          k.ok ? `✓ ${k.navn} stemmer med fakturaen (${kr(k.forventet, true)} kr)` : `⚠ ${k.navn}: fakturaen sier ${kr(k.forventet, true)} kr, men radene summerer til ${kr(k.faktisk, true)} kr. Sjekk at alle linjer ble lest.`)),
        res.format === 'generisk' ? kolonneValg() : null,
        !kontoId ? h('p.advarsel', 'Velg hvilken konto filen gjelder for å se duplikater og forslag.') : null,
        nye.length && kontoId
          ? h('div.tabell-holder', h('table.tabell.transaksjoner.import-tabell',
            h('thead', h('tr', h('th', h('input', { type: 'checkbox', checked: nye.every((r) => r.velg), 'aria-label': 'Velg alle', onchange: (e) => { for (const r of nye) r.velg = e.target.checked; tegn(); } })), h('th', 'Dato'), h('th', 'Tekst'), h('th', 'Kategori'), h('th.hoyre', 'Beløp'))),
            h('tbody', rader)))
          : kontoId ? h('p.kontroll-ok', '✓ Alt i filen er allerede importert.') : null,
        dup.length ? h('button.lenke', { type: 'button', onclick: () => { visDup = !visDup; tegn(); } }, visDup ? 'Skjul duplikater' : `Vis ${dup.length} duplikater`) : null,
        visDup ? h('ul.dup-liste', dup.map((r) => h('li', `${datoNo(r.dato)} · ${r.tekst} · ${kr(r.belop, true)}`))) : null,
        kontoId ? h('div.knapperad.import-handling',
          allerede ? h('span.dempet', '📄 Filen finnes allerede i dokumentarkivet') : h('label.avkryss', h('input', { type: 'checkbox', checked: arkiver, onchange: (e) => { arkiver = e.target.checked; } }), ' Lagre originalfilen i dokumentarkivet'),
          mangler ? h('span.dempet', `${mangler} uten kategori – kan settes senere`) : null,
          nye.length ? importKnapp : (!allerede ? h('button.sekundar', { type: 'button', onclick: async () => { await arkiverFil(); toast('Filen er lagret i dokumentarkivet'); tegn(); } }, 'Lagre bare filen i arkivet') : null)) : null));
    };

    function kolonneValg() {
      const hdr = (res.overskrifter || []).map((x, i) => ({ verdi: String(i), tekst: String(x || `Kolonne ${i + 1}`) }));
      const valg = (navn, nokkel) => felt(navn, velg([{ verdi: '-1', tekst: '—' }, ...hdr], String(res.kolonner[nokkel]), {
        onchange: (e) => {
          const kol = { ...res.kolonner, [nokkel]: Number(e.target.value) };
          const ny = generisk(res.raRader, kol, res.filnavn);
          Object.assign(res, { rader: ny.rader, kolonner: kol });
          for (const r of res.rader) r.tekst = r.tekstRa;
          forbered();
          tegn();
        },
      }));
      return h('div.kolonnevalg', h('p.dempet', 'Ukjent format – velg hvilke kolonner som inneholder dato, beløp og tekst:'),
        valg('Dato', 'dato'), valg('Beløp', 'belop'), valg('Inn (hvis eget)', 'inn'), valg('Ut (hvis eget)', 'ut'), valg('Tekst', 'tekst'));
    }

    async function arkiverFil() {
      const dok = await lastOppDokument(fil, {
        kategori: /kort/.test(res.format) ? 'kortfaktura' : 'kontoutskrift',
        tittel: `${res.formatNavn.replace(/ \(CSV\)$/, '')} ${res.periode ? `${datoNo(res.periode.fra)}–${datoNo(res.periode.til)}` : ''}`.trim(),
        dato: res.forfall || res.periode?.til,
        koblinger: [{ type: 'konto', id: kontoId }],
      });
      return dok;
    }

    async function importer() {
      const valgte = res.rader.filter((r) => !r.duplikat && r.velg);
      const alle = tilTransaksjoner(valgte, kontoId, res.filnavn);
      // Transaksjoner i låste år hoppes over
      const nye = alle.filter((t) => !erLastTransaksjon(db, t));
      const hoppetOver = alle.length - nye.length;
      let dok = allerede || null;
      if (arkiver && !allerede) {
        try { dok = await arkiverFil(); } catch (e) { toast(`Filen ble ikke arkivert: ${e.message}`, 'feil'); }
      }
      if (dok) for (const t of nye) t.dokumentId = dok.id;
      db.transaksjoner.push(...nye);
      const konto = db.kontoer.find((k) => k.id === kontoId);
      if (konto) {
        if (res.kontoHint.kontonr && !konto.kontonr) konto.kontonr = res.kontoHint.kontonr;
        if (res.kontoHint.kortType) konto.importFormat = res.kontoHint.kortType;
      }
      store.changed();
      toast(hoppetOver ? `${nye.length} transaksjoner importert – ${hoppetOver} i låst år ble hoppet over` : `${nye.length} transaksjoner importert`, hoppetOver ? 'feil' : 'info');
      clear(kort).append(
        h('div.kort-topp', h('h2', res.filnavn), h('button.lenke', { type: 'button', onclick: () => kort.remove() }, 'lukk')),
        h('p.kontroll-ok', `✓ ${nye.length} transaksjoner importert til ${konto?.navn || kontoId}.`),
        h('a', { href: `#/transaksjoner?q=${encodeURIComponent(res.filnavn)}` }, 'Se transaksjonene'));
    }

    tegn();
  }

  // Siste transaksjon per konto – hjelper å se hva som må importeres
  function sistOppdatert() {
    const siste = new Map();
    for (const t of db.transaksjoner) {
      const d = t.dato || '';
      if (!siste.has(t.konto) || d > siste.get(t.konto)) siste.set(t.konto, d);
    }
    const idag = new Date().toISOString().slice(0, 10);
    const dager = (d) => Math.round((Date.parse(idag) - Date.parse(d)) / 86400000);
    const rader = db.kontoer.filter((k) => k.id !== 'korreksjon').map((k) => {
      const d = siste.get(k.id);
      return h('tr', h('td', k.navn), h('td', d ? datoNo(d) : '–'), h('td.tall', d ? `${dager(d)} dager` : '–'));
    });
    return h('section.kort', h('h2', 'Sist importert per konto'), h('p.dempet', 'Dato for siste transaksjon på hver konto.'),
      h('div.tabell-holder', h('table.tabell', h('thead', h('tr', h('th', 'Konto'), h('th', 'Siste transaksjon'), h('th.tall', 'Siden'))), h('tbody', rader))));
  }

  // Avstemming: endring i registrert saldo mot sum transaksjoner i perioden
  function avstemming() {
    const seksjon = h('section.kort');
    const kontoPoster = db.formue.poster.filter((p) => p.kontoId && db.kontoer.some((k) => k.id === p.kontoId));
    const innhold = [];
    for (const p of kontoPoster) {
      const konto = db.kontoer.find((k) => k.id === p.kontoId);
      const verdier = [...(p.verdier || [])].sort((a, b) => a.dato.localeCompare(b.dato));
      const linjer = [];
      for (let i = 1; i < verdier.length; i++) {
        const a = verdier[i - 1];
        const b = verdier[i];
        const sumT = db.transaksjoner.filter((t) => t.konto === p.kontoId && t.dato > a.dato && t.dato <= b.dato).reduce((s, t) => s + t.belop, 0);
        const avvik = Math.round(((b.verdi - a.verdi) - sumT) * 100) / 100;
        linjer.push(h('tr', h('td', `${datoNo(a.dato)} → ${datoNo(b.dato)}`), h('td.tall', kr(b.verdi - a.verdi, true)), h('td.tall', kr(sumT, true)),
          h('td.tall', { class: Math.abs(avvik) < 0.01 ? 'kontroll-ok' : 'neg' }, Math.abs(avvik) < 0.01 ? '✓ 0' : kr(avvik, true))));
      }
      const siste = verdiPa(p);
      const etter = siste ? db.transaksjoner.filter((t) => t.konto === p.kontoId && t.dato > siste.dato) : [];
      const beregnet = siste ? siste.verdi + etter.reduce((s, t) => s + t.belop, 0) : null;
      innhold.push(h('div.avstem-konto',
        h('h3', konto.navn),
        linjer.length
          ? h('div.tabell-holder', h('table.tabell.kompakt', h('thead', h('tr', h('th', 'Periode'), h('th.tall', 'Endring i saldo'), h('th.tall', 'Sum transaksjoner'), h('th.tall', 'Avvik'))), h('tbody', linjer)))
          : h('p.dempet', 'Registrer minst to saldoer for å avstemme.'),
        siste ? h('p.dempet', `Siste registrerte saldo ${kr(siste.verdi, true)} kr (${datoNo(siste.dato)}). ${etter.length ? `Med ${etter.length} senere transaksjoner blir beregnet saldo ${kr(beregnet, true)} kr.` : ''}`) : null));
    }
    const kontoValg = velg(db.kontoer.filter((k) => k.type !== 'kredittkort' && k.id !== 'korreksjon').map((k) => ({ verdi: k.id, tekst: k.navn })), '');
    const dato = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const saldo = h('input', { inputmode: 'decimal', placeholder: 'Saldo fra nettbanken' });
    seksjon.append(
      h('h2', 'Avstemming mot saldo'),
      h('p.dempet', 'Registrer saldoen fra nettbanken på en dato. Systemet sjekker at endringen siden forrige saldo er lik summen av transaksjonene – da vet du at ingenting mangler.'),
      h('form.ny-saldo', { onsubmit: (e) => {
        e.preventDefault();
        const v = lesBelop(saldo.value);
        if (v == null || !dato.value || !kontoValg.value) { toast('Fyll inn konto, dato og saldo', 'feil'); return; }
        let post = db.formue.poster.find((p) => p.kontoId === kontoValg.value);
        if (!post) {
          const k = db.kontoer.find((x) => x.id === kontoValg.value);
          post = { id: 'p-' + uid(), navn: k.navn, side: 'eiendel', type: k.type === 'bsu' ? 'bsu' : 'bank', gruppe: 'Bank', kontoId: k.id, verdier: [], notat: '' };
          db.formue.poster.push(post);
        }
        post.verdier = post.verdier.filter((x) => x.dato !== dato.value);
        post.verdier.push({ dato: dato.value, verdi: v, kilde: 'Saldo fra nettbank' });
        post.verdier.sort((a, b) => a.dato.localeCompare(b.dato));
        store.changed();
        toast('Saldo registrert');
        clear(el);
        render(el);
      } }, kontoValg, dato, saldo, h('button.sekundar', { type: 'submit' }, 'Registrer saldo')),
      ...(innhold.length ? innhold : [h('p.dempet', 'Ingen bankkontoer er koblet til en formuespost ennå.')]));
    return seksjon;
  }

  function reglerKort() {
    const idx = kategoriIndeks(db.kategorier);
    const kontoNavn = new Map(db.kontoer.map((k) => [k.id, k.navn]));
    const liste = db.regler || [];
    return h('section.kort',
      h('div.kort-topp', h('h2', 'Kategoriseringsregler'), h('button.sekundar.liten', { type: 'button', onclick: () => redigerRegel(null) }, '+ Ny regel')),
      h('p.dempet', 'Regler brukes før historikken. Eksempel: tekst som inneholder «circle k» → Drivstoff og lading. Du kan også lage regler fra en transaksjon.'),
      liste.length
        ? h('div.tabell-holder', h('table.tabell', h('thead', h('tr', h('th', 'Inneholder'), h('th', 'Kategori'), h('th', 'Begrensning'), h('th.tall', 'Treff'))),
          h('tbody', liste.map((r) => h('tr.klikkbar', { onclick: () => redigerRegel(r) },
            h('td', `«${r.inneholder}»`),
            h('td', idx.navn(r.kategori)),
            h('td.dempet', [r.konto ? kontoNavn.get(r.konto) : '', r.retning === 'inn' ? 'kun inn' : r.retning === 'ut' ? 'kun ut' : ''].filter(Boolean).join(', ') || '–'),
            h('td.tall', String(db.transaksjoner.filter((t) => `${t.ra || ''} ${t.tekst} ${t.detaljer}`.toLowerCase().includes(r.inneholder.toLowerCase())).length)))))))
        : h('p.dempet', 'Ingen egne regler ennå.'));
  }

  function redigerRegel(regel) {
    const ny = !regel;
    const r = regel || { id: 'r-' + uid(), inneholder: '', kategori: '', konto: '', retning: '' };
    redigerRegelDialog(r, ny, () => { clear(el); render(el); });
  }
}

// Dialog for regel – brukes også fra transaksjonssiden.
export function redigerRegelDialog(r, ny, ferdig) {
  const db = store.db;
  const inneholder = h('input', { value: r.inneholder, required: true });
  const kat = kategoriValg(db.kategorier, r.kategori);
  const konto = velg([{ verdi: '', tekst: 'Alle kontoer' }, ...db.kontoer.map((k) => ({ verdi: k.id, tekst: k.navn }))], r.konto || '');
  const retning = velg([{ verdi: '', tekst: 'Inn og ut' }, { verdi: 'ut', tekst: 'Kun utbetalinger' }, { verdi: 'inn', tekst: 'Kun innbetalinger' }], r.retning || '');
  const brukNa = h('input', { type: 'checkbox', checked: ny });
  const knapper = [];
  if (!ny) knapper.push({ tekst: 'Slett', type: 'fare venstre', onclick: async () => {
    if (!(await bekreft('Slette regelen?', `«${r.inneholder}»`, 'Slett'))) return false;
    db.regler.splice(db.regler.indexOf(r), 1);
    store.changed();
    ferdig?.();
  } });
  knapper.push({ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: () => {
    if (!inneholder.value.trim() || !kat.value) { toast('Fyll inn tekst og kategori', 'feil'); return false; }
    Object.assign(r, { inneholder: inneholder.value.trim(), kategori: kat.value, konto: konto.value, retning: retning.value });
    if (ny) db.regler.push(r);
    let n = 0;
    if (brukNa.checked) {
      const nal = r.inneholder.toLowerCase();
      for (const t of db.transaksjoner) {
        if (t.kategori === r.kategori || erLastTransaksjon(db, t)) continue;
        if (r.konto && t.konto !== r.konto) continue;
        if (r.retning === 'inn' && t.belop < 0) continue;
        if (r.retning === 'ut' && t.belop > 0) continue;
        if (`${t.ra || ''} ${t.tekst} ${t.detaljer}`.toLowerCase().includes(nal)) { t.kategori = r.kategori; n++; }
      }
    }
    store.changed();
    toast(n ? `Regel lagret – ${n} transaksjoner endret` : 'Regel lagret');
    ferdig?.();
  } });
  dialog({
    tittel: ny ? 'Ny regel' : 'Endre regel',
    innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
      felt('Teksten inneholder', inneholder, 'Store/små bokstaver spiller ingen rolle'),
      felt('Kategori', kat),
      felt('Konto', konto),
      felt('Retning', retning),
      h('label.avkryss', brukNa, ' Bruk også på eksisterende transaksjoner')),
    knapper,
  });
}
