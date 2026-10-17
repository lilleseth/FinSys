// Leser tekst fra PDF med pdf.js (lastes først når den trengs) og bygger linjer.
// Kolonner skilles med to eller flere mellomrom, omtrent som «pdftotext -layout».

let pdfjs;

async function last() {
  if (!pdfjs) {
    pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

export async function pdfLinjer(buffer) {
  const lib = await last();
  const doc = await lib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
  }).promise;
  const linjer = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const innhold = await page.getTextContent();
    const rader = [];
    for (const it of innhold.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const fs = Math.hypot(it.transform[2], it.transform[3]) || 10;
      let rad = rader.find((r) => Math.abs(r.y - y) < Math.max(2, fs * 0.3));
      if (!rad) { rad = { y, deler: [] }; rader.push(rad); }
      rad.deler.push({ x, slutt: x + (it.width || it.str.length * fs * 0.5), str: it.str, fs });
    }
    rader.sort((a, b) => b.y - a.y);
    for (const r of rader) {
      r.deler.sort((a, b) => a.x - b.x);
      let s = '';
      let forrige = null;
      for (const d of r.deler) {
        if (forrige) {
          const gap = d.x - forrige.slutt;
          if (gap > d.fs * 0.9) s += '   ';
          else if (gap > d.fs * 0.12 && !s.endsWith(' ') && !d.str.startsWith(' ')) s += ' ';
        }
        s += d.str;
        forrige = d;
      }
      linjer.push(s.replace(/\s+$/, ''));
    }
    linjer.push('');
  }
  await doc.destroy();
  return linjer;
}

// Tegner de første sidene av en PDF som bilder (forhåndsvisning).
export async function pdfSider(buffer, maksSider = 3, bredde = 700) {
  const lib = await last();
  const doc = await lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, enableXfa: false }).promise;
  const lerreter = [];
  for (let p = 1; p <= Math.min(doc.numPages, maksSider); p++) {
    const page = await doc.getPage(p);
    const v0 = page.getViewport({ scale: 1 });
    const skala = (bredde / v0.width) * (window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: skala });
    const c = document.createElement('canvas');
    c.width = vp.width;
    c.height = vp.height;
    c.className = 'pdf-side';
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    lerreter.push(c);
  }
  const antall = doc.numPages;
  await doc.destroy();
  return { lerreter, antall };
}
