const VERSION = 'abdo-debts-v2';
const STATIC_CACHE = `${VERSION}-static`;
const APP_SHELL = ['/', '/assets/styles.css', '/assets/app.js', '/assets/manifest.webmanifest', '/assets/icons/icon-192.png', '/assets/icons/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(STATIC_CACHE).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(r => { if (r.ok) caches.open(STATIC_CACHE).then(cache => cache.put(e.request, r.clone())); return r; })));
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
