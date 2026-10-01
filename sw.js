/* Ciapachinze — service worker: rete prima, copia locale come riserva (così l'app installata vede sempre l'ultima versione) */
const CACHE = 'cpz-v202610010907';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request, { cache: 'no-store' });
      if (fresh && fresh.ok) { const c = await caches.open(CACHE); c.put(e.request, fresh.clone()); }
      return fresh;
    } catch (err) {
      const cached = await caches.match(e.request, { ignoreSearch: true });
      if (cached) return cached;
      if (e.request.mode === 'navigate') { const idx = await caches.match('./index.html', { ignoreSearch: true }); if (idx) return idx; }
      throw err;
    }
  })());
});
