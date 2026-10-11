import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUILTIN_PACKS } from '../data/classicPack';
import { packT, t, tPacked } from '../lib/i18n';
import { updateSettings } from '../lib/settings';
import { CATEGORIES } from '../types';
import { Gate } from '../ui/Gate';
import { canonicalKey, LEGACY_KEYS } from './aliases';
import { DICTS } from './index';

const LANGS = ['uk', 'en', 'de'] as const;
const entries = Object.entries(LEGACY_KEYS);
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
/** Значения для всех переменных, какие бывают в строках: так сравнивается подстановка у старого и нового ключа. */
const VARS = { n: 7, name: 'Анна', desc: 'Нож', who: 'Анна', title: 'Вето', total: 5, slots: 3, victim: 'Борис', a: 'А', b: 'Б', label: 'Ярлык' };

afterEach(() => updateSettings({ lang: 'ru' }));

describe('единая таблица прежних формулировок (aliases.ts)', () => {
  it('записи корректны: нет пустых, самоссылок, цепочек и циклов; переменные совпадают', () => {
    expect(entries.length).toBeGreaterThanOrEqual(42);
    for (const [old, current] of entries) {
      expect(old.trim(), 'пустой старый ключ').not.toBe('');
      expect(current.trim(), `пустой текущий текст для «${old}»`).not.toBe('');
      expect(current, `самоссылка «${old}»`).not.toBe(old);
      expect(Object.hasOwn(LEGACY_KEYS, current), `цепочка: «${current}» сам объявлен прежним`).toBe(false);
      expect(placeholders(current), `переменные «${old}»`).toEqual(placeholders(old));
    }
  });

  it('canonicalKey идемпотентен и не цепляет унаследованные свойства Object', () => {
    for (const [old, current] of entries) {
      expect(canonicalKey(old)).toBe(current);
      expect(canonicalKey(current)).toBe(current);
      expect(canonicalKey(canonicalKey(old))).toBe(canonicalKey(old));
    }
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'Название собственного набора', '']) expect(canonicalKey(key)).toBe(key);
  });

  it('у старого ключа нет собственных записей в словарях (источник истины один), у нового перевод есть везде', () => {
    for (const lang of LANGS) {
      for (const [old, current] of entries) {
        expect(Object.hasOwn(DICTS[lang], old), `[${lang}] «${old}» не должен быть ключом словаря`).toBe(false);
        expect(Object.hasOwn(DICTS[lang], current), `[${lang}] нет перевода «${current}»`).toBe(true);
        expect(DICTS[lang][current].trim(), `[${lang}] пустой перевод «${current}»`).not.toBe('');
        expect(placeholders(DICTS[lang][current]), `[${lang}] переменные «${current}»`).toEqual(placeholders(current));
      }
    }
  });

  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

  it('встроенный контент и исходники используют только текущие формулировки', () => {
    const texts = new Set<string>();
    for (const p of BUILTIN_PACKS) {
      texts.add(p.name); texts.add(p.description);
      for (const sc of p.scenarios) {
        texts.add(sc.title); texts.add(sc.description);
        for (const h of sc.hazards ?? []) { texts.add(h.title); texts.add(h.description); if (h.onSuccess) texts.add(h.onSuccess); if (h.onFail) texts.add(h.onFail); }
        for (const e of sc.events ?? []) { texts.add(e.title); texts.add(e.text); }
      }
      for (const c of CATEGORIES) for (const k of p.cards[c]) { texts.add(k.description); if (k.title) texts.add(k.title); }
    }
    expect(entries.map(([old]) => old).filter((old) => texts.has(old)), 'устаревшая формулировка во встроенном паке').toEqual([]);
    const sources = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && f !== join('src', 'i18n', 'aliases.ts'));
    const used: string[] = [];
    for (const f of sources) {
      const code = readFileSync(f, 'utf8');
      for (const [old] of entries) if (code.includes(`'${old.replaceAll("'", "\\'")}'`)) used.push(`${f}: ${old}`);
    }
    expect(used, 'устаревшая формулировка в исходниках').toEqual([]);
  });
});

