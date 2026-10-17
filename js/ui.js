// Felles UI-komponenter: dialog, varsel, skjemafelt, nøkkeltall-fliser.

import { h, clear } from './util.js';
import { styrke, foreslaPassord } from './model/passordstyrke.js';

export function toast(tekst, type = 'info') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div#toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const el = h('div.toast', { class: `toast-${type}` }, tekst);
  host.append(el);
  setTimeout(() => el.classList.add('vis'), 10);
  setTimeout(() => { el.classList.remove('vis'); setTimeout(() => el.remove(), 300); }, type === 'feil' ? 7000 : 3500);
}

// Åpner en dialog. innhold: Node. knapper: [{tekst, type, onclick -> false for å holde åpen}]
export function dialog({ tittel, innhold, knapper = [], bred = false }) {
  const dlg = h('dialog.dialog', { class: bred ? 'bred' : '' });
  const lukk = () => { dlg.close(); dlg.remove(); };
  const footer = h('div.dialog-knapper');
  for (const k of knapper) {
    footer.append(h('button', {
      type: 'button',
      class: k.type || 'sekundar',
      onclick: async () => {
        const r = k.onclick ? await k.onclick() : undefined;
        if (r !== false) lukk();
      },
    }, k.tekst));
  }
  dlg.append(
    h('div.dialog-topp', h('h2', tittel), h('button.ikon-knapp', { type: 'button', 'aria-label': 'Lukk', onclick: lukk }, '✕')),
    h('div.dialog-innhold', innhold),
    knapper.length ? footer : null
  );
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); lukk(); });
  document.body.append(dlg);
  dlg.showModal();
  return { lukk, el: dlg };
}

export function bekreft(tittel, tekst, jaTekst = 'OK', type = 'fare') {
  return new Promise((resolve) => {
    let svar = false;
    const d = dialog({
      tittel,
      innhold: h('p', tekst),
      knapper: [
        { tekst: 'Avbryt', onclick: () => { svar = false; } },
        { tekst: jaTekst, type, onclick: () => { svar = true; } },
      ],
    });
    d.el.addEventListener('close', () => resolve(svar));
  });
}

let feltTeller = 0;
export function felt(etikett, input, hjelp) {
  const id = input.id || `f${++feltTeller}`;
  input.id = id;
  return h('div.felt', h('label', { for: id }, etikett), input, hjelp ? h('small.hjelp', hjelp) : null);
}

export function velg(alternativer, valgt, attrs = {}) {
  const s = h('select', attrs);
  for (const a of alternativer) {
    if (a.gruppe) {
      const og = h('optgroup', { label: a.gruppe });
      for (const b of a.valg) og.append(h('option', { value: b.verdi, selected: b.verdi === valgt }, b.tekst));
      s.append(og);
    } else {
      s.append(h('option', { value: a.verdi, selected: a.verdi === valgt }, a.tekst));
    }
  }
  return s;
}

export function kategoriValg(kategorier, valgt, attrs = {}) {
  return velg(
    [{ verdi: '', tekst: 'Ukategorisert' }, ...kategorier.map((k) => ({ gruppe: k.navn, valg: k.under.map((u) => ({ verdi: u.id, tekst: u.navn })) }))],
    valgt || '',
    attrs
  );
}

// Nøkkeltall-flis: etikett, verdi, tillegg (endring/forklaring)
export function flis(etikett, verdi, tillegg, tilleggKlasse = '') {
  return h('div.flis', h('div.flis-etikett', etikett), h('div.flis-verdi', verdi), tillegg ? h('div.flis-tillegg', { class: tilleggKlasse }, tillegg) : null);
}

export function tomTilstand(tittel, tekst, ...handlinger) {
  return h('div.tom', h('h3', tittel), h('p', tekst), handlinger.length ? h('div.knapperad', handlinger) : null);
}

export function sideTopp(tittel, undertittel, ...handlinger) {
  return h('div.side-topp', h('div', h('h1', tittel), undertittel ? h('p.undertittel', undertittel) : null), h('div.knapperad', handlinger));
}

export { h, clear };

// Styrkemåler for nytt passord: viser styrke, tid å knekke og tips, og kan foreslå en passordsetning.
// Passordet forlater aldri nettleseren – alt beregnes lokalt.
export function passordMaler(p1, p2, hentEkstraOrd = () => []) {
  const segmenter = [0, 1, 2, 3].map(() => h('span.styrke-segment'));
  const navn = h('strong');
  const tid = h('span.dempet');
  const tips = h('ul.styrke-tips');
  const forslagInfo = h('p.styrke-forslag', { hidden: true });
  const visTekst = () => { for (const p of [p1, p2]) if (p) p.type = vis.checked ? 'text' : 'password'; };
  const vis = h('input', { type: 'checkbox', onchange: () => visTekst() });
  const el = h('div.styrke', { 'aria-live': 'polite' },
    h('div.styrke-maler', segmenter),
    h('div.styrke-tekst', navn, ' ', tid),
    tips,
    forslagInfo,
    h('div.styrke-handlinger',
      h('button.lenke', { type: 'button', onclick: () => {
        const f = foreslaPassord(6);
        p1.value = f.passord;
        if (p2) p2.value = f.passord;
        vis.checked = true;
        visTekst();
        for (const f of el.closest('form')?.querySelectorAll('.feil') || []) f.hidden = true;
        forslagInfo.hidden = false;
        forslagInfo.textContent = 'Seks tilfeldige ord fra en liste på over 1 000 ord. Lagre passordet i en passordbehandler eller skriv det ned og oppbevar det trygt før du fortsetter.';
        oppdater();
      } }, 'Foreslå et sterkt passord'),
      h('label.avkryss', vis, ' Vis passord')));
  const oppdater = () => {
    const pw = p1.value;
    el.classList.toggle('tom', !pw);
    if (!pw) {
      segmenter.forEach((s) => { s.className = 'styrke-segment'; });
      navn.textContent = '';
      tid.textContent = 'Lengde gir mest styrke – f.eks. 5–6 tilfeldige ord.';
      clear(tips);
      return;
    }
    const s = styrke(pw, hentEkstraOrd());
    segmenter.forEach((seg, i) => { seg.className = `styrke-segment${i <= s.nivaa ? ` niva-${s.nivaa}` : ''}`; });
    navn.textContent = `${s.navn}.`;
    navn.className = `niva-tekst-${s.nivaa}`;
    tid.textContent = `En angriper med ett kraftig grafikkort bruker ca. ${s.tidEn} på å gjette det (${s.tidTusen} med 1 000 grafikkort).`;
    clear(tips).append(...s.tips.map((t) => h('li', t)));
  };
  p1.addEventListener('input', () => { forslagInfo.hidden = true; oppdater(); });
  oppdater();
  return el;
}
