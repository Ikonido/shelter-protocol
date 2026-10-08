import { CATEGORIES, type Card, type GameState } from '../../types';
import { itemsOf, composeItems, MAX_ITEMS, addToBag } from '../inventory';
import { packT } from '../i18n';
import { isCriminal } from './roles';
import { toDiscard } from '../actions';

const value = (c: Card) => c.modifier === 'positive' ? 2 : c.modifier === 'negative' ? 0 : 1;
const useful = (c: Card) => c.modifier === 'positive' || !!c.tags?.length;

/** One durable ledger for awards; keys also lock the resource against back-and-forth farming. */
export function reward(g: GameState, actor: string, key: string, amount: number, reason: string, target?: string): GameState {
  const s = g.hiddenThreat;
  const p = s?.players[actor];
  if (!s || !p || s.rewarded.includes(key)) return g;
  return { ...g, hiddenThreat: { ...s, rewarded: [...s.rewarded, key], players: { ...s.players, [actor]: { ...p, points: p.points + amount } }, audit: [...s.audit, { round: g.round, actor, target, kind: 'points', points: amount, text: reason }] } };
}

/** Only host-confirmed before/after differences can award points. No client award command exists. */
export function rewardTransition(before: GameState, after: GameState, actor: string, source: string): GameState {
  const role = after.hiddenThreat?.players[actor]?.role;
  if (!role || after === before) return after;
  let cur = after;
  const oldActor = before.players.find(p => p.id === actor);
  const newActor = after.players.find(p => p.id === actor);
  for (const old of before.players) {
    if (old.id === actor) continue;
    const next = after.players.find(p => p.id === old.id);
    if (!next) continue;
    for (const category of CATEGORIES.filter(c => c !== 'action' && c !== 'luggage')) {
      const a = old.slots[category].card, b = next.slots[category].card;
      if (value(a) === value(b)) continue;
      const key = `trait:${old.id}:${category}`;
      if (role === 'officer' && value(b) > value(a)) cur = reward(cur, actor, key, 2, category === 'health' && a.modifier === 'negative' ? 'Лечение отрицательного здоровья' : 'Улучшение чужой характеристики', old.id);
      if (isCriminal(role) && value(b) < value(a)) cur = reward(cur, actor, key, 2, 'Ухудшение чужой характеристики', old.id);
    }
    const oldItems = itemsOf(old.slots.luggage.card), newItems = itemsOf(next.slots.luggage.card);
    const removed = oldItems.filter(i => !newItems.some(j => j.id === i.id));
    const received = newItems.filter(i => !oldItems.some(j => j.id === i.id));
    if (role === 'officer' && oldActor && newActor) {
      for (const i of received.filter(useful)) {
        if (itemsOf(oldActor.slots.luggage.card).some(j => j.id === i.id) && !itemsOf(newActor.slots.luggage.card).some(j => j.id === i.id)) cur = reward(cur, actor, `item:${i.id}`, 1, 'Передача полезного предмета', old.id);
      }
    }
    if (isCriminal(role)) {
      for (const i of removed.filter(useful)) {
        const stolen = newActor && itemsOf(newActor.slots.luggage.card).some(j => j.id === i.id);
        const replaced = received.length && received.some(j => value(j) < value(i));
        cur = reward(cur, actor, `item:${i.id}`, replaced ? 2 : 1, replaced ? 'Подмена полезного предмета' : stolen ? 'Кража полезного предмета' : 'Вредоносное действие карты', old.id);
      }
    }
  }
  // Record observable harm for the actions investigation regardless of the actor's secret role.
  const harmed = before.players.filter(p => p.id !== actor).find(p => {
    const next = after.players.find(x => x.id === p.id);
    return next && (itemsOf(next.slots.luggage.card).length < itemsOf(p.slots.luggage.card).length || CATEGORIES.some(c => value(next.slots[c].card) < value(p.slots[c].card)));
  });
  if (harmed && cur.hiddenThreat && !cur.hiddenThreat.audit.some(a => a.kind === source)) {
    const s = cur.hiddenThreat;
    cur = { ...cur, hiddenThreat: { ...s, audit: [...s.audit, { round: cur.round, actor, target: harmed.id, kind: source, text: 'Зафиксировано вредоносное действие' }] } };
  }
  return cur;
}

export type Auxiliary = 'assist' | 'obstruct' | 'transfer';
/** A neutral ration per candidate is a real transferable resource, independent of the random deal/role. */
export function withThreatReserves(g: GameState): GameState {
  return { ...g, players: g.players.map(p => ({ ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: composeItems([...itemsOf(p.slots.luggage.card), { id: `reserve-${p.id}`, category: 'luggage', description: 'Общий резерв: аварийный рацион', modifier: 'neutral', tags: ['провизия'] }], () => p.slots.luggage.card) } } })) };
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
        players = players.map(p => p.id === target ? { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: composeItems(items.filter((_, i) => i !== at), () => ({ id: 'lost-conflict', category: 'luggage', description: 'Багаж потерян: пусто', modifier: 'negative' })) } } } : p);
      }
    }
  } else return g;
  const next: GameState = { ...g, players, hiddenThreat: { ...s, auxiliary: [...s.auxiliary, `${actor}:${g.round}`, ...(kind === 'transfer' ? [] : [`target:${target}`])] }, log: [...g.log, { round: g.round, text: packT(kind === 'transfer' ? '{who} передаёт предмет игроку {target}' : kind === 'assist' ? '{who} помогает игроку {target}' : '{who} провоцирует конфликт с игроком {target}', { who: me.name, target: tg.name }) }] };
  const earned = rewardTransition(g, dropped ? toDiscard(next, 'luggage', dropped) : next, actor, `aux:${actor}:${g.round}`);
  return cooperative && s.players[actor]?.role === 'officer' ? reward(earned, actor, `cooperate:${actor}:${g.round}`, 1, 'Успешная помощь в совместном событии', target) : earned;
}
