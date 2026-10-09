import { describe, expect, it, beforeEach } from 'vitest';
import { t, plural, packT, tPacked } from './i18n';
import { updateSettings, type Lang } from './settings';
import { DICTS, DICT_PARTS } from '../i18n';
import { BUILTIN_PACKS } from '../data/classicPack';
import { BASE_CHARACTER, BASE_PHYSIQUE } from '../data/baseCards';
import { CATEGORIES } from '../types';

const setLang = (lang: Lang) => updateSettings({ lang });
const LANGS = Object.keys(DICTS) as Lang[];
const RU_DICT = DICTS.uk; // украинский — эталон для «Назад» и т.п.

describe('t()', () => {
  beforeEach(() => setLang('ru'));

  it('returns the Russian source for Russian and for keys that are not translated', () => {
    expect(t('Назад')).toBe('Назад');
    setLang('uk');
    expect(t('Ключ, которого точно нет в словаре')).toBe('Ключ, которого точно нет в словаре');
  });

  it('uses the dictionary of the chosen language', () => {
    setLang('uk');
    expect(t('Назад')).toBe(RU_DICT['Назад']);
    for (const lang of ['en', 'de'] as const) {
      setLang(lang);
      expect(t('Назад'), lang).toBe(DICTS[lang]['Назад']);
    }
  });

  it('fills {name} placeholders and leaves unknown ones as they are', () => {
    expect(t('Раунд {n} из {total}', { n: 2, total: 5 })).toBe('Раунд 2 из 5');
    expect(t('Привет, {name}', {})).toBe('Привет, {name}');
  });
  it('does not treat inherited Object keys in custom cards as translations', () => {
    try {
      for (const lang of ['uk', 'en', 'de'] as const) {
        setLang(lang);
        for (const key of ['constructor', '__proto__', 'toString', 'valueOf']) expect(t(key)).toBe(key);
        expect(t('constructor + toString')).toBe('constructor + toString');
      }
      setLang('en');
      expect(tPacked(packT('{desc} (поддержка)', { desc: 'constructor' }))).toBe('constructor (supported)');
    } finally { setLang('ru'); }
  });
});

describe('dictionaries', () => {
  it('have at least one part each and are not empty', () => {
    for (const lang of LANGS) {
      expect(Object.keys(DICT_PARTS[lang] ?? {}).length, lang).toBeGreaterThan(0);
      expect(Object.keys(DICTS[lang]).length, lang).toBeGreaterThan(100);
    }
  });

  it('all languages have the same source keys in each dictionary part', () => {
    const parts = (lang: string) => Object.fromEntries(
      Object.entries(DICT_PARTS[lang]).map(([path, dict]) => [path.split('/').at(-1)!, Object.keys(dict).sort()]),
    );
    const reference = parts('en');
    for (const lang of ['de', 'uk']) {
      const actual = parts(lang);
      expect(Object.keys(actual).sort(), `[${lang}] dictionary part names`).toEqual(Object.keys(reference).sort());
      for (const [file, keys] of Object.entries(reference)) {
        expect(actual[file], `[${lang}] missing or extra source keys in ${file}`).toEqual(keys);
      }
    }
  });

  it('a key repeated in several parts of one language must have the same translation', () => {
    for (const lang of LANGS) {
      const seen = new Map<string, { part: string; value: string }>();
      for (const [part, dict] of Object.entries(DICT_PARTS[lang])) {
        for (const [key, value] of Object.entries(dict)) {
          const prev = seen.get(key);
          if (prev) expect(value, `[${lang}] «${key}»: ${prev.part} и ${part} переводят по-разному`).toBe(prev.value);
          else seen.set(key, { part, value });
        }
      }
    }
  });

  it('every translation keeps the same {placeholders} as its key, and none is empty', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(DICTS[lang])) {
        expect(value.trim(), `[${lang}] ${key}`).not.toBe('');
        expect(vars(value), `[${lang}] ${key}`).toBe(vars(key));
      }
    }
  });
});

