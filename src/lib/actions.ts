import { CATEGORIES, categoryLabel, type ActionEffect, type ActionFx, type Card, type CardPack, type Category, type DeckCategory, type GameState, type PlayerCharacter } from '../types';
import { cardMatchesSkill } from './evaluate';
import { mergePools } from './generator';
import { mulberry32, shuffle } from './rng';
import { t } from './i18n';

/**
 * Автоисполнение карт действий. Модуль не зависит от game.ts (там он подключается), чтобы не было циклов.
 * Все функции чистые: возвращают новое состояние или то же самое, если действие нельзя выполнить.
 */

export interface ActionParams {
  target?: string;
  category?: Category;
  /** Бонус профессии, а не карта действия: карта не расходуется. */
  perk?: boolean;
}

const NEEDS_TARGET: ActionEffect[] = ['stealLuggage', 'giveLuggage', 'swapLuggage', 'sabotage', 'forceReveal', 'ally', 'healOther'];
export const needsTarget = (e: ActionEffect) => NEEDS_TARGET.includes(e);
export const needsCategory = (e: ActionEffect) => e === 'forceReveal';

export const IMMUNE_VOTE = 'immune'; // метка в votes: этот игрок голосовать не может
const HEALING = ['медицина', 'лечение'];
const living = (g: GameState) => g.players.filter((p) => !p.isEliminated);
const find = (g: GameState, id?: string) => g.players.find((p) => p.id === id);
const rank = (c: Card) => (c.modifier === 'positive' ? 2 : c.modifier === 'negative' ? 0 : 1) + (c.tags?.length ? 0.5 : 0);

// Карты-заглушки создаются при каждом применении: описание переводится в момент события.
const lostCard = (): Card => ({ id: 'lost-luggage', category: 'luggage', description: t('Багаж потерян: пусто'), modifier: 'negative' });
const stolenCard = (): Card => ({ id: 'stolen-luggage', category: 'luggage', description: t('Багаж украден: пусто'), modifier: 'negative' });

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

const say = (g: GameState, text: string): GameState => ({ ...g, log: [...g.log, { round: g.round, text, kind: 'action' }] });

const emptyFx = (): ActionFx => ({ double: [], veto: [], immune: [], allies: [] });

/** Можно ли применить эффект сейчас; причина нужна, чтобы показать её игроку. */
export function canApply(g: GameState, actorId: string, effect: ActionEffect, params: ActionParams = {}): { ok: true } | { ok: false; reason: string } {
  const actor = find(g, actorId);
  if (!actor || actor.isEliminated) return { ok: false, reason: t('Игрок выбыл') };
  if (actor.slots.action.isRevealed && !params.perk) return { ok: false, reason: t('Действие уже использовано') };
  const fail = (reason: string) => ({ ok: false as const, reason });
  const target = find(g, params.target);
  if (needsTarget(effect)) {
    if (!target || target.isEliminated || target.id === actorId) return fail(t('Выберите другого живого игрока'));
  }
  // В «виде» онлайн-клиента нет ни колоды, ни чужих карт: такие проверки пропускаем, их повторяет хост.
  const full = g.deck !== undefined;
  const hasDeck = (cat: DeckCategory) => !full || (g.deck?.[cat]?.length ?? 0) + (g.discard?.[cat]?.length ?? 0) > 0;
  switch (effect) {
    case 'drawLuggage':
    case 'giveLuggage':
      return hasDeck('luggage') ? { ok: true } : fail(t('В колоде не осталось карт багажа'));
    case 'rerollHobby':
      return hasDeck('hobby') ? { ok: true } : fail(t('В колоде не осталось карт хобби'));
    case 'rerollPrevPhysique':
    case 'rerollNextPhysique':
      if (living(g).length < 2) return fail(t('Нужен хотя бы один сосед'));
      return hasDeck('physique') ? { ok: true } : fail(t('В колоде не осталось телосложений'));
    case 'rerollPrevBiology':
      if (living(g).length < 2) return fail(t('Нужен хотя бы один сосед'));
      return hasDeck('biology') ? { ok: true } : fail(t('В колоде не осталось карт биологии'));
    case 'swapNeighborsPhysique':
    case 'swapNeighborsBiology':
      return living(g).length >= 3 ? { ok: true } : fail(t('Для обмена нужно хотя бы три живых игрока'));
    case 'forceReveal': {
      if (!target) return fail(t('Выберите игрока'));
      const hidden = CATEGORIES.filter((c) => c !== 'action' && !target.slots[c].isRevealed);
      if (!params.category || !hidden.includes(params.category)) return hidden.length ? fail(t('Выберите скрытую карту игрока')) : fail(t('У игрока всё уже открыто'));
      return { ok: true };
    }
    case 'heal': {
      if (actor.slots.health.card.modifier !== 'negative') return fail(t('У вас нет проблем со здоровьем'));
      const doctor = !full || living(g).some((p) => p.id !== actorId && (['profession', 'biology', 'hobby', 'fact', 'luggage'] as const).some((c) => HEALING.some((s) => cardMatchesSkill(p.slots[c].card, s))));
      return doctor ? { ok: true } : fail(t('Среди живых нет врача или лекаря'));
    }
    case 'healOther':
      // В «виде» онлайн-клиента чужое здоровье скрыто: проверку повторяет хост.
      return full && target && target.slots.health.card.modifier !== 'negative' ? fail(t('У этого игрока нет проблем со здоровьем')) : { ok: true };
    case 'ally':
      return g.fx?.allies.some(([a]) => a === actorId) ? fail(t('Союзник уже выбран')) : { ok: true };
    default:
      return { ok: true };
  }
}

