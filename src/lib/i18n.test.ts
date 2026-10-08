import { describe, expect, it, beforeEach } from 'vitest';
import { t, plural } from './i18n';
import { updateSettings, type Lang } from './settings';
import { DICTS, DICT_PARTS } from '../i18n';

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
});

describe('dictionaries', () => {
  it('have at least one part each and are not empty', () => {
    for (const lang of LANGS) {
      expect(Object.keys(DICT_PARTS[lang] ?? {}).length, lang).toBeGreaterThan(0);
      expect(Object.keys(DICTS[lang]).length, lang).toBeGreaterThan(100);
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
