import {
  CATEGORIES,
  type Card,
  type GameState,
  type Modifier,
} from '../../types';
import { itemsOf } from '../inventory';
import { packT } from '../i18n';
import { isCriminal } from './roles';
import type { HiddenThreatState } from './types';

const rank = (m?: Modifier) =>
  m === 'positive' ? 1 : m === 'negative' ? -1 : 0;
const useful = (c: Card) =>
  c.modifier === 'positive' || (c.modifier !== 'negative' && !!c.tags?.length);
const value = (c: Card) =>
  (c.modifier === 'positive' ? 2 : c.modifier === 'negative' ? 0 : 1) +
  (c.tags?.length ? 0.5 : 0);

/** A lifetime resource ledger, not a counter of button clicks. Keys deliberately omit actor/round. */
export function credit(
  s: HiddenThreatState,
  actor: string,
  key: string,
  amount: number,
  detail: string,
  round: number,
  target?: string,
): HiddenThreatState {
  if (s.credited.includes(key)) return s;
  const p = s.players[actor];
  if (!p) return s;
  return {
    ...s,
    credited: [...s.credited, key],
    players: {
      ...s.players,
      [actor]: { ...p, points: p.points + amount },
    },
    audit: [
      ...s.audit,
      { kind: 'points', round, actor, target, points: amount, detail },
    ],
  };
}

/** Central scoring for confirmed standard cards AND profession perks. No role supplied by callers. */
export function rewardTransitions(
  before: GameState,
  after: GameState,
  actor: string,
): GameState {
  if (!after.hiddenThreat || after === before || before.phase === 'final')
    return after;
  let s = after.hiddenThreat;
  const role = s.players[actor]?.role;
  if (!role) return after;
  const rewards: {
    key: string;
    amount: number;
    helpful: boolean;
    target: string;
    detail: string;
  }[] = [];
  const previousOwner = before.players.find((p) => p.id === actor);
  const nextOwner = after.players.find((p) => p.id === actor);
  const effect =
    previousOwner &&
    !previousOwner.slots.action.isRevealed &&
    nextOwner?.slots.action.isRevealed
      ? previousOwner.slots.action.card.effect
      : before.perks?.find((p) => p.playerId === actor)?.kind;
  for (const old of before.players) {
    if (old.id === actor || old.isEliminated) continue;
    const next = after.players.find((p) => p.id === old.id);
    if (!next || next.isEliminated) continue;
    for (const cat of CATEGORIES.filter(
      (c) => c !== 'action' && c !== 'luggage',
    )) {
      const a = old.slots[cat].card,
        b = next.slots[cat].card;
      if (effect === 'forceReveal' || effect === 'reveal') {
        if (!old.slots[cat].isRevealed && next.slots[cat].isRevealed)
          rewards.push({
            key: `reveal:${old.id}:${cat}`,
            amount: 1,
            helpful: false,
            target: old.id,
            detail: 'Принудительно открыта характеристика',
          });
      }
      const delta = rank(b.modifier) - rank(a.modifier);
      if (!delta) continue;
      rewards.push({
        key: `trait:${old.id}:${cat}:${delta > 0 ? 'help' : 'harm'}`,
        amount: 2,
        helpful: delta > 0,
        target: old.id,
        detail:
          delta > 0
            ? cat === 'health' && a.modifier === 'negative'
              ? 'Вылечено отрицательное здоровье'
              : 'Улучшена чужая характеристика'
            : 'Ухудшена чужая характеристика',
      });
    }
    const lost = itemsOf(old.slots.luggage.card).filter(
      (a) =>
        useful(a) &&
        !itemsOf(next.slots.luggage.card).some((b) => b.id === a.id),
    );
    const gained = itemsOf(next.slots.luggage.card).filter(
      (b) =>
        useful(b) &&
        !itemsOf(old.slots.luggage.card).some((a) => a.id === b.id),
    );
    for (const item of gained)
      if (
        previousOwner &&
        itemsOf(previousOwner.slots.luggage.card).some((c) => c.id === item.id)
      )
        rewards.push({
          key: `item:${item.id}:help`,
          amount: 1,
          helpful: true,
          target: old.id,
          detail: 'Передан полезный предмет',
        });
    for (const item of lost) {
      const stolen =
        (effect === 'stealLuggage' || effect === 'steal') &&
        nextOwner &&
        itemsOf(nextOwner.slots.luggage.card).some((c) => c.id === item.id);
      const replaced = itemsOf(next.slots.luggage.card).some(
        (b) => !itemsOf(old.slots.luggage.card).some((a) => a.id === b.id),
      );
      if (
        !stolen &&
        replaced &&
        itemsOf(next.slots.luggage.card).reduce((n, c) => n + value(c), 0) >=
          itemsOf(old.slots.luggage.card).reduce((n, c) => n + value(c), 0)
      )
        continue;
      rewards.push({
        key: `item:${item.id}:harm`,
        amount: stolen ? 1 : replaced ? 2 : 1,
        helpful: false,
        target: old.id,
        detail: stolen
          ? 'Украден полезный предмет'
          : replaced
            ? 'Полезный предмет подменён менее полезным'
            : 'Полезный предмет утрачен',
      });
    }
    const oldReady = before.hiddenThreat?.public.readiness[old.id] ?? 0;
    const newReady = s.public.readiness[old.id] ?? oldReady;
    if (oldReady !== newReady)
      rewards.push({
        key: `readiness:${old.id}:${newReady > oldReady ? 'help' : 'harm'}`,
        amount: 2,
        helpful: newReady > oldReady,
        target: old.id,
        detail:
          newReady > oldReady
            ? 'Улучшена подготовка кандидата'
            : 'Ухудшена подготовка кандидата',
      });
  }
  for (const r of rewards) {
    // Behaviour is factual for ALL roles. An actions investigation never uses the role to invent wrongdoing.
    s = {
      ...s,
      activities: [
        ...s.activities,
        {
          round: after.round,
          actor,
          target: r.target,
          kind: r.helpful ? 'help' : 'harm',
          detail: r.detail,
        },
      ],
    };
    if ((role === 'police' && r.helpful) || (isCriminal(role) && !r.helpful))
      s = credit(s, actor, r.key, r.amount, r.detail, after.round, r.target);
  }
  return s === after.hiddenThreat ? after : { ...after, hiddenThreat: s };
}

