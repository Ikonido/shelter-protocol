import type { Card } from '../types';

/** Поиск карт в редакторе: по описанию, названию и тегам, без учёта регистра и ё. */
export function filterCards(cards: Card[], query: string): Card[] {
  const norm = (t: string) => t.toLowerCase().replace(/ё/g, 'е');
  const q = norm(query.trim());
  if (!q) return cards;
  return cards.filter((c) => norm(`${c.title ?? ''} ${c.description} ${(c.tags ?? []).join(' ')}`).includes(q));
}
