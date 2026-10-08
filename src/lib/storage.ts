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

/** Свои паки. Повреждённое хранилище (не список, битый пак) не должно ронять запуск: плохие записи пропускаем. */
export const loadPacks = (): CardPack[] => {
  const raw = read<unknown>(K_PACKS);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    try {
      const pack = sanitizePack(x);
      return pack ? [pack] : [];
    } catch {
      return [];
    }
  });
};
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
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
// isRevealed может отсутствовать в старых сохранениях: тогда считаем карту закрытой.
const validSlot = (slot: unknown) =>
  isObj(slot) && isObj(slot.card) && typeof slot.card.description === 'string' && (slot.isRevealed === undefined || typeof slot.isRevealed === 'boolean');
const isStr = (v: unknown): v is string => typeof v === 'string';
const strList = (v: unknown) => Array.isArray(v) && v.every(isStr);
const MODES = ['pass-and-play', 'tabletop', 'online'];
const VOTINGS = ['secret', 'open'];
const MODIFIERS = ['positive', 'neutral', 'negative'];
const validCard = (c: unknown) =>
  isObj(c) && isStr(c.description) && (c.tags === undefined || strList(c.tags)) && (c.modifier === undefined || MODIFIERS.includes(c.modifier as string)) && (c.title === undefined || isStr(c.title));
const validHazard = (h: unknown) => isObj(h) && isStr(h.id) && isStr(h.title) && (h.counters === undefined || strList(h.counters));
const validDeck = (d: unknown) => d === undefined || (isObj(d) && Object.values(d).every((list) => Array.isArray(list) && list.every(validCard)));
const validScenario = (s: unknown) =>
  isObj(s) && isStr(s.title) && (s.description === undefined || isStr(s.description)) && (s.isolationDuration === undefined || isStr(s.isolationDuration)) &&
  (s.requiredSkills === undefined || strList(s.requiredSkills)) && (s.hazards === undefined || (Array.isArray(s.hazards) && s.hazards.every(validHazard)));
const validConfig = (c: unknown) =>
  isObj(c) && isNum(c.playerCount) && isNum(c.shelterSlots) && MODES.includes(c.mode as string) && VOTINGS.includes(c.voting as string) &&
  (c.revealsPerVote === undefined || isNum(c.revealsPerVote)) && (c.names === undefined || strList(c.names));
const validEvent = (e: unknown) => isObj(e) && isStr(e.title) && isStr(e.text) && strList(e.outcome ?? []);
const validPerks = (p: unknown) => p === undefined || (Array.isArray(p) && p.every((x) => isObj(x) && isStr(x.playerId) && ['steal', 'heal', 'reveal'].includes(x.kind as string)));
const validResult = (r: unknown) => r === undefined || (isObj(r) && Array.isArray(r.eliminated) && r.eliminated.every(isStr) && isObj(r.tally) && Object.values(r.tally).every(isNum));
const validFx = (fx: unknown) =>
  isObj(fx) &&
  ['double', 'veto', 'immune'].every((k) => Array.isArray(fx[k]) && (fx[k] as unknown[]).every((x) => typeof x === 'string')) &&
  Array.isArray(fx.allies) &&
  fx.allies.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((x) => typeof x === 'string'));

/**
 * Проверка структуры сохранённой партии. Битое или чужое сохранение не должно ронять экран:
 * в таком случае возвращаем null, и игра начинается с чистого листа. Карты новых категорий допускаются отсутствующими (их достроит withNewSlots).
 */
export function validateSavedGame(raw: unknown): GameState | null {
  if (!isObj(raw) || !Array.isArray(raw.players) || raw.players.length < 1 || raw.players.length > 40) return null;
  if (!isObj(raw.scenario) || typeof raw.scenario.title !== 'string' || !isObj(raw.config)) return null;
  if (typeof raw.phase !== 'string' || !PHASES.includes(raw.phase)) return null;
  if (typeof raw.round !== 'number' || !Number.isFinite(raw.round)) return null;
  if (!Array.isArray(raw.schedule) || !raw.schedule.every(isNum)) return null;
  if (!Array.isArray(raw.revealedThisRound) || !raw.revealedThisRound.every((x) => typeof x === 'string')) return null;
  if (!Array.isArray(raw.log) || !raw.log.every((l) => isObj(l) && isNum(l.round) && typeof l.text === 'string')) return null;
  if (!isObj(raw.votes) || !Object.values(raw.votes).every((v) => typeof v === 'string')) return null;
  if (!isNum(raw.seed)) return null;
  if (raw.deadline !== undefined && !isNum(raw.deadline)) return null;
  if (raw.speechEndsAt !== undefined && !isNum(raw.speechEndsAt)) return null;
  if (!validScenario(raw.scenario) || !validConfig(raw.config)) return null;
  if (raw.event !== undefined && !validEvent(raw.event)) return null;
  if (raw.hazards !== undefined && !(Array.isArray(raw.hazards) && raw.hazards.every(validHazard))) return null;
  if (raw.usedEvents !== undefined && !strList(raw.usedEvents)) return null;
  if (raw.lastReveal !== undefined && !(isObj(raw.lastReveal) && isStr(raw.lastReveal.playerId) && CATEGORIES.includes(raw.lastReveal.category as Category))) return null;
  if (!validResult(raw.lastResult) || !validPerks(raw.perks) || !validDeck(raw.deck) || !validDeck(raw.discard)) return null;
  if (raw.perkResult !== undefined && !(isObj(raw.perkResult) && isStr(raw.perkResult.playerId) && isStr(raw.perkResult.text))) return null;
  if (raw.fx !== undefined && !validFx(raw.fx)) return null;
  for (const p of raw.players) {
    if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string' || !isObj(p.slots)) return null;
    if (p.isEliminated !== undefined && typeof p.isEliminated !== 'boolean') return null;
    for (const c of CATEGORIES) {
      const slot = p.slots[c];
      if (slot === undefined && ADDED.includes(c)) continue;
      if (!validSlot(slot) || !validCard((slot as { card: unknown }).card)) return null;
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
