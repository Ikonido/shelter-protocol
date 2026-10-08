import type { Card, GameState, PlayerCharacter } from '../types';
import { LIMITS as L } from './limits';
import { mulberry32 } from './rng';

/**
 * Инвентарь игрока: несколько предметов в одной карточке «Багаж».
 * Карточка составная: описание — предметы через « + », навыки — объединение, открытость — общая для всех предметов.
 * Поэтому оценка навыков, показ и скрытие в онлайне работают как раньше. Предметы по отдельности лежат в `items`.
 */

export const MAX_ITEMS = 4;

/** Заглушки «потерян» и «украден» — это пустой багаж, а не предмет. */
export const isPlaceholder = (c: Card) => c.id.startsWith('lost-') || c.id.startsWith('stolen-');

/** Предметы в карточке багажа (пустой багаж — пустой список). */
export const itemsOf = (card: Card): Card[] => (isPlaceholder(card) ? [] : (card.items ?? [card]));

const score = (c: Card) => (c.modifier === 'positive' ? 2 : c.modifier === 'negative' ? 0 : 1) + (c.tags?.length ? 0.5 : 0);

/** Собирает карточку багажа из предметов; пустой набор — переданная заглушка. */
export function composeItems(items: Card[], empty: () => Card): Card {
  if (items.length === 0) return empty();
  if (items.length === 1) return items[0];
  const plus = items.filter((i) => i.modifier === 'positive').length;
  const minus = items.filter((i) => i.modifier === 'negative').length;
  const description = items.map((i) => i.description).join(' + ');
  return {
    id: `bag-${items.map((i) => i.id).join('+')}`.slice(0, 60),
    category: 'luggage',
    description: description.length > L.cardDescription ? `${description.slice(0, L.cardDescription - 1)}…` : description,
    modifier: plus > minus ? 'positive' : minus > plus ? 'negative' : 'neutral',
    tags: [...new Set(items.flatMap((i) => i.tags ?? []))],
    items,
  };
}

/** Добавляет предмет; если места нет — остаётся самый ценный, а лишний предмет возвращается как `dropped`. */
export function addToBag(items: Card[], item: Card): { items: Card[]; dropped?: Card } {
  if (items.length < MAX_ITEMS) return { items: [...items, item] };
  const worst = items.reduce((w, c) => (score(c) < score(w) ? c : w), items[0]);
  if (score(item) <= score(worst)) return { items, dropped: item };
  return { items: [...items.filter((c) => c !== worst), item], dropped: worst };
}

/**
 * Раздача предметов на старте: у каждого игрока уже есть один, и с вероятностью 1/2 добавляется второй из колоды.
 * Детерминированно от seed.
 */
export function dealStartingItems(
  players: PlayerCharacter[],
  deck: GameState['deck'],
  seed: number,
): { players: PlayerCharacter[]; deck: GameState['deck'] } {
  const rng = mulberry32(seed ^ 0x51ed270b);
  const luggage = [...(deck?.luggage ?? [])];
  const next = players.map((p) => {
    if (rng() >= 0.5 || luggage.length === 0) return p;
    const extra = luggage.shift()!;
    const items = addToBag(itemsOf(p.slots.luggage.card), extra).items;
    return { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: composeItems(items, () => p.slots.luggage.card) } } };
  });
  return { players: next, deck: { ...deck, luggage } as GameState['deck'] };
}
