import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import { CATEGORIES, type SessionConfig } from '../types';
import { ABSTAIN, applyEvent, continueEvent, volunteer, alive, applyOvertime, buildSchedule, castVote, createGame, currentSpeaker, endSpeech, maxRoundsFor, nextRound, pendingReveal, resolveVote, revealCard, revealOptions, startVote, tickGame } from './game';
import { evaluate } from './evaluate';
import type { Hazard } from '../types';
import { EVENTS, drawEvent, isEligible } from './events';
import { decodePack, encodePack, sanitizePack, sanitizeHazard } from './packs';

const config = (n = 6, k = 3, revealsPerVote = 1, timeLimitMin = 0, speechSec = 0, hazardCount = 0, difficulty: SessionConfig['difficulty'] = 'normal', roundEvents = false): SessionConfig => ({
  scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: ['classic'], playerCount: n, shelterSlots: k,
  mode: 'pass-and-play', voting: 'open', revealsPerVote, timeLimitMin, speechSec, hazardCount, difficulty, roundEvents, names: Array.from({ length: n }, (_, i) => `P${i + 1}`), seed: 42,
});
const newGame = (n = 6, k = 3, rpv = 1, limit = 0, speech = 0, hazards = 0, scenarioIdx = 0, events = false, difficulty: SessionConfig['difficulty'] = 'normal') =>
  createGame(config(n, k, rpv, limit, speech, hazards, difficulty, events), CLASSIC_PACK.scenarios[scenarioIdx], [CLASSIC_PACK]);

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

/** Проходит одно вскрытие целиком: каждый по очереди открывает карту (и, если есть речь, её заканчивает). */
const revealAll = (g: ReturnType<typeof newGame>, cat?: Parameters<typeof revealCard>[2]) => {
  const step = g.revealStep, round = g.round;
  for (let i = 0; i < 50 && g.phase !== 'vote' && g.revealStep === step && g.round === round; i++) {
    const p = currentSpeaker(g)!;
    g = revealCard(g, p.id, cat && revealOptions(g, p).includes(cat) ? cat : revealOptions(g, p)[0]);
    g = endSpeech(g);
  }
  return g;
};

describe('round flow', () => {
  it('forces biology (sex & age) in round 1, then reveals one by one, then vote and result', () => {
    let g = newGame();
    expect(revealOptions(g, g.players[0])).toEqual(['biology']);
    g = revealAll(g);
    expect(g.phase).toBe('vote');
    expect(pendingReveal(g)).toHaveLength(0);
    for (const p of g.players) g = castVote(g, p.id, p.id === 'p1' ? 'p2' : 'p1');
    g = resolveVote(g);
    expect(g.phase).toBe('result');
    expect(alive(g)).toHaveLength(5);
    expect(g.players[0].isEliminated).toBe(true);
    g = nextRound(g);
    expect(g.round).toBe(2);
    expect(g.phase).toBe('reveal');
  });
  it('players go strictly in turn', () => {
    const g = newGame();
    expect(currentSpeaker(g)!.id).toBe('p1');
    expect(revealCard(g, 'p2', 'biology')).toBe(g); // не его очередь
    const r = revealCard(g, 'p1', 'biology');
    expect(revealCard(r, 'p1', 'biology')).toBe(r); // дважды нельзя
    expect(currentSpeaker(r)!.id).toBe('p2');
  });
  it('after the forced sex/age reveal, later rounds are free choice', () => {
    let g = newGame();
    g = revealAll(g);
    g = startVote(g);
    g = resolveVote(g);
    g = nextRound(g);
    const opts = revealOptions(g, g.players.find((p) => !p.isEliminated)!);
    expect(opts).toEqual(['profession', 'physique', 'character', 'health', 'hobby', 'luggage', 'fact']); // biology уже открыта, action — не открывается
  });
  it('rejects self votes', () => {
    expect(castVote(newGame(), 'p1', 'p1').votes).toEqual({});
  });
});

