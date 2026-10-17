// Dokumentarkiv: opplasting, søk, forhåndsvisning, metadata og koblinger.

import { h, clear, kr, datoNo, lesBelop } from '../util.js';
import { felt, velg, dialog, bekreft, sideTopp, toast, tomTilstand } from '../ui.js';
import { store } from '../store.js';
import { DOK_KATEGORIER, lastOppDokument, hentDokument, slettDokument, storrelseTekst, MAKS_STORRELSE, garantier } from '../model/documents.js';
import { pdfSider } from '../import/pdf.js';
import { kategoriIndeks } from '../model/categories.js';
import { kanTolkes, hentTallFraDokument } from './extract.js';

const AKSEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.csv,.xlsx,.txt,.docx';

export function render(el, params) {
  const db = store.db;
  const f = { q: params.q || '', kat: params.kat || '', aar: params.aar || '' };
  const tegnPaNytt = () => { clear(el); render(el, f); };

  const velger = h('input', { type: 'file', multiple: true, accept: AKSEPT, hidden: true, onchange: (e) => { lastOpp([...e.target.files]); e.target.value = ''; } });
  const sone = h('div.slippsone.liten-sone', {
    tabindex: 0, role: 'button', 'aria-label': 'Last opp dokumenter',
    onclick: () => velger.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); velger.click(); } },
    ondragover: (e) => { e.preventDefault(); sone.classList.add('over'); },
    ondragleave: () => sone.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); sone.classList.remove('over'); lastOpp([...e.dataTransfer.files]); },
  }, h('strong', 'Slipp dokumenter her, eller klikk for å velge'), h('span', 'PDF, bilder, CSV/Excel · maks 15 MB per fil · lagres kryptert'), velger);

  const aarListe = [...new Set(db.dokumenter.map((d) => (d.dato || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const sok = h('input', { type: 'search', placeholder: 'Søk i tittel, notat og innhold …', value: f.q, 'aria-label': 'Søk' });
  const katValg = velg([{ verdi: '', tekst: 'Alle typer' }, ...Object.entries(DOK_KATEGORIER).map(([v, t]) => ({ verdi: v, tekst: t }))], f.kat, { 'aria-label': 'Type' });
  const aarValg = velg([{ verdi: '', tekst: 'Alle år' }, ...aarListe.map((a) => ({ verdi: a, tekst: a }))], f.aar, { 'aria-label': 'År' });
  const liste = h('div');

  const aktive = garantier(db).filter((g) => g.dager >= 0);
  el.append(
    sideTopp('Dokumenter', 'Kontoutskrifter, fakturaer, lønnsslipper, lånepapirer, skatt og kvitteringer – kryptert i datalageret ditt.'),
    sone,
    aktive.length ? h('details.kort.garantier', { open: aktive.some((g) => g.dager <= 60) },
      h('summary', h('strong', `Garantier og reklamasjon (${aktive.length})`), h('span.dempet', ` · neste utløper ${datoNo(aktive[0].til)}`)),
      h('div.tabell-holder', h('table.tabell.kompakt', h('tbody', aktive.map((g) => h('tr.klikkbar', { onclick: () => visDokument(g.dokument, tegnPaNytt) },
        h('td', g.dokument.tittel), h('td.dempet', g.navn), h('td', datoNo(g.til)), h('td.tall', { class: g.dager <= 60 ? 'neg' : '' }, g.dager < 365 ? `${g.dager} dager` : `${(g.dager / 365).toFixed(1).replace('.', ',')} år`))))))) : '',
    h('div.filtre.tre-filtre', sok, katValg, aarValg),
    liste);

  const les = () => {
    f.q = sok.value.trim(); f.kat = katValg.value; f.aar = aarValg.value;
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    history.replaceState(null, '', `#/dokumenter${p.toString() ? '?' + p : ''}`);
    tegn();
  };
  sok.addEventListener('input', les);
  katValg.addEventListener('change', les);
  aarValg.addEventListener('change', les);

  function tegn() {
    const q = f.q.toLowerCase();
    const treff = db.dokumenter
      .filter((d) => (!f.kat || d.kategori === f.kat) && (!f.aar || (d.dato || '').startsWith(f.aar)))
      .filter((d) => !q || `${d.tittel} ${d.filnavn} ${d.notat} ${d.tekst}`.toLowerCase().includes(q))
      .sort((a, b) => (b.dato || '').localeCompare(a.dato || '') || b.lastetOpp.localeCompare(a.lastetOpp));
    if (!db.dokumenter.length) {
      clear(liste).append(tomTilstand('Ingen dokumenter ennå', 'Last opp lønnsslipper, lånepapirer, skattedokumenter og kvitteringer. Filer du importerer under «Import» kan også arkiveres automatisk.'));
      return;
    }
    clear(liste).append(h('p.dempet', `${treff.length} av ${db.dokumenter.length} dokumenter · ${storrelseTekst(db.dokumenter.reduce((s, d) => s + d.storrelse, 0))} totalt`),
      treff.length ? h('div.tabell-holder', h('table.tabell.dokumenter',
        h('thead', h('tr', h('th', 'Dato'), h('th', 'Dokument'), h('th', 'Type'), h('th', 'Koblet til'), h('th.tall', 'Størrelse'))),
        h('tbody', treff.map((d) => h('tr.klikkbar', { tabindex: 0, onclick: () => visDokument(d, tegnPaNytt), onkeydown: (e) => { if (e.key === 'Enter') visDokument(d, tegnPaNytt); } },
          h('td.dato', datoNo(d.dato)),
          h('td', h('div', ikon(d.mime), ' ', d.tittel), d.tittel !== d.filnavn ? h('small', d.filnavn) : null, q && d.tekst.toLowerCase().includes(q) ? h('small.utdrag', utdrag(d.tekst, q)) : null),
          h('td', DOK_KATEGORIER[d.kategori] || d.kategori),
          h('td.dempet', koblingTekst(d)),
          h('td.tall', storrelseTekst(d.storrelse)))))))
        : h('p.dempet', 'Ingen dokumenter passer søket.'));
  }

  async function lastOpp(filer) {
    for (const fil of filer) {
      if (fil.size > MAKS_STORRELSE * 3) { toast(`«${fil.name}» er for stor`, 'feil'); continue; }
      toast(`Laster opp ${fil.name} …`);
      try {
        await lastOppDokument(fil);
        toast(`${fil.name} lagret`);
      } catch (e) {
        console.error(e);
        toast(`Kunne ikke laste opp ${fil.name}: ${e.message}`, 'feil');
      }
    }
    tegnPaNytt();
  }

  tegn();
}

function ikon(mime) {
  if (mime === 'application/pdf') return '📄';
  if (mime?.startsWith('image/')) return '🖼';
  return '📎';
}

function utdrag(tekst, q) {
  const i = tekst.toLowerCase().indexOf(q);
  const fra = Math.max(0, i - 40);
  return (fra ? '…' : '') + tekst.slice(fra, i + q.length + 60).replace(/\s+/g, ' ') + '…';
}

export function koblingTekst(d) {
  const db = store.db;
  const deler = [];
  const nT = d.koblinger.filter((k) => k.type === 'transaksjon').length + db.transaksjoner.filter((t) => t.dokumentId === d.id).length;
  if (nT) deler.push(`${nT} transaksjon${nT === 1 ? '' : 'er'}`);
  for (const k of d.koblinger.filter((x) => x.type === 'post')) {
    const p = db.formue.poster.find((x) => x.id === k.id);
    if (p) deler.push(p.navn);
  }
  return deler.join(', ') || '–';
}

// Dialog med forhåndsvisning, metadata, koblinger og sletting.
export function visDokument(d, ferdig) {
  const db = store.db;
  const idx = kategoriIndeks(db.kategorier);
  const visning = h('div.dok-visning', h('p.dempet', 'Henter og dekrypterer …'));
  let url = null;
  const tittel = h('input', { value: d.tittel });
  const dato = h('input', { type: 'date', value: d.dato || '' });
  const kat = velg(Object.entries(DOK_KATEGORIER).map(([v, t]) => ({ verdi: v, tekst: t })), d.kategori);
  const notat = h('textarea', { rows: 3 }, d.notat || '');
  const reklamasjon = velg([{ verdi: '', tekst: 'Ingen' }, { verdi: '2', tekst: '2 år (vanlig)' }, { verdi: '5', tekst: '5 år (varer som skal vare lenge, f.eks. hvitevarer, PC, møbler)' }], d.reklamasjon ? String(d.reklamasjon) : '');
  const garantiTil = h('input', { type: 'date', value: d.garantiTil || '' });
  const kjopsbelop = h('input', { inputmode: 'decimal', value: d.belop != null ? kr(d.belop, true) : '', placeholder: 'valgfritt' });
  const garantiBoks = h('div.garanti-felt',
    felt('Reklamasjonsfrist', reklamasjon, 'Regnes fra datoen over'),
    felt('Garanti til (valgfritt)', garantiTil, 'Produsentens eller butikkens garanti'),
    felt('Kjøpesum (kr)', kjopsbelop));
  const tegnGaranti = () => { garantiBoks.hidden = !['kvittering', 'avtale', 'bolig', 'forsikring'].includes(kat.value) && !d.reklamasjon && !d.garantiTil; };
  const koblingListe = h('ul.koblinger');

  const tegnKoblinger = () => {
    const rader = [];
    const kobledeT = db.transaksjoner.filter((t) => d.koblinger.some((k) => k.type === 'transaksjon' && k.id === t.id));
    for (const t of kobledeT) {
      rader.push(h('li', h('a', { href: `#/transaksjoner?q=${encodeURIComponent(t.tekst)}&aar=${(t.betalt || t.dato).slice(0, 4)}` }, `${datoNo(t.dato)} · ${t.tekst} · ${kr(t.belop, true)} kr`), ' ',
        h('span.dempet', idx.hent(t.kategori)?.navn || ''), ' ',
        h('button.lenke', { type: 'button', onclick: () => { d.koblinger = d.koblinger.filter((k) => !(k.type === 'transaksjon' && k.id === t.id)); store.changed(); tegnKoblinger(); } }, 'fjern')));
    }
    const fraImport = db.transaksjoner.filter((t) => t.dokumentId === d.id).length;
    if (fraImport) rader.push(h('li', h('a', { href: `#/transaksjoner?q=${encodeURIComponent(d.filnavn)}` }, `${fraImport} transaksjoner importert fra denne filen`)));
    for (const k of d.koblinger.filter((x) => x.type === 'post')) {
      const p = db.formue.poster.find((x) => x.id === k.id);
      if (!p) continue;
      rader.push(h('li', h('a', { href: '#/formue' }, `${p.side === 'gjeld' ? 'Gjeld' : 'Eiendel'}: ${p.navn}`), ' ',
        h('button.lenke', { type: 'button', onclick: () => { d.koblinger = d.koblinger.filter((x) => x !== k); store.changed(); tegnKoblinger(); } }, 'fjern')));
    }
    clear(koblingListe).append(...(rader.length ? rader : [h('li.dempet', 'Ikke koblet til noe ennå.')]));
  };
  tegnKoblinger();

  // Koble til formuespost
  const postValg = velg([{ verdi: '', tekst: 'Koble til eiendel/gjeld …' }, ...db.formue.poster.map((p) => ({ verdi: p.id, tekst: `${p.side === 'gjeld' ? 'Gjeld' : 'Eiendel'}: ${p.navn}` }))], '', {
    'aria-label': 'Koble til eiendel eller gjeld',
    onchange: (e) => {
      if (!e.target.value) return;
      if (!d.koblinger.some((k) => k.type === 'post' && k.id === e.target.value)) d.koblinger.push({ type: 'post', id: e.target.value });
      e.target.value = '';
      store.changed();
      tegnKoblinger();
    },
  });

  // Finn transaksjon på beløp (f.eks. kvittering)
  const belopSok = h('input', { inputmode: 'decimal', placeholder: 'Beløp, f.eks. 449,50' });
  const forslag = h('ul.koblinger');
  const finn = () => {
    const b = lesBelop(belopSok.value);
    clear(forslag);
    if (b == null) return;
    const ref = d.dato ? Date.parse(d.dato) : Date.now();
    const treff = db.transaksjoner
      .filter((t) => Math.abs(Math.abs(t.belop) - Math.abs(b)) < 0.005)
      .sort((a, c) => Math.abs(Date.parse(a.dato) - ref) - Math.abs(Date.parse(c.dato) - ref))
      .slice(0, 8);
    forslag.append(...(treff.length ? treff.map((t) => h('li', `${datoNo(t.dato)} · ${t.tekst} · ${kr(t.belop, true)} kr `,
      h('button.lenke', { type: 'button', onclick: () => {
        if (!d.koblinger.some((k) => k.type === 'transaksjon' && k.id === t.id)) d.koblinger.push({ type: 'transaksjon', id: t.id });
        store.changed();
        tegnKoblinger();
        clear(forslag);
        belopSok.value = '';
      } }, 'koble'))) : [h('li.dempet', 'Ingen transaksjoner med det beløpet.')]));
  };
  belopSok.addEventListener('input', finn);

  // Hent tall (lønnsslipp, lån, portefølje, skatt)
  const tolkBoks = h('div.tolk');
  const tegnTolk = () => {
    clear(tolkBoks);
    if (!kanTolkes(d, kat.value)) return;
    tolkBoks.append(h('h3', 'Hent tall'),
      h('p.dempet', 'Leter etter kjente nøkkelord (f.eks. bruttolønn, restgjeld, markedsverdi, restskatt). Du kontrollerer tallene før de lagres.'),
      h('button.sekundar', { type: 'button', onclick: () => { d.kategori = kat.value; hentTallFraDokument(d, kat.value); } }, 'Hent tall fra dokumentet'));
  };
  kat.addEventListener('change', tegnTolk);
  tegnTolk();
  kat.addEventListener('change', tegnGaranti);
  tegnGaranti();

  const dlg = dialog({
    tittel: d.tittel,
    bred: true,
    innhold: h('div.dok-dialog',
      visning,
      h('div.dok-meta',
        h('form.skjema', { onsubmit: (e) => e.preventDefault() },
          felt('Tittel', tittel), felt('Dato', dato), felt('Type', kat), garantiBoks, felt('Notat', notat)),
        h('p.dempet', `${d.filnavn} · ${storrelseTekst(d.storrelse)} · lastet opp ${datoNo(d.lastetOpp.slice(0, 10))}`),
        tolkBoks,
        h('h3', 'Koblinger'), koblingListe, postValg,
        h('h3', 'Koble til transaksjon'), belopSok, forslag)),
    knapper: [
      { tekst: 'Slett', type: 'fare venstre', onclick: async () => {
        if (!(await bekreft('Slette dokumentet?', `«${d.tittel}» slettes fra datalageret. Det kan hentes fram igjen fra historikken i GitHub-repoet.`, 'Slett'))) return false;
        try { await slettDokument(d); toast('Dokument slettet'); ferdig?.(); } catch (e) { toast(`Kunne ikke slette: ${e.message}`, 'feil'); return false; }
      } },
      { tekst: 'Last ned', onclick: async () => {
        const blob = await hentDokument(d);
        const a = h('a', { href: URL.createObjectURL(blob), download: d.filnavn });
        document.body.append(a); a.click(); a.remove();
        return false;
      } },
      { tekst: 'Lagre', type: 'primar', onclick: () => {
        Object.assign(d, { tittel: tittel.value.trim() || d.filnavn, dato: dato.value, kategori: kat.value, notat: notat.value.trim() });
        if (reklamasjon.value) d.reklamasjon = Number(reklamasjon.value); else delete d.reklamasjon;
        if (garantiTil.value) d.garantiTil = garantiTil.value; else delete d.garantiTil;
        const kb = lesBelop(kjopsbelop.value);
        if (kb != null) d.belop = Math.abs(kb); else delete d.belop;
        store.changed();
        ferdig?.();
      } },
    ],
  });
  dlg.el.addEventListener('close', () => { if (url) URL.revokeObjectURL(url); });

  (async () => {
    try {
      const blob = await hentDokument(d);
      url = URL.createObjectURL(blob);
      if (d.mime.startsWith('image/')) {
        clear(visning).append(h('img.dok-bilde', { src: url, alt: d.tittel }));
      } else if (d.mime === 'application/pdf') {
        const { lerreter, antall } = await pdfSider(await blob.arrayBuffer(), 3, 640);
        clear(visning).append(...lerreter, antall > 3 ? h('p.dempet', `Viser 3 av ${antall} sider – last ned for å se hele.`) : h('span'));
      } else if (d.tekst) {
        clear(visning).append(h('pre.dok-tekst', d.tekst.slice(0, 4000)));
      } else {
        clear(visning).append(h('p.dempet', 'Ingen forhåndsvisning for denne filtypen. Bruk «Last ned».'));
      }
    } catch (e) {
      console.error(e);
      clear(visning).append(h('p.feil', `Kunne ikke vise dokumentet: ${e.message}`));
    }
  })();
}

// Liten seksjon for dialoger: viser koblede dokumenter og lar deg legge ved nye.
export function vedlegg(type, id, transaksjon) {
  const db = store.db;
  const boks = h('div.vedlegg');
  const tegn = () => {
    const docs = db.dokumenter.filter((d) => d.koblinger.some((k) => k.type === type && k.id === id) || (transaksjon && transaksjon.dokumentId === d.id));
    const velger = h('input', { type: 'file', accept: AKSEPT, hidden: true, onchange: async (e) => {
      const fil = e.target.files[0];
      if (!fil) return;
      toast(`Laster opp ${fil.name} …`);
      try {
        await lastOppDokument(fil, { koblinger: [{ type, id }], kategori: type === 'transaksjon' && fil.type.startsWith('image/') ? 'kvittering' : undefined });
        toast('Dokument lagt ved');
        tegn();
      } catch (err) { toast(err.message, 'feil'); }
    } });
    clear(boks).append(
      h('h3', 'Dokumenter'),
      docs.length ? h('ul.koblinger', docs.map((d) => h('li', h('button.lenke', { type: 'button', onclick: () => visDokument(d, tegn) }, `${ikon(d.mime)} ${d.tittel}`), h('span.dempet', ` · ${datoNo(d.dato)}`)))) : h('p.dempet', 'Ingen dokumenter.'),
      h('button.sekundar.liten', { type: 'button', onclick: () => velger.click() }, '+ Legg ved fil'), velger);
  };
  tegn();
  return boks;
}
