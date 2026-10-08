import { describe, expect, it, beforeEach } from 'vitest';
import { t, plural } from './i18n';
import { updateSettings } from './settings';
import { UK, UK_PARTS } from '../i18n/uk';

const ru = () => updateSettings({ lang: 'ru' });
const uk = () => updateSettings({ lang: 'uk' });

describe('t()', () => {
  beforeEach(ru);

  it('returns the Russian source by default', () => {
    expect(t('Назад')).toBe('Назад');
    expect(t('Открыть карту')).toBe('Открыть карту');
  });

  it('uses the Ukrainian text when the language is Ukrainian', () => {
    uk();
    expect(t('Назад')).toBe(UK['Назад']);
  });

  it('falls back to the Russian text for a key that is not translated yet', () => {
    uk();
    expect(t('Ключ, которого точно нет в словаре')).toBe('Ключ, которого точно нет в словаре');
  });

  it('fills {name} placeholders and leaves unknown ones as they are', () => {
    expect(t('Раунд {n} из {total}', { n: 2, total: 5 })).toBe('Раунд 2 из 5');
    expect(t('Привет, {name}', {})).toBe('Привет, {name}');
  });
});

describe('dictionary', () => {
  it('a key repeated in several parts must have the same translation everywhere', () => {
    const seen = new Map<string, { part: string; value: string }>();
    for (const [part, dict] of Object.entries(UK_PARTS)) {
      for (const [key, value] of Object.entries(dict)) {
        const prev = seen.get(key);
        if (prev) expect(value, `«${key}»: ${prev.part} и ${part} переводят по-разному`).toBe(prev.value);
        else seen.set(key, { part, value });
      }
    }
  });

  it('every translation keeps the same {placeholders} as its key', () => {
    for (const [key, value] of Object.entries(UK)) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(vars(value), key).toBe(vars(key));
    }
  });

  it('no translation is empty', () => {
    for (const [key, value] of Object.entries(UK)) expect(value.trim(), key).not.toBe('');
  });
});

describe('plural()', () => {
  const kartochka = ['карта', 'карты', 'карт'] as [string, string, string];
  it('picks the right form for 1, 2–4 and 5+, including teens', () => {
    expect(plural(1, kartochka)).toBe('карта');
    expect(plural(21, kartochka)).toBe('карта');
    expect(plural(2, kartochka)).toBe('карты');
    expect(plural(24, kartochka)).toBe('карты');
    expect(plural(5, kartochka)).toBe('карт');
    expect(plural(11, kartochka)).toBe('карт');
    expect(plural(0, kartochka)).toBe('карт');
    expect(plural(112, kartochka)).toBe('карт');
  });

  it('uses the Ukrainian forms when given and the language is Ukrainian', () => {
    uk();
    expect(plural(2, ['карта', 'карты', 'карт'], ['картка', 'картки', 'карток'])).toBe('картки');
    expect(plural(5, ['карта', 'карты', 'карт'], ['картка', 'картки', 'карток'])).toBe('карток');
    ru();
    expect(plural(2, ['карта', 'карты', 'карт'], ['картка', 'картки', 'карток'])).toBe('карты');
  });
});

describe('default player names', () => {
  it('shows the number of a default name in both languages', async () => {
    const { initialOf } = await import('../ui/Avatar');
    expect(initialOf('Игрок 3')).toBe('3');
    expect(initialOf('Гравець 3')).toBe('3');
    expect(initialOf('Анна')).toBe('А');
  });
});
