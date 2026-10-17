// Små hjelpefunksjoner: id-er, formatering og DOM.

export function uid() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

const krFmt = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const krFmt2 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat('nb-NO', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const kr = (v, des = false) => (v == null || Number.isNaN(v) ? '–' : (des ? krFmt2 : krFmt).format(v).replace(/−/g, '−'));
export const krs = (v) => (v == null ? '–' : kr(v) + ' kr');
export const pct = (v) => (v == null || !Number.isFinite(v) ? '–' : pctFmt.format(v));
export const signert = (v) => (v == null ? '–' : (v > 0 ? '+' : '') + kr(v));

export function kompakt(v) {
  if (v == null) return '–';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + (a / 1e6).toLocaleString('nb-NO', { maximumFractionDigits: 1 }) + ' mill';
  if (a >= 1e3) return s + Math.round(a / 1e3).toLocaleString('nb-NO') + 'k';
  return s + Math.round(a);
}

export function datoNo(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Leser et beløp skrevet på norsk («1 234,50», «-1.234,5»).
export function lesBelop(s) {
  if (typeof s === 'number') return s;
  let t = String(s || '').trim().replace(/\s| /g, '').replace(/kr$/i, '').replace(/−/g, '-');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Lag DOM-element: h('div.klasse#id', {attr}, barn...)
export function h(tag, attrs, ...children) {
  const [, name, rest] = tag.match(/^([a-z0-9-]+)(.*)$/i) || [null, 'div', ''];
  const el = document.createElement(name);
  for (const m of rest.matchAll(/([.#])([^.#]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]);
    else el.id = m[2];
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function lastNed(filnavn, innhold, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([innhold], { type }));
  const a = h('a', { href: url, download: filnavn });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
