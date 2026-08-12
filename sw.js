/**
 * ProGestion — Service Worker
 * Met en cache uniquement les fichiers de l'app (HTML/CSS/JS/icônes) pour un
 * fonctionnement hors-ligne. Les appels vers Supabase et les CDN externes
 * (polices, Font Awesome, jsPDF) ne sont jamais interceptés : ils suivent
 * le comportement réseau normal du navigateur.
 */
const CACHE_NAME = 'progestion-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('SW install cache error:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Ne jamais intercepter les requêtes non-GET (POST/PATCH/DELETE vers
  // Supabase notamment) : elles doivent toujours atteindre le réseau.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Uniquement les fichiers de l'application elle-même (même origine).
  // Les CDN externes et l'API Supabase suivent le comportement réseau normal.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
