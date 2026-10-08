import type { GameState } from '../types';

/**
 * Отмена вскрытия: `after` — состояние сразу после вскрытия, `current` — сейчас.
 * Откат допустим, только пока никто не успел ничего сделать, что он бы стёр:
 * применить действие (меняет карты, колоду, журнал, расклад голосов) или сменить раунд.
 * Ход речей и часы партии не мешают: их мы не откатываем.
 */
export function undoable(after: GameState, current: GameState): boolean {
  return (
    after.players === current.players &&
    after.hiddenThreat === current.hiddenThreat &&
    after.log === current.log &&
    after.deck === current.deck &&
    after.discard === current.discard &&
    after.fx === current.fx &&
    after.votes === current.votes &&
    after.round === current.round
  );
}

/** Возвращает состояние до вскрытия, но оставляет текущие часы партии (продление и овертайм не теряются). */
export function applyUndo(before: GameState, current: GameState): GameState {
  return { ...before, deadline: current.deadline };
}

/**
 * Можно ли показать «отменить» сейчас. После окончания времени партии овертайм сам откроет
 * ту же карту заново, так что откат ничего бы не дал: кнопку прячем.
 */
export function canUndo(snap: { before: GameState; after: GameState }, current: GameState, now = Date.now()): boolean {
  const overtime = current.deadline !== undefined && now >= current.deadline;
  return !overtime && undoable(snap.after, current);
}
