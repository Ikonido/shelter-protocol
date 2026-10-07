import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import { CATEGORIES, type SessionConfig } from '../types';
import { alive, buildSchedule, castVote, createGame, nextRound, pendingReveal, resolveVote, revealCard, revealOptions, startVote } from './game';
import { evaluate } from './evaluate';
import { decodePack, encodePack, sanitizePack } from './packs';

const config = (n = 6, k = 3): SessionConfig => ({
  scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: ['classic'], playerCount: n, shelterSlots: k,
  mode: 'pass-and-play', voting: 'open', names: Array.from({ length: n }, (_, i) => `P${i + 1}`), seed: 42,
});
const newGame = (n = 6, k = 3) => createGame(config(n, k), CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);

describe('schedule', () => {
  it('sums to N-K and caps rounds', () => {
    expect(buildSchedule(12, 4)).toEqual([2, 2, 1, 1, 1, 1]);
    expect(buildSchedule(5, 4)).toEqual([1]);
    for (let n = 2; n <= 20; n++) for (let k = 1; k < n; k++) {
      const s = buildSchedule(n, k);
      expect(s.reduce((a, b) => a + b, 0)).toBe(n - k);
      expect(s.length).toBeLessThanOrEqual(6);
    }
  });
});

describe('generation', () => {
  it('is deterministic per seed and gives everyone 7 cards', () => {
    const a = newGame(), b = newGame();
    expect(a.players).toEqual(b.players);
    for (const p of a.players) for (const c of CATEGORIES) expect(p.slots[c].card.category).toBe(c);
  });
  it('does not repeat professions while the pool suffices', () => {
    const g = newGame(10, 3);
    const ids = g.players.map((p) => p.slots.profession.card.id);
    expect(new Set(ids).size).toBe(10);
  });
});

describe('round flow', () => {
  it('forces biology (sex & age) in round 1, then moves to debate, vote, result', () => {
    let g = newGame();
    expect(revealOptions(g, g.players[0])).toEqual(['biology']);
    for (const p of g.players) g = revealCard(g, p.id, 'biology');
    expect(g.phase).toBe('debate');
    expect(pendingReveal(g)).toHaveLength(0);
    g = startVote(g);
    for (const p of g.players) g = castVote(g, p.id, g.players.find((x) => x.id !== p.id && x.id === 'p1')?.id ?? 'p2');
    g = resolveVote(g);
    expect(g.phase).toBe('result');
    expect(alive(g)).toHaveLength(5);
    expect(g.players[0].isEliminated).toBe(true);
    g = nextRound(g);
    expect(g.round).toBe(2);
    expect(g.phase).toBe('reveal');
  });
  it('after the forced sex/age reveal, later rounds are free choice', () => {
    let g = newGame();
    for (const p of g.players) g = revealCard(g, p.id, 'biology');
    g = resolveVote(Object.assign(startVote(g), {}));
    g = nextRound(g);
    const opts = revealOptions(g, g.players.find((p) => !p.isEliminated)!);
    expect(opts).toEqual(['profession', 'health', 'hobby', 'luggage', 'fact']); // biology уже открыта, action — не открывается
  });
  it('rejects self votes and double reveal', () => {
    const g = newGame();
    expect(castVote(g, 'p1', 'p1').votes).toEqual({});
    const r = revealCard(g, 'p1', 'biology');
    expect(revealCard(r, 'p1', 'biology')).toBe(r);
  });
});

describe('evaluate', () => {
  it('rewards covered skills and flags missing ones', () => {
    const g = newGame(8, 4);
    const doctors = g.players.map((p) => ({ ...p, slots: { ...p.slots, profession: { ...p.slots.profession, card: { ...p.slots.profession.card, tags: ['медицина'] } } } }));
    const sc = { ...g.scenario, requiredSkills: ['медицина', 'телепортация'] };
    const ev = evaluate(sc, doctors.slice(0, 4));
    expect(ev.coverage[0].by.length).toBe(4);
    expect(ev.coverage[1].by).toEqual([]);
    expect(ev.notes.join()).toContain('телепортация');
    expect(ev.verdict).not.toBe('survived');
  });
  it('handles no survivors', () => {
    expect(evaluate(CLASSIC_PACK.scenarios[0], []).verdict).toBe('failed');
  });
});

describe('packs', () => {
  it('round-trips through lz-string', () => {
    const back = decodePack(encodePack(CLASSIC_PACK));
    expect(back?.name).toBe(CLASSIC_PACK.name);
    expect(back?.cards.profession.length).toBe(CLASSIC_PACK.cards.profession.length);
  });
  it('sanitizes hostile input', () => {
    expect(sanitizePack(null)).toBeNull();
    expect(sanitizePack({ name: '' })).toBeNull();
    const p = sanitizePack({ name: 'x', cards: { profession: [{ description: 'a', modifier: 'evil', tags: 'no' }, 5, {}] }, scenarios: [{ title: 't', shelterSlots: 9999 }] })!;
    expect(p.cards.profession).toHaveLength(1);
    expect(p.cards.profession[0].modifier).toBeUndefined();
    expect(p.scenarios[0].shelterSlots).toBe(19);
    expect(decodePack('garbage!!')).toBeNull();
  });
});
