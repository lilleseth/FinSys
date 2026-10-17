// Planlegging: prognose, faste utgifter, gjeldsplan, skatteprognose og sparemål.

import { h, clear, kr, krs, pct, datoNo, uid, lesBelop, signert } from '../util.js';
import { felt, velg, dialog, bekreft, sideTopp, flis, toast, tomTilstand } from '../ui.js';
import { store } from '../store.js';
import { kategoriIndeks } from '../model/categories.js';
import { fastePoster, oppsummerFaste } from '../model/recurring.js';
import { prognose } from '../model/forecast.js';
import { laan, scenarier, nedbetaleEllerInvestere, sluttdato } from '../model/debt.js';
import { skatteprognose } from '../model/tax.js';
import { verdiPa, MND_KORT, formue as beregnFormue } from '../model/calc.js';
import { mndTekst } from '../model/report.js';
import { linjegraf, soylegraf, stolpeliste } from '../charts.js';
import { kjopsevne, standardverdier, REGLER } from '../model/housing.js';
import { bilkostnad } from '../model/car.js';
import { nettoformuePrognose } from '../model/networth.js';

// Legger til elementer og hopper over tomme verdier
const fyll = (el, ...x) => el.append(...x.flat().filter(Boolean));

const FANER = [
  ['prognose', 'Prognose'],
  ['faste', 'Faste utgifter'],
  ['gjeld', 'Gjeldsplan'],
  ['skatt', 'Skatt'],
  ['mal', 'Sparemål'],
  ['bolig', 'Boliglån'],
  ['bil', 'Bilkostnad'],
];

export function render(el, params) {
  const db = store.db;
  const fane = FANER.some(([id]) => id === params.fane) ? params.fane : 'prognose';
  const tegnPaNytt = (p = {}) => { clear(el); render(el, { ...params, ...p }); };
  el.append(sideTopp('Planlegging', 'Se fremover: prognose, faste utgifter, gjeld, skatt, sparemål, boliglån og bil.'),
    h('nav.faner', { 'aria-label': 'Planlegging' }, FANER.map(([id, navn]) => h('a', { href: `#/planlegging?fane=${id}`, class: id === fane ? 'aktiv' : '', 'aria-current': id === fane ? 'page' : null }, navn))));
  if (!db.transaksjoner.length) {
    el.append(tomTilstand('Ingen data ennå', 'Importer transaksjoner først.'));
    return;
  }
  const seksjon = h('div.fane-innhold');
  el.append(seksjon);
  ({ prognose: visPrognose, faste: visFaste, gjeld: visGjeld, skatt: visSkatt, mal: visMal, bolig: visBolig, bil: visBil })[fane](seksjon, params, tegnPaNytt);
}

// ---------- Prognose ----------

function visPrognose(el, params, tegnPaNytt) {
  const db = store.db;
  const maneder = Number(params.mnd || 12);
  const kilde = params.kilde === 'budsjett' ? 'budsjett' : 'snitt';
  const p = prognose(db, { maneder, kilde });
  const harBudsjett = Object.keys(db.budsjett?.poster || {}).length > 0;
  const lenke = (x) => `#/planlegging?${new URLSearchParams({ fane: 'prognose', mnd: maneder, kilde, ...x })}`;
  const snittNetto = p.rader.reduce((s, r) => s + r.netto, 0) / p.rader.length;
  const skatt = skatteprognose(db, Number(p.sisteData.slice(0, 4)));

  fyll(el, 
    h('div.knapperad.fane-valg',
      velg([{ verdi: '6', tekst: '6 måneder' }, { verdi: '12', tekst: '12 måneder' }, { verdi: '24', tekst: '24 måneder' }], String(maneder), { 'aria-label': 'Periode', onchange: (e) => { location.hash = lenke({ mnd: e.target.value }); } }),
      velg([{ verdi: 'snitt', tekst: 'Variable utgifter: snitt siste 6 mnd' }, { verdi: 'budsjett', tekst: 'Variable utgifter: budsjett' }], kilde, { 'aria-label': 'Grunnlag', disabled: !harBudsjett, onchange: (e) => { location.hash = lenke({ kilde: e.target.value }); } })),
    h('section.fliser',
      flis('Likvide midler nå', krs(p.startSaldo), 'bankkontoer ekskl. BSU'),
      flis('Forventet netto per måned', krs(snittNetto), `faste inntekter ${kr(p.inntektPerMnd)} kr`),
      flis('Laveste saldo', krs(p.laveste.saldo), p.laveste.navn),
      flis(`Saldo om ${maneder} mnd`, krs(p.rader[p.rader.length - 1].saldo), p.rader[p.rader.length - 1].navn)),
    p.forsteUnder
      ? h('p.advarsel', `⚠ Saldoen ventes å gå under bufferen på ${kr(p.buffer)} kr i ${p.forsteUnder.navn.toLowerCase()}. Vurder å flytte penger fra sparekonto eller redusere forbruket.`)
      : h('p.kontroll-ok', `✓ Saldoen holder seg over bufferen på ${kr(p.buffer)} kr hele perioden.`),
    skatt.differanse > 2000 && !(db.planlagt || []).some((x) => /restskatt/i.test(x.tekst))
      ? h('p.advarsel', `Skatteprognosen anslår ca. ${kr(skatt.differanse)} kr i restskatt for ${skatt.aar}. Den er ikke med i prognosen. `,
        h('button.lenke', { type: 'button', onclick: () => {
          db.planlagt ||= [];
          db.planlagt.push({ id: 'pl-' + uid(), mnd: `${skatt.aar + 1}-06`, tekst: `Restskatt ${skatt.aar} (anslag)`, belop: -Math.round(skatt.differanse) });
          store.changed();
          tegnPaNytt();
        } }, 'Legg den inn i juni neste år'))
      : null,
    h('div.rutenett',
      h('section.kort', h('h2', 'Forventet saldo'), h('p.dempet', 'Likvide midler måned for måned'),
        linjegraf({ punkter: [{ dato: `${p.sisteData}-28`, verdi: p.startSaldo, etikett: 'nå' }, ...p.rader.map((r) => ({ dato: `${r.mnd}-28`, verdi: r.saldo, etikett: `${MND_KORT[Number(r.mnd.slice(5, 7)) - 1]} ${r.mnd.slice(2, 4)}` }))], serieNavn: 'Saldo', format: krs })),
      h('section.kort', h('h2', 'Netto per måned'), h('p.dempet', 'Inntekter minus faste og variable utgifter'),
        soylegraf({ kategorier: p.rader.map((r) => MND_KORT[Number(r.mnd.slice(5, 7)) - 1]), titler: p.rader.map((r) => r.navn), serier: [{ navn: 'Netto', verdier: p.rader.map((r) => r.netto), klasse: 's1' }], format: krs }))),
    h('section.kort', h('h2', 'Måned for måned'),
      h('div.tabell-holder', h('table.tabell',
        h('thead', h('tr', h('th', 'Måned'), h('th.tall', 'Inntekter'), h('th.tall', 'Faste'), h('th.tall', 'Variable'), h('th.tall', 'Sparing'), h('th.tall', 'Planlagt'), h('th.tall', 'Netto'), h('th.tall', 'Saldo'))),
        h('tbody', p.rader.map((r) => h('tr', { class: r.under ? 'under-buffer' : '' },
          h('td', r.navn), h('td.tall', kr(r.inntekter)), h('td.tall', kr(-r.faste)), h('td.tall', kr(-r.variable)), h('td.tall', r.sparing ? kr(-r.sparing) : '–'),
          h('td.tall', { title: r.planListe.map((x) => `${x.tekst}: ${kr(x.belop)}`).join('\n') }, r.planlagt ? kr(r.planlagt) : '–'),
          h('td.tall', { class: r.netto < 0 ? 'neg' : '' }, kr(r.netto)), h('td.tall', h('strong', kr(r.saldo))))))))),
    h('div.rutenett',
      planlagteKort(p, tegnPaNytt),
      h('section.kort', h('h2', 'Forutsetninger'),
        h('ul.r-liste',
          h('li', `Faste inntekter: ${kr(p.inntektPerMnd)} kr/mnd (lønn og andre faste innbetalinger, siste 3 mnd).`),
          h('li', `Faste utgifter: ${kr(p.fasteUtPerMnd)} kr/mnd fra ${fastePoster(db).filter((x) => !x.stoppet && x.type === 'utgift').length} gjenkjente faste trekk.`),
          h('li', `Variable utgifter: ${kr(p.variabelTotal)} kr/mnd (${kilde === 'budsjett' ? 'budsjett' : `snitt siste ${p.historikkMnd} mnd`}, minus faste trekk).`),
          h('li', 'Ikke med: feriepenger i juni, halv skatt i desember, restskatt og andre engangsposter – legg dem inn som planlagte poster.')),
        h('table.tabell.kompakt', h('tbody', p.variabelPerHoved.map((v) => h('tr', h('td', v.navn), h('td.tall', `${kr(v.belop)} kr/mnd`))))))));
}

