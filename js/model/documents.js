// Dokumentarkiv: opplasting (kryptert), tekstuttrekk for søk, kobling til transaksjoner og formue.

import { uid } from '../util.js';
import { store } from '../store.js';
import { pdfLinjer } from '../import/pdf.js';

export const DOK_KATEGORIER = {
  kontoutskrift: 'Kontoutskrift',
  kortfaktura: 'Kortfaktura',
  lonn: 'Lønnsslipp',
  lan: 'Lån og kreditt',
  skatt: 'Skatt',
  investering: 'Investering og pensjon',
  kvittering: 'Kvittering',
  forsikring: 'Forsikring',
  bolig: 'Bolig og kjøretøy',
  avtale: 'Avtaler og kontrakter',
  annet: 'Annet',
};

export const MAKS_STORRELSE = 15 * 1024 * 1024;

// Gjetter dokumenttype ut fra filnavn og tekst.
export function gjettKategori(navn, tekst = '', mime = '') {
  const s = `${navn} ${tekst.slice(0, 3000)}`.toLowerCase();
  if (/lønnsslipp|lonnsslipp|lønnsspesifikasjon|lønn for|feriepenger/.test(s)) return 'lonn';
  if (/kredittkort|cc_|kortfaktura|mastercard|trumf|nordea premium|faktura/.test(s) && /kort|cc|mastercard|trumf|premium/.test(s)) return 'kortfaktura';
  if (/kontoutskrift|\.csv$|bokføringsdato/.test(s)) return 'kontoutskrift';
  if (/lånekassen|lanekassen|betalingsplan|rentebrev|nedbetaling|lånebevis|restgjeld|billån|boliglån/.test(s)) return 'lan';
  if (/skattemelding|skatteoppgjør|skatteoppgjor|skattekort|skatteetaten|forskuddsskatt|restskatt/.test(s)) return 'skatt';
  if (/pareto|nordnet|portefølje|aksjesparekonto|\bask\b|fond|pensjon|epk/.test(s)) return 'investering';
  if (/forsikring|polise|gjensidige|fremtind|tryg\b/.test(s)) return 'forsikring';
  if (/kontrakt|avtale|vilkår/.test(s)) return 'avtale';
  if (/kvittering|receipt/.test(s) || mime.startsWith('image/')) return 'kvittering';
  return 'annet';
}

// Første dato i teksten eller filnavnet (dd.mm.yyyy, yyyy-mm-dd eller måned+år i filnavn).
export function gjettDato(navn, tekst = '') {
  const kilder = [tekst.slice(0, 4000), navn];
  for (const k of kilder) {
    let m = k.match(/\b(\d{2})\.(\d{2})\.(20\d{2})\b/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = k.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (m) return m[0];
  }
  const mnd = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
  const n = navn.toLowerCase();
  const i = mnd.findIndex((x) => n.includes(x) || n.includes(x.slice(0, 3)));
  const y = n.match(/(20\d{2})|(\d{2})(?=\.\w+$)/);
  if (i >= 0 && y) return `${y[1] || '20' + y[2]}-${String(i + 1).padStart(2, '0')}-01`;
  return new Date().toISOString().slice(0, 10);
}

// Komprimerer store bilder (maks 2000 px, JPEG) for å spare plass.
async function komprimerBilde(fil) {
  if (!/^image\/(jpeg|png|webp)$/.test(fil.type) || fil.size < 1.5 * 1024 * 1024) return fil;
  try {
    const bmp = await createImageBitmap(fil);
    const skala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * skala);
    c.height = Math.round(bmp.height * skala);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= fil.size) return fil;
    return new File([blob], fil.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return fil;
  }
}

// Laster opp en fil til arkivet. Returnerer dokumentets metadata.
export async function lastOppDokument(filInn, { kategori, tittel, koblinger = [], dato } = {}) {
  const fil = await komprimerBilde(filInn);
  if (fil.size > MAKS_STORRELSE) throw new Error(`«${fil.name}» er for stor (${(fil.size / 1048576).toFixed(1)} MB). Maks er 15 MB.`);
  const bytes = new Uint8Array(await fil.arrayBuffer());
  let tekst = '';
  const mime = fil.type || (fil.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : fil.name.toLowerCase().endsWith('.csv') ? 'text/csv' : 'application/octet-stream');
  if (mime === 'application/pdf') {
    try { tekst = (await pdfLinjer(bytes.slice().buffer)).join('\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 12000); } catch { /* skannet eller ødelagt PDF */ }
  } else if (/^text\//.test(mime)) {
    tekst = new TextDecoder().decode(bytes.slice(0, 12000));
  }
  const dok = {
    id: 'd-' + uid(),
    filnavn: fil.name,
    mime,
    storrelse: fil.size,
    lastetOpp: new Date().toISOString(),
    dato: dato || gjettDato(fil.name, tekst),
    tittel: tittel || fil.name.replace(/\.\w+$/, '').replace(/[_-]+/g, ' ').trim(),
    kategori: kategori || gjettKategori(fil.name, tekst, mime),
    notat: '',
    tekst,
    koblinger,
    aad: true,
  };
  await store.vault.writeBlob(dok.id, bytes);
  store.db.dokumenter.push(dok);
  store.changed();
  return dok;
}

export async function hentDokument(dok) {
  const bytes = await store.vault.readBlob(dok.id, !!dok.aad);
  return new Blob([bytes], { type: dok.mime });
}

export async function slettDokument(dok) {
  await store.vault.deleteBlob(dok.id);
  const liste = store.db.dokumenter;
  liste.splice(liste.indexOf(dok), 1);
  for (const t of store.db.transaksjoner) if (t.dokumentId === dok.id) delete t.dokumentId;
  store.changed();
}

// Dokumenter koblet til et objekt (transaksjon, formuespost …)
export function dokumenterFor(type, id, transaksjon) {
  return store.db.dokumenter.filter((d) => d.koblinger.some((k) => k.type === type && k.id === id) || (transaksjon && transaksjon.dokumentId === d.id));
}

export function storrelseTekst(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} kB`;
  return `${(b / 1048576).toFixed(1).replace('.', ',')} MB`;
}

// Reklamasjon (forbrukerkjøpsloven: 2 år, 5 år for varer som skal vare vesentlig lenger) og garanti.
const plussAar = (dato, aar) => `${Number(dato.slice(0, 4)) + aar}${dato.slice(4, 10)}`;

export function frister(d) {
  const ut = [];
  if (d.reklamasjon && d.dato) ut.push({ type: 'reklamasjon', navn: `Reklamasjonsfrist (${d.reklamasjon} år)`, til: plussAar(d.dato, d.reklamasjon) });
  if (d.garantiTil) ut.push({ type: 'garanti', navn: 'Garanti', til: d.garantiTil });
  return ut;
}

export function garantier(db, idag = new Date().toISOString().slice(0, 10)) {
  return db.dokumenter
    .flatMap((d) => frister(d).map((f) => ({ ...f, dokument: d, dager: Math.round((Date.parse(f.til) - Date.parse(idag)) / 86400000) })))
    .sort((a, b) => a.til.localeCompare(b.til));
}
