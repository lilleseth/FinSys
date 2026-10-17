// Notater og huskeliste.

import { h, clear, datoNo, uid } from '../util.js';
import { felt, dialog, bekreft, sideTopp, tomTilstand } from '../ui.js';
import { store } from '../store.js';

export function render(el) {
  const db = store.db;
  const tegnPaNytt = () => { clear(el); render(el); };
  const husk = db.notater.filter((n) => n.type === 'huskeliste').sort((a, b) => Number(a.ferdig) - Number(b.ferdig) || (a.mnd || '').localeCompare(b.mnd || ''));
  const notater = db.notater.filter((n) => n.type !== 'huskeliste').sort((a, b) => (b.dato || '').localeCompare(a.dato || ''));

  el.append(sideTopp('Notater', 'Forklaringer, avklaringer og ting du må huske.',
    h('button.sekundar', { type: 'button', onclick: () => rediger(null, 'huskeliste') }, '+ Huskepunkt'),
    h('button.primar', { type: 'button', onclick: () => rediger(null, 'notat') }, '+ Notat')));

  el.append(h('section.kort', h('h2', 'Huskeliste'),
    husk.length
      ? h('ul.huskeliste', husk.map((n) => h('li', { class: n.ferdig ? 'ferdig' : '' },
        h('label.avkryss', h('input', { type: 'checkbox', checked: n.ferdig, onchange: (e) => { n.ferdig = e.target.checked; store.changed(); tegnPaNytt(); } }),
          h('span', n.mnd ? h('span.etikett', n.mnd) : null, ' ', n.tekst)),
        h('button.lenke', { type: 'button', onclick: () => rediger(n) }, 'endre'))))
      : h('p.dempet', 'Ingenting på huskelisten.')));

  if (!notater.length) {
    el.append(tomTilstand('Ingen notater', 'Notater fra regnearket havner her når du importerer det.'));
    return;
  }
  for (const n of notater) {
    el.append(h('article.kort.notat',
      h('div.kort-topp', h('h2', n.tittel || 'Notat'), h('button.lenke', { type: 'button', onclick: () => rediger(n) }, 'endre')),
      h('p.dempet', [datoNo(n.dato), n.kilde].filter(Boolean).join(' · ')),
      h('div.notat-tekst', n.tekst)));
  }

  function rediger(notat, type) {
    const ny = !notat;
    const n = notat || { id: 'n-' + uid(), type, dato: new Date().toISOString().slice(0, 10), tittel: '', tekst: '', ferdig: false };
    const tittel = h('input', { value: n.tittel || '' });
    const tekst = h('textarea', { rows: n.type === 'huskeliste' ? 3 : 12 }, n.tekst || '');
    const mnd = h('input', { type: 'month', value: n.mnd || '' });
    const knapper = [];
    if (!ny) knapper.push({ tekst: 'Slett', type: 'fare venstre', onclick: async () => {
      if (!(await bekreft('Slette?', 'Notatet slettes.', 'Slett'))) return false;
      db.notater.splice(db.notater.indexOf(notat), 1);
      store.changed();
      tegnPaNytt();
    } });
    knapper.push({ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: () => {
      if (!tekst.value.trim()) return false;
      Object.assign(n, { tittel: tittel.value.trim(), tekst: tekst.value.trim(), mnd: mnd.value || null });
      if (ny) db.notater.push(n);
      store.changed();
      tegnPaNytt();
    } });
    dialog({
      tittel: ny ? (n.type === 'huskeliste' ? 'Nytt huskepunkt' : 'Nytt notat') : 'Endre',
      innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
        n.type === 'huskeliste' ? felt('Gjelder måned', mnd) : felt('Tittel', tittel),
        felt('Tekst', tekst)),
      knapper,
      bred: n.type !== 'huskeliste',
    });
  }
}
