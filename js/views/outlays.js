// Utlegg og refusjoner per motpart.

import { h, clear, kr, krs, datoNo, uid, lesBelop } from '../util.js';
import { felt, dialog, sideTopp, flis, toast, tomTilstand } from '../ui.js';
import { store } from '../store.js';
import { utleggsoversikt, motparter } from '../model/outlays.js';
import { kategoriIndeks } from '../model/categories.js';

const fyll = (el, ...x) => el.append(...x.flat().filter(Boolean));
const alder = (d) => (d == null ? '–' : d < 1 ? 'i dag' : d < 60 ? `${d} dager` : `${Math.round(d / 30)} mnd`);

export function render(el, params) {
  const db = store.db;
  const tegnPaNytt = (p = {}) => { clear(el); render(el, { ...params, ...p }); };
  const o = utleggsoversikt(db);
  const idx = kategoriIndeks(db.kategorier);
  const aar = new Date().getFullYear();
  fyll(el, sideTopp('Utlegg og refusjoner', 'Hva du har lagt ut for andre, hva som er betalt tilbake og hva som mangler.'));
  if (!o.grupper.length) {
    fyll(el, tomTilstand('Ingen utlegg ennå', 'Kategoriser en transaksjon som «Utlegg som refunderes» (eller merk den med etiketten «Refunderes») og sett motpart, så dukker den opp her.'));
    return;
  }
  const medMotpart = o.grupper.filter((g) => g.id);
  const utestaende = medMotpart.filter((g) => g.utestaende >= 1);
  const eldste = utestaende.map((g) => g.dager).filter((d) => d != null).sort((a, b) => b - a)[0];
  const refIAar = medMotpart.flatMap((g) => g.poster.filter((p) => p.refusjon && (p.t.betalt || p.t.dato).startsWith(String(aar)))).reduce((s, p) => s + p.belop, 0);
  fyll(el, h('section.fliser',
    flis('Utestående', krs(o.utestaende), utestaende.length ? `hos ${utestaende.length} ${utestaende.length === 1 ? 'motpart' : 'motparter'}` : 'alt er betalt tilbake'),
    flis('Eldste ubetalte', eldste != null ? alder(eldste) : '–', eldste != null ? 'siden utlegget' : ''),
    flis(`Refundert ${aar}`, krs(refIAar), ''),
    flis('Motparter', String(medMotpart.length), '')));

  // Oversikt per motpart
  fyll(el, h('section.kort',
    h('h2', 'Per motpart'),
    h('div.tabell-holder', h('table.tabell.kompakt',
      h('thead', h('tr', h('th', 'Motpart'), h('th.tall', 'Utlagt'), h('th.tall', 'Refundert'), h('th.tall', 'Utestående'), h('th', 'Eldste ubetalte'), h('th', 'Siste refusjon'))),
      h('tbody', medMotpart.map((g) => h('tr.klikkbar', { class: params.m === g.id ? 'valgt' : '', onclick: () => tegnPaNytt({ m: g.id }) },
        h('td', g.navn), h('td.tall', kr(g.utlagt)), h('td.tall', kr(g.refundert)),
        h('td.tall.sum', { class: g.utestaende >= 1 ? 'neg' : g.utestaende <= -1 ? 'pos' : '' }, kr(g.utestaende)),
        h('td', g.eldsteUbetalt ? `${datoNo(g.eldsteUbetalt)} (${alder(g.dager)})` : '–'),
        h('td', g.sisteRefusjon ? datoNo(g.sisteRefusjon) : '–')))))),
    h('p.dempet', 'Refusjoner fordeles på de eldste utleggene først. Negativ utestående betyr at det er betalt tilbake mer enn registrerte utlegg – f.eks. utlegg fra før dataene starter. Bruk «Innstillinger» på motparten for å sette startdato eller startsaldo.')));

  // Detaljer for valgt motpart
  const valgt = medMotpart.find((g) => g.id === params.m) || medMotpart.find((g) => g.utestaende >= 1) || medMotpart[0];
  if (valgt) {
    fyll(el, h('section.kort',
      h('div.kort-topp', h('h2', valgt.navn), h('button.sekundar.liten', { type: 'button', onclick: () => innstillinger(valgt) }, 'Innstillinger')),
      h('div.tabell-holder', h('table.tabell.kompakt',
        h('thead', h('tr', h('th', 'Dato'), h('th', 'Tekst'), h('th', 'Kategori'), h('th.tall', 'Beløp'), h('th', 'Status'), h('th'))),
        h('tbody', [...valgt.poster].reverse().map((p) => h('tr',
          h('td', datoNo(p.t.dato)), h('td', p.t.tekst), h('td.dempet', idx.hent(p.t.kategori)?.navn || ''),
          h('td.tall', { class: p.refusjon ? 'pos' : '' }, p.refusjon ? `+${kr(p.belop)}` : kr(-p.belop)),
          h('td', p.refusjon ? h('span.pos', 'Refusjon') : p.gjenstar < 0.005 ? h('span.dempet', '✓ Betalt tilbake') : p.gjenstar < p.belop - 0.005 ? h('span.neg', `Delvis – ${kr(p.gjenstar)} kr mangler`) : h('span.neg', 'Utestående')),
          h('td', p.start ? null : h('button.lenke', { type: 'button', title: 'Flytt til en annen motpart eller fjern fra utlegg', onclick: () => endreTransaksjon(p.t) }, 'endre')))))))));
  }

  // Uten motpart
  const uten = o.grupper.find((g) => !g.id);
  if (uten) {
    fyll(el, h('section.kort',
      h('h2', 'Uten motpart'),
      h('p.dempet', 'Velg hvem som skal betale tilbake, eller fjern transaksjonen fra utlegg.'),
      h('div.tabell-holder', h('table.tabell.kompakt', h('tbody', uten.transaksjoner.map((t) => h('tr',
        h('td', datoNo(t.dato)), h('td', t.tekst), h('td.dempet', t.opprinnelig?.underkategori || idx.hent(t.kategori)?.navn || ''), h('td.tall', kr(t.belop, true)),
        h('td', h('button.lenke', { type: 'button', onclick: () => endreTransaksjon(t) }, 'velg motpart')))))))));
  }

  function lagreMotpart(navn) {
    const liste = motparter(db);
    const finnes = liste.find((m) => m.navn.toLowerCase() === navn.toLowerCase());
    if (finnes) return finnes;
    const m = { id: 'mp-' + uid(), navn, alias: [] };
    liste.push(m);
    return m;
  }

  function endreTransaksjon(t) {
    const navn = o.motparter.map((m) => m.navn);
    const dl = h('datalist#motpart-navn', navn.map((n) => h('option', { value: n })));
    const inp = h('input', { list: 'motpart-navn', value: o.motparter.find((m) => m.id === t.motpart)?.navn || '', placeholder: 'Navn på person eller firma' });
    dialog({
      tittel: `${t.tekst} · ${kr(t.belop, true)} kr`,
      innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() }, dl, felt('Motpart', inp, 'Den som skal betale tilbake (for utlegg) eller som har betalt (for refusjoner)')),
      knapper: [
        { tekst: 'Ikke et utlegg', type: 'fare venstre', onclick: () => { t.ikkeRefunderes = true; delete t.motpart; store.changed(); tegnPaNytt(); } },
        { tekst: 'Avbryt' },
        { tekst: 'Lagre', type: 'primar', onclick: () => {
          const n = inp.value.trim();
          if (!n) { toast('Skriv inn en motpart', 'feil'); return false; }
          t.motpart = lagreMotpart(n).id;
          delete t.ikkeRefunderes;
          store.changed();
          tegnPaNytt({ m: t.motpart });
        } },
      ],
    });
  }

  function innstillinger(g) {
    // Automatisk funnet motpart lagres første gang den endres
    let m = motparter(db).find((x) => x.id === g.id);
    const ny = !m;
    if (!m) m = { id: g.id.startsWith('auto:') ? 'mp-' + uid() : g.id, navn: g.navn, alias: [] };
    const navn = h('input', { value: m.navn });
    const alias = h('input', { value: (m.alias || []).join(', '), placeholder: 'f.eks. firmanavn slik det står i banken' });
    const fra = h('input', { type: 'date', value: m.fra || '' });
    const start = h('input', { inputmode: 'decimal', value: m.startsaldo ? kr(m.startsaldo, true) : '' });
    dialog({
      tittel: `Motpart: ${g.navn}`,
      innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
        felt('Navn', navn),
        felt('Andre navn i bankteksten', alias, 'Kommaseparert. Refusjoner med disse navnene i teksten knyttes til motparten.'),
        felt('Regn utlegg fra', fra, 'Transaksjoner før denne datoen telles ikke'),
        felt('Startsaldo (kr)', start, 'Det motparten skyldte deg på startdatoen. Negativt hvis de hadde betalt på forskudd.')),
      knapper: [{ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: () => {
        const gammeltNavn = g.navn;
        m.navn = navn.value.trim() || gammeltNavn;
        m.alias = [...new Set([...alias.value.split(',').map((x) => x.trim()).filter(Boolean), ...(m.navn !== gammeltNavn ? [gammeltNavn] : [])])];
        m.fra = fra.value || null;
        m.startsaldo = lesBelop(start.value) || 0;
        if (ny) {
          motparter(db).push(m);
          // Knytt transaksjonene som ble funnet automatisk til den lagrede motparten
          for (const t of g.transaksjoner) if (!t.motpart) t.motpart = m.id;
        }
        store.changed();
        tegnPaNytt({ m: m.id });
      } }],
    });
  }
}