function planlagteKort(p, tegnPaNytt) {
  const db = store.db;
  db.planlagt ||= [];
  const mnd = h('input', { type: 'month', value: p.start });
  const tekst = h('input', { placeholder: 'f.eks. Feriepenger, julegaver' });
  const belop = h('input', { inputmode: 'decimal', placeholder: '+ inn / − ut' });
  return h('section.kort', h('h2', 'Planlagte engangsposter'),
    db.planlagt.length
      ? h('table.tabell.kompakt', h('tbody', [...db.planlagt].sort((a, b) => a.mnd.localeCompare(b.mnd)).map((x) => h('tr',
        h('td', mndTekst(x.mnd)), h('td', x.tekst), h('td.tall', { class: x.belop < 0 ? 'neg' : 'pos' }, kr(x.belop)),
        h('td', h('button.lenke', { type: 'button', onclick: () => { db.planlagt.splice(db.planlagt.indexOf(x), 1); store.changed(); tegnPaNytt(); } }, 'fjern'))))))
      : h('p.dempet', 'Ingen planlagte poster.'),
    h('form.ny-plan', { onsubmit: (e) => {
      e.preventDefault();
      const b = lesBelop(belop.value);
      if (!mnd.value || !tekst.value.trim() || b == null) { toast('Fyll inn måned, tekst og beløp', 'feil'); return; }
      db.planlagt.push({ id: 'pl-' + uid(), mnd: mnd.value, tekst: tekst.value.trim(), belop: b });
      store.changed();
      tegnPaNytt();
    } }, mnd, tekst, belop, h('button.sekundar', { type: 'submit' }, 'Legg til')));
}

// ---------- Faste utgifter ----------

