/**
 * Словари переводов. Ключ — русский исходный текст (см. lib/i18n.ts).
 * Каждый язык — папка dict/<язык>/, внутри — части (экран, раздел, данные).
 * Ключи должны быть уникальны внутри языка; одинаковый ключ в разных частях — с одинаковым переводом (проверяет i18n.test.ts).
 */
import { DICTS, type Dictionary } from './registry';

export type { Dictionary };

const modules = import.meta.glob<{ default: Dictionary }>('./dict/*/*.ts', { eager: true });

/** Части по языкам: { uk: { 'dict/uk/start.ts': {...}, ... }, en: {...}, de: {...} }. */
export const DICT_PARTS: Record<string, Record<string, Dictionary>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const lang = path.split('/')[2];
  (DICT_PARTS[lang] ??= {})[path] = mod.default;
}

/**
 * Объединённый словарь языка. Русский словаря не имеет: исходные строки и есть перевод.
 * Этот модуль загружает все языки сразу и заполняет общий реестр: он нужен тестам (setup) и проверкам словарей, приложение
 * подключает словари по одному через loadLang (registry.ts).
 */
for (const [lang, parts] of Object.entries(DICT_PARTS)) DICTS[lang] = Object.assign({}, ...Object.values(parts));
export { DICTS };
