import { CATEGORIES, type Card, type CardPack, type Category, type PlayerCharacter } from '../types';
import { GENERIC_CHARACTER, GENERIC_PHYSIQUE } from '../data/physique';
import { shuffle, type Rng } from './rng';

/** Объединяет пулы выбранных паков по категориям (без дублей по id). */
export function mergePools(packs: CardPack[]): Record<Category, Card[]> {
  const pools = Object.fromEntries(CATEGORIES.map((c) => [c, [] as Card[]])) as Record<Category, Card[]>;
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const cat of CATEGORIES) {
      for (const card of pack.cards[cat] ?? []) {
        const key = `${cat}:${card.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pools[cat].push({ ...card, category: cat });
      }
    }
  }
  // Переопределения способностей из выбранных паков (конструктор сценариев): позднейший пак главнее.
  for (const pack of packs) {
    const ov = pack.tagOverrides;
    if (!ov) continue;
    for (const cat of CATEGORIES) {
      pools[cat] = pools[cat].map((c) => {
        const tags = ov[c.id];
        if (!tags) return c;
        const { tags: _old, ...rest } = c;
        return tags.length ? { ...rest, tags: tags.slice() } : rest;
      });
    }
  }
  return pools;
}

/** Раздаёт карты без повторов, пока хватает пула; если карт меньше, чем игроков, колода перетасовывается заново. */
export function drawCards(pool: Card[], count: number, rng: Rng): Card[] {
  if (pool.length === 0) return [];
  const out: Card[] = [];
  let deck = shuffle(pool, rng);
  while (out.length < count) {
    if (deck.length === 0) deck = shuffle(pool, rng);
    out.push(deck.pop()!);
  }
  return out;
}

export function emptyCard(category: Category): Card {
  return { id: `empty-${category}`, category, description: '— нет карт в выбранных паках —', modifier: 'neutral' };
}

export function generateCharacters(names: string[], packs: CardPack[], rng: Rng): PlayerCharacter[] {
  const pools = mergePools(packs);
  // Старые и самодельные паки могли появиться до карты телосложения: тогда берём общую колоду.
  if (pools.physique.length === 0) pools.physique = GENERIC_PHYSIQUE;
  if (pools.character.length === 0) pools.character = GENERIC_CHARACTER;
  const hands = Object.fromEntries(
    CATEGORIES.map((c) => [c, drawCards(pools[c], names.length, rng)]),
  ) as Record<Category, Card[]>;
  return names.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    isEliminated: false,
    slots: Object.fromEntries(
      CATEGORIES.map((c) => [c, { card: hands[c][i] ?? emptyCard(c), isRevealed: false }]),
    ) as PlayerCharacter['slots'],
  }));
}

/** Перегенерировать одну карту игрока (tabletop: «не нравится — перекинь»). */
export function rerollCard(player: PlayerCharacter, category: Category, packs: CardPack[], rng: Rng): PlayerCharacter {
  const pools = mergePools(packs);
  if (category === 'physique' && pools.physique.length === 0) pools.physique = GENERIC_PHYSIQUE;
  if (category === 'character' && pools.character.length === 0) pools.character = GENERIC_CHARACTER;
  const pool = pools[category].filter((c) => c.id !== player.slots[category].card.id);
  if (pool.length === 0) return player;
  const card = pool[Math.floor(rng() * pool.length)];
  return { ...player, slots: { ...player.slots, [category]: { card, isRevealed: false } } };
}
