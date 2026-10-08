import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_PACKS, CLASSIC_PACK } from '../data/classicPack';
import { CATEGORIES, type Card, type GameState } from '../types';
import { runEffect } from './actions';
import { buildMyPack, canSaveScenario, ownCardCount } from './builder';
import { cardMatchesSkill, evaluate } from './evaluate';
import { mergePools } from './generator';
import { addToBag, composeItems, itemsOf } from './inventory';
import { createGame } from './game';
import { sanitizeView, viewFor } from './online';
import { emptyPack, sanitizePack } from './packs';
import { loadPacks, savePacks, validateSavedGame } from './storage';
import { applyUpdate } from './update';

const base = (): GameState => createGame({ scenarioId: 'audit', packIds: ['classic'], playerCount: 3, shelterSlots: 2, mode: 'online', voting: 'open', revealsPerVote: 1, speechSec: 0, hazardCount: 0, difficulty: 'normal', roundEvents: false, autoActions: true, professionPerks: true, timeLimitMin: 0, names: ['A', 'B', 'C'], seed: 123 }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
const item = (id: string, tags: string[], description = 'Предмет'): Card => ({ id, category: 'luggage', description, modifier: 'positive', tags });

describe('audit round 2: regressions', () => {
  it('N1: a compound luggage keeps all its skills on the client, so host and guest agree on the verdict', () => {
    const g = base();
    g.phase = 'final';
    g.scenario = { ...g.scenario, requiredSkills: [] };
    g.players[2].isEliminated = true;
    for (const p of g.players) for (const c of CATEGORIES) p.slots[c].card = { id: `${p.id}-${c}`, category: c, description: 'Пусто', modifier: 'positive' };
    const bag = composeItems([item('a', ['a', 'b', 'c', 'd', 'e']), item('b', ['санитария'])], () => item('empty', []));
    g.players[0].slots.luggage.card = bag;
    g.hazards = [{ id: 'fatal', title: 'Инфекция', description: '', severity: 'critical', counters: ['санитария'] }];
    const client = sanitizeView(viewFor(g, 'p2'))!;
    const verdict = (s: GameState) => evaluate(s.scenario, s.players.filter((p) => !p.isEliminated), s.config.shelterSlots, s.hazards, s.config.difficulty).verdict;
    expect(client.players[0].slots.luggage.card.tags).toHaveLength(6);
    expect(verdict(client)).toBe(verdict(g));
    expect(verdict(g)).toBe('survived');
  });

  it('N2: the custom-card limit counts only own cards, not the built-in pool', () => {
    expect(mergePools([...BUILTIN_PACKS, emptyPack()]).profession.length).toBeGreaterThan(60);
    const mine = buildMyPack(undefined, { ...CLASSIC_PACK.scenarios[0], id: 's', title: 'S' }, [], {});
    expect(ownCardCount([...BUILTIN_PACKS, mine], 'profession')).toBe(0);
    const withCard = buildMyPack(undefined, { ...CLASSIC_PACK.scenarios[0], id: 's', title: 'S' }, [{ id: 'c1', category: 'profession', description: 'Моя' }], {});
    expect(ownCardCount([...BUILTIN_PACKS, withCard], 'profession')).toBe(1);
  });

  it('N3: a thirteenth scenario is refused, editing an existing one stays possible', () => {
    let p = undefined as ReturnType<typeof buildMyPack> | undefined;
    for (let i = 0; i < 12; i++) {
      expect(canSaveScenario(p, `sc${i}`)).toBe(true);
      p = buildMyPack(p, { ...CLASSIC_PACK.scenarios[0], id: `sc${i}`, title: `Scenario ${i}` }, [], {});
    }
    expect(canSaveScenario(p, 'sc13')).toBe(false);
    expect(canSaveScenario(p, 'sc3')).toBe(true);
    expect(sanitizePack(JSON.parse(JSON.stringify(p)))!.scenarios).toHaveLength(12);
  });

  it('N4: a pack whose name was cleared is not dropped when the storage is read again', () => {
    let stored: string | null = null;
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem: (_k: string, v: string) => { stored = v; }, removeItem: () => undefined });
    try {
      savePacks([{ ...CLASSIC_PACK, isCustom: true, name: '' }]);
      const loaded = loadPacks();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].name.length).toBeGreaterThan(0);
      expect(loaded[0].scenarios.length).toBe(CLASSIC_PACK.scenarios.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('N5: a card id like "constructor" does not crash the merge or count as an override', () => {
    const p = emptyPack();
    p.cards.profession = [{ id: 'constructor', category: 'profession', description: 'Card' }];
    p.tagOverrides = { unrelated: ['медицина'] };
    const accepted = sanitizePack(JSON.parse(JSON.stringify(p)))!;
    expect(() => mergePools([accepted])).not.toThrow();
    const card = mergePools([accepted]).profession.find((c) => c.id === 'constructor')!;
    expect(card.tags).toBeUndefined();
    expect(card.strictTags).toBeUndefined();
  });

  it('N6: replacing the weakest item removes exactly one, even if several slots hold the same object', () => {
    const bad = { ...item('a', []), modifier: 'negative' as const };
    const better = item('b', []);
    const r = addToBag([bad, bad, bad, bad], better);
    expect(r.items).toHaveLength(4);
    expect(r.items.filter((c) => c === bad)).toHaveLength(3);
    expect(r.items).toContain(better);
    expect(r.dropped).toBe(bad);
  });

  it('N6: theft from a short deck and a better find keep all items', () => {
    const pack = emptyPack();
    pack.cards.luggage = [{ ...item('a', []), modifier: 'negative' as const }];
    const cfg = { ...base().config, playerCount: 5, names: ['A', 'B', 'C', 'D', 'E'] };
    let g = createGame(cfg, CLASSIC_PACK.scenarios[0], [pack]);
    for (const target of ['p2', 'p3', 'p4']) g = runEffect(g, 'p1', 'stealLuggage', { target, perk: true });
    const before = itemsOf(g.players[0].slots.luggage.card).length;
    expect(before).toBe(4);
    g.deck = { ...g.deck, luggage: [item('better', [])] };
    g = runEffect(g, 'p1', 'drawLuggage');
    expect(itemsOf(g.players[0].slots.luggage.card)).toHaveLength(4);
    expect(g.discard!.luggage).toHaveLength(1);
  });

  it('N7: an explicit ability choice (even an empty one) is not replaced by matching the card text', () => {
    const p = emptyPack();
    p.cards.profession = [{ id: 'doctor', category: 'profession', description: 'Медицина', tags: ['медицина'] }];
    p.tagOverrides = { doctor: [] };
    const card = mergePools([p]).profession[0];
    expect(card.tags).toBeUndefined();
    expect(cardMatchesSkill(card, 'медицина')).toBe(false);
    // карта без переопределения по-прежнему узнаётся по тексту
    expect(cardMatchesSkill({ id: 'x', category: 'profession', description: 'Хирург, медицина' }, 'медицина')).toBe(true);
  });

  it('N8: an empty shelter is a defeat, whatever the numbers say', () => {
    const sc = { ...CLASSIC_PACK.scenarios[0], requiredSkills: [] };
    const r = evaluate(sc, [], 2, [], 'easy');
    expect(r.verdict).toBe('failed');
  });

  it('N9: the update only unregisters its own service worker', async () => {
    const removed: string[] = [];
    const reg = (scope: string, name: string) => ({ scope, unregister: async () => { removed.push(name); } });
    await applyUpdate({
      base: 'https://example.com/shelter/',
      registrations: async () => [reg('https://example.com/shelter/', 'shelter'), reg('https://example.com/other-app/', 'other-app'), reg('https://example.com/', 'root')],
      cacheKeys: async () => [], deleteCache: async () => undefined, refetch: async () => undefined, reload: () => undefined,
    });
    expect(removed).toEqual(['shelter']);
  });

  it('R1: a saved event with an unknown tone or kind is refused', () => {
    const g = { ...JSON.parse(JSON.stringify(base())), phase: 'event' };
    const ev = (patch: object) => ({ ...g, event: { id: 'x', kind: 'prompt', title: 'E', text: '', tone: 'good', outcome: [], ...patch } });
    expect(validateSavedGame(ev({}))).not.toBeNull();
    expect(validateSavedGame(ev({ tone: 'invalid' }))).toBeNull();
    expect(validateSavedGame(ev({ kind: 'nope' }))).toBeNull();
    expect(validateSavedGame(ev({ outcome: 'x' }))).toBeNull();
  });
});
