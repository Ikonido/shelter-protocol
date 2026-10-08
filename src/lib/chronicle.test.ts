import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import { createGame } from './game';
import { buildChronicle, isolationDays, plural, whenLabel } from './chronicle';
import type { GameState, Hazard, PlayerCharacter, SessionConfig } from '../types';

const cfg = (n: number, k: number, difficulty: SessionConfig['difficulty'] = 'normal'): SessionConfig => ({
  scenarioId: 'x', packIds: ['classic'], playerCount: n, shelterSlots: k, mode: 'pass-and-play', voting: 'open', revealsPerVote: 1,
  timeLimitMin: 0, speechSec: 0, hazardCount: 0, difficulty, roundEvents: false, names: Array.from({ length: n }, (_, i) => `П${i + 1}`), seed: 7,
});
const ship = CLASSIC_PACK.scenarios[2]; // «Большой потоп», изоляция 10 лет

/** Игра, где выжили первые k игроков, а у каждого — нейтральные карты без навыков, кроме заданных тегов профессии. */
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
      luggage: { ...p.slots.luggage, card: { ...p.slots.luggage.card, items: undefined, description: 'Багаж', tags: [], modifier: 'neutral' } },
      biology: { ...p.slots.biology, card: { ...p.slots.biology.card, tags: [], modifier: 'neutral' } },
      physique: { ...p.slots.physique, card: { ...p.slots.physique.card, tags: [], modifier: 'neutral' } },
      character: { ...p.slots.character, card: { ...p.slots.character.card, tags: [], modifier: 'neutral' } },
    },
  });
  return { ...g, phase: 'final', players: g.players.map(plain), hazards };
}
const rats = ship.hazards!.find((h) => h.id.endsWith('fl-rats'))!;
const leak = ship.hazards!.find((h) => h.id.endsWith('fl-leak'))!;
const pirates = ship.hazards!.find((h) => h.id.endsWith('fl-pirates'))!;

describe('chronicle helpers', () => {
  const d = (months: number) => Math.round(months * 30.4375);
  it('russian plurals and time labels', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, { ru: ['месяц', 'месяца', 'месяцев'] }))).toEqual(['месяц', 'месяца', 'месяцев', 'месяцев', 'месяц', 'месяца', 'месяцев']);
    expect(whenLabel(0)).toBe('День 1');
    expect([1, 3, 5, 13].map(whenLabel)).toEqual(['Через 1 день', 'Через 3 дня', 'Через 5 дней', 'Через 13 дней']);
    expect([14, 21, 30, 45].map(whenLabel)).toEqual(['Через 2 недели', 'Через 3 недели', 'Через 4 недели', 'Через 6 недель']);
    expect(whenLabel(d(3))).toBe('Через 3 месяца');
    expect(whenLabel(d(12))).toBe('Через 1 год');
    expect(whenLabel(d(30))).toBe('Через 2 года и 6 месяцев');
    expect(whenLabel(d(60))).toBe('Через 5 лет');
  });
  it('parses isolation durations', () => {
    expect([isolationDays('5 лет'), isolationDays('2 года'), isolationDays('18 месяцев'), isolationDays('1 год'), isolationDays('неизвестно')]).toEqual([d(60), d(24), d(18), d(12), d(36)]);
    expect([isolationDays('2 недели'), isolationDays('10 дней'), isolationDays('3 суток'), isolationDays('1 неделя')]).toEqual([14, 10, 3, 7]);
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

describe('isolation duration in both languages', () => {
  it('reads Russian and Ukrainian units the same way', async () => {
    const { isolationDays } = await import('./chronicle');
    expect(isolationDays('2 года')).toBe(isolationDays('2 роки'));
    expect(isolationDays('6 месяцев')).toBe(isolationDays('6 місяців'));
    expect(isolationDays('10 дней')).toBe(isolationDays('10 днів'));
    expect(isolationDays('2 недели')).toBe(isolationDays('2 тижні'));
    expect(isolationDays('3 года')).toBe(isolationDays('3 роки'));
  });
});

describe('chronicle in Ukrainian', () => {
  it('builds without leftover placeholders and keeps the player names', async () => {
    const { updateSettings } = await import('./settings');
    updateSettings({ lang: 'uk' });
    try {
      const g = endedGame(3, [['дератизация'], [], []], [rats, pirates]);
      const c = buildChronicle(g);
      const text = c.entries.map((e) => `${e.stamp} ${e.text}`).join('\n');
      expect(text).not.toMatch(/\{\w+\}/);
      expect(text).toMatch(/[іїєґ]/);
      expect(c.entries.find((e) => e.id === `hz-${rats.id}`)!.text).toContain('П1');
    } finally {
      updateSettings({ lang: 'ru' });
    }
  });
});

describe('isolation duration units', () => {
  it('understands English and German units too', async () => {
    const { isolationDays } = await import('./chronicle');
    expect(isolationDays('3 years')).toBe(isolationDays('3 года'));
    expect(isolationDays('6 months')).toBe(isolationDays('6 месяцев'));
    expect(isolationDays('2 weeks')).toBe(isolationDays('2 недели'));
    expect(isolationDays('10 days')).toBe(isolationDays('10 дней'));
    expect(isolationDays('2 Jahre')).toBe(isolationDays('2 года'));
    expect(isolationDays('6 Monate')).toBe(isolationDays('6 месяцев'));
    expect(isolationDays('3 Tage')).toBe(3);
    expect(isolationDays('nobody knows')).toBe(isolationDays('неизвестно'));
  });
});
