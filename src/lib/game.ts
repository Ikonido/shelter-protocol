import {
  CATEGORIES,
  CATEGORY_LABEL,
  categoryLabel,
  type Category,
  type ActiveEvent,
  type GameState,
  type Hazard,
  type PlayerCharacter,
  type RoundResult,
  type Scenario,
  type SessionConfig,
  type CardPack,
} from '../types';
import { generateCharacters } from './generator';
import { IMMUNE_VOTE, effectiveVotes, initialDeck, markImmune, runEffect, type ActionParams } from './actions';
import { dealStartingItems } from './inventory';
import { EVENTS, drawEvent, hiddenForLeak, unusedHazards } from './events';
import { mulberry32, shuffle } from './rng';
import { packT, t, tPacked } from './i18n';
import { applyPerk, grantPerksForNewReveals, onProfessionRevealed } from './perks';
import { dealRoles, validateThreatConfig } from './threat/roles';
import { rewardTransition, withThreatReserves } from './threat/economy';

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
  if (config.variant === 'hidden-threat') {
    const error = validateThreatConfig(config.playerCount, config.shelterSlots, config.hiddenThreat!);
    if (error || config.names.length !== config.playerCount) throw new Error(error ?? 'Некорректное число имён игроков');
  }
  const rng = mulberry32(config.seed);
  const dealt = generateCharacters(config.names, packs, rng);
  const stock = initialDeck(dealt, packs, config.seed);
  // На старте у части игроков в багаже два предмета (второй берётся из колоды).
  const { players, deck } = dealStartingItems(dealt, stock.deck, config.seed);
  const base: GameState = {
    ...stock,
    deck,
    config,
    scenario: { ...scenario },
    players,
    round: 1,
    schedule: buildSchedule(config.playerCount, config.shelterSlots, maxRoundsFor(config.revealsPerVote)),
    phase: config.mode === 'tabletop' && config.variant !== 'hidden-threat' ? 'final' : 'reveal',
    ...(config.variant === 'hidden-threat' ? { hiddenThreat: dealRoles(players, config.hiddenThreat!) } : {}),
    revealedThisRound: [],
    revealStep: 1,
    hazards: pickHazards(scenario, config.hazardCount ?? 0, config.seed),
    ...(config.timeLimitMin > 0 ? { deadline: Date.now() + config.timeLimitMin * 60_000 } : {}),
    votes: {},
    log: [],
    seed: config.seed,
  };
  const prepared = base.hiddenThreat ? withThreatReserves(base) : base;
  return config.mode !== 'tabletop' && config.roundEvents ? openRound(prepared) : prepared;
}

/** Случайный (но воспроизводимый по seed) набор факторов угрозы из пула сценария. */
export function pickHazards(scenario: Scenario, count: number, seed: number): Hazard[] {
  const pool = scenario.hazards ?? [];
  const n = Math.max(0, Math.min(count, pool.length));
  return n === 0 ? [] : shuffle(pool, mulberry32(seed ^ 0x5bd1e995)).slice(0, n);
}

export const perVote = (g: GameState) => Math.max(1, g.config.revealsPerVote ?? 1);
export const stepOf = (g: GameState) => g.revealStep ?? 1;
/** Открываемых категорий 8: раундов не больше, чем хватит карт на все вскрытия. */
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
      { round: g.round, text: t('{who} открывает «{cat}»: {desc}', { who: p.name, cat: categoryLabel(category), desc: p.slots[category].card.description }) },
    ],
  };
  const withPerk = category === 'profession' ? onProfessionRevealed(next, playerId) : next;
  const sec = g.config.speechSec ?? 0;
  if (sec > 0) return { ...withPerk, phase: 'speech', speechEndsAt: Date.now() + sec * 1000 * (g.speechFactor ?? 1) };
  return afterTurn(withPerk);
}

/**
 * Действие (принудительное вскрытие, кража последнего предмета) могло открыть последнюю скрытую карту того, чей сейчас ход:
 * очередь опустела, а фаза так и осталась «вскрытие». Завершаем текущий шаг, как после обычного вскрытия.
 */
