import { describe, expect, it } from 'vitest';
import { BUILTIN_PACKS } from './classicPack';
import { CATEGORIES, type CardPack, type SessionConfig } from '../types';
import { sanitizePack } from '../lib/packs';
import { skillCards, validateScenario, cardsWithSkill } from '../lib/vocab';
import { createGame } from '../lib/game';
import { buildChronicle } from '../lib/chronicle';
import { EVENTS } from '../lib/events';

const PROFANITY = /(^|[^а-яё])(хуй|хуе|хуя|хуё|пизд|ебан|ебат|ебал|ебну|блят|бляд|сука|нахрен|похуй|похер|жоп)/i;
const textOf = (p: CardPack): string[] => [
  p.name, p.description,
  ...p.scenarios.flatMap((s) => [s.title, s.description, ...(s.hazards ?? []).flatMap((h) => [h.title, h.description, h.onSuccess ?? '', h.onFail ?? '']), ...(s.events ?? []).flatMap((e) => [e.title, e.text])]),
  ...CATEGORIES.flatMap((c) => p.cards[c].flatMap((x) => [x.title ?? '', x.description])),
];

const cfg = (n: number, k: number): SessionConfig => ({
  scenarioId: 'x', packIds: [], playerCount: n, shelterSlots: k, mode: 'pass-and-play', voting: 'open', revealsPerVote: 1, timeLimitMin: 0, speechSec: 0,
  hazardCount: 2, difficulty: 'normal', roundEvents: true, names: Array.from({ length: n }, (_, i) => `П${i + 1}`), seed: 11,
});

describe('built-in packs', () => {
  it('has the expected packs, unique ids and a flagged 18+ pack', () => {
    expect(BUILTIN_PACKS.map((p) => p.id)).toEqual(['classic', 'medieval', 'fantasy', 'adult']);
    expect(new Set(BUILTIN_PACKS.flatMap((p) => CATEGORIES.flatMap((c) => p.cards[c].map((x) => x.id)))).size).toBe(BUILTIN_PACKS.reduce((n, p) => n + CATEGORIES.reduce((m, c) => m + p.cards[c].length, 0), 0));
    expect(BUILTIN_PACKS.filter((p) => p.adult).map((p) => p.id)).toEqual(['adult']);
  });

  for (const pack of BUILTIN_PACKS) {
    describe(pack.name, () => {
      it('fits all content limits (sanitizing changes nothing)', () => {
        const clean = sanitizePack(JSON.parse(JSON.stringify(pack)))!;
        const { isCustom: _a, ...a } = clean;
        const { isCustom: _b, ...b } = pack;
        expect(a).toEqual(b);
      });

      it('is self-contained: every required skill and hazard can be countered by the pack\'s own cards', () => {
        for (const sc of pack.scenarios) {
          const warns = validateScenario(sc, [pack]).filter((p) => p.level !== 'error' || true);
          expect(warns, sc.id).toEqual([]);
        }
      });

      it('has enough cards and rich scenarios', () => {
        for (const c of CATEGORIES) expect(pack.cards[c].length, c).toBeGreaterThanOrEqual(c === 'action' ? 8 : 10);
        for (const sc of pack.scenarios) {
          expect((sc.hazards ?? []).length, sc.id).toBeGreaterThanOrEqual(4);
          for (const h of sc.hazards ?? []) {
            expect(h.onSuccess, h.id).toContain('{who}');
            expect(h.onFail, h.id).toBeTruthy();
          }
        }
      });

      it('every skill has at least two cards behind it (so it is not a lottery)', () => {
        const cards = skillCards([pack]);
        for (const sc of pack.scenarios) {
          for (const skill of [...sc.requiredSkills, ...(sc.hazards ?? []).flatMap((h) => h.counters)]) {
            expect(cardsWithSkill(cards, skill).length, `${sc.id}: ${skill}`).toBeGreaterThanOrEqual(2);
          }
        }
      });

      it('games start with a themed event and a full chronicle can be built', () => {
        for (const sc of pack.scenarios) {
          const g = createGame({ ...cfg(8, 4), scenarioId: sc.id }, sc, [pack]);
          expect(g.phase, sc.id).toBe('event');
          if (sc.events) expect(sc.events.map((e) => e.id)).toContain(g.event!.id);
          else expect(EVENTS.map((e) => e.id)).toContain(g.event!.id);
          const done = { ...g, phase: 'final' as const, players: g.players.map((p, i) => ({ ...p, isEliminated: i >= 4 })) };
          const ch = buildChronicle(done);
          expect(ch.entries.length, sc.id).toBeGreaterThanOrEqual(3);
          expect(ch.epilogue.length).toBeGreaterThan(0);
        }
      });

      it('profanity appears only where the 18+ flag is set', () => {
        const hits = textOf(pack).filter((t) => PROFANITY.test(t));
        if (pack.adult) expect(hits.length).toBeGreaterThan(15);
        else expect(hits, hits.join(' | ')).toEqual([]);
      });
    });
  }

  it('fantasy races carry real abilities and count towards the final evaluation', () => {
    const fantasy = BUILTIN_PACKS.find((p) => p.id === 'fantasy')!;
    const orc = fantasy.cards.biology.find((c) => c.description.startsWith('Полуорк'))!;
    expect(orc.tags).toContain('оборона');
    expect(cardsWithSkill(skillCards([fantasy]), 'темновидение').some((c) => c.category === 'biology')).toBe(true);
  });

  it('short isolation periods get a day/week timeline in the chronicle', () => {
    const adult = BUILTIN_PACKS.find((p) => p.id === 'adult')!;
    const sc = adult.scenarios[0]; // «2 недели»
    const g = createGame({ ...cfg(8, 4), roundEvents: false }, sc, [adult]);
    const ch = buildChronicle({ ...g, phase: 'final', players: g.players.map((p, i) => ({ ...p, isEliminated: i >= 4 })) });
    const labels = ch.entries.map((e) => e.when);
    expect(labels[0]).toBe('День 1');
    expect(labels.some((l) => /дн|недел/.test(l))).toBe(true);
    expect(labels.every((l) => !/год|лет|месяц/.test(l))).toBe(true);
  });
});
