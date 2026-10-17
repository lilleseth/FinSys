// Automatisk kategorisering: egne regler først, deretter læring fra tidligere kategoriserte transaksjoner.

const STOPP = new Set(['as', 'asa', 'nuf', 'ab', 'abp', 'inc', 'ltd', 'norge', 'norway', 'filial', 'og', 'the', 'oslo', 'www', 'com', 'no', 'vipps', 'trumfpay']);

// Normaliserer tekst: små bokstaver, uten tall/referanser og tegnsetting.
export function normaliser(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[*#_]+\d*\**/g, ' ')
    .replace(/\d{4}-\d{2}-\d{2}.*$/, '')
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w && !/\d/.test(w))
    .join(' ')
    .trim();
}

const ord = (s) => s.split(' ').filter((w) => w.length > 1 && !STOPP.has(w));

// Råtekst fra et kort-/bankformat: «BENSINSTASJON SENTRUM | OSLO · Ref 123» -> «BENSINSTASJON SENTRUM»
export function raTekst(t) {
  if (t.ra) return t.ra;
  const d = t.detaljer || '';
  if (d.includes(' · ') || d.includes(' | ')) return d.split(' · ')[0].split(' | ')[0];
  return '';
}

// Bygger en modell fra eksisterende transaksjoner.
export function lagModell(transaksjoner) {
  const profiler = new Map(); // normalisert navn -> { kat: Map(kat->antall), alias: Map(tekst->antall), n }
  const typer = new Map(); // konto|detaljer -> Map(kat->antall)
  const leggTil = (nokkel, t) => {
    if (!nokkel) return;
    let p = profiler.get(nokkel);
    if (!p) { p = { kat: new Map(), alias: new Map(), n: 0, ord: ord(nokkel) }; profiler.set(nokkel, p); }
    p.n++;
    p.kat.set(t.kategori, (p.kat.get(t.kategori) || 0) + 1);
    if (t.tekst) p.alias.set(t.tekst, (p.alias.get(t.tekst) || 0) + 1);
  };
  for (const t of transaksjoner) {
    if (!t.kategori) continue;
    const navn = normaliser(t.tekst);
    const ra = normaliser(raTekst(t));
    leggTil(navn, t);
    if (ra && ra !== navn) leggTil(ra, t);
    const d = t.detaljer || '';
    if (d && !d.includes(' · ') && !d.includes(' | ')) {
      const k = `${t.konto}|${d.toLowerCase()}|${t.belop < 0 ? 'ut' : 'inn'}`;
      if (!typer.has(k)) typer.set(k, new Map());
      typer.get(k).set(t.kategori, (typer.get(k).get(t.kategori) || 0) + 1);
    }
  }
  return { profiler, typer };
}

const flest = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];

function likhet(a, b) {
  if (a === b) return 1;
  const wa = ord(a);
  const wb = ord(b);
  if (!wa.length || !wb.length) return 0;
  const sa = new Set(wa);
  const sb = new Set(wb);
  const felles = wa.filter((w) => sb.has(w)).length;
  // Det ene navnet er helt med i det andre (f.eks. «gjensidige» i «gjensidige forsikring»)
  if (felles === Math.min(sa.size, sb.size) && wa[0] === wb[0]) {
    // Et generisk enkeltord (f.eks. «nordea») mot et lengre navn er svakere enn et fullt treff
    return Math.min(sa.size, sb.size) >= 2 || sa.size === sb.size ? 0.9 : 0.75;
  }
  if (wa[0] === wb[0] && wa[0].length >= 4) return 0.65;
  const j = felles / new Set([...wa, ...wb]).size;
  return j >= 0.5 ? 0.3 + 0.6 * j : 0;
}

// Regel: { id, inneholder, konto?, retning? ('inn'|'ut'), kategori, tekst? }
export function regelTreffer(regel, t) {
  const nal = (regel.inneholder || '').toLowerCase().trim();
  if (!nal) return false;
  const hay = `${t.tekstRa || ''} ${t.tekst || ''} ${t.detaljer || ''}`.toLowerCase();
  if (!hay.includes(nal)) return false;
  if (regel.konto && regel.konto !== t.konto) return false;
  if (regel.retning === 'inn' && t.belop < 0) return false;
  if (regel.retning === 'ut' && t.belop > 0) return false;
  return true;
}

