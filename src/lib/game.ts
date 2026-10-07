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

/** Чей сейчас ход: в фазе reveal — первый, кто ещё не открывал карту; в фазе speech — тот, кто только что открыл. */
export function currentSpeaker(g: GameState): PlayerCharacter | undefined {
  if (g.phase === 'reveal') return pendingReveal(g)[0];
  if (g.phase === 'speech') {
    const id = g.revealedThisRound[g.revealedThisRound.length - 1];
    return g.players.find((p) => p.id === id);
  }
  return undefined;
}

/** Игроки идут строго по очереди: открыть карту может только тот, чей сейчас ход. */
export function revealCard(g: GameState, playerId: string, category: Category): GameState {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.isEliminated || g.phase !== 'reveal') return g;
  if (pendingReveal(g)[0]?.id !== playerId || !revealOptions(g, p).includes(category)) return g;
  const players = g.players.map((x) =>
    x.id === playerId ? { ...x, slots: { ...x.slots, [category]: { ...x.slots[category], isRevealed: true } } } : x,
  );
  const next: GameState = {
    ...g,
    players,
    revealedThisRound: [...g.revealedThisRound, playerId],
    lastReveal: { playerId, category },
    log: [
      ...g.log,
      { round: g.round, text: `${p.name} открывает «${CATEGORY_LABEL[category]}»: ${p.slots[category].card.description}` },
    ],
  };
  const sec = g.config.speechSec ?? 0;
  if (sec > 0) return { ...next, phase: 'speech', speechEndsAt: Date.now() + sec * 1000 };
  return afterTurn(next);
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

/** Ход закончен: следующий игрок этого вскрытия или конец вскрытия. */
function afterTurn(g: GameState): GameState {
  if (pendingReveal(g).length > 0) return { ...g, phase: 'reveal', speechEndsAt: undefined };
  return finishStep({ ...g, speechEndsAt: undefined });
}

/** Начало вскрытия: сброс очереди; если открывать уже нечего (карты кончились) — пропускаем шаг. */
function startStep(g: GameState): GameState {
  let cur: GameState = { ...g, phase: 'reveal', revealedThisRound: [], speechEndsAt: undefined, lastReveal: undefined };
  while (pendingReveal(cur).length === 0) {
    if (stepOf(cur) < perVote(cur)) cur = { ...cur, revealStep: stepOf(cur) + 1 };
    else return startVote(cur);
  }
  return cur;
}

/** Все сходили: следующее вскрытие раунда или, если вскрытий набралось достаточно, голосование. */
function finishStep(g: GameState): GameState {
  return stepOf(g) < perVote(g) ? startStep({ ...g, revealStep: stepOf(g) + 1 }) : startVote(g);
}

/** Закончить речь (по таймеру или кнопкой «Следующий игрок»). */
export function endSpeech(g: GameState): GameState {
  return g.phase === 'speech' ? afterTurn(g) : g;
}

export function nextRound(g: GameState): GameState {
  const done = alive(g).length <= g.config.shelterSlots || g.round >= g.schedule.length;
  if (done) return { ...g, phase: 'final' };
  return startStep({ ...g, round: g.round + 1, revealStep: 1, votes: {} });
}

/* ---------- Время партии ---------- */

export const timeLeftMs = (g: GameState, now = Date.now()) => (g.deadline ? Math.max(0, g.deadline - now) : null);

export function extendDeadline(g: GameState, ms: number, now = Date.now()): GameState {
  return g.deadline ? { ...g, deadline: Math.max(g.deadline, now) + ms } : g;
}

/**
 * Время партии вышло: речи пропускаются, карты за тех, чья очередь, открываются автоматически.
 * Голосование не трогаем — решение о том, кто уйдёт, остаётся за игроками.
 */
export function applyOvertime(g: GameState, now = Date.now()): GameState {
  if (!g.deadline || now < g.deadline) return g;
  let cur = g;
  for (let i = 0; i < 400; i++) {
    let next = cur;
    if (cur.phase === 'speech') next = endSpeech(cur);
    else if (cur.phase === 'reveal') {
      const p = pendingReveal(cur)[0];
      if (p) next = revealCard(cur, p.id, revealOptions(cur, p)[0]);
    }
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/** Секундный «тик» игры: закончилась речь → следующий игрок; вышло время партии → овертайм. */
export function tickGame(g: GameState, now = Date.now()): GameState {
  let cur = g;
  if (cur.phase === 'speech' && cur.speechEndsAt && now >= cur.speechEndsAt) cur = endSpeech(cur);
  return applyOvertime(cur, now);
}

export function setEliminated(g: GameState, playerId: string, eliminated: boolean): GameState {
  return { ...g, players: g.players.map((p) => (p.id === playerId ? { ...p, isEliminated: eliminated } : p)) };
}
