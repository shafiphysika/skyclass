// Offline support. Network first, so a new deploy shows up straight away; the saved copy is used only when offline.
const CACHE = 'skyclass-v5';
const SHELL = ['./', 'index.html', 'style.css', 'core.js', 'sites.js', 'games.js', 'missions.js', 'config.js', 'app.js', 'manifest.webmanifest', 'icon.svg'];
const CDN = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Only the site's own files, the sign-in library and fonts. Never database calls or other sites.
  if (e.request.method !== 'GET' || !(url.origin === location.origin || CDN.includes(url.hostname))) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
