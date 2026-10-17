// Budsjett per kategori og måned, med forslag fra historikk og varsler.

import { h, kr, krs, lesBelop } from '../util.js';
import { sideTopp, velg, flis, toast } from '../ui.js';
import { store } from '../store.js';
import { kontantstrom, aarMedData, MND_NAVN, sum } from '../model/calc.js';

// Budsjettstatus for en måned: én rad per hovedkategori (utgift) med budsjett.
export function budsjettStatus(db, mnd, grunnlag = 'betalt') {
  const aar = mnd.slice(0, 4);
  const i = Number(mnd.slice(5, 7)) - 1;
  const kf = kontantstrom(db, aar, grunnlag);
  const poster = db.budsjett?.poster || {};
  const rader = [];
  for (const g of db.kategorier.filter((k) => k.type === 'utgift')) {
    const subRader = g.under.map((u) => {
      const brukt = -(kf.perSub.get(u.id)?.[i] || 0);
      const bruktAar = -sum((kf.perSub.get(u.id) || []).slice(0, i + 1));
      return { id: u.id, navn: u.navn, budsjett: poster[u.id] ?? null, brukt, bruktAar };
    });
    const subSum = subRader.reduce((s, r) => s + (r.budsjett || 0), 0);
    const budsjett = poster[g.id] ?? (subSum || null);
    const brukt = sum(subRader.map((r) => r.brukt));
    const bruktAar = sum(subRader.map((r) => r.bruktAar));
    rader.push({ id: g.id, navn: g.navn, budsjett, brukt, bruktAar, andel: budsjett ? brukt / budsjett : null, under: subRader });
  }
  const medBudsjett = rader.filter((r) => r.budsjett);
  return {
    mnd,
    rader,
    totalBudsjett: sum(medBudsjett.map((r) => r.budsjett)),
    totalBrukt: sum(medBudsjett.map((r) => r.brukt)),
    bruktUtenBudsjett: sum(rader.filter((r) => !r.budsjett).map((r) => r.brukt)),
    mndNr: i + 1,
  };
}

// Varsler for dashboardet: kategorier over 90 % av budsjettet.
export function budsjettVarsler(db, mnd) {
  if (!Object.keys(db.budsjett?.poster || {}).length) return [];
  return budsjettStatus(db, mnd).rader.filter((r) => r.andel != null && r.andel >= 0.9).map((r) => ({ ...r, over: r.andel > 1 }));
}

// Snitt av forbruk per måned de siste n månedene med data.
function snittForbruk(db, n = 6) {
  const mnder = new Set(db.transaksjoner.map((t) => (t.betalt || t.dato).slice(0, 7)));
  const liste = [...mnder].sort().slice(-n);
  const perId = {};
  for (const m of liste) {
    const st = budsjettStatus({ ...db, budsjett: { poster: {} } }, m);
    for (const r of st.rader) {
      perId[r.id] = (perId[r.id] || 0) + r.brukt / liste.length;
      for (const u of r.under) perId[u.id] = (perId[u.id] || 0) + u.brukt / liste.length;
    }
  }
  return { perId, antall: liste.length };
}

const rund = (x) => Math.max(0, Math.ceil(x / 100) * 100);