export function settleReveal(g: GameState): GameState {
  return g.phase === 'reveal' && pendingReveal(g).length === 0 ? afterTurn(g) : g;
}

/** Бонус профессии с последующей проверкой очереди вскрытий (допрос тоже может открыть последнюю карту). */
export function playPerk(g: GameState, playerId: string, params?: ActionParams): GameState {
  if (g.hiddenThreat && !['reveal', 'speech', 'vote'].includes(g.phase)) return g;
  const next = applyPerk(g, playerId, params);
  return next === g ? g : settleReveal(rewardTransition(g, next, playerId, `perk:${playerId}:${g.round}`));
}

export function playAction(g: GameState, playerId: string, params?: ActionParams): GameState {
  if (g.hiddenThreat && !['reveal', 'speech', 'vote'].includes(g.phase)) return g;
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.isEliminated || p.slots.action.isRevealed) return g;
  const card = p.slots.action.card;
  // Автоисполнение (по желанию игроков): эффект карты выполняется в игре. Невозможное действие ничего не меняет.
  if (g.config.autoActions && card.effect) return settleReveal(rewardTransition(g, grantPerksForNewReveals(g, runEffect(g, playerId, card.effect, params)), playerId, `action:${playerId}`));
  return {
    ...g,
    players: g.players.map((x) =>
      x.id === playerId ? { ...x, slots: { ...x.slots, action: { ...x.slots.action, isRevealed: true } } } : x,
    ),
    log: [
      ...g.log,
      { round: g.round, kind: 'action', text: t('{who} применяет карту действия «{title}»: {desc}', { who: p.name, title: card.title ?? t('Действие'), desc: card.description }) },
    ],
  };
}

export function startVote(g: GameState): GameState {
  if (g.hiddenThreat && g.hiddenThreat.resolvedRound < g.round) return { ...g, phase: 'secret', speechEndsAt: undefined };
  // Квоту закрыли добровольцы: голосовать не за что.
  if (g.schedule.length > 0 && quotaThisRound(g) <= 0) {
    return {
      ...g,
      phase: 'result',
      votes: {},
      fx: undefined,
      lastResult: { eliminated: [], tally: Object.fromEntries(alive(g).map((p) => [p.id, 0])), tieBreak: false, noVote: true },
      log: [...g.log, { round: g.round, text: t('Добровольцы закрыли квоту — голосования нет') }],
    };
  }
  return markImmune({ ...g, phase: 'vote', votes: {} });
}

export function castVote(g: GameState, voterId: string, targetId: string): GameState {
  if (voterId === targetId) return g; // ABSTAIN допустим как цель
  if (g.votes[voterId] === IMMUNE_VOTE) return g; // неприкосновенный не голосует
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
  if (g.hiddenThreat && g.phase !== 'vote') return g;
  const next = resolveVoteCore(g);
  return next.perks || next.perkResult ? { ...next, perks: undefined, perkResult: undefined } : next;
}

