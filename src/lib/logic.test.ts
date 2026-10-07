import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import { CATEGORIES, type SessionConfig } from '../types';
import { ABSTAIN, alive, applyOvertime, buildSchedule, castVote, createGame, finishDebate, maxRoundsFor, nextRound, pendingReveal, resolveVote, revealCard, revealOptions, startVote, suggestedDebateSec } from './game';
import { evaluate } from './evaluate';
import { decodePack, encodePack, sanitizePack } from './packs';

const config = (n = 6, k = 3, revealsPerVote = 1, timeLimitMin = 0): SessionConfig => ({
  scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: ['classic'], playerCount: n, shelterSlots: k,
  mode: 'pass-and-play', voting: 'open', revealsPerVote, timeLimitMin, names: Array.from({ length: n }, (_, i) => `P${i + 1}`), seed: 42,
});
const newGame = (n = 6, k = 3, rpv = 1, limit = 0) => createGame(config(n, k, rpv, limit), CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);

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

const revealAll = (g: ReturnType<typeof newGame>, cat?: Parameters<typeof revealCard>[2]) => {
  for (const p of pendingReveal(g)) g = revealCard(g, p.id, cat ?? revealOptions(g, p)[0]);
  return g;
};

describe('voting every N reveals', () => {
  it('two reveals (with debates) happen before each vote', () => {
    let g = newGame(6, 3, 2);
    expect(g.phase).toBe('reveal');
    g = revealAll(g);                       // 1-е вскрытие: биология
    expect(g.phase).toBe('debate');
    g = finishDebate(g);                    // не голосование, а второе вскрытие
    expect(g.phase).toBe('reveal');
    expect(g.revealStep).toBe(2);
    expect(revealOptions(g, g.players[0])).toEqual(['profession', 'health', 'hobby', 'luggage', 'fact']); // дальше по желанию
    g = revealAll(g, 'hobby');
    g = finishDebate(g);
    expect(g.phase).toBe('vote');
    expect(g.players.every((p) => p.slots.biology.isRevealed && p.slots.hobby.isRevealed)).toBe(true);
  });

  it('limits rounds so open cards suffice for all reveals', () => {
    expect(maxRoundsFor(1)).toBe(6);
    expect(maxRoundsFor(2)).toBe(3);
    expect(maxRoundsFor(3)).toBe(2);
    expect(buildSchedule(12, 4, maxRoundsFor(2))).toEqual([3, 3, 2]);
    expect(newGame(12, 4, 2).schedule).toEqual([3, 3, 2]);
  });

  it('next round starts again from the first reveal', () => {
    let g = newGame(6, 3, 2);
    g = finishDebate(revealAll(g)); g = finishDebate(revealAll(g));
    g = startVote(g);
    for (const p of g.players) g = castVote(g, p.id, p.id === 'p1' ? 'p2' : 'p1');
    g = nextRound(resolveVote(g));
    expect(g.round).toBe(2);
    expect(g.revealStep).toBe(1);
    expect(g.phase).toBe('reveal');
  });
});

describe('abstain', () => {
  const vote = (votes: Record<string, string>, n = 6, k = 3) => {
    let g = startVote(newGame(n, k));
    for (const [v, t] of Object.entries(votes)) g = castVote(g, v, t);
    return resolveVote(g);
  };
  it('majority abstaining -> nobody leaves, quota moves to an extra round', () => {
    const g = vote({ p1: ABSTAIN, p2: ABSTAIN, p3: ABSTAIN, p4: ABSTAIN, p5: 'p1', p6: 'p1' });
    expect(g.lastResult).toMatchObject({ skipped: true, abstained: 4, eliminated: [] });
    expect(alive(g)).toHaveLength(6);
    expect(g.schedule).toEqual([1, 1, 1, 1]); // было 3 раунда по 1, добавлен ещё один
    const next = nextRound(g);
    expect(next.round).toBe(2);
  });
  it('exactly half is not a majority; abstentions are not counted against anyone', () => {
    const g = vote({ p1: ABSTAIN, p2: ABSTAIN, p3: ABSTAIN, p4: 'p6', p5: 'p6', p6: 'p5' });
    expect(g.lastResult?.skipped).toBeFalsy();
    expect(g.lastResult?.abstained).toBe(3);
    expect(g.players.find((p) => p.id === 'p6')!.isEliminated).toBe(true);
    expect(Object.values(g.lastResult!.tally).reduce((a, b) => a + b, 0)).toBe(3); // только настоящие голоса
  });
  it('cannot extend rounds forever', () => {
    let g = newGame(6, 3);
    for (let i = 0; i < 12 && g.phase !== 'final'; i++) {
      g = startVote({ ...g, phase: 'debate' });
      for (const p of alive(g)) g = castVote(g, p.id, ABSTAIN);
      g = nextRound(resolveVote(g));
    }
    expect(g.phase).toBe('final');
    expect(alive(g)).toHaveLength(6); // все остались -> в финале бункер переполнен
  });
});

describe('match timer', () => {
  it('no limit -> no deadline, overtime is a no-op', () => {
    const g = newGame();
    expect(g.deadline).toBeUndefined();
    expect(applyOvertime(g, Date.now() + 1e9)).toBe(g);
    expect(suggestedDebateSec(g)).toBeNull();
  });
  it('before the deadline nothing happens; after it debates are skipped and cards auto-revealed, vote stays manual', () => {
    const g = newGame(6, 3, 2, 30);
    const t0 = g.deadline! - 30 * 60_000;
    expect(applyOvertime(g, t0 + 60_000)).toBe(g);
    const late = applyOvertime(g, g.deadline! + 1);
    expect(late.phase).toBe('vote');
    expect(late.votes).toEqual({});
    expect(late.players.every((p) => ['biology', 'profession', 'health', 'hobby', 'luggage', 'fact'].filter((c) => p.slots[c as 'biology'].isRevealed).length === 2)).toBe(true);
  });
  it('suggests shorter debates when time is short, within bounds', () => {
    const g = { ...newGame(6, 3, 2, 30), phase: 'debate' as const };
    const roomy = suggestedDebateSec(g, g.deadline! - 30 * 60_000)!;
    const tight = suggestedDebateSec(g, g.deadline! - 2 * 60_000)!;
    expect(roomy).toBeGreaterThan(tight);
    expect(tight).toBeGreaterThanOrEqual(20);
    expect(roomy).toBeLessThanOrEqual(240);
  });
  it('overcrowded shelter is penalised', () => {
    const g = newGame(6, 3);
    const few = evaluate(g.scenario, g.players.slice(0, 3), 3);
    const many = evaluate(g.scenario, g.players, 3);
    expect(many.notes.join()).toContain('переполнен');
    expect(many.score).toBeLessThan(few.score + 1);
  });
});
