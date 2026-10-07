import { CATEGORIES, type CardPack, type Category, type GameState } from '../types';
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

const PHASES = ['event', 'reveal', 'speech', 'vote', 'result', 'final', 'debate'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Проверка структуры сохранённой партии. Битое или чужое сохранение не должно ронять экран:
 * в таком случае возвращаем null, и игра начинается с чистого листа. Карты новых категорий допускаются отсутствующими (их достроит withNewSlots).
 */
export function validateSavedGame(raw: unknown): GameState | null {
  if (!isObj(raw) || !Array.isArray(raw.players) || raw.players.length < 1 || raw.players.length > 40) return null;
  if (!isObj(raw.scenario) || typeof raw.scenario.title !== 'string' || !isObj(raw.config)) return null;
  if (typeof raw.phase !== 'string' || !PHASES.includes(raw.phase)) return null;
  if (typeof raw.round !== 'number' || !Number.isFinite(raw.round)) return null;
  if (!Array.isArray(raw.schedule) || !Array.isArray(raw.revealedThisRound) || !Array.isArray(raw.log) || !isObj(raw.votes)) return null;
  for (const p of raw.players) {
    if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string' || !isObj(p.slots)) return null;
    for (const c of CATEGORIES) {
      const slot = p.slots[c];
      if (slot === undefined && ADDED.includes(c)) continue;
      if (!isObj(slot) || !isObj(slot.card) || typeof slot.card.description !== 'string') return null;
    }
  }
  return raw as unknown as GameState;
}

export const loadGame = (): GameState | null => {
  const g = validateSavedGame(read<unknown>(K_GAME));
  if (!g) return null;
  // Сохранения старой версии: общая фаза дебатов упразднена (теперь у каждого своя речь) — идём сразу к голосованию.
  if ((g.phase as string) === 'debate') return withNewSlots({ ...g, phase: 'vote', votes: {} });
  return withNewSlots(g);
};
export const saveGame = (g: GameState | null) => write(K_GAME, g);
