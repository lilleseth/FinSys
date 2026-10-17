// Minimal leser for .xlsx (Excel). Leser lagrede verdier (ikke formler).
// En xlsx-fil er en zip med XML-filer; vi pakker ut med DecompressionStream.

async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Filen er ikke en gyldig Excel-fil (.xlsx).');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Skadet zip-katalog');
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    files.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (name) => files.has(name),
    async text(name) {
      const f = files.get(name);
      if (!f) return null;
      const ln = view.getUint16(f.local + 26, true);
      const le = view.getUint16(f.local + 28, true);
      const start = f.local + 30 + ln + le;
      const data = bytes.subarray(start, start + f.csize);
      let out;
      if (f.method === 0) out = data;
      else if (f.method === 8) {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        out = new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error('Ukjent komprimering i xlsx');
      return new TextDecoder().decode(out);
    },
  };
}

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const kids = (el, tag) => Array.from(el.getElementsByTagName(tag));

function textOf(el) {
  // Rik tekst: flere <t> i <r>-elementer
  return kids(el, 't').map((t) => t.textContent).join('');
}

export function colToNum(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export async function readXlsx(buffer) {
  const zip = await unzip(buffer);
  const wb = parseXml(await zip.text('xl/workbook.xml'));
  const rels = parseXml(await zip.text('xl/_rels/workbook.xml.rels'));
  const relMap = new Map(kids(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  let shared = [];
  if (zip.has('xl/sharedStrings.xml')) {
    shared = kids(parseXml(await zip.text('xl/sharedStrings.xml')), 'si').map(textOf);
  }
  const sheets = new Map();
  for (const s of kids(wb, 'sheet')) {
    const name = s.getAttribute('name');
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap.get(rid) || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    const xml = await zip.text(target);
    if (!xml) continue;
    const cells = new Map();
    let maxRow = 0;
    for (const c of kids(parseXml(xml), 'c')) {
      const ref = c.getAttribute('r');
      const t = c.getAttribute('t');
      const vEl = c.getElementsByTagName('v')[0];
      let v = null;
      if (t === 's') v = vEl ? shared[Number(vEl.textContent)] : null;
      else if (t === 'inlineStr') v = textOf(c.getElementsByTagName('is')[0] || c);
      else if (t === 'str') v = vEl ? vEl.textContent : null;
      else if (t === 'b') v = vEl ? vEl.textContent === '1' : null;
      else if (t === 'e') v = null;
      else v = vEl && vEl.textContent !== '' ? Number(vEl.textContent) : null;
      if (v === null || v === '') continue;
      cells.set(ref, v);
      const row = Number(ref.replace(/^[A-Z]+/, ''));
      if (row > maxRow) maxRow = row;
    }
    sheets.set(name, { name, cells, maxRow });
  }
  return {
    names: [...sheets.keys()],
    has: (n) => sheets.has(n),
    sheet: (n) => sheets.get(n),
    get: (n, ref) => sheets.get(n)?.cells.get(ref) ?? null,
  };
}

// Excel-serienummer -> ISO-dato (YYYY-MM-DD)
export function excelDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    const n = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (n) return `${n[3]}-${n[2].padStart(2, '0')}-${n[1].padStart(2, '0')}`;
    return null;
  }
  const ms = Math.round((v - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}
