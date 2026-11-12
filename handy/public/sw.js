// Hält die Seite für Funklöcher bereit: erst Netz, sonst Zwischenspeicher. Kurse (/api/) nie zwischenspeichern.
const SPEICHER = 'depot-v2';
const SEITE = ['./', 'index.html', 'app.css', 'app.js', 'code.js', 'manifest.webmanifest', 'icons/icon.svg',
  'fonts/newsreader-latin-500-normal.woff2', 'fonts/ibm-plex-sans-latin-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-500-normal.woff2', 'fonts/ibm-plex-sans-latin-600-normal.woff2'];

self.addEventListener('install', e => { e.waitUntil(caches.open(SPEICHER).then(c => c.addAll(SEITE))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(alle => Promise.all(alle.filter(k => k !== SPEICHER).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(antwort => {
    if (antwort.ok) { const kopie = antwort.clone(); caches.open(SPEICHER).then(c => c.put(e.request, kopie)); }
    return antwort;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
