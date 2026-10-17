// Innsikt: formueendring, belåning, skjulte kostnader og uvanlige transaksjoner.

import { h, clear, kr, krs, pct, datoNo, signert, lesBelop } from '../util.js';
import { velg, sideTopp, flis, tomTilstand } from '../ui.js';
import { store } from '../store.js';
import { formueendring, ENDRING_DELER, belaning, STANDARD_BELANING, skjulteKostnader, STANDARD_VALUTAPASLAG, avvik } from '../model/insight.js';

const fyll = (el, ...x) => el.append(...x.flat().filter(Boolean));
const prosent = (x) => `${String(Math.round(x * 1000) / 10).replace('.', ',')} %`;

const FANER = [
  ['endring', 'Formueendring'],
  ['belaning', 'Belåning'],
  ['kostnader', 'Skjulte kostnader'],
  ['avvik', 'Uvanlige transaksjoner'],
];

export function render(el, params) {
  const fane = FANER.some(([id]) => id === params.fane) ? params.fane : 'endring';
  const tegnPaNytt = (p = {}) => { clear(el); render(el, { ...params, ...p }); };
  el.append(sideTopp('Innsikt', 'Hvor formuen kommer fra, risiko ved belåning, kostnader du ikke ser og transaksjoner som skiller seg ut.'),
    h('nav.faner', { 'aria-label': 'Innsikt' }, FANER.map(([id, navn]) => h('a', { href: `#/innsikt?fane=${id}`, class: id === fane ? 'aktiv' : '', 'aria-current': id === fane ? 'page' : null }, navn))));
  const seksjon = h('div.fane-innhold');
  el.append(seksjon);
  ({ endring: visEndring, belaning: visBelaning, kostnader: visKostnader, avvik: visAvvik })[fane](seksjon, params, tegnPaNytt);
}

// Horisontal stolpe for positive/negative bidrag
function bidragRad(navn, belop, maks) {
  const bredde = maks ? Math.min(100, (Math.abs(belop) / maks) * 100) : 0;
  return h('div.bidrag', h('span.bidrag-navn', navn),
    h('span.bidrag-spor', h('span.bidrag-stolpe', { class: belop >= 0 ? 'pos' : 'neg', style: `width:${bredde}%` })),
    h('span.bidrag-belop', { class: belop >= 0 ? 'pos' : 'neg' }, `${signert(Math.round(belop))} kr`));
}

function visEndring(el) {
  const db = store.db;
  const f = formueendring(db);
  if (!f.perioder.length) {
    fyll(el, tomTilstand('For lite historikk', 'Frys minst to måneder der alle formuesposter har verdi (Formue og gjeld → «Frys måned»), så kan endringen deles opp.'));
    return;
  }
  const maks = Math.max(...ENDRING_DELER.map(([k]) => Math.abs(f.total[k])));
  fyll(el,
    h('section.fliser',
      flis('Endring i nettoformue', `${signert(Math.round(f.endring))} kr`, `${datoNo(f.fra)} – ${datoNo(f.til)}`, f.endring >= 0 ? 'pos' : 'neg'),
      flis('Egen sparing', `${signert(Math.round(f.grupper.sparing))} kr`, 'bank, innskudd og nedbetaling'),
      flis('Markedet', `${signert(Math.round(f.grupper.marked))} kr`, 'avkastning og pensjon'),
      flis('Verdiendring', `${signert(Math.round(f.grupper.verdi))} kr`, 'bil, selskap og annet')),
    h('section.kort',
      h('h2', 'Hvor kom endringen fra?'),
      h('p.dempet', `Samlet for perioden ${datoNo(f.fra)} – ${datoNo(f.til)}. Grønt øker formuen, rødt reduserer den.`),
      h('div.bidrag-liste', ENDRING_DELER.map(([k, navn]) => bidragRad(navn, f.total[k], maks))),
      h('p', h('strong', oppsummering(f)))),
    h('section.kort',
      h('h2', 'Per periode'),
      h('div.tabell-holder', h('table.tabell.kompakt',
        h('thead', h('tr', h('th', ''), ...f.perioder.map((p) => h('th.tall', `${datoNo(p.fra)}–${datoNo(p.til)}`)), h('th.tall', 'Sum'))),
        h('tbody',
          ENDRING_DELER.map(([k, navn]) => h('tr', h('td', navn), ...f.perioder.map((p) => h('td.tall', signert(Math.round(p.deler[k])))), h('td.tall.sum', signert(Math.round(f.total[k]))))),
          h('tr.delsum', h('td', 'Endring i nettoformue'), ...f.perioder.map((p) => h('td.tall', signert(Math.round(p.endring)))), h('td.tall', signert(Math.round(f.endring))))))),
      h('ul.dempet',
        h('li', 'Avkastning = verdiendring i aksjer og fond minus nye innskudd og minus økt verdipapirkreditt. Kjøp for lånte penger gir derfor ikke «falsk» avkastning.'),
        h('li', 'Bygger på frosne måneder i formueshistorikken og siste registrerte verdier. Innskudd hentes fra transaksjoner i kategorien Sparing og investering.'),
        f.perioder.some((p) => p.kredittEndring > 0) ? h('li', `Verdipapirkreditten økte med ${kr(f.perioder.reduce((s, p) => s + p.kredittEndring, 0))} kr i perioden.`) : null)));
}

