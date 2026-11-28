// Service Worker: App-Dateien offline verfügbar, Kursdaten immer frisch aus dem Netz
const VERSION = 'tradeview-80e193d0';
const SHELL = ['./', 'index.html', 'app.js?v=80e193d0', 'style.css?v=__BUILD__', 'catalog.json',
  'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isData = url.pathname.includes('/data/') || url.pathname.endsWith('catalog.json');
  if (isData || e.request.mode === 'navigate') {
    // Netz zuerst, bei Offline Cache
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(stripKey(e.request), copy)); }
      return res;
    }).catch(() => caches.match(stripKey(e.request)).then((r) => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
// Cache-Schlüssel ohne wechselnde Parameter (?t=…), damit Offline-Daten gefunden werden
function stripKey(req) {
  const u = new URL(req.url);
  if (u.pathname.includes('/data/')) u.search = '';
  return u.toString();
}
