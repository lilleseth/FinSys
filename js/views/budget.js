// Budsjett per kategori og måned, med forslag fra historikk og varsler.

import { h, kr, krs, lesBelop } from '../util.js';
import { sideTopp, velg, flis, toast } from '../ui.js';
import { store } from '../store.js';
import { kontantstrom, aarMedData, MND_NAVN, sum } from '../model/calc.js';
import { budsjettFor, budsjettKilde, erLastAar, lastMelding } from '../model/years.js';

// Budsjettstatus for en måned: én rad per hovedkategori (utgift) med budsjett.
export function budsjettStatus(db, mnd, grunnlag = 'betalt') {
  const aar = mnd.slice(0, 4);
  const i = Number(mnd.slice(5, 7)) - 1;
  const kf = kontantstrom(db, aar, grunnlag);
  const poster = budsjettFor(db, aar);
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
  if (!Object.keys(budsjettFor(db, mnd.slice(0, 4))).length) return [];
  return budsjettStatus(db, mnd).rader.filter((r) => r.andel != null && r.andel >= 0.9).map((r) => ({ ...r, over: r.andel > 1 }));
}

// Snitt av forbruk per måned de siste n månedene med data.
function snittForbruk(db, n = 6) {
  const mnder = new Set(db.transaksjoner.map((t) => (t.betalt || t.dato).slice(0, 7)));
  const liste = [...mnder].sort().slice(-n);
  const perId = {};
  for (const m of liste) {
    const st = budsjettStatus({ ...db, budsjett: { poster: {}, perAar: {} } }, m);
    for (const r of st.rader) {
      perId[r.id] = (perId[r.id] || 0) + r.brukt / liste.length;
      for (const u of r.under) perId[u.id] = (perId[u.id] || 0) + u.brukt / liste.length;
    }
  }
  return { perId, antall: liste.length };
}

const rund = (x) => Math.max(0, Math.ceil(x / 100) * 100);

// Faktisk snittforbruk per måned i et år (etter betalingsmåned), per kategori-id
function faktiskSnitt(db, aar) {
  const kf = kontantstrom(db, aar, 'betalt');
  const antall = kf.antallMnd || 0;
  const perId = {};
  if (!antall) return { perId, antall };
  for (const g of db.kategorier.filter((k) => k.type === 'utgift')) {
    let hovedSum = 0;
    for (const u of g.under) {
      const v = -sum(kf.perSub.get(u.id) || []) / antall;
      if (v > 0) perId[u.id] = v;
      hovedSum += v;
    }
    if (hovedSum > 0) perId[g.id] = hovedSum;
  }
  return { perId, antall };
}

