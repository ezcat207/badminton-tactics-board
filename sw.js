const CACHE = 'badminton-tactics-v0.27.5';
const FILES = ['./', 'index.html', 'android-entry.js', 'manifest.webmanifest', 'icon.svg',
  'src/i18n.js', 'src/i18n-en.js', 'src/court-rules.js', 'src/shot-model.js', 'src/footwork-model.js',
  'src/recovery-model.js', 'src/engine.js', 'src/feedback-model.js', 'src/view.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Network first so deployments are never shadowed by stale files; cache is the offline fallback.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
