// Kontantstrøm per måned og kategori, etter betalingsmåned eller kjøpsmåned.

import { h, kr, pct } from '../util.js';
import { sideTopp, velg, tomTilstand } from '../ui.js';
import { store } from '../store.js';
import { kontantstrom, aarMedData, MND_KORT, MND_NAVN, sum } from '../model/calc.js';
import { TYPE_FORKLARING } from '../model/categories.js';
import { lonnsslippDialog } from './extract.js';

export function render(el, params) {
  const db = store.db;
  const aarListe = aarMedData(db);
  if (!db.transaksjoner.length) {
    el.append(sideTopp('Kontantstrøm'), tomTilstand('Ingen transaksjoner ennå', 'Importer regnearket eller legg inn transaksjoner for å se kontantstrømmen.', h('a.knapp.primar', { href: '#/innstillinger?vis=import' }, 'Importer')));
    return;
  }
  const aar = params.aar || aarListe[aarListe.length - 1];
  const grunnlag = params.grunnlag || 'betalt';
  const apne = new Set((params.apne || '').split(',').filter(Boolean));
  const kf = kontantstrom(db, aar, grunnlag);
  const n = Math.max(kf.antallMnd, 1);
  const mndIdx = [...Array(n).keys()];

  const gaTil = (p) => {
    const q = new URLSearchParams({ aar, grunnlag, ...p });
    location.hash = `#/kontantstrom?${q}`;
  };

  const aarValg = velg(aarListe.map((a) => ({ verdi: a, tekst: a })), aar, { 'aria-label': 'År', onchange: (e) => gaTil({ aar: e.target.value }) });
  const bryter = h('div.segment', { role: 'group', 'aria-label': 'Månedsgrunnlag' },
    h('button', { type: 'button', class: grunnlag === 'betalt' ? 'aktiv' : '', 'aria-pressed': String(grunnlag === 'betalt'), onclick: () => gaTil({ grunnlag: 'betalt' }) }, 'Betalingsmåned'),
    h('button', { type: 'button', class: grunnlag === 'kjopt' ? 'aktiv' : '', 'aria-pressed': String(grunnlag === 'kjopt'), onclick: () => gaTil({ grunnlag: 'kjopt' }) }, 'Kjøpsmåned'));

  el.append(sideTopp('Kontantstrøm', grunnlag === 'betalt'
    ? 'Kortkjøp telles i måneden kortfakturaen ble betalt – viser faktisk pengeflyt.'
    : 'Kortkjøp telles i måneden de ble gjort – viser når forbruket skjedde.', bryter, aarValg));

  const lenke = (kat, i) => {
    const p = new URLSearchParams({ kat, grunnlag });
    if (i == null) p.set('aar', aar); else p.set('mnd', `${aar}-${String(i + 1).padStart(2, '0')}`);
    return `#/transaksjoner?${p}`;
  };

  const tallCeller = (verdier, kat) => [
    ...mndIdx.map((i) => h('td.tall', kat ? h('a', { href: lenke(kat, i) }, fmt(verdier[i])) : fmt(verdier[i]))),
    h('td.tall.sum', kat ? h('a', { href: lenke(kat) }, fmt(sum(verdier.slice(0, n)))) : fmt(sum(verdier.slice(0, n)))),
    h('td.tall.snitt', fmt(sum(verdier.slice(0, n)) / n)),
  ];

  const tbody = h('tbody');
  const seksjon = (tittel, type) => {
    const grupper = db.kategorier.filter((k) => k.type === type);
    const rader = [];
    const totalt = new Array(12).fill(0);
    for (const g of grupper) {
      const subs = g.under.filter((u) => kf.perSub.has(u.id));
      if (!subs.length) continue;
      const gv = new Array(12).fill(0);
      for (const u of subs) kf.perSub.get(u.id).forEach((v, i) => { gv[i] += v; });
      gv.forEach((v, i) => { totalt[i] += v; });
      const erApen = apne.has(g.id);
      const gRad = h('tr.gruppe', { class: erApen ? 'apen' : '' },
        h('th', { scope: 'row' }, h('button.utvid', { type: 'button', 'aria-expanded': String(erApen), onclick: () => {
          const ny = new Set(apne);
          if (ny.has(g.id)) ny.delete(g.id); else ny.add(g.id);
          gaTil({ apne: [...ny].join(',') });
        } }, h('span.pil', erApen ? '▾' : '▸'), g.navn)),
        ...tallCeller(gv, 'h:' + g.id));
      rader.push(gRad);
      if (erApen) for (const u of subs) rader.push(h('tr.under', h('th', { scope: 'row' }, u.navn), ...tallCeller(kf.perSub.get(u.id), u.id)));
    }
    if (type === 'utgift' && kf.perSub.has('')) {
      const v = kf.perSub.get('');
      v.forEach((x, i) => { totalt[i] += x; });
      rader.push(h('tr.gruppe.ukategorisert', h('th', { scope: 'row' }, '⚠ Ukategorisert'), ...tallCeller(v, '__ingen')));
    }
    if (!rader.length) return null;
    tbody.append(h('tr.seksjon', h('th', { colspan: n + 3, scope: 'colgroup' }, tittel, h('small', ` – ${TYPE_FORKLARING[type]}`))));
    for (const r of rader) tbody.append(r);
    tbody.append(h('tr.delsum', h('th', { scope: 'row' }, `Sum ${tittel.toLowerCase()}`), ...tallCeller(totalt)));
    return totalt;
  };

  seksjon('Inntekter', 'inntekt');
  seksjon('Utgifter', 'utgift');
  seksjon('Nøytrale poster', 'noytral');
  tbody.append(h('tr.netto', h('th', { scope: 'row' }, 'Netto kontantstrøm (spart)'), ...tallCeller(kf.netto)));
  tbody.append(h('tr.info', h('th', { scope: 'row' }, 'Herav overført til investeringer'), ...tallCeller(kf.tot.sparing, 'h:sparing')));
  tbody.append(h('tr.info', h('th', { scope: 'row' }, 'Sparerate (av inntekt)'),
    ...mndIdx.map((i) => h('td.tall', pct(kf.sparerate[i]))),
    h('td.tall.sum', pct(sum(kf.tot.inntekt.slice(0, n)) > 0 ? sum(kf.netto.slice(0, n)) / sum(kf.tot.inntekt.slice(0, n)) : null)),
    h('td.tall.snitt', '')));
  const overf = kf.tot.overforing;
  tbody.append(h('tr.info.dempet', h('th', { scope: 'row' }, 'Interne overføringer og kortoppgjør (teller ikke)'), ...tallCeller(overf, 'h:overforing')));

  el.append(h('div.tabell-holder.bred-tabell',
    h('table.tabell.kontantstrom',
      h('thead', h('tr', h('th', 'Kategori'), ...mndIdx.map((i) => h('th.tall', { title: MND_NAVN[i] }, MND_KORT[i])), h('th.tall', 'Sum'), h('th.tall', 'Snitt/mnd'))),
      tbody)));
  el.append(h('p.dempet', 'Klikk på en hovedkategori for å se underkategorier, eller på et beløp for å se transaksjonene bak.'));

  // Lønnsslipper
  const slipper = (db.inntekt.lonnsslipper || []).filter((s) => s.mnd.startsWith(aar)).sort((a, b) => a.mnd.localeCompare(b.mnd));
  const registrer = h('button.sekundar.liten', { type: 'button', onclick: () => lonnsslippDialog() }, '+ Registrer lønnsslipp');
  if (!slipper.length) {
    el.append(h('section.kort', h('h2', `Lønnsslipper ${aar}`),
      h('p.dempet', 'Ingen lønnsslipper registrert for året. Lønnsslippene brukes i skatteprognosen. Last opp PDF under Dokumenter og trykk «Hent tall», eller registrer manuelt.'),
      registrer));
  } else {
    const felt = [
      ['fastlonn', 'Fastlønn'], ['overtid50', 'Overtid 50 %'], ['overtid100', 'Overtid 100 %'], ['engang', 'Engangsposter'],
      ['andreTillegg', 'Andre tillegg/trekk'], ['brutto', 'Bruttolønn'], ['skattetrekk', 'Skattetrekk'], ['trekkfrie', 'Trekkfrie tillegg'], ['netto', 'Utbetalt'],
    ];
    const sl = new Map(slipper.map((s) => [Number(s.mnd.slice(5, 7)) - 1, s]));
    const maks = Math.max(...sl.keys()) + 1;
    const kol = [...Array(maks).keys()];
    el.append(h('section.kort',
      h('div.kort-topp', h('h2', `Lønnsslipper ${aar}`), registrer),
      h('p.dempet', `${slipper[0].arbeidsgiver || ''}${slipper[0].arbeidsgiver ? ' · ' : ''}klikk på en måned for å endre`),
      h('div.tabell-holder.bred-tabell', h('table.tabell.kontantstrom',
        h('thead', h('tr', h('th', 'Post'), ...kol.map((i) => h('th.tall', sl.get(i) ? h('button.lenke', { type: 'button', title: `Endre lønnsslipp for ${MND_NAVN[i].toLowerCase()}`, onclick: () => lonnsslippDialog({ mnd: sl.get(i).mnd }) }, MND_KORT[i]) : MND_KORT[i])), h('th.tall', 'Sum'))),
        h('tbody', felt.map(([k, navn]) => h('tr', { class: k === 'brutto' || k === 'netto' ? 'delsum' : '' }, h('th', { scope: 'row' }, navn),
          ...kol.map((i) => h('td.tall', fmt(sl.get(i)?.[k]))),
          h('td.tall.sum', fmt(sum(kol.map((i) => sl.get(i)?.[k] || 0))))))),
        h('tfoot', h('tr.info', h('th', { scope: 'row' }, 'Effektivt skattetrekk'),
          ...kol.map((i) => { const s = sl.get(i); return h('td.tall', s && s.brutto ? pct(-s.skattetrekk / s.brutto) : '–'); }),
          h('td.tall.sum', pct(-sum(slipper.map((s) => s.skattetrekk || 0)) / sum(slipper.map((s) => s.brutto || 0))))))))));
  }
}

function fmt(v) {
  if (v == null || Math.abs(v) < 0.005) return '–';
  return kr(v);
}
