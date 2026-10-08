import { describe, expect, it } from 'vitest';
import { BUILTIN_PACKS } from '../data/classicPack';
import { CATEGORIES, type GameState, type SessionConfig } from '../types';
import { ABSTAIN, alive, castVote, continueEvent, createGame, endSpeech, nextRound, pendingReveal, playAction, playPerk, resolveVote, revealCard, revealOptions } from './game';
import { itemsOf, MAX_ITEMS } from './inventory';
import { BONUSES, canApplyPerk, perkOf } from './perks';
import { mulberry32 } from './rng';
import { validateSavedGame } from './storage';

/**
 * Сквозные партии: все встроенные наборы, разные составы и правила, случайные (но воспроизводимые) решения игроков,
 * включая бонусы профессий и карты действий. После каждого шага проверяем инварианты и что сохранение принимается.
 */

const config = (n: number, slots: number, seed: number, reveals: number, scenarioId: string, packId: string): SessionConfig => ({
  scenarioId, packIds: [packId], playerCount: n, shelterSlots: slots, mode: 'pass-and-play', voting: 'open', revealsPerVote: reveals,
  timeLimitMin: 0, speechSec: 0, hazardCount: 2, difficulty: 'normal', roundEvents: true, autoActions: true, professionPerks: true,
  names: Array.from({ length: n }, (_, i) => `И${i + 1}`), seed,
});

let seen = { perksUsed: 0, perksGranted: 0, actionsUsed: 0, bonds: 0, doubles: 0, charged: 0 };
const KEYS = [...Object.keys(BONUSES), 'potion-seller'];

/** Раздаёт нескольким игрокам профессии с особыми бонусами, чтобы партия прошла через каждый из них. */
const withSpecials = (g: GameState, offset: number): GameState => ({
  ...g,
  players: g.players.map((p, i) => {
    if (i > 2) return p;
    const key = KEYS[(offset + i * 5) % KEYS.length];
    const card = { id: `sp-${key}`, category: 'profession' as const, description: `Особая ${key}`, bonus: key, ...(key === 'potion-seller' ? { tags: ['медицина'] } : {}) };
    return { ...p, slots: { ...p.slots, profession: { ...p.slots.profession, card } } };
  }),
});

function invariants(g: GameState, label: string) {
  const ids = new Set(g.players.map((p) => p.id));
  for (const p of g.players) {
    const bag = itemsOf(p.slots.luggage.card);
    expect(bag.length, `${label}: инвентарь ${p.id}`).toBeLessThanOrEqual(MAX_ITEMS);
    for (const c of CATEGORIES) expect(p.slots[c], `${label}: слот ${p.id}/${c}`).toBeDefined();
  }
  const owners = (g.perks ?? []).map((x) => x.playerId);
  if (owners.length) seen.perksGranted++;
  if (g.bonds?.length) seen.bonds++;
  if ((g.perks ?? []).some((x) => x.kind === 'double')) seen.doubles++;
  if ((g.perks ?? []).some((x) => (x.charges ?? 1) > 1)) seen.charged++;
  expect(new Set(owners).size, `${label}: у игрока два бонуса`).toBe(owners.length);
  for (const x of g.perks ?? []) {
    expect(ids.has(x.playerId), `${label}: бонус чужого игрока`).toBe(true);
    if (x.charges !== undefined) expect(x.charges, `${label}: заряды`).toBeGreaterThanOrEqual(1);
  }
  for (const b of g.bonds ?? []) {
    expect(ids.has(b.a) && ids.has(b.b) && b.a !== b.b, `${label}: связь`).toBe(true);
    expect(b.votes, `${label}: срок связи`).toBeGreaterThanOrEqual(1);
    expect(b.votes, `${label}: срок связи`).toBeLessThanOrEqual(2);
  }
  expect(validateSavedGame(JSON.parse(JSON.stringify(g))), `${label}: сохранение отклонено`).not.toBeNull();
}

