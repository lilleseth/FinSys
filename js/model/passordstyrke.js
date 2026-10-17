// Passordstyrke uten eksterne biblioteker. Estimerer hvor mange gjett en angriper trenger ved å finne
// den «billigste» oppdelingen av passordet i kjente mønstre (vanlige passord, navn, ord, årstall, datoer,
// rekkefølger, tastaturrekker, gjentakelser), ellers tilfeldige tegn. Inspirert av zxcvbn.
// Tid regnes for FinSys-krypteringen: PBKDF2-SHA256 med 600 000 runder ≈ 15 000 gjett i sekundet
// på ett kraftig grafikkort (RTX 4090-klassen).

import { ORD } from './ordliste.js';

export const GJETT_PER_SEK_GPU = 15000;

// Vanlige passord, navn og ord, omtrent sortert etter hvor ofte de brukes
const VANLIGE = `
i og er det pa som en til av for med at har ikke de jeg du vi han hun seg var den et ei kan vil skal
dere meg deg min mitt mine din ditt sin hjem tur ga se ser bor heter liker elsker hus bil bat sol dag natt
123456 passord password 12345678 qwerty 123456789 12345 1234 111111 1234567 dragon 123123 baseball abc123
football monkey letmein 696969 shadow master 666666 qwertyuiop 123321 mustang 1234567890 michael 654321
superman 1qaz2wsx 7777777 121212 000000 qazwsx 123qwe killer trustno1 jordan jennifer zxcvbnm asdfgh hunter
buster soccer harley batman andrew tigger sunshine iloveyou 2000 charlie robert thomas hockey ranger daniel
starwars klaster 112233 george computer michelle jessica pepper 1111 zxcvbn 555555 11111111 131313 freedom
777777 pass maggie 159753 aaaaaa ginger princess joshua cheese amanda summer love ashley nicole chelsea
biteme matthew access yankees 987654321 dallas austin thunder taylor matrix minecraft pokemon welcome
admin hemmelig sommer vinter host var norge oslo bergen trondheim stavanger tromso drammen kristiansand
rosenborg brann molde valerenga lillestrom fotball kjaereste kjaerlighet elskerdeg velkommen hallo heisann
hei familie mamma pappa bestemor bestefar hunden katten bamse solskinn julenissen jul paske syttendemai
glad trygg sterk hjemme hytta penger lykke kaffe sjokolade pizza changeme secret test testing default
ola kari per anne lars nina emma nora jakob emil noah oliver william lucas filip sofie ingrid sara thea maja
elias henrik magnus martin andreas kristian thomas marius jonas sander tobias mathias daniel markus sebastian
alexander johannes erik hans ole knut jan bjorn geir tor arne svein trond espen morten eirik kjetil stian
christian camilla ida julie marte hanne silje linn kristine maria marianne heidi hilde ingvild siri tone line
lene elisabeth ragnhild astrid solveig liv randi inger hansen johansen olsen larsen andersen pedersen nilsen
kristiansen jensen karlsen johnsen pettersen eriksen berg haugen hagen johannessen andreassen jacobsen dahl
jorgensen halvorsen henriksen lund sorensen jakobsen moen gundersen iversen strand solberg svendsen eide
knutsen martinsen paulsen bakken kristoffersen mathisen lie amundsen rasmussen lunde solheim berge moe nygard
bakke kristensen fredriksen holm lien hauge christensen andresen nielsen knudsen evensen saether aas myhre
januar februar mars april mai juni juli august september oktober november desember mandag tirsdag onsdag
torsdag fredag lordag sondag rod bla gronn gul svart hvit rosa lilla oransje brun gra
`.trim().split(/\s+/);

const RANG = new Map();
VANLIGE.forEach((w, i) => { if (!RANG.has(w)) RANG.set(w, i + 1); });
const ORDSETT = new Set(ORD);

const LEET = { 4: 'a', '@': 'a', 3: 'e', 1: 'i', '!': 'i', 0: 'o', 5: 's', $: 's', 7: 't', '+': 't', 8: 'b', 9: 'g' };
const normaliser = (s) => s.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a');
const bokstav = (c) => /\p{L}/u.test(c);

function kardinalitet(c) {
  if (/[a-z]/.test(c)) return 26;
  if (/[A-Z]/.test(c)) return 26;
  if (/[0-9]/.test(c)) return 10;
  if (/[æøåÆØÅ]/.test(c)) return 26;
  if (/[-_. ]/.test(c)) return 4; // vanlige skilletegn mellom ord prøves først
  if (/[\x20-\x7e]/.test(c)) return 33;
  return 100;
}

