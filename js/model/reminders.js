// Påminnelser: regelbaserte gjøremål og varsler som vises på oversikten.

import { verdiPa, INVESTERING, MND_NAVN } from './calc.js';
import { fastePoster, oppsummerFaste } from './recurring.js';
import { skatteprognose } from './tax.js';
import { prognose } from './forecast.js';
import { budsjettVarsler } from '../views/budget.js';
import { kr, datoNo } from '../util.js';
import { garantier } from './documents.js';
import { oppgjorsoversikt } from './household.js';
import { utleggsoversikt } from './outlays.js';
import { avvik } from './insight.js';
import { aarFor, erLastAar, budsjettKilde } from './years.js';

const dagerMellom = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const mndNavn = (mnd) => `${MND_NAVN[Number(mnd.slice(5, 7)) - 1].toLowerCase()} ${mnd.slice(0, 4)}`;

// alvor: 'hoy' (bør gjøres nå), 'middels', 'info'
export function paminnelser(db, { idag = new Date().toISOString().slice(0, 10), vault = null } = {}) {
  const ut = [];
  const legg = (id, alvor, tekst, lenke) => ut.push({ id, alvor, tekst, lenke });

  // Sikkerhet
  if (vault && vault.meta?.format === 2 && !vault.harGjenoppretting) legg('gjenoppretting', 'hoy', 'Du har ingen gjenopprettingsnøkkel – lag en, ellers er dataene tapt om du glemmer passordet', '#/innstillinger');
  const tokenUt = db.innstillinger?.tokenUtloper;
  if (tokenUt) {
    const d = dagerMellom(idag, tokenUt);
    if (d <= 21) legg('token', d <= 7 ? 'hoy' : 'middels', d < 0 ? `GitHub-tokenen gikk ut ${datoNo(tokenUt)} – lag en ny og koble til på nytt` : `GitHub-tokenen går ut om ${d} dager (${datoNo(tokenUt)}) – lag en ny i god tid`, '#/innstillinger');
  }

  // Datakvalitet
  const ukat = db.transaksjoner.filter((t) => !t.kategori).length;
  if (ukat) legg('ukategorisert', 'middels', `${ukat} transaksjoner mangler kategori`, '#/transaksjoner?kat=__ingen');

  // Import per konto
  const siste = new Map();
  for (const t of db.transaksjoner) if (!siste.has(t.konto) || t.dato > siste.get(t.konto)) siste.set(t.konto, t.dato);
  for (const k of db.kontoer) {
    if (k.id === 'korreksjon' || k.aktiv === false) continue;
    const d = siste.get(k.id);
    if (!d) continue;
    const dager = dagerMellom(d, idag);
    if (dager > 40 && dager < 400) legg(`import-${k.id}`, dager > 70 ? 'middels' : 'info', `Importer nye transaksjoner for ${k.navn} (siste ${datoNo(d)})`, '#/import');
  }

  // Frys forrige måned
  if (db.formue.poster.length) {
    const d = new Date(Date.parse(idag));
    const forrige = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    if (!(db.formue.historikk || []).some((h) => h.mnd === forrige)) legg(`frys-${forrige}`, 'info', `Frys formuen for ${mndNavn(forrige)}: oppdater verdiene og trykk «Frys måned»`, '#/formue');
  }

  // Utdaterte verdier
  const gamleLan = db.formue.poster.filter((p) => p.side === 'gjeld' && verdiPa(p) && dagerMellom(verdiPa(p).dato, idag) > 45);
  if (gamleLan.length) legg('lan-saldo', 'info', `Oppdater saldo på ${gamleLan.map((p) => p.navn.split(' (')[0]).join(', ')} (eldre enn 45 dager)`, '#/formue');
  const gamleInv = [...new Set(db.formue.poster.filter((p) => INVESTERING.has(p.type) && verdiPa(p) && dagerMellom(verdiPa(p).dato, idag) > 45).map((p) => p.gruppe))];
  if (gamleInv.length) legg('inv-verdier', 'info', `Oppdater verdier fra meglerrapport: ${gamleInv.join(', ')}`, '#/formue');

  // Budsjett (siste måned med data)
  const sisteMnd = [...new Set(db.transaksjoner.map((t) => (t.betalt || t.dato).slice(0, 7)))].sort().pop();
  if (sisteMnd) {
    for (const b of budsjettVarsler(db, sisteMnd).sort((a, c) => c.andel - a.andel).slice(0, 4)) {
      legg(`budsjett-${sisteMnd}-${b.id}`, b.over ? 'middels' : 'info', `${b.over ? 'Over budsjett' : 'Nær budsjettgrensen'}: ${b.navn} – ${kr(b.brukt)} av ${kr(b.budsjett)} kr i ${mndNavn(sisteMnd)}`, `#/budsjett?mnd=${sisteMnd}`);
    }
  }

  // Faste utgifter
  if (db.transaksjoner.length) {
    const o = oppsummerFaste(fastePoster(db));
    for (const p of o.prisendringer.filter((x) => dagerMellom(x.endring.dato, idag) < 75)) {
      legg(`pris-${p.id}-${p.endring.dato}`, 'middels', `Prisøkning: ${p.navn} ${kr(-p.endring.fra)} → ${kr(-p.endring.til)} kr`, '#/planlegging?fane=faste');
    }
  }

  // Skatt
  const aar = Number(idag.slice(0, 4));
  const mnd = Number(idag.slice(5, 7));
  const harLonn = (db.inntekt?.lonnsslipper || []).some((l) => l.mnd.startsWith(String(aar)));
  if (harLonn) {
    const s = skatteprognose(db, aar);
    if (s.differanse > 5000) legg(`restskatt-${aar}`, 'middels', `Forventet restskatt for ${aar}: ca. ${kr(s.differanse)} kr – vurder å øke trekket eller betale tilleggsforskudd innen 31. mai ${aar + 1}`, '#/planlegging?fane=skatt');
  }
  if (mnd === 3 || mnd === 4) legg(`skattemelding-${aar}`, mnd === 4 ? 'hoy' : 'middels', `Skattemeldingen for ${aar - 1} skal leveres innen 30. april – bruk årsrapporten som sjekkliste`, `#/rapport?periode=aar&aar=${aar - 1}`);
  if (mnd === 5) {
    const forrige = (db.inntekt?.lonnsslipper || []).some((l) => l.mnd.startsWith(String(aar - 1))) ? skatteprognose(db, aar - 1) : null;
    if (forrige && forrige.differanse > 1000) legg(`tilleggsforskudd-${aar}`, 'hoy', `Betal tilleggsforskudd (ca. ${kr(forrige.differanse)} kr) for ${aar - 1} innen 31. mai for å unngå rentetillegg`, '#/planlegging?fane=skatt');
  }

  // Likviditet
  if (db.transaksjoner.length && db.formue.poster.some((p) => p.type === 'bank')) {
    const p = prognose(db, { maneder: 6 });
    if (p?.forsteUnder) legg('likviditet', 'hoy', `Prognosen viser at saldoen går under bufferen i ${p.forsteUnder.navn.toLowerCase()}`, '#/planlegging?fane=prognose');
  }

  // Garanti og reklamasjon som snart går ut
  for (const g of garantier(db, idag).filter((x) => x.dager >= 0 && x.dager <= 45)) {
    legg(`garanti-${g.dokument.id}-${g.type}`, g.dager <= 14 ? 'middels' : 'info', `${g.navn} for «${g.dokument.tittel}» går ut ${datoNo(g.til)} (om ${g.dager} dager) – sjekk at varen virker`, '#/dokumenter');
  }

  // Husholdning: utestående oppgjør
  if (db.husholdning?.aktiv) {
    const o = oppgjorsoversikt(db);
    if (Math.abs(o.saldo) >= 1000) legg('husholdning-saldo', 'info', o.saldo > 0 ? `${db.husholdning.partner || 'Partneren'} skylder deg ${kr(o.saldo)} kr i felles utgifter` : `Du skylder ${db.husholdning.partner || 'partneren'} ${kr(-o.saldo)} kr i felles utgifter`, '#/husholdning');
  }

  // Utlegg som ikke er betalt tilbake
  for (const g of utleggsoversikt(db, idag).grupper.filter((x) => x.id && x.utestaende >= 100 && x.dager > 30)) {
    legg(`utlegg-${g.id}-${g.eldsteUbetalt}`, g.dager > 90 ? 'middels' : 'info', `${g.navn} skylder deg ${kr(g.utestaende)} kr i utlegg (eldste fra ${datoNo(g.eldsteUbetalt)})`, `#/utlegg?m=${encodeURIComponent(g.id)}`);
  }

  // Mulige dobbeltbelastninger og gebyrer (siste 30 dager)
  const grense = new Date(Date.parse(idag) - 30 * 86400000).toISOString().slice(0, 10);
  for (const a of avvik(db, { idag, dager: 30 }).filter((x) => ['dobbel', 'gebyr'].includes(x.type) && (x.dato || '') >= grense)) {
    legg(`avvik-${a.id}`, 'middels', a.tekst, '#/innsikt?fane=avvik');
  }

  // Nytt år: avslutt forrige år og lag budsjett
  {
    const iAar = Number(idag.slice(0, 4));
    const mndNr = Number(idag.slice(5, 7));
    const forrige = String(iAar - 1);
    if (mndNr <= 4 && db.transaksjoner.some((t) => aarFor(t) === forrige) && !erLastAar(db, forrige)) {
      legg(`avslutt-${forrige}`, mndNr >= 2 ? 'middels' : 'info', `Avslutt ${forrige}: importer det siste, frys desember og lås året`, `#/rapport?periode=aar&aar=${forrige}`);
    }
    const kilde = budsjettKilde(db, String(iAar));
    if (kilde.type === 'videreført' && db.transaksjoner.some((t) => aarFor(t) === String(iAar))) {
      legg(`budsjett-nytt-${iAar}`, 'info', `Lag budsjett for ${iAar} – nå brukes budsjettet${kilde.fra ? ` fra ${kilde.fra}` : ' fra i fjor'}`, `#/budsjett?mnd=${iAar}-01&rediger=1`);
    }
  }

  // Huskeliste
  for (const n of db.notater.filter((x) => x.type === 'huskeliste' && !x.ferdig)) {
    legg(`husk-${n.id}`, n.mnd && n.mnd <= idag.slice(0, 7) ? 'middels' : 'info', `${n.tittel ? n.tittel + ': ' : ''}${n.tekst}`, '#/notater');
  }

  // Skjulte påminnelser (utsatt av brukeren)
  const skjult = db.innstillinger?.skjultePaminnelser || {};
  const rekkefolge = { hoy: 0, middels: 1, info: 2 };
  return ut.filter((p) => !(skjult[p.id] && skjult[p.id] >= idag)).sort((a, b) => rekkefolge[a.alvor] - rekkefolge[b.alvor]);
}
