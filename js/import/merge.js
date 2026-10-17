// Slår sammen et importert regneark (f.eks. et tidligere år) med eksisterende data uten duplikater.
// Eksisterende verdier beholdes; bare det som mangler legges til. Låste år røres ikke.

import { normaliser } from '../model/rules.js';
import { erLastTransaksjon, erLastDato } from '../model/years.js';

const nokkel = (t) => `${t.dato}|${Math.round(t.belop * 100)}|${t.konto}|${normaliser(t.tekst)}`;

export function slaSammen(db, d) {
  const logg = [];
  const tell = (n, tekst) => { if (n) logg.push(`${n} ${tekst}`); };

  // Kontoer
  const kontoIder = new Set(db.kontoer.map((k) => k.id));
  const nyeKontoer = d.kontoer.filter((k) => !kontoIder.has(k.id));
  db.kontoer.push(...nyeKontoer);
  tell(nyeKontoer.length, 'nye kontoer');

  // Transaksjoner
  const finnes = new Set(db.transaksjoner.map(nokkel));
  let nyeT = 0;
  let lasteT = 0;
  let dupT = 0;
  for (const t of d.transaksjoner) {
    if (erLastTransaksjon(db, t)) { lasteT++; continue; }
    const k = nokkel(t);
    if (finnes.has(k)) { dupT++; continue; }
    finnes.add(k);
    db.transaksjoner.push(t);
    nyeT++;
  }
  tell(nyeT, 'transaksjoner lagt til');
  tell(dupT, 'transaksjoner fantes fra før og ble hoppet over');
  tell(lasteT, 'transaksjoner i låste år ble hoppet over');

  // Formuesposter og verdier
  let nyePoster = 0;
  let nyeVerdier = 0;
  for (const p of d.formue.poster) {
    const eks = db.formue.poster.find((x) => x.side === p.side && x.navn.toLowerCase() === p.navn.toLowerCase());
    if (!eks) {
      p.verdier = (p.verdier || []).filter((v) => !erLastDato(db, v.dato));
      db.formue.poster.push(p);
      nyePoster++;
      nyeVerdier += p.verdier.length;
      continue;
    }
    eks.verdier ||= [];
    for (const v of p.verdier || []) {
      if (erLastDato(db, v.dato) || eks.verdier.some((x) => x.dato === v.dato)) continue;
      eks.verdier.push(v);
      nyeVerdier++;
    }
    eks.verdier.sort((a, b) => a.dato.localeCompare(b.dato));
    if (eks.rente == null && p.rente != null) eks.rente = p.rente;
  }
  tell(nyePoster, 'nye formuesposter');
  tell(nyeVerdier, 'nye verdier i formueshistorikken til postene');

  // Frosne måneder
  const mnder = new Set((db.formue.historikk || []).map((x) => x.mnd));
  const nyeHist = (d.formue.historikk || []).filter((x) => !mnder.has(x.mnd) && !erLastDato(db, x.mnd));
  db.formue.historikk.push(...nyeHist);
  db.formue.historikk.sort((a, b) => a.mnd.localeCompare(b.mnd));
  tell(nyeHist.length, 'frosne måneder');

  // Utbytte
  const utb = new Set((db.formue.utbytte || []).map((u) => `${u.aar}|${u.gruppe}`));
  const nyeUtb = (d.formue.utbytte || []).filter((u) => !utb.has(`${u.aar}|${u.gruppe}`));
  db.formue.utbytte.push(...nyeUtb);
  tell(nyeUtb.length, 'utbytteposter');

  // Lønnsslipper
  const slipper = new Set((db.inntekt.lonnsslipper || []).map((l) => l.mnd));
  const nyeSl = (d.inntekt.lonnsslipper || []).filter((l) => !slipper.has(l.mnd) && !erLastDato(db, l.mnd));
  db.inntekt.lonnsslipper.push(...nyeSl);
  db.inntekt.lonnsslipper.sort((a, b) => a.mnd.localeCompare(b.mnd));
  tell(nyeSl.length, 'lønnsslipper');

  // Notater
  const notater = new Set(db.notater.map((n) => `${n.tittel || ''}|${n.tekst}`));
  const nyeN = d.notater.filter((n) => !notater.has(`${n.tittel || ''}|${n.tekst}`));
  db.notater.push(...nyeN);
  tell(nyeN.length, 'notater');

  if (!logg.length) logg.push('Ingenting nytt – alt fantes fra før.');
  return logg;
}
