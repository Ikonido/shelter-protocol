import type { Card, Category, Modifier } from '../types';
import { LIMITS as L, clip, clipList } from './limits';
import { uid } from './rng';

/**
 * Массовое добавление карт. Формат строки: «Текст | + | тег1, тег2» (знак и теги необязательны).
 * Принимается столько строк, сколько свободных мест в категории; остальные возвращаются как `rest`, чтобы остаться в поле ввода.
 */
export function takeBulk(text: string, category: Category, existing: number): { accepted: Card[]; rest: string[] } {
  const parsed = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [desc, mod, tags] = line.split('|').map((s) => s.trim());
      const modifier: Modifier = mod === '+' ? 'positive' : mod === '-' || mod === '−' ? 'negative' : 'neutral';
      const card: Card = { id: uid('c'), category, description: clip(desc ?? '', L.cardDescription), modifier, ...(tags ? { tags: clipList(tags.split(/[,;]/), L.cardTags, L.tagLen) } : {}) };
      return { line, card };
    })
    .filter((x) => x.card.description);
  const room = Math.max(0, L.cardsPerCategory - existing);
  return { accepted: parsed.slice(0, room).map((x) => x.card), rest: parsed.slice(room).map((x) => x.line) };
}
