// Oversikt / dashboard.

import { h, kr, krs, pct, datoNo, signert } from '../util.js';
import { flis, sideTopp, tomTilstand, velg } from '../ui.js';
import { store } from '../store.js';
import { nokkeltall, aarMedData, MND_KORT, MND_NAVN, sum, formue as beregnFormue } from '../model/calc.js';
import { kategoriIndeks } from '../model/categories.js';
import { linjegraf, soylegraf, stolpeliste } from '../charts.js';
import { paminnelser } from '../model/reminders.js';
import { ruter } from '../main.js';
import { ukeSammendrag } from '../model/week.js';

export function render(el, params) {
  const db = store.db;
  const aarListe = aarMedData(db);
  if (!db.transaksjoner.length && !db.formue.poster.length) {
    el.append(
      sideTopp('Oversikt'),
      tomTilstand('Velkommen til FinSys', 'Det er ingen data her ennå. Start med å importere regnearket ditt, så flyttes transaksjoner, formue, gjeld og notater over.',
        h('a.knapp.primar', { href: '#/innstillinger?vis=import' }, 'Importer regneark'),
        h('a.knapp.sekundar', { href: '#/transaksjoner?ny=1' }, 'Legg inn manuelt'))
    );
    return;
  }
  const aar = params.aar || aarListe[aarListe.length - 1] || String(new Date().getFullYear());
  const n = nokkeltall(db, aar);
  const idx = kategoriIndeks(db.kategorier);
  const kf = n.kontantstrom;
  const mndAntall = kf.antallMnd;

  const aarValg = velg(aarListe.map((a) => ({ verdi: a, tekst: a })), aar, {
    'aria-label': 'År',
    onchange: (e) => { location.hash = `#/oversikt?aar=${e.target.value}`; },
  });

  el.append(sideTopp('Oversikt', n.formue.sisteDato ? `Formue pr. ${datoNo(n.formue.sisteDato)} · kontantstrøm ${aar} (${mndAntall ? MND_NAVN[0].toLowerCase() + '–' + MND_NAVN[mndAntall - 1].toLowerCase() : 'ingen måneder'})` : '', aarValg, h('a.knapp.sekundar', { href: '#/rapport' }, 'Månedsrapport')));

  // Nøkkeltall
  const endring = n.endringNettoformue;
  el.append(h('section.helt',
    h('div.helt-etikett', 'Nettoformue'),
    h('div.helt-verdi', krs(n.nettoformue)),
    endring != null ? h('div.helt-tillegg', { class: endring >= 0 ? 'opp' : 'ned' }, `${signert(endring)} kr siden ${datoNo(n.forrigeSnapshot.dato)}`) : null
  ));
  el.append(h('section.fliser',
    flis(`Spart ${aar}`, krs(n.spart), n.investert ? `herav ${kr(n.investert)} kr investert` : 'netto kontantstrøm'),
    flis('Sparerate', pct(n.sparerate), 'av netto inntekt'),
    flis('Likvide midler', krs(n.likvide), n.bufferMnd != null ? `${n.bufferMnd.toFixed(1).replace('.', ',')} mnd med nødvendige utgifter` : 'bankinnskudd ekskl. BSU'),
    flis('Total gjeld', krs(n.totalGjeld), n.kreditt ? `herav ${kr(n.kreditt)} kr verdipapirkreditt` : ''),
    flis('Belåningsgrad', pct(n.belaningsgrad), 'kreditt / aksjer og fond'),
    flis('Netto rentekostnad', krs(n.nettoRentekostnad), 'per år etter rentefradrag'),
    flis(`Forbruk ${aar}`, krs(n.forbruk), mndAntall ? `snitt ${kr(n.forbruk / mndAntall)} kr/mnd` : ''),
    flis(`Utbytte ${aar}`, krs(n.utbytte), 'registrert hittil i år')
  ));

  // Påminnelser
  const liste = paminnelser(db, { vault: store.vault });
  if (liste.length) {
    const ikon = { hoy: '▲', middels: '●', info: '○' };
    const skjul = (p) => {
      const til = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      db.innstillinger.skjultePaminnelser = { ...(db.innstillinger.skjultePaminnelser || {}), [p.id]: til };
      store.changed();
      ruter();
    };
    el.append(h('section.kort.varsler',
      h('h2', 'Trenger oppmerksomhet'),
      h('ul', ...liste.map((p) => h(`li.pam.${p.alvor}`,
        h('span.pam-ikon', { 'aria-hidden': 'true' }, ikon[p.alvor]),
        h('a', { href: p.lenke }, p.tekst),
        h('button.lenke.pam-skjul', { type: 'button', title: 'Skjul i 30 dager', onclick: () => skjul(p) }, 'Skjul'))))));
  }

  // Siste uke med data
  const u = ukeSammendrag(db);
  if (u) {
    const avvik = u.snitt != null ? u.forbruk - u.snitt : null;
    const topp = u.kategorier[0];
    el.append(h('section.kort.uke-kort',
      h('div.kort-topp', h('h2', `${u.navn}`, h('span.dempet', ` · ${datoNo(u.start)}–${datoNo(u.slutt)}`)), h('a', { href: `#/rapport?periode=uke&uke=${u.start}` }, 'Se uka')),
      h('ul.uke-punkter',
        h('li', 'Forbruk ', h('strong', `${kr(u.forbruk)} kr`), avvik != null ? h('span', { class: avvik <= 0 ? 'pos' : 'neg' }, ` (${avvik <= 0 ? '−' : '+'}${kr(Math.abs(avvik))} mot snittuke)`) : null),
        topp ? h('li', 'Mest på ', h('strong', topp.navn.toLowerCase()), ` – ${kr(topp.belop)} kr`) : null,
        u.storste[0] ? h('li', 'Største kjøp ', h('strong', u.storste[0].tekst), ` – ${kr(-u.storste[0].belop)} kr`) : null,
        u.kommende.length ? h('li', `Neste uke: ${u.kommende.length} faste ${u.kommende.length === 1 ? 'post' : 'poster'} på til sammen `, h('strong', `${kr(-u.kommende.reduce((s, p) => s + p.belop, 0))} kr`)) : null)));
  }

  const rutenett = h('div.rutenett');
  el.append(rutenett);

  // Nettoformue over tid
  const punkter = (db.formue.historikk || [])
    .filter((x) => x.nettoformue != null)
    .map((x) => ({ dato: x.dato, verdi: x.nettoformue, etikett: `${MND_KORT[Number(x.dato.slice(5, 7)) - 1]} ${x.dato.slice(2, 4)}` }));
  if (n.formue.sisteDato && !punkter.some((p) => p.dato === n.formue.sisteDato)) {
    punkter.push({ dato: n.formue.sisteDato, verdi: n.nettoformue, etikett: 'nå' });
  }
  punkter.sort((a, b) => a.dato.localeCompare(b.dato));
  rutenett.append(h('section.kort',
    h('h2', 'Nettoformue over tid'),
    h('p.dempet', 'Måneder der alle poster er kjent'),
    linjegraf({ punkter, serieNavn: 'Nettoformue', format: krs })));

  // Inntekt og forbruk per måned
  const mnd = Math.max(mndAntall, 1);
  rutenett.append(h('section.kort',
    h('h2', `Inntekter og forbruk ${aar}`),
    h('p.dempet', 'Etter betalingsmåned'),
    soylegraf({
      kategorier: MND_KORT.slice(0, mnd),
      titler: MND_NAVN.slice(0, mnd),
      serier: [
        { navn: 'Inntekter', verdier: kf.tot.inntekt.slice(0, mnd), klasse: 's1' },
        { navn: 'Forbruk', verdier: kf.tot.utgift.slice(0, mnd).map((v) => -v), klasse: 's2' },
      ],
      format: krs,
    })));

  // Forbruk per hovedkategori
  const perHoved = new Map();
  for (const [id, verdier] of kf.perSub) {
    const hk = idx.hovedFor(id);
    if (!hk || hk.type !== 'utgift') continue;
    perHoved.set(hk.id, (perHoved.get(hk.id) || 0) + sum(verdier));
  }
  const forbrukListe = [...perHoved.entries()]
    .map(([id, v]) => ({ id, verdi: -v }))
    .filter((x) => Math.abs(x.verdi) >= 1)
    .sort((a, b) => b.verdi - a.verdi)
    .map((x) => ({ etikett: idx.hoved.get(x.id).navn, verdi: x.verdi, onclick: () => { location.hash = `#/kontantstrom?aar=${aar}&apne=${x.id}`; } }));
  rutenett.append(h('section.kort',
    h('h2', `Forbruk per kategori ${aar}`),
    h('p.dempet', 'Klikk for detaljer'),
    forbrukListe.length ? stolpeliste({ elementer: forbrukListe, format: (v) => kr(v) + ' kr' }) : h('p.dempet', 'Ingen utgifter registrert.')));

  // Formuesfordeling
  const f = beregnFormue(db);
  const perGruppe = new Map();
  for (const x of f.eiendeler) {
    if (!x.verdi) continue;
    perGruppe.set(x.post.gruppe || 'Annet', (perGruppe.get(x.post.gruppe || 'Annet') || 0) + x.verdi);
  }
  const fordeling = [...perGruppe.entries()].sort((a, b) => b[1] - a[1]).map(([g, v]) => ({ etikett: g, verdi: v, onclick: () => { location.hash = '#/formue'; } }));
  rutenett.append(h('section.kort',
    h('h2', 'Eiendeler per gruppe'),
    h('p.dempet', `Brutto ${kr(f.sumEiendeler)} kr`),
    stolpeliste({ elementer: fordeling, format: (v) => kr(v) + ' kr' })));
}
