/* Service worker: офлайн-оболочка приложения. Версию поднимайте при изменении логики кеширования. */
const VERSION = 'v2'; // v2: version.json не кешируется; старые кеши (с накопленными запросами проверки версии) удаляются при активации
const CACHE = `shelter-${VERSION}`;
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shelter-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Только свои GET-запросы; брокер LAN (/peerjs), lan-info и всё чужое — мимо кеша.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/peerjs') || url.pathname.endsWith('lan-info.json') || url.pathname.endsWith('version.json')) return;

  if (req.mode === 'navigate') {
    // Страница: сначала сеть (свежая версия), при отсутствии сети — кеш.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }
  // Статика: кеш, при промахе — сеть с докладыванием в кеш (имена файлов в /assets/ содержат хеш содержимого).
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
