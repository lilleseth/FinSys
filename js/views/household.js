// Felles husholdning: oppsett, delte utgifter, partnerens utlegg og oppgjør.

import { h, clear, kr, krs, pct, datoNo, uid, lesBelop, signert } from '../util.js';
import { felt, velg, dialog, bekreft, sideTopp, flis, toast, tomTilstand, kategoriValg } from '../ui.js';
import { store } from '../store.js';
import { husholdning, oppgjorsoversikt, minAndel } from '../model/household.js';
import { mndTekst } from '../model/report.js';
import { kategoriIndeks } from '../model/categories.js';
import { stolpeliste } from '../charts.js';
import { ruter } from '../main.js';

const fyll = (el, ...x) => el.append(...x.flat().filter(Boolean));

export function render(el, params) {
  const db = store.db;
  const hh = husholdning(db);
  const tegnPaNytt = (p = {}) => { clear(el); render(el, { ...params, ...p }); };
  const partner = hh.partner || 'partneren';

  if (!hh.aktiv) {
    fyll(el, sideTopp('Husholdning', 'Felles utgifter og oppgjør'),
      tomTilstand('Felles husholdning er ikke slått på',
        'Merk hvilke utgifter som er felles (f.eks. bolig og dagligvarer), legg inn det den andre har betalt, og se hvem som skylder hvem. Din egen økonomi forblir separat.',
        h('button.primar', { type: 'button', onclick: () => oppsett(true) }, 'Sett opp husholdning')));
    return;
  }

  const o = oppgjorsoversikt(db);
  const rader = o.rader;
  const valgtMnd = params.mnd || rader.at(-1)?.mnd || new Date().toISOString().slice(0, 7);
  const rad = rader.find((r) => r.mnd === valgtMnd);
  const saldoTekst = Math.abs(o.saldo) < 1 ? 'Dere er à jour' : o.saldo > 0 ? `${partner} skylder deg` : `Du skylder ${partner}`;

  fyll(el,
    sideTopp('Husholdning', `Felles med ${partner} · din andel ${pct(o.andel)}${hh.fordeling === 'inntekt' ? ' (etter inntekt)' : ''}`,
      h('button.sekundar', { type: 'button', onclick: () => utleggDialog() }, `+ Utlegg fra ${partner}`),
      h('button.sekundar', { type: 'button', onclick: () => oppgjorDialog() }, '+ Oppgjør'),
      h('button.sekundar', { type: 'button', onclick: () => oppsett(false) }, 'Innstillinger')),
    h('section.fliser',
      flis(saldoTekst, krs(Math.abs(o.saldo)), Math.abs(o.saldo) >= 1 ? 'samlet saldo etter oppgjør' : '', o.saldo >= 0 ? 'pos' : 'neg'),
      flis(`Felles utgifter ${rad ? mndTekst(rad.mnd).toLowerCase() : ''}`, krs(rad?.total || 0), rad ? `du ${kr(rad.du)} · ${partner} ${kr(rad.partner)}` : ''),
      flis('Din andel', krs(rad?.dinAndel || 0), `${pct(o.andel)} av felles utgifter`),
      flis('Snitt per måned', krs(rader.length ? rader.reduce((s, r) => s + r.total, 0) / rader.length : 0), `${rader.length} måneder`)));

  if (!rader.length) {
    fyll(el, h('p.dempet', 'Ingen felles utgifter ennå. Velg felles kategorier eller kontoer under Innstillinger, eller merk enkelttransaksjoner som delt.'));
    return;
  }

  // Månedstabell
  fyll(el, h('section.kort',
    h('h2', 'Oppgjør per måned'),
    h('div.tabell-holder', h('table.tabell.kompakt',
      h('thead', h('tr', h('th', 'Måned'), h('th.tall', 'Felles totalt'), h('th.tall', 'Du betalte'), h('th.tall', `${partner} betalte`), h('th.tall', 'Din andel'), h('th.tall', 'Differanse'), h('th.tall', 'Oppgjort'), h('th.tall', 'Saldo'))),
      h('tbody', [...rader].reverse().map((r) => h('tr', { class: r.mnd === valgtMnd ? 'valgt' : '', onclick: () => tegnPaNytt({ mnd: r.mnd }), style: 'cursor:pointer' },
        h('td', mndTekst(r.mnd)), h('td.tall', kr(r.total)), h('td.tall', kr(r.du)), h('td.tall', kr(r.partner)), h('td.tall', kr(r.dinAndel)),
        h('td.tall', { class: r.diff >= 0 ? 'pos' : 'neg' }, signert(r.diff)), h('td.tall', r.betalt ? signert(r.betalt) : '–'), h('td.tall.sum', signert(r.saldo))))))),
    h('p.dempet', 'Positiv saldo: ' + partner + ' skylder deg. Klikk på en måned for detaljer.')));

  // Detaljer for valgt måned
  const idx = kategoriIndeks(db.kategorier);
  const perKat = o.perKategori(valgtMnd);
  const utlegg = o.utlegg.filter((u) => u.dato.startsWith(valgtMnd));
  const betalinger = o.betalinger.filter((b) => b.dato.startsWith(valgtMnd));
  fyll(el, h('div.rutenett',
    h('section.kort', h('h2', `Felles per kategori – ${mndTekst(valgtMnd).toLowerCase()}`),
      perKat.length ? stolpeliste({ elementer: perKat.map((k) => ({ etikett: k.navn, verdi: k.belop })), format: (v) => kr(v) + ' kr', visAndel: perKat.length > 1 }) : h('p.dempet', 'Ingen.')),
    h('section.kort', h('h2', `Utlegg fra ${partner}`),
      utlegg.length ? h('div.tabell-holder', h('table.tabell.kompakt', h('tbody', utlegg.map((u) => h('tr',
        h('td', datoNo(u.dato)), h('td', u.tekst), h('td.dempet', idx.hent(u.kategori)?.navn || ''), h('td.tall', kr(u.belop)),
        h('td', h('button.lenke', { type: 'button', onclick: () => utleggDialog(u) }, 'endre'))))))) : h('p.dempet', 'Ingen utlegg registrert denne måneden.'),
      h('h3', 'Oppgjør'),
      betalinger.length ? h('ul.koblinger', betalinger.map((b) => h('li', `${datoNo(b.dato)} · ${b.tekst} · ${b.belop > 0 ? 'du betalte' : `${partner} betalte`} ${kr(Math.abs(b.belop))} kr `,
        b.kilde === 'manuell' ? h('button.lenke', { type: 'button', onclick: async () => { if (await bekreft('Slette oppgjøret?', '', 'Slett')) { hh.oppgjor.splice(hh.oppgjor.indexOf(b.ref), 1); store.changed(); tegnPaNytt(); } } }, 'slett') : h('span.dempet', '(transaksjon)')))) : h('p.dempet', 'Ingen oppgjør denne måneden.'))));

  // Dine delte transaksjoner
  const dine = rad?.transaksjoner || [];
  fyll(el, h('section.kort',
    h('h2', `Dine felles utgifter – ${mndTekst(valgtMnd).toLowerCase()}`, h('span.dempet', ' (etter betalingsdato)')),
    h('p.dempet', 'Fjern haken for utgifter som ikke skal deles. Enkelttransaksjoner kan også merkes som delt i transaksjonsdialogen.'),
    dine.length ? h('div.tabell-holder', h('table.tabell.kompakt', h('tbody', dine.sort((a, b) => a.dato.localeCompare(b.dato)).map((t) => h('tr',
      h('td', h('input', { type: 'checkbox', checked: true, 'aria-label': 'Delt', onchange: () => { t.delt = false; store.changed(); tegnPaNytt(); } })),
      h('td', datoNo(t.dato)), h('td', t.tekst), h('td.dempet', idx.hent(t.kategori)?.navn || ''), h('td.tall', kr(-t.belop)))))))
      : h('p.dempet', 'Ingen.')));

  function utleggDialog(u) {
    const ny = !u;
    const x = u || { id: 'u-' + uid(), dato: new Date().toISOString().slice(0, 10), tekst: '', belop: 0, kategori: 'mat/dagligvarer' };
    const dato = h('input', { type: 'date', value: x.dato });
    const tekst = h('input', { value: x.tekst, placeholder: 'f.eks. Rema 1000' });
    const belop = h('input', { inputmode: 'decimal', value: x.belop ? kr(x.belop, true) : '' });
    const kat = kategoriValg(db.kategorier, x.kategori);
    const knapper = [];
    if (!ny) knapper.push({ tekst: 'Slett', type: 'fare venstre', onclick: () => { hh.utlegg.splice(hh.utlegg.indexOf(u), 1); store.changed(); tegnPaNytt(); } });
    knapper.push({ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: () => {
      const b = lesBelop(belop.value);
      if (!b || !dato.value) { toast('Fyll inn dato og beløp', 'feil'); return false; }
      Object.assign(x, { dato: dato.value, tekst: tekst.value.trim() || 'Utlegg', belop: Math.abs(b), kategori: kat.value });
      if (ny) hh.utlegg.push(x);
      store.changed();
      tegnPaNytt({ mnd: x.dato.slice(0, 7) });
    } });
    dialog({ tittel: ny ? `Utlegg fra ${partner}` : 'Endre utlegg', innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
      h('p.dempet', `Felles utgifter som ${partner} har betalt.`),
      felt('Dato', dato), felt('Tekst', tekst), felt('Beløp (kr)', belop), felt('Kategori', kat)), knapper });
  }

  function oppgjorDialog() {
    const dato = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const retning = velg([{ verdi: 'tilPartner', tekst: `Du betalte ${partner}` }, { verdi: 'fraPartner', tekst: `${partner} betalte deg` }], o.saldo > 0 ? 'fraPartner' : 'tilPartner');
    const belop = h('input', { inputmode: 'decimal', value: Math.abs(o.saldo) >= 1 ? kr(Math.abs(o.saldo), true) : '' });
    const tekst = h('input', { value: 'Oppgjør' });
    dialog({ tittel: 'Registrer oppgjør', innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
      h('p.dempet', 'Gikk betalingen via en konto du importerer, kan du heller åpne transaksjonen og krysse av for «oppgjør i husholdningen».'),
      felt('Dato', dato), felt('Retning', retning), felt('Beløp (kr)', belop), felt('Tekst', tekst)),
    knapper: [{ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: () => {
      const b = lesBelop(belop.value);
      if (!b || !dato.value) { toast('Fyll inn dato og beløp', 'feil'); return false; }
      hh.oppgjor.push({ id: 'o-' + uid(), dato: dato.value, belop: Math.abs(b), retning: retning.value, tekst: tekst.value.trim() });
      store.changed();
      tegnPaNytt();
    } }] });
  }

  function oppsett(forste) {
    const navn = h('input', { value: hh.partner || '', placeholder: 'Navn' });
    const fordeling = velg([{ verdi: 'fast', tekst: 'Fast fordeling' }, { verdi: 'inntekt', tekst: 'Etter inntekt' }], hh.fordeling);
    const andel = h('input', { inputmode: 'numeric', value: String(Math.round(hh.minAndel * 100)) });
    const minInntekt = h('input', { inputmode: 'numeric', value: hh.minInntekt ? String(hh.minInntekt) : '', placeholder: 'snitt netto fra lønnsslipper' });
    const partnerInntekt = h('input', { inputmode: 'numeric', value: hh.partnerInntekt ? String(hh.partnerInntekt) : '' });
    const start = h('input', { type: 'month', value: hh.start || new Date().toISOString().slice(0, 7) });
    const kat = db.kategorier.filter((k) => k.type === 'utgift');
    const katBokser = kat.map((k) => {
      const hel = h('input', { type: 'checkbox', checked: hh.delteKategorier.includes(k.id), 'data-id': k.id });
      const under = k.under.map((u) => h('label.avkryss', h('input', { type: 'checkbox', checked: hh.delteKategorier.includes(u.id), 'data-id': u.id }), ' ', u.navn));
      return h('details.delt-kat', h('summary', h('label.avkryss', { onclick: (e) => e.stopPropagation() }, hel, ' ', h('strong', k.navn), ' (hele)')), h('div.delt-under', under));
    });
    const kontoBokser = db.kontoer.filter((k) => k.id !== 'korreksjon').map((k) => h('label.avkryss', h('input', { type: 'checkbox', checked: hh.delteKontoer.includes(k.id), 'data-konto': k.id }), ' ', k.navn));
    const knapper = [];
    if (!forste) knapper.push({ tekst: 'Slå av', type: 'fare venstre', onclick: async () => {
      if (!(await bekreft('Slå av husholdning?', 'Utlegg og oppgjør beholdes og kommer tilbake om du slår det på igjen.', 'Slå av'))) return false;
      hh.aktiv = false; store.changed(); location.hash = '#/oversikt';
    } });
    knapper.push({ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: () => {
      hh.partner = navn.value.trim();
      hh.fordeling = fordeling.value;
      hh.minAndel = Math.min(100, Math.max(0, lesBelop(andel.value) ?? 50)) / 100;
      hh.minInntekt = lesBelop(minInntekt.value) || null;
      hh.partnerInntekt = lesBelop(partnerInntekt.value) || null;
      hh.start = start.value || null;
      hh.delteKategorier = [...dlg.el.querySelectorAll('[data-id]')].filter((x) => x.checked).map((x) => x.dataset.id);
      hh.delteKontoer = [...dlg.el.querySelectorAll('[data-konto]')].filter((x) => x.checked).map((x) => x.dataset.konto);
      hh.aktiv = true;
      store.changed();
      ruter();
    } });
    const dlg = dialog({ tittel: 'Husholdning', bred: true, innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
      h('div.skjema-rutenett', felt('Den du deler med', navn), felt('Gjelder fra', start, 'Utgifter før dette telles ikke')),
      h('div.skjema-rutenett', felt('Fordeling', fordeling), felt('Din andel ved fast fordeling (%)', andel)),
      h('div.skjema-rutenett', felt('Din netto inntekt per måned', minInntekt, `Nå: ${pct(minAndel(db, hh))} – tomt = snitt av siste lønnsslipper`), felt(`Partnerens netto inntekt per måned`, partnerInntekt, 'Brukes ved fordeling etter inntekt')),
      h('h3', 'Felles kategorier'), h('p.dempet', 'Utgifter i disse kategoriene regnes som felles. Kryss av hele hovedkategorien eller åpne den for å velge underkategorier.'),
      h('div.delt-liste', katBokser),
      kontoBokser.length ? [h('h3', 'Felles kontoer/kort'), h('p.dempet', 'Alle utgifter på disse kontoene regnes som felles.'), h('div.delt-liste', kontoBokser)] : null), knapper });
  }
}
