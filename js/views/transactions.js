// Transaksjonsliste med filtre, redigering og manuell registrering.

import { h, clear, kr, datoNo, uid, lesBelop, lastNed } from '../util.js';
import { felt, velg, kategoriValg, dialog, bekreft, sideTopp, toast } from '../ui.js';
import { store } from '../store.js';
import { kategoriIndeks } from '../model/categories.js';
import { redigerRegelDialog } from './import.js';
import { normaliser } from '../model/rules.js';
import { vedlegg } from './documents.js';
import { mndFor, aarMedData, MND_NAVN } from '../model/calc.js';
import { csv, transaksjonsRader, TRANSAKSJON_KOLONNER } from '../model/export.js';

const SIDE = 250;

export function render(el, params) {
  const db = store.db;
  const idx = kategoriIndeks(db.kategorier);
  const aarListe = aarMedData(db);
  const f = {
    q: params.q || '',
    grunnlag: params.grunnlag || 'betalt',
    aar: params.aar ?? (params.mnd ? params.mnd.slice(0, 4) : ''),
    mnd: params.mnd || '',
    konto: params.konto || '',
    kat: params.kat || '',
    etikett: params.etikett || '',
  };
  let vis = SIDE;

  const sok = h('input', { type: 'search', placeholder: 'Søk i tekst, notat, beløp …', value: f.q, 'aria-label': 'Søk' });
  const grunnlag = velg([{ verdi: 'betalt', tekst: 'Betalingsdato' }, { verdi: 'kjopt', tekst: 'Kjøpsdato' }], f.grunnlag, { 'aria-label': 'Datogrunnlag' });
  const aar = velg([{ verdi: '', tekst: 'Alle år' }, ...aarListe.map((a) => ({ verdi: a, tekst: a }))], f.aar, { 'aria-label': 'År' });
  const mnd = velg([{ verdi: '', tekst: 'Alle måneder' }, ...MND_NAVN.map((m, i) => ({ verdi: String(i + 1).padStart(2, '0'), tekst: m }))], f.mnd ? f.mnd.slice(-2) : '', { 'aria-label': 'Måned' });
  const konto = velg([{ verdi: '', tekst: 'Alle kontoer' }, ...db.kontoer.map((k) => ({ verdi: k.id, tekst: k.navn }))], f.konto, { 'aria-label': 'Konto' });
  const kat = velg([
    { verdi: '', tekst: 'Alle kategorier' },
    { verdi: '__ingen', tekst: '⚠ Ukategorisert' },
    { gruppe: 'Hovedkategorier', valg: db.kategorier.map((k) => ({ verdi: 'h:' + k.id, tekst: k.navn })) },
    ...db.kategorier.map((k) => ({ gruppe: k.navn, valg: k.under.map((u) => ({ verdi: u.id, tekst: u.navn })) })),
  ], f.kat, { 'aria-label': 'Kategori' });

  const oppsummering = h('div.oppsummering');
  const tabellHolder = h('div.tabell-holder');
  const mer = h('button.sekundar', { type: 'button', hidden: true, onclick: () => { vis += SIDE; tegn(); } }, 'Vis flere');

  el.append(...[
    sideTopp('Transaksjoner', null,
      h('button.sekundar', { type: 'button', title: 'Last ned transaksjonene som passer filteret', onclick: () => {
        const liste = filtrer();
        lastNed(`finsys-transaksjoner-${new Date().toISOString().slice(0, 10)}.csv`, csv(TRANSAKSJON_KOLONNER, transaksjonsRader(db, liste)), 'text/csv;charset=utf-8');
        toast(`${liste.length} transaksjoner eksportert`);
      } }, 'Eksporter CSV'),
      h('button.primar', { type: 'button', onclick: () => rediger(null) }, '+ Ny transaksjon')),
    h('div.filtre', sok, grunnlag, aar, mnd, konto, kat),
    f.etikett ? h('div.aktiv-etikett', 'Etikett: ', h('span.etikett', f.etikett), h('button.lenke', { type: 'button', onclick: () => { f.etikett = ''; oppdaterUrl(); clear(el); render(el, { ...f, etikett: '' }); } }, 'fjern')) : null,
    oppsummering,
    tabellHolder,
    h('div.sentrert', mer),
  ].filter(Boolean));

  const les = () => {
    f.q = sok.value.trim();
    f.grunnlag = grunnlag.value;
    f.aar = aar.value;
    f.mnd = mnd.value && aar.value ? `${aar.value}-${mnd.value}` : mnd.value ? `*-${mnd.value}` : '';
    f.konto = konto.value;
    f.kat = kat.value;
    vis = SIDE;
    oppdaterUrl();
    tegn();
  };
  for (const e of [grunnlag, aar, mnd, konto, kat]) e.addEventListener('change', les);
  let t;
  sok.addEventListener('input', () => { clearTimeout(t); t = setTimeout(les, 200); });

  function oppdaterUrl() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v && !(k === 'grunnlag' && v === 'betalt')) p.set(k, v);
    history.replaceState(null, '', `#/transaksjoner${p.toString() ? '?' + p : ''}`);
  }

  function filtrer() {
    const q = f.q.toLowerCase();
    const qTall = lesBelop(f.q);
    return db.transaksjoner.filter((tr) => {
      const m = mndFor(tr, f.grunnlag);
      if (f.aar && m.slice(0, 4) !== f.aar) return false;
      if (f.mnd) {
        if (f.mnd.startsWith('*-')) { if (m.slice(5, 7) !== f.mnd.slice(2)) return false; }
        else if (m !== f.mnd) return false;
      }
      if (f.konto && tr.konto !== f.konto) return false;
      if (f.kat === '__ingen' && tr.kategori) return false;
      if (f.kat.startsWith('h:') && !(tr.kategori || '').startsWith(f.kat.slice(2) + '/')) return false;
      if (f.kat && f.kat !== '__ingen' && !f.kat.startsWith('h:') && tr.kategori !== f.kat) return false;
      if (f.etikett && !(tr.etiketter || []).includes(f.etikett)) return false;
      if (q) {
        const tekst = `${tr.tekst} ${tr.ra || ''} ${tr.detaljer} ${tr.notat} ${tr.kilde || ''} ${(tr.etiketter || []).join(' ')}`.toLowerCase();
        const treff = tekst.includes(q) || (qTall != null && Math.abs(Math.abs(tr.belop) - Math.abs(qTall)) < 0.005);
        if (!treff) return false;
      }
      return true;
    }).sort((a, b) => (b[f.grunnlag === 'kjopt' ? 'dato' : 'betalt'] || '').localeCompare(a[f.grunnlag === 'kjopt' ? 'dato' : 'betalt'] || '') || b.id.localeCompare(a.id));
  }

  function tegn() {
    const liste = filtrer();
    const inn = liste.filter((x) => x.belop > 0).reduce((s, x) => s + x.belop, 0);
    const ut = liste.filter((x) => x.belop < 0).reduce((s, x) => s + x.belop, 0);
    clear(oppsummering).append(
      h('span', `${liste.length} transaksjoner`),
      h('span', 'Inn: ', h('strong.pos', kr(inn, true))),
      h('span', 'Ut: ', h('strong.neg', kr(ut, true))),
      h('span', 'Netto: ', h('strong', kr(inn + ut, true)))
    );
    const kontoNavn = new Map(db.kontoer.map((k) => [k.id, k.navn]));
    const tbody = h('tbody');
    for (const tr of liste.slice(0, vis)) {
      const ukat = !tr.kategori;
      const katCelle = ukat
        ? kategoriValg(db.kategorier, '', {
          class: 'kat-valg',
          'aria-label': 'Velg kategori',
          onclick: (e) => e.stopPropagation(),
          onchange: (e) => { tr.kategori = e.target.value; store.changed(); toast('Kategori lagret'); },
        })
        : h('span.kat', { class: `type-${idx.type(tr.kategori)}` }, idx.hent(tr.kategori)?.navn || tr.kategori);
      tbody.append(h('tr', { onclick: () => rediger(tr), tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter') rediger(tr); } },
        h('td.dato', datoNo(tr.dato), tr.betalt && tr.betalt !== tr.dato ? h('small', `betalt ${datoNo(tr.betalt)}`) : null),
        h('td.konto', kontoNavn.get(tr.konto) || tr.konto),
        h('td.tekst', h('div', tr.tekst || '—'), h('small', tr.detaljer), (tr.etiketter || []).map((e) => h('span.etikett', e)), tr.notat ? h('span.har-notat', { title: tr.notat }, '✎') : null),
        h('td.kategori', katCelle, !ukat ? h('small', idx.hovedFor(tr.kategori)?.navn || '') : null),
        h('td.belop', { class: tr.belop < 0 ? 'neg' : 'pos' }, kr(tr.belop, true))
      ));
    }
    clear(tabellHolder).append(liste.length
      ? h('table.tabell.transaksjoner', h('thead', h('tr', h('th', 'Dato'), h('th', 'Konto'), h('th', 'Tekst'), h('th', 'Kategori'), h('th.hoyre', 'Beløp'))), tbody)
      : h('p.dempet', 'Ingen transaksjoner passer filteret.'));
    mer.hidden = liste.length <= vis;
    mer.textContent = `Vis flere (${liste.length - vis} til)`;
  }

  function rediger(tr) {
    const ny = !tr;
    const idag = new Date().toISOString().slice(0, 10);
    const d = tr || { id: 't-' + uid(), konto: db.kontoer[0]?.id || '', dato: idag, betalt: idag, tekst: '', belop: 0, kategori: '', etiketter: [], detaljer: '', notat: '', kilde: 'Manuell' };
    const inp = {
      dato: h('input', { type: 'date', value: d.dato || '' }),
      betalt: h('input', { type: 'date', value: d.betalt || '' }),
      konto: velg(db.kontoer.map((k) => ({ verdi: k.id, tekst: k.navn })), d.konto),
      tekst: h('input', { value: d.tekst, required: true }),
      belop: h('input', { value: ny ? '' : kr(d.belop, true), inputmode: 'decimal', placeholder: '-123,45 for utgift' }),
      kategori: kategoriValg(db.kategorier, d.kategori),
      etiketter: h('input', { value: (d.etiketter || []).join(', '), placeholder: 'f.eks. Sommerferie' }),
      detaljer: h('input', { value: d.detaljer || '' }),
      notat: h('textarea', { rows: 3 }, d.notat || ''),
      delt: velg([{ verdi: '', tekst: 'Auto' }, { verdi: 'ja', tekst: 'Ja, felles' }, { verdi: 'nei', tekst: 'Nei, bare min' }], d.delt === true ? 'ja' : d.delt === false ? 'nei' : ''),
      husOppgjor: h('input', { type: 'checkbox', checked: !!d.husOppgjor }),
    };
    const like = ny ? [] : db.transaksjoner.filter((x) => x !== tr && x.tekst && x.tekst === tr.tekst);
    const alleLike = h('input', { type: 'checkbox' });
    const feil = h('p.feil', { hidden: true });
    const innhold = h('form.skjema.to-kol', { onsubmit: (e) => e.preventDefault() },
      felt('Kjøpsdato', inp.dato),
      felt('Betalingsdato', inp.betalt, 'For kortkjøp: datoen kortfakturaen ble betalt'),
      felt('Konto', inp.konto),
      felt('Beløp (kr)', inp.belop, 'Negativt for utgift, positivt for inntekt'),
      h('div.hel', felt('Tekst / motpart', inp.tekst)),
      h('div.hel', felt('Kategori', inp.kategori)),
      like.length ? h('label.avkryss.hel', alleLike, ` Bruk samme kategori på alle ${like.length} andre transaksjoner med teksten «${tr.tekst}»`) : null,
      felt('Etiketter (kommaseparert)', inp.etiketter),
      felt('Detaljer', inp.detaljer),
      h('div.hel', felt('Notat', inp.notat)),
      db.husholdning?.aktiv ? felt(`Felles med ${db.husholdning.partner || 'partner'}`, inp.delt, 'Auto følger felles kategorier og kontoer') : null,
      db.husholdning?.aktiv ? h('label.avkryss', inp.husOppgjor, ' Oppgjør i husholdningen (betaling til/fra den du deler med)') : null,
      !ny && d.opprinnelig ? h('p.dempet.hel', `Fra regnearket: ${d.opprinnelig.kategori}${d.opprinnelig.underkategori ? ' › ' + d.opprinnelig.underkategori : ''} (${d.opprinnelig.type}) · kilde: ${d.kilde}`) : (!ny ? h('p.dempet.hel', `Kilde: ${d.kilde || '–'}`) : null),
      !ny ? h('div.hel', vedlegg('transaksjon', d.id, d)) : null,
      feil
    );
    const knapper = [];
    if (!ny) knapper.push({ tekst: 'Slett', type: 'fare venstre', onclick: async () => {
      if (!(await bekreft('Slette transaksjonen?', `«${d.tekst}» ${kr(d.belop, true)} kr slettes.`, 'Slett'))) return false;
      db.transaksjoner.splice(db.transaksjoner.indexOf(tr), 1);
      store.changed();
      tegn();
    } });
    if (!ny) knapper.push({ tekst: 'Lag regel …', onclick: () => {
      const forslag = normaliser(d.ra || d.tekst).split(' ').slice(0, 2).join(' ');
      redigerRegelDialog({ id: 'r-' + uid(), inneholder: forslag, kategori: inp.kategori.value || d.kategori, konto: '', retning: '' }, true, tegn);
    } });
    knapper.push({ tekst: 'Avbryt' });
    knapper.push({ tekst: 'Lagre', type: 'primar', onclick: () => {
      const belop = lesBelop(inp.belop.value);
      if (belop == null) { feil.textContent = 'Ugyldig beløp.'; feil.hidden = false; return false; }
      if (!inp.tekst.value.trim()) { feil.textContent = 'Tekst mangler.'; feil.hidden = false; return false; }
      if (!inp.dato.value) { feil.textContent = 'Kjøpsdato mangler.'; feil.hidden = false; return false; }
      Object.assign(d, {
        dato: inp.dato.value,
        betalt: inp.betalt.value || inp.dato.value,
        konto: inp.konto.value,
        tekst: inp.tekst.value.trim(),
        belop,
        kategori: inp.kategori.value,
        etiketter: inp.etiketter.value.split(',').map((s) => s.trim()).filter(Boolean),
        detaljer: inp.detaljer.value.trim(),
        notat: inp.notat.value.trim(),
      });
      if (db.husholdning?.aktiv) {
        if (inp.delt.value === 'ja') d.delt = true; else if (inp.delt.value === 'nei') d.delt = false; else delete d.delt;
        if (inp.husOppgjor.checked) d.husOppgjor = true; else delete d.husOppgjor;
      }
      if (alleLike.checked) for (const x of like) x.kategori = d.kategori;
      if (ny) db.transaksjoner.push(d);
      store.changed();
      toast(ny ? 'Transaksjon lagt til' : alleLike.checked ? `Lagret – ${like.length + 1} transaksjoner oppdatert` : 'Lagret');
      tegn();
    } });
    if (!db.kontoer.length) {
      dialog({ tittel: 'Ingen kontoer', innhold: h('p', 'Opprett en konto under Innstillinger først.'), knapper: [{ tekst: 'Til innstillinger', type: 'primar', onclick: () => { location.hash = '#/innstillinger'; } }] });
      return;
    }
    dialog({ tittel: ny ? 'Ny transaksjon' : 'Rediger transaksjon', innhold, knapper, bred: true });
  }

  tegn();
  if (params.ny) { history.replaceState(null, '', '#/transaksjoner'); rediger(null); }
}