function resolveVoteCore(g: GameState): GameState {
  const living = alive(g);
  const fx = g.fx;
  // Действия игроков: союзники, вето и неприкосновенность применяются к голосам перед подсчётом.
  const votes = effectiveVotes(g);
  const immune = new Set(fx?.immune ?? []);
  const quota = Math.min(quotaThisRound(g), living.length);
  const tally: Record<string, number> = Object.fromEntries(living.map((p) => [p.id, 0]));
  let abstained = 0;
  for (const p of living) if (votes[p.id] === ABSTAIN) abstained++;
  for (const [voter, target] of Object.entries(votes)) {
    if (tally[voter] !== undefined && tally[target] !== undefined) tally[target] += fx?.double.includes(voter) ? 2 : 1;
  }
  if (abstained * 2 > living.length) {
    const extend = g.schedule.length < MAX_TOTAL_ROUNDS && quota > 0;
    return {
      ...g,
      fx: undefined,
      phase: 'result',
      lastResult: { eliminated: [], tally, tieBreak: false, abstained, skipped: true },
      schedule: extend ? [...g.schedule, quota] : g.schedule,
      log: [...g.log, { round: g.round, text: t('Большинство воздержалось ({abstained} из {total}) — никто не покидает игру', { abstained, total: living.length }) }],
    };
  }
  const rng = mulberry32(g.seed ^ (g.round * 2654435761));
  // Неприкосновенные в списке на исключение не участвуют.
  const candidates = living.filter((p) => !immune.has(p.id));
  const ranked = shuffle(candidates, rng).sort((a, b) => tally[b.id] - tally[a.id]);
  const take = Math.min(quota, ranked.length);
  const eliminated = ranked.slice(0, take).map((p) => p.id);
  const cutoff = ranked[take - 1] ? tally[ranked[take - 1].id] : 0;
  const tieBreak = candidates.filter((p) => tally[p.id] === cutoff).length > eliminated.filter((id) => tally[id] === cutoff).length;
  const result: RoundResult = { eliminated, tally, tieBreak, abstained };
  const names = eliminated.map((id) => g.players.find((p) => p.id === id)!.name).join(', ');
  return {
    ...g,
    fx: undefined,
    phase: 'result',
    lastResult: result,
    players: g.players.map((p) => (eliminated.includes(p.id) ? { ...p, isEliminated: true } : p)),
    log: [...g.log, { round: g.round, text: t('Исключён(ы): {names}{tie}{abs}', { names: names || t('никто'), tie: tieBreak ? t(' (ничья решена жребием)') : '', abs: abstained ? t('; воздержались: {n}', { n: abstained }) : '' }) }],
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

/* ---------- События раунда ---------- */

/**
 * Начало раунда: выпадает карта кризиса (если включены), её эффект применяется сразу,
 * затем игроки читают её (фаза event) и только потом идут вскрытия.
 * Если открывать нечего (карты кончились), событие не показываем — раунд сразу идёт к голосованию.
 */
export function openRound(g: GameState): GameState {
  const base = { ...g, speechFactor: 1, event: undefined };
  if (!g.config.roundEvents) return startStep(base);
  const def = drawEvent(base);
  if (!def) return startStep(base);
  const applied = applyEvent(base, def);
  const prepared = startStep(applied);
  if (prepared.phase !== 'reveal') return startStep(base);
  return { ...prepared, phase: 'event' };
}

export function applyEvent(g: GameState, def: (typeof EVENTS)[number]): GameState {
  const outcome: string[] = [];
  let cur: GameState = { ...g, usedEvents: [...(g.usedEvents ?? []), def.id] };
  const rng = mulberry32((g.seed ^ Math.imul(g.round, 0x85ebca6b) ^ 0x2c1b3c6d) >>> 0);
  const living = () => cur.players.filter((p) => !p.isEliminated);

  switch (def.kind) {
    case 'shrink': {
      const slots = cur.config.shelterSlots - 1;
      const schedule = cur.schedule.slice();
      schedule[cur.round - 1] = (schedule[cur.round - 1] ?? 0) + 1;
      cur = { ...cur, config: { ...cur.config, shelterSlots: slots }, schedule };
      outcome.push(packT('Мест в бункере: {slots}. В этом раунде исключается: {n}.', { slots, n: schedule[cur.round - 1] }));
      break;
    }
    case 'plague': {
      const sick = living().filter((p) => p.slots.health.card.modifier === 'negative' && !p.slots.health.isRevealed);
      cur = { ...cur, players: cur.players.map((p) => (sick.some((s) => s.id === p.id) ? { ...p, slots: { ...p.slots, health: { ...p.slots.health, isRevealed: true } } } : p)) };
      for (const p of sick) outcome.push(packT('{who} открывает здоровье: {desc}', { who: p.name, desc: p.slots.health.card.description }));
      break;
    }
    case 'leak': {
      cur = {
        ...cur,
        players: cur.players.map((p) => {
          if (p.isEliminated) return p;
          const hidden = hiddenForLeak(p, cur);
          if (!hidden.length) return p;
          const cat = hidden[Math.floor(rng() * hidden.length)];
          outcome.push(packT('{who} раскрывает «{cat}»: {desc}', { who: p.name, cat: CATEGORY_LABEL[cat], desc: p.slots[cat].card.description }));
          return { ...p, slots: { ...p.slots, [cat]: { ...p.slots[cat], isRevealed: true } } };
        }),
      };
      break;
    }
    case 'silence':
      cur = { ...cur, speechFactor: 0.5 };
      outcome.push(packT('Время речи: {n} с.', { n: Math.max(5, Math.round((cur.config.speechSec ?? 0) * 0.5)) }));
      break;
    case 'newHazard': {
      const pool = unusedHazards(cur);
      const h = pool[Math.floor(rng() * pool.length)];
      cur = { ...cur, hazards: [...(cur.hazards ?? []), h] };
      outcome.push(packT('Новая угроза: «{title}». {desc}', { title: h.title, desc: h.description }));
      break;
    }
    case 'relief': {
      const rank = { minor: 0, major: 1, critical: 2 } as const;
      const target = (cur.hazards ?? []).filter((h) => h.severity !== 'critical').sort((a, b) => rank[a.severity] - rank[b.severity])[0];
      cur = { ...cur, hazards: (cur.hazards ?? []).filter((h) => h.id !== target.id) };
      outcome.push(packT('Угроза снята: «{title}».', { title: target.title }));
      break;
    }
    default:
      break;
  }
  const event: ActiveEvent = { id: def.id, kind: def.kind, title: def.title, text: def.text, tone: def.tone, outcome };
  const next: GameState = { ...cur, event, log: [...cur.log, { round: cur.round, text: outcome.length ? t('Событие «{title}»: {outcome}', { title: t(event.title), outcome: outcome.map(tPacked).join(' ') }) : t('Событие «{title}»', { title: t(event.title) }) }] };
  // Утечка может открыть профессию: бонус выдаётся и в этом случае.
  return grantPerksForNewReveals(g, next);
}

/** Игроки прочитали событие — начинаются вскрытия. */
export function continueEvent(g: GameState): GameState {
  return g.phase === 'event' ? { ...g, phase: 'reveal' } : g;
}

/** Доброволец выходит сам: квота раунда уменьшается на одного (событие «Кто готов уйти добровольно?»). */
export function volunteer(g: GameState, playerId: string): GameState {
  const p = g.players.find((x) => x.id === playerId);
  if (g.phase !== 'event' || g.event?.kind !== 'volunteer' || !p || p.isEliminated || quotaThisRound(g) < 1) return g;
  const schedule = g.schedule.slice();
  schedule[g.round - 1] = quotaThisRound(g) - 1;
  const next: GameState = {
    ...g,
    schedule,
    players: g.players.map((x) => (x.id === playerId ? { ...x, isEliminated: true } : x)),
    event: { ...g.event, outcome: [...g.event.outcome, packT('{who} добровольно уходит из бункера.', { who: p.name })] },
    log: [...g.log, { round: g.round, volunteer: p.name, text: t('{who} вызвался добровольцем и покидает бункер', { who: p.name }) }],
  };
  return alive(next).length <= next.config.shelterSlots ? { ...next, phase: 'final' } : next;
}

export function nextRound(g: GameState): GameState {
  if (g.hiddenThreat && alive(g).length > g.config.shelterSlots && g.round >= g.schedule.length) {
    return openRound({ ...g, round: g.round + 1, revealStep: 1, votes: {}, schedule: [...g.schedule, Math.min(alive(g).length - g.config.shelterSlots, Math.max(1, quotaThisRound(g)))], perks: undefined, perkResult: undefined });
  }
  const done = alive(g).length <= g.config.shelterSlots || g.round >= g.schedule.length;
  if (done) return { ...g, phase: 'final', perks: undefined };
  return openRound({ ...g, round: g.round + 1, revealStep: 1, votes: {}, perks: undefined, perkResult: undefined });
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
    if (cur.phase === 'event') next = continueEvent(cur);
    else if (cur.phase === 'speech') next = endSpeech(cur);
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
