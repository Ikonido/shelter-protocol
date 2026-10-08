/**
 * Украинский перевод. Ключ — русский исходный текст (см. lib/i18n.ts).
 * Каждая часть — отдельный файл в parts/ (экран, раздел, данные); здесь они собираются вместе.
 * Ключи должны быть уникальны во всех частях — это проверяет i18n.test.ts.
 */
const parts = import.meta.glob<{ default: Record<string, string> }>('./parts/*.ts', { eager: true });

export const UK_PARTS: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(parts).map(([path, mod]) => [path, mod.default]),
);

export const UK: Record<string, string> = Object.assign({}, ...Object.values(UK_PARTS));