export function render(el, params) {
  const db = store.db;
  db.budsjett ||= { poster: {}, perAar: {} };
  db.budsjett.perAar ||= {};
  const na = new Date();
  const aarListe = [...new Set([...aarMedData(db), String(na.getFullYear()), ...(na.getMonth() >= 10 ? [String(na.getFullYear() + 1)] : [])])].sort();
  const sisteMnd = [...new Set(db.transaksjoner.map((t) => (t.betalt || t.dato).slice(0, 7)))].sort().pop() || new Date().toISOString().slice(0, 7);
  const mnd = params.mnd || sisteMnd;
  const aar = mnd.slice(0, 4);
  const last = erLastAar(db, aar);
  const redigerer = params.rediger === '1' && !last;
  const st = budsjettStatus(db, mnd);
  const kilde = budsjettKilde(db, aar);
  const harBudsjett = kilde.type !== 'ingen';

  const mndValg = velg(
    aarListe.flatMap((a) => MND_NAVN.map((n, i) => ({ verdi: `${a}-${String(i + 1).padStart(2, '0')}`, tekst: `${n} ${a}` }))),
    mnd,
    { 'aria-label': 'Måned', onchange: (e) => { location.hash = `#/budsjett?mnd=${e.target.value}`; } });

  el.append(sideTopp(`Budsjett ${aar}`, 'Månedlig budsjett per kategori. Forbruk telles etter betalingsmåned, som i kontantstrømmen.',
    mndValg,
    redigerer || last ? null : h('a.knapp.primar', { href: `#/budsjett?mnd=${mnd}&rediger=1` }, kilde.type === 'eget' ? `Rediger budsjett ${aar}` : `Lag budsjett for ${aar}`)));

  if (last) el.append(h('p.advarsel', lastMelding(aar)));
  if (!redigerer && kilde.type === 'videreført') el.append(h('p.advarsel', `${aar} har ikke eget budsjett ennå – budsjettet${kilde.fra ? ` fra ${kilde.fra}` : ''} brukes. `, h('a', { href: `#/budsjett?mnd=${mnd}&rediger=1` }, `Lag budsjett for ${aar}`), ' (f.eks. ut fra faktisk forbruk i fjor).'));

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
    const verdier = { ...budsjettFor(db, aar) };
    const { perId, antall } = snittForbruk(db, 6);
    const ifjor = faktiskSnitt(db, String(Number(aar) - 1));
    const vekst = h('input', { inputmode: 'decimal', value: '3', style: 'max-width:4rem', 'aria-label': 'Prisvekst i prosent' });
    const tbodyR = h('tbody');
    const inputs = new Map();
    const lagInput = (id) => {
      const inp = h('input.budsjett-input', { inputmode: 'numeric', value: verdier[id] != null ? String(verdier[id]) : '', placeholder: '–', 'aria-label': 'Budsjett per måned' });
      inputs.set(id, inp);
      return inp;
    };
    for (const g of db.kategorier.filter((k) => k.type === 'utgift')) {
      tbodyR.append(h('tr.gruppe', h('th', { scope: 'row' }, g.navn), h('td.tall.dempet', perId[g.id] ? kr(perId[g.id]) : '–'), ifjor.antall ? h('td.tall.dempet', ifjor.perId[g.id] ? kr(ifjor.perId[g.id]) : '–') : null, h('td', lagInput(g.id))));
      for (const u of g.under) {
        tbodyR.append(h('tr.under', h('th', { scope: 'row' }, u.navn), h('td.tall.dempet', perId[u.id] ? kr(perId[u.id]) : '–'), ifjor.antall ? h('td.tall.dempet', ifjor.perId[u.id] ? kr(ifjor.perId[u.id]) : '–') : null, h('td', lagInput(u.id))));
      }
    }
    const lagre = () => {
      const poster = {};
      for (const [id, inp] of inputs) {
        const v = lesBelop(inp.value);
        if (v != null && v > 0) poster[id] = Math.round(v);
      }
      db.budsjett.perAar[aar] = poster;
      store.changed();
      toast(`Budsjett for ${aar} lagret`);
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
          ifjor.antall ? h('span.knapp-gruppe',
            h('button.sekundar', { type: 'button', onclick: () => {
              const faktor = 1 + (lesBelop(vekst.value) || 0) / 100;
              for (const g of db.kategorier.filter((k) => k.type === 'utgift')) {
                const inp = inputs.get(g.id);
                inp.value = ifjor.perId[g.id] > 0 ? String(rund(ifjor.perId[g.id] * faktor)) : '';
                for (const u of g.under) inputs.get(u.id).value = '';
              }
              toast(`Fylt inn snitt per måned i ${Number(aar) - 1} + prisvekst`);
            } }, `Fra faktisk forbruk ${Number(aar) - 1}`), ' + ', vekst, ' % prisvekst') : null,
          h('button.sekundar', { type: 'button', onclick: () => { for (const inp of inputs.values()) inp.value = ''; } }, 'Tøm alle')),
        h('div.tabell-holder', h('table.tabell.budsjett-rediger',
          h('thead', h('tr', h('th', 'Kategori'), h('th.tall', `Snitt siste ${antall} mnd`), ifjor.antall ? h('th.tall', `Snitt ${Number(aar) - 1}`) : null, h('th', `Budsjett ${aar} per måned (kr)`))),
          tbodyR)),
        h('div.knapperad.hoyrestilt',
          h('a.knapp.sekundar', { href: `#/budsjett?mnd=${mnd}` }, 'Avbryt'),
          h('button.primar', { type: 'button', onclick: lagre }, 'Lagre budsjett'))));
  }
}