describe('показ старых и новых строк', () => {
  it('A/B/C: старый ключ показывается так же, как новый, на всех языках и с подстановкой переменных', () => {
    for (const lang of ['ru', ...LANGS] as const) {
      updateSettings({ lang });
      for (const [old, current] of entries) {
        expect(t(old, VARS), `${lang}: «${old}»`).toBe(t(current, VARS));
        if (lang === 'ru') expect(t(old), 'ru показывает текущий текст').toBe(current);
        else expect(t(old), `${lang}`).toBe(DICTS[lang][current]);
        expect(t(current), `${lang}: у текущей формулировки нет возврата к старой`).not.toBe(old);
      }
    }
  });

  it('A: запись журнала со старым ключом не переписывается и переводится при показе после смены языка', () => {
    const old = 'Проверок использовано: {n}/2. Первая бесплатна, следующая стоит 3 очка. Не более одной за круг.';
    const stored = packT(old, { n: 1 });
    const snapshot = JSON.stringify(stored);
    updateSettings({ lang: 'ru' });
    expect(tPacked(stored)).toBe('Проверок использовано: 1/2. Первая бесплатна, вторая стоит 3 очка. Не более одной за раунд.');
    updateSettings({ lang: 'en' });
    expect(tPacked(stored)).toBe('Investigations used: 1/2. The first is free; the second costs 3 points. At most one per round.');
    updateSettings({ lang: 'de' });
    expect(tPacked(stored)).toMatch(/^Ermittlungen genutzt: 1\/2\./);
    expect(stored.split('\u0001')[0]).toBe(old);
    expect(JSON.parse(stored.split('\u0001')[1])).toEqual({ n: 1 });
    expect(JSON.stringify(stored)).toBe(snapshot);
  });

  it('A: старая карта из сохранения (в том числе внутри составного багажа) переводится как текущая', () => {
    updateSettings({ lang: 'en' });
    expect(t('Банка консервированных ананасов — одна на всех')).toBe('A can of pineapple');
    expect(t('Банка консервированных ананасов — одна на всех + Тазик')).toBe('A can of pineapple + Basin');
    updateSettings({ lang: 'ru' });
    expect(t('Банка консервированных ананасов — одна на всех + Тазик')).toBe('Банка консервированных ананасов + Тазик');
    expect(t('Тазик + Пять левых ботинок')).toBe('Тазик + Пять левых ботинок');
  });

  it('текст без алиаса и пользовательский текст остаются как есть (в том числе названия, похожие на свойства Object)', () => {
    for (const lang of ['ru', ...LANGS] as const) {
      updateSettings({ lang });
      for (const key of ['constructor', '__proto__', 'Название собственного набора']) expect(t(key)).toBe(key);
    }
  });

  it('F: результат детерминирован при повторных вызовах и не зависит от порядка языков', () => {
    const results = new Map<string, string>();
    for (const round of [1, 2]) {
      for (const lang of ['de', 'ru', 'uk', 'en'] as const) {
        updateSettings({ lang });
        for (const [old] of entries) {
          const k = `${lang}|${old}`;
          const v = t(old, VARS);
          if (round === 1) results.set(k, v); else expect(v, k).toBe(results.get(k));
        }
      }
    }
  });
});

describe('ленивая загрузка словарей (D)', () => {
  it.each(LANGS)('загрузка %s не тянет другие языки, повторные вызовы идут одним запросом, словарь равен полному', async (lang) => {
    vi.resetModules();
    const registry = await import('./registry');
    expect(Object.keys(registry.DICTS)).toEqual([]);
    const [first, second] = [registry.loadLang(lang), registry.loadLang(lang)];
    expect(first).toBe(second);
    await first;
    expect(Object.keys(registry.DICTS)).toEqual([lang]);
    expect(registry.DICTS[lang]).toEqual(DICTS[lang]);
    await registry.loadLang('ru');
    expect(Object.keys(registry.DICTS)).toEqual([lang]);
  });
});

describe('приватный экран (E)', () => {
  it('универсальная подпись передачи устройства; скрытое содержимое не выводится ни на одном языке', () => {
    const labels = { ru: 'Это я — открыть', uk: 'Це я — відкрити', en: 'That’s me — open', de: 'Das bin ich — öffnen' } as const;
    for (const lang of ['ru', 'uk', 'en', 'de'] as const) {
      updateSettings({ lang });
      const html = renderToStaticMarkup(<Gate name="Анна"><p>PRIVATE_ROLE_AND_RESULTS</p></Gate>);
      expect(html, lang).toContain(labels[lang]);
      expect(html, lang).not.toContain('PRIVATE_ROLE_AND_RESULTS');
    }
  });

  it('подсказка о передаче устройства называет настоящую кнопку «Скрыть»', () => {
    const hint = canonicalKey('Откройте только свой кабинет. Перед передачей нажмите «Скрыть».');
    for (const lang of ['ru', 'uk', 'en', 'de'] as const) {
      updateSettings({ lang });
      expect(t(hint), lang).toContain(t('Скрыть'));
    }
  });
});
