// Kryptering i nettleseren.
//
// Nøkkelhierarki:
//   datanøkkel (tilfeldig AES-256-GCM) krypterer alle data
//   passord  --PBKDF2-SHA256 600 000--> nøkkel som pakker inn datanøkkelen
//   gjenopprettingsnøkkel --PBKDF2--> nøkkel som pakker inn datanøkkelen (reserve)
// Dermed kan passordet byttes uten å kryptere alt på nytt.
//
// Hver fil krypteres med tilfeldig IV og filstien som «additional data», slik at
// krypterte filer ikke kan byttes om mellom stier uten at det oppdages.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_ITERATIONS = 600000;
export const KDF_ITERATIONS_GJENOPPRETTING = 100000; // nøkkelen har 160 bit tilfeldighet

export function toB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(b64) {
  const s = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function pbkdf2(password, saltB64, iterations, algoritme, extractable, bruk) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    base,
    algoritme,
    extractable,
    bruk
  );
}

// Format 1 (eldre hvelv): datanøkkelen er avledet direkte fra passordet.
export function deriveKey(password, saltB64, iterations = KDF_ITERATIONS, extractable = false) {
  return pbkdf2(password, saltB64, iterations, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

// Nøkkel som bare kan pakke inn / pakke ut datanøkkelen.
export function deriveKek(hemmelighet, saltB64, iterations) {
  return pbkdf2(hemmelighet, saltB64, iterations, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

export function nyDatanokkel() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function pakkInn(kek, datanokkel) {
  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.wrapKey('raw', datanokkel, kek, { name: 'AES-GCM', iv });
  return { iv: toB64(iv), wrapped: toB64(wrapped) };
}

export function pakkUt(kek, { iv, wrapped }, extractable = false) {
  return crypto.subtle.unwrapKey('raw', fromB64(wrapped), kek, { name: 'AES-GCM', iv: fromB64(iv) },
    { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

// Lager en ikke-eksporterbar kopi (brukes i minnet og når nøkkelen huskes på enheten).
export async function ikkeEksporterbar(nokkel) {
  if (!nokkel.extractable) return nokkel;
  const raw = await crypto.subtle.exportKey('raw', nokkel);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Gjenopprettingsnøkkel: 20 tilfeldige byte som 32 tegn (Crockford base32) i grupper på fire.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function nyGjenopprettingsnokkel() {
  const b = randomBytes(20);
  let bits = 0;
  let verdi = 0;
  let s = '';
  for (const x of b) {
    verdi = (verdi << 8) | x;
    bits += 8;
    while (bits >= 5) { s += B32[(verdi >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return s.match(/.{4}/g).join('-');
}

export function normaliserGjenoppretting(s) {
  return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Krypterer bytes. aad (f.eks. filstien) bindes til chifferteksten. Returnerer JSON-konvolutt som tekst.
export async function encryptBytes(key, bytes, aad) {
  const iv = randomBytes(12);
  const packed = await gzip(bytes);
  const param = { name: 'AES-GCM', iv };
  if (aad) param.additionalData = enc.encode(aad);
  const ct = await crypto.subtle.encrypt(param, key, packed);
  return JSON.stringify({ v: 2, z: 1, a: aad ? 1 : 0, iv: toB64(iv), ct: toB64(ct) });
}

export async function decryptBytes(key, envelopeText, aad) {
  const env = JSON.parse(envelopeText);
  if (env.v !== 1 && env.v !== 2) throw new Error('Ukjent filformat');
  const param = { name: 'AES-GCM', iv: fromB64(env.iv) };
  if (env.a) {
    if (!aad) throw new Error('Mangler filsti for dekryptering');
    param.additionalData = enc.encode(aad);
  }
  const plain = new Uint8Array(await crypto.subtle.decrypt(param, key, fromB64(env.ct)));
  return env.z ? gunzip(plain) : plain;
}

export async function encryptText(key, text, aad) {
  return encryptBytes(key, enc.encode(text), aad);
}

export async function decryptText(key, envelopeText, aad) {
  return dec.decode(await decryptBytes(key, envelopeText, aad));
}

// Enkel styrkesjekk for passord. Returnerer feilmelding eller ''.
// ekstraOrd: f.eks. GitHub-brukernavnet, som ikke bør være en del av passordet
export function passordProblem(pw, ekstraOrd = []) {
  if (pw.length < 12) return 'Passordet må ha minst 12 tegn. Tips: bruk en setning med flere ord.';
  const lav = pw.toLowerCase();
  if (/^(.)\1+$/.test(pw)) return 'Passordet kan ikke være samme tegn gjentatt.';
  if (/^\d+$/.test(pw)) return 'Passordet kan ikke bare være tall.';
  for (const ord of ['passord', 'password', 'finsys', '123456', 'qwerty', 'abcdef', ...ekstraOrd.filter((x) => x && x.length >= 4).map((x) => x.toLowerCase())]) {
    if (lav.includes(ord)) return `Passordet bør ikke inneholde «${ord}».`;
  }
  if (new Set(pw).size < 6) return 'Passordet har for få ulike tegn.';
  return '';
}