describe('speech after each reveal', () => {
  it('reveal starts a timed speech, then the next player is up', () => {
    const g = revealCard(newGame(6, 3, 1, 0, 45), 'p1', 'biology');
    expect(g.phase).toBe('speech');
    expect(currentSpeaker(g)!.id).toBe('p1');
    expect(g.lastReveal).toEqual({ playerId: 'p1', category: 'biology' });
    expect(g.speechEndsAt!).toBeGreaterThan(Date.now() + 44_000);
    const next = endSpeech(g);
    expect(next.phase).toBe('reveal');
    expect(currentSpeaker(next)!.id).toBe('p2');
    expect(endSpeech(next)).toBe(next); // вне речи ничего не делает
  });
  it('speechSec = 0 means no speech phase', () => {
    expect(revealCard(newGame(), 'p1', 'biology').phase).toBe('reveal');
  });
  it('tick ends the speech when the timer is over, not before', () => {
    const g = revealCard(newGame(6, 3, 1, 0, 30), 'p1', 'biology');
    expect(tickGame(g, g.speechEndsAt! - 1000)).toBe(g);
    const after = tickGame(g, g.speechEndsAt! + 1);
    expect(after.phase).toBe('reveal');
    expect(currentSpeaker(after)!.id).toBe('p2');
  });
  it('the last speech of the last reveal leads to the vote', () => {
    let g = newGame(3, 1, 1, 0, 30);
    for (const id of ['p1', 'p2', 'p3']) g = tickGame(revealCard(g, id, 'biology'), Date.now() + 31_000);
    expect(g.phase).toBe('vote');
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


describe('voting every N reveals', () => {
  it('two reveals (each player explains after theirs) happen before each vote', () => {
    let g = newGame(6, 3, 2, 0, 30);
    expect(g.phase).toBe('reveal');
    for (const p of g.players) { g = revealCard(g, p.id, 'biology'); expect(g.phase).toBe('speech'); g = endSpeech(g); }
    expect(g.phase).toBe('reveal'); // не голосование, а второе вскрытие
    expect(g.revealStep).toBe(2);
    expect(currentSpeaker(g)!.id).toBe('p1'); // очередь заново с первого
    expect(revealOptions(g, g.players[0])).toEqual(['profession', 'physique', 'character', 'health', 'hobby', 'luggage', 'fact']); // дальше по желанию
    for (const p of g.players) g = endSpeech(revealCard(g, p.id, 'hobby'));
    expect(g.phase).toBe('vote');
    expect(g.players.every((p) => p.slots.biology.isRevealed && p.slots.hobby.isRevealed)).toBe(true);
  });

  it('limits rounds so open cards suffice for all reveals', () => {
    expect(maxRoundsFor(1)).toBe(6);
    expect(maxRoundsFor(2)).toBe(4);
    expect(maxRoundsFor(3)).toBe(2);
    expect(buildSchedule(12, 4, maxRoundsFor(2))).toEqual([2, 2, 2, 2]);
    expect(newGame(12, 4, 2).schedule).toEqual([2, 2, 2, 2]);
  });

  it('next round starts again from the first reveal', () => {
    let g = newGame(6, 3, 2);
    g = revealAll(revealAll(g));
    expect(g.phase).toBe('vote');
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
      g = startVote({ ...g, phase: 'reveal' });
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
  });
  it('before the deadline nothing happens; after it speeches are skipped and cards auto-revealed, vote stays manual', () => {
    const g = newGame(6, 3, 2, 30, 45);
    const t0 = g.deadline! - 30 * 60_000;
    expect(applyOvertime(g, t0 + 60_000)).toBe(g);
    const late = applyOvertime(g, g.deadline! + 1);
    expect(late.phase).toBe('vote');
    expect(late.votes).toEqual({});
    expect(late.players.every((p) => ['biology', 'profession', 'physique', 'character', 'health', 'hobby', 'luggage', 'fact'].filter((c) => p.slots[c as 'biology'].isRevealed).length === 2)).toBe(true);
  });
  it('overcrowded shelter is penalised', () => {
    const g = newGame(6, 3);
    // нейтральные карты, чтобы сравнивалась только теснота, а не случайная раздача
    const plain = g.players.map((p) => {
      const slots = { ...p.slots };
      for (const c of ['profession', 'hobby', 'fact', 'luggage'] as const) {
        slots[c] = { ...slots[c], card: { ...slots[c].card, description: 'Обычный человек', title: undefined, tags: [] } };
      }
      return { ...p, slots };
    });
    const few = evaluate(g.scenario, plain.slice(0, 3), 3);
    const many = evaluate(g.scenario, plain, 3);
    expect(many.notes.join()).toContain('переполнен');
    expect(many.score).toBeLessThanOrEqual(few.score);
  });
});

describe('threat factors', () => {
  const rats: Hazard = { id: 'h-rats', title: 'Крысы на корабле', description: '', severity: 'major', counters: ['дератизация', 'санитария'] };
  const leak: Hazard = { id: 'h-leak', title: 'Течь в корпусе', description: '', severity: 'critical', counters: ['инженерия'] };
  const mold: Hazard = { id: 'h-mold', title: 'Плесень', description: '', severity: 'minor', counters: ['санитария'] };
  /** Детерминированные выжившие: у всех нейтральные карты без тегов, кроме профессии с заданными тегами. */
  const withTags = (g: ReturnType<typeof newGame>, tagsByPlayer: string[][]) =>
    g.players.map((p, i) => {
      const plain = (c: 'profession' | 'hobby' | 'fact' | 'luggage', tags: string[]) => ({
        card: { ...p.slots[c].card, description: 'Обычный человек', title: undefined, tags },
        isRevealed: p.slots[c].isRevealed,
      });
      return { ...p, slots: { ...p.slots, profession: plain('profession', tagsByPlayer[i] ?? []), hobby: plain('hobby', []), fact: plain('fact', []), luggage: plain('luggage', []) } };
    });

  it('picks a seeded random subset from the scenario pool', () => {
    const a = newGame(6, 3, 1, 0, 0, 2, 2), b = newGame(6, 3, 1, 0, 0, 2, 2);
    expect(a.hazards).toHaveLength(2);
    expect(a.hazards).toEqual(b.hazards);
    expect(newGame(6, 3, 1, 0, 0, 0).hazards).toEqual([]);
    expect(newGame(6, 3, 1, 0, 0, 4).hazards).toHaveLength(4);
    expect(newGame(6, 3, 1, 0, 0, 99).hazards!.length).toBeLessThanOrEqual(CLASSIC_PACK.scenarios[0].hazards!.length);
  });

  it('every built-in hazard can actually be countered by some card in the pack', () => {
    const all = Object.values(CLASSIC_PACK.cards).flat();
    for (const sc of CLASSIC_PACK.scenarios) for (const h of sc.hazards ?? []) {
      expect(all.some((c) => h.counters.some((t) => c.tags?.includes(t))), `${sc.id}/${h.id}`).toBe(true);
    }
  });

  it('an un-neutralized critical hazard destroys the shelter whatever the score', () => {
    const g = newGame(6, 3);
    const ev = evaluate({ ...g.scenario, requiredSkills: [] }, withTags(g, [[], [], []]).slice(0, 3), 3, [leak]);
    expect(ev.verdict).toBe('failed');
    expect(ev.headline).toContain('Течь в корпусе');
    expect(ev.notes.join()).toContain('гибель');
  });

  it('neutralized hazards list who removed them; a leftover minor hazard blocks the full win', () => {
    const g = newGame(6, 3);
    const survivors = withTags(g, [['инженерия'], ['дератизация'], ['санитария']]).slice(0, 3);
    const sc = { ...g.scenario, requiredSkills: [] };
    const ok = evaluate(sc, survivors, 3, [leak, rats]);
    expect(ok.hazards.map((r) => r.by.length > 0)).toEqual([true, true]);
    expect(ok.hazards[1].by).toEqual(['P2', 'P3']); // и дератизатор, и санитар подходят
    const noSanitary = evaluate(sc, survivors.slice(0, 2), 3, [leak, rats, mold]);
    expect(noSanitary.hazards[2].by).toEqual([]);
    expect(noSanitary.verdict).not.toBe('survived');
    expect(noSanitary.verdict).not.toBe('failed'); // критическая закрыта, остались лёгкие
    // без угроз прежняя оценка не меняется
    expect(evaluate(sc, survivors, 3).hazards).toEqual([]);
  });

  it('open hazards lower the score by severity', () => {
    const g = newGame(6, 3);
    const survivors = withTags(g, [['санитария'], [], []]).slice(0, 3);
    const sc = { ...g.scenario, requiredSkills: [] };
    const none = evaluate(sc, survivors, 3, []).score;
    expect(evaluate(sc, survivors, 3, [rats]).score).toBe(none); // нейтрализована
    expect(evaluate(sc, withTags(g, [[], [], []]).slice(0, 3), 3, [rats]).score).toBeLessThan(none);
  });
});

describe('hazard data hygiene', () => {
  it('sanitizes hazards in packs: limits, severity whitelist, empty titles dropped', () => {
    const hazards = Array.from({ length: 20 }, (_, i) => ({ title: 'T' + 'x'.repeat(100), description: 'd'.repeat(500), severity: i % 2 ? 'evil' : 'critical', counters: ['a', 'b', 'c', 'd', 'e', 'f'] }));
    const p = sanitizePack({ name: 'x', scenarios: [{ title: 't', hazards: [...hazards, { title: '' }, 5] }] })!;
    const hs = p.scenarios[0].hazards!;
    expect(hs).toHaveLength(8);
    expect(hs[0].title.length).toBe(40);
    expect(hs[0].description.length).toBe(160);
    expect(hs[0].counters).toHaveLength(4);
    expect(hs.map((h) => h.severity)).toContain('major'); // «evil» -> major
    expect(hs.every((h) => ['critical', 'major', 'minor'].includes(h.severity))).toBe(true);
    expect(sanitizeHazard({ title: '' }, 0)).toBeNull();
  });
  it('round-trips through the share link', () => {
    const back = decodePack(encodePack(CLASSIC_PACK));
    expect(back?.scenarios[2].hazards?.length).toBe(CLASSIC_PACK.scenarios[2].hazards!.length);
  });
});

describe('difficulty', () => {
  const g0 = newGame(8, 4);
  const sc = { ...g0.scenario, requiredSkills: [] as string[] };
  const crit: Hazard = { id: 'c', title: 'Течь', description: '', severity: 'critical', counters: ['инженерия'] };
  const plain = (tags: string[][]) =>
    g0.players.slice(0, tags.length).map((p, i) => ({
      ...p,
      slots: Object.fromEntries(Object.entries(p.slots).map(([c, sl]) => [c, ['profession', 'hobby', 'fact', 'luggage'].includes(c)
        ? { ...sl, card: { ...sl.card, description: 'Обычный человек', title: undefined, tags: c === 'profession' ? tags[i] : [] } } : sl])) as typeof p.slots,
    }));

  it('presets are ordered from forgiving to harsh', async () => {
    const { DIFFICULTIES, DIFFICULTY_ORDER, rulesFor } = await import('./difficulty');
    const rs = DIFFICULTY_ORDER.map((d) => DIFFICULTIES[d]);
    for (let i = 1; i < rs.length; i++) {
      expect(rs[i].hazardCount).toBeGreaterThan(rs[i - 1].hazardCount);
      expect(rs[i].winScore).toBeGreaterThan(rs[i - 1].winScore);
      expect(rs[i].hazardPenalty.critical).toBeGreaterThan(rs[i - 1].hazardPenalty.critical);
      expect(rs[i].speechSec).toBeLessThan(rs[i - 1].speechSec);
    }
    expect(rulesFor(undefined)).toBe(DIFFICULTIES.normal); // старые сохранения
    expect(rulesFor('bogus' as never)).toBe(DIFFICULTIES.normal);
  });

  it('easy: one unremoved deadly threat is not fatal; normal: it is', () => {
    const survivors = plain([[], [], [], []]);
    expect(evaluate(sc, survivors, 4, [crit], 'normal').verdict).toBe('failed');
    const easy = evaluate(sc, survivors, 4, [crit], 'easy');
    expect(easy.verdict).toBe('fragile'); // не гибель, но и не победа
    expect(easy.notes.join()).not.toContain('гибель');
    expect(evaluate(sc, survivors, 4, [crit, { ...crit, id: 'c2' }], 'easy').verdict).toBe('failed'); // две — уже фатально
  });

  it('nightmare: a deadly threat needs two different survivors', () => {
    const one = plain([['инженерия'], [], [], []]);
    const two = plain([['инженерия'], ['инженерия'], [], []]);
    expect(evaluate(sc, one, 4, [crit], 'hard').hazards[0]).toMatchObject({ need: 1, ok: true });
    const bad = evaluate(sc, one, 4, [crit], 'nightmare');
    expect(bad.hazards[0]).toMatchObject({ need: 2, ok: false });
    expect(bad.verdict).toBe('failed');
    expect(bad.notes.join()).toContain('нужно 2, есть 1');
    expect(evaluate(sc, two, 4, [crit], 'nightmare').hazards[0].ok).toBe(true);
  });

  it('same survivors score lower on harder levels when threats are open', () => {
    const survivors = plain([[], [], [], []]);
    const major: Hazard = { ...crit, id: 'm', severity: 'major' };
    const scores = (['easy', 'normal', 'hard', 'nightmare'] as const).map((d) => evaluate(sc, survivors, 4, [major], d).score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
  });
});

describe('round events', () => {
  const ev = (id: string) => EVENTS.find((e) => e.id === id)!;
  const withEvents = (n = 8, k = 4) => newGame(n, k, 1, 0, 45, 2, 2, true);

  it('a crisis card opens the round before any reveal, then play continues', () => {
    const g = withEvents();
    expect(g.phase).toBe('event');
    expect(g.event).toBeDefined();
    expect(g.usedEvents).toEqual([g.event!.id]);
    expect(g.revealedThisRound).toEqual([]);
    const next = continueEvent(g);
    expect(next.phase).toBe('reveal');
    expect(continueEvent(next)).toBe(next);
    expect(newGame(8, 4).phase).toBe('reveal'); // события выключены -> как раньше
  });

  it('events never repeat within a game and the next round gets a new one', () => {
    let g = withEvents(12, 3);
    const seen = new Set<string>([g.event!.id]);
    for (let i = 0; i < 3 && g.phase !== 'final'; i++) {
      g = continueEvent(g);
      for (let guard = 0; guard < 80 && g.phase !== 'vote'; guard++) {
        const p = currentSpeaker(g)!;
        g = endSpeech(revealCard(g, p.id, revealOptions(g, p)[0]));
      }
      for (const p of alive(g)) g = castVote(g, p.id, alive(g).find((x) => x.id !== p.id)!.id);
      g = nextRound(resolveVote(g));
      if (g.event) { expect(seen.has(g.event.id)).toBe(false); seen.add(g.event.id); }
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('shrink: one seat fewer and one more elimination this round', () => {
    const g = withEvents();
    const r = applyEvent(g, ev('vent'));
    expect(r.config.shelterSlots).toBe(g.config.shelterSlots - 1);
    expect(r.schedule[0]).toBe(g.schedule[0] + 1);
  });

  it('plague: only players with bad health reveal it', () => {
    const g = withEvents();
    const r = applyEvent(g, ev('plague'));
    for (const p of r.players) expect(p.slots.health.isRevealed).toBe(p.slots.health.card.modifier === 'negative');
    // нет больных -> событие неприменимо
    const healthy = { ...g, players: g.players.map((p) => ({ ...p, slots: { ...p.slots, health: { ...p.slots.health, card: { ...p.slots.health.card, modifier: 'positive' as const } } } })) };
    expect(isEligible(ev('plague'), healthy)).toBe(false);
  });

  it('leak: everyone reveals one more random card, biology stays for the forced reveal in round 1', () => {
    const g = withEvents();
    const r = applyEvent(g, ev('leak'));
    for (const p of r.players) {
      const open = (['profession', 'biology', 'physique', 'character', 'health', 'hobby', 'luggage', 'fact'] as const).filter((c) => p.slots[c].isRevealed);
      expect(open).toHaveLength(1);
      expect(open).not.toContain('biology');
    }
  });

  it('silence halves the speech time of the round', () => {
    const g = continueEvent(applyEvent(withEvents(), ev('silence')));
    expect(g.speechFactor).toBe(0.5);
    const after = revealCard(g, currentSpeaker(g)!.id, 'biology');
    const ms = after.speechEndsAt! - Date.now();
    expect(ms).toBeGreaterThan(21_000);
    expect(ms).toBeLessThan(23_500);
  });

  it('newHazard adds an unused threat; relief removes the lightest non-critical one', () => {
    const g = withEvents();
    const before = g.hazards!.length;
    const more = applyEvent(g, ev('trouble'));
    expect(more.hazards!.length).toBe(before + 1);
    expect(new Set(more.hazards!.map((h) => h.id)).size).toBe(before + 1);
    const mixed: Hazard[] = [
      { id: 'a', title: 'A', description: '', counters: [], severity: 'critical' },
      { id: 'b', title: 'B', description: '', counters: [], severity: 'major' },
      { id: 'c', title: 'C', description: '', counters: [], severity: 'minor' },
    ];
    const relieved = applyEvent({ ...g, hazards: mixed }, ev('relief'));
    expect(relieved.hazards!.map((h) => h.id)).toEqual(['a', 'b']);
    expect(isEligible(ev('relief'), { ...g, hazards: [mixed[0]] })).toBe(false);
  });

  it('volunteer leaves instead of a vote; a covered quota skips the ballot; ends the game when seats are enough', () => {
    let g = applyEvent(withEvents(8, 4), ev('volunteer'));
    g = { ...g, phase: 'event' };
    const q = g.schedule[0];
    const v = volunteer(g, 'p3');
    expect(v.players.find((p) => p.id === 'p3')!.isEliminated).toBe(true);
    expect(v.schedule[0]).toBe(q - 1);
    expect(v.event!.outcome.join()).toContain('добровольно');
    expect(volunteer(continueEvent(v), 'p4')).toEqual(continueEvent(v)); // вне фазы события нельзя
    // квота 1 -> один доброволец закрывает её, голосования нет
    let one: ReturnType<typeof newGame> = { ...applyEvent(withEvents(8, 4), ev('volunteer')), phase: 'event', schedule: [1, 1, 1, 1] };
    one = volunteer(one, 'p2');
    expect(one.schedule[0]).toBe(0);
    const res = startVote(one);
    expect(res.phase).toBe('result');
    expect(res.lastResult).toMatchObject({ noVote: true, eliminated: [] });
    expect(alive(nextRound(res))).toHaveLength(7);
    // мест уже достаточно -> финал
    const tight = { ...applyEvent(newGame(5, 4, 1, 0, 0, 0, 0, true), ev('volunteer')), phase: 'event' as const, schedule: [1] };
    expect(volunteer(tight, 'p1').phase).toBe('final');
  });

  it('weights favour good events on easy and bad ones on nightmare', () => {
    const share = (d: SessionConfig['difficulty']) => {
      let bad = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const g = { ...newGame(8, 4, 1, 0, 45, 2, 2, false, d), seed, round: 1 };
        if (drawEvent(g)?.tone === 'bad') bad++;
      }
      return bad / 300;
    };
    expect(share('nightmare')).toBeGreaterThan(share('easy') + 0.15);
  });

  it('overtime skips the event card', () => {
    const g = newGame(8, 4, 1, 30, 45, 2, 2, true);
    expect(g.phase).toBe('event');
    const late = applyOvertime(g, g.deadline! + 1);
    expect(['vote', 'result']).toContain(late.phase);
  });
});

import { HAZARD_TEMPLATES, SCENARIO_TEMPLATES } from '../data/templates';
import { cardsWithSkill, skillCards, skillVocabulary, validateScenario } from './vocab';
import { mergePools } from './generator';
import type { CardPack } from '../types';

describe('scenario builder logic', () => {
  const classic = CLASSIC_PACK;
  const customWith = (over: Partial<CardPack>): CardPack => ({ id: 'mine', name: 'Мои', description: '', isCustom: true, scenarios: [], cards: { profession: [], biology: [], physique: [], character: [], health: [], hobby: [], luggage: [], fact: [], action: [] }, ...over });

  it('tag overrides teach a built-in card a new ability, only when the pack is selected', () => {
    const doc = classic.cards.profession.find((c) => c.description === 'Хирург')!;
    const without = mergePools([classic]).profession.find((c) => c.id === doc.id)!;
    expect(without.tags).toEqual(['медицина']);
    const mine = customWith({ tagOverrides: { [doc.id]: ['медицина', 'призраки'] } });
    expect(mergePools([classic, mine]).profession.find((c) => c.id === doc.id)!.tags).toEqual(['медицина', 'призраки']);
    expect(mergePools([classic]).profession.find((c) => c.id === doc.id)!.tags).toEqual(['медицина']); // оригинал не тронут
    const wipe = customWith({ tagOverrides: { [doc.id]: [] } });
    expect(mergePools([classic, wipe]).profession.find((c) => c.id === doc.id)!.tags).toBeUndefined();
  });

  it('an overridden ability really neutralizes a hazard in the final evaluation', () => {
    const ghost: Hazard = { id: 'g', title: 'Призраки', description: '', severity: 'critical', counters: ['призраки'], };
    const priest = { id: 'priest', category: 'profession' as const, description: 'Священник', tags: ['призраки'] };
    const mine = customWith({ cards: { ...customWith({}).cards, profession: [priest] } });
    const pool = mergePools([classic, mine]).profession;
    expect(pool.some((c) => c.id === 'priest' && c.tags?.includes('призраки'))).toBe(true);
    const g = newGame(6, 3);
    const survivors = g.players.slice(0, 3).map((p, i) => ({ ...p, slots: { ...p.slots, profession: { ...p.slots.profession, card: i === 0 ? priest : { ...p.slots.profession.card, description: 'Обычный', tags: [] } }, hobby: { ...p.slots.hobby, card: { ...p.slots.hobby.card, description: 'Х', tags: [] } }, fact: { ...p.slots.fact, card: { ...p.slots.fact.card, description: 'Ф', tags: [] } }, luggage: { ...p.slots.luggage, card: { ...p.slots.luggage.card, description: 'Б', tags: [] } } } }));
    expect(evaluate({ ...g.scenario, requiredSkills: [] }, survivors, 3, [ghost]).hazards[0].ok).toBe(true);
    expect(evaluate({ ...g.scenario, requiredSkills: [] }, survivors.slice(1), 3, [ghost]).hazards[0].ok).toBe(false);
  });

  it('vocabulary lists skills with card counts, and finds the cards behind a skill', () => {
    const vocab = skillVocabulary([classic], ['свой навык']);
    expect(vocab.find((v) => v.skill === 'медицина')!.count).toBeGreaterThanOrEqual(3);
    expect(vocab.find((v) => v.skill === 'свой навык')!.count).toBe(0);
    expect(new Set(vocab.map((v) => v.skill.toLowerCase())).size).toBe(vocab.length); // без дублей
    const names = cardsWithSkill(skillCards([classic]), 'дератизация').map((c) => c.description);
    expect(names.join()).toContain('Дезинфектор');
  });

  it('validation flags unwinnable scenarios and missing names', () => {
    const base = { id: 's', title: 'Т', description: '', shelterSlots: 4, isolationDuration: '1 год', requiredSkills: ['медицина'], threats: [], hazards: [] as Hazard[] };
    expect(validateScenario(base, [classic]).filter((p) => p.level === 'error')).toEqual([]);
    expect(validateScenario({ ...base, title: ' ' }, [classic]).some((p) => p.level === 'error')).toBe(true);
    const bad = validateScenario({ ...base, requiredSkills: ['телепортация'], hazards: [{ id: 'h', title: 'Х', description: '', severity: 'critical', counters: ['магия'] }, { id: 'h2', title: 'Y', description: '', severity: 'minor', counters: [] }] }, [classic]);
    expect(bad.filter((p) => p.level === 'warn').map((p) => p.text).join(' ')).toContain('телепортация');
    expect(bad.some((p) => p.text.includes('«Х» не может снять'))).toBe(true);
    expect(bad.some((p) => p.text.includes('«Y» ничто не нейтрализует'))).toBe(true);
    // после «обучения» карты предупреждение исчезает
    const taught = customWith({ tagOverrides: { [classic.cards.profession[0].id]: ['магия'] } });
    expect(validateScenario({ ...base, hazards: [{ id: 'h', title: 'Х', description: '', severity: 'critical', counters: ['магия'] }] }, [classic, taught]).some((p) => p.text.includes('«Х»'))).toBe(false);
  });

  it('every built-in template can be won with the built-in deck', () => {
    for (const [key, t] of Object.entries(SCENARIO_TEMPLATES)) {
      const sc = { ...t, id: key, hazards: t.hazards.map((h, i) => ({ ...h, id: `${key}${i}` })) };
      expect(validateScenario(sc, [classic]).filter((p) => p.level === 'warn' && !p.text.startsWith('Угроз нет')), key).toEqual([]);
      expect(sc.hazards.length, key).toBeGreaterThanOrEqual(3);
    }
    for (const h of HAZARD_TEMPLATES) expect(h.counters.some((s) => cardsWithSkill(skillCards([classic]), s).length > 0), h.title).toBe(true);
  });

  it('overrides survive sanitizing and a share link, and are clamped', () => {
    const p = sanitizePack({ name: 'x', tagOverrides: { a: ['t1', 't2', 't3', 't4', 't5', 't6', 'x'.repeat(99)], '': ['no'], b: 'not-a-list', __proto__: ['evil'] } })!;
    expect(p.tagOverrides!.a).toHaveLength(5);
    expect(p.tagOverrides!.a[0]).toBe('t1');
    expect(p.tagOverrides!['']).toBeUndefined();
    expect(Object.keys(p.tagOverrides!)).toEqual(expect.arrayContaining(['a', 'b']));
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
    const back = decodePack(encodePack({ ...customWith({}), tagOverrides: { z: ['q'] } }));
    expect(back?.tagOverrides).toEqual({ z: ['q'] });
  });
});
