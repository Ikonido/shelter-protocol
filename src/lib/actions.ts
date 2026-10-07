import { CATEGORIES, CATEGORY_LABEL, type ActionEffect, type ActionFx, type Card, type CardPack, type Category, type DeckCategory, type GameState, type PlayerCharacter } from '../types';
import { cardMatchesSkill } from './evaluate';
import { mergePools } from './generator';
import { mulberry32, shuffle } from './rng';

/**
 * Автоисполнение карт действий. Модуль не зависит от game.ts (там он подключается), чтобы не было циклов.
 * Все функции чистые: возвращают новое состояние или то же самое, если действие нельзя выполнить.
 */

export interface ActionParams {
  target?: string;
  category?: Category;
}

const NEEDS_TARGET: ActionEffect[] = ['stealLuggage', 'giveLuggage', 'swapLuggage', 'sabotage', 'forceReveal', 'ally'];
export const needsTarget = (e: ActionEffect) => NEEDS_TARGET.includes(e);
export const needsCategory = (e: ActionEffect) => e === 'forceReveal';

export const IMMUNE_VOTE = 'immune'; // метка в votes: этот игрок голосовать не может
const HEALING = ['медицина', 'лечение'];
const living = (g: GameState) => g.players.filter((p) => !p.isEliminated);
const find = (g: GameState, id?: string) => g.players.find((p) => p.id === id);
const rank = (c: Card) => (c.modifier === 'positive' ? 2 : c.modifier === 'negative' ? 0 : 1) + (c.tags?.length ? 0.5 : 0);

const LOST: Card = { id: 'lost-luggage', category: 'luggage', description: 'Багаж потерян: пусто', modifier: 'negative' };
const STOLEN: Card = { id: 'stolen-luggage', category: 'luggage', description: 'Багаж украден: пусто', modifier: 'negative' };

/** Сосед по кругу среди живых: -1 предыдущий, +1 следующий. */
function neighbor(g: GameState, actorId: string, dir: -1 | 1): PlayerCharacter | undefined {
  const list = living(g);
  const i = list.findIndex((p) => p.id === actorId);
  if (i < 0 || list.length < 2) return undefined;
  return list[(i + dir + list.length) % list.length];
}

/** Берёт карту из колоды категории; пустую колоду пополняет из сброса. */
function draw(g: GameState, cat: DeckCategory): { card: Card; g: GameState } | null {
  let deck = [...(g.deck?.[cat] ?? [])];
  let discard = [...(g.discard?.[cat] ?? [])];
  if (deck.length === 0 && discard.length > 0) {
    deck = discard;
    discard = [];
  }
  const card = deck.shift();
  if (!card) return null;
  return { card, g: { ...g, deck: { ...g.deck, [cat]: deck }, discard: { ...g.discard, [cat]: discard } } };
}

const toDiscard = (g: GameState, cat: DeckCategory, card: Card): GameState =>
  card.id.startsWith('lost-') || card.id.startsWith('stolen-') ? g : { ...g, discard: { ...g.discard, [cat]: [...(g.discard?.[cat] ?? []), card] } };

const withSlot = (g: GameState, id: string, cat: Category, slot: { card: Card; isRevealed: boolean }): GameState => ({
  ...g,
  players: g.players.map((p) => (p.id === id ? { ...p, slots: { ...p.slots, [cat]: slot } } : p)),
});

const used = (g: GameState, id: string): GameState => ({
  ...g,
  players: g.players.map((p) => (p.id === id ? { ...p, slots: { ...p.slots, action: { ...p.slots.action, isRevealed: true } } } : p)),
});

const say = (g: GameState, text: string): GameState => ({ ...g, log: [...g.log, { round: g.round, text }] });

const emptyFx = (): ActionFx => ({ double: [], veto: [], immune: [], allies: [] });

