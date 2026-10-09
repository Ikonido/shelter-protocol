import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** Запускает public/sw.js в песочнице с поддельными кешем и сетью. */
function boot(networkAnswer: (url: string) => Response) {
  const baseUrl = 'https://example.com/shelter/';
  const src = readFileSync('public/sw.js', 'utf8').replace('/*__PRECACHE__*/[]', '[]').replace('__BUILD__', 't1');
  const cached = new Map<string, Response>();
  const handlers: Record<string, (e: any) => void> = {};
  const key = (v: any) => new URL(typeof v === 'string' ? v : v.url, baseUrl).href;
  const installed: unknown[] = [];
  runInNewContext(src, {
    URL,
    Request: class { url: string; cache?: string; constructor(u: string, init?: { cache?: string }) { this.url = new URL(u, baseUrl).href; this.cache = init?.cache; } },
    self: { registration: { scope: baseUrl }, location: { origin: 'https://example.com', href: `${baseUrl}sw.js` }, addEventListener: (type: string, cb: any) => { handlers[type] = cb; }, skipWaiting: async () => undefined, clients: { claim: async () => undefined } },
    caches: {
      open: async () => ({ addAll: async (reqs: any[]) => { installed.push(...reqs); for (const r of reqs) cached.set(key(r), new Response('shell')); }, put: async (u: any, r: Response) => { cached.set(key(u), r); } }),
      match: async (u: any) => cached.get(key(u)),
      keys: async () => [],
      delete: async () => true,
    },
    // В браузере ответ на запрос того же origin имеет type 'basic'; у Response из Node он 'default'.
    fetch: async (req: any) => Object.defineProperty(networkAnswer(key(req)), 'type', { value: 'basic' }),
  });
  const navigate = async (path: string) => {
    let answer: Promise<Response> = Promise.resolve(new Response(''));
    handlers.fetch({ request: { url: baseUrl.replace(/shelter\/$/, '') + path, method: 'GET', mode: 'navigate' }, respondWith: (p: Promise<Response>) => { answer = p; } });
    const res = await answer;
    await new Promise((r) => setTimeout(r, 0)); // кеш пополняется асинхронно
    return res;
  };
  return { handlers, cached, key, baseUrl, installed, navigate };
}

describe('service worker shell cache', () => {
  it('a 404 page, a server error or a foreign path never replaces the cached app shell', async () => {
    const answers: Record<string, Response> = {
      '/shelter/': new Response('<html>новая версия</html>', { status: 200 }),
      '/shelter/nope': new Response('Not found', { status: 404 }),
      '/shelter/boom': new Response('Error', { status: 503 }),
      '/shelter/sub/page': new Response('<html>sub</html>', { status: 200 }),
    };
    const sw = boot((url) => answers[new URL(url).pathname] ?? new Response('', { status: 404 }));
    let ready: Promise<any> = Promise.resolve(); sw.handlers.install({ waitUntil: (p: Promise<any>) => { ready = p; } }); await ready;
    const shell = () => sw.cached.get(sw.key('./index.html'))!.clone();
    expect(await shell().text()).toBe('shell');

    await sw.navigate('shelter/nope');
    await sw.navigate('shelter/boom');
    await sw.navigate('shelter/sub/page');
    expect(await shell().text(), 'оболочку заменила чужая страница').toBe('shell');

    await sw.navigate('shelter/');
    expect(await shell().text()).toBe('<html>новая версия</html>');
  });

  it('the install step fetches the shell bypassing the HTTP cache', async () => {
    const sw = boot(() => new Response('x'));
    let ready: Promise<any> = Promise.resolve(); sw.handlers.install({ waitUntil: (p: Promise<any>) => { ready = p; } }); await ready;
    expect(sw.installed.length).toBeGreaterThan(3);
    expect(sw.installed.every((r: any) => r.cache === 'reload')).toBe(true);
  });
});
