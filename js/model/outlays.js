// Utlegg og refusjoner per motpart: hva er lagt ut, hva er betalt tilbake, og hva er utestående.
// Refusjoner fordeles på de eldste utleggene først (FIFO), slik at alderen på det som mangler kan vises.

import { normaliser } from './rules.js';

const UNDER_MONSTRE = [
  /\(([^)]+?)-refundert/i, // «Lading (FIRMA-refundert)»
  /refunderes av ([\p{L}][\p{L} .-]*?)\)?$/iu, // «Avis (refunderes av Ola)»
  /refusjon fra ([\p{L}][\p{L} .-]*?)\)?$/iu, // «Refusjon fra Ola»
  /-refusjon fra ([\p{L}][\p{L} .-]*?)\)?$/iu,
  /kjøp for ([\p{L}][\p{L} .-]*?)\)?$/iu, // «Kjøp for Kari Nordmann»
];

export function erUtlegg(t) {
  if (t.ikkeRefunderes) return false;
  return !!t.motpart || t.kategori?.startsWith('utlegg/') || (t.etiketter || []).includes('Refunderes');
}

// Motpart foreslått fra underkategorien i regnearket (gamle data)
function fraUnderkategori(t) {
  const u = t.opprinnelig?.underkategori || '';
  for (const m of UNDER_MONSTRE) {
    const r = u.match(m);
    if (r) return r[1].trim();
  }
  return null;
}

// Alle ord i motpartens navn (eller et alias) finnes i teksten
function treffer(navn, tekst) {
  const ord = normaliser(navn).split(' ').filter(Boolean);
  const t = ` ${normaliser(tekst)} `;
  return ord.length > 0 && ord.every((o) => t.includes(` ${o} `));
}

export function motparter(db) {
  db.motparter ||= [];
  return db.motparter;
}

// Finner motpart for en transaksjon: egen markering → underkategori → navn/alias i teksten
export function motpartFor(t, liste) {
  if (t.motpart) return liste.find((m) => m.id === t.motpart) || { id: t.motpart, navn: t.motpart, alias: [] };
  const fraU = fraUnderkategori(t);
  if (fraU) return liste.find((m) => [m.navn, ...(m.alias || [])].some((n) => normaliser(n) === normaliser(fraU))) || { id: `auto:${normaliser(fraU)}`, navn: fraU, alias: [], auto: true };
  const tekst = `${t.tekst} ${t.detaljer || ''}`;
  return liste.find((m) => [m.navn, ...(m.alias || [])].some((n) => treffer(n, tekst))) || null;
}

export function utleggsoversikt(db, idag = new Date().toISOString().slice(0, 10)) {
  const liste = [...motparter(db)];
  // Motparter funnet automatisk tas med i listen, slik at refusjoner med samme navn i teksten treffer
  for (const t of db.transaksjoner.filter(erUtlegg)) {
    const m = motpartFor(t, liste);
    if (m?.auto && !liste.some((x) => x.id === m.id)) liste.push(m);
  }
  const grupper = new Map();
  for (const m of liste.filter((x) => !x.auto && x.startsaldo)) grupper.set(m.id, { id: m.id, navn: m.navn, motpart: m, transaksjoner: [] });
  for (const t of db.transaksjoner.filter(erUtlegg).sort((a, b) => (a.betalt || a.dato).localeCompare(b.betalt || b.dato))) {
    const m = motpartFor(t, liste);
    if (m?.fra && t.dato < m.fra) continue;
    const id = m?.id || '';
    if (!grupper.has(id)) grupper.set(id, { id, navn: m?.navn || 'Uten motpart', auto: !!m?.auto, motpart: m, transaksjoner: [] });
    grupper.get(id).transaksjoner.push(t);
  }

  const ut = [];
  for (const g of grupper.values()) {
    const ko = [];
    const poster = [];
    let utlagt = 0;
    // Startsaldo: utestående fra før dataene (positiv = de skylder deg)
    const start = g.motpart?.startsaldo || 0;
    if (start > 0) {
      const p = { t: { id: 'start', dato: g.motpart.fra || '', tekst: 'Startsaldo', belop: -start }, belop: start, gjenstar: start, start: true };
      utlagt += start;
      ko.push(p);
      poster.push(p);
    }
    // Kreditt: refusjoner som kom før utlegget (eller negativ startsaldo) dekker senere utlegg
    let kreditt = start < 0 ? -start : 0;
    let refundert = kreditt;
    let sisteRefusjon = null;
    for (const t of g.transaksjoner) {
      if (t.belop < 0) {
        const p = { t, belop: -t.belop, gjenstar: -t.belop };
        const dekket = Math.min(kreditt, p.gjenstar);
        p.gjenstar -= dekket;
        kreditt -= dekket;
        utlagt += p.belop;
        if (p.gjenstar > 0.005) ko.push(p);
        poster.push(p);
      } else if (t.belop > 0) {
        refundert += t.belop;
        sisteRefusjon = t.betalt || t.dato;
        let rest = t.belop;
        while (rest > 0.005 && ko.length) {
          const forste = ko[0];
          const brukt = Math.min(rest, forste.gjenstar);
          forste.gjenstar -= brukt;
          rest -= brukt;
          if (forste.gjenstar < 0.005) ko.shift();
        }
        kreditt += rest;
        poster.push({ t, belop: t.belop, refusjon: true });
      }
    }
    const ubetalt = poster.filter((p) => !p.refusjon && p.gjenstar > 0.005);
    const eldste = ubetalt[0]?.t.dato || (ubetalt.length ? g.motpart?.fra || null : null);
    ut.push({
      ...g,
      utlagt, refundert, utestaende: utlagt - refundert,
      eldsteUbetalt: eldste,
      dager: eldste ? Math.round((Date.parse(idag) - Date.parse(eldste)) / 86400000) : null,
      sisteRefusjon, poster, antallUbetalt: ubetalt.length,
    });
  }
  ut.sort((a, b) => b.utestaende - a.utestaende);
  const total = ut.filter((g) => g.id).reduce((s, g) => s + Math.max(0, g.utestaende), 0);
  return { grupper: ut, utestaende: total, motparter: liste };
}
