// Enkle, tilgjengelige SVG-grafer: linje, grupperte søyler og liggende stolper.
// Farger kommer fra CSS-variabler (--series-1 osv.), så lys/mørk modus følger temaet.

import { h, kompakt, kr } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids) if (c != null) el.append(c);
  return el;
};

export function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

// Aksetekst med nok presisjon til at nabotikker blir forskjellige.
function akseTekst(v, ticks) {
  const steg = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : Math.abs(v);
  const maks = Math.max(...ticks.map(Math.abs));
  if (maks >= 1e6 && steg >= 1e5) return kompakt(v);
  if (maks >= 1e6 && steg >= 1e4) return (v / 1e6).toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace('-', '−') + ' mill';
  if (steg >= 1e3) return Math.round(v / 1e3).toLocaleString('nb-NO').replace('-', '−') + 'k';
  return Math.round(v).toLocaleString('nb-NO').replace('-', '−');
}

function ramme(hoyde) {
  const wrap = h('div.graf');
  const tip = h('div.graf-tip', { role: 'tooltip' });
  wrap.append(tip);
  return { wrap, tip, hoyde };
}

function visTip(tip, wrap, x, y, innhold) {
  tip.replaceChildren(...innhold);
  tip.classList.add('vis');
  const w = wrap.clientWidth;
  const tw = tip.offsetWidth;
  let left = x + 12;
  if (left + tw > w) left = x - tw - 12;
  tip.style.left = Math.max(0, left) + 'px';
  tip.style.top = Math.max(0, y - 10) + 'px';
}

function tipRad(farge, tekst, verdi) {
  return h('div.tip-rad', farge ? h('span.tip-nokkel', { style: `background:${farge}` }) : null, h('span', tekst), h('strong', verdi));
}

// Linjegraf over tid. punkter: [{dato:'YYYY-MM-DD', verdi, etikett}]
export function linjegraf({ punkter, hoyde = 220, format = kr, serieNavn = '' }) {
  const { wrap, tip } = ramme(hoyde);
  if (!punkter.length) { wrap.append(h('p.graf-tom', 'Ingen data ennå.')); return wrap; }
  const tegn = () => {
    wrap.querySelector('svg')?.remove();
    const W = Math.max(wrap.clientWidth || 600, 280);
    const m = { t: 12, r: 16, b: 28, l: 56 };
    const iw = W - m.l - m.r;
    const ih = hoyde - m.t - m.b;
    const ts = punkter.map((p) => Date.parse(p.dato));
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const vals = punkter.map((p) => p.verdi);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals), 4);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const X = (t) => m.l + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
    const Y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const svg = s('svg', { width: W, height: hoyde, viewBox: `0 0 ${W} ${hoyde}`, role: 'img', 'aria-label': serieNavn });
    for (const tv of ticks) {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(tv), y2: Y(tv), class: 'grid' }));
      svg.append(s('text', { x: m.l - 8, y: Y(tv) + 4, 'text-anchor': 'end', class: 'akse' }, akseTekst(tv, ticks)));
    }
    punkter.forEach((p, i) => {
      if (punkter.length <= 12 || i === 0 || i === punkter.length - 1) {
        svg.append(s('text', { x: X(ts[i]), y: hoyde - 8, 'text-anchor': 'middle', class: 'akse' }, p.etikett || p.dato.slice(0, 7)));
      }
    });
    const d = punkter.map((p, i) => `${i ? 'L' : 'M'}${X(ts[i]).toFixed(1)},${Y(p.verdi).toFixed(1)}`).join('');
    const area = `${d}L${X(ts[ts.length - 1]).toFixed(1)},${m.t + ih}L${X(ts[0]).toFixed(1)},${m.t + ih}Z`;
    svg.append(s('path', { d: area, class: 'omrade s1' }));
    svg.append(s('path', { d, class: 'linje s1' }));
    const sistI = punkter.length - 1;
    svg.append(s('circle', { cx: X(ts[sistI]), cy: Y(punkter[sistI].verdi), r: 4, class: 'punkt s1' }));
    const kryss = s('line', { y1: m.t, y2: m.t + ih, class: 'kryss', visibility: 'hidden' });
    const mark = s('circle', { r: 5, class: 'punkt s1', visibility: 'hidden' });
    svg.append(kryss, mark);
    const flate = s('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' });
    const flytt = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      let best = 0;
      ts.forEach((t, i) => { if (Math.abs(X(t) - px) < Math.abs(X(ts[best]) - px)) best = i; });
      const p = punkter[best];
      const cx = X(ts[best]);
      kryss.setAttribute('x1', cx); kryss.setAttribute('x2', cx); kryss.setAttribute('visibility', 'visible');
      mark.setAttribute('cx', cx); mark.setAttribute('cy', Y(p.verdi)); mark.setAttribute('visibility', 'visible');
      visTip(tip, wrap, cx, Y(p.verdi), [h('div.tip-tittel', p.etikett || p.dato), tipRad(null, serieNavn, format(p.verdi))]);
    };
    flate.addEventListener('pointermove', flytt);
    flate.addEventListener('pointerdown', flytt);
    flate.addEventListener('pointerleave', () => { tip.classList.remove('vis'); kryss.setAttribute('visibility', 'hidden'); mark.setAttribute('visibility', 'hidden'); });
    svg.append(flate);
    wrap.prepend(svg);
  };
  observer(wrap, tegn);
  return wrap;
}

