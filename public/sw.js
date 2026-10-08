/* Service worker: офлайн-оболочка приложения. Версию поднимайте при изменении логики кеширования. */
const VERSION = 'v2'; // v2: version.json не кешируется; старые кеши (с накопленными запросами проверки версии) удаляются при активации
const BUILD = '__BUILD__'; // подставляется при сборке (у каждой сборки свой кеш: хешированные файлы прошлых версий не копятся)
// Собранные JS и CSS: список подставляется при сборке (vite.config.ts), иначе первый офлайн-запуск остался бы без кода приложения.
const PRECACHE = /*__PRECACHE__*/[];
// Путь установки входит в имя кеша: несколько копий игры на одном домене не делят и не стирают чужие кеши.
const SCOPE_PATH = (() => {
  try {
    return new URL('.', (self.registration && self.registration.scope) || (self.location && self.location.href) || 'http://localhost/').pathname;
  } catch (e) {
    return '/';
  }
})();
const CACHE = `shelter-${VERSION}-${BUILD}@${SCOPE_PATH}`;
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png', ...PRECACHE];

self.addEventListener('install', (e) => {
  // Новая версия ждёт, пока закроются вкладки старой: иначе она удалила бы файлы, которые старая страница ещё может запросить.
  // Обновление по кнопке (applyUpdate) снимает worker и перезагружает страницу сразу.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      const mine = (k) => k.startsWith('shelter-') && (!k.includes('@') || k.endsWith(`@${SCOPE_PATH}`));
      const older = keys.filter((k) => mine(k) && k !== CACHE);
      return Promise.all(older.map((k) => caches.delete(k))).then(() => {
        // Первая установка: старых страниц и кешей нет, берём открытую страницу под управление — офлайн работает уже без перезагрузки.
        // Обновление версии: страницы старой сборки не трогаем (иначе они потеряют ещё нужные им файлы), новая версия подхватит их после перезагрузки.
        if (older.length === 0) return self.clients.claim();
      });
    }),
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
