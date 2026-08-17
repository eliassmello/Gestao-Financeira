const CACHE_NAME = 'financas-pwa-v70';

// Essenciais para abrir offline: só a "casca" leve do app + CSS estático + Dexie.
// Chart.js, SheetJS (xlsx) e pdf.js NÃO entram aqui — são carregados sob demanda e o
// próprio handler de fetch abaixo os guarda no cache no primeiro uso online.
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './css/tailwind.css',
  './js/services.js',
  './js/ui.js',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/dexie@4.4.5/dist/dexie.js'
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

  // Lista de acesso (cafe.json): network-first, para o cadastro de usuários publicado
  // no repositório sempre chegar atualizado. Cai no cache só quando offline.
  if (new URL(req.url).pathname.endsWith('/cafe.json')) {
    event.respondWith(
      fetch(req).then(resp => {
        if (resp && (resp.ok || resp.type === 'opaque')) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match(req))
    );
    return;
  }

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
