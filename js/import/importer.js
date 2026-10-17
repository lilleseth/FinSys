// Klargjøring av importerte rader: konto, duplikatkontroll og kategoriforslag.

import { uid } from '../util.js';
import { lagModell, foreslå } from '../model/rules.js';

const cent = (x) => Math.round(x * 100);

// Finner konto som passer filen (kontonummer, korttype, navn).
export function finnKonto(db, hint) {
  const digits = (s) => String(s || '').replace(/\D/g, '');
  if (hint.kontonr) {
    const k = db.kontoer.find((x) => x.kontonr && digits(x.kontonr) === digits(hint.kontonr));
    if (k) return k.id;
  }
  if (hint.kortType) {
    const k = db.kontoer.find((x) => x.importFormat === hint.kortType)
      || db.kontoer.find((x) => x.type === 'kredittkort' && x.navn.toLowerCase().includes(hint.kortType));
    if (k) return k.id;
  }
  if (hint.navn) {
    const n = hint.navn.toLowerCase();
    const k = db.kontoer.find((x) => x.navn.toLowerCase() === n) || db.kontoer.find((x) => x.navn.toLowerCase().includes(n));
    if (k) return k.id;
  }
  return '';
}

// Markerer duplikater mot eksisterende transaksjoner på samme konto.
// Sammenligner dato + beløp (med antall, så to like kjøp samme dag håndteres), og referansenummer der det finnes.
export function merkDuplikater(rader, db, kontoId) {
  const telling = new Map();
  const refs = new Set();
  for (const t of db.transaksjoner) {
    if (t.konto !== kontoId) continue;
    const k = `${t.dato}|${cent(t.belop)}`;
    telling.set(k, (telling.get(k) || 0) + 1);
    if (t.ref) refs.add(t.ref);
    const m = (t.detaljer || '').match(/Ref (\d{6,})/);
    if (m) refs.add(m[1]);
  }
  for (const r of rader) {
    const k = `${r.dato}|${cent(r.belop)}`;
    if (r.ref && refs.has(r.ref)) {
      r.duplikat = true;
      if (telling.get(k)) telling.set(k, telling.get(k) - 1);
    } else if (telling.get(k)) {
      r.duplikat = true;
      telling.set(k, telling.get(k) - 1);
    } else r.duplikat = false;
  }
  return rader;
}

export function foreslåAlle(rader, db, kontoId) {
  const modell = lagModell(db.transaksjoner);
  for (const r of rader) {
    const f = foreslå({ ...r, konto: kontoId }, modell, db.regler || []);
    r.forslag = f;
    r.kategori = f.kategori;
    if (f.tekst) r.tekst = f.tekst;
  }
  return rader;
}

export function tilTransaksjoner(rader, kontoId, kilde) {
  return rader.map((r) => ({
    id: 't-' + uid(),
    konto: kontoId,
    dato: r.dato,
    betalt: r.betalt || r.dato,
    forfall: r.forfall || null,
    tekst: r.tekst || r.tekstRa,
    ra: r.tekstRa,
    belop: r.belop,
    kategori: r.kategori || '',
    etiketter: [],
    detaljer: r.detaljer || '',
    notat: '',
    kilde,
    ref: r.ref || undefined,
    importert: new Date().toISOString().slice(0, 10),
  }));
}
