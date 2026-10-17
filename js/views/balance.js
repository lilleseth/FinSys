// Formue og gjeld: eiendeler, gjeld, verdihistorikk, formuesskatt og månedlige øyeblikksbilder.

import { h, clear, kr, krs, pct, datoNo, uid, lesBelop } from '../util.js';
import { felt, velg, dialog, bekreft, sideTopp, flis, toast } from '../ui.js';
import { store } from '../store.js';
import { vedlegg } from './documents.js';
import { formue, gjeldsdetaljer, formuesskatt, lagSnapshot, avkastning, EIENDEL_TYPER, GJELD_TYPER, HISTORIKK_FELT, INVESTERING, MND_NAVN, sum, r2 } from '../model/calc.js';

export function render(el) {
  const db = store.db;
  const tegnPaNytt = () => { clear(el); render(el); };
  const f = formue(db);
  const skatt = db.innstillinger.skatt || {};
  const gjeld = gjeldsdetaljer(db, f, skatt.rentefradrag ?? 0.22);

  el.append(sideTopp('Formue og gjeld', f.sisteDato ? `Siste registrerte verdi ${datoNo(f.sisteDato)}` : 'Ingen verdier registrert',
    h('button.sekundar', { type: 'button', onclick: () => redigerPost(null, 'eiendel') }, '+ Eiendel'),
    h('button.sekundar', { type: 'button', onclick: () => redigerPost(null, 'gjeld') }, '+ Gjeld'),
    h('button.primar', { type: 'button', onclick: lagreSnapshot }, 'Frys måned')));

  el.append(h('section.fliser.tre',
    flis('Eiendeler', krs(f.sumEiendeler)),
    flis('Gjeld', krs(f.sumGjeld)),
    flis('Nettoformue', krs(f.netto))));

  // Eiendeler gruppert
  const grupper = new Map();
  for (const x of f.eiendeler) {
    const g = x.post.gruppe || 'Annet';
    if (!grupper.has(g)) grupper.set(g, []);
    grupper.get(g).push(x);
  }
  const eTbody = h('tbody');
  for (const [g, liste] of [...grupper.entries()].sort((a, b) => sum(b[1].map((x) => x.verdi || 0)) - sum(a[1].map((x) => x.verdi || 0)))) {
    const kreditt = sum(f.gjeld.filter((x) => x.post.type === 'kreditt' && x.post.gruppe === g).map((x) => x.verdi || 0));
    const gsum = sum(liste.map((x) => x.verdi || 0));
    eTbody.append(h('tr.gruppe', h('th', { scope: 'rowgroup', colspan: 3 }, g, kreditt ? h('small', ` · belåning ${pct(kreditt / gsum)}`) : null), h('td.tall', kr(gsum)), h('td')));
    for (const x of liste) {
      eTbody.append(h('tr.klikkbar', { onclick: () => redigerPost(x.post), tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter') redigerPost(x.post); } },
        h('td', x.post.navn, x.post.notat ? h('small', x.post.notat) : null),
        h('td', EIENDEL_TYPER[x.post.type] || x.post.type),
        h('td', x.dato ? datoNo(x.dato) : 'ingen verdi'),
        h('td.tall', x.verdi != null ? kr(x.verdi) : '–'),
        h('td.dempet', x.kilde)));
    }
  }
  el.append(h('section.kort', h('h2', 'Eiendeler'),
    f.eiendeler.length
      ? h('div.tabell-holder', h('table.tabell', h('thead', h('tr', h('th', 'Post'), h('th', 'Type'), h('th', 'Verdidato'), h('th.tall', 'Verdi (kr)'), h('th', 'Kilde'))), eTbody,
        h('tfoot', h('tr.delsum', h('th', { colspan: 3 }, 'Sum eiendeler'), h('td.tall', kr(f.sumEiendeler)), h('td')))))
      : h('p.dempet', 'Ingen eiendeler registrert.')));

  // Avkastning per investeringskonto
  const avk = avkastning(db);
  if (avk.length) {
    db.formue.innskudd ||= {};
    const rader = avk.map((a) => {
      const inn = h('input.budsjett-input', { inputmode: 'numeric', value: a.innskutt != null ? String(a.innskutt) : '', placeholder: 'innskutt', 'aria-label': `Innskutt i ${a.gruppe}`,
        onchange: (e) => {
          const v = lesBelop(e.target.value);
          if (v == null) delete db.formue.innskudd[a.gruppe];
          else db.formue.innskudd[a.gruppe] = { belop: v, dato: new Date().toISOString().slice(0, 10) };
          store.changed();
          tegnPaNytt();
        } });
      const endring = a.forrige != null ? a.verdi - a.forrige : null;
      return h('tr',
        h('td', a.gruppe, h('small', `${a.poster} post${a.poster === 1 ? '' : 'er'}${a.dato ? ` · ${datoNo(a.dato)}` : ''}`)),
        h('td.tall', kr(a.verdi), endring != null ? h('small', { class: endring >= 0 ? 'pos' : 'neg' }, `${endring >= 0 ? '+' : ''}${kr(endring)} siden ${datoNo(a.forrigeDato)}`) : null),
        h('td.tall', a.kreditt ? kr(-a.kreditt) : '–'),
        h('td.tall', inn, a.innskuddIAar ? h('small', `${kr(a.innskuddIAar)} kr satt inn i år`) : null),
        h('td.tall', a.gevinst != null ? h('span', { class: a.gevinst >= 0 ? 'pos' : 'neg' }, kr(a.gevinst)) : '–'),
        h('td.tall', a.avkastning != null ? h('strong', { class: a.avkastning >= 0 ? 'pos' : 'neg' }, pct(a.avkastning)) : '–'),
        h('td.tall', a.utbytte ? kr(a.utbytte) : '–'));
    });
    const medInn = avk.filter((a) => a.innskutt != null);
    const totVerdi = sum(medInn.map((a) => a.verdi));
    const totInn = sum(medInn.map((a) => a.innskutt));
    el.append(h('section.kort', h('h2', 'Avkastning per konto'),
      h('p.dempet', 'Fyll inn hvor mye du totalt har satt inn på hver konto (f.eks. «tilgjengelig skattefritt uttak» for ASK eller anskaffelsesverdi), så beregnes gevinst og avkastning.'),
      h('div.tabell-holder', h('table.tabell',
        h('thead', h('tr', h('th', 'Konto'), h('th.tall', 'Verdi'), h('th.tall', 'Kreditt'), h('th.tall', 'Innskutt'), h('th.tall', 'Gevinst'), h('th.tall', 'Avkastning'), h('th.tall', 'Utbytte'))),
        h('tbody', rader),
        medInn.length ? h('tfoot', h('tr.delsum', h('th', 'Sum (kontoer med innskudd)'), h('td.tall', kr(totVerdi)), h('td'), h('td.tall', kr(totInn)), h('td.tall', kr(totVerdi - totInn)), h('td.tall', pct(totInn ? (totVerdi - totInn) / totInn : null)), h('td'))) : null))));
  }

  // Gjeld
  const fradragPct = pct(skatt.rentefradrag ?? 0.22);
  el.append(h('section.kort', h('h2', 'Gjeld'), h('p.dempet', `Netto rente etter ${fradragPct} rentefradrag. Sortert etter netto rente – dyreste først.`),
    gjeld.length
      ? h('div.tabell-holder', h('table.tabell',
        h('thead', h('tr', h('th', 'Lån'), h('th', 'Saldodato'), h('th.tall', 'Saldo (kr)'), h('th.tall', 'Nom. rente'), h('th.tall', 'Netto rente'), h('th.tall', 'Netto rentekostnad/år'))),
        h('tbody', [...gjeld].sort((a, b) => (b.nettoRente ?? 0) - (a.nettoRente ?? 0)).map((g) => h('tr.klikkbar', { onclick: () => redigerPost(g.post), tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter') redigerPost(g.post); } },
          h('td', g.post.navn, h('small', GJELD_TYPER[g.post.type] || '')),
          h('td', g.dato ? datoNo(g.dato) : '–'),
          h('td.tall', kr(g.verdi)),
          h('td.tall', pct(g.rente)),
          h('td.tall', pct(g.nettoRente)),
          h('td.tall', kr(g.aarlig))))),
        h('tfoot', h('tr.delsum', h('th', { colspan: 2 }, 'Sum gjeld'), h('td.tall', kr(f.sumGjeld)), h('td'), h('td'), h('td.tall', kr(sum(gjeld.map((g) => g.aarlig || 0))))))))
      : h('p.dempet', 'Ingen gjeld registrert.')));

  // Formuesskatt
  const fs = formuesskatt(db);
  el.append(h('section.kort', h('h2', 'Formuesskatt (anslag)'),
    h('p.dempet', `Bunnfradrag ${kr(fs.bunnfradrag)} kr, sats ${pct(fs.sats)}. Forenklet: full fradrag for gjeld (gjeldsreduksjon for aksjerabatt er ikke tatt med).`),
    h('div.tabell-holder', h('table.tabell',
      h('thead', h('tr', h('th', 'Post'), h('th.tall', 'Verdi'), h('th.tall', 'Rabatt'), h('th.tall', 'Skattemessig verdi'), h('th', 'Merknad'))),
      h('tbody',
        fs.linjer.map((l) => h('tr', h('td', l.navn), h('td.tall', kr(l.grunnlag)), h('td.tall', l.rabatt ? pct(l.rabatt) : '–'), h('td.tall', kr(l.skattemessig)), h('td.dempet', l.merknad))),
        fs.gjeld.map((g) => h('tr', h('td', `− ${g.navn}`), h('td.tall'), h('td.tall'), h('td.tall', kr(-g.verdi)), h('td.dempet', 'Gjeld')))),
      h('tfoot',
        h('tr.delsum', h('th', 'Skattemessig nettoformue'), h('td'), h('td'), h('td.tall', kr(fs.nettoSkattemessig)), h('td')),
        h('tr', h('th', fs.margin >= 0 ? 'Margin til bunnfradrag' : 'Over bunnfradrag'), h('td'), h('td'), h('td.tall', kr(Math.abs(fs.margin))), h('td')),
        h('tr.netto', h('th', 'Beregnet formuesskatt'), h('td'), h('td'), h('td.tall', kr(fs.skatt)), h('td')))))));

  // Utbytte
  const utbytte = [...(db.formue.utbytte || [])].sort((a, b) => b.dato.localeCompare(a.dato));
  el.append(h('section.kort', h('div.kort-topp', h('h2', 'Utbytte'), h('button.sekundar.liten', { type: 'button', onclick: () => nyttUtbytte() }, '+ Registrer')),
    utbytte.length
      ? h('div.tabell-holder', h('table.tabell', h('thead', h('tr', h('th', 'År'), h('th', 'Konto'), h('th', 'Dato'), h('th.tall', 'Beløp'), h('th', 'Kilde'), h('th'))),
        h('tbody', utbytte.map((u) => h('tr', h('td', u.aar), h('td', u.gruppe), h('td', datoNo(u.dato)), h('td.tall', kr(u.belop)), h('td.dempet', u.kilde),
          h('td', h('button.lenke', { type: 'button', onclick: async () => {
            if (await bekreft('Slette utbytte?', `${u.gruppe} ${kr(u.belop)} kr`, 'Slett')) { db.formue.utbytte.splice(db.formue.utbytte.indexOf(u), 1); store.changed(); tegnPaNytt(); }
          } }, 'slett')))))))
      : h('p.dempet', 'Ingen utbytte registrert. Registrer hittil-i-år-tall fra meglerrapporten.')));

  // Formueshistorikk
  const hist = [...(db.formue.historikk || [])].sort((a, b) => b.dato.localeCompare(a.dato));
  const brukte = HISTORIKK_FELT.filter(([k]) => hist.some((x) => x.grupper?.[k]));
  el.append(h('section.kort', h('h2', 'Formueshistorikk'),
    h('p.dempet', 'Frosne verdier ved hver månedsslutt. «Frys måned» lagrer et nytt øyeblikksbilde fra verdiene som er registrert.'),
    hist.length
      ? h('div.tabell-holder.bred-tabell', h('table.tabell',
        h('thead', h('tr', h('th', 'Måned'), ...brukte.map(([, n]) => h('th.tall', n)), h('th.tall', 'Nettoformue'), h('th', 'Merknad'), h('th'))),
        h('tbody', hist.map((x) => h('tr',
          h('td', `${MND_NAVN[Number(x.mnd.slice(5, 7)) - 1]} ${x.mnd.slice(0, 4)}`),
          ...brukte.map(([k]) => h('td.tall', x.grupper?.[k] != null ? kr(x.grupper[k]) : '–')),
          h('td.tall', h('strong', x.nettoformue != null ? kr(x.nettoformue) : '–')),
          h('td.dempet.merknad', x.kilde || ''),
          h('td', h('button.lenke', { type: 'button', onclick: async () => {
            if (await bekreft('Slette øyeblikksbilde?', `Historikken for ${x.mnd} slettes.`, 'Slett')) { db.formue.historikk.splice(db.formue.historikk.indexOf(x), 1); store.changed(); tegnPaNytt(); }
          } }, 'slett')))))))
      : h('p.dempet', 'Ingen historikk ennå.')));

  // --- Dialoger ---

  function redigerPost(post, side) {
    const ny = !post;
    const p = post || { id: 'p-' + uid(), side, navn: '', type: side === 'gjeld' ? 'annet' : 'bank', gruppe: '', verdier: [], notat: '' };
    const typer = p.side === 'gjeld' ? GJELD_TYPER : EIENDEL_TYPER;
    const grupperListe = [...new Set(db.formue.poster.map((x) => x.gruppe).filter(Boolean))];
    const dl = h('datalist#grupper', grupperListe.map((g) => h('option', { value: g })));
    const inp = {
      navn: h('input', { value: p.navn, required: true }),
      type: velg(Object.entries(typer).map(([v, t]) => ({ verdi: v, tekst: t })), p.type),
      gruppe: h('input', { value: p.gruppe || '', list: 'grupper', placeholder: 'f.eks. Pareto ASK, Bank' }),
      rente: h('input', { value: p.rente != null ? String(r2(p.rente * 100)).replace('.', ',') : '', inputmode: 'decimal', placeholder: 'f.eks. 6,10' }),
      fradrag: h('input', { value: p.rentefradrag != null ? String(r2(p.rentefradrag * 100)).replace('.', ',') : '', inputmode: 'decimal', placeholder: `standard ${String(r2((skatt.rentefradrag ?? 0.22) * 100)).replace('.', ',')}` }),
      skatteverdi: h('input', { value: p.skattemessigVerdi ?? '', inputmode: 'decimal' }),
      termin: h('input', { value: p.terminbelop ?? '', inputmode: 'decimal', placeholder: 'automatisk' }),
      notat: h('textarea', { rows: 2 }, p.notat || ''),
    };
    const verdier = [...(p.verdier || [])];
    const vListe = h('div');
    const nyDato = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const nyVerdi = h('input', { inputmode: 'decimal', placeholder: p.side === 'gjeld' ? 'Saldo (positivt tall)' : 'Verdi' });
    const nyKilde = h('input', { placeholder: 'Kilde, f.eks. meglerrapport' });
    const tegnVerdier = () => {
      clear(vListe).append(verdier.length
        ? h('table.tabell.kompakt', h('thead', h('tr', h('th', 'Dato'), h('th.tall', p.side === 'gjeld' ? 'Saldo' : 'Verdi'), h('th', 'Kilde'), h('th'))),
          h('tbody', [...verdier].sort((a, b) => b.dato.localeCompare(a.dato)).map((v) => h('tr', h('td', datoNo(v.dato)), h('td.tall', kr(v.verdi, true)), h('td.dempet', v.kilde || ''),
            h('td', h('button.lenke', { type: 'button', onclick: () => { verdier.splice(verdier.indexOf(v), 1); tegnVerdier(); } }, 'fjern'))))))
        : h('p.dempet', 'Ingen verdier ennå.'));
    };
    tegnVerdier();
    const leggTil = () => {
      const v = lesBelop(nyVerdi.value);
      if (v == null || !nyDato.value) { toast('Fyll inn dato og verdi', 'feil'); return; }
      const i = verdier.findIndex((x) => x.dato === nyDato.value);
      if (i >= 0) verdier.splice(i, 1);
      verdier.push({ dato: nyDato.value, verdi: v, kilde: nyKilde.value.trim() || 'Manuell' });
      nyVerdi.value = '';
      nyKilde.value = '';
      tegnVerdier();
    };
    // Kryptobeholdning: antall × kurs per mynt
    const beholdning = (p.beholdning || []).map((x) => ({ ...x }));
    const kryptoBoks = h('div.hel.krypto');
    const tegnKrypto = () => {
      kryptoBoks.hidden = inp.type.value !== 'krypto';
      if (kryptoBoks.hidden) return;
      const sumKost = h('td.tall');
      const sumVerdi = h('td.tall');
      const gevinst = h('p.dempet');
      const leggInn = h('button.sekundar.liten', { type: 'button', onclick: () => {
        nyDato.value = new Date().toISOString().slice(0, 10);
        nyVerdi.value = kr(totaler().verdi, true);
        nyKilde.value = 'Beholdning × kurs';
        leggTil();
      } }, 'Legg verdien inn i historikken');
      const totaler = () => ({
        verdi: beholdning.reduce((a, x) => a + (x.antall || 0) * (x.kurs || 0), 0),
        kost: beholdning.reduce((a, x) => a + (x.kostpris || 0), 0),
      });
      const oppdater = () => {
        const { verdi, kost } = totaler();
        sumKost.textContent = kr(kost);
        sumVerdi.textContent = kr(verdi);
        leggInn.disabled = !verdi;
        gevinst.textContent = kost ? `Urealisert ${verdi >= kost ? 'gevinst' : 'tap'}: ${kr(verdi - kost)} kr – ${verdi >= kost ? 'skatt' : 'skattefradrag'} ca. ${kr(Math.abs(verdi - kost) * 0.22)} kr ved salg/veksling (22 %). Krypto inngår i formuen med full verdi pr. 1. januar.` : '';
      };
      const rad = (x) => {
        const verdiCelle = h('td.tall', kr((x.antall || 0) * (x.kurs || 0)));
        const c = (felt, attrs) => h('input', { ...attrs, value: x[felt] == null ? '' : attrs.inputmode ? String(x[felt]).replace('.', ',') : x[felt], onchange: (e) => {
          x[felt] = attrs.inputmode ? lesBelop(e.target.value) : e.target.value.trim().toUpperCase();
          if (!attrs.inputmode) e.target.value = x[felt];
          verdiCelle.textContent = kr((x.antall || 0) * (x.kurs || 0));
          oppdater();
        } });
        return h('tr',
          h('td', c('symbol', { placeholder: 'BTC', 'aria-label': 'Mynt' })),
          h('td', c('antall', { inputmode: 'decimal', 'aria-label': 'Antall' })),
          h('td', c('kurs', { inputmode: 'decimal', 'aria-label': 'Kurs i kr' })),
          h('td', c('kostpris', { inputmode: 'decimal', 'aria-label': 'Kostpris i kr' })),
          verdiCelle,
          h('td', h('button.lenke', { type: 'button', onclick: () => { beholdning.splice(beholdning.indexOf(x), 1); tegnKrypto(); } }, 'fjern')));
      };
      clear(kryptoBoks).append(
        h('h3', 'Beholdning'),
        h('p.dempet', 'Antall og kurs i kroner per mynt (f.eks. fra Firi, Coinbase eller Binance). Kostpris = det du har betalt totalt, inkl. gebyrer.'),
        h('div.tabell-holder', h('table.tabell.kompakt.krypto-tabell',
          h('thead', h('tr', h('th', 'Mynt'), h('th', 'Antall'), h('th', 'Kurs (kr)'), h('th', 'Kostpris (kr)'), h('th.tall', 'Verdi'), h('th'))),
          h('tbody', beholdning.map(rad)),
          h('tfoot', h('tr.delsum', h('td', { colspan: 3 }, 'Sum'), sumKost, sumVerdi, h('td'))))),
        h('div.knapperad',
          h('button.sekundar.liten', { type: 'button', onclick: () => { beholdning.push({ symbol: '', antall: null, kurs: null, kostpris: null }); tegnKrypto(); } }, '+ Mynt'),
          leggInn),
        gevinst);
      oppdater();
    };
    inp.type.addEventListener('change', tegnKrypto);
    tegnKrypto();

    const innhold = h('form.skjema.to-kol', { onsubmit: (e) => e.preventDefault() }, dl,
      felt('Navn', inp.navn),
      felt('Type', inp.type),
      felt('Gruppe', inp.gruppe, p.side === 'gjeld' ? 'For verdipapirkreditt: samme gruppe som porteføljen, så belåningsgrad beregnes' : 'Poster i samme gruppe summeres sammen'),
      p.side === 'gjeld' ? felt('Nominell rente (%)', inp.rente) : felt('Skattemessig verdi (kun kjøretøy)', inp.skatteverdi, 'Skatteetatens fastsatte verdi'),
      p.side === 'gjeld' ? felt('Rentefradrag (%)', inp.fradrag) : null,
      p.side === 'gjeld' ? felt('Terminbeløp per måned (kr)', inp.termin, p.type === 'kreditt' ? 'Planlagt fast nedbetaling, hvis noen' : 'Tom = finnes automatisk blant faste trekk') : null,
      h('div.hel', felt('Notat', inp.notat)),
      p.side === 'eiendel' ? kryptoBoks : null,
      h('div.hel', h('h3', 'Verdihistorikk'), vListe,
        h('div.ny-verdi', nyDato, nyVerdi, nyKilde, h('button.sekundar', { type: 'button', onclick: leggTil }, 'Legg til'))),
      !ny ? h('div.hel', vedlegg('post', p.id)) : null);
    const knapper = [];
    if (!ny) knapper.push({ tekst: 'Slett', type: 'fare venstre', onclick: async () => {
      if (!(await bekreft('Slette posten?', `«${p.navn}» og hele verdihistorikken slettes.`, 'Slett'))) return false;
      db.formue.poster.splice(db.formue.poster.indexOf(post), 1);
      store.changed();
      tegnPaNytt();
    } });
    knapper.push({ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: () => {
      if (!inp.navn.value.trim()) { toast('Navn mangler', 'feil'); return false; }
      if (nyVerdi.value.trim()) leggTil();
      const pctVerdi = (s) => { const v = lesBelop(s); return v == null ? null : v / 100; };
      Object.assign(p, {
        navn: inp.navn.value.trim(),
        type: inp.type.value,
        gruppe: inp.gruppe.value.trim(),
        notat: inp.notat.value.trim(),
        verdier: verdier.sort((a, b) => a.dato.localeCompare(b.dato)),
      });
      if (inp.type.value === 'krypto') p.beholdning = beholdning.filter((x) => x.symbol || x.antall); else delete p.beholdning;
      if (p.side === 'gjeld') {
        p.rente = pctVerdi(inp.rente.value);
        p.rentefradrag = pctVerdi(inp.fradrag.value);
        const t = lesBelop(inp.termin.value);
        if (t == null) delete p.terminbelop; else p.terminbelop = t;
      }
      else p.skattemessigVerdi = lesBelop(inp.skatteverdi.value);
      if (ny) db.formue.poster.push(p);
      store.changed();
      toast('Lagret');
      tegnPaNytt();
    } });
    dialog({ tittel: ny ? (side === 'gjeld' ? 'Ny gjeld' : 'Ny eiendel') : p.navn, innhold, knapper, bred: true });
  }

  function nyttUtbytte() {
    const aar = h('input', { value: String(new Date().getFullYear()), inputmode: 'numeric' });
    const investGrupper = [...new Set(db.formue.poster.filter((p) => INVESTERING.has(p.type)).map((p) => p.gruppe))];
    const gruppe = h('input', { list: 'utbytte-grupper', value: investGrupper[0] || '' });
    const dato = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const belop = h('input', { inputmode: 'decimal' });
    const kilde = h('input', { placeholder: 'f.eks. Pareto-rapport' });
    dialog({
      tittel: 'Registrer utbytte',
      innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() }, h('datalist#utbytte-grupper', investGrupper.map((g) => h('option', { value: g }))),
        felt('År', aar), felt('Konto', gruppe), felt('Dato', dato), felt('Beløp hittil i år (kr)', belop, 'Erstatter tidligere tall for samme år og konto'), felt('Kilde', kilde)),
      knapper: [{ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: () => {
        const b = lesBelop(belop.value);
        if (b == null) { toast('Ugyldig beløp', 'feil'); return false; }
        db.formue.utbytte = db.formue.utbytte.filter((u) => !(String(u.aar) === aar.value && u.gruppe === gruppe.value.trim()));
        db.formue.utbytte.push({ id: 'u-' + uid(), aar: aar.value, gruppe: gruppe.value.trim(), dato: dato.value, belop: b, kilde: kilde.value.trim() });
        store.changed();
        tegnPaNytt();
      } }],
    });
  }

  function lagreSnapshot() {
    const na = new Date();
    const forrige = new Date(na.getFullYear(), na.getMonth(), 0);
    const standard = `${forrige.getFullYear()}-${String(forrige.getMonth() + 1).padStart(2, '0')}`;
    const mnd = h('input', { type: 'month', value: standard });
    dialog({
      tittel: 'Frys måned',
      innhold: h('div', h('p', 'Lagrer verdiene som gjaldt ved slutten av måneden i formueshistorikken. Sørg for at alle poster har verdi pr. månedsslutt (fra meglerrapporter, kontoutskrift og låneoversikt).'), felt('Måned', mnd)),
      knapper: [{ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: async () => {
        if (!mnd.value) return false;
        const snap = lagSnapshot(db, mnd.value);
        const finnes = db.formue.historikk.find((x) => x.mnd === mnd.value);
        if (finnes) {
          if (!(await bekreft('Overskrive?', `Det finnes allerede et øyeblikksbilde for ${mnd.value}. Erstatte det?`, 'Erstatt'))) return false;
          db.formue.historikk.splice(db.formue.historikk.indexOf(finnes), 1);
        }
        db.formue.historikk.push(snap);
        store.changed();
        toast(`Nettoformue ${krs(snap.nettoformue)} lagret for ${mnd.value}`);
        tegnPaNytt();
      } }],
    });
  }
}
