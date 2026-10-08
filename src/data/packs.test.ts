import { describe, expect, it } from 'vitest';
import { BUILTIN_PACKS, CLASSIC_PACK } from './classicPack';
import { generateCharacters, mergePools } from '../lib/generator';
import { BASE_CHARACTER, BASE_PHYSIQUE } from './baseCards';
import { mulberry32 } from '../lib/rng';
import { CATEGORIES, type CardPack, type SessionConfig } from '../types';
import { sanitizePack } from '../lib/packs';
import { skillCards, validateScenario, cardsWithSkill } from '../lib/vocab';
import { createGame } from '../lib/game';
import { buildChronicle } from '../lib/chronicle';
import { EVENTS } from '../lib/events';
import { isKnownBonus } from '../lib/perks';

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
        for (const c of CATEGORIES) {
          if (c === 'physique' || c === 'character') continue; // общие колоды в baseCards.ts, паки лишь дополняют
          expect(pack.cards[c].length, c).toBeGreaterThanOrEqual(c === 'action' ? 8 : 10);
        }
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

  it('no feast / toast style events (they were cut on purpose)', () => {
    const FEAST = /тост|застол|пир на|за кубком|рюмк|шашлык|выпить|чокн/i;
    const events = [...EVENTS, ...BUILTIN_PACKS.flatMap((p) => p.scenarios.flatMap((s) => s.events ?? []))];
    expect(events.filter((e) => FEAST.test(`${e.title} ${e.text}`)).map((e) => e.id)).toEqual([]);
    for (const pack of BUILTIN_PACKS) for (const sc of pack.scenarios) {
      const ids = (sc.events ?? []).map((e) => e.id);
      expect(new Set(ids).size, sc.id).toBe(ids.length);
    }
  });

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

describe('biology, physique and character', () => {
  for (const pack of BUILTIN_PACKS) {
    it(`${pack.name}: биология — только пол, возраст, раса`, () => {
      for (const c of pack.cards.biology) expect(c.description, c.description).not.toMatch(/(^|[^а-яё])(рост|вес)([^а-яё]|$)|(^|[^а-яё])(кг|см)([^а-яё]|$)|накач|жирн|толст|худ|повар|кузнец|борода/i);
    });
  }
  it('телосложение: рост, вес и комплекция; без повторов', () => {
    expect(BASE_PHYSIQUE.length).toBeGreaterThanOrEqual(30);
    for (const c of [...BASE_PHYSIQUE, ...BUILTIN_PACKS.flatMap((p) => p.cards.physique)]) expect(c.description, c.description).toMatch(/Рост \d+ см, вес \d+ кг/);
    expect(new Set(BASE_PHYSIQUE.map((c) => c.description)).size).toBe(BASE_PHYSIQUE.length);
  });
  it('характер: один базовый набор без повторов, только черта характера (без профессий и рас)', () => {
    expect(BASE_CHARACTER.length).toBeGreaterThanOrEqual(30);
    expect(new Set(BASE_CHARACTER.map((c) => c.description)).size).toBe(BASE_CHARACTER.length);
    const all = [...BASE_CHARACTER, ...BUILTIN_PACKS.flatMap((p) => p.cards.character)];
    for (const c of all) {
      expect(c.description, c.description).not.toMatch(/маг|рыцар|эльф|гном|дракон|воин|повар|врач|торговец|[,:;(]/i);
      expect(c.description.split(/\s+/).length, c.description).toBeLessThanOrEqual(3);
    }
    // пак не дублирует базовые характеры
    const base = new Set(BASE_CHARACTER.map((c) => c.description));
    for (const p of BUILTIN_PACKS) for (const c of p.cards.character) expect(base.has(c.description), c.description).toBe(false);
    // любой пак получает базовую колоду, даже если своих карт нет
    for (const p of BUILTIN_PACKS) {
      const chars = generateCharacters(['А', 'Б', 'В'], [p], mulberry32(3));
      for (const ch of chars) expect(ch.slots.character.card.description).not.toMatch(/нет карт/);
    }
  });
  it('самодельный пак без телосложения и характера получает базовые колоды', () => {
    const bare = { ...CLASSIC_PACK, id: 'bare', cards: { ...CLASSIC_PACK.cards, physique: [], character: [] } };
    const chars = generateCharacters(['А', 'Б'], [bare], mulberry32(1));
    for (const p of chars) {
      expect(p.slots.physique.card.description).toMatch(/Рост \d+ см/);
      expect(p.slots.character.card.id).toMatch(/^base-character/);
    }
  });
  it('два пака вместе не умножают одинаковые карты', () => {
    const pool = mergePools(BUILTIN_PACKS);
    expect(new Set(pool.character.map((c) => c.description)).size).toBe(pool.character.length);
  });
});

describe('health cards', () => {
  for (const pack of BUILTIN_PACKS) {
    it(`${pack.name}: здоровье — короткий диагноз без пояснений`, () => {
      for (const c of pack.cards.health) expect(c.description, c.description).not.toMatch(/[,:;(—«]/);
    });
  }
});

describe('особые бонусы профессий', () => {
  it('каждый ключ бонуса в паке известен таблице BONUSES, а бонус стоит только у профессии', () => {
    for (const pack of BUILTIN_PACKS) {
      for (const c of CATEGORIES.flatMap((cat) => pack.cards[cat])) {
        if (!c.bonus) continue;
        expect(c.category, c.id).toBe('profession');
        expect(isKnownBonus(c.bonus), `${c.id}: ${c.bonus}`).toBe(true);
      }
    }
  });
  it('у встроенных профессий с ключом уникальные id и не пустые описания', () => {
    const cards = BUILTIN_PACKS.flatMap((p) => p.cards.profession).filter((c) => c.bonus);
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    for (const c of cards) expect(c.description.trim(), c.id).not.toBe('');
  });
});