/** A cooperative prompt records a real contribution in the active event, once per candidate/event.
 * No reward for re-processing the same prompt, reconnecting, or simply declaring a client-side success. */
export function cooperate(g: GameState, actor: string): GameState {
  const s = g.hiddenThreat,
    event = g.event,
    player = g.players.find((p) => p.id === actor && !p.isEliminated);
  if (!s || !event || event.kind !== 'prompt' || g.phase !== 'event' || !player)
    return g;
  const key = `event:${event.id}:${actor}`;
  if (s.auxiliary.includes(key)) return g;
  const updated = { ...s, auxiliary: [...s.auxiliary, key] };
  const next =
    s.players[actor].role === 'police'
      ? credit(updated, actor, key, 1, 'Помощь в совместном событии', g.round)
      : updated;
  const text = packT('{who} помогает в совместном событии «{title}»', {
    who: player.name,
    title: event.title,
  });
  return {
    ...g,
    hiddenThreat: next,
    event: { ...event, outcome: [...event.outcome, text] },
    log: [...g.log, { round: g.round, text }],
  };
}

/** Limited, publicly identical actions for every role. Preparation has a real bounded state transition.
 * Each actor once/round, each target+direction once/game: no oscillation or group farming. */
export function auxiliaryAction(
  g: GameState,
  actor: string,
  target: string,
  kind: 'aid' | 'disrupt',
): GameState {
  const s = g.hiddenThreat;
  if (
    !s ||
    !['reveal', 'speech', 'discussion'].includes(g.phase) ||
    actor === target
  )
    return g;
  if (
    ![actor, target].every((id) =>
      g.players.some((p) => p.id === id && !p.isEliminated),
    )
  )
    return g;
  const actionKey = `${actor}:${g.round}`,
    resourceKey = `${target}:${kind}`;
  if (s.auxiliary.includes(actionKey) || s.auxiliary.includes(resourceKey))
    return g;
  const value = s.public.readiness[target] + (kind === 'aid' ? 1 : -1);
  if (Math.abs(value) > 2) return g;
  const next: GameState = {
    ...g,
    hiddenThreat: {
      ...s,
      auxiliary: [...s.auxiliary, actionKey, resourceKey],
      public: {
        ...s.public,
        readiness: { ...s.public.readiness, [target]: value },
      },
    },
    log: [
      ...g.log,
      {
        round: g.round,
        text: packT(
          kind === 'aid'
            ? '{who} помогает подготовке {target}'
            : '{who} мешает подготовке {target}',
          {
            who: g.players.find((p) => p.id === actor)!.name,
            target: g.players.find((p) => p.id === target)!.name,
          },
        ),
      },
    ],
  };
  return rewardTransitions(g, next, actor);
}
