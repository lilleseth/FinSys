// Månedsrapport – vises som side og lagres som PDF via nettleserens utskrift.

import { h, kr, krs, pct, datoNo, signert } from '../util.js';
import { velg, sideTopp, tomTilstand } from '../ui.js';
import { store } from '../store.js';
import { lagRapport, lagAarsrapport, manederMedData, mndTekst } from '../model/report.js';
import { skatteprognose } from '../model/tax.js';
import { fastePoster, oppsummerFaste } from '../model/recurring.js';
import { kategoriIndeks } from '../model/categories.js';
import { linjegraf, soylegraf, stolpeliste } from '../charts.js';
import { ukeSammendrag, ukerMedData, ukenummer, sisteUke } from '../model/week.js';

export function render(el, params) {
  const db = store.db;
  const grunnlag = params.grunnlag || 'betalt';
  const mnder = manederMedData(db, grunnlag);
  if (!mnder.length) {
    el.append(sideTopp('Månedsrapport'), tomTilstand('Ingen data ennå', 'Importer transaksjoner for å lage en rapport.'));
    return;
  }
  const periodeValg = (aktiv) => h('div.segment', { role: 'group', 'aria-label': 'Rapporttype' },
    h('a.knapp', { href: '#/rapport?periode=uke', class: aktiv === 'uke' ? 'aktiv' : '' }, 'Uke'),
    h('a.knapp', { href: '#/rapport', class: aktiv === 'mnd' ? 'aktiv' : '' }, 'Måned'),
    h('a.knapp', { href: '#/rapport?periode=aar', class: aktiv === 'aar' ? 'aktiv' : '' }, 'År'));
  if (params.periode === 'aar') return renderAar(el, params, mnder, periodeValg);
  if (params.periode === 'uke') return renderUke(el, params, periodeValg);
  const mnd = params.mnd && mnder.includes(params.mnd) ? params.mnd : mnder[mnder.length - 1];
  const r = lagRapport(db, mnd, grunnlag);
  const idx = kategoriIndeks(db.kategorier);
  document.title = `FinSys månedsrapport ${r.navn}`;

  const gaTil = (p) => { location.hash = `#/rapport?${new URLSearchParams({ mnd, grunnlag, ...p })}`; };
  const mndValg = velg([...mnder].reverse().map((m) => ({ verdi: m, tekst: mndTekst(m) })), mnd, { 'aria-label': 'Måned', onchange: (e) => gaTil({ mnd: e.target.value }) });

  el.append(h('div.ikke-utskrift', sideTopp('Månedsrapport', 'Oppsummering av måneden med nøkkeltall, avvik og høydepunkter. Velg «Lagre som PDF» i utskriftsdialogen.',
    periodeValg('mnd'),
    mndValg,
    h('div.segment', { role: 'group', 'aria-label': 'Månedsgrunnlag' },
      h('button', { type: 'button', class: grunnlag === 'betalt' ? 'aktiv' : '', onclick: () => gaTil({ grunnlag: 'betalt' }) }, 'Betalingsmåned'),
      h('button', { type: 'button', class: grunnlag === 'kjopt' ? 'aktiv' : '', onclick: () => gaTil({ grunnlag: 'kjopt' }) }, 'Kjøpsmåned')),
    h('button.primar', { type: 'button', onclick: () => window.print() }, 'Lagre som PDF / skriv ut'))));

  const d = r.denne;
  const delta = (na, for_, oppErBra = true, enhet = 'kr') => {
    if (for_ == null || na == null) return null;
    const diff = na - for_;
    if (Math.abs(diff) < (enhet === '%' ? 0.005 : 1)) return h('span.delta', 'uendret');
    const bra = oppErBra ? diff > 0 : diff < 0;
    const tekst = enhet === '%' ? `${diff > 0 ? '+' : '−'}${Math.abs(diff * 100).toFixed(1).replace('.', ',')} pp` : `${diff > 0 ? '+' : '−'}${kr(Math.abs(diff))}`;
    return h('span.delta', { class: bra ? 'bra' : 'darlig' }, `${diff > 0 ? '▲' : '▼'} ${tekst}`);
  };
  const tile = (navn, verdi, sammenlign) => h('div.r-flis', h('div.r-flis-navn', navn), h('div.r-flis-verdi', verdi), h('div.r-flis-sml', sammenlign));
  const sml = (na, for_, snitt, oppErBra, enhet) => [
    delta(na, for_, oppErBra, enhet), for_ != null ? h('span', ` mot ${r.forrigeNavn.split(' ')[0].toLowerCase()}`) : null,
    snitt != null && r.snitt.antall >= 2 ? h('div', `snitt ${r.snitt.antall} mnd: ${enhet === '%' ? pct(snitt) : kr(snitt)}`) : null,
  ];
  const snittRate = r.snitt.antall >= 2 && r.snitt.inntekt ? r.snitt.netto / r.snitt.inntekt : null;

  const rapport = h('article.rapport',
    h('header.r-topp',
      h('div', h('div.r-merke', 'FinSys · Månedsrapport'), h('h1', r.navn)),
      h('div.r-meta', `Laget ${datoNo(r.laget.slice(0, 10))}`, h('br'), grunnlag === 'betalt' ? 'Etter betalingsmåned' : 'Etter kjøpsmåned', h('br'), `${d.antall} transaksjoner`)),

    h('section.r-seksjon',
      h('div.r-fliser',
        tile('Inntekter', krs(d.inntekt), sml(d.inntekt, r.forrige.antall ? r.forrige.inntekt : null, r.snitt.inntekt, true)),
        tile('Forbruk', krs(d.forbruk), sml(d.forbruk, r.forrige.antall ? r.forrige.forbruk : null, r.snitt.forbruk, false)),
        tile('Netto (spart)', krs(d.netto), sml(d.netto, r.forrige.antall ? r.forrige.netto : null, r.snitt.netto, true)),
        tile('Sparerate', pct(d.sparerate), sml(d.sparerate, r.forrige.antall ? r.forrige.sparerate : null, snittRate, true, '%')),
        tile('Investert', krs(-d.sparing), r.snitt.antall >= 2 ? h('div', `snitt: ${kr(-r.snitt.sparing)}`) : null),
        tile('Nettoformue', r.formue ? krs(r.formue.netto) : '–', r.formue && r.formueForrige ? [delta(r.formue.netto, r.formueForrige.netto, true), h('span', ' mot forrige mnd')] : h('div', r.formue?.kilde || 'Ingen verdier')),
        tile('Gjeld', krs(r.gjeld.reduce((s, g) => s + g.saldo, 0)), (() => { const e = r.gjeld.filter((g) => g.endring != null).reduce((s, g) => s + g.endring, 0); return e ? [delta(e, 0, false), h('span', ' i måneden')] : null; })()),
        tile('Uten kategori', String(r.ukategorisert), r.ukategorisert ? h('div', 'bør kategoriseres') : h('div', 'alt kategorisert')))),

    h('section.r-seksjon', h('h2', 'Oppsummering'), r.oppsummering.map((p) => h('p', p))),

    h('section.r-seksjon.r-to',
      h('div', h('h3', 'Inntekter og forbruk, siste 12 måneder'),
        soylegraf({
          kategorier: r.serie12.map((x) => x.etikett),
          titler: r.serie12.map((x) => mndTekst(x.mnd)),
          serier: [{ navn: 'Inntekter', verdier: r.serie12.map((x) => x.inntekt), klasse: 's1' }, { navn: 'Forbruk', verdier: r.serie12.map((x) => x.forbruk), klasse: 's2' }],
          hoyde: 200, format: krs,
        })),
      h('div', h('h3', 'Nettoformue'), r.formueSerie.length >= 2 ? linjegraf({ punkter: r.formueSerie, hoyde: 200, serieNavn: 'Nettoformue', format: krs }) : h('p.dempet', 'For få frosne måneder til graf. Bruk «Frys måned» under Formue og gjeld.'))),

    h('section.r-seksjon', h('h2', 'Inntekter og utgifter per kategori'),
      h('div.tabell-holder', h('table.tabell.r-tabell',
        h('thead', h('tr', h('th', 'Kategori'), h('th.tall', r.navn.split(' ')[0]), h('th.tall', r.forrigeNavn.split(' ')[0]), h('th.tall', `Snitt ${r.snitt.antall} mnd`), h('th.tall', 'Mot snitt'))),
        h('tbody', ['inntekt', 'utgift'].flatMap((type) => {
          const rader = r.kategorier.filter((k) => k.type === type).sort((a, b) => Math.abs(b.denne) - Math.abs(a.denne));
          if (!rader.length) return [];
          return [h('tr.seksjon', h('th', { colspan: 5 }, type === 'inntekt' ? 'Inntekter' : 'Utgifter')), ...rader.map((k) => {
            const diff = k.denne - k.snitt;
            const bra = diff > 0; // utgifter er negative tall: høyere tall = lavere forbruk
            return h('tr', h('td', k.navn), h('td.tall', kr(k.denne)), h('td.tall', kr(k.forrige)), h('td.tall', r.snitt.antall ? kr(k.snitt) : '–'),
              h('td.tall', r.snitt.antall && Math.abs(diff) >= 1 ? h('span.delta', { class: bra ? 'bra' : 'darlig' }, signert(Math.round(diff))) : '–'));
          })];
        })),
        h('tfoot',
          h('tr.delsum', h('th', 'Netto kontantstrøm'), h('td.tall', kr(d.netto)), h('td.tall', kr(r.forrige.netto)), h('td.tall', r.snitt.antall ? kr(r.snitt.netto) : '–'), h('td.tall', r.snitt.antall ? signert(Math.round(d.netto - r.snitt.netto)) : '–')))))),

    h('section.r-seksjon.r-to',
      h('div', h('h3', 'Største utgifter'), r.storsteUt.length ? h('table.tabell.kompakt', h('tbody', r.storsteUt.map((t) => h('tr', h('td', datoNo(t.dato).slice(0, 5)), h('td', t.tekst, h('small', idx.hent(t.kategori)?.navn || 'Ukategorisert')), h('td.tall', kr(t.belop)))))) : h('p.dempet', 'Ingen.')),
      h('div',
        h('h3', 'Største avvik fra snittet'),
        r.avvik.length ? stolpeliste({ elementer: r.avvik.map((a) => ({ etikett: `${a.navn} (${a.diff > 0 ? 'mer' : 'mindre'})`, verdi: Math.abs(a.diff) })), format: (v) => kr(v) + ' kr', visAndel: false }) : h('p.dempet', r.snitt.antall >= 2 ? 'Ingen store avvik.' : 'For lite historikk.'),
        r.nyeSteder.length ? [h('h3', 'Nye steder'), h('ul.r-liste', r.nyeSteder.map((x) => h('li', `${x.tekst} – ${kr(-x.belop)} kr${x.antall > 1 ? ` (${x.antall} kjøp)` : ''}`)))] : null)),

    r.budsjett ? h('section.r-seksjon', h('h2', 'Budsjett'),
      h('div.tabell-holder', h('table.tabell.r-tabell', h('thead', h('tr', h('th', 'Kategori'), h('th.tall', 'Budsjett'), h('th.tall', 'Brukt'), h('th.tall', 'Igjen'), h('th', 'Status'))),
        h('tbody', r.budsjett.rader.filter((x) => x.budsjett).map((x) => {
          const status = x.andel > 1 ? ['over', '▲ Over'] : x.andel >= 0.9 ? ['naer', '● Nær grensen'] : ['ok', '✓ Innenfor'];
          return h('tr', h('td', x.navn), h('td.tall', kr(x.budsjett)), h('td.tall', kr(x.brukt)), h('td.tall', kr(x.budsjett - x.brukt)),
            h('td', h('div.maler', { class: status[0] }, h('div.maler-spor', h('div.maler-fyll', { style: `width:${Math.min(x.andel, 1) * 100}%` })), h('span', `${Math.round(x.andel * 100)} % ${status[1]}`))));
        }))))) : null,

    h('section.r-seksjon.r-to',
      h('div', h('h3', 'Gjeld'), r.gjeld.length
        ? h('table.tabell.kompakt', h('thead', h('tr', h('th', 'Lån'), h('th.tall', 'Saldo'), h('th.tall', 'Endring'))), h('tbody', r.gjeld.map((g) => h('tr', h('td', g.navn, h('small', g.dato ? `pr. ${datoNo(g.dato)}` : '')), h('td.tall', kr(g.saldo)), h('td.tall', g.endring != null ? signert(Math.round(g.endring)) : '–')))))
        : h('p.dempet', 'Ingen gjeld registrert.')),
      h('div', h('h3', 'Eiendeler'), (() => {
        const grupper = new Map();
        for (const x of r.formueDetalj.eiendeler) if (x.verdi) grupper.set(x.post.gruppe || 'Annet', (grupper.get(x.post.gruppe || 'Annet') || 0) + x.verdi);
        return grupper.size ? stolpeliste({ elementer: [...grupper.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([g, v]) => ({ etikett: g, verdi: v })), format: (v) => kr(v) + ' kr' }) : h('p.dempet', 'Ingen eiendeler registrert.');
      })(), r.formue ? h('p.dempet', `${r.formue.kilde}${r.formue.dato ? `, siste verdi ${datoNo(r.formue.dato)}` : ''}.`) : null)),

    r.lonn ? h('section.r-seksjon', h('h2', 'Lønnsslipp'),
      h('table.tabell.kompakt.r-lonn', h('tbody',
        [['Fastlønn', 'fastlonn'], ['Overtid', null], ['Bruttolønn', 'brutto'], ['Skattetrekk', 'skattetrekk'], ['Trekkfrie tillegg', 'trekkfrie'], ['Utbetalt', 'netto']].map(([navn, k]) => {
          const v = k ? r.lonn[k] : (r.lonn.overtid50 || 0) + (r.lonn.overtid100 || 0);
          return v ? h('tr', h('td', navn), h('td.tall', kr(v))) : null;
        }),
        r.lonn.brutto ? h('tr.delsum', h('td', 'Effektivt skattetrekk'), h('td.tall', pct(-r.lonn.skattetrekk / r.lonn.brutto))) : null))) : null,

    (r.husk.length || r.notater.length) ? h('section.r-seksjon', h('h2', 'Huskeliste og notater'),
      r.husk.length ? h('ul.r-liste', r.husk.map((n) => h('li', `☐ ${n.tekst}`))) : null,
      r.notater.map((n) => h('div.r-notat', h('strong', n.tittel || 'Notat'), h('p', n.tekst.slice(0, 600))))) : null,

    h('section.r-seksjon.r-datakvalitet', h('h3', 'Datagrunnlag'),
      h('p.dempet', `Siste transaksjon per konto: ${r.sisteImport.map((k) => `${k.konto} ${k.siste ? datoNo(k.siste) : '–'}`).join(' · ')}.`),
      r.sisteImport.some((k) => k.mangler) ? h('p.dempet', `Kontoer uten transaksjoner etter den 20. ${r.navn.split(' ')[0].toLowerCase()} kan mangle data: ${r.sisteImport.filter((k) => k.mangler).map((k) => k.konto).join(', ')}.`) : null,
      h('footer.r-bunn', `FinSys · ${r.navn} · tallene er beregnet fra registrerte transaksjoner og verdier`)));

  el.append(rapport);
}

