import { describe, expect, it } from 'vitest';
import { applyUpdate, checkForUpdate, formatBuilt, type UpdateDeps } from './update';

const current = { id: 'aaaaaaa', builtAt: '2026-10-07T09:00:00.000Z' };
const base = 'https://ikonido.github.io/shelter-protocol/';
const reply = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  (async () => ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => body }) as unknown as Response) as unknown as typeof fetch;

describe('checkForUpdate', () => {
  it('same id -> latest; different id -> available', async () => {
    expect(await checkForUpdate(reply(current), current, base)).toEqual({ status: 'latest', latest: current });
    const next = { id: 'bbbbbbb', builtAt: '2026-10-08T09:00:00.000Z' };
    expect(await checkForUpdate(reply(next), current, base)).toEqual({ status: 'available', latest: next });
  });

  it('asks for version.json next to the site, bypassing caches', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const spy = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => current } as unknown as Response;
    }) as unknown as typeof fetch;
    await checkForUpdate(spy, current, base);
    expect(seen!.url).toMatch(/^https:\/\/ikonido\.github\.io\/shelter-protocol\/version\.json\?t=\d+$/);
    expect(seen!.init).toEqual({ cache: 'no-store' });
  });

  it('distinguishes offline from server and format errors', async () => {
    const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    expect(await checkForUpdate(offline, current, base)).toEqual({ status: 'offline' });
    expect(await checkForUpdate(reply({}, { ok: false, status: 404 }), current, base)).toMatchObject({ status: 'error', reason: 'Сервер ответил 404' });
    const badJson = (async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) as unknown as Response) as unknown as typeof fetch;
    expect(await checkForUpdate(badJson, current, base)).toMatchObject({ status: 'error' });
  });

  it('rejects malformed or hostile version files', async () => {
    for (const bad of [null, [], 'x', { id: 5, builtAt: '' }, { id: '<script>alert(1)</script>', builtAt: '' }, { id: 'a'.repeat(100), builtAt: '' }, { id: 'ok' }]) {
      expect((await checkForUpdate(reply(bad), current, base)).status, JSON.stringify(bad)).toBe('error');
    }
  });

  it('does not compare in dev mode', async () => {
    expect((await checkForUpdate(reply(current), { id: 'dev', builtAt: '' }, base)).status).toBe('error');
  });
});

describe('applyUpdate', () => {
  function deps(over: Partial<UpdateDeps> = {}) {
    const calls: string[] = [];
    const d: UpdateDeps = {
      registrations: async () => [{ scope: base, unregister: async () => calls.push('unregister:1') }, { scope: base, unregister: async () => calls.push('unregister:2') }],
      cacheKeys: async () => ['shelter-v2', 'other-app', 'shelter-v1'],
      deleteCache: async (k) => calls.push(`delete:${k}`),
      refetch: async (u) => calls.push(`refetch:${u}`),
      reload: () => calls.push('reload'),
      base,
      ...over,
    };
    return { d, calls };
  }

  it('removes workers and only this app\'s caches, refreshes the page, then reloads last', async () => {
    const { d, calls } = deps();
    await applyUpdate(d);
    expect(calls).toEqual(expect.arrayContaining(['unregister:1', 'unregister:2', 'delete:shelter-v2', 'delete:shelter-v1']));
    expect(calls).not.toContain('delete:other-app');
    expect(calls).toContain(`refetch:${base}`);
    expect(calls).toContain(`refetch:${base}index.html`);
    expect(calls[calls.length - 1]).toBe('reload');
    expect(calls.filter((c) => c === 'reload')).toHaveLength(1);
    expect(calls.indexOf('reload')).toBeGreaterThan(Math.max(...calls.filter((c) => c.startsWith('refetch') || c.startsWith('delete') || c.startsWith('unregister')).map((c) => calls.indexOf(c))));
  });

  it('still reloads when parts of the cleanup fail (no service worker support, offline refetch)', async () => {
    const { d, calls } = deps({
      registrations: async () => { throw new Error('no sw'); },
      cacheKeys: async () => { throw new Error('no caches'); },
      refetch: async () => { throw new Error('offline'); },
    });
    await applyUpdate(d);
    expect(calls).toEqual(['reload']);
  });
});

describe('formatBuilt', () => {
  it('formats valid dates in Russian and ignores garbage', () => {
    expect(formatBuilt('2026-10-07T09:41:00.000Z')).toMatch(/2026/);
    expect(formatBuilt('')).toBe('');
    expect(formatBuilt('not a date')).toBe('');
  });
});
