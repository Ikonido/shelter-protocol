import {
  CATEGORIES,
  CATEGORY_LABEL,
  type Category,
  type GameState,
  type PlayerCharacter,
  type RoundResult,
  type Scenario,
  type SessionConfig,
  type CardPack,
} from '../types';
import { generateCharacters } from './generator';
import { mulberry32, shuffle } from './rng';

export const MAX_ROUNDS = 6;
export const REVEALABLE: Category[] = CATEGORIES.filter((c) => c !== 'action');

/** Сколько человек исключается в каждом раунде: N−K делится не более чем на MAX_ROUNDS раундов. */
export function buildSchedule(playerCount: number, slots: number): number[] {
  const total = Math.max(0, playerCount - slots);
  if (total === 0) return [];
  const rounds = Math.min(total, MAX_ROUNDS);
  const base = Math.floor(total / rounds);
  const rem = total % rounds;
  return Array.from({ length: rounds }, (_, i) => base + (i < rem ? 1 : 0));
}

export function clampConfig(playerCount: number, slots: number) {
  const n = Math.min(20, Math.max(2, Math.round(playerCount) || 2));
  const k = Math.min(n - 1, Math.max(1, Math.round(slots) || 1));
  return { n, k };
}

export function createGame(config: SessionConfig, scenario: Scenario, packs: CardPack[]): GameState {
  const rng = mulberry32(config.seed);
  const players = generateCharacters(config.names, packs, rng);
  return {
    config,
    scenario: { ...scenario },
    players,
    round: 1,
    schedule: buildSchedule(config.playerCount, config.shelterSlots),
    phase: config.mode === 'tabletop' ? 'final' : 'reveal',
    revealedThisRound: [],
    votes: {},
    log: [],
    seed: config.seed,
  };
}

export const alive = (g: GameState) => g.players.filter((p) => !p.isEliminated);
export const quotaThisRound = (g: GameState) => g.schedule[g.round - 1] ?? 0;

/** Карты, которые игрок может открыть в этом раунде. В первом раунде обязательно открывается профессия. */
export function revealOptions(g: GameState, p: PlayerCharacter): Category[] {
  const hidden = REVEALABLE.filter((c) => !p.slots[c].isRevealed);
  if (g.round === 1 && hidden.includes('profession')) return ['profession'];
  return hidden;
}

export function pendingReveal(g: GameState): PlayerCharacter[] {
  return alive(g).filter((p) => !g.revealedThisRound.includes(p.id) && revealOptions(g, p).length > 0);
}

export function revealCard(g: GameState, playerId: string, category: Category): GameState {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.isEliminated || g.phase !== 'reveal') return g;
  if (g.revealedThisRound.includes(playerId) || !revealOptions(g, p).includes(category)) return g;
  const players = g.players.map((x) =>
    x.id === playerId ? { ...x, slots: { ...x.slots, [category]: { ...x.slots[category], isRevealed: true } } } : x,
  );
  const next: GameState = {
    ...g,
    players,
    revealedThisRound: [...g.revealedThisRound, playerId],
    log: [
      ...g.log,
      { round: g.round, text: `${p.name} открывает «${CATEGORY_LABEL[category]}»: ${p.slots[category].card.description}` },
    ],
  };
  return pendingReveal(next).length === 0 ? { ...next, phase: 'debate' } : next;
}

export function playAction(g: GameState, playerId: string): GameState {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.isEliminated || p.slots.action.isRevealed) return g;
  const card = p.slots.action.card;
  return {
    ...g,
    players: g.players.map((x) =>
      x.id === playerId ? { ...x, slots: { ...x.slots, action: { ...x.slots.action, isRevealed: true } } } : x,
    ),
    log: [
      ...g.log,
      { round: g.round, text: `${p.name} применяет карту действия «${card.title ?? 'Действие'}»: ${card.description}` },
    ],
  };
}

export function startVote(g: GameState): GameState {
  return { ...g, phase: 'vote', votes: {} };
}

export function castVote(g: GameState, voterId: string, targetId: string): GameState {
  if (voterId === targetId) return g;
  return { ...g, votes: { ...g.votes, [voterId]: targetId } };
}

export function allVoted(g: GameState): boolean {
  return alive(g).every((p) => g.votes[p.id]);
}

/** Подсчёт голосов. Ничьи на границе квоты разрешаются жребием (детерминированным от seed и раунда). */
export function resolveVote(g: GameState): GameState {
  const living = alive(g);
  const quota = Math.min(quotaThisRound(g), living.length);
  const tally: Record<string, number> = Object.fromEntries(living.map((p) => [p.id, 0]));
  for (const [voter, target] of Object.entries(g.votes)) {
    if (tally[voter] !== undefined && tally[target] !== undefined) tally[target]++;
  }
  const rng = mulberry32(g.seed ^ (g.round * 2654435761));
  const ranked = shuffle(living, rng).sort((a, b) => tally[b.id] - tally[a.id]);
  const eliminated = ranked.slice(0, quota).map((p) => p.id);
  const cutoff = ranked[quota - 1] ? tally[ranked[quota - 1].id] : 0;
  const tieBreak = living.filter((p) => tally[p.id] === cutoff).length > eliminated.filter((id) => tally[id] === cutoff).length;
  const result: RoundResult = { eliminated, tally, tieBreak };
  const names = eliminated.map((id) => g.players.find((p) => p.id === id)!.name).join(', ');
  return {
    ...g,
    phase: 'result',
    lastResult: result,
    players: g.players.map((p) => (eliminated.includes(p.id) ? { ...p, isEliminated: true } : p)),
    log: [...g.log, { round: g.round, text: `Исключён(ы): ${names}${tieBreak ? ' (ничья решена жребием)' : ''}` }],
  };
}

export function nextRound(g: GameState): GameState {
  const done = alive(g).length <= g.config.shelterSlots || g.round >= g.schedule.length;
  if (done) return { ...g, phase: 'final' };
  return { ...g, round: g.round + 1, phase: 'reveal', revealedThisRound: [], votes: {} };
}

export function setEliminated(g: GameState, playerId: string, eliminated: boolean): GameState {
  return { ...g, players: g.players.map((p) => (p.id === playerId ? { ...p, isEliminated: eliminated } : p)) };
}