// ---------- Årsrapport ----------

function renderAar(el, params, mnder, periodeValg) {
  const db = store.db;
  const aarListe = [...new Set(mnder.map((m) => m.slice(0, 4)))].sort();
  const aar = Number(params.aar && aarListe.includes(params.aar) ? params.aar : aarListe[aarListe.length - 1]);
  const r = lagAarsrapport(db, aar);
  const skatt = skatteprognose(db, aar);
  const faste = oppsummerFaste(fastePoster(db));
  document.title = `FinSys årsrapport ${aar}`;
  const aarValg = velg([...aarListe].reverse().map((a) => ({ verdi: a, tekst: a })), String(aar), { 'aria-label': 'År', onchange: (e) => { location.hash = `#/rapport?periode=aar&aar=${e.target.value}`; } });
  el.append(h('div.ikke-utskrift', sideTopp('Årsrapport', 'Året samlet, med sjekkliste for skattemeldingen. Velg «Lagre som PDF» i utskriftsdialogen.',
    periodeValg('aar'), aarValg, h('button.primar', { type: 'button', onclick: () => window.print() }, 'Lagre som PDF / skriv ut'))));

  const tile = (navn, verdi, tillegg) => h('div.r-flis', h('div.r-flis-navn', navn), h('div.r-flis-verdi', verdi), h('div.r-flis-sml', tillegg));
  const mot = (na, for_, oppErBra = true) => {
    if (for_ == null) return null;
    const d = na - for_;
    return h('span.delta', { class: (oppErBra ? d > 0 : d < 0) ? 'bra' : 'darlig' }, `${d > 0 ? '▲' : '▼'} ${kr(Math.abs(d))} mot ${aar - 1}`);
  };
  const fStart = r.formueStart;
  const fSlutt = r.formueSlutt;
  const medData = r.mnder.filter((m) => m.antall);

  el.append(h('article.rapport',
    h('header.r-topp',
      h('div', h('div.r-merke', 'FinSys · Årsrapport'), h('h1', String(aar))),
      h('div.r-meta', `Laget ${datoNo(new Date().toISOString().slice(0, 10))}`, h('br'), `${r.antallMnd} måneder med data`, h('br'), 'Etter betalingsmåned')),
    h('section.r-seksjon', h('div.r-fliser',
      tile('Inntekter', krs(r.inntekt), mot(r.inntekt, r.forrige?.inntekt)),
      tile('Forbruk', krs(r.forbruk), mot(r.forbruk, r.forrige?.forbruk, false)),
      tile('Netto (spart)', krs(r.netto), mot(r.netto, r.forrige?.netto)),
      tile('Sparerate', pct(r.sparerate), `snitt ${kr(r.netto / Math.max(1, r.antallMnd))} kr/mnd`),
      tile('Investert', krs(r.sparing), null),
      tile('Nettoformue', fSlutt ? krs(fSlutt.nettoformue) : '–', fStart && fSlutt && fStart !== fSlutt ? h('span.delta', { class: fSlutt.nettoformue >= fStart.nettoformue ? 'bra' : 'darlig' }, `${fSlutt.nettoformue >= fStart.nettoformue ? '▲' : '▼'} ${kr(Math.abs(fSlutt.nettoformue - fStart.nettoformue))} siden ${mndTekst(fStart.mnd).toLowerCase()}`) : h('div', 'frys måneder for utvikling')),
      tile('Skatt (anslag)', krs(skatt.sumSkatt), skatt.differanse >= 0 ? `restskatt ca. ${kr(skatt.differanse)} kr` : `til gode ca. ${kr(-skatt.differanse)} kr`),
      tile('Faste utgifter', krs(faste.utgifterPerMnd * 12), 'per år, dagens nivå'))),
    h('section.r-seksjon.r-to',
      h('div', h('h3', 'Inntekter og forbruk per måned'), soylegraf({ kategorier: r.mnder.map((m) => m.navn), titler: r.mnder.map((m) => mndTekst(m.mnd)), serier: [{ navn: 'Inntekter', verdier: r.mnder.map((m) => m.inntekt), klasse: 's1' }, { navn: 'Forbruk', verdier: r.mnder.map((m) => m.forbruk), klasse: 's2' }], hoyde: 200, format: krs })),
      h('div', h('h3', 'Største utgiftsområder'), stolpeliste({ elementer: r.kategorier.filter((k) => k.type === 'utgift' && k.aar < 0).sort((a, b) => a.aar - b.aar).slice(0, 8).map((k) => ({ etikett: k.navn, verdi: -k.aar })), format: (v) => kr(v) + ' kr' }))),
    h('section.r-seksjon', h('h2', 'Måned for måned'), h('div.tabell-holder', h('table.tabell.r-tabell',
      h('thead', h('tr', h('th', 'Måned'), h('th.tall', 'Inntekter'), h('th.tall', 'Forbruk'), h('th.tall', 'Netto'), h('th.tall', 'Sparerate'), h('th.tall', 'Investert'))),
      h('tbody', medData.map((m) => h('tr', h('td', mndTekst(m.mnd)), h('td.tall', kr(m.inntekt)), h('td.tall', kr(m.forbruk)), h('td.tall', { class: m.netto < 0 ? 'neg' : '' }, kr(m.netto)), h('td.tall', pct(m.sparerate)), h('td.tall', m.sparing ? kr(-m.sparing) : '–')))),
      h('tfoot', h('tr.delsum', h('th', 'Sum'), h('td.tall', kr(r.inntekt)), h('td.tall', kr(r.forbruk)), h('td.tall', kr(r.netto)), h('td.tall', pct(r.sparerate)), h('td.tall', kr(r.sparing))))))),
    h('section.r-seksjon', h('h2', 'Per kategori'), h('div.tabell-holder', h('table.tabell.r-tabell',
      h('thead', h('tr', h('th', 'Kategori'), h('th.tall', String(aar)), h('th.tall', 'Per måned'), r.forrige ? h('th.tall', String(aar - 1)) : null)),
      h('tbody', ['inntekt', 'utgift'].flatMap((type) => {
        const rader = r.kategorier.filter((k) => k.type === type).sort((a, b) => Math.abs(b.aar) - Math.abs(a.aar));
        return rader.length ? [h('tr.seksjon', h('th', { colspan: r.forrige ? 4 : 3 }, type === 'inntekt' ? 'Inntekter' : 'Utgifter')), ...rader.map((k) => h('tr', h('td', k.navn), h('td.tall', kr(k.aar)), h('td.tall', kr(k.perMnd)), r.forrige ? h('td.tall', kr(k.forrige)) : null))] : [];
      }))))),
    h('section.r-seksjon', h('h2', `Sjekkliste for skattemeldingen ${aar}`),
      h('p.dempet', `Verdier pr. 31.12.${aar} der de finnes, ellers siste registrerte verdi (dato står bak). Sammenlign med den forhåndsutfylte skattemeldingen.`),
      ...r.sjekk.map((g) => h('div.r-sjekk', h('h3', g.navn),
        h('table.tabell.kompakt', h('tbody', g.linjer.map((l) => h('tr', h('td', '☐ ', l.navn), h('td.tall', kr(l.verdi)), h('td.dempet', l.dato && l.dato !== `${aar}-12-31` ? `pr. ${datoNo(l.dato)}` : ''), h('td.dempet', l.skattemessig != null ? `formuesverdi ${kr(l.skattemessig)}` : ''))))),
        h('p.dempet', g.merknad))),
      h('div.r-sjekk', h('h3', 'Fradrag og inntekter'),
        h('table.tabell.kompakt', h('tbody',
          ...r.renter.map((x) => h('tr', h('td', `☐ Renter ${x.navn} (anslag)`), h('td.tall', kr(x.renter)), h('td.dempet', 'se årsoppgave'))),
          r.fagforening ? h('tr', h('td', '☐ Fagforeningskontingent'), h('td.tall', kr(r.fagforening)), h('td.dempet', 'registrerte betalinger')) : null,
          ...r.utbytte.map((u) => h('tr', h('td', `☐ Utbytte ${u.gruppe}`), h('td.tall', kr(u.belop)), h('td.dempet', u.gruppe.includes('ASK') ? 'i ASK – ikke skattepliktig før uttak' : 'skattepliktig'))),
          h('tr', h('td', '☐ Lønn og forskuddstrekk'), h('td.tall', kr(skatt.bruttoAar)), h('td.dempet', `trekk ${kr(skatt.trukket)} kr${skatt.gjenstaende ? ' (delvis anslag)' : ''}`)))),
        h('p.dempet', 'Husk også: reisefradrag, gaver til godkjente organisasjoner, IPS, foreldrefradrag, og at kryptovaluta skal føres opp med verdi pr. 31.12.'))),
    h('footer.r-bunn', `FinSys · Årsrapport ${aar} · tallene er beregnet fra registrerte transaksjoner og verdier og er ikke en offisiell skatteberegning`)));
}