// Grupperte søyler. kategorier: ['jan', ...]; serier: [{navn, verdier:[...], klasse:'s1'}]
export function soylegraf({ kategorier, serier, hoyde = 240, format = kr, titler }) {
  const { wrap, tip } = ramme(hoyde);
  const legende = h('div.legende', serier.map((sr) => h('span.legende-del', h('span.legende-nokkel', { class: sr.klasse }), sr.navn)));
  const tegn = () => {
    wrap.querySelector('svg')?.remove();
    const W = Math.max(wrap.clientWidth || 600, 280);
    const m = { t: 12, r: 8, b: 28, l: 52 };
    const iw = W - m.l - m.r;
    const ih = hoyde - m.t - m.b;
    const alle = serier.flatMap((sr) => sr.verdier.filter((v) => v != null));
    const ticks = niceTicks(Math.min(0, ...alle), Math.max(0, ...alle), 4);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const Y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const band = iw / kategorier.length;
    const gap = 2;
    const bw = Math.min(24, (band * 0.7 - gap * (serier.length - 1)) / serier.length);
    const svg = s('svg', { width: W, height: hoyde, viewBox: `0 0 ${W} ${hoyde}`, role: 'img' });
    for (const tv of ticks) {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(tv), y2: Y(tv), class: tv === 0 ? 'baseline' : 'grid' }));
      svg.append(s('text', { x: m.l - 8, y: Y(tv) + 4, 'text-anchor': 'end', class: 'akse' }, akseTekst(tv, ticks)));
    }
    kategorier.forEach((kat, i) => {
      const cx = m.l + band * i + band / 2;
      const gruppeW = bw * serier.length + gap * (serier.length - 1);
      svg.append(s('text', { x: cx, y: hoyde - 8, 'text-anchor': 'middle', class: 'akse' }, kat));
      serier.forEach((sr, j) => {
        const v = sr.verdier[i];
        if (v == null || v === 0) return;
        const x = cx - gruppeW / 2 + j * (bw + gap);
        const yTop = Y(Math.max(v, 0));
        const yBot = Y(Math.min(v, 0));
        svg.append(s('path', { d: soylePath(x, yTop, bw, yBot - yTop, v >= 0), class: `soyle ${sr.klasse}` }));
      });
      const hit = s('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent' });
      const vis = () => {
        visTip(tip, wrap, cx, m.t + 10, [
          h('div.tip-tittel', titler ? titler[i] : kat),
          ...serier.map((sr) => tipRad(`var(--${sr.klasse === 's2' ? 'series-2' : sr.klasse === 's3' ? 'series-3' : 'series-1'})`, sr.navn, format(sr.verdier[i]))),
        ]);
        hit.setAttribute('class', 'hover-band');
      };
      hit.addEventListener('pointerenter', vis);
      hit.addEventListener('pointerdown', vis);
      hit.addEventListener('pointerleave', () => { tip.classList.remove('vis'); hit.removeAttribute('class'); });
      svg.append(hit);
    });
    wrap.prepend(svg);
  };
  observer(wrap, tegn);
  return h('div', legende, wrap);
}

// Søyle med 4px avrundet ende, flat mot nullinjen.
function soylePath(x, y, w, hgt, opp) {
  const r = Math.min(4, w / 2, hgt);
  if (hgt <= 0) return '';
  if (opp) {
    return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
  }
  return `M${x},${y}V${y + hgt - r}Q${x},${y + hgt} ${x + r},${y + hgt}H${x + w - r}Q${x + w},${y + hgt} ${x + w},${y + hgt - r}V${y}Z`;
}

// Liggende stolper (HTML). elementer: [{etikett, verdi, undertekst, onclick}]
export function stolpeliste({ elementer, format = kr, total, visAndel = true }) {
  const max = Math.max(...elementer.map((e) => Math.abs(e.verdi)), 1);
  const sumAlle = total ?? elementer.reduce((a, e) => a + Math.abs(e.verdi), 0);
  return h('div.stolper', elementer.map((e) => {
    const andel = sumAlle ? Math.abs(e.verdi) / sumAlle : 0;
    return h(e.onclick ? 'button.stolpe-rad' : 'div.stolpe-rad', { type: e.onclick ? 'button' : null, onclick: e.onclick, title: `${e.etikett}: ${format(e.verdi)} (${(andel * 100).toFixed(1).replace('.', ',')} %)` },
      h('span.stolpe-etikett', e.etikett),
      h('span.stolpe-spor', h('span.stolpe', { style: `width:${(Math.abs(e.verdi) / max) * 100}%` })),
      h('span.stolpe-verdi', format(e.verdi), visAndel ? h('small', ` ${(andel * 100).toFixed(0)} %`) : null));
  }));
}

const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => {
  for (const e of entries) e.target.__tegn?.();
}) : null;

function observer(el, tegn) {
  let sist = 0;
  el.__tegn = () => {
    const w = el.clientWidth;
    if (w && Math.abs(w - sist) > 2) { sist = w; tegn(); }
  };
  if (ro) ro.observe(el);
  requestAnimationFrame(() => el.__tegn());
}