function visFaste(el) {
  const db = store.db;
  const idx = kategoriIndeks(db.kategorier);
  const poster = fastePoster(db);
  const o = oppsummerFaste(poster);
  const aktive = poster.filter((p) => !p.stoppet);
  const sisteDato = db.transaksjoner.reduce((m, t) => (t.dato > m ? t.dato : m), '');
  const om30 = new Date(Date.parse(sisteDato) + 31 * 86400000).toISOString().slice(0, 10);
  const kommende = aktive.filter((p) => p.neste > sisteDato && p.neste <= om30).sort((a, b) => a.neste.localeCompare(b.neste));

  fyll(el, 
    h('section.fliser',
      flis('Faste utgifter per måned', krs(o.utgifterPerMnd), `${kr(o.utgifterPerMnd * 12)} kr per år`),
      flis('Faste inntekter per måned', krs(o.inntekterPerMnd)),
      flis('Abonnementer', String(aktive.filter((p) => p.kategori.startsWith('abonnement')).length), `${kr(-aktive.filter((p) => p.kategori.startsWith('abonnement')).reduce((s, p) => s + p.perAar, 0))} kr per år`),
      flis('Andel av inntekten', o.inntekterPerMnd ? pct(o.utgifterPerMnd / o.inntekterPerMnd) : '–', 'faste utgifter / faste inntekter')),
    o.prisendringer.length ? h('section.kort.varsler', h('h2', 'Prisøkninger'), h('ul', o.prisendringer.map((p) => h('li', `${p.navn}: ${kr(-p.endring.fra)} → ${kr(-p.endring.til)} kr fra ${datoNo(p.endring.dato)} (${kr((p.endring.fra - p.endring.til) * 12 / p.intervall)} kr mer per år)`)))) : null,
    o.stoppet.length ? h('section.kort', h('h2', 'Ser ut til å være avsluttet'), h('p.dempet', 'Ikke trukket som forventet. Sjekk om de er sagt opp, eller om trekket har endret navn eller konto.'),
      h('ul.r-liste', o.stoppet.map((p) => h('li', `${p.navn} (${kr(-p.belop)} kr, sist ${datoNo(p.sist)})`)))) : null,
    kommende.length ? h('section.kort', h('h2', `Kommende trekk etter ${datoNo(sisteDato)}`),
      h('table.tabell.kompakt', h('tbody', kommende.map((p) => h('tr', h('td', datoNo(p.neste)), h('td', p.navn), h('td.tall', { class: p.belop < 0 ? 'neg' : 'pos' }, kr(p.belop))))))) : null);

  for (const [type, tittel] of [['utgift', 'Faste utgifter'], ['inntekt', 'Faste inntekter'], ['sparing', 'Fast sparing']]) {
    const liste = aktive.filter((p) => p.type === type).sort((a, b) => Math.abs(b.perAar) - Math.abs(a.perAar));
    if (!liste.length) continue;
    fyll(el, h('section.kort', h('h2', tittel),
      h('div.tabell-holder', h('table.tabell',
        h('thead', h('tr', h('th', 'Navn'), h('th', 'Kategori'), h('th', 'Hyppighet'), h('th.tall', 'Beløp'), h('th.tall', 'Per år'), h('th', 'Sist'), h('th', 'Neste'))),
        h('tbody', liste.map((p) => h('tr',
          h('td', h('a', { href: `#/transaksjoner?q=${encodeURIComponent(p.navn)}` }, p.navn), p.endring ? h('span.etikett', p.type === 'utgift' ? 'prisendring' : 'endret beløp') : null),
          h('td', idx.hent(p.kategori)?.navn || '–'), h('td', p.frekvens),
          h('td.tall', kr(p.belop)), h('td.tall', h('strong', kr(p.perAar))), h('td', datoNo(p.sist)), h('td', datoNo(p.neste)))))))));
  }
  fyll(el, h('p.dempet', 'Faste poster finnes automatisk: samme mottaker og omtrent samme beløp minst tre ganger med fast mellomrom.'));
}

// ---------- Gjeldsplan ----------

function visGjeld(el, params) {
  const db = store.db;
  const ekstra = Number(params.ekstra ?? 1000);
  const avkastning = Math.round(Number(params.avk ?? 7) * 100) / 10000;
  const lan = laan(db);
  if (!lan.length) { fyll(el, tomTilstand('Ingen gjeld', 'Registrer lån under Formue og gjeld.')); return; }
  const lenke = (x) => `#/planlegging?${new URLSearchParams({ fane: 'gjeld', ekstra, avk: Math.round(avkastning * 10000) / 100, ...x })}`;
  const ekstraInp = h('input', { inputmode: 'numeric', value: String(ekstra), 'aria-label': 'Ekstra innbetaling per måned', onchange: (e) => { location.hash = lenke({ ekstra: lesBelop(e.target.value) || 0 }); } });
  const avkInp = h('input', { inputmode: 'decimal', value: String(Math.round(avkastning * 10000) / 100).replace('.', ','), 'aria-label': 'Forventet avkastning', onchange: (e) => { location.hash = lenke({ avk: lesBelop(e.target.value) || 0 }); } });
  const sammenlign = nedbetaleEllerInvestere(lan, { forventetAvkastning: avkastning });
  const dyrest = sammenlign[0];

  fyll(el, 
    h('div.fane-valg.to-felt', felt('Ekstra innbetaling per måned (kr)', ekstraInp), felt('Forventet avkastning på aksjer/fond før skatt (%)', avkInp)),
    h('section.kort', h('h2', 'Hvor gir en ekstra krone mest?'),
      h('p', `Å betale ned lån gir en sikker «avkastning» lik netto renten. Forventet avkastning på investeringer etter skatt er ca. ${pct(dyrest.etterSkatt)} (${pct(avkastning)} før skatt på 37,84 %).`),
      h('div.tabell-holder', h('table.tabell', h('thead', h('tr', h('th', 'Lån'), h('th.tall', 'Netto rente'), h('th.tall', 'Mot investering'), h('th', 'Anbefaling'))),
        h('tbody', sammenlign.map((x) => h('tr', h('td', x.navn), h('td.tall', pct(x.nettoRente)), h('td.tall', { class: x.fordel >= 0 ? 'pos' : 'neg' }, `${x.fordel >= 0 ? '+' : ''}${(x.fordel * 100).toFixed(2).replace('.', ',')} pp`),
          h('td', x.anbefaling === 'nedbetal' ? '✓ Betal ned først' : 'Investering lønner seg trolig mer')))))),
      h('p.dempet', 'Forenklet: tar ikke hensyn til risiko, skjermingsfradrag, utsatt skatt i ASK eller behov for buffer. Dyreste lån først gir lavest totale renter.')));

  for (const l of lan) {
    const sc = scenarier(l, ekstra);
    const b = sc.base;
    const renterPerMnd = (l.saldo * l.rente) / 12;
    fyll(el, h('section.kort.lan-kort',
      h('div.kort-topp', h('h2', l.navn), h('span.dempet', `saldo pr. ${datoNo(l.dato)}`)),
      h('div.fliser',
        flis('Saldo', krs(l.saldo)),
        flis('Rente', pct(l.rente), `netto ${pct(l.nettoRente)} etter fradrag`),
        flis('Terminbeløp', l.termin ? `${kr(l.termin)} kr` : '–', l.terminKilde),
        flis('Gjeldfri', b.evig ? 'aldri' : mndTekst(sluttdato(b.maneder)), b.evig ? `renter ${kr(renterPerMnd)} kr/mnd legges til lånet` : `${b.maneder} mnd · renter totalt ${kr(b.totalRente)} kr`)),
      h('div.tabell-holder', h('table.tabell.kompakt.scenarier', h('tbody',
        h('tr', h('td', 'Renten øker 1 prosentpoeng'), h('td', `+${kr(sc.pluss1.merkostnadPerMnd)} kr/mnd i renter`), h('td', sc.pluss1.evig ? 'betales aldri ned med dagens termin' : `gjeldfri ${mndTekst(sluttdato(sc.pluss1.maneder))}`)),
        h('tr', h('td', 'Renten øker 2 prosentpoeng'), h('td', `+${kr(sc.pluss2.merkostnadPerMnd)} kr/mnd i renter`), h('td', sc.pluss2.evig ? 'betales aldri ned med dagens termin' : `gjeldfri ${mndTekst(sluttdato(sc.pluss2.maneder))}`)),
        sc.medEkstra ? h('tr', h('td', `${kr(ekstra)} kr ekstra per måned`),
          h('td', sc.medEkstra.evig ? 'dekker ikke rentene' : `gjeldfri ${mndTekst(sluttdato(sc.medEkstra.maneder))}`),
          h('td', b.evig ? (sc.medEkstra.evig ? '' : `nedbetalt på ${sc.medEkstra.maneder} mnd`) : `${sc.medEkstra.sparteMnd} mnd tidligere · ${kr(sc.medEkstra.sparteRenter)} kr spart i renter`)) : null))),
      !l.termin ? h('p.dempet', 'Ingen fast nedbetaling registrert. Sett «Terminbeløp» på lånet under Formue og gjeld hvis du betaler ned fast hver måned.') : null));
  }
}