function oppsummering(f) {
  const deler = [['egen sparing', f.grupper.sparing], ['markedet', f.grupper.marked], ['verdiendring', f.grupper.verdi]];
  const pos = deler.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (f.endring <= 0) return `Nettoformuen gikk ned med ${kr(-f.endring)} kr.`;
  const forst = pos[0];
  return `Nettoformuen økte med ${kr(f.endring)} kr. Mest kom fra ${forst[0]} (${kr(forst[1])} kr)${pos[1] ? `, deretter ${pos[1][0]} (${kr(pos[1][1])} kr)` : ''}.${f.grupper.verdi < 0 ? ` Verdifall på bil og annet trakk ned ${kr(-f.grupper.verdi)} kr.` : ''}`;
}

function visBelaning(el, params, tegnPaNytt) {
  const db = store.db;
  const b = belaning(db);
  if (!b.depoter.length) {
    fyll(el, tomTilstand('Ingen verdipapirkreditt', 'Registrer verdipapirkreditt som gjeld med samme gruppe som depotet under Formue og gjeld, så kan belåningen stresstestes.'));
    return;
  }
  const strammest = b.depoter.filter((d) => d.maksFall != null).sort((x, y) => x.maksFall - y.maksFall)[0];
  fyll(el,
    h('section.fliser',
      flis('Verdipapirkreditt', krs(b.totalKreditt), `${kr(b.renterAar)} kr i renter per år`),
      flis('Aksjer og fond', krs(b.eksponering), `belåningsgrad ${pct(b.totalKreditt / Math.max(1, b.eksponering))}`),
      strammest ? flis('Tåler fall på', prosent(strammest.maksFall), `før grensen nås i ${strammest.navn}`, strammest.maksFall < 0.25 ? 'neg' : strammest.maksFall < 0.4 ? '' : 'pos') : null,
      flis('Renter etter fradrag', krs(b.renterAar * 0.78), 'per år (22 % fradrag)')),
    b.depoter.map((d) => depotKort(d, tegnPaNytt)),
    h('section.kort',
      h('h2', 'Hele porteføljen'),
      h('div.tabell-holder', h('table.tabell.kompakt',
        h('thead', h('tr', h('th', 'Fall i aksjer og fond'), h('th.tall', 'Tap'), h('th.tall', 'Nettoformue etter'), h('th.tall', 'Må skytes inn'))),
        h('tbody', b.totalt.map((t) => h('tr', h('td', `−${Math.round(t.fall * 100)} %`), h('td.tall.neg', kr(t.tap)), h('td.tall', kr(t.nettoformue)), h('td.tall', { class: t.mangler ? 'neg' : '' }, t.mangler ? kr(t.mangler) : '–')))))),
      h('p.dempet', 'Store fall skjer: rundt 50 % i 2008, 35 % i 2020 og 25 % i 2022 for mange aksjemarkeder. Med kreditt kan du bli tvunget til å selge når kursene er lave. En kontantbuffer eller lavere kreditt gir mer margin.')));
}