/** Можно ли применить эффект сейчас; причина нужна, чтобы показать её игроку. */
export function canApply(g: GameState, actorId: string, effect: ActionEffect, params: ActionParams = {}): { ok: true } | { ok: false; reason: string } {
  const actor = find(g, actorId);
  if (!actor || actor.isEliminated) return { ok: false, reason: 'Игрок выбыл' };
  if (actor.slots.action.isRevealed) return { ok: false, reason: 'Действие уже использовано' };
  const fail = (reason: string) => ({ ok: false as const, reason });
  const target = find(g, params.target);
  if (needsTarget(effect)) {
    if (!target || target.isEliminated || target.id === actorId) return fail('Выберите другого живого игрока');
  }
  // В «виде» онлайн-клиента нет ни колоды, ни чужих карт: такие проверки пропускаем, их повторяет хост.
  const full = g.deck !== undefined;
  const hasDeck = (cat: DeckCategory) => !full || (g.deck?.[cat]?.length ?? 0) + (g.discard?.[cat]?.length ?? 0) > 0;
  switch (effect) {
    case 'drawLuggage':
    case 'giveLuggage':
      return hasDeck('luggage') ? { ok: true } : fail('В колоде не осталось карт багажа');
    case 'rerollHobby':
      return hasDeck('hobby') ? { ok: true } : fail('В колоде не осталось карт хобби');
    case 'rerollPrevPhysique':
    case 'rerollNextPhysique':
      if (living(g).length < 2) return fail('Нужен хотя бы один сосед');
      return hasDeck('physique') ? { ok: true } : fail('В колоде не осталось телосложений');
    case 'rerollPrevBiology':
      if (living(g).length < 2) return fail('Нужен хотя бы один сосед');
      return hasDeck('biology') ? { ok: true } : fail('В колоде не осталось карт биологии');
    case 'swapNeighborsPhysique':
    case 'swapNeighborsBiology':
      return living(g).length >= 3 ? { ok: true } : fail('Для обмена нужно хотя бы три живых игрока');
    case 'forceReveal': {
      if (!target) return fail('Выберите игрока');
      const hidden = CATEGORIES.filter((c) => c !== 'action' && !target.slots[c].isRevealed);
      if (!params.category || !hidden.includes(params.category)) return hidden.length ? fail('Выберите скрытую карту игрока') : fail('У игрока всё уже открыто');
      return { ok: true };
    }
    case 'heal': {
      if (actor.slots.health.card.modifier !== 'negative') return fail('У вас нет проблем со здоровьем');
      const doctor = !full || living(g).some((p) => p.id !== actorId && (['profession', 'biology', 'hobby', 'fact', 'luggage'] as const).some((c) => HEALING.some((s) => cardMatchesSkill(p.slots[c].card, s))));
      return doctor ? { ok: true } : fail('Среди живых нет врача или лекаря');
    }
    case 'ally':
      return g.fx?.allies.some(([a]) => a === actorId) ? fail('Союзник уже выбран') : { ok: true };
    default:
      return { ok: true };
  }
}

