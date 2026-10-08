import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { CLASSIC_PACK } from '../data/classicPack';
import { CATEGORIES, type GameState } from '../types';
import { ABSTAIN, castVote, createGame, currentSpeaker, nextRound, pendingReveal, playAction, playPerk, resolveVote, revealCard, revealOptions, tickGame, volunteer } from './game';
import { canApply } from './actions';
import { buildChronicle } from './chronicle';
import { cardMatchesSkill, evaluate } from './evaluate';
import { composeItems } from './inventory';
import { mergePools } from './generator';
import { emptyPack } from './packs';
import { OnlineClient, OnlineHost, sanitizeView, viewFor, type C2H, type H2C, type Conn } from './online';
import { getSettings, updateSettings } from './settings';
import { applyUpdate } from './update';
import Tabletop from '../screens/Tabletop';

vi.mock('../store', () => ({ useStore: () => ({ allPacks: [CLASSIC_PACK], setGame: vi.fn(), notify: vi.fn() }) }));
const base = (): GameState => createGame({ scenarioId: 'audit', packIds: ['classic'], playerCount: 3, shelterSlots: 1, mode: 'online', voting: 'secret', revealsPerVote: 1, speechSec: 0, hazardCount: 0, difficulty: 'normal', roundEvents: false, autoActions: true, professionPerks: false, timeLimitMin: 0, names: ['A', 'B', 'C'], seed: 123 }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
function pair() {
  let toHost: (m: unknown) => void = () => {}, toClient: (m: unknown) => void = () => {};
  let hc = () => {}, cc = () => {};
  const hostSide: Conn<H2C> = { send: (m) => queueMicrotask(() => toClient(JSON.parse(JSON.stringify(m)))), onMessage: (cb) => { toHost = cb; }, onClose: (cb) => { hc = cb; }, close: () => cc() };
  const clientSide: Conn<C2H> = { send: (m) => queueMicrotask(() => toHost(JSON.parse(JSON.stringify(m)))), onMessage: (cb) => { toClient = cb; }, onClose: (cb) => { cc = cb; }, close: () => hc() };
  return { hostSide, clientSide };
}
const turn = () => new Promise((r) => setTimeout(r, 0));
async function room(names: string[]) {
  const host = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'secret', revealsPerVote: 1, speechSec: 0, roundEvents: false }, names[0]);
  const clients: OnlineClient[] = [];
  for (let i = 1; i < names.length; i++) {
    const p = pair(); host.addConn(p.hostSide);
    clients.push(new OnlineClient(p.clientSide, names[i], `token${i}`));
  }
  await turn(); host.start(); await turn();
  return { host, clients };
}