function depotKort(d, tegnPaNytt) {
  const gradFelt = (x) => {
    const inp = h('input', { inputmode: 'decimal', style: 'max-width:6rem', 'aria-label': `Belåningsgrad ${x.post.navn}`, value: String(Math.round(x.grad * 100)) });
    inp.addEventListener('change', () => {
      const v = lesBelop(inp.value);
      if (v == null) delete x.post.belaningsgrad; else x.post.belaningsgrad = Math.max(0, Math.min(100, v)) / 100;
      store.changed();
      tegnPaNytt();
    });
    return inp;
  };
  const scenarioRad = (s) => h('tr',
    h('td', `−${Math.round(s.fall * 100)} %`),
    h('td.tall', kr(s.verdi)),
    h('td.tall', s.grad != null ? prosent(s.grad) : '–'),
    h('td.tall', kr(s.belaningsverdi)),
    h('td', s.mangler > 0 ? h('span.neg', `Må skyte inn eller selge for ca. ${kr(s.mangler)} kr`) : h('span.pos', 'Innenfor grensen')));
  const papirRad = (x) => h('tr',
    h('td', x.post.navn),
    h('td.tall', kr(x.verdi)),
    h('td', gradFelt(x), ' %', x.registrert ? null : h('span.dempet', ` (anslag, standard ${Math.round((STANDARD_BELANING[x.post.type] ?? 0.5) * 100)} %)`)));
  return h('section.kort',
    h('div.kort-topp', h('h2', d.navn), h('span.dempet', `rente ${prosent(d.rente)}`)),
    h('div.fliser',
      flis('Verdi', krs(d.verdi), ''),
      flis('Kreditt', krs(d.saldo), `belåningsgrad ${d.grad != null ? prosent(d.grad) : '–'}`),
      flis('Belåningsverdi', krs(d.belaningsverdi), `utnyttet ${d.utnyttelse != null ? prosent(d.utnyttelse) : '–'}`),
      flis('Margin', krs(d.buffer), d.maksFall != null ? `markedet kan falle ${prosent(d.maksFall)}` : '', d.buffer < 0 ? 'neg' : '')),
    h('div.tabell-holder', h('table.tabell.kompakt',
      h('thead', h('tr', h('th', 'Fall i markedet'), h('th.tall', 'Verdi'), h('th.tall', 'Belåningsgrad'), h('th.tall', 'Belåningsverdi'), h('th', 'Konsekvens'))),
      h('tbody', d.scenarier.map(scenarioRad)))),
    h('details.avansert', { open: d.anslag },
      h('summary', 'Belåningsgrad per verdipapir'),
      h('p.dempet', 'Megleren bestemmer hvor mye du kan låne mot hvert verdipapir (belåningsgrad). Sjekk tallene hos Nordnet/Pareto og skriv dem inn – standard er et anslag.'),
      h('table.tabell.kompakt', h('tbody', d.poster.filter((x) => !x.kontant).map(papirRad)))));
}

function visKostnader(el, params, tegnPaNytt) {
  const db = store.db;
  const aarListe = [...new Set(db.transaksjoner.map((t) => (t.betalt || t.dato).slice(0, 4)))].sort().reverse();
  const aar = Number(params.aar || aarListe[0] || new Date().getFullYear());
  const k = skjulteKostnader(db, aar);
  const lagre = (fn) => { fn(); store.changed(); tegnPaNytt(); };
  const maks = Math.max(...k.deler.map((d) => d.belop), 1);
  fyll(el,
    h('div.fane-valg', velg(aarListe.map((a) => ({ verdi: a, tekst: a })), String(aar), { 'aria-label': 'År', onchange: (e) => tegnPaNytt({ aar: e.target.value }) })),
    h('section.fliser',
      flis(`Skjulte kostnader ${aar}`, krs(k.total), `ca. ${kr(k.total / 12)} kr per måned`),
      flis('Renter', krs(k.deler.find((d) => d.id === 'renter').belop), 'etter rentefradrag'),
      flis('Valutapåslag', krs(k.deler.find((d) => d.id === 'valuta').belop), `${k.valuta.reduce((s, v) => s + v.antall, 0)} kjøp i utenlandsk valuta`),
      flis('Gebyrer', krs(k.deler.find((d) => d.id === 'gebyr').belop), `${k.gebyrer.length} typer`)),
    h('section.kort', h('h2', 'Fordeling'),
      h('div.bidrag-liste', k.deler.map((d) => bidragRad(d.navn, -d.belop, maks)))),
    h('div.rutenett',
      h('section.kort', h('h2', 'Renter på lån og kreditt'),
        h('table.tabell.kompakt', h('thead', h('tr', h('th', 'Lån'), h('th.tall', 'Saldo'), h('th.tall', 'Rente'), h('th.tall', 'Renter/år'), h('th.tall', 'Etter fradrag'))),
          h('tbody', k.lan.map((l) => h('tr', h('td', l.navn), h('td.tall', kr(l.saldo)), h('td.tall', prosent(l.rente)), h('td.tall', kr(l.renter)), h('td.tall', kr(l.netto)))))),
        h('p.dempet', 'Anslag: saldo ved årets slutt × rente. Høyest rente bør betales ned først.')),
      h('section.kort', h('h2', 'Valutapåslag på kort'),
        k.valuta.length ? h('table.tabell.kompakt', h('thead', h('tr', h('th', 'Kort'), h('th.tall', 'Kjøp i valuta'), h('th', 'Påslag %'), h('th.tall', 'Påslag'))),
          h('tbody', k.valuta.map((v) => h('tr', h('td', v.navn, h('br'), h('small.dempet', `${v.antall} kjøp · ${v.valutaer.join(', ')}`)), h('td.tall', kr(v.belop)),
            h('td', h('input', { inputmode: 'decimal', style: 'max-width:5rem', 'aria-label': `Valutapåslag ${v.navn}`, value: String(v.sats * 100).replace('.', ','), onchange: (e) => lagre(() => {
              const x = lesBelop(e.target.value);
              db.innstillinger.valutapaslag ||= {};
              if (x == null) delete db.innstillinger.valutapaslag[v.konto]; else db.innstillinger.valutapaslag[v.konto] = x / 100;
            }) })),
            h('td.tall', kr(v.paslag)))))) : h('p.dempet', 'Ingen kjøp i utenlandsk valuta.'),
        h('p.dempet', `Kortselskapene legger vanligvis 1–2 % på valutakursen (standard her: ${String(STANDARD_VALUTAPASLAG * 100).replace('.', ',')} %). Se prislisten for kortet ditt – noen kort har 0 % påslag og kan lønne seg på reise.`)),
      h('section.kort', h('h2', 'Gebyrer'),
        k.gebyrer.length ? h('table.tabell.kompakt', h('tbody', k.gebyrer.map((g) => h('tr', h('td', g.navn), h('td.tall', kr(g.belop)))))) : h('p.dempet', 'Ingen gebyrer funnet.'),
        h('p.dempet', 'Kontoer og kort med månedsgebyr kan ofte byttes til gratisvarianter, eller gebyret kan fjernes med en fordelsavtale.')),
      h('section.kort', h('h2', 'Fond og pensjon'),
        h('table.tabell.kompakt', h('thead', h('tr', h('th', 'Fond'), h('th.tall', 'Verdi'), h('th', 'Årlig kostnad %'), h('th.tall', 'Per år'))),
          h('tbody', k.fond.map((x) => h('tr', h('td', x.navn), h('td.tall', kr(x.verdi)),
            h('td', h('input', { inputmode: 'decimal', style: 'max-width:5rem', 'aria-label': `Kostnad ${x.navn}`, placeholder: 'f.eks. 0,2', value: x.sats != null ? String(Math.round(x.sats * 10000) / 100).replace('.', ',') : '', onchange: (e) => lagre(() => {
              const v = lesBelop(e.target.value);
              if (v == null) delete x.post.kostnadProsent; else x.post.kostnadProsent = v / 100;
            }) })),
            h('td.tall', x.kostnad != null ? kr(x.kostnad) : '–'))))),
        h('p.dempet', 'Skriv inn forvaltningshonoraret (står i faktaarket for fondet). Indeksfond koster typisk 0,1–0,3 %, aktive fond 1–2 % – forskjellen blir stor over mange år.')),
      h('section.kort', h('h2', 'Kurtasje og depotgebyr'),
        h('label', 'Sum i ', String(aar), ' (kr): ', h('input', { inputmode: 'decimal', style: 'max-width:8rem', value: k.manuelt.kurtasje ? String(k.manuelt.kurtasje) : '', onchange: (e) => lagre(() => {
          db.kostnader ||= {};
          db.kostnader[aar] ||= {};
          const v = lesBelop(e.target.value);
          if (v == null) delete db.kostnader[aar].kurtasje; else db.kostnader[aar].kurtasje = v;
        }) })),
        h('p.dempet', 'Finnes på årsoppgaven fra megleren. Trekkes i depotet og vises derfor ikke i banktransaksjonene.'))));
}

