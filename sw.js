// Service worker: gjør FinSys installerbar og lar appen åpnes uten nett.
// Bare appens egne filer (samme opprinnelse) mellomlagres. Dataene hentes fra
// api.github.com og er kryptert – de går aldri gjennom denne mellomlagringen.
// Nett først, slik at nye versjoner alltid tas i bruk når du er på nett.

const CACHE = 'finsys-app-v1';
const SKALL = ['./', 'index.html', 'css/app.css', 'js/main.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SKALL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((navn) => Promise.all(navn.filter((n) => n.startsWith('finsys-') && n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const svar = await fetch(req, { cache: 'no-cache' });
      if (svar.ok && svar.type === 'basic') {
        const kopi = svar.clone();
        caches.open(CACHE).then((c) => c.put(req, kopi)).catch(() => {});
      }
      return svar;
    } catch (feil) {
      const lagret = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (lagret) return lagret;
      if (req.mode === 'navigate') {
        const forside = await caches.match('index.html');
        if (forside) return forside;
      }
      throw feil;
    }
  })());
});