describe('audit round 3: regressions', () => {
  it('N1: a forced reveal of the last hidden card moves the game on instead of leaving it without a turn', () => {
    let g = base();
    g.players[0].slots.action.card = { id: 'forced', category: 'action', description: 'Открыть карту', effect: 'forceReveal' };
    for (let r = 1; r <= 7; r++) {
      while (g.phase === 'reveal') { const p = currentSpeaker(g)!; g = revealCard(g, p.id, revealOptions(g, p)[0]); }
      for (const p of g.players) g = castVote(g, p.id, ABSTAIN);
      g = nextRound(resolveVote(g));
    }
    expect(g.round).toBe(8);
    for (let i = 0; i < 2; i++) { const p = currentSpeaker(g)!; g = revealCard(g, p.id, revealOptions(g, p)[0]); }
    const victim = currentSpeaker(g)!;
    g = playAction(g, 'p1', { target: victim.id, category: revealOptions(g, victim)[0] });
    expect(g.phase).toBe('vote');
    expect(currentSpeaker(g)).toBeUndefined();
    expect(tickGame(g, Date.now() + 86_400_000).phase).toBe('vote');
  });

  it('N1: a bonus that opens the last card also finishes the step', () => {
    let g = base();
    g.config.professionPerks = true;
    g = { ...g, round: 2, perks: [{ playerId: 'p1', kind: 'reveal', level: 'novice' }] };
    // у p2 и p3 остаётся по одной скрытой карте, у остальных всё открыто, очередь — только они
    for (const p of g.players) for (const c of CATEGORIES) if (c !== 'action') p.slots[c].isRevealed = true;
    g.players[1].slots.fact.isRevealed = false;
    g.revealedThisRound = ['p1'];
    g.revealStep = 1;
    expect(pendingReveal(g).map((p) => p.id)).toEqual(['p2']);
    const done = playPerk(g, 'p1', { target: 'p2', category: 'fact' });
    expect(done.phase).toBe('vote');
  });

  it('N2: tabletop print sections contain the real cards even while the screen keeps them hidden', () => {
    const g = base(); g.config.mode = 'tabletop'; g.phase = 'final';
    for (const p of g.players) for (const c of CATEGORIES) p.slots[c].card = { id: `${p.id}-${c}`, category: c, description: `PRINT_${p.id}_${c}` };
    const html = renderToStaticMarkup(createElement(Tabletop, { game: g }));
    const sections = html.match(/<section[^>]*class="panel print-card[^>]*>[\s\S]*?<\/section>/g)!;
    expect(sections).toHaveLength(3);
    for (const [i, s] of sections.entries()) {
      expect(s).toContain('print:flex');
      expect(s).toContain(`PRINT_p${i + 1}_profession`);
    }
  });

  it('N3: the client keeps the action marker and the volunteer name of log entries', async () => {
    const { host, clients } = await room(['A', 'B', 'C']);
    try {
      host.actAsHost({ t: 'action' }); await turn();
      const st = clients[0].state; if (st.status !== 'game') throw new Error('not game');
      expect(st.view.log.at(-1)!.kind).toBe('action');
    } finally { host.destroy(); }
    const lang = getSettings().lang; updateSettings({ lang: 'en' });
    try {
      let g = base(); g.phase = 'event';
      g.event = { id: 'v', kind: 'volunteer', tone: 'neutral', title: 'Кто готов уйти добровольно?', text: '', outcome: [] };
      g = volunteer(g, 'p1'); g.phase = 'final';
      const client = sanitizeView(viewFor(g, 'p2'))!;
      expect(client.log.at(-1)!.volunteer).toBe('A');
      expect(buildChronicle(client).epilogue).toEqual(buildChronicle(g).epilogue);
    } finally { updateSettings({ lang }); }
  });

  it('N4: duplicate names get unique suffixes that fit the limit and never collide', async () => {
    const long = 'ABCDEFGHIJKLMNOPQRSTUVWX';
    const a = await room([long, long, 'C']);
    try {
      const st = a.clients[0].state; if (st.status !== 'game') throw new Error('not game');
      const hostNames = a.host.game!.players.map((p) => p.name);
      expect(new Set(hostNames).size).toBe(3);
      expect(hostNames.every((n) => n.length <= 24)).toBe(true);
      expect(st.view.players.map((p) => p.name)).toEqual(hostNames);
    } finally { a.host.destroy(); }
    const b = await room(['A', 'A', 'A 2']);
    try {
      const names = b.host.game!.players.map((p) => p.name);
      expect(new Set(names).size).toBe(3);
      expect(names[0]).toBe('A');
      expect(names[2]).toBe('A 2');
    } finally { b.host.destroy(); }
  });

  it('N5: a healer skill on character or physique allows healing, like the final evaluation counts it', () => {
    const g = base();
    for (const p of g.players) for (const c of CATEGORIES) p.slots[c].card = { id: `${p.id}-${c}`, category: c, description: 'Пусто', modifier: 'neutral' };
    g.players[0].slots.health.card.modifier = 'negative';
    g.players[1].slots.character.card.tags = ['медицина'];
    expect(evaluate({ ...g.scenario, requiredSkills: ['медицина'] }, g.players).coverage[0].by).toEqual(['B']);
    expect(canApply(g, 'p1', 'heal').ok).toBe(true);
    g.players[1].slots.character.card.tags = [];
    g.players[1].slots.physique.card.tags = ['лечение'];
    expect(canApply(g, 'p1', 'heal').ok).toBe(true);
    g.players[1].slots.physique.card.tags = [];
    expect(canApply(g, 'p1', 'heal').ok).toBe(false);
  });

  it('R2: a disabled ability stays disabled when the item is part of a compound luggage, on host and client', () => {
    const p = emptyPack();
    p.cards.luggage = [{ id: 'med', category: 'luggage', description: 'Медицина: аптечка', tags: ['медицина'] }, { id: 'food', category: 'luggage', description: 'Еда' }];
    p.tagOverrides = { med: [] };
    const items = mergePools([p]).luggage;
    const bag = composeItems(items, () => items[0]);
    expect(cardMatchesSkill(bag, 'медицина')).toBe(false);
    // а текстовая способность другого предмета без переопределения сохраняется
    const bag2 = composeItems([items[0], { id: 'x', category: 'luggage', description: 'Хирургический набор, медицина' }], () => items[0]);
    expect(cardMatchesSkill(bag2, 'медицина')).toBe(true);
    const g = base();
    g.phase = 'final';
    g.players[0].slots.luggage.card = bag;
    const client = sanitizeView(viewFor(g, 'p0'))!;
    const bagOnClient = client.players.find((q) => q.id === 'p1')!.slots.luggage.card;
    expect(cardMatchesSkill(bagOnClient, 'медицина')).toBe(false);
  });

  it('R3: the update leaves other applications on the same origin alone, also for a root installation', async () => {
    const removed: string[] = [];
    const reg = (scope: string) => ({ scope, unregister: async () => { removed.push(scope); } });
    const deps = { cacheKeys: async () => [], deleteCache: async () => undefined, refetch: async () => undefined, reload: () => undefined };
    await applyUpdate({ ...deps, base: 'https://example.com/', registrations: async () => [reg('https://example.com/'), reg('https://example.com/other-app/')] });
    expect(removed).toEqual(['https://example.com/']);
    removed.length = 0;
    await applyUpdate({ ...deps, base: 'https://example.com/shelter/', registrations: async () => [reg('https://example.com/shelter/'), reg('https://example.com/shelter/sub-app/'), reg('https://example.com/')] });
    expect(removed).toEqual(['https://example.com/shelter/']);
  });

  it('R3: caches of other copies of the game on the same origin are kept', async () => {
    const deleted: string[] = [];
    await applyUpdate({
      base: 'https://example.com/shelter/', registrations: async () => [], refetch: async () => undefined, reload: () => undefined,
      cacheKeys: async () => ['shelter-v2-abc@/shelter/', 'shelter-v2-abc@/other-copy/', 'shelter-v2', 'unrelated'],
      deleteCache: async (k) => { deleted.push(k); },
    });
    expect(deleted.sort()).toEqual(['shelter-v2', 'shelter-v2-abc@/shelter/']);
  });

  it('O1: the service worker precaches the built scripts and serves the entry module offline', async () => {
    const entry = './assets/index-AAA.js';
    const src = readFileSync('public/sw.js', 'utf8').replace('/*__PRECACHE__*/[]', JSON.stringify([entry, './assets/index-BBB.css'])).replace('__BUILD__', 'b1');
    const baseUrl = 'https://example.com/shelter/';
    const cached = new Map<string, Response>();
    const handlers: Record<string, (e: any) => void> = {};
    const key = (v: any) => new URL(typeof v === 'string' ? v : v.url, baseUrl).href;
    runInNewContext(src, {
      URL,
      self: { registration: { scope: baseUrl }, location: { origin: 'https://example.com', href: `${baseUrl}sw.js` }, addEventListener: (type: string, cb: any) => { handlers[type] = cb; }, skipWaiting: async () => undefined, clients: { claim: async () => undefined } },
      caches: { open: async () => ({ addAll: async (urls: string[]) => { for (const u of urls) cached.set(key(u), new Response(`body:${u}`)); }, put: async (u: any, r: Response) => { cached.set(key(u), r); } }), match: async (u: any) => cached.get(key(u)), keys: async () => ['shelter-v2'], delete: async () => true },
      fetch: async () => { throw new Error('offline'); },
    });
    let install: Promise<any> = Promise.resolve(); handlers.install({ waitUntil: (p: Promise<any>) => { install = p; } }); await install;
    expect([...cached.keys()]).toContain(key(entry));
    let response: Promise<Response> = Promise.resolve(new Response('')); handlers.fetch({ request: { url: key(entry), method: 'GET', mode: 'cors' }, respondWith: (p: Promise<Response>) => { response = p; } });
    expect(await (await response).text()).toBe(`body:${entry}`);
  });
});
