import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { BUILTIN_PACKS, CLASSIC_PACK } from '../data/classicPack';
import { CATEGORIES, type GameState } from '../types';
import { buildMyPack, canOverride } from './builder';
import { takeBulk } from './bulk';
import { buildCsp } from './csp';
import { evaluate } from './evaluate';
import { mergePools } from './generator';
import { createGame } from './game';
import { LIMITS } from './limits';
import { clonePack, emptyPack, exportPackFile, importPackFile, MAX_FILE_BYTES, sanitizePack, withFreshIds } from './packs';
import { loadPacks, savePacks, validateSavedGame } from './storage';
import { renderResult, type ResultCard } from './shareResult';
import { skillCards } from './vocab';
import { updateSettings } from './settings';

const base = (): GameState => createGame({ scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: [CLASSIC_PACK.id], playerCount: 3, shelterSlots: 2, mode: 'pass-and-play', voting: 'open', revealsPerVote: 1, speechSec: 0, hazardCount: 0, difficulty: 'normal', roundEvents: false, autoActions: true, timeLimitMin: 0, names: ['A', 'B', 'C'], seed: 123 }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
afterEach(() => vi.unstubAllGlobals());

describe('audit round 4: regressions', () => {
  it('N1: a copy has its own scenario, hazard and card ids, so original and copy never replace each other', () => {
    const copy = clonePack(CLASSIC_PACK, 'Копия');
    copy.scenarios[0].title = 'Изменённая катастрофа';
    copy.cards.profession[0].description = 'Изменённая профессия';
    const ids = (p: typeof copy) => [...p.scenarios.map((s) => s.id), ...p.scenarios.flatMap((s) => (s.hazards ?? []).map((h) => h.id)), ...CATEGORIES.flatMap((c) => p.cards[c].map((x) => x.id))];
    const original = new Set(ids(CLASSIC_PACK));
    expect(ids(copy).some((id) => original.has(id))).toBe(false);
    const active = [CLASSIC_PACK, copy];
    expect(active.flatMap((p) => p.scenarios).find((s) => s.id === copy.scenarios[0].id)!.title).toBe('Изменённая катастрофа');
    expect(mergePools(active).profession.some((c) => c.description === 'Изменённая профессия')).toBe(true);
    expect(copy.scenarios).toHaveLength(CLASSIC_PACK.scenarios.length);
  });

  it('N1: abilities changed in the original follow the cards to the copy; overrides of foreign cards stay', () => {
    const p = emptyPack();
    p.cards.profession = [{ id: 'mine', category: 'profession', description: 'Моя' }];
    p.tagOverrides = { mine: ['магия'], 'foreign-card': ['вера'] };
    const copy = withFreshIds(p);
    const newId = copy.cards.profession[0].id;
    expect(newId).not.toBe('mine');
    expect(copy.tagOverrides).toEqual({ [newId]: ['магия'], 'foreign-card': ['вера'] });
  });

  it('N2: a cleared scenario title or card description does not delete the object on reload', () => {
    let stored: string | null = null;
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem: (_k: string, v: string) => { stored = v; }, removeItem: () => undefined });
    const p = emptyPack();
    p.name = 'Проверка';
    p.scenarios = [{ ...CLASSIC_PACK.scenarios[0], id: 'sc-existing', title: '' }];
    p.cards.profession = [{ id: 'card-existing', category: 'profession', description: '', tags: ['медицина'], modifier: 'positive' }];
    savePacks([p]);
    const loaded = loadPacks()[0];
    expect(loaded.scenarios).toHaveLength(1);
    expect(loaded.scenarios[0].title.length).toBeGreaterThan(0);
    expect(loaded.scenarios[0].hazards).toHaveLength(CLASSIC_PACK.scenarios[0].hazards!.length); // остальное содержимое цело
    expect(loaded.cards.profession).toHaveLength(1);
    expect(loaded.cards.profession[0].tags).toEqual(['медицина']);
    // внешний импорт по-прежнему строгий: пустые обязательные поля отбрасываются
    expect(sanitizePack(JSON.parse(JSON.stringify(p)))!.scenarios).toHaveLength(0);
    expect(sanitizePack(JSON.parse(JSON.stringify(p)))!.cards.profession).toHaveLength(0);
  });

  it('N3: the ability-override budget is the same in the constructor, in storage and in import', () => {
    const cards = skillCards(BUILTIN_PACKS);
    expect(cards.length).toBeLessThanOrEqual(LIMITS.tagOverrides); // все встроенные карты можно настроить
    const overrides: Record<string, string[]> = {};
    for (const c of cards) { expect(canOverride(overrides, c.id)).toBe(true); overrides[c.id] = ['свой навык']; }
    const pack = buildMyPack(undefined, CLASSIC_PACK.scenarios[0], [], overrides);
    expect(Object.keys(sanitizePack(JSON.parse(JSON.stringify(pack)))!.tagOverrides!)).toHaveLength(cards.length);
    // на пределе новая карта отклоняется, уже изменённая правится
    const full = Object.fromEntries(Array.from({ length: LIMITS.tagOverrides }, (_, i) => [`k${i}`, ['x']]));
    expect(canOverride(full, 'new')).toBe(false);
    expect(canOverride(full, 'k5')).toBe(true);
  });

  it('N4: a pack within every limit exports a file that the own import accepts', async () => {
    const tags = Array.from({ length: LIMITS.cardTags }, (_, i) => String(i) + 'я'.repeat(LIMITS.tagLen - 1));
    const p = emptyPack(); p.name = 'Большой допустимый пак';
    for (const cat of CATEGORIES) p.cards[cat] = Array.from({ length: LIMITS.cardsPerCategory }, (_, i) => ({ id: `${cat}-${i}`, category: cat, description: 'я'.repeat(LIMITS.cardDescription), title: 'я'.repeat(LIMITS.cardTitle), tags, modifier: 'positive' as const }));
    p.scenarios = Array.from({ length: LIMITS.scenarios }, (_, i) => ({ id: `sc-${i}`, title: 'я'.repeat(LIMITS.scenarioTitle), description: 'я'.repeat(LIMITS.scenarioDescription), isolationDuration: '1 год', shelterSlots: 2, requiredSkills: Array(LIMITS.skills).fill('я'.repeat(LIMITS.skillLen)), threats: Array(LIMITS.threats).fill('я'.repeat(LIMITS.threatLen)), hazards: Array.from({ length: LIMITS.hazards }, (_, j) => ({ id: `h-${i}-${j}`, title: 'я'.repeat(LIMITS.hazardTitle), description: 'я'.repeat(LIMITS.hazardDescription), counters: Array(LIMITS.hazardCounters).fill('я'.repeat(LIMITS.tagLen)), severity: 'critical' as const, onSuccess: 'я'.repeat(LIMITS.hazardStory), onFail: 'я'.repeat(LIMITS.hazardStory) })) }));
    p.tagOverrides = Object.fromEntries(Array.from({ length: LIMITS.tagOverrides }, (_, i) => [`override-${'я'.repeat(40)}-${i}`, tags]));
    const valid = sanitizePack(JSON.parse(JSON.stringify(p)))!;
    expect(valid.cards.profession).toHaveLength(LIMITS.cardsPerCategory);
    expect(Object.keys(valid.tagOverrides!)).toHaveLength(LIMITS.tagOverrides);
    let fileText = '';
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({ createWritable: async () => ({ write: async (text: string) => { fileText = text; }, close: async () => undefined }) }) });
    await exportPackFile(valid);
    const size = Buffer.byteLength(fileText, 'utf8');
    expect(size).toBeLessThanOrEqual(MAX_FILE_BYTES);
    vi.stubGlobal('window', { showOpenFilePicker: async () => [{ getFile: async () => ({ size, text: async () => fileText }) }] });
    const back = await importPackFile();
    expect(back!.scenarios).toHaveLength(LIMITS.scenarios);
    // а заведомо неподходящий пак экспорт не выдаёт за успешный
    vi.stubGlobal('window', { showSaveFilePicker: async () => { throw new Error('should not be asked'); } });
    await expect(exportPackFile({ ...valid, description: 'я'.repeat(MAX_FILE_BYTES) })).rejects.toThrow('слишком большой');
  });

  it('N5: a bulk add takes only as many lines as there is room for and leaves the others', () => {
    const r = takeBulk('Новая 1\nНовая 2\nНовая 3\nНовая 4\nНовая 5', 'profession', LIMITS.cardsPerCategory - 1);
    expect(r.accepted.map((c) => c.description)).toEqual(['Новая 1']);
    expect(r.rest).toEqual(['Новая 2', 'Новая 3', 'Новая 4', 'Новая 5']);
    const full = takeBulk('A\nB', 'profession', LIMITS.cardsPerCategory);
    expect(full.accepted).toHaveLength(0);
    expect(full.rest).toEqual(['A', 'B']);
    const ok = takeBulk('A | + | медицина\n\nB | - ', 'profession', 0);
    expect(ok.accepted).toHaveLength(2);
    expect(ok.accepted[0]).toMatchObject({ modifier: 'positive', tags: ['медицина'] });
    expect(ok.rest).toEqual([]);
  });

  it('N6: a secure broker on a custom port is allowed explicitly by the CSP, and nothing wider', () => {
    const csp = buildCsp({ VITE_PEER_HOST: 'relay.example.com', VITE_PEER_PORT: '8443', VITE_PEER_SECURE: 'true' });
    expect(csp).toContain("connect-src 'self' https://relay.example.com:8443 wss://relay.example.com:8443;");
    expect(csp).not.toContain('https://relay.example.com ');
    expect(buildCsp({ VITE_PEER_HOST: 'relay.example.com' })).toContain("connect-src 'self' https://relay.example.com wss://relay.example.com;");
    expect(buildCsp({ VITE_PEER_HOST: 'relay.example.com', VITE_PEER_PORT: '443' })).toContain('https://relay.example.com wss://relay.example.com;');
    expect(buildCsp({})).toContain('https://0.peerjs.com wss://0.peerjs.com');
    expect(buildCsp({ VITE_PEER_HOST: 'lan.local', VITE_PEER_SECURE: 'false' })).toContain('http://lan.local:* ws://lan.local:*');
    expect(buildCsp({ VITE_PEER_HOST: 'lan.local', VITE_PEER_PORT: '9000', VITE_PEER_SECURE: 'false' })).toContain('http://lan.local:9000 ws://lan.local:9000');
  });

  it('N7: the result image is tall enough for long titles: all text lies inside the picture', () => {
    // Поддельный холст с «моноширинным» шрифтом: ширина символа = 0.6 размера шрифта, как у настоящего.
    const painted: { text: string; y: number }[] = [];
    const ctx = {
      font: '30px mono', fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: 'left',
      measureText: (s: string) => ({ width: s.length * 0.6 * Number(/(\d+)px/.exec(ctx.font)![1]) }),
      fillRect: () => undefined, strokeRect: () => undefined, fillText: (text: string, _x: number, y: number) => painted.push({ text, y }),
    };
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    updateSettings({ lang: 'ru' });
    vi.stubGlobal('document', { createElement: () => canvas });
    const card: ResultCard = { scenario: 'Катастрофа '.repeat(6).slice(0, 60).trim(), headline: 'Неустранимая катастрофа разрушила колонию — никто не выжил', verdict: 'failed', score: 12, difficulty: 'Обычная', survivors: ['Аня', 'Борис'], threats: [{ title: 'Неустранимая катастрофа разрушила колонию'.slice(0, 40), ok: false }], notes: ['Смертельная угроза осталась без ответа. '.repeat(3)] } as ResultCard;
    renderResult(card);
    expect(painted.length).toBeGreaterThan(5);
    const lowest = Math.max(...painted.map((l) => l.y));
    expect(lowest + 10).toBeLessThanOrEqual(canvas.height); // и нижний вынос букв
    // без длинных заголовков картинка не раздувается
    painted.length = 0;
    renderResult({ ...card, scenario: 'Ночь', headline: 'Выжили', notes: [] });
    expect(canvas.height).toBeLessThan(900);
  });

  it('N8: a new worker waits for the old pages instead of taking them over and deleting what they still need', async () => {
    const baseUrl = 'https://example.com/shelter/';
    const storage = new Map<string, Map<string, Response>>();
    const key = (u: any) => new URL(typeof u === 'string' ? u : u.url, baseUrl).href;
    let claims = 0, skips = 0;
    const caches = {
      open: async (name: string) => { let d = storage.get(name); if (!d) { d = new Map(); storage.set(name, d); } const cache = d; return { addAll: async (urls: string[]) => { for (const u of urls) cache.set(key(u), new Response('module ' + u)); }, put: async (u: any, r: Response) => { cache.set(key(u), r); } }; },
      keys: async () => [...storage.keys()], delete: async (name: string) => storage.delete(name),
      match: async (u: any) => { for (const c of storage.values()) if (c.has(key(u))) return c.get(key(u)); return undefined; },
    };
    function worker(build: string, asset: string) {
      const handlers: Record<string, (e: any) => void> = {};
      const src = readFileSync('public/sw.js', 'utf8').replace('__BUILD__', build).replace('/*__PRECACHE__*/[]', JSON.stringify([asset]));
      runInNewContext(src, { URL, self: { registration: { scope: baseUrl }, location: { origin: 'https://example.com', href: baseUrl + 'sw.js' }, addEventListener: (t: string, cb: any) => { handlers[t] = cb; }, skipWaiting: async () => { skips++; }, clients: { claim: async () => { claims++; } } }, caches, fetch: async () => new Response('gone', { status: 404 }) });
      return handlers;
    }
    const fire = async (h: any) => { let p: Promise<any> = Promise.resolve(); h({ waitUntil: (v: Promise<any>) => { p = v; } }); await p; };
    const oldAsset = './assets/jsQR-OLD.js';
    const oldW = worker('old', oldAsset); await fire(oldW.install); await fire(oldW.activate);
    const newW = worker('new', './assets/jsQR-NEW.js'); await fire(newW.install);
    // новая версия установлена, но ждёт: кеш старой цел, старая страница получает свой модуль
    expect(skips).toBe(0);
    expect(claims).toBe(1); // единственный claim — при первой установке старой версии
    expect(await caches.match(oldAsset)).toBeDefined();
    // когда старые вкладки закрыты и новая версия активировалась, старый кеш можно удалить
    await fire(newW.activate);
    expect(await caches.match(oldAsset)).toBeUndefined();
    expect(claims).toBe(1); // обновление страницы старой сборки не перехватывает
  });

  it('R1: damaged nested luggage items are rejected on load and cannot reach the verdict', () => {
    const raw = JSON.parse(JSON.stringify(base()));
    const set = (items: unknown) => { raw.players[0].slots.luggage.card.items = items; return validateSavedGame(raw); };
    expect(set({ length: 1 })).toBeNull();
    expect(set([null])).toBeNull();
    expect(set([{ description: 5 }])).toBeNull();
    expect(set([{ description: 'ок', items: [] }])).toBeNull(); // вложенность только на один уровень
    expect(set(Array.from({ length: 9 }, () => ({ description: 'x' })))).toBeNull();
    const good = set([{ id: 'a', category: 'luggage', description: 'Аптечка', tags: ['медицина'] }, { id: 'b', category: 'luggage', description: 'Еда' }]);
    expect(good).not.toBeNull();
    expect(() => evaluate(good!.scenario, good!.players)).not.toThrow();
  });
});