export function render(el, params) {
  const db = store.db;
  db.budsjett ||= { poster: {} };
  db.budsjett.poster ||= {};
  const aarListe = aarMedData(db);
  const sisteMnd = [...new Set(db.transaksjoner.map((t) => (t.betalt || t.dato).slice(0, 7)))].sort().pop() || new Date().toISOString().slice(0, 7);
  const mnd = params.mnd || sisteMnd;
  const redigerer = params.rediger === '1';
  const st = budsjettStatus(db, mnd);
  const harBudsjett = Object.keys(db.budsjett.poster).length > 0;

  const mndValg = velg(
    aarListe.flatMap((a) => MND_NAVN.map((n, i) => ({ verdi: `${a}-${String(i + 1).padStart(2, '0')}`, tekst: `${n} ${a}` }))),
    mnd,
    { 'aria-label': 'Måned', onchange: (e) => { location.hash = `#/budsjett?mnd=${e.target.value}`; } });

  el.append(sideTopp('Budsjett', 'Månedlig budsjett per kategori. Forbruk telles etter betalingsmåned, som i kontantstrømmen.',
    mndValg,
    redigerer ? null : h('a.knapp.primar', { href: `#/budsjett?mnd=${mnd}&rediger=1` }, harBudsjett ? 'Rediger budsjett' : 'Lag budsjett')));

  if (redigerer) return renderRediger();

  if (!harBudsjett) {
    el.append(h('div.tom', h('h3', 'Ingen budsjett ennå'), h('p', 'Trykk «Lag budsjett». Du kan starte med forslag basert på snittforbruket ditt de siste seks månedene.')));
  } else {
    const igjen = st.totalBudsjett - st.totalBrukt;
    el.append(h('section.fliser.tre',
      flis(`Budsjett ${MND_NAVN[st.mndNr - 1].toLowerCase()}`, krs(st.totalBudsjett), 'for kategorier med budsjett'),
      flis('Brukt', krs(st.totalBrukt), st.totalBudsjett ? `${Math.round((st.totalBrukt / st.totalBudsjett) * 100)} % av budsjettet` : ''),
      flis(igjen >= 0 ? 'Igjen' : 'Over budsjett', krs(Math.abs(igjen)), st.bruktUtenBudsjett ? `+ ${kr(st.bruktUtenBudsjett)} kr i kategorier uten budsjett` : '')));
  }

  const tbody = h('tbody');
  for (const r of st.rader) {
    if (!r.budsjett && Math.abs(r.brukt) < 1 && Math.abs(r.bruktAar) < 1) continue;
    tbody.append(rad(r, true));
    for (const u of r.under) if (u.budsjett) tbody.append(rad({ ...u, andel: u.brukt / u.budsjett }, false));
  }
  el.append(h('section.kort', h('div.tabell-holder', h('table.tabell.budsjett',
    h('thead', h('tr', h('th', 'Kategori'), h('th.tall', 'Budsjett'), h('th.tall', 'Brukt'), h('th.tall', 'Igjen'), h('th', 'Status'), h('th.tall', `Hittil i år (${st.mndNr} mnd)`))),
    tbody))));

  function rad(r, hoved) {
    const andel = r.budsjett ? r.brukt / r.budsjett : null;
    const status = andel == null ? null : andel > 1 ? ['over', '▲ Over'] : andel >= 0.9 ? ['naer', '● Nær grensen'] : ['ok', '✓ Innenfor'];
    const aarBudsjett = r.budsjett ? r.budsjett * st.mndNr : null;
    return h('tr', { class: hoved ? 'gruppe' : 'under' },
      h('th', { scope: 'row' }, h('a', { href: `#/transaksjoner?kat=${hoved ? 'h:' + r.id : r.id}&mnd=${mnd}` }, r.navn)),
      h('td.tall', r.budsjett ? kr(r.budsjett) : '–'),
      h('td.tall', kr(r.brukt)),
      h('td.tall', r.budsjett ? kr(r.budsjett - r.brukt) : '–'),
      h('td.status-celle', andel != null
        ? h('div.maler', { class: status[0] }, h('div.maler-spor', h('div.maler-fyll', { style: `width:${Math.min(andel, 1) * 100}%` })), h('span', `${Math.round(andel * 100)} % · ${status[1]}`))
        : h('span.dempet', 'uten budsjett')),
      h('td.tall', aarBudsjett ? `${kr(r.bruktAar)} / ${kr(aarBudsjett)}` : kr(r.bruktAar)));
  }

  function renderRediger() {
    const verdier = { ...db.budsjett.poster };
    const { perId, antall } = snittForbruk(db, 6);
    const tbodyR = h('tbody');
    const inputs = new Map();
    const lagInput = (id) => {
      const inp = h('input.budsjett-input', { inputmode: 'numeric', value: verdier[id] != null ? String(verdier[id]) : '', placeholder: '–', 'aria-label': 'Budsjett per måned' });
      inputs.set(id, inp);
      return inp;
    };
    for (const g of db.kategorier.filter((k) => k.type === 'utgift')) {
      tbodyR.append(h('tr.gruppe', h('th', { scope: 'row' }, g.navn), h('td.tall.dempet', perId[g.id] ? kr(perId[g.id]) : '–'), h('td', lagInput(g.id))));
      for (const u of g.under) {
        tbodyR.append(h('tr.under', h('th', { scope: 'row' }, u.navn), h('td.tall.dempet', perId[u.id] ? kr(perId[u.id]) : '–'), h('td', lagInput(u.id))));
      }
    }
    const lagre = () => {
      const poster = {};
      for (const [id, inp] of inputs) {
        const v = lesBelop(inp.value);
        if (v != null && v > 0) poster[id] = Math.round(v);
      }
      db.budsjett.poster = poster;
      store.changed();
      toast('Budsjett lagret');
      location.hash = `#/budsjett?mnd=${mnd}`;
    };
    el.append(
      h('section.kort',
        h('p', 'Sett et månedlig beløp per hovedkategori, eller per underkategori hvis du vil ha mer detaljer. Står hovedkategorien tom, brukes summen av underkategoriene.'),
        h('div.knapperad',
          h('button.sekundar', { type: 'button', onclick: () => {
            for (const g of db.kategorier.filter((k) => k.type === 'utgift')) {
              const inp = inputs.get(g.id);
              if (!inp.value && perId[g.id] > 0) inp.value = String(rund(perId[g.id]));
            }
            toast(`Fylt inn snitt fra siste ${antall} måneder (rundet opp til nærmeste 100)`);
          } }, 'Foreslå fra snittforbruk'),
          h('button.sekundar', { type: 'button', onclick: () => { for (const inp of inputs.values()) inp.value = ''; } }, 'Tøm alle')),
        h('div.tabell-holder', h('table.tabell.budsjett-rediger',
          h('thead', h('tr', h('th', 'Kategori'), h('th.tall', `Snitt siste ${antall} mnd`), h('th', 'Budsjett per måned (kr)'))),
          tbodyR)),
        h('div.knapperad.hoyrestilt',
          h('a.knapp.sekundar', { href: `#/budsjett?mnd=${mnd}` }, 'Avbryt'),
          h('button.primar', { type: 'button', onclick: lagre }, 'Lagre budsjett'))));
  }
}

