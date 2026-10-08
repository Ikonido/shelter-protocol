import { getSettings } from './settings';
import { DICTS } from '../i18n';

/**
 * Перевод интерфейса. Ключ — русский исходный текст, так что непереведённая строка просто остаётся русской.
 * Переменные пишутся как `{name}`: t('Раунд {n}', { n: 2 }).
 * Вызывать внутри рендера или обработчика, а не в константах уровня модуля: иначе язык не переключится.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const lang = getSettings().lang;
  const out = lang === 'ru' ? text : (DICTS[lang]?.[text] ?? text);
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
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
