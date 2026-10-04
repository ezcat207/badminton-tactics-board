const CACHE = 'badminton-tactics-v0.27.1';
const FILES = ['./', 'index.html', 'android-entry.js', 'manifest.webmanifest', 'icon.svg',
  'src/i18n.js', 'src/i18n-en.js', 'src/court-rules.js', 'src/shot-model.js', 'src/footwork-model.js',
  'src/recovery-model.js', 'src/engine.js', 'src/feedback-model.js', 'src/view.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
