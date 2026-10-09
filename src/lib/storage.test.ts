import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import { createGame } from './game';
import { loadGame, loadPacks, markSeen, saveGame, validateSavedGame } from './storage';
import { applyOvertime, shiftClock, tickGame } from './game';
import { vi } from 'vitest';
import type { SessionConfig } from '../types';

const config: SessionConfig = {
  scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: [CLASSIC_PACK.id], playerCount: 3, shelterSlots: 1, mode: 'pass-and-play', voting: 'open',
  revealsPerVote: 1, timeLimitMin: 0, speechSec: 0, hazardCount: 0, difficulty: 'normal', roundEvents: false, names: ['А', 'Б', 'В'], seed: 5,
};
const fresh = () => JSON.parse(JSON.stringify(createGame(config, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK])));

describe('saved game validation', () => {
  it('accepts a real game, including after a JSON round-trip', () => {
    expect(validateSavedGame(fresh())).not.toBeNull();
  });

  it('accepts old saves that predate physique and character', () => {
    const g = fresh();
    for (const p of g.players) { delete p.slots.physique; delete p.slots.character; }
    expect(validateSavedGame(g)).not.toBeNull();
  });

  it('accepts saves with the newer bonus fields and with none of them (old saves)', () => {
    const g = fresh();
    expect(validateSavedGame({ ...g, perks: [{ playerId: 'p1', kind: 'reveal' }] })).not.toBeNull(); // старое сохранение: без level, charges, bonds
    const newer = { ...g, perks: [{ playerId: 'p1', kind: 'bond', level: 'expert', charges: 2 }], bonds: [{ a: 'p2', b: 'p3', votes: 2 }] };
    newer.players[0].slots.profession.card.bonus = 'lawyer';
    expect(validateSavedGame(newer)).not.toBeNull();
  });

  it('rejects a perk with a nonsense level or charges instead of failing later', () => {
    const withPerk = (extra: object) => { const g = fresh(); g.perks = [{ playerId: 'p1', kind: 'heal', ...extra }]; return validateSavedGame(g); };
    expect(withPerk({ charges: 'много' })).toBeNull();
    expect(withPerk({ charges: 0 })).toBeNull();
    expect(withPerk({ charges: 99 })).toBeNull();
    expect(withPerk({ level: 'god' })).toBeNull();
    expect(withPerk({ level: 'novice', charges: 1 })).not.toBeNull();
  });

  it('rejects broken or foreign data instead of crashing later', () => {
    const broken = (mutate: (g: any) => void) => { const g = fresh(); mutate(g); return validateSavedGame(g); };
    expect(validateSavedGame(null)).toBeNull();
    expect(validateSavedGame('x')).toBeNull();
    expect(validateSavedGame([])).toBeNull();
    expect(validateSavedGame({})).toBeNull();
    expect(broken((g) => { g.players = []; })).toBeNull();
    expect(broken((g) => { g.phase = 'weird'; })).toBeNull();
    expect(broken((g) => { g.round = 'один'; })).toBeNull();
    expect(broken((g) => { g.votes = null; })).toBeNull();
    expect(broken((g) => { g.log = {}; })).toBeNull();
    expect(broken((g) => { delete g.players[0].slots.health; })).toBeNull();
    expect(broken((g) => { g.players[1].slots.fact.card = null; })).toBeNull();
    expect(broken((g) => { g.players[2].slots.profession.card.description = 42; })).toBeNull();
    expect(broken((g) => { g.scenario = { id: 'x' }; })).toBeNull();
    // поля, без которых экран падает при каждом запуске (в настоящем сохранении они есть всегда)
    expect(broken((g) => { delete g.players[0].slots.luggage.card.id; })).toBeNull();
    expect(broken((g) => { g.players[1].slots.fact.card.id = 5; })).toBeNull();
    expect(broken((g) => { g.hazards = [{ id: 'h', title: 'Угроза' }]; })).toBeNull();
    expect(broken((g) => { g.hazards = [{ id: 'h', title: 'Угроза', counters: ['медицина'] }]; })).not.toBeNull();
  });
});

describe('saved game validation: deep checks', () => {
  const broken = (mutate: (g: any) => void) => { const g = fresh(); mutate(g); return validateSavedGame(g); };
  it('rejects malformed log, votes, schedule and fx', () => {
    expect(broken((g) => { g.log = [{ round: 1 }]; })).toBeNull();
    expect(broken((g) => { g.votes = { p1: 42 }; })).toBeNull();
    expect(broken((g) => { g.schedule = ['x']; })).toBeNull();
    expect(broken((g) => { g.fx = { double: 'p1', veto: [], immune: [], allies: [] }; })).toBeNull();
    expect(broken((g) => { g.fx = { double: [], veto: [], immune: [], allies: [['p1']] }; })).toBeNull();
  });
  it('rejects a player with a wrong elimination flag or a broken card', () => {
    expect(broken((g) => { g.players[0].isEliminated = 'yes'; })).toBeNull();
    expect(broken((g) => { g.players[0].slots.health.card = null; })).toBeNull();
  });
  it('still accepts a valid game with allies and deadlines', () => {
    expect(broken((g) => { g.fx = { double: ['p1'], veto: [], immune: [], allies: [['p1', 'p2']] }; g.deadline = Date.now() + 1000; })).not.toBeNull();
  });
});

