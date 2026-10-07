import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import { createGame } from './game';
import { buildChronicle, isolationMonths, plural, whenLabel } from './chronicle';
import type { GameState, Hazard, PlayerCharacter, SessionConfig } from '../types';

const cfg = (n: number, k: number, difficulty: SessionConfig['difficulty'] = 'normal'): SessionConfig => ({
  scenarioId: 'x', packIds: ['classic'], playerCount: n, shelterSlots: k, mode: 'pass-and-play', voting: 'open', revealsPerVote: 1,
  timeLimitMin: 0, speechSec: 0, hazardCount: 0, difficulty, roundEvents: false, names: Array.from({ length: n }, (_, i) => `П${i + 1}`), seed: 7,
});
const ship = CLASSIC_PACK.scenarios[2]; // «Большой потоп», изоляция 10 лет

/** Игра, где выжили первые k игроков, а у каждого — нейтральные карты, кроме заданных тегов профессии. */
function endedGame(k: number, tags: string[][], hazards: Hazard[], difficulty: SessionConfig['difficulty'] = 'normal', scenario = ship): GameState {
  const g = createGame(cfg(6, k, difficulty), scenario, [CLASSIC_PACK]);
  const plain = (p: PlayerCharacter, i: number): PlayerCharacter => ({
    ...p,
    isEliminated: i >= k,
    slots: {
      ...p.slots,
      profession: { ...p.slots.profession, card: { ...p.slots.profession.card, description: `Профессия ${i + 1}`, title: undefined, tags: tags[i] ?? [], modifier: 'neutral' } },
      hobby: { ...p.slots.hobby, card: { ...p.slots.hobby.card, description: 'Хобби', tags: [], modifier: 'neutral' } },
      fact: { ...p.slots.fact, card: { ...p.slots.fact.card, description: 'Факт', tags: [], modifier: 'neutral' } },
      luggage: { ...p.slots.luggage, card: { ...p.slots.luggage.card, description: 'Багаж', tags: [], modifier: 'neutral' } },
    },
  });
  return { ...g, phase: 'final', players: g.players.map(plain), hazards };
}
const rats = ship.hazards!.find((h) => h.id.endsWith('fl-rats'))!;
const leak = ship.hazards!.find((h) => h.id.endsWith('fl-leak'))!;
const pirates = ship.hazards!.find((h) => h.id.endsWith('fl-pirates'))!;

describe('chronicle helpers', () => {
  it('russian plurals and time labels', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, ['месяц', 'месяца', 'месяцев']))).toEqual(['месяц', 'месяца', 'месяцев', 'месяцев', 'месяц', 'месяца', 'месяцев']);
    expect(whenLabel(0)).toBe('День 1');
    expect(whenLabel(3)).toBe('Через 3 месяца');
    expect(whenLabel(12)).toBe('Через 1 год');
    expect(whenLabel(30)).toBe('Через 2 года и 6 месяцев');
    expect(whenLabel(60)).toBe('Через 5 лет');
  });
  it('parses isolation durations', () => {
    expect([isolationMonths('5 лет'), isolationMonths('2 года'), isolationMonths('18 месяцев'), isolationMonths('1 год'), isolationMonths('неизвестно')]).toEqual([60, 24, 18, 12, 36]);
  });
});