function play(g0: GameState, rng: () => number, label: string): GameState {
  let g = g0;
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  for (let step = 0; step < 600; step++) {
    invariants(g, `${label} шаг ${step} (${g.phase})`);
    if (g.phase === 'final') return g;
    const others = (id: string) => alive(g).filter((p) => p.id !== id);
    if (g.phase === 'event') g = continueEvent(g);
    else if (g.phase === 'speech') g = endSpeech(g);
    else if (g.phase === 'reveal') {
      const sp = pendingReveal(g)[0];
      if (!sp) { const same = g; g = nextRound(g); if (g === same) throw new Error(`${label}: партия застряла в reveal`); continue; }
      const rest = others(sp.id);
      if (rest.length >= 2 && rng() < 0.6) {
        const perk = perkOf(g, sp.id);
        if (perk) {
          const [a, b] = [pick(rest), pick(rest)];
          const hidden = (id: string) => CATEGORIES.filter((c) => c !== 'action' && !g.players.find((p) => p.id === id)!.slots[c].isRevealed);
          const params = { target: a.id, target2: b.id !== a.id ? b.id : rest.find((p) => p.id !== a.id)!.id, category: hidden(a.id)[0] };
          if (canApplyPerk(g, sp.id, params).ok) { const before = g; g = playPerk(g, sp.id, params); if (g !== before) seen.perksUsed++; }
        }
      }
      if (g.phase === 'reveal' && rest.length && rng() < 0.3 && !sp.slots.action.isRevealed) {
        const tg = pick(rest);
        const hidden = CATEGORIES.filter((c) => c !== 'action' && !tg.slots[c].isRevealed);
        const before = g;
        g = playAction(g, sp.id, { target: tg.id, category: hidden.length ? pick(hidden) : undefined });
        if (g !== before) seen.actionsUsed++;
      }
      const cur = pendingReveal(g)[0];
      if (g.phase === 'reveal' && cur) {
        const opts = revealOptions(g, g.players.find((p) => p.id === cur.id)!);
        g = revealCard(g, cur.id, pick(opts));
      }
    } else if (g.phase === 'vote') {
      for (const v of alive(g)) {
        const choices = [...others(v.id).map((p) => p.id), ABSTAIN];
        g = castVote(g, v.id, rng() < 0.1 ? ABSTAIN : pick(choices));
      }
      g = resolveVote(g);
    } else if (g.phase === 'result') g = nextRound(g);
    else throw new Error(`${label}: неожиданная фаза ${g.phase}`);
  }
  throw new Error(`${label}: партия не закончилась за 600 шагов (фаза ${g.phase})`);
}

describe('сквозные партии по всем наборам', () => {
  for (const pack of BUILTIN_PACKS) {
    it(`${pack.name}: партии с бонусами и действиями доходят до конца, инварианты держатся`, () => {
      let games = 0;
      seen = { perksUsed: 0, perksGranted: 0, actionsUsed: 0, bonds: 0, doubles: 0, charged: 0 };
      for (const sc of pack.scenarios) {
        for (const [n, slots, reveals] of [[3, 1, 1], [5, 2, 2], [7, 3, 1], [8, 3, 3]] as const) {
          for (const seed of [3, 11]) {
            const label = `${pack.id}/${sc.id} n=${n} seed=${seed}`;
            const rng = mulberry32(seed * 7919 + n);
            const g = withSpecials(createGame(config(n, slots, seed, reveals, sc.id, pack.id), sc, [pack]), seed + n + games);
            const end = play(g, rng, label);
            expect(end.phase, label).toBe('final');
            games++;
          }
        }
      }
      expect(games).toBeGreaterThan(10);
      expect(seen.perksUsed, 'бонусы не применялись').toBeGreaterThan(0);
      expect(seen.actionsUsed, 'действия не применялись').toBeGreaterThan(0);
    });
  }
});
