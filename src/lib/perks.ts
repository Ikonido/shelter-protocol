import type { ActionEffect, Card, GameState, Perk, PerkKind, PerkLevel } from '../types';
import { canApply, runEffect, toDiscard, type ActionParams } from './actions';
import { addToBag, composeItems, itemsOf } from './inventory';
import { mulberry32 } from './rng';
import { t } from './i18n';

/**
 * Бонусы профессий (включаются в настройках партии). Когда игрок открывает профессию, по её навыку он получает:
 * - предмет: добавляется к его багажу сразу;
 * - действие с выбором игрока: вылечить, украсть багаж, допросить (открыть чужую карту). Оно доступно, пока не началось голосование.
 * Карта действия при этом не тратится.
 */

interface ItemPerk {
  kind: 'item';
  tags: string[];
  item: string;
  itemTags: string[];
}
interface TargetPerk {
  kind: PerkKind;
  tags: string[];
}

/** Порядок важен: берётся первое совпадение по навыкам профессии. */
const PERKS: (ItemPerk | TargetPerk)[] = [
  { kind: 'heal', tags: ['медицина', 'лечение'] },
  { kind: 'steal', tags: ['шпионаж', 'нычка'] },
  { kind: 'reveal', tags: ['расследование', 'психология', 'дипломатия'] },
  { kind: 'item', tags: ['инженерия', 'ремонт', 'строительство', 'энергетика'], item: 'Набор инструментов', itemTags: ['ремонт'] },
  { kind: 'item', tags: ['агрономия', 'провизия', 'кулинария', 'готовка'], item: 'Мешок припасов', itemTags: ['провизия'] },
  { kind: 'item', tags: ['безопасность', 'оборона', 'драка', 'охота'], item: 'Бронежилет и фонарь', itemTags: ['оборона'] },
  { kind: 'item', tags: ['связь', 'навигация'], item: 'Рация и карта местности', itemTags: ['связь'] },
  { kind: 'item', tags: ['санитария', 'дератизация', 'чистота', 'вирусология'], item: 'Набор для дезинфекции', itemTags: ['санитария'] },
  { kind: 'item', tags: ['образование', 'грамота'], item: 'Стопка учебников', itemTags: ['образование'] },
];

/** Какой эффект выполняет бонус с выбором игрока. */
export const PERK_EFFECT: Record<PerkKind, ActionEffect> = { heal: 'healOther', steal: 'stealLuggage', reveal: 'forceReveal' };

/** Опытность врача: шанс вылечить больного. */
export const LEVELS: Record<PerkLevel, { chance: number; label: string }> = {
  novice: { chance: 0.4, label: 'новичок' },
  experienced: { chance: 0.75, label: 'опытный' },
  expert: { chance: 1, label: 'эксперт' },
};

/** Уровень врача выпадает по жребию от seed: новичок 30%, опытный 45%, эксперт 25%. */
function rollLevel(g: GameState, playerId: string): PerkLevel {
  const salt = [...playerId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
  const r = mulberry32(g.seed ^ Math.imul(g.round, 2654435761) ^ salt)();
  return r < 0.3 ? 'novice' : r < 0.75 ? 'experienced' : 'expert';
}

/** Подписи бонусов для кнопок. У врача — опытность и шанс. */
export const perkLabel = (kind: PerkKind, level?: PerkLevel) =>
  kind === 'heal'
    ? level
      ? t('Вылечить игрока ({level}, шанс {n}%)', { level: t(LEVELS[level].label), n: Math.round(LEVELS[level].chance * 100) })
      : t('Вылечить игрока')
    : t(kind === 'steal' ? 'Украсть багаж' : 'Допросить игрока');

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

/** Бонус профессии по её навыкам; нет подходящего навыка — нет бонуса. */
export function perkFor(card: Card): ItemPerk | TargetPerk | undefined {
  const tags = (card.tags ?? []).map(norm);
  return PERKS.find((p) => p.tags.some((tag) => tags.includes(tag)));
}

/** Предмет профессии попадает в инвентарь; если он полон, остаётся самый ценный предмет. */
function addItem(g: GameState, playerId: string, perk: ItemPerk): GameState {
  const p = g.players.find((x) => x.id === playerId)!;
  const slot = p.slots.luggage;
  const item: Card = { id: `perk-${perk.itemTags[0]}`, category: 'luggage', description: perk.item, modifier: 'positive', tags: perk.itemTags };
  const bag = addToBag(itemsOf(slot.card), item);
  const card = composeItems(bag.items, () => slot.card);
  let next: GameState = {
    ...g,
    players: g.players.map((x) => (x.id === playerId ? { ...x, slots: { ...x.slots, luggage: { ...slot, card } } } : x)),
    log: [...g.log, { round: g.round, text: t('{who} получает бонус профессии: {item}', { who: p.name, item: t(perk.item) }) }],
  };
  if (bag.dropped) next = toDiscard(next, 'luggage', bag.dropped);
  return next;
}

/** Вызывается, когда игрок открыл профессию. Если бонусы выключены или подходящего нет — состояние не меняется. */
export function onProfessionRevealed(g: GameState, playerId: string): GameState {
  if (!g.config.professionPerks) return g;
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.isEliminated) return g;
  const perk = perkFor(p.slots.profession.card);
  if (!perk) return g;
  if (perk.kind === 'item') return addItem(g, playerId, perk);
  if (g.players.filter((x) => !x.isEliminated).length < 2) return g;
  const level = perk.kind === 'heal' ? rollLevel(g, playerId) : undefined;
  return {
    ...g,
    perks: [...(g.perks ?? []).filter((x) => x.playerId !== playerId), { playerId, kind: perk.kind, ...(level ? { level } : {}) }],
    log: [...g.log, { round: g.round, text: t('{who} получает бонус профессии: «{label}»', { who: p.name, label: perkLabel(perk.kind, level) }) }],
  };
}

export const perkOf = (g: GameState, playerId: string): Perk | undefined => g.perks?.find((x) => x.playerId === playerId);

/** Можно ли применить бонус игрока с такими параметрами (причина — для показа). */
export function canApplyPerk(g: GameState, playerId: string, params: ActionParams = {}): { ok: true } | { ok: false; reason: string } {
  const perk = perkOf(g, playerId);
  if (!perk) return { ok: false, reason: t('Нет неиспользованного бонуса профессии') };
  return canApply(g, playerId, PERK_EFFECT[perk.kind], { ...params, perk: true });
}

const withoutPerk = (g: GameState, playerId: string): GameState => {
  const rest = (g.perks ?? []).filter((x) => x.playerId !== playerId);
  return { ...g, perks: rest.length ? rest : undefined };
};

/** Применяет бонус игрока. Невозможное действие ничего не меняет (бонус остаётся). */
export function applyPerk(g: GameState, playerId: string, params: ActionParams = {}): GameState {
  const perk = perkOf(g, playerId);
  if (!perk) return g;
  const chance = perk.kind === 'heal' ? LEVELS[perk.level ?? 'experienced'].chance : undefined;
  const next = runEffect(g, playerId, PERK_EFFECT[perk.kind], { ...params, perk: true, ...(chance !== undefined ? { chance } : {}) });
  return next === g ? g : withoutPerk(next, playerId);
}

/** Отказаться от бонуса. */
export function skipPerk(g: GameState, playerId: string): GameState {
  return perkOf(g, playerId) ? withoutPerk(g, playerId) : g;
}