function nCr(n, k) {
  if (k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

// Hvor mange varianter av store/små bokstaver en angriper må prøve
function storeBokstaver(ord) {
  const store = [...ord].filter((c) => c !== c.toLowerCase()).length;
  const sma = [...ord].filter((c) => c !== c.toUpperCase()).length;
  if (!store) return 1;
  if (!sma || (store === 1 && ord[0] !== ord[0].toLowerCase())) return 2;
  let sum = 0;
  for (let k = 1; k <= Math.min(store, sma); k++) sum += nCr(store + sma, k);
  return sum;
}

const RADER = ['1234567890+', 'qwertyuiopå', 'asdfghjkløæ', 'zxcvbnm,.-'];

function finnMonstre(pw, ekstraOrd) {
  const n = pw.length;
  const m = [];
  const ekstra = new Set(ekstraOrd.filter((x) => x && x.length >= 3).map(normaliser));
  const aar = new Date().getFullYear();

  // Ord og vanlige passord (også med «leetspeak» og store bokstaver)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j <= Math.min(n, i + 24); j++) {
      const raa = pw.slice(i, j);
      let antLeet = 0;
      // «Leetspeak» tolkes bare i litt lengre biter, ellers blir tilfeldige tegn feilaktig til ord
      const deleet = raa.length < 4 ? raa : [...raa].map((c) => { if (LEET[c] && !bokstav(c)) { antLeet++; return LEET[c]; } return c; }).join('');
      const ord = normaliser(deleet);
      if (!/^[a-z]+$/.test(ord) && !RANG.has(ord)) continue;
      const faktor = storeBokstaver(raa) * (antLeet ? 2 ** antLeet : 1);
      if (ekstra.has(ord)) m.push({ i, j, gjett: 10 * faktor, type: 'brukernavn' });
      // Korte ord (i, og, på) teller bare når de står alene, ikke midt i en tilfeldig tegnrekke
      const alene = (i === 0 || !bokstav(pw[i - 1])) && (j === n || !bokstav(pw[j]));
      if (RANG.has(ord) && (ord.length >= 4 || alene)) m.push({ i, j, gjett: RANG.get(ord) * faktor, type: 'vanlig', leet: antLeet > 0 });
      if (ORDSETT.has(ord) && ord.length >= 3) m.push({ i, j, gjett: ORD.length * faktor, type: 'ord', leet: antLeet > 0 });
      const baklengs = [...ord].reverse().join('');
      if (RANG.has(baklengs) && ord.length >= 4) m.push({ i, j, gjett: RANG.get(baklengs) * faktor * 2, type: 'vanlig' });
    }
  }

  // Ordlignende bokstavrekker (uttalbare) – kan stå i en angripers ordbok
  for (const t of pw.matchAll(/\p{L}{3,}/gu)) {
    const ord = normaliser(t[0]);
    const vokaler = (ord.match(/[aeiouy]/g) || []).length;
    const maksKons = Math.max(0, ...(ord.match(/[^aeiouy]+/g) || []).map((x) => x.length));
    if (vokaler / ord.length >= 0.2 && maksKons <= 3) {
      m.push({ i: t.index, j: t.index + t[0].length, gjett: 20000 ** Math.ceil(ord.length / 10) * storeBokstaver(t[0]), type: 'ordlignende' });
    }
  }

  // Årstall og datoer
  for (const t of pw.matchAll(/(19|20)\d\d/g)) {
    m.push({ i: t.index, j: t.index + 4, gjett: Math.max(20, Math.abs(Number(t[0]) - aar)), type: 'aarstall' });
  }
  for (const t of pw.matchAll(/(?=(\d{1,2}[./-]?\d{1,2}[./-]?(?:\d{4}|\d{2})))/g)) {
    const s = t[1];
    const d = s.replace(/[./-]/g, '');
    if (d.length >= 4 && d.length <= 8) m.push({ i: t.index, j: t.index + s.length, gjett: 365 * 100 * (s.length > d.length ? 4 : 1), type: 'dato' });
  }

  // Rekkefølger (abc, 123, 987) og tastaturrekker (qwer, asdf)
  for (let i = 0; i < n - 2; i++) {
    for (const retning of [1, -1]) {
      let j = i + 1;
      while (j < n && pw.charCodeAt(j) - pw.charCodeAt(j - 1) === retning && /[a-z0-9]/i.test(pw[j])) j++;
      if (j - i >= 3) {
        const start = pw[i].toLowerCase();
        const base = ['a', '1', '0', 'z', '9'].includes(start) ? 4 : /\d/.test(start) ? 10 : 26;
        m.push({ i, j, gjett: base * (j - i) * (retning < 0 ? 2 : 1), type: 'rekkefolge' });
      }
    }
    for (const rad of RADER) {
      for (const retning of [1, -1]) {
        let j = i;
        let pos = rad.indexOf(pw[i].toLowerCase());
        if (pos < 0) continue;
        while (j + 1 < n && rad.indexOf(pw[j + 1].toLowerCase()) === pos + retning) { j++; pos += retning; }
        if (j + 1 - i >= 4) m.push({ i, j: j + 1, gjett: RADER.length * 11 * (j + 1 - i) * 2, type: 'tastatur' });
      }
    }
  }

  // Gjentakelser (aaaa, abcabc)
  for (const t of pw.matchAll(/(.+?)\1+/g)) {
    const del = t[1];
    const antall = t[0].length / del.length;
    if (t[0].length >= 3) m.push({ i: t.index, j: t.index + t[0].length, gjett: Math.max(1, estimer(del).gjett) * antall, type: 'gjentakelse' });
  }
  return m;
}