// ---------- Skatt ----------

function visSkatt(el, params, tegnPaNytt) {
  const db = store.db;
  const aarListe = [...new Set([...(db.inntekt.lonnsslipper || []).map((l) => l.mnd.slice(0, 4)), ...Object.keys(db.skatt || {}), String(new Date().getFullYear()), ...(params.aar ? [String(params.aar)] : [])])].sort();
  const aar = Number(params.aar || aarListe[aarListe.length - 1]);
  const t = skatteprognose(db, aar);
  const rest = t.differanse;
  db.skatt ||= {};
  const egne = db.skatt[aar] || {};
  const inp = (navn, nokkel, hjelp, verdi) => felt(navn, h('input', { inputmode: 'decimal', value: egne[nokkel] != null ? String(egne[nokkel]) : '', placeholder: verdi != null ? kr(verdi) : '0', 'data-nokkel': nokkel }), hjelp);

  const rad = (navn, verdi, klasse) => h('tr', { class: klasse || '' }, h('td', navn), h('td.tall', kr(verdi)));
  fyll(el, 
    h('div.fane-valg', velg(aarListe.map((a) => ({ verdi: a, tekst: `Inntektsåret ${a}` })), String(aar), { 'aria-label': 'År', onchange: (e) => { location.hash = `#/planlegging?fane=skatt&aar=${e.target.value}`; } })),
    h('section.fliser',
      flis('Beregnet skatt', krs(t.sumSkatt), `effektivt ${pct(t.effektivSats)}`),
      flis('Trukket (anslag for året)', krs(t.trukket), `${kr(t.trekkHittil)} kr trukket hittil`),
      flis(rest >= 0 ? 'Forventet restskatt' : 'Forventet til gode', krs(Math.abs(rest)), rest >= 0 ? 'betales etter skatteoppgjøret' : 'utbetales etter skatteoppgjøret', rest >= 0 ? 'neg' : 'pos'),
      flis('Lønnsslipper', `${t.slipper} av 12`, t.gjenstaende ? `${t.gjenstaende} mnd anslått med ${kr(t.snittBrutto)} kr brutto` : 'hele året registrert')),
    rest > 1000 ? h('section.kort.varsler', h('h2', 'Råd'),
      h('ul',
        h('li', `Betal inn ca. ${kr(rest)} kr som tilleggsforskudd innen 31. mai ${aar + 1}, så slipper du rentetillegg på restskatten.`),
        t.ekstraTrekkProsent && t.gjenstaende >= 2 ? h('li', `Alternativt: endre skattekortet nå og øk prosenttrekket med ca. ${Math.ceil(t.ekstraTrekkProsent * 100)} prosentpoeng resten av året.`) : null,
        h('li', `For neste år: med dagens inntekt bør trekket være ca. ${pct(t.sumSkatt / Math.max(1, t.personinntekt))} av bruttolønn.`)))
      : rest < -1000 ? h('p.kontroll-ok', `✓ Det ser ut til at du har trukket nok – ca. ${kr(-rest)} kr til gode.`) : h('p.kontroll-ok', '✓ Trekket ser ut til å stemme med skatten.'),
    egne.oppgjor ? h('section.kort', h('h2', `Skatteoppgjøret for ${aar}`),
      h('table.tabell.kompakt', h('thead', h('tr', h('th', ''), h('th.tall', 'Oppgjøret'), h('th.tall', 'FinSys-anslag'))), h('tbody',
        h('tr', h('td', 'Beregnet skatt'), h('td.tall', egne.oppgjor.beregnet != null ? kr(egne.oppgjor.beregnet) : '–'), h('td.tall', t.slipper ? kr(t.sumSkatt) : '–')),
        h('tr', h('td', 'Trukket / innbetalt'), h('td.tall', egne.oppgjor.trukket != null ? kr(egne.oppgjor.trukket) : '–'), h('td.tall', t.slipper ? kr(t.trukket) : '–')),
        h('tr.delsum', h('td', egne.oppgjor.restskatt ? 'Restskatt' : 'Til gode'), h('td.tall', kr(egne.oppgjor.restskatt || egne.oppgjor.tilgode || 0)), h('td.tall', t.slipper ? kr(Math.abs(rest)) : '–')))),
      h('p.dempet', 'Hentet fra skatteoppgjøret i dokumentarkivet. Store avvik kan bety at lønnsslipper, fradrag eller satser mangler.')) : null,
    h('div.rutenett',
      h('section.kort', h('h2', 'Beregning'),
        h('table.tabell.kompakt', h('tbody',
          rad('Lønn (brutto, registrert + anslag)', t.bruttoAar),
          t.andreInntekter ? rad('Andre personinntekter', t.andreInntekter) : null,
          rad('= Personinntekt', t.personinntekt, 'delsum'),
          rad('− Minstefradrag', -t.minstefradrag),
          rad('− Renteutgifter', -t.renteutgifter),
          t.fagforening ? rad('− Fagforeningskontingent', -t.fagforening) : null,
          t.andreFradrag ? rad('− Andre fradrag', -t.andreFradrag) : null,
          t.renteinntekter ? rad('+ Renteinntekter', t.renteinntekter) : null,
          t.aksjeinntekt ? rad(`+ Aksjeinntekt × ${String(t.satser.oppjustering).replace('.', ',')}`, t.aksjeinntekt * t.satser.oppjustering) : null,
          rad('= Alminnelig inntekt', t.alminneligInntekt, 'delsum'),
          rad(`Skatt på alminnelig inntekt (22 % etter personfradrag ${kr(t.satser.personfradrag)})`, t.skattAlminnelig),
          rad(`Trinnskatt`, t.trinn),
          rad(`Trygdeavgift (${pct(t.satser.trygdeavgift.sats)})`, t.trygd),
          rad('Formuesskatt', t.formuesskatt),
          t.bsuFradrag ? rad('− BSU-fradrag', -t.bsuFradrag) : null,
          rad('= Beregnet skatt', t.sumSkatt, 'netto'),
          rad('Forskuddstrekk lønn (registrert + anslag)', t.trekkLonnAar),
          t.andreTrekk ? rad('Annet trekk', t.andreTrekk) : null,
          rad(rest >= 0 ? 'Restskatt' : 'Til gode', Math.abs(rest), 'delsum'))),
        h('p.dempet', `Satser: ${t.satser.kilde}. Renteutgifter er anslått som saldo × rente for lånene. Anslaget for resten av året bruker snittet av de tre siste lønnsslippene og halv skatt i desember.`)),
      h('section.kort', h('h2', 'Egne justeringer'),
        h('p.dempet', 'Fyll inn det som ikke finnes i FinSys. Tomme felt bruker beregnede verdier.'),
        h('form.skjema', { onsubmit: (e) => e.preventDefault(), onchange: (e) => {
          const nokkel = e.target.dataset.nokkel;
          if (!nokkel) return;
          const v = lesBelop(e.target.value);
          db.skatt[aar] ||= {};
          if (v == null) delete db.skatt[aar][nokkel]; else db.skatt[aar][nokkel] = v;
          store.changed();
          tegnPaNytt();
        } },
        inp('Andre lønnsinntekter/honorar (brutto)', 'andreInntekter', 'F.eks. lønn fra en annen arbeidsgiver'),
        inp('Skatt trukket på disse', 'andreTrekk'),
        inp('Renteutgifter (overstyr)', 'renteutgifter', 'Se årsoppgaver fra långiverne', t.renteutgifter),
        inp('Fagforeningskontingent', 'fagforening', `Maks ${kr(t.satser.fagforeningMaks)} kr`, t.fagforening),
        inp('BSU-sparing i år', 'bsu', 'Gir 10 % skattefradrag (til og med året du fyller 33)'),
        inp('Renteinntekter', 'renteinntekter'),
        inp('Utbytte/gevinst utenfor ASK', 'aksjeinntekt', 'Etter skjermingsfradrag'),
        inp('Andre fradrag', 'andreFradrag', 'F.eks. reisefradrag, gaver til organisasjoner'),
        inp('Snitt bruttolønn resten av året (overstyr)', 'snittBrutto', null, t.snittBrutto)))));
}

