import { getSettings } from './settings';
import { DICTS } from '../i18n';

/**
 * Перевод интерфейса. Ключ — русский исходный текст, так что непереведённая строка просто остаётся русской.
 * Переменные пишутся как `{name}`: t('Раунд {n}', { n: 2 }).
 * Вызывать внутри рендера или обработчика, а не в константах уровня модуля: иначе язык не переключится.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const lang = getSettings().lang;
  const dict = lang === 'ru' ? undefined : DICTS[lang];
  let out = dict?.[text] ?? text;
  // Составной текст «багаж + предмет» (бонус профессии): переводим части по отдельности.
  if (dict && !(text in dict) && text.includes(' + ')) out = text.split(' + ').map((part) => dict[part] ?? part).join(' + ');
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}

/** Переменные, чьи значения — данные игры и переводятся при показе (названия категорий, описания, названия угроз). */
const TRANSLATED_VARS = ['cat', 'desc', 'title', 'direction', 'result', 'evidence', 'action'];

/**
 * Хранимая строка «шаблон + переменные»: в состоянии партии лежит русский ключ, а переводится он при показе,
 * поэтому смена языка меняет и уже созданный текст. Читается через tPacked.
 */
export function packT(text: string, vars?: Record<string, string | number>): string {
  return vars ? `${text}\u0001${JSON.stringify(vars)}` : text;
}

/** Показывает строку из packT (или обычную, например из старого сохранения) на текущем языке. */
export function tPacked(s: string): string {
  const i = s.indexOf('\u0001');
  if (i < 0) return t(s);
  const key = s.slice(0, i);
  try {
    const vars = JSON.parse(s.slice(i + 1)) as Record<string, string | number>;
    for (const k of TRANSLATED_VARS) if (typeof vars[k] === 'string') vars[k] = t(vars[k] as string);
    return t(key, vars);
  } catch {
    return t(key);
  }
}

export type Forms = readonly string[];

/**
 * Склонение по числу. Формы: ru и uk — три (1 / 2–4 / 5+), en и de — две (1 / остальные).
 * Для языков без своей формы берётся русская. Пример:
 * plural(n, { ru: ['карта', 'карты', 'карт'], uk: ['картка', 'картки', 'карток'], en: ['card', 'cards'], de: ['Karte', 'Karten'] })
 */
export function plural(n: number, forms: { ru: Forms; uk?: Forms; en?: Forms; de?: Forms }): string {
  const lang = getSettings().lang;
  if (lang === 'en' || lang === 'de') {
    const f = forms[lang] ?? forms.ru;
    return f[Math.abs(n) === 1 ? 0 : Math.min(1, f.length - 1)];
  }
  const f = (lang === 'uk' && forms.uk) || forms.ru;
  const m100 = Math.abs(n) % 100;
  const m10 = m100 % 10;
  const idx = m100 > 10 && m100 < 20 ? 2 : m10 === 1 ? 0 : m10 >= 2 && m10 <= 4 ? 1 : 2;
  return f[Math.min(idx, f.length - 1)];
}