describe('plural()', () => {
  const card = { ru: ['карта', 'карты', 'карт'], uk: ['картка', 'картки', 'карток'], en: ['card', 'cards'], de: ['Karte', 'Karten'] } as const;
  it('picks the right Russian form for 1, 2–4 and 5+, including teens', () => {
    expect(plural(1, card)).toBe('карта');
    expect(plural(21, card)).toBe('карта');
    expect(plural(2, card)).toBe('карты');
    expect(plural(24, card)).toBe('карты');
    expect(plural(5, card)).toBe('карт');
    expect(plural(11, card)).toBe('карт');
    expect(plural(0, card)).toBe('карт');
    expect(plural(112, card)).toBe('карт');
  });

  it('uses the forms of the chosen language, and Russian where a language has none', () => {
    setLang('uk');
    expect(plural(2, card)).toBe('картки');
    expect(plural(5, card)).toBe('карток');
    setLang('en');
    expect(plural(1, card)).toBe('card');
    expect(plural(3, card)).toBe('cards');
    setLang('de');
    expect(plural(1, card)).toBe('Karte');
    expect(plural(3, card)).toBe('Karten');
    expect(plural(2, { ru: ['карта', 'карты', 'карт'] })).toBe('карты');
    setLang('ru');
  });
});

describe('default player names', () => {
  it('shows the number of a default name in every language', async () => {
    const { initialOf } = await import('../ui/Avatar');
    expect(initialOf('Игрок 3')).toBe('3');
    expect(initialOf('Гравець 3')).toBe('3');
    expect(initialOf('Player 3')).toBe('3');
    expect(initialOf('Spieler 3')).toBe('3');
    expect(initialOf('Анна')).toBe('А');
  });
});

describe('stored texts follow the language', () => {
  it('packT strings are translated at display time, not at creation', async () => {
    const { packT, tPacked } = await import('./i18n');
    const key = 'Угроза снята: «{title}».';
    const stored = packT(key, { title: 'Заражённая вода' });
    setLang('ru');
    expect(tPacked(stored)).toBe('Угроза снята: «Заражённая вода».');
    setLang('en');
    expect(tPacked(stored)).toBe(t(key, { title: t('Заражённая вода') }));
    expect(tPacked(stored)).not.toContain('Угроза');
    expect(tPacked('Обычная строка')).toBe(t('Обычная строка'));
    setLang('ru');
  });

  it('a round event keeps Russian keys in the game state', async () => {
    const { applyEvent } = await import('./game');
    const { EVENTS } = await import('./events');
    const { createGame } = await import('./game');
    const { CLASSIC_PACK } = await import('../data/classicPack');
    const config = { scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: [CLASSIC_PACK.id], playerCount: 4, shelterSlots: 2, mode: 'pass-and-play' as const, voting: 'open' as const, revealsPerVote: 1, timeLimitMin: 0, speechSec: 0, hazardCount: 1, difficulty: 'normal' as const, roundEvents: true, names: ['А', 'Б', 'В', 'Г'], seed: 3 };
    const g = createGame(config, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
    setLang('en');
    const withEvent = applyEvent(g, EVENTS.find((e) => e.kind === 'shrink')!);
    setLang('ru');
    expect(withEvent.event!.title).toBe(EVENTS.find((e) => e.kind === 'shrink')!.title);
    expect(withEvent.event!.outcome[0]).toContain('Мест в бункере');
  });
});

describe('built-in content is translated', () => {
  it('every Russian text of the built-in packs has a uk, en and de translation', () => {
    const texts = new Set<string>();
    const add = (v?: string) => { if (v?.trim()) texts.add(v); };
    for (const p of BUILTIN_PACKS) {
      add(p.name); add(p.description);
      for (const sc of p.scenarios) {
        add(sc.title); add(sc.description); add(sc.isolationDuration);
        sc.requiredSkills.forEach(add); sc.threats.forEach(add);
        for (const h of sc.hazards ?? []) { add(h.title); add(h.description); add(h.onSuccess); add(h.onFail); h.counters.forEach(add); }
        for (const e of sc.events ?? []) { add(e.title); add(e.text); }
      }
      for (const c of CATEGORIES) for (const k of p.cards[c]) { add(k.description); add(k.title); k.tags?.forEach(add); }
    }
    for (const k of [...BASE_CHARACTER, ...BASE_PHYSIQUE]) { add(k.description); k.tags?.forEach(add); }
    for (const lang of ['uk', 'en', 'de'] as const) {
      const missing = [...texts].filter((s) => !Object.hasOwn(DICTS[lang], s));
      expect(missing, `[${lang}] не переведено`).toEqual([]);
    }
  });
});