// ---------- Sparemål ----------

function verdiForMal(db, m) {
  if (m.kobling?.type === 'post') {
    const ids = m.kobling.ider || [];
    return ids.reduce((s, id) => s + (verdiPa(db.formue.poster.find((p) => p.id === id) || { verdier: [] })?.verdi || 0), 0);
  }
  if (m.kobling?.type === 'nettoformue') return beregnFormue(db).netto;
  if (m.kobling?.type === 'gruppe') {
    return db.formue.poster.filter((p) => p.side === 'eiendel' && p.gruppe === m.kobling.gruppe).reduce((s, p) => s + (verdiPa(p)?.verdi || 0), 0);
  }
  return m.manuellVerdi || 0;
}

function visMal(el, params, tegnPaNytt) {
  const db = store.db;
  db.mal ||= [];
  const na = new Date();
  const naMnd = `${na.getFullYear()}-${String(na.getMonth() + 1).padStart(2, '0')}`;
  fyll(el, h('div.knapperad.fane-valg', h('button.primar', { type: 'button', onclick: () => rediger(null) }, '+ Nytt sparemål')));

  // Nettoformue og milepæler
  const avk = params.avk != null ? Number(params.avk) / 100 : (db.innstillinger.forventetAvkastning ?? 0.06);
  const nf = nettoformuePrognose(db, { avkastning: avk });
  const nfMal = db.mal.filter((m) => m.kobling?.type === 'nettoformue').map((m) => m.belop);
  const maal = [...new Set([...nf.milepaler, ...nfMal])].sort((a, b) => a - b);
  const naar = (r) => (r ? `${mndTekst(r.mnd).toLowerCase()} (${r.maneder < 12 ? `${r.maneder} mnd` : `${(r.maneder / 12).toFixed(1).replace('.', ',')} år`})` : 'ikke innen 50 år');
  const avkInp = h('input', { inputmode: 'decimal', value: String(Math.round(avk * 1000) / 10).replace('.', ','), 'aria-label': 'Forventet årlig avkastning', style: 'max-width:6rem', onchange: (e) => {
    const x = lesBelop(e.target.value);
    if (x == null) return;
    db.innstillinger.forventetAvkastning = x / 100;
    store.changed();
    tegnPaNytt({ avk: undefined });
  } });
  fyll(el, h('section.kort',
    h('h2', 'Nettoformue – milepæler'),
    h('div.fliser',
      flis('Nettoformue nå', krs(nf.na), datoNo(beregnFormue(db).sisteDato || '')),
      flis('Trend', nf.trend != null ? `${signert(Math.round(nf.trend))} kr/mnd` : '–', 'endring siste 12 mnd (frosne måneder)'),
      flis('Sparing', `${kr(nf.sparing)} kr/mnd`, 'snitt netto kontantstrøm siste 12 mnd'),
      flis('Investert', krs(nf.investert), 'aksjer, fond og pensjon')),
    h('div.tabell-holder', h('table.tabell.kompakt',
      h('thead', h('tr', h('th', 'Milepæl'), h('th', 'Med dagens trend'), h('th', 'Med sparing + avkastning'))),
      h('tbody', maal.map((b) => h('tr', { class: nfMal.includes(b) ? 'delsum' : '' }, h('td', `${kr(b)} kr${nfMal.includes(b) ? ' (ditt mål)' : ''}`), h('td', naar(nf.simuler(b, 'trend'))), h('td', naar(nf.simuler(b, 'sparing')))))))),
    h('p.dempet', 'Forventet årlig avkastning på investeringene: ', avkInp, ' %. Trenden bygger på frosne måneder i formueshistorikken, så den tar med kursendringer. Lag et sparemål koblet til «Nettoformue» for å legge inn ditt eget mål.')));

  if (!db.mal.length) {
    fyll(el, tomTilstand('Ingen sparemål ennå', 'Lag et mål – f.eks. buffer på tre månedslønner, egenkapital til bolig eller ny bil – og koble det til en konto eller eiendel.'));
    return;
  }
  for (const m of db.mal) {
    const verdi = verdiForMal(db, m);
    const andel = m.belop > 0 ? verdi / m.belop : 0;
    const mndIgjen = m.frist ? Math.max(0, (Number(m.frist.slice(0, 4)) * 12 + Number(m.frist.slice(5, 7))) - (na.getFullYear() * 12 + na.getMonth() + 1)) : null;
    const behov = mndIgjen ? Math.max(0, (m.belop - verdi) / mndIgjen) : null;
    const mndSiden = Math.max(1, (na.getFullYear() * 12 + na.getMonth()) - (Number(m.start.slice(0, 4)) * 12 + Number(m.start.slice(5, 7)) - 1));
    const tempo = (verdi - (m.startverdi || 0)) / mndSiden;
    const status = andel >= 1 ? ['ok', '✓ Nådd'] : behov == null ? ['ok', 'Uten frist'] : tempo >= behov ? ['ok', '✓ På sporet'] : ['naer', '● Ligger etter'];
    fyll(el, h('section.kort.mal-kort',
      h('div.kort-topp', h('h2', m.navn), h('button.lenke', { type: 'button', onclick: () => rediger(m) }, 'endre')),
      h('div.maler.stor', { class: status[0] }, h('div.maler-spor', h('div.maler-fyll', { style: `width:${Math.min(andel, 1) * 100}%` })), h('span', `${Math.round(andel * 100)} %`)),
      h('div.fliser',
        flis('Nå', krs(verdi), m.kobling?.type === 'manuell' ? 'registrert manuelt' : m.kobling?.type === 'nettoformue' ? 'nettoformue' : 'fra koblet eiendel'),
        flis('Mål', krs(m.belop), m.frist ? `innen ${mndTekst(m.frist).toLowerCase()}` : 'uten frist'),
        flis('Igjen', krs(Math.max(0, m.belop - verdi)), behov != null ? `${kr(behov)} kr/mnd i ${mndIgjen} mnd` : ''),
        flis('Status', status[1], `snitt ${kr(tempo)} kr/mnd siden ${mndTekst(m.start).toLowerCase()}`))));
  }

  function rediger(mal) {
    const ny = !mal;
    const m = mal || { id: 'm-' + uid(), navn: '', belop: 0, frist: '', start: naMnd, kobling: { type: 'manuell' }, manuellVerdi: 0 };
    const navn = h('input', { value: m.navn });
    const belop = h('input', { inputmode: 'numeric', value: m.belop ? String(m.belop) : '' });
    const frist = h('input', { type: 'month', value: m.frist || '' });
    const grupper = [...new Set(db.formue.poster.filter((p) => p.side === 'eiendel').map((p) => p.gruppe).filter(Boolean))];
    const kobling = velg([
      { verdi: 'manuell', tekst: 'Manuell verdi' },
      { verdi: 'nettoformue', tekst: 'Nettoformue (alt du eier minus gjeld)' },
      { gruppe: 'Gruppe', valg: grupper.map((g) => ({ verdi: 'g:' + g, tekst: g })) },
      { gruppe: 'Eiendel', valg: db.formue.poster.filter((p) => p.side === 'eiendel').map((p) => ({ verdi: 'p:' + p.id, tekst: p.navn })) },
    ], m.kobling?.type === 'gruppe' ? 'g:' + m.kobling.gruppe : m.kobling?.type === 'post' ? 'p:' + m.kobling.ider[0] : m.kobling?.type === 'nettoformue' ? 'nettoformue' : 'manuell');
    const manuell = h('input', { inputmode: 'numeric', value: String(m.manuellVerdi || 0) });
    const knapper = [];
    if (!ny) knapper.push({ tekst: 'Slett', type: 'fare venstre', onclick: async () => {
      if (!(await bekreft('Slette sparemålet?', m.navn, 'Slett'))) return false;
      db.mal.splice(db.mal.indexOf(mal), 1); store.changed(); tegnPaNytt();
    } });
    knapper.push({ tekst: 'Avbryt' }, { tekst: 'Lagre', type: 'primar', onclick: () => {
      const b = lesBelop(belop.value);
      if (!navn.value.trim() || !b) { toast('Fyll inn navn og målbeløp', 'feil'); return false; }
      const k = kobling.value;
      m.navn = navn.value.trim();
      m.belop = b;
      m.frist = frist.value || '';
      m.kobling = k === 'manuell' ? { type: 'manuell' } : k === 'nettoformue' ? { type: 'nettoformue' } : k.startsWith('g:') ? { type: 'gruppe', gruppe: k.slice(2) } : { type: 'post', ider: [k.slice(2)] };
      m.manuellVerdi = lesBelop(manuell.value) || 0;
      if (ny) { m.startverdi = verdiForMal(db, m); db.mal.push(m); }
      store.changed();
      tegnPaNytt();
    } });
    dialog({ tittel: ny ? 'Nytt sparemål' : m.navn, innhold: h('form.skjema', { onsubmit: (e) => e.preventDefault() },
      felt('Navn', navn), felt('Målbeløp (kr)', belop), felt('Frist (valgfritt)', frist),
      felt('Hva teller mot målet?', kobling, 'Koble til en konto/eiendel så oppdateres fremdriften automatisk'),
      felt('Manuell verdi (kr)', manuell, 'Brukes bare ved «Manuell verdi»')), knapper });
  }
}