/** Выполняет действие игрока. Возвращает то же состояние, если оно невозможно (проверка через canApply). */
export function runEffect(g: GameState, actorId: string, effect: ActionEffect, params: ActionParams = {}): GameState {
  if (!canApply(g, actorId, effect, params).ok) return g;
  const actor = find(g, actorId)!;
  const target = find(g, params.target);
  const title = actor.slots.action.card.title ?? 'Действие';
  const head = `${actor.name} применяет «${title}»`;
  let n = used(g, actorId);

  const reroll = (victim: PlayerCharacter, cat: 'physique' | 'biology'): GameState => {
    const d = draw(n, cat);
    if (!d) return n;
    const old = victim.slots[cat];
    let next = withSlot(d.g, victim.id, cat, { card: d.card, isRevealed: old.isRevealed });
    next = toDiscard(next, cat, old.card);
    return say(next, `${head}: у ${victim.name} новая карта «${CATEGORY_LABEL[cat]}»${old.isRevealed ? `: ${d.card.description}` : ''}`);
  };

  switch (effect) {
    case 'drawLuggage': {
      const d = draw(n, 'luggage')!;
      const old = actor.slots.luggage;
      const keepNew = rank(d.card) > rank(old.card);
      let next = d.g;
      if (keepNew) {
        next = withSlot(next, actorId, 'luggage', { card: d.card, isRevealed: old.isRevealed });
        next = toDiscard(next, 'luggage', old.card);
      } else next = toDiscard(next, 'luggage', d.card);
      // Журнал видят все: исход (оставил ли новую) не раскрываем, пока багаж закрыт.
      return say(next, `${head}: тянет ещё один багаж и оставляет лучший`);
    }
    case 'stealLuggage': {
      const t = target!;
      let next = withSlot(n, actorId, 'luggage', { card: t.slots.luggage.card, isRevealed: t.slots.luggage.isRevealed });
      next = withSlot(next, t.id, 'luggage', { card: STOLEN, isRevealed: true });
      next = toDiscard(next, 'luggage', actor.slots.luggage.card);
      return say(next, `${head}: крадёт багаж у ${t.name}`);
    }
    case 'giveLuggage': {
      const t = target!;
      const d = draw(n, 'luggage')!;
      let next = withSlot(d.g, t.id, 'luggage', { card: d.card, isRevealed: t.slots.luggage.isRevealed });
      next = toDiscard(next, 'luggage', t.slots.luggage.card);
      return say(next, `${head}: у ${t.name} теперь другой багаж`);
    }
    case 'swapLuggage': {
      const t = target!;
      let next = withSlot(n, actorId, 'luggage', t.slots.luggage);
      next = withSlot(next, t.id, 'luggage', actor.slots.luggage);
      return say(next, `${head}: меняется багажом с ${t.name}`);
    }
    case 'sabotage': {
      const t = target!;
      let next = withSlot(n, t.id, 'luggage', { card: LOST, isRevealed: true });
      next = toDiscard(next, 'luggage', t.slots.luggage.card);
      return say(next, `${head}: багаж ${t.name} потерян`);
    }
    case 'forceReveal': {
      const t = target!;
      const cat = params.category!;
      const next = withSlot(n, t.id, cat, { card: t.slots[cat].card, isRevealed: true });
      return say(next, `${head}: ${t.name} вынужден открыть «${CATEGORY_LABEL[cat]}»: ${t.slots[cat].card.description}`);
    }
    case 'rerollPrevPhysique':
      return reroll(neighbor(g, actorId, -1)!, 'physique');
    case 'rerollNextPhysique':
      return reroll(neighbor(g, actorId, 1)!, 'physique');
    case 'rerollPrevBiology':
      return reroll(neighbor(g, actorId, -1)!, 'biology');
    case 'swapNeighborsPhysique':
    case 'swapNeighborsBiology': {
      const cat = effect === 'swapNeighborsPhysique' ? 'physique' : 'biology';
      const a = neighbor(g, actorId, -1)!;
      const b = neighbor(g, actorId, 1)!;
      let next = withSlot(n, a.id, cat, b.slots[cat]);
      next = withSlot(next, b.id, cat, a.slots[cat]);
      return say(next, `${head}: ${a.name} и ${b.name} меняются картами «${CATEGORY_LABEL[cat]}»`);
    }
    case 'rerollHobby': {
      const d = draw(n, 'hobby')!;
      let next = withSlot(d.g, actorId, 'hobby', { card: d.card, isRevealed: actor.slots.hobby.isRevealed });
      next = toDiscard(next, 'hobby', actor.slots.hobby.card);
      return say(next, `${head}: меняет хобби`);
    }
    case 'heal': {
      const h = actor.slots.health;
      const next = withSlot(n, actorId, 'health', { card: { ...h.card, modifier: 'neutral', description: `${h.card.description} (вылечен)` }, isRevealed: h.isRevealed });
      return say(next, `${head}: его вылечили`);
    }
    case 'veto':
      return say({ ...n, fx: { ...(n.fx ?? emptyFx()), veto: [...(n.fx?.veto ?? []), actorId] } }, `${head}: один голос против него будет отменён`);
    case 'doubleVote':
      return say({ ...n, fx: { ...(n.fx ?? emptyFx()), double: [...(n.fx?.double ?? []), actorId] } }, `${head}: его голос считается за два`);
    case 'immunity': {
      const next: GameState = { ...n, fx: { ...(n.fx ?? emptyFx()), immune: [...(n.fx?.immune ?? []), actorId] } };
      // Во время голосования отметка сразу закрывает ему голос.
      return say(next.phase === 'vote' ? { ...next, votes: { ...next.votes, [actorId]: IMMUNE_VOTE } } : next, `${head}: на этот раунд он неприкосновенен, но не голосует`);
    }
    case 'ally':
      // Имя союзника в журнал не пишем: союз тайный.
      return say({ ...n, fx: { ...(n.fx ?? emptyFx()), allies: [...(n.fx?.allies ?? []), [actorId, target!.id]] } }, `${head}: заключает тайный союз`);
  }
}

/** Проставляет отметки неприкосновенных в новом голосовании. */
export function markImmune(g: GameState): GameState {
  if (!g.fx?.immune.length) return g;
  const votes = { ...g.votes };
  for (const id of g.fx.immune) if (find(g, id) && !find(g, id)!.isEliminated) votes[id] = IMMUNE_VOTE;
  return { ...g, votes };
}

/** Применяет накопленные действия к голосам: отметки неприкосновенных, союзники, вето. Двойной голос считается отдельно. */
export function effectiveVotes(g: GameState): Record<string, string> {
  const votes = { ...g.votes };
  const fx = g.fx;
  if (!fx) return votes;
  for (const [a, b] of fx.allies) {
    const t = votes[a];
    if (t && t !== IMMUNE_VOTE && !fx.immune.includes(b)) votes[b] = t === b ? 'abstain' : t;
  }
  for (const id of fx.veto) {
    const voter = Object.keys(votes).find((v) => votes[v] === id);
    if (voter) delete votes[voter];
  }
  return votes;
}

const DECK_CATEGORIES: DeckCategory[] = ['luggage', 'physique', 'biology', 'hobby'];

/** Колода для эффектов: карты выбранных паков, которые не попали в раздачу, перемешанные детерминированно от seed. */
export function initialDeck(players: PlayerCharacter[], packs: CardPack[], seed: number): Pick<GameState, 'deck' | 'discard'> {
  const pools = mergePools(packs);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const deck: Partial<Record<DeckCategory, Card[]>> = {};
  const discard: Partial<Record<DeckCategory, Card[]>> = {};
  for (const cat of DECK_CATEGORIES) {
    const dealt = new Set(players.map((p) => p.slots[cat].card.id));
    deck[cat] = shuffle(pools[cat].filter((c) => !dealt.has(c.id)), rng);
    discard[cat] = [];
  }
  return { deck, discard };
}
