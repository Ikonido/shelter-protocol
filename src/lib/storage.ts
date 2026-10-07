import type { CardPack, Category, GameState } from '../types';
import { emptyCard } from './generator';
import { sanitizePack } from './packs';

const K_PACKS = 'shelter:customPacks';
const K_GAME = 'shelter:game';

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим или переполнение — игра продолжает работать без сохранения */
  }
}

export const loadPacks = (): CardPack[] =>
  (read<unknown[]>(K_PACKS) ?? []).map(sanitizePack).filter((p): p is CardPack => !!p);
export const savePacks = (packs: CardPack[]) => write(K_PACKS, packs);

/** Сохранения до появления новых категорий (телосложение, характер): добавляем недостающие карты, чтобы интерфейс не падал. */
const ADDED: Category[] = ['physique', 'character'];
function withNewSlots(g: GameState): GameState {
  if (g.players.every((p) => ADDED.every((c) => p.slots?.[c]))) return g;
  return {
    ...g,
    players: g.players.map((p) => ({
      ...p,
      slots: { ...p.slots, ...Object.fromEntries(ADDED.filter((c) => !p.slots[c]).map((c) => [c, { card: emptyCard(c), isRevealed: false }])) },
    })),
  };
}

export const loadGame = (): GameState | null => {
  const g = read<GameState>(K_GAME);
  if (!g || !Array.isArray(g.players) || !g.scenario || !g.config) return null;
  // Сохранения старой версии: общая фаза дебатов упразднена (теперь у каждого своя речь) — идём сразу к голосованию.
  if ((g.phase as string) === 'debate') return withNewSlots({ ...g, phase: 'vote', votes: {} });
  return withNewSlots(g);
};
export const saveGame = (g: GameState | null) => write(K_GAME, g);