// ---------- Boliglån og kjøpsevne ----------

function visBolig(el) {
  const db = store.db;
  const std = standardverdier(db);
  const lagret = db.boligkalk || {};
  const v = { ...std, medInvestert: false, ekstraEk: 0, ...lagret };
  const tall = (nokkel, etikett, hjelp, { prosent = false } = {}) => {
    const inp = h('input', { inputmode: 'decimal', value: prosent ? String(Math.round(v[nokkel] * 10000) / 100).replace('.', ',') : kr(v[nokkel]), 'data-nokkel': nokkel });
    inp.addEventListener('change', () => {
      const x = lesBelop(inp.value);
      if (x == null) return;
      v[nokkel] = prosent ? x / 100 : x;
      lagre();
    });
    return felt(etikett, inp, hjelp);
  };
  const resultat = h('div.bolig-resultat');
  const lagre = () => {
    db.boligkalk = Object.fromEntries(Object.entries(v).filter(([k, x]) => lagret[k] !== undefined || x !== std[k]));
    store.changed();
    tegn();
  };
  const typeValg = velg([{ verdi: 'selveier', tekst: 'Selveier (2,5 % dokumentavgift)' }, { verdi: 'borettslag', tekst: 'Borettslag/aksjeleilighet' }], v.boligtype, { onchange: (e) => { v.boligtype = e.target.value; lagre(); } });
  const medInv = h('input', { type: 'checkbox', checked: v.medInvestert, onchange: (e) => { v.medInvestert = e.target.checked; lagre(); } });

  fyll(el, h('div.rutenett.bolig',
    h('section.kort',
      h('h2', 'Forutsetninger'),
      h('p.dempet', 'Forhåndsutfylt fra dataene dine. Endringer lagres.'),
      h('form.skjema', { onsubmit: (e) => e.preventDefault() },
        h('div.skjema-rutenett',
          tall('pris', 'Boligpris (kr)'),
          felt('Boligtype', typeValg),
          tall('inntekt', 'Din brutto årsinntekt', 'Fra skatteprognosen'),
          tall('nettoMnd', 'Din netto lønn per måned', 'Snitt siste lønnsslipper'),
          tall('medInntekt', 'Medlåntakers brutto årsinntekt'),
          tall('medNettoMnd', 'Medlåntakers netto per måned'),
          tall('egenkapitalBank', 'Egenkapital: bank og BSU'),
          tall('ekstraEk', 'Annen egenkapital', 'F.eks. gave/arv eller medlåntakers sparing'),
          tall('gjeld', 'Eksisterende gjeld', 'Studielån, billån, kreditt …'),
          tall('gjeldBetaling', 'Betaling på eksisterende gjeld per måned'),
          tall('livsopphold', 'Livsopphold per måned', `Bankene bruker SIFO-budsjett (ca. 12 000 kr for én voksen uten bil). Ditt faktiske forbruk uten bolig, lån og skatt: ${kr(std.forbrukUtenBolig)} kr`),
          tall('felleskost', 'Felleskostnader, strøm, forsikring m.m. per måned'),
          tall('rente', 'Rente (%)', '', { prosent: true }),
          tall('lopetid', 'Nedbetalingstid (år)')),
        h('label.avkryss', medInv, ` Bruk også aksjer og fond som egenkapital (${kr(v.egenkapitalInvestert)} kr – må selges, skatt på gevinst)`))),
    resultat));

  function tegn() {
    const ek = v.egenkapitalBank + (v.medInvestert ? v.egenkapitalInvestert : 0) + (v.ekstraEk || 0);
    const r = kjopsevne({ ...v, egenkapital: ek });
    const s = r.valgt;
    const begr = { egenkapital: 'egenkapitalen', gjeldsgrad: 'gjeldsgraden (5 × inntekt)', betjeningsevne: 'betjeningsevnen (stresstest)' }[r.begrensning];
    clear(resultat).append(
      h('section.kort',
        h('h2', 'Hvor mye kan du kjøpe for?'),
        h('div.fliser',
          flis('Maks boligpris', krs(Math.floor(r.maksPris / 50000) * 50000), `begrenset av ${begr}`),
          flis('Maks lån', krs(Math.floor(r.maksLan / 50000) * 50000), `gjeldsgrad ${kr(r.maksLanGjeldsgrad)} · stresstest ${kr(r.maksLanBetjening)}`),
          flis('Egenkapital', krs(ek), `holder til ${kr(r.prisEk)} kr`)),
        h('table.tabell.kompakt', h('tbody',
          h('tr', h('td', `Gjeldsgrad: ${REGLER.gjeldsgrad} × ${kr(r.inntekt)} − eksisterende gjeld ${kr(v.gjeld)}`), h('td.tall', kr(r.maksLanGjeldsgrad))),
          h('tr', h('td', `Betjeningsevne: ${kr(r.rom)} kr/mnd til lån med ${(r.stressRente * 100).toFixed(1).replace('.', ',')} % rente`), h('td.tall', kr(r.maksLanBetjening))),
          h('tr', h('td', `Egenkapital: ${kr(ek)} kr dekker 10 %${v.boligtype === 'selveier' ? ' + dokumentavgift' : ''} av`), h('td.tall', kr(r.prisEk)))))),
      h('section.kort',
        h('h2', `Bolig til ${kr(v.pris)} kr`),
        h('ul.sjekkliste', s.sjekk.map((x) => h('li', { class: x.ok ? 'ok' : 'feil' }, `${x.ok ? '✓' : '✗'} ${x.navn}`, h('span.dempet', ` – ${x.detalj}`)))),
        h('table.tabell.kompakt', h('tbody',
          h('tr', h('td', 'Lån'), h('td.tall', kr(s.lan))),
          h('tr', h('td', 'Omkostninger (dokumentavgift, tinglysing m.m.)'), h('td.tall', kr(s.omk))),
          h('tr', h('td', 'Belåningsgrad'), h('td.tall', pct(s.belaning))),
          h('tr.delsum', h('td', `Terminbeløp (annuitet ${v.lopetid} år)`), h('td.tall', kr(s.betaling))),
          h('tr', h('td', '– herav renter første måned'), h('td.tall', kr(s.renter1))),
          h('tr', h('td', '– herav avdrag første måned'), h('td.tall', kr(s.avdrag1))),
          h('tr', h('td', '+ felleskostnader m.m.'), h('td.tall', kr(v.felleskost))),
          h('tr.delsum', h('td', 'Boutgifter per måned'), h('td.tall', kr(s.totalPerMnd))),
          h('tr', h('td', 'Etter rentefradrag (22 %)'), h('td.tall', kr(s.nettoPerMnd))),
          h('tr', h('td', `Terminbeløp ved rente + 3 pp`), h('td.tall', kr(s.stressBetaling))))),
        s.avdragskrav ? h('p.dempet', 'Belåningsgraden er over 60 %, så banken krever avdrag (minst 2,5 % i året eller annuitet).') : null,
        h('p.dempet', 'Anslag etter hovedreglene i utlånsforskriften. Bankene kan gjøre unntak og bruker egne budsjetter for livsopphold (SIFO).')));
  }
  tegn();
}