// Billigste oppdeling (dynamisk programmering i log-rom)
function estimer(pw, ekstraOrd = []) {
  const n = pw.length;
  if (!n) return { gjett: 1, deler: [] };
  const monstre = finnMonstre(pw, ekstraOrd);
  const best = Array(n + 1).fill(Infinity);
  const fra = Array(n + 1).fill(null);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    // Et skilletegn som er brukt før (f.eks. mellom ord) koster nesten ingenting å gjette
    const c = pw[j - 1];
    const gjentattSkille = /[^\p{L}\p{N}]/u.test(c) && pw.slice(0, j - 1).includes(c);
    const brute = best[j - 1] + (gjentattSkille ? 0 : Math.log2(kardinalitet(c)));
    if (brute < best[j]) { best[j] = brute; fra[j] = { i: j - 1, j, type: 'tilfeldig' }; }
    for (const mo of monstre) {
      if (mo.j !== j) continue;
      const v = best[mo.i] + Math.log2(mo.gjett);
      if (v < best[j]) { best[j] = v; fra[j] = mo; }
    }
  }
  const deler = [];
  for (let j = n; j > 0;) { const d = fra[j]; deler.unshift({ ...d, tekst: pw.slice(d.i, d.j) }); j = d.i; }
  return { gjett: 2 ** best[n], bits: best[n], deler };
}

export function tidTekst(sek) {
  const enheter = [[60, 'sekund', 'sekunder'], [60, 'minutt', 'minutter'], [24, 'time', 'timer'], [365.25, 'dag', 'dager']];
  if (sek < 1) return 'under ett sekund';
  let v = sek;
  for (const [delt, en, flere] of enheter) {
    if (v < delt) { const r = Math.round(v); return `${r} ${r === 1 ? en : flere}`; }
    v /= delt;
  }
  if (v < 1000) { const r = Math.round(v); return `${r} år`; }
  if (v < 1e6) return `${Math.round(v / 1000)} 000 år`;
  if (v < 1e9) return `${Math.round(v / 1e6)} millioner år`;
  if (v < 1.4e10) return `${Math.round(v / 1e9)} milliarder år`;
  return 'lenger enn universets alder';
}

export const NIVAA = ['Svakt', 'Middels', 'Sterkt', 'Svært sterkt'];

export function styrke(pw, ekstraOrd = []) {
  const e = estimer(pw, ekstraOrd);
  const bits = e.bits ?? 0;
  const nivaa = bits < 40 ? 0 : bits < 52 ? 1 : bits < 64 ? 2 : 3;
  const typer = new Set(e.deler.map((d) => d.type));
  const tips = [];
  if (typer.has('brukernavn')) tips.push('Ikke bruk brukernavnet ditt i passordet.');
  if (typer.has('vanlig')) tips.push('Unngå vanlige passord, navn og ord som andre også bruker.');
  if (typer.has('aarstall') || typer.has('dato')) tips.push('Unngå årstall og datoer – de er blant det første som prøves.');
  if (typer.has('rekkefolge') || typer.has('tastatur')) tips.push('Unngå rekkefølger som abc, 123 og qwerty.');
  if (typer.has('gjentakelse')) tips.push('Unngå gjentakelser som aaa eller abcabc.');
  if (e.deler.some((d) => d.leet)) tips.push('Å bytte bokstaver med tall eller tegn (a→@, o→0) hjelper lite.');
  if (nivaa < 2 && (typer.has('ord') || typer.has('ordlignende'))) tips.push('Legg til ett eller to tilfeldige ord til – lengde gir mest styrke.');
  if (nivaa < 2 && !tips.length) tips.push('Gjør passordet lengre, f.eks. 5–6 tilfeldige ord.');
  if (pw.includes(' ') && e.deler.filter((d) => d.type === 'ordlignende' || d.type === 'vanlig').length >= 4) tips.push('Unngå kjente sitater, ordtak og sangtekster – velg ord som ikke henger sammen.');
  return {
    bits, gjett: e.gjett, nivaa, navn: NIVAA[nivaa], deler: e.deler,
    tips: nivaa >= 2 ? tips.filter((t) => t.startsWith('Ikke bruk brukernavnet')) : tips,
    tidEn: tidTekst(e.gjett / GJETT_PER_SEK_GPU),
    tidTusen: tidTekst(e.gjett / (GJETT_PER_SEK_GPU * 1000)),
  };
}

// Tilfeldig passordsetning fra ordlisten (uten skjevhet i trekningen)
export function foreslaPassord(antallOrd = 6, skille = '-') {
  const n = ORD.length;
  const grense = Math.floor(0x100000000 / n) * n;
  const ord = [];
  const buf = new Uint32Array(1);
  while (ord.length < antallOrd) {
    crypto.getRandomValues(buf);
    if (buf[0] < grense) ord.push(ORD[buf[0] % n]);
  }
  return { passord: ord.join(skille), bits: antallOrd * Math.log2(n) };
}