function visAvvik(el, params, tegnPaNytt) {
  const db = store.db;
  const liste = avvik(db);
  const ikon = { hoy: '▲', middels: '●', info: '○' };
  const ignorer = (a) => { db.ignorerteAvvik ||= {}; db.ignorerteAvvik[a.id] = new Date().toISOString().slice(0, 10); store.changed(); tegnPaNytt(); };
  const antallIgnorert = Object.keys(db.ignorerteAvvik || {}).length;
  fyll(el,
    h('p.dempet', 'Siste 120 dager: mulige dobbeltbelastninger, uvanlig store beløp, nye faste trekk, prisøkninger, gebyrer og refusjoner som mangler.'),
    liste.length ? h('section.kort.varsler', h('ul', liste.map((a) => h(`li.pam.${a.alvor}`,
      h('span.pam-ikon', { 'aria-hidden': 'true' }, ikon[a.alvor]),
      a.lenke ? h('a', { href: a.lenke }, a.tekst) : h('a', { href: a.transaksjoner?.[0] ? `#/transaksjoner?q=${encodeURIComponent(a.transaksjoner[0].tekst)}` : '#/transaksjoner' }, a.tekst),
      h('button.lenke.pam-skjul', { type: 'button', title: 'Ikke vis igjen', onclick: () => ignorer(a) }, 'OK'))))) : tomTilstand('Ingen avvik', 'Ingenting skiller seg ut de siste 120 dagene.'),
    antallIgnorert ? h('p.dempet', `${antallIgnorert} avvik er markert som OK. `, h('button.lenke', { type: 'button', onclick: () => { db.ignorerteAvvik = {}; store.changed(); tegnPaNytt(); } }, 'Vis dem igjen')) : null);
}