describe('saved game validation: fields that used to crash the screen', () => {
  const broken = (mutate: (g: any) => void) => { const g = fresh(); mutate(g); return validateSavedGame(g); };
  it('rejects broken scenario, config, hazards, cards and event data', () => {
    expect(broken((g) => { g.scenario.requiredSkills = 'медицина'; })).toBeNull();
    expect(broken((g) => { g.scenario.hazards = {}; })).toBeNull();
    expect(broken((g) => { g.config.mode = 'solo'; })).toBeNull();
    expect(broken((g) => { g.config.playerCount = 'many'; })).toBeNull();
    expect(broken((g) => { g.hazards = [{ id: 1 }]; })).toBeNull();
    expect(broken((g) => { g.players[0].slots.profession.card.tags = 'x'; })).toBeNull();
    expect(broken((g) => { g.players[0].slots.profession.card.modifier = 'huge'; })).toBeNull();
    expect(broken((g) => { g.event = { title: 'x', text: 'y', outcome: 'z' }; })).toBeNull();
    expect(broken((g) => { g.lastReveal = { playerId: 1, category: 'nope' }; })).toBeNull();
    expect(broken((g) => { g.lastResult = { eliminated: 'p1', tally: {} }; })).toBeNull();
    expect(broken((g) => { g.deck = { luggage: 'x' }; })).toBeNull();
    expect(broken((g) => { g.perks = [{ playerId: 'p1', kind: 'fly' }]; })).toBeNull();
  });
  it('still accepts a fresh game with a deck, hazards and perks', () => {
    expect(broken((g) => { g.perks = [{ playerId: 'p1', kind: 'heal', level: 'expert' }]; g.perkResult = { id: 1, playerId: 'p1', text: 'x' }; })).not.toBeNull();
  });
});

describe('custom packs storage', () => {
  const withStorage = (value: string | null, run: () => void) => {
    vi.stubGlobal('localStorage', { getItem: () => value, setItem: () => undefined, removeItem: () => undefined });
    try { run(); } finally { vi.unstubAllGlobals(); }
  };
  it('does not crash on a corrupted value', () => {
    withStorage('{"not":"a list"}', () => expect(loadPacks()).toEqual([]));
    withStorage('not json at all', () => expect(loadPacks()).toEqual([]));
    withStorage('[null, 5, "x", {"id": 1}]', () => expect(() => loadPacks()).not.toThrow());
  });
  it('keeps the valid packs from a partly broken list', () => {
    withStorage(JSON.stringify([null, { id: 'p1', name: 'Мой', description: '', scenarios: [], cards: {} }]), () => {
      expect(loadPacks().map((p) => p.name)).toEqual(['Мой']);
    });
  });
});

describe('the game clock does not run while nobody is looking', () => {
  const memory = () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    return store;
  };
  const timed = (now: number) => {
    const g = fresh();
    g.config.timeLimitMin = 20;
    g.deadline = now + 20 * 60_000;
    g.phase = 'reveal';
    return g;
  };

  it('shiftClock moves the deadline and the speech end; no deadline or no gap leaves the state alone', () => {
    const g = { ...timed(1_000), speechEndsAt: 5_000 };
    const moved = shiftClock(g, 60_000);
    expect(moved.deadline).toBe(g.deadline + 60_000);
    expect(moved.speechEndsAt).toBe(65_000);
    expect(shiftClock(g, 0)).toBe(g);
    expect(shiftClock(g, -5)).toBe(g);
    const plain = fresh();
    expect(shiftClock(plain, 60_000)).toBe(plain);
  });

  it('without the shift a long pause makes the first tick play every hidden card; with it the game is where it was', () => {
    const t0 = 1_700_000_000_000;
    const g = timed(t0);
    const dayLater = t0 + 24 * 3600_000;
    const revealed = (x: typeof g) => x.players.reduce((n: number, p: any) => n + Object.values<any>(p.slots).filter((s) => s.isRevealed).length, 0);
    expect(revealed(applyOvertime(g, dayLater))).toBeGreaterThan(revealed(g)); // старое поведение
    const resumed = tickGame(shiftClock(g, dayLater - t0), dayLater);
    expect(resumed.deadline).toBe(dayLater + 20 * 60_000);
    expect(revealed(resumed)).toBe(revealed(g));
  });

  it('reloading a saved game after a long absence keeps the remaining time, and loading twice does not shift twice', () => {
    memory();
    const now = Date.now();
    const g = timed(now);
    g.deadline = now + 600_000; // осталось десять минут
    saveGame(g);
    markSeen(now - 3 * 3600_000); // три часа назад игру видели в последний раз
    const first = loadGame()!;
    expect(first.deadline! - Date.now()).toBeGreaterThan(3 * 3600_000 + 590_000 - 2000);
    expect(tickGame(first).phase).toBe('reveal');
    const second = loadGame()!;
    expect(Math.abs(second.deadline! - first.deadline!)).toBeLessThan(2000);
  });

  it('a quick reload (seen a moment ago) and saves from before the marker are not touched', () => {
    memory();
    const now = Date.now();
    const g = timed(now);
    saveGame(g);
    markSeen(now - 1000);
    expect(loadGame()!.deadline).toBe(g.deadline);
    memory();
    saveGame(g); // метки нет: старое сохранение
    expect(loadGame()!.deadline).toBe(g.deadline);
  });
});
