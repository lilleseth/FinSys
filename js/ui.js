// Felles UI-komponenter: dialog, varsel, skjemafelt, nøkkeltall-fliser.

import { h, clear } from './util.js';

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
