import { CATEGORIES, type ActionEffect, type Card, type GameState } from '../../types';
import { itemsOf, composeItems, MAX_ITEMS, addToBag } from '../inventory';
import { packT } from '../i18n';
import { isCriminal } from './roles';
import { toDiscard } from '../actions';

const value = (c: Card) => c.modifier === 'positive' ? 2 : c.modifier === 'negative' ? 0 : 1;
const useful = (c: Card) => c.modifier === 'positive' || !!c.tags?.length;
const itemValue = (c: Card) => value(c) + (c.tags?.length ? 0.5 : 0);
/** Count physical copies when comparing bags; the reward ledger still pays once per card ID. */
function difference(items: Card[], other: Card[]): Card[] {
  const counts = new Map<string, number>();
  for (const card of other) counts.set(card.id, (counts.get(card.id) ?? 0) + 1);
  return items.filter(card => {
    const count = counts.get(card.id) ?? 0;
    if (count === 0) return true;
    counts.set(card.id, count - 1);
    return false;
  });
}

/** One durable ledger for awards; keys also lock the resource against back-and-forth farming. */
export function reward(g: GameState, actor: string, key: string, amount: number, reason: string, target?: string): GameState {
  const s = g.hiddenThreat;
  const p = s?.players[actor];
  if (!s || !p || s.rewarded.includes(key)) return g;
  const aid = /^item:aid-(.+)-(\d+)$/.exec(key);
  const freshAid = aid && Number(aid[2]) > (s.legacyResourceCutoff ?? 0) && s.rewarded.includes(`cooperate:${aid[1]}:${aid[2]}`);
  if (s.legacyResourceCutoff !== undefined && (key.startsWith('trait:') || key.startsWith('item:') && !freshAid)) return g;
  // A zero-point transition still consumes its resource, with no award/role trace in the audit.
  return { ...g, hiddenThreat: { ...s, rewarded: [...s.rewarded, key], ...(amount > 0 ? { players: { ...s.players, [actor]: { ...p, points: p.points + amount } }, audit: [...s.audit, { round: g.round, actor, target, kind: 'points', points: amount, text: reason }] } : {}) } };
}

/** Only host-confirmed before/after differences can award points. No client award command exists. */
export function rewardTransition(before: GameState, after: GameState, actor: string, source: string, operation?: ActionEffect | Auxiliary): GameState {
  const role = after.hiddenThreat?.players[actor]?.role;
  if (!role || after === before) return after;
  let cur = after;
  const oldActor = before.players.find(p => p.id === actor);
  const newActor = after.players.find(p => p.id === actor);
  const given = oldActor && newActor ? difference(itemsOf(oldActor.slots.luggage.card), itemsOf(newActor.slots.luggage.card)) : [];
  for (const old of before.players) {
    if (old.id === actor) continue;
    const next = after.players.find(p => p.id === old.id);
    if (!next) continue;
    for (const category of CATEGORIES.filter(c => c !== 'action' && c !== 'luggage')) {
      const a = old.slots[category].card, b = next.slots[category].card;
      if (value(a) === value(b)) continue;
      const key = `trait:${old.id}:${category}`;
      const improved = value(b) > value(a);
      const amount = improved ? role === 'officer' ? 2 : 0 : isCriminal(role) ? 2 : 0;
      cur = reward(cur, actor, key, amount, improved ? category === 'health' && a.modifier === 'negative' ? 'Лечение отрицательного здоровья' : 'Улучшение чужой характеристики' : 'Ухудшение чужой характеристики', old.id);
    }
    const oldItems = itemsOf(old.slots.luggage.card), newItems = itemsOf(next.slots.luggage.card);
    const removed = difference(oldItems, newItems), received = difference(newItems, oldItems);
    const lost = operation === 'stealLuggage' || operation === 'sabotage' || operation === 'obstruct';
    const substituted = operation === 'giveLuggage' || operation === 'swapLuggage';
    const harmedItems = removed.filter(i => useful(i) && (lost || substituted && received.some(j => itemValue(j) < itemValue(i))));
    if (oldActor && newActor) {
      for (const i of received.filter(useful)) {
        if (given.some(j => j.id === i.id)) cur = reward(cur, actor, `item:${i.id}`, role === 'officer' ? 1 : 0, 'Передача полезного предмета', old.id);
      }
    }
    let destructionPaid = false;
    for (const i of harmedItems) {
      const paid = operation !== 'sabotage' || !destructionPaid;
      const amount = isCriminal(role) && paid ? substituted ? 2 : 1 : 0;
      const awarded = reward(cur, actor, `item:${i.id}`, amount, substituted ? 'Подмена полезного предмета' : operation === 'stealLuggage' ? 'Кража полезного предмета' : 'Вредоносное действие карты', old.id);
      if (awarded !== cur) destructionPaid = true;
      cur = awarded;
    }
    // Use the same item-level transition for investigations, including unrewarded civilian harm.
    const traitHarm = CATEGORIES.filter(c => c !== 'action' && c !== 'luggage').some(c => value(next.slots[c].card) < value(old.slots[c].card));
    if ((traitHarm || harmedItems.length) && cur.hiddenThreat && !cur.hiddenThreat.audit.some(a => a.kind === source && a.target === old.id)) {
      const s = cur.hiddenThreat;
      cur = { ...cur, hiddenThreat: { ...s, audit: [...s.audit, { round: cur.round, actor, target: old.id, kind: source, text: 'Зафиксировано вредоносное действие' }] } };
    }
  }
  return cur;
}

