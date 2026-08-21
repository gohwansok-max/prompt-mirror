const CACHE_NAME = 'prompt-mirror-v5';
const CACHE_PREFIX = 'prompt-mirror-';
const APP_SHELL = ['./', './index.html', './offline.html', './manifest.webmanifest', './icon.svg'];
const NETWORK_TIMEOUT_MS = 3500;

const isCacheable = response => response && response.ok && response.type === 'basic';

async function networkWithTimeout(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheNavigation(response) {
  if (!isCacheable(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put('./index.html', response.clone());
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await networkWithTimeout(request);
        event.waitUntil(cacheNavigation(response));
        return response;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./offline.html')) || new Response('오프라인 상태입니다. 네트워크가 연결되면 다시 시도해 주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) {
      event.waitUntil(fetch(request).then(async response => {
        if (isCacheable(response)) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
      }).catch(() => {}));
      return cached;
    }
    try {
      const response = await fetch(request);
      if (isCacheable(response)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