// ---------- Bilkostnad ----------

function visBil(el, params, tegnPaNytt) {
  const db = store.db;
  db.bil ||= {};
  const b = db.bil;
  const biler = db.formue.poster.filter((p) => p.side === 'eiendel' && p.type === 'kjoretoy');
  const k = bilkostnad(db, { aar: params.aar });
  const bilValg = velg([{ verdi: '', tekst: 'Velg bil …' }, ...biler.map((p) => ({ verdi: p.id, tekst: p.navn }))], k.bil?.id || '', { 'aria-label': 'Bil', onchange: (e) => { b.postId = e.target.value; store.changed(); tegnPaNytt(); } });
  const aarValg = velg(k.aarListe.map((a) => ({ verdi: a, tekst: a })), k.aar, { 'aria-label': 'År', onchange: (e) => tegnPaNytt({ aar: e.target.value }) });
  const km = h('input', { inputmode: 'numeric', placeholder: 'km-stand' });
  const kmDato = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const forsikring = h('input', { inputmode: 'numeric', value: b.forsikringPerAar ? String(b.forsikringPerAar) : '', placeholder: k.forsikringFunnet ? `${kr(k.forsikringFunnet)} (funnet)` : 'kr per år' });
  const verditap = h('input', { inputmode: 'decimal', value: b.verditapProsent != null ? String(b.verditapProsent * 100).replace('.', ',') : '', placeholder: k.verditapKilde === 'verdier' ? 'fra registrerte verdier' : '12' });
  const lagreOppsett = () => {
    b.forsikringPerAar = lesBelop(forsikring.value) || null;
    const vt = lesBelop(verditap.value);
    b.verditapProsent = vt == null ? null : vt / 100;
    store.changed();
    tegnPaNytt();
  };
  forsikring.addEventListener('change', lagreOppsett);
  verditap.addEventListener('change', lagreOppsett);

  fyll(el, h('div.knapperad.fane-valg', bilValg, aarValg));
  if (!k.bil) {
    fyll(el, tomTilstand('Ingen bil valgt', 'Registrer bilen som eiendel (type kjøretøy) under Formue og gjeld, og velg den her.'));
    return;
  }
  fyll(el,
    h('section.fliser',
      flis(`Totalkostnad ${k.aar}`, krs(k.totalAar), `${kr(k.perMnd)} kr per måned`),
      flis('Per km', k.perKm != null ? `${kr(k.perKm, true)} kr` : '–', k.kmPerAar ? `${kr(k.kmPerAar)} km per år` : 'registrer km-stand'),
      flis('Uten verditap og renter', krs(k.kontantAar), `${kr(k.kontantAar / 12)} kr/mnd i snitt`),
      flis('Verditap', krs(k.verditap), k.verditapKilde === 'verdier' ? 'fra registrerte verdier' : `${pct(k.verditapSats)} av verdien`)),
    h('div.rutenett',
      h('section.kort', h('h2', `Kostnader ${k.aar}`), h('p.dempet', k.maneder < 12 ? `Regnet om til helt år fra ${k.maneder} måneder med data` : 'Hele året'),
        stolpeliste({ elementer: k.poster.filter((p) => p.belop > 0).map((p) => ({ etikett: p.navn, verdi: p.belop })), format: (v) => kr(v) + ' kr' })),
      h('section.kort', h('h2', 'Oppsett'),
        h('form.skjema', { onsubmit: (e) => e.preventDefault() },
          felt('Bilforsikring per år', forsikring, 'Forsikring ligger i en felles kategori, så skriv inn bilens andel'),
          felt('Verditap per år (%)', verditap, 'Tomt = beregnet fra registrerte verdier på bilen, ellers 12 %'),
          h('h3', 'Kilometerstand'),
          h('div.skjema-rutenett', felt('Dato', kmDato), felt('Km-stand', km)),
          h('button.sekundar', { type: 'button', onclick: () => {
            const v = lesBelop(km.value);
            if (!v || !kmDato.value) { toast('Fyll inn dato og km-stand', 'feil'); return; }
            b.kmstand ||= [];
            b.kmstand.push({ dato: kmDato.value, km: v });
            b.kmstand.sort((a, c) => a.dato.localeCompare(c.dato));
            store.changed();
            tegnPaNytt();
          } }, 'Legg til km-stand'),
          (b.kmstand || []).length ? h('table.tabell.kompakt', h('tbody', [...b.kmstand].reverse().map((x) => h('tr', h('td', datoNo(x.dato)), h('td.tall', `${kr(x.km)} km`),
            h('td', h('button.lenke', { type: 'button', onclick: () => { b.kmstand.splice(b.kmstand.indexOf(x), 1); store.changed(); tegnPaNytt(); } }, 'fjern')))))) : null))),
    h('section.kort', h('h2', 'Slik er det regnet'),
      h('ul.dempet',
        h('li', 'Drivstoff/lading, bompenger, parkering, service, bilvask, skade og annet fra kategorien Bil og transport (ikke kollektiv/taxi og bilhobby).'),
        h('li', 'Renter på billånet (saldo × rente). Avdrag er sparing og telles ikke.'),
        h('li', 'Verditap og forsikring som angitt i oppsettet. Km per år fra registrerte km-stander.'))));
}
