// Eksport til regneark: .xlsx (flere ark) og .csv. Ingen eksterne biblioteker.

import { kategoriIndeks } from './categories.js';
import { verdiPa, HISTORIKK_FELT, EIENDEL_TYPER, GJELD_TYPER, sum } from './calc.js';
import { mndSammendrag, manederMedData } from './report.js';
import { fastePoster } from './recurring.js';

// ---------- ZIP (uten komprimering) ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(filer) {
  const enc = new TextEncoder();
  const deler = [];
  const sentral = [];
  let offset = 0;
  for (const [navn, innhold] of filer) {
    const n = enc.encode(navn);
    const data = typeof innhold === 'string' ? enc.encode(innhold) : innhold;
    const crc = crc32(data);
    const lokal = new DataView(new ArrayBuffer(30));
    lokal.setUint32(0, 0x04034b50, true);
    lokal.setUint16(4, 20, true);
    lokal.setUint16(6, 0x0800, true); // UTF-8-navn
    lokal.setUint16(8, 0, true); // lagret
    lokal.setUint32(14, crc, true);
    lokal.setUint32(18, data.length, true);
    lokal.setUint32(22, data.length, true);
    lokal.setUint16(26, n.length, true);
    deler.push(new Uint8Array(lokal.buffer), n, data);
    const s = new DataView(new ArrayBuffer(46));
    s.setUint32(0, 0x02014b50, true);
    s.setUint16(4, 20, true);
    s.setUint16(6, 20, true);
    s.setUint16(8, 0x0800, true);
    s.setUint32(16, crc, true);
    s.setUint32(20, data.length, true);
    s.setUint32(24, data.length, true);
    s.setUint16(28, n.length, true);
    s.setUint32(42, offset, true);
    sentral.push(new Uint8Array(s.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const sentralStr = sum(sentral.map((x) => x.length));
  const slutt = new DataView(new ArrayBuffer(22));
  slutt.setUint32(0, 0x06054b50, true);
  slutt.setUint16(8, filer.length, true);
  slutt.setUint16(10, filer.length, true);
  slutt.setUint32(12, sentralStr, true);
  slutt.setUint32(16, offset, true);
  return new Blob([...deler, ...sentral, new Uint8Array(slutt.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------- XLSX ----------

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const kol = (i) => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Celle: tall, dato (ÅÅÅÅ-MM-DD) eller tekst. { v, f: 'kr'|'pst' } for formatering.
function celle(v, r, c, header) {
  const ref = `${kol(c)}${r + 1}`;
  if (v == null || v === '') return '';
  if (header) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xml(v)}</t></is></c>`;
  let stil = 0;
  let verdi = v;
  if (typeof v === 'object') { stil = v.f === 'pst' ? 4 : 3; verdi = v.v; if (verdi == null) return ''; }
  if (typeof verdi === 'number' && Number.isFinite(verdi)) return `<c r="${ref}"${stil ? ` s="${stil}"` : ''}><v>${verdi}</v></c>`;
  if (typeof verdi === 'string' && ISO.test(verdi)) return `<c r="${ref}" s="2"><v>${Date.parse(verdi) / 86400000 + 25569}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(verdi)}</t></is></c>`;
}

function ark({ kolonner, rader, bredder }) {
  const alle = [kolonner, ...rader];
  const data = alle.map((rad, r) => `<row r="${r + 1}">${rad.map((v, c) => celle(v, r, c, r === 0)).join('')}</row>`).join('');
  const cols = (bredder || kolonner.map(() => 14)).map((b, i) => `<col min="${i + 1}" max="${i + 1}" width="${b}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${data}</sheetData>${rader.length ? `<autoFilter ref="A1:${kol(kolonner.length - 1)}${rader.length + 1}"/>` : ''}</worksheet>`;
}

export function xlsx(arkListe) {
  const filer = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${arkListe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${arkListe.map((a, i) => `<sheet name="${xml(a.navn.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${arkListe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${arkListe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...arkListe.map((a, i) => [`xl/worksheets/sheet${i + 1}.xml`, ark(a)]),
  ];
  return zip(filer);
}

// ---------- Innhold ----------

const krCelle = (v) => ({ v: v == null ? null : Math.round(v * 100) / 100, f: 'kr' });

export function transaksjonsRader(db, liste = db.transaksjoner) {
  const idx = kategoriIndeks(db.kategorier);
  const konto = new Map(db.kontoer.map((k) => [k.id, k.navn]));
  return [...liste].sort((a, b) => a.dato.localeCompare(b.dato)).map((t) => [
    t.dato, t.betalt || t.dato, konto.get(t.konto) || t.konto, t.tekst, krCelle(t.belop),
    idx.hovedFor(t.kategori)?.navn || '', idx.hent(t.kategori)?.navn || '', t.kategori ? idx.type(t.kategori) : '',
    (t.etiketter || []).join(', '), t.notat || '',
  ]);
}
export const TRANSAKSJON_KOLONNER = ['Kjøpsdato', 'Betalingsdato', 'Konto', 'Tekst', 'Beløp', 'Hovedkategori', 'Underkategori', 'Type', 'Etiketter', 'Notat'];

export function regnearkFraDb(db) {
  const idx = kategoriIndeks(db.kategorier);
  const ark = [];
  ark.push({ navn: 'Transaksjoner', kolonner: TRANSAKSJON_KOLONNER, rader: transaksjonsRader(db), bredder: [11, 11, 18, 36, 12, 18, 22, 10, 16, 30] });

  // Kontantstrøm per måned (betalingsmåned)
  const mnd = manederMedData(db);
  const s = mnd.map((m) => mndSammendrag(db, m, 'betalt', idx));
  const kf = [];
  for (const k of db.kategorier) {
    for (const u of k.under) {
      const verdier = s.map((x) => x.perSub.get(u.id) || 0);
      if (verdier.some((v) => Math.abs(v) >= 0.005)) kf.push([k.navn, u.navn, k.type, ...verdier.map(krCelle), krCelle(sum(verdier))]);
    }
  }
  const ukat = s.map((x) => x.perSub.get('') || 0);
  if (ukat.some(Boolean)) kf.push(['Ukategorisert', '', 'utgift', ...ukat.map(krCelle), krCelle(sum(ukat))]);
  kf.push([], ['Sum inntekter', '', '', ...s.map((x) => krCelle(x.inntekt)), krCelle(sum(s.map((x) => x.inntekt)))],
    ['Sum forbruk', '', '', ...s.map((x) => krCelle(x.utgift)), krCelle(sum(s.map((x) => x.utgift)))],
    ['Netto kontantstrøm', '', '', ...s.map((x) => krCelle(x.netto)), krCelle(sum(s.map((x) => x.netto)))],
    ['Sparerate', '', '', ...s.map((x) => ({ v: x.sparerate, f: 'pst' }))]);
  ark.push({ navn: 'Kontantstrøm', kolonner: ['Hovedkategori', 'Underkategori', 'Type', ...mnd, 'Sum'], rader: kf, bredder: [20, 26, 9, ...mnd.map(() => 11), 12] });

  // Formue nå
  ark.push({ navn: 'Formue', kolonner: ['Post', 'Side', 'Type', 'Gruppe', 'Verdi', 'Dato', 'Rente'], bredder: [32, 9, 22, 22, 14, 11, 8],
    rader: db.formue.poster.map((p) => { const v = verdiPa(p); return [p.navn, p.side, (p.side === 'gjeld' ? GJELD_TYPER : EIENDEL_TYPER)[p.type] || p.type, p.gruppe || '', krCelle(v?.verdi), v?.dato || '', p.rente != null ? { v: p.rente, f: 'pst' } : '']; }) });
  // Alle registrerte verdier
  ark.push({ navn: 'Verdihistorikk', kolonner: ['Post', 'Side', 'Dato', 'Verdi', 'Kilde'], bredder: [32, 9, 11, 14, 30],
    rader: db.formue.poster.flatMap((p) => (p.verdier || []).map((v) => [p.navn, p.side, v.dato, krCelle(v.verdi), v.kilde || ''])).sort((a, b) => String(a[2]).localeCompare(String(b[2]))) });
  // Formueshistorikk (frosne måneder)
  ark.push({ navn: 'Formueshistorikk', kolonner: ['Dato', ...HISTORIKK_FELT.map(([, n]) => n), 'Nettoformue'], bredder: [11, ...HISTORIKK_FELT.map(() => 13), 14],
    rader: (db.formue.historikk || []).slice().sort((a, b) => a.dato.localeCompare(b.dato)).map((x) => [x.dato, ...HISTORIKK_FELT.map(([f]) => krCelle(x.grupper?.[f])), krCelle(x.nettoformue)]) });
  // Budsjett
  const bud = Object.entries(db.budsjett?.poster || {});
  if (bud.length) ark.push({ navn: 'Budsjett', kolonner: ['Kategori', 'Budsjett per måned'], bredder: [30, 18], rader: bud.map(([id, b]) => [idx.hent(id)?.navn || idx.hoved.get(id)?.navn || id, krCelle(b)]) });
  // Faste poster
  const faste = fastePoster(db);
  if (faste.length) ark.push({ navn: 'Faste poster', kolonner: ['Navn', 'Kategori', 'Type', 'Hver n. måned', 'Beløp', 'Per måned', 'Per år', 'Sist', 'Neste', 'Stoppet'], bredder: [30, 24, 9, 12, 12, 12, 12, 11, 11, 9],
    rader: faste.map((p) => [p.navn, idx.hent(p.kategori)?.navn || '', p.type, p.intervall, krCelle(p.belop), krCelle(p.perMnd), krCelle(p.perAar), p.sist, p.neste, p.stoppet ? 'ja' : '']) });
  // Lønnsslipper
  const felt = [['fastlonn', 'Fastlønn'], ['overtid50', 'Overtid 50 %'], ['overtid100', 'Overtid 100 %'], ['engang', 'Engangsposter'], ['andreTillegg', 'Andre tillegg/trekk'], ['brutto', 'Bruttolønn'], ['skattetrekk', 'Skattetrekk'], ['trekkfrie', 'Trekkfrie tillegg'], ['netto', 'Utbetalt']];
  const slipper = db.inntekt?.lonnsslipper || [];
  if (slipper.length) ark.push({ navn: 'Lønnsslipper', kolonner: ['Måned', 'Arbeidsgiver', ...felt.map(([, n]) => n)], bredder: [9, 22, ...felt.map(() => 13)],
    rader: slipper.slice().sort((a, b) => a.mnd.localeCompare(b.mnd)).map((l) => [l.mnd, l.arbeidsgiver || '', ...felt.map(([f]) => krCelle(l[f]))]) });
  return ark;
}

// CSV med semikolon og desimalkomma (åpnes riktig i norsk Excel)
export function csv(kolonner, rader) {
  const fmt = (v) => {
    if (v && typeof v === 'object') v = v.v;
    if (v == null) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [kolonner, ...rader].map((r) => r.map(fmt).join(';')).join('\r\n') + '\r\n';
}
