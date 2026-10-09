import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { t, packT, tPacked } from '../lib/i18n';
import { updateSettings } from '../lib/settings';
import { Gate } from '../ui/Gate';
import { DICTS, loadLang } from './registry';
import { RUSSIAN_REFERENCE, applyRussianReference, russianText } from './russian';

afterEach(() => updateSettings({ lang: 'ru' }));

describe('Russian editorial reference', () => {
  it('keeps legacy keys readable without changing placeholders', () => {
    updateSettings({ lang: 'ru' });
    const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort();
    for (const [legacy, reviewed] of Object.entries(RUSSIAN_REFERENCE)) {
      expect(t(legacy)).toBe(reviewed);
      expect(t(reviewed)).toBe(reviewed);
      expect(placeholders(reviewed)).toEqual(placeholders(legacy));
    }
    for (const key of ['constructor', '__proto__', 'toString', 'Название собственного набора']) {
      expect(russianText(key)).toBe(key);
      expect(t(key)).toBe(key);
    }
  });

  it.each(['uk', 'en', 'de'] as const)('translates both the old key and Russian reference in %s', lang => {
    updateSettings({ lang });
    for (const [legacy, reviewed] of Object.entries(RUSSIAN_REFERENCE)) {
      expect(Object.hasOwn(DICTS[lang], legacy), legacy).toBe(true);
      expect(Object.hasOwn(DICTS[lang], reviewed), reviewed).toBe(true);
      expect(DICTS[lang][reviewed]).toBe(DICTS[lang][legacy]);
      expect(t(reviewed, { n: 1 })).toBe(t(legacy, { n: 1 }));
    }
  });

  it('updates stored journal copy only at display time after switching languages', () => {
    const legacy = 'Проверок использовано: {n}/2. Первая бесплатна, следующая стоит 3 очка. Не более одной за круг.';
    const stored = packT(legacy, { n: 1 });
    updateSettings({ lang: 'ru' });
    expect(tPacked(stored)).toBe('Проверок использовано: 1/2. Первая бесплатна, вторая стоит 3 очка. Не более одной за раунд.');
    updateSettings({ lang: 'en' });
    expect(tPacked(stored)).toBe('Investigations used: 1/2. The first is free; the second costs 3 points. At most one per round.');
    expect(stored.split('\u0001')[0]).toBe(legacy);
    expect(JSON.parse(stored.split('\u0001')[1])).toEqual({ n: 1 });
  });

  it.each(['uk', 'en', 'de'] as const)('lazy loading %s creates the same aliases as the eager test registry', async lang => {
    const eager = DICTS[lang];
    delete DICTS[lang];
    try {
      updateSettings({ lang });
      expect(t('Это я — показать')).toBe('Это я — открыть');
      await Promise.all([loadLang(lang), loadLang(lang)]);
      expect(DICTS[lang]).toEqual(eager);
      expect(t('Это я — открыть')).toBe(eager['Это я — показать']);
    } finally { DICTS[lang] = eager; }
  });

  it('does not mutate a dictionary or overwrite an explicitly reviewed translation', () => {
    const dictionary = Object.freeze({ 'Личный кабинет': 'Legacy', 'Личный экран': 'Reviewed' });
    const result = applyRussianReference(dictionary);
    expect(result['Личный экран']).toBe('Reviewed');
    expect(result).not.toBe(dictionary);
    expect(dictionary).toEqual({ 'Личный кабинет': 'Legacy', 'Личный экран': 'Reviewed' });
  });

  it('uses a universal handoff label and keeps private children hidden in every language', () => {
    const labels = { ru: 'Это я — открыть', uk: 'Це я — відкрити', en: 'That’s me — open', de: 'Das bin ich — öffnen' } as const;
    for (const lang of ['ru', 'uk', 'en', 'de'] as const) {
      updateSettings({ lang });
      const html = renderToStaticMarkup(<Gate name="Анна"><p>PRIVATE_ROLE_AND_RESULTS</p></Gate>);
      expect(html).toContain(labels[lang]);
      expect(html).not.toContain('PRIVATE_ROLE_AND_RESULTS');
    }
  });

  it('names the actual hide button in private handoff instructions', () => {
    for (const lang of ['ru', 'uk', 'en', 'de'] as const) {
      updateSettings({ lang });
      expect(t('Откройте только свой кабинет. Перед передачей нажмите «Скрыть».')).toContain(t('Скрыть'));
    }
  });
});
