import { t } from './i18n';
import { getSettings } from './settings';

export interface AppVersion {
  id: string;
  builtAt: string;
}

export const APP_VERSION: AppVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : { id: 'test', builtAt: '' };

export type UpdateResult =
  | { status: 'latest'; latest: AppVersion }
  | { status: 'available'; latest: AppVersion }
  | { status: 'offline' }
  | { status: 'error'; reason: string };

const isVersion = (v: unknown): v is AppVersion =>
  !!v && typeof v === 'object' && typeof (v as AppVersion).id === 'string' && /^[\w.-]{1,40}$/.test((v as AppVersion).id) && typeof (v as AppVersion).builtAt === 'string';

/**
 * Сверяет запущенную версию с опубликованной (version.json рядом с сайтом). Запрос идёт мимо любых кешей:
 * `no-store` для браузера и уникальный параметр на случай старых service worker'ов.
 */
export async function checkForUpdate(
  fetchImpl: typeof fetch = fetch,
  current: AppVersion = APP_VERSION,
  base: string = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/',
): Promise<UpdateResult> {
  if (current.id === 'dev') return { status: 'error', reason: t('Режим разработки: версии не сравниваются') };
  let res: Response;
  try {
    res = await fetchImpl(new URL(`version.json?t=${Date.now()}`, base).toString(), { cache: 'no-store' });
  } catch {
    return { status: 'offline' };
  }
  if (!res.ok) return { status: 'error', reason: t('Сервер ответил {status}', { status: res.status }) };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { status: 'error', reason: t('Файл версии повреждён') };
  }
  if (!isVersion(data)) return { status: 'error', reason: t('Файл версии повреждён') };
  return data.id === current.id ? { status: 'latest', latest: data } : { status: 'available', latest: data };
}

export interface UpdateDeps {
  registrations: () => Promise<readonly { unregister: () => Promise<unknown> }[]>;
  cacheKeys: () => Promise<string[]>;
  deleteCache: (key: string) => Promise<unknown>;
  refetch: (url: string) => Promise<unknown>;
  reload: () => void;
  base: string;
}

const browserDeps = (): UpdateDeps => ({
  registrations: async () => ('serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations() : []),
  cacheKeys: async () => (typeof caches !== 'undefined' ? caches.keys() : []),
  deleteCache: (k) => caches.delete(k),
  refetch: (url) => fetch(url, { cache: 'reload' }),
  reload: () => location.reload(),
  base: document.baseURI,
});

/**
 * Применяет обновление: снимает service worker'ы, чистит кеши приложения, принудительно перекачивает страницу
 * (иначе GitHub Pages и сам браузер отдадут старый index.html ещё до 10 минут) и перезагружает.
 * Данные игры и паки лежат в localStorage — их это не затрагивает.
 */
export async function applyUpdate(deps: UpdateDeps = browserDeps()): Promise<void> {
  const steps: Promise<unknown>[] = [];
  for (const reg of await deps.registrations().catch(() => [])) steps.push(reg.unregister().catch(() => undefined));
  for (const key of await deps.cacheKeys().catch(() => [])) if (key.startsWith('shelter-')) steps.push(deps.deleteCache(key).catch(() => undefined));
  await Promise.all(steps);
  await Promise.all([deps.refetch(new URL('./', deps.base).toString()), deps.refetch(new URL('index.html', deps.base).toString())].map((p) => p.catch(() => undefined)));
  deps.reload();
}

/** Дата для показа: «7 окт. 2026, 12:41»; пустую строку возвращаем как есть. */
export function formatBuilt(builtAt: string): string {
  const d = new Date(builtAt);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(getSettings().lang === 'uk' ? 'uk-UA' : 'ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