// Vanlige norske brukersteder -> kategori. Brukes når historikken ikke gir treff.
export const NOKKELORD = [
  [/\b(indeks|obligasjon|diverse fonds|fondsspar|aksjefond|rentefond)/i, 'sparing/fondsavtale'],
  [/\b(esso|circle ?k|shell|uno-?x|1-2-3|st1|yx|okq8|preem|best stasjon|tesla|ionity|recharge|mer norway|fortum|kople|drivstoff)/i, 'bil/drivstoff'],
  [/\b(skyttelpass|autopass|autosync|fjellinjen|ferde|bompenger|vegamot)/i, 'bil/bompenger'],
  [/\b(easypark|apcoa|onepark|aimo park|parkering|europark|q-park)/i, 'bil/parkering'],
  [/\b(biltema|mekonomen|bilxtra|dekk|vianor|bilvask|selvvask|eu-kontroll)/i, 'bil/vedlikehold'],
  [/\b(kiwi|rema|meny|coop|extra|obs|joker|spar|bunnpris|lidl|ica|willys|nærbutikken|matkroken|oda)\b/i, 'mat/dagligvarer'],
  [/\b(mcdonald|burger ?king|max burgers|pizza|peppes|kebab|sushi|restaurant|resturant|cafe|kafe|bistro|espresso house|starbucks|kaffebrenneriet|foodora|wolt|just eat|grill|thai|tandoori|pub|bar)\b/i, 'mat/restaurant'],
  [/\b(norwegian|sas|widerøe|wideroe|flytoget|ryanair|lufthansa|klm|hotels?\.com|booking\.com|airbnb|hotel|scandic|thon|nordic choice|clarion|comfort|duty-?free|vy\b|nsb)/i, 'reise/reise'],
  [/\b(apple\.com|icloud|itunes)/i, 'abonnement/apple'],
  [/\b(spotify|netflix|hbo|max\.com|viaplay|disney|tidal|youtube)/i, 'abonnement/musikk'],
  [/\b(openai|chatgpt|anthropic|claude|adobe|microsoft|google|github|lastpass|dropbox)/i, 'abonnement/programvare'],
  [/\b(aftenposten|vg\+|dagens næringsliv|dn\.no|schibsted|amedia)/i, 'abonnement/avis'],
  [/\b(zalando|h&m|hm\.com|dressmann|cubus|carlings|bik bok|jack ?& ?jones|xxl|stadium|boozt)/i, 'personlig/klaer'],
  [/\b(frisør|frisor|barber|cutters|hair)/i, 'personlig/frisor'],
  [/\b(apotek|vitus|boots)/i, 'personlig/helse'],
  [/\b(kino|svensk filmindu|nordisk film|odeon|billett)/i, 'fritid/opplevelser'],
  [/\b(gjensidige|if skadeforsikring|tryg|fremtind|storebrand forsikring)/i, 'forsikring/forsikring'],
  [/\b(lånekassen)/i, 'lan/studielan'],
  [/\b(skatteetaten)/i, 'skatt/restskatt'],
  [/\b(posten|postnord|bring)\b/i, 'diverse/post'],
];

// Foreslår kategori (og pent navn) for en ny transaksjon.
// Returnerer { kategori, tekst?, sikkerhet: 'regel'|'hoy'|'middels'|'lav'|'' , grunn }
export function foreslå(t, modell, regler = []) {
  for (const r of regler) {
    if (regelTreffer(r, t)) return { kategori: r.kategori, tekst: r.tekst || null, sikkerhet: 'regel', grunn: `Regel: «${r.inneholder}»` };
  }
  const kandidater = [normaliser(t.tekstRa), normaliser(t.tekst)].filter(Boolean);
  let best = null;
  for (const k of kandidater) {
    const p = modell.profiler.get(k);
    if (p) { best = { p, score: 1, navn: k }; break; }
  }
  if (!best) {
    for (const k of kandidater) {
      for (const [navn, p] of modell.profiler) {
        const s = likhet(k, navn);
        if (s > (best?.score || 0) || (s === best?.score && p.n > best.p.n)) best = { p, score: s, navn };
      }
    }
  }
  const typeNokkel = `${t.konto}|${(t.detaljer || '').toLowerCase()}|${t.belop < 0 ? 'ut' : 'inn'}`;
  const type = modell.typer.get(typeNokkel);
  const typeBest = type ? flest(type) : null;
  const typeAndel = typeBest ? typeBest[1] / [...type.values()].reduce((a, b) => a + b, 0) : 0;

  const sterkHistorikk = best && best.score >= 0.9;
  if (!sterkHistorikk) {
    const tekst = `${t.tekstRa || ''} ${t.tekst || ''} ${t.detaljer || ''}`;
    const kw = NOKKELORD.find(([re]) => re.test(tekst));
    if (kw) return { kategori: kw[1], tekst: null, sikkerhet: 'lav', grunn: 'Kjent brukersted' };
  }
  if (best && best.score >= 0.6) {
    const [kat, antall] = flest(best.p.kat);
    const andel = antall / best.p.n;
    // Sterk betalingstype (f.eks. «Kontoregulering» = alltid intern overføring) vinner over usikker navnelikhet
    if (typeBest && typeAndel >= 0.95 && typeBest[1] >= (best.score < 0.9 ? 3 : 5) && (best.score < 1 || andel < 0.8) && typeBest[0] !== kat) {
      return { kategori: typeBest[0], tekst: null, sikkerhet: 'hoy', grunn: `Betalingstype «${t.detaljer}»` };
    }
    const alias = best.score >= 0.9 ? flest(best.p.alias)?.[0] : null;
    const sikkerhet = best.score === 1 && andel >= 0.8 && best.p.n >= 2 ? 'hoy' : best.score >= 0.75 && andel >= 0.6 ? 'middels' : 'lav';
    return { kategori: kat, tekst: alias, sikkerhet, grunn: best.score === 1 ? `Samme som tidligere «${best.navn}»` : `Ligner «${best.navn}»` };
  }
  if (typeBest && typeAndel >= 0.9 && typeBest[1] >= 3) {
    return { kategori: typeBest[0], tekst: null, sikkerhet: 'middels', grunn: `Betalingstype «${t.detaljer}»` };
  }
  const valuta = (t.detaljer || '').match(/\b(?!NOK)([A-Z]{3}) @/);
  if (valuta && t.belop < 0) return { kategori: 'reise/reise', tekst: null, sikkerhet: 'lav', grunn: `Betalt i ${valuta[1]}` };
  return { kategori: '', tekst: null, sikkerhet: '', grunn: 'Ingen treff' };
}