function renderUke(el, params, periodeValg) {
  const db = store.db;
  const uker = ukerMedData(db);
  const start = params.uke && uker.includes(params.uke) ? params.uke : sisteUke(db);
  const u = ukeSammendrag(db, start);
  document.title = `FinSys ukeoppsummering ${u.navn}`;
  const ukeValg = velg([...uker].reverse().slice(0, 104).map((m) => ({ verdi: m, tekst: `Uke ${ukenummer(m).uke} ${ukenummer(m).aar} (${datoNo(m)})` })), start, { 'aria-label': 'Uke', onchange: (e) => { location.hash = `#/rapport?periode=uke&uke=${e.target.value}`; } });
  el.append(h('div.ikke-utskrift', sideTopp('Ukeoppsummering', 'Uka etter kjøpsdato, sammenlignet med snittet for de åtte foregående ukene.',
    periodeValg('uke'), ukeValg, h('button.primar', { type: 'button', onclick: () => window.print() }, 'Lagre som PDF / skriv ut'))));
  const tile = (navn, verdi, tillegg) => h('div.r-flis', h('div.r-flis-navn', navn), h('div.r-flis-verdi', verdi), h('div.r-flis-sml', tillegg));
  const avvik = u.snitt != null ? u.forbruk - u.snitt : null;
  el.append(h('article.rapport',
    h('header.r-topp',
      h('div', h('div.r-merke', 'FinSys · Ukeoppsummering'), h('h1', u.navn)),
      h('div.r-meta', `${datoNo(u.start)}–${datoNo(u.slutt)}`, h('br'), `${u.antall} transaksjoner`, h('br'), 'Etter kjøpsdato')),
    h('section.r-seksjon', h('div.r-fliser',
      tile('Forbruk', krs(u.forbruk), avvik != null ? h('span.delta', { class: avvik <= 0 ? 'bra' : 'darlig' }, `${avvik > 0 ? '▲' : '▼'} ${kr(Math.abs(avvik))} mot snittuke (${kr(u.snitt)})`) : null),
      tile('Inntekter', krs(u.inntekt), ''),
      u.tempo ? tile('Budsjett hittil i måneden', pct(u.tempo.andel), h('span.delta', { class: u.tempo.brukt <= u.tempo.forventet ? 'bra' : 'darlig' }, `${kr(u.tempo.brukt)} av ${kr(u.tempo.budsjett)} kr – ${u.tempo.brukt <= u.tempo.forventet ? 'i rute' : 'foran tempoet'}`)) : null,
      tile('Uten kategori', String(u.ukategorisert), u.ukategorisert ? 'bør kategoriseres' : 'alt kategorisert'))),
    h('section.r-seksjon', h('h2', 'Kategorier'),
      u.kategorier.length ? h('table.tabell.kompakt', h('thead', h('tr', h('th', 'Kategori'), h('th.tall', 'Denne uka'), h('th.tall', 'Snittuke'), h('th.tall', 'Avvik'))),
        h('tbody', u.kategorier.map((k) => h('tr', h('td', k.navn), h('td.tall', kr(k.belop)), h('td.tall', k.snitt != null ? kr(k.snitt) : '–'), h('td.tall', { class: k.avvik > 0 ? 'neg' : 'pos' }, k.avvik != null ? signert(Math.round(k.avvik)) : '–'))))) : h('p.dempet', 'Ingen utgifter.')),
    h('div.r-to',
      h('section.r-seksjon', h('h2', 'Største kjøp'),
        u.storste.length ? h('ul.r-liste', u.storste.map((t) => h('li', `${datoNo(t.dato)} ${t.tekst} – ${kr(-t.belop)} kr`))) : h('p.dempet', 'Ingen.')),
      h('section.r-seksjon', h('h2', 'Nye steder'),
        u.nyeSteder.length ? h('ul.r-liste', u.nyeSteder.map((t) => h('li', `${t.tekst} – ${kr(-t.belop)} kr`))) : h('p.dempet', 'Ingen nye steder.'))),
    h('section.r-seksjon', h('h2', 'Neste uke'),
      u.kommende.length ? h('ul.r-liste', u.kommende.map((p) => h('li', `${datoNo(p.neste)} ${p.navn} – ${signert(Math.round(p.belop))} kr`))) : h('p.dempet', 'Ingen faste trekk eller inntekter ventet.'))));
}