/** Выполняет действие игрока. Возвращает то же состояние, если оно невозможно (проверка через canApply). */
export function runEffect(g: GameState, actorId: string, effect: ActionEffect, params: ActionParams = {}): GameState {
  if (!canApply(g, actorId, effect, params).ok) return g;
  const actor = find(g, actorId)!;
  const target = find(g, params.target);
  const title = params.perk ? t('Бонус профессии') : (actor.slots.action.card.title ?? t('Действие'));
  const vars = { who: actor.name, title };
  let n = params.perk ? g : used(g, actorId);

  const reroll = (victim: PlayerCharacter, cat: 'physique' | 'biology'): GameState => {
    const d = draw(n, cat);
    if (!d) return n;
    const old = victim.slots[cat];
    let next = withSlot(d.g, victim.id, cat, { card: d.card, isRevealed: old.isRevealed });
    next = toDiscard(next, cat, old.card);
    const msg = old.isRevealed
      ? t('{who} применяет «{title}»: у {victim} новая карта «{cat}»: {desc}', { ...vars, victim: victim.name, cat: categoryLabel(cat), desc: d.card.description })
      : t('{who} применяет «{title}»: у {victim} новая карта «{cat}»', { ...vars, victim: victim.name, cat: categoryLabel(cat) });
    return say(next, msg);
  };

  switch (effect) {
    case 'drawLuggage': {
      const d = draw(n, 'luggage');
      if (!d) return g;
      const old = actor.slots.luggage;
      const keepNew = rank(d.card) > rank(old.card);
      let next = d.g;
      if (keepNew) {
        next = withSlot(next, actorId, 'luggage', { card: d.card, isRevealed: old.isRevealed });
        next = toDiscard(next, 'luggage', old.card);
      } else next = toDiscard(next, 'luggage', d.card);
      // Журнал видят все: исход (оставил ли новую) не раскрываем, пока багаж закрыт.
      return say(next, t('{who} применяет «{title}»: тянет ещё один багаж и оставляет лучший', vars));
    }
    case 'stealLuggage': {
      const tg = target!;
      let next = withSlot(n, actorId, 'luggage', { card: tg.slots.luggage.card, isRevealed: tg.slots.luggage.isRevealed });
      next = withSlot(next, tg.id, 'luggage', { card: stolenCard(), isRevealed: true });
      next = toDiscard(next, 'luggage', actor.slots.luggage.card);
      return say(next, t('{who} применяет «{title}»: крадёт багаж у {victim}', { ...vars, victim: tg.name }));
    }
    case 'giveLuggage': {
      const tg = target!;
      const d = draw(n, 'luggage');
      if (!d) return g;
      let next = withSlot(d.g, tg.id, 'luggage', { card: d.card, isRevealed: tg.slots.luggage.isRevealed });
      next = toDiscard(next, 'luggage', tg.slots.luggage.card);
      return say(next, t('{who} применяет «{title}»: у {victim} теперь другой багаж', { ...vars, victim: tg.name }));
    }
    case 'swapLuggage': {
      const tg = target!;
      let next = withSlot(n, actorId, 'luggage', tg.slots.luggage);
      next = withSlot(next, tg.id, 'luggage', actor.slots.luggage);
      return say(next, t('{who} применяет «{title}»: меняется багажом с {victim}', { ...vars, victim: tg.name }));
    }
    case 'sabotage': {
      const tg = target!;
      let next = withSlot(n, tg.id, 'luggage', { card: lostCard(), isRevealed: true });
      next = toDiscard(next, 'luggage', tg.slots.luggage.card);
      return say(next, t('{who} применяет «{title}»: багаж {victim} потерян', { ...vars, victim: tg.name }));
    }
    case 'forceReveal': {
      const tg = target!;
      const cat = params.category!;
      const next = withSlot(n, tg.id, cat, { card: tg.slots[cat].card, isRevealed: true });
      return say(next, t('{who} применяет «{title}»: {victim} вынужден открыть «{cat}»: {desc}', { ...vars, victim: tg.name, cat: categoryLabel(cat), desc: tg.slots[cat].card.description }));
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
      return say(next, t('{who} применяет «{title}»: {a} и {b} меняются картами «{cat}»', { ...vars, a: a.name, b: b.name, cat: categoryLabel(cat) }));
    }
    case 'rerollHobby': {
      const d = draw(n, 'hobby');
      if (!d) return g;
      let next = withSlot(d.g, actorId, 'hobby', { card: d.card, isRevealed: actor.slots.hobby.isRevealed });
      next = toDiscard(next, 'hobby', actor.slots.hobby.card);
      return say(next, t('{who} применяет «{title}»: меняет хобби', vars));
    }
    case 'heal': {
      const h = actor.slots.health;
      const next = withSlot(n, actorId, 'health', { card: { ...h.card, modifier: 'neutral', description: t('{desc} (вылечен)', { desc: h.card.description }) }, isRevealed: h.isRevealed });
      return say(next, t('{who} применяет «{title}»: его вылечили', vars));
    }
    case 'healOther': {
      const tg = target!;
      const h = tg.slots.health;
      const next = withSlot(n, tg.id, 'health', { card: { ...h.card, modifier: 'neutral', description: `${h.card.description} (вылечен)` }, isRevealed: h.isRevealed });
      return say(next, t('{who} применяет «{title}»: {victim} вылечен', { ...vars, victim: tg.name }));
    }
    case 'veto':
      return say({ ...n, fx: { ...(n.fx ?? emptyFx()), veto: [...(n.fx?.veto ?? []), actorId] } }, t('{who} применяет «{title}»: один голос против него будет отменён', vars));
    case 'doubleVote':
      return say({ ...n, fx: { ...(n.fx ?? emptyFx()), double: [...(n.fx?.double ?? []), actorId] } }, t('{who} применяет «{title}»: его голос считается за два', vars));
    case 'immunity': {
      const next: GameState = { ...n, fx: { ...(n.fx ?? emptyFx()), immune: [...(n.fx?.immune ?? []), actorId] } };
      // Во время голосования отметка сразу закрывает ему голос.
      return say(
        next.phase === 'vote' ? { ...next, votes: { ...next.votes, [actorId]: IMMUNE_VOTE } } : next,
        t('{who} применяет «{title}»: на этот раунд он неприкосновенен, но не голосует', vars),
      );
    }
    case 'ally':
      // Имя союзника в журнал не пишем: союз тайный.
      return say({ ...n, fx: { ...(n.fx ?? emptyFx()), allies: [...(n.fx?.allies ?? []), [actorId, target!.id]] } }, t('{who} применяет «{title}»: заключает тайный союз', vars));
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
  // Союзники копируют голос актёра из исходных голосов, а не из уже переписанных: порядок союзов не влияет на итог.
  // Голос партнёра может скопировать только один союзник (первый по порядку союза).
  const original = g.votes;
  const copied = new Set<string>();
  for (const [a, b] of fx.allies) {
    const t = original[a];
    if (!t || t === IMMUNE_VOTE || copied.has(b) || fx.immune.includes(b)) continue;
    copied.add(b);
    votes[b] = t === b ? 'abstain' : t;
  }
  // Вето отменяет один голос против актёра. Какой именно, решает жребий от seed и раунда, а не порядок голосования.
  fx.veto.forEach((id, i) => {
    const against = Object.keys(votes).filter((v) => votes[v] === id);
    if (against.length === 0) return;
    const rng = mulberry32(g.seed ^ (g.round * 2654435761) ^ (i + 1) * 40503);
    delete votes[against[Math.floor(rng() * against.length)]];
  });
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
