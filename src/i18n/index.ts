/**
 * Словари переводов. Ключ — русский исходный текст (см. lib/i18n.ts).
 * Каждый язык — папка dict/<язык>/, внутри — части (экран, раздел, данные).
 * Ключи должны быть уникальны внутри языка; одинаковый ключ в разных частях — с одинаковым переводом (проверяет i18n.test.ts).
 */
export type Dictionary = Record<string, string>;

const modules = import.meta.glob<{ default: Dictionary }>('./dict/*/*.ts', { eager: true });

/** Части по языкам: { uk: { 'dict/uk/start.ts': {...}, ... }, en: {...}, de: {...} }. */
export const DICT_PARTS: Record<string, Record<string, Dictionary>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const lang = path.split('/')[2];
  (DICT_PARTS[lang] ??= {})[path] = mod.default;
}

/** Объединённый словарь языка. Русский словаря не имеет: исходные строки и есть перевод. */
export const DICTS: Record<string, Dictionary> = Object.fromEntries(
  Object.entries(DICT_PARTS).map(([lang, parts]) => [lang, Object.assign({}, ...Object.values(parts))]),
);
