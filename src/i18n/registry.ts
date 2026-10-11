/**
 * Реестр словарей. Русского словаря нет: исходные строки и есть русский текст. Словарь языка подгружается отдельным чанком
 * (loadLang), поэтому русскоязычный игрок не скачивает переводы вообще, а остальные — только свой язык.
 */
export type Dictionary = Record<string, string>;

/** Загруженные словари по языкам. lib/i18n.ts читает отсюда в момент вызова t(). */
export const DICTS: Record<string, Dictionary> = {};

const LOADERS: Record<string, () => Promise<{ default: Dictionary }>> = {
  uk: () => import('./lang/uk'),
  en: () => import('./lang/en'),
  de: () => import('./lang/de'),
};

const pending = new Map<string, Promise<void>>();

/** Загружает словарь языка (один раз). Для ru и неизвестных языков ничего не делает. */
export function loadLang(lang: string): Promise<void> {
  const load = LOADERS[lang];
  if (!load || DICTS[lang]) return Promise.resolve();
  let p = pending.get(lang);
  if (!p) {
    p = load().then((m) => { DICTS[lang] = m.default; }).finally(() => pending.delete(lang));
    pending.set(lang, p);
  }
  return p;
}
