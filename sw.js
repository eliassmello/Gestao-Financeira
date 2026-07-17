const CACHE_NAME = 'financas-pwa-v54';

// Recursos essenciais para a aplicação abrir offline (o app + as bibliotecas de CDN).
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './js/services.js',
  './js/ui.js',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://unpkg.com/dexie/dist/dexie.js'
];

// Instala e pré-carrega os essenciais. Cada item é cacheado individualmente para
// que a falha de um recurso (ex.: CDN temporariamente indisponível) não aborte
// toda a instalação — o que faltar é cacheado depois, no primeiro fetch online.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        urlsToCache.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      ))
      .then(() => self.skipWaiting())
  );
});

// Cache-first com "cache-on-the-fly": serve do cache quando existir; senão busca na
// rede, responde e guarda uma cópia (assim as libs de CDN ficam disponíveis offline
// já na primeira visita online). Navegações caem no index.html quando offline.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (resp && (resp.ok || resp.type === 'opaque')) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return caches.match(req);
      });
    })
  );
});

// Limpa caches antigos e assume o controle das páginas abertas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => Promise.all(
      cacheNames.map(name => name !== CACHE_NAME ? caches.delete(name) : null)
    )).then(() => self.clients.claim())
  );
});
