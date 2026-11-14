// WOB service worker: uygulama dosyalarını önbelleğe alır.
// Çevrimiçiyken her zaman en yeni sürüm gelir; bağlantı yoksa önbellekteki açılır.
const CACHE = 'wob-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/supabase.js', 'js/app.js', 'js/core.js', 'js/screens.js', 'js/map.js',
  'manifest.json', 'icons/logo.png', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isLeaflet = url.hostname === 'unpkg.com' && url.pathname.includes('/leaflet@');
  if (!sameOrigin && !isLeaflet) return; // Supabase ve harita karoları doğrudan ağdan

  if (isLeaflet) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res.clone();
      })),
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
  );
});
