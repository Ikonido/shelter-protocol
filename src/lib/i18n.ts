import { getSettings } from './settings';
import { UK } from '../i18n/uk';

/**
 * Перевод интерфейса. Ключ — русский исходный текст, так что непереведённая строка просто остаётся русской.
 * Переменные пишутся как `{name}`: t('Раунд {n}', { n: 2 }).
 * Вызывать внутри рендера или обработчика, а не в константах уровня модуля: иначе язык не переключится.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = getSettings().lang === 'uk' ? (UK[text] ?? text) : text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}

/**
 * Склонение по числу. Формы — (1, 2–4, 5+) в русском и (1, 2–4, 5+) в украинском: правила совпадают.
 * ru: plural(3, ['карта', 'карты', 'карт']); uk: передаётся третьим аргументом, если отличается.
 */
export function plural(n: number, ru: [string, string, string], uk?: [string, string, string]): string {
  const m100 = Math.abs(n) % 100;
  const m10 = m100 % 10;
  const idx = m100 > 10 && m100 < 20 ? 2 : m10 === 1 ? 0 : m10 >= 2 && m10 <= 4 ? 1 : 2;
  const forms = getSettings().lang === 'uk' && uk ? uk : ru;
  return forms[idx];
}