describe('chronicle', () => {
  it('every built-in hazard has story texts within limits', () => {
    for (const sc of CLASSIC_PACK.scenarios) for (const h of sc.hazards!) {
      expect(h.onSuccess, h.id).toContain('{who}');
      expect(h.onFail, h.id).toBeTruthy();
      expect(h.onSuccess!.length).toBeLessThanOrEqual(160);
      expect(h.onFail!.length).toBeLessThanOrEqual(160);
    }
  });

  it('tells who removed a threat with which card; failed threats keep their own story', () => {
    const g = endedGame(3, [['дератизация'], [], []], [rats, pirates]);
    const c = buildChronicle(g);
    const ok = c.entries.find((e) => e.id === `hz-${rats.id}`)!;
    expect(ok.tone).toBe('ok');
    expect(ok.stamp).toBe('УГРОЗА СНЯТА');
    expect(ok.text).toContain('П1');
    expect(ok.text).toContain('Профессия 1');
    expect(ok.text).not.toContain('{who}');
    const bad = c.entries.find((e) => e.id === `hz-${pirates.id}`)!;
    expect(bad.tone).toBe('bad');
    expect(bad.text).toBe(pirates.onFail);
    expect(c.fatal).toBe(false);
  });

  it('a deadly threat without an answer ends the story with no happy ending', () => {
    const g = endedGame(3, [[], [], []], [rats, leak]);
    const c = buildChronicle(g);
    expect(c.fatal).toBe(true);
    const last = c.entries[c.entries.length - 1];
    expect(last.stamp).toBe('ГИБЕЛЬ');
    expect(last.text).toContain('Убежище не выдерживает');
    expect(c.entries.some((e) => e.id === 'outro')).toBe(false);
    expect(c.epilogue[0]).toContain('не пережило');
  });

  it('timeline starts at day one, is strictly increasing and fits the isolation period', () => {
    const g = endedGame(4, [['дератизация'], ['инженерия'], ['безопасность'], []], [rats, leak, pirates]);
    const c = buildChronicle(g);
    expect(c.entries[0].when).toBe('День 1');
    expect(c.entries[0].text).toContain('П1');
    expect(c.entries[0].text).toContain('Снаружи остались: П5 и П6');
    const last = c.entries[c.entries.length - 1];
    expect(last.id).toBe('outro');
    expect(last.when).toBe('Через 10 лет');
    const months = c.entries.map((e) => (e.when === 'День 1' ? 0 : parse(e.when)));
    for (let i = 1; i < months.length; i++) expect(months[i]).toBeGreaterThan(months[i - 1]);
    expect(new Set(c.entries.map((e) => e.id)).size).toBe(c.entries.length);
  });

  it('is deterministic (same chronicle for every online player) and the epilogue is built from survivors', () => {
    const g = endedGame(4, [['дератизация'], ['инженерия'], ['безопасность'], []], [rats, leak, pirates]);
    expect(buildChronicle(g)).toEqual(buildChronicle(JSON.parse(JSON.stringify(g))));
    const ep = buildChronicle(g).epilogue.join(' ');
    expect(ep).toContain('Колонию основали');
    expect(ep).toContain('П1 (Профессия 1)');
    expect(ep).toContain('Не попали в бункер: П5 и П6');
  });

  it('a volunteer from the log is remembered in the epilogue', () => {
    const g = endedGame(4, [[], [], [], []], []);
    const withLog = { ...g, log: [...g.log, { round: 1, text: 'П6 вызвался добровольцем и покидает бункер' }] };
    expect(buildChronicle(withLog).epilogue.join(' ')).toContain('П6 вызвался добровольцем');
  });

  it('overcrowding and missing skills appear as warnings', () => {
    const g = endedGame(5, [[], [], [], [], []], []);
    const c = buildChronicle({ ...g, config: { ...g.config, shelterSlots: 3 } });
    expect(c.entries.some((e) => e.id === 'crowd' && e.tone === 'bad')).toBe(true);
    expect(c.entries.some((e) => e.id.startsWith('sk-') && e.tone === 'warn')).toBe(true);
  });

  it('works without any threats and without survivors', () => {
    expect(buildChronicle(endedGame(3, [[], [], []], [])).entries.length).toBeGreaterThanOrEqual(2);
    const none = buildChronicle(endedGame(0, [], [rats]));
    expect(none.entries[0].text).toContain('0 человек');
    expect(none.epilogue.length).toBeGreaterThan(0);
  });
});

function parse(when: string): number {
  const y = /(\d+) (?:год|года|лет)/.exec(when);
  const m = /(\d+) месяц/.exec(when);
  return (y ? Number(y[1]) * 12 : 0) + (m ? Number(m[1]) : 0);
}
