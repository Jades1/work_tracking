const CACHE_NAME = 'time-tracker-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/storage.js',
  '/config.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch((err) => {
        console.warn('Cache install partial (some assets may not be cached):', err);
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Network-first strategy for most requests
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          // Cache successful responses
          const cacheCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cacheCopy);
          });
          return response;
        }
        // If network fails, fall back to cache
        return caches.match(event.request);
      })
      .catch(() => {
        // Network failed; serve from cache
        return caches.match(event.request).then((response) => {
          return response || new Response('Offline - application not available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        });
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
});
