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
/** Потолок раундов, включая добавленные из-за воздержавшихся. */
export const MAX_TOTAL_ROUNDS = 8;
/** Особая «цель» голоса: воздержаться. */
export const ABSTAIN = 'abstain';
export const REVEALABLE: Category[] = CATEGORIES.filter((c) => c !== 'action');

/** Сколько человек исключается в каждом раунде: N−K делится не более чем на MAX_ROUNDS раундов. */
export function buildSchedule(playerCount: number, slots: number, maxRounds = MAX_ROUNDS): number[] {
  const total = Math.max(0, playerCount - slots);
  if (total === 0) return [];
  const rounds = Math.max(1, Math.min(total, maxRounds));
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
    schedule: buildSchedule(config.playerCount, config.shelterSlots, maxRoundsFor(config.revealsPerVote)),
    phase: config.mode === 'tabletop' ? 'final' : 'reveal',
    revealedThisRound: [],
    revealStep: 1,
    ...(config.timeLimitMin > 0 ? { deadline: Date.now() + config.timeLimitMin * 60_000 } : {}),
    votes: {},
    log: [],
    seed: config.seed,
  };
}

export const perVote = (g: GameState) => Math.max(1, g.config.revealsPerVote ?? 1);
export const stepOf = (g: GameState) => g.revealStep ?? 1;
/** Открываемых категорий 6: раундов не больше, чем хватит карт на все вскрытия. */
export const maxRoundsFor = (revealsPerVote: number) =>
  Math.max(1, Math.min(MAX_ROUNDS, Math.floor(REVEALABLE.length / Math.max(1, revealsPerVote || 1))));

export const alive = (g: GameState) => g.players.filter((p) => !p.isEliminated);
export const quotaThisRound = (g: GameState) => g.schedule[g.round - 1] ?? 0;

/** Карты, которые игрок может открыть в этом раунде. В первом раунде обязательно открывается биология (пол и возраст), дальше — любая карта по желанию. */
export function revealOptions(g: GameState, p: PlayerCharacter): Category[] {
  const hidden = REVEALABLE.filter((c) => !p.slots[c].isRevealed);
  if (g.round === 1 && stepOf(g) === 1 && hidden.includes('biology')) return ['biology'];
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
  if (voterId === targetId) return g; // ABSTAIN допустим как цель
  return { ...g, votes: { ...g.votes, [voterId]: targetId } };
}

export function allVoted(g: GameState): boolean {
  return alive(g).every((p) => g.votes[p.id]);
}

/**
 * Подсчёт голосов. Воздержавшиеся не голосуют ни за кого; если их больше половины живых — никто не уходит,
 * а пропущенная квота переносится в дополнительный раунд. Ничьи на границе квоты решаются жребием
 * (детерминированным от seed и раунда).
 */
export function resolveVote(g: GameState): GameState {
  const living = alive(g);
  const quota = Math.min(quotaThisRound(g), living.length);
  const tally: Record<string, number> = Object.fromEntries(living.map((p) => [p.id, 0]));
  let abstained = 0;
  for (const p of living) if (g.votes[p.id] === ABSTAIN) abstained++;
  for (const [voter, target] of Object.entries(g.votes)) {
    if (tally[voter] !== undefined && tally[target] !== undefined) tally[target]++;
  }
  if (abstained * 2 > living.length) {
    const extend = g.schedule.length < MAX_TOTAL_ROUNDS && quota > 0;
    return {
      ...g,
      phase: 'result',
      lastResult: { eliminated: [], tally, tieBreak: false, abstained, skipped: true },
      schedule: extend ? [...g.schedule, quota] : g.schedule,
      log: [...g.log, { round: g.round, text: `Большинство воздержалось (${abstained} из ${living.length}) — никто не покидает игру` }],
    };
  }
  const rng = mulberry32(g.seed ^ (g.round * 2654435761));
  const ranked = shuffle(living, rng).sort((a, b) => tally[b.id] - tally[a.id]);
  const eliminated = ranked.slice(0, quota).map((p) => p.id);
  const cutoff = ranked[quota - 1] ? tally[ranked[quota - 1].id] : 0;
  const tieBreak = living.filter((p) => tally[p.id] === cutoff).length > eliminated.filter((id) => tally[id] === cutoff).length;
  const result: RoundResult = { eliminated, tally, tieBreak, abstained };
  const names = eliminated.map((id) => g.players.find((p) => p.id === id)!.name).join(', ');
  return {
    ...g,
    phase: 'result',
    lastResult: result,
    players: g.players.map((p) => (eliminated.includes(p.id) ? { ...p, isEliminated: true } : p)),
    log: [...g.log, { round: g.round, text: `Исключён(ы): ${names}${tieBreak ? ' (ничья решена жребием)' : ''}${abstained ? `; воздержались: ${abstained}` : ''}` }],
  };
}

/** Начало вскрытия: если открывать уже нечего (карты кончились), сразу к дебатам. */
function enterReveal(g: GameState): GameState {
  const next: GameState = { ...g, phase: 'reveal', revealedThisRound: [] };
  return pendingReveal(next).length === 0 ? { ...next, phase: 'debate' } : next;
}

/** Конец дебатов: следующее вскрытие этого раунда или, если вскрытий набралось достаточно, голосование. */
export function finishDebate(g: GameState): GameState {
  if (g.phase !== 'debate') return g;
  const step = stepOf(g);
  if (step < perVote(g)) {
    const next = enterReveal({ ...g, revealStep: step + 1 });
    if (next.phase === 'reveal') return next;
  }
  return startVote(g);
}

export function nextRound(g: GameState): GameState {
  const done = alive(g).length <= g.config.shelterSlots || g.round >= g.schedule.length;
  if (done) return { ...g, phase: 'final' };
  return enterReveal({ ...g, round: g.round + 1, revealStep: 1, votes: {} });
}

/* ---------- Время партии ---------- */

export const timeLeftMs = (g: GameState, now = Date.now()) => (g.deadline ? Math.max(0, g.deadline - now) : null);

export function extendDeadline(g: GameState, ms: number, now = Date.now()): GameState {
  return g.deadline ? { ...g, deadline: Math.max(g.deadline, now) + ms } : g;
}

/**
 * Время вышло: дебаты пропускаются, неоткрытые карты открываются автоматически. Голосование не трогаем —
 * решение о том, кто уйдёт, остаётся за игроками.
 */
export function applyOvertime(g: GameState, now = Date.now()): GameState {
  if (!g.deadline || now < g.deadline) return g;
  let cur = g;
  for (let i = 0; i < 20; i++) {
    let next = cur;
    if (cur.phase === 'debate') next = finishDebate(cur);
    else if (cur.phase === 'reveal') {
      for (const p of pendingReveal(cur)) next = revealCard(next, p.id, revealOptions(next, p)[0]);
    }
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/** Сколько секунд дебатов можно позволить, чтобы уложиться во время: поровну на все оставшиеся дебаты, с запасом 30%. */
export function suggestedDebateSec(g: GameState, now = Date.now()): number | null {
  const left = timeLeftMs(g, now);
  if (left === null) return null;
  const debatesLeft = Math.max(1, perVote(g) - stepOf(g) + 1 + Math.max(0, g.schedule.length - g.round) * perVote(g));
  const sec = (left / 1000) * 0.7 / debatesLeft;
  return Math.min(240, Math.max(20, Math.round(sec / 10) * 10));
}

export function setEliminated(g: GameState, playerId: string, eliminated: boolean): GameState {
  return { ...g, players: g.players.map((p) => (p.id === playerId ? { ...p, isEliminated: eliminated } : p)) };
}
