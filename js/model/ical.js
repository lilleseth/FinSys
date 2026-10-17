// Kalenderfil (iCalendar/.ics) med faste trekk, frister og påminnelser. Importeres i mobilens kalender.

import { fastePoster } from './recurring.js';
import { garantier } from './documents.js';
import { kr } from '../util.js';

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const dag = (d) => d.replace(/-/g, '');
const nesteDag = (d) => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);

// Bretter linjer til maks 75 byte (RFC 5545)
function brett(linje) {
  const bytes = new TextEncoder().encode(linje);
  if (bytes.length <= 75) return linje;
  const deler = [];
  let rest = linje;
  let maks = 75;
  while (rest.length) {
    let n = Math.min(rest.length, maks);
    while (new TextEncoder().encode(rest.slice(0, n)).length > maks) n--;
    deler.push(rest.slice(0, n));
    rest = rest.slice(n);
    maks = 74; // ett tegn går til innledende mellomrom
  }
  return deler.join('\r\n ');
}

export function lagKalender(db, { medBelop = true, idag = new Date().toISOString().slice(0, 10) } = {}) {
  const stempel = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const hendelser = [];
  const legg = ({ id, dato, tittel, beskrivelse = '', rrule = null, varsel = 1 }) => {
    hendelser.push([
      'BEGIN:VEVENT',
      `UID:${String(id).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]+/g, '-')}@finsys`,
      `DTSTAMP:${stempel}`,
      `DTSTART;VALUE=DATE:${dag(dato)}`,
      `DTEND;VALUE=DATE:${dag(nesteDag(dato))}`,
      `SUMMARY:${esc(tittel)}`,
      beskrivelse ? `DESCRIPTION:${esc(beskrivelse)}` : null,
      rrule ? `RRULE:${rrule}` : null,
      'TRANSP:TRANSPARENT',
      varsel != null ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(tittel)}`, `TRIGGER:-P${varsel}D`, 'END:VALARM'] : null,
      'END:VEVENT',
    ].flat().filter(Boolean));
  };
  const belop = (b) => (medBelop ? ` (${kr(Math.abs(b))} kr)` : '');

  // Faste trekk og inntekter
  for (const p of fastePoster(db).filter((x) => !x.stoppet && x.neste)) {
    const tekst = p.type === 'inntekt' ? 'Inn' : p.type === 'sparing' ? 'Sparing' : 'Trekk';
    legg({ id: `fast-${p.id}`, dato: Number(p.neste.slice(8)) > 28 ? `${p.neste.slice(0, 8)}28` : p.neste, tittel: `${tekst}: ${p.navn}${belop(p.belop)}`, beskrivelse: `Fast post funnet av FinSys, hver ${p.intervall === 1 ? 'måned' : `${p.intervall}. måned`}.`, rrule: `FREQ=MONTHLY;INTERVAL=${p.intervall};COUNT=${Math.max(2, Math.ceil(24 / p.intervall))}`, varsel: p.type === 'utgift' && Math.abs(p.belop) >= 2000 ? 2 : null });
  }

  // Planlagte engangsposter
  for (const p of db.planlagt || []) {
    if (`${p.mnd}-28` < idag) continue;
    legg({ id: `plan-${p.id}`, dato: `${p.mnd}-01`, tittel: `${p.tekst}${belop(p.belop)}`, beskrivelse: 'Planlagt post i FinSys-prognosen (måned).', varsel: 7 });
  }

  // Skattefrister (hvert år)
  const aar = Number(idag.slice(0, 4));
  legg({ id: 'skattemelding', dato: `${aar}-04-30`, tittel: 'Frist skattemelding', beskrivelse: 'Lever skattemeldingen. Bruk årsrapporten i FinSys som sjekkliste.', rrule: 'FREQ=YEARLY', varsel: 14 });
  legg({ id: 'tilleggsforskudd', dato: `${aar}-05-31`, tittel: 'Frist tilleggsforskudd (unngå rentetillegg på restskatt)', rrule: 'FREQ=YEARLY', varsel: 7 });

  // Månedlig rutine
  legg({ id: 'mnd-rutine', dato: `${idag.slice(0, 7)}-05`, tittel: 'FinSys: importer transaksjoner og frys forrige måned', rrule: 'FREQ=MONTHLY', varsel: null });

  // Sparemål
  for (const m of db.mal || []) {
    if (!m.frist) continue;
    legg({ id: `mal-${m.id}`, dato: `${m.frist}-01`, tittel: `Sparemål: ${m.navn}${belop(m.belop)}`, varsel: 30 });
  }

  // Huskeliste med måned
  for (const n of (db.notater || []).filter((x) => x.type === 'huskeliste' && !x.ferdig && x.mnd)) {
    legg({ id: `husk-${n.id}`, dato: `${n.mnd}-01`, tittel: n.tittel || n.tekst.slice(0, 60), beskrivelse: n.tekst });
  }

  // Garanti og reklamasjon
  for (const g of garantier(db, idag).filter((x) => x.dager >= 0)) {
    legg({ id: `garanti-${g.dokument.id}-${g.type}`, dato: g.til, tittel: `${g.navn} går ut: ${g.dokument.tittel}`, varsel: 14 });
  }

  // GitHub-token
  if (db.innstillinger?.tokenUtloper) {
    legg({ id: 'token', dato: db.innstillinger.tokenUtloper, tittel: 'FinSys: GitHub-tokenen går ut – lag ny', varsel: 14 });
  }

  const linjer = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FinSys//NO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:FinSys', ...hendelser.flat(), 'END:VCALENDAR'];
  return { tekst: linjer.map(brett).join('\r\n') + '\r\n', antall: hendelser.length };
}