export type Auxiliary = 'assist' | 'obstruct' | 'transfer';
/** A neutral ration per candidate is a real transferable resource, independent of the random deal/role. */
export function withThreatReserves(g: GameState): GameState {
  const dropped: Card[] = [];
  const players = g.players.map(p => {
    const reserve: Card = { id: `reserve-${p.id}`, category: 'luggage', description: 'Общий резерв: аварийный рацион', modifier: 'neutral', tags: ['провизия'] };
    const bag = addToBag(itemsOf(p.slots.luggage.card), reserve);
    if (bag.dropped) dropped.push(bag.dropped);
    return { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: composeItems(bag.items, () => p.slots.luggage.card) } } };
  });
  return dropped.reduce((next, card) => toDiscard(next, 'luggage', card), { ...g, players });
}
/** All roles have these bounded actions. Training/conflict changes character stability in evaluate(). */
export function auxiliaryAction(g: GameState, actor: string, target: string, kind: Auxiliary, itemId?: string): GameState {
  const s = g.hiddenThreat;
  const me = g.players.find(p => p.id === actor), tg = g.players.find(p => p.id === target);
  if (!s || !['reveal', 'speech'].includes(g.phase) || !me || !tg || me.isEliminated || tg.isEliminated || actor === target || s.auxiliary.includes(`${actor}:${g.round}`) || s.auxiliary.filter(k => k.startsWith(`${actor}:`)).length >= 3) return g;
  let players = g.players;
  let cooperative = false;
  let dropped: Card | undefined;
  if (kind === 'transfer') {
    const items = itemsOf(me.slots.luggage.card), theirs = itemsOf(tg.slots.luggage.card);
    const at = items.findIndex(i => i.id === itemId);
    if (at < 0 || theirs.length >= MAX_ITEMS) return g;
    const empty = (): Card => ({ id: 'lost-transfer', category: 'luggage', description: 'Багаж потерян: пусто', modifier: 'negative' });
    players = players.map(p => p.id === actor || p.id === target ? { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: composeItems(p.id === actor ? items.filter((_, i) => i !== at) : [...theirs, items[at]], empty) } } } : p);
  } else if (kind === 'assist' || kind === 'obstruct') {
    const card = tg.slots.character.card;
    const mod = kind === 'assist' ? 'positive' : 'negative';
    if (s.auxiliary.includes(`target:${target}`)) return g;
    if (card.modifier !== mod) {
      players = players.map(p => p.id === target ? { ...p, slots: { ...p.slots, character: { ...p.slots.character, card: { ...card, modifier: mod, description: packT(kind === 'assist' ? '{desc} (поддержка)' : '{desc} (конфликт)', { desc: card.description }) } } } } : p);
    } else {
      const items = itemsOf(tg.slots.luggage.card);
      if (kind === 'assist') {
        const equipment: Card = { id: `aid-${actor}-${g.round}`, category: 'luggage', description: 'Комплект помощи из общего резерва', modifier: 'positive', tags: ['санитария'] };
        const bag = addToBag(items, equipment);
        if (bag.items === items) return g;
        dropped = bag.dropped;
        cooperative = true;
        players = players.map(p => p.id === target ? { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: composeItems(bag.items, () => p.slots.luggage.card) } } } : p);
      } else {
        const at = items.findIndex(useful);
        if (at < 0) return g;
        dropped = items[at];
        players = players.map(p => p.id === target ? { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: composeItems(items.filter((_, i) => i !== at), () => ({ id: 'lost-conflict', category: 'luggage', description: 'Багаж потерян: пусто', modifier: 'negative' })) } } } : p);
      }
    }
  } else return g;
  const next: GameState = { ...g, players, hiddenThreat: { ...s, auxiliary: [...s.auxiliary, `${actor}:${g.round}`, ...(kind === 'transfer' ? [] : [`target:${target}`])] }, log: [...g.log, { round: g.round, text: packT(kind === 'transfer' ? '{who} передаёт предмет игроку {target}' : kind === 'assist' ? '{who} помогает игроку {target}' : '{who} провоцирует конфликт с игроком {target}', { who: me.name, target: tg.name }) }] };
  const earned = rewardTransition(g, dropped ? toDiscard(next, 'luggage', dropped) : next, actor, `aux:${actor}:${g.round}`, kind);
  return cooperative ? reward(earned, actor, `cooperate:${actor}:${g.round}`, s.players[actor]?.role === 'officer' ? 1 : 0, 'Успешная помощь в совместном событии', target) : earned;
}

/** Old role-dependent ledgers cannot be reconstructed from redacted historical logs. */
export function migrateThreatLedger(g: GameState): GameState {
  const s = g.hiddenThreat;
  if (!s || s.resourceLedgerVersion === 2) return g;
  const progressed = s.auxiliary.length > 0 || s.rewarded.some(k => k.startsWith('item:') || k.startsWith('trait:')) || g.log.some(l => l.kind === 'action');
  const notice = 'Старое сохранение восстановлено: роли и очки сохранены, новые начисления за прежние ресурсы отключены.';
  return { ...g, hiddenThreat: { ...s, resourceLedgerVersion: 2, ...(progressed ? { legacyResourceCutoff: g.round, players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, notices: [...p.notices, notice] }])) } : {}) } };
}
