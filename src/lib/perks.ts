import { CATEGORIES, type ActionEffect, type Card, type Category, type GameState, type Perk, type PerkKind, type PerkLevel } from '../types';
import { SKILL_CATEGORIES } from './evaluate';
import { canApply, runEffect, toDiscard, type ActionParams } from './actions';
import { addToBag, composeItems, itemsOf } from './inventory';
import { mulberry32, shuffle } from './rng';
import { t } from './i18n';

/**
 * Бонусы профессий (включаются в настройках партии). Когда игрок открывает профессию, по её навыку он получает:
 * - предметы: добавляются к его багажу сразу;
 * - действие с выбором игрока: вылечить, украсть багаж, допросить (открыть чужие карты). Оно доступно, пока не началось голосование.
 * Сила бонуса зависит от опытности (новичок, опытный, эксперт): она выпадает по жребию. Предметов, украденных предметов и открытых
 * карт бывает от 1 до 3; у врача опытность задаёт шанс вылечить. Карта действия при этом не тратится.
 */

interface ItemDef {
  d: string;
  tags: string[];
}
interface ItemPerk {
  kind: 'item';
  tags: string[];
  pool: ItemDef[];
}
interface FixedPerk {
  kind: 'fixed';
  fixed: string[];
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
  { kind: 'item', tags: ['инженерия', 'ремонт', 'строительство', 'энергетика'], pool: [{ d: 'Набор инструментов', tags: ['ремонт'] }, { d: 'Сварочный аппарат', tags: ['ремонт'] }, { d: 'Ящик запчастей', tags: ['ремонт'] }] },
  { kind: 'item', tags: ['агрономия', 'провизия', 'кулинария', 'готовка'], pool: [{ d: 'Мешок припасов', tags: ['провизия'] }, { d: 'Набор семян', tags: ['агрономия'] }, { d: 'Походная кухня', tags: ['кулинария'] }] },
  { kind: 'item', tags: ['безопасность', 'оборона', 'драка', 'охота'], pool: [{ d: 'Бронежилет и фонарь', tags: ['оборона'] }, { d: 'Дробовик с патронами', tags: ['оборона'] }, { d: 'Сигнальные ракеты', tags: ['оборона'] }] },
  { kind: 'item', tags: ['связь', 'навигация'], pool: [{ d: 'Рация и карта местности', tags: ['связь'] }, { d: 'Спутниковый телефон', tags: ['связь'] }, { d: 'Компас и секстант', tags: ['навигация'] }] },
  { kind: 'item', tags: ['санитария', 'дератизация', 'чистота', 'вирусология'], pool: [{ d: 'Набор для дезинфекции', tags: ['санитария'] }, { d: 'Респираторы', tags: ['санитария'] }, { d: 'Ловушки для крыс', tags: ['дератизация'] }] },
  { kind: 'item', tags: ['образование', 'грамота'], pool: [{ d: 'Стопка учебников', tags: ['образование'] }, { d: 'Атлас и энциклопедия', tags: ['образование'] }, { d: 'Школьная доска', tags: ['образование'] }] },
];

/** Какой эффект выполняет бонус с выбором игрока. */
export const PERK_EFFECT: Record<PerkKind, ActionEffect> = {
  heal: 'healOther',
  steal: 'stealLuggage',
  reveal: 'forceReveal',
  steal_junk: 'stealLuggage',
  immunity: 'immunity',
  reroll_health: 'rerollHealth',
  reroll_character: 'rerollCharacter',
  swap_bag: 'swapLuggage',
};

/** Бонусы, которым не нужна цель-игрок: применяются сразу, без выбора. */
const NO_TARGET: PerkKind[] = ['immunity'];
export const perkNeedsTarget = (kind: PerkKind) => !NO_TARGET.includes(kind);

/** Особые бонусы профессий (по названию карты): предметы, выбор кражи и т.д. Профессия без навыка получает бонус только отсюда. */
const SPECIAL: Record<string, { kind: PerkKind } | { fixed: string[] } | { pool: string[] }> = {
  'Видеоблогер-инфлюенсер': { pool: ['Телефон', 'Камера'] },
  'Сомелье': { fixed: ['5 бутылок вина', 'Кусок сыра'] },
  'Придворный астролог': { pool: ['Карта созвездия: Орион', 'Карта созвездия: Большая Медведица', 'Карта созвездия: Кассиопея'] },
  'Безработный герой': { fixed: ['Меч'] },
  'Мастер маникюра': { fixed: ['Легковоспламеняющаяся химия'] },
  'Сборщик налогов': { kind: 'steal' },
  'Торговец поддельными реликвиями': { kind: 'steal_junk' },
  'Королевский шут': { kind: 'immunity' },
  'Придворный фокусник': { kind: 'reroll_health' },
  'Блогер-«эксперт по жизни»': { kind: 'reroll_character' },
  'Коуч по «поиску себя»': { kind: 'reroll_character' },
  'Менеджер по продажам': { kind: 'swap_bag' },
};

/** Опытность: у врача задаёт шанс вылечить, у остальных — сколько предметов, краж или открытых карт (от и до, максимум 3). */
export const LEVELS: Record<PerkLevel, { chance: number; label: string; count: [number, number] }> = {
  novice: { chance: 0.4, label: 'новичок', count: [1, 1] },
  experienced: { chance: 0.75, label: 'опытный', count: [1, 2] },
  expert: { chance: 1, label: 'эксперт', count: [2, 3] },
};

/** Жребий, зависящий от seed, раунда и числа записей журнала (на хосте он одинаков при повторе, у клиентов seed нет). */
const rngFor = (g: GameState, salt: number) => mulberry32(g.seed ^ Math.imul(g.round, 2654435761) ^ Math.imul(g.log.length + 1, 40503) ^ salt);
const saltOf = (id: string) => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);

/** Уровень выпадает по жребию: новичок 30%, опытный 45%, эксперт 25%. */
function rollLevel(g: GameState, playerId: string): PerkLevel {
  const r = rngFor(g, saltOf(playerId))();
  return r < 0.3 ? 'novice' : r < 0.75 ? 'experienced' : 'expert';
}

/** Сколько получится на этот раз: число внутри диапазона опытности. */
const rollCount = (level: PerkLevel, rng: () => number) => {
  const [lo, hi] = LEVELS[level].count;
  return lo + Math.floor(rng() * (hi - lo + 1));
};

const rangeText = (level: PerkLevel) => {
  const [lo, hi] = LEVELS[level].count;
  return lo === hi ? String(lo) : `${lo}–${hi}`;
};

/** Подписи бонусов для кнопок: опытность и сила бонуса. */
export const perkLabel = (kind: PerkKind, level?: PerkLevel) => {
  const plain: Partial<Record<PerkKind, string>> = {
    steal_junk: 'Украсть предмет и подбросить статуэтку',
    immunity: 'Неприкосновенность на раунд',
    reroll_health: 'Сменить здоровье игрока',
    reroll_character: 'Сменить характер игрока',
    swap_bag: 'Обменяться багажом',
  };
  if (plain[kind]) return t(plain[kind]!);
  if (!level) return t(kind === 'heal' ? 'Вылечить игрока' : kind === 'steal' ? 'Украсть багаж' : 'Допросить игрока');
  const vars = { level: t(LEVELS[level].label), n: Math.round(LEVELS[level].chance * 100), range: rangeText(level) };
  return kind === 'heal' ? t('Вылечить игрока ({level}, шанс {n}%)', vars) : kind === 'steal' ? t('Украсть багаж ({level}: {range})', vars) : t('Допросить игрока ({level}: {range})', vars);
};

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

/** Бонус профессии по её навыкам; нет подходящего навыка — нет бонуса. */
export function perkFor(card: Card): ItemPerk | TargetPerk | FixedPerk | undefined {
  const special = card.category === 'profession' ? SPECIAL[card.description] : undefined;
  if (special) {
    if ('fixed' in special) return { kind: 'fixed', fixed: special.fixed };
    if ('pool' in special) return { kind: 'item', tags: [], pool: special.pool.map((d) => ({ d, tags: [] })) };
    return { kind: special.kind, tags: [] };
  }
  const tags = (card.tags ?? []).map(norm);
  return PERKS.find((p) => p.tags.some((tag) => tags.includes(tag)));
}

/** Фиксированный набор предметов (сомелье, меч): добавляется целиком, без жребия. */
function addFixed(g: GameState, playerId: string, names: string[]): GameState {
  let next = g;
  for (const name of names) next = addItemTo(next, playerId, { id: `perk-${name}`, category: 'luggage', description: name, modifier: 'positive' });
  const p = g.players.find((x) => x.id === playerId)!;
  return { ...next, log: [...next.log, { round: g.round, text: t('{who} получает бонус профессии: {items}', { who: p.name, items: names.map((n) => t(n)).join(', ') }) }] };
}

/** Кладёт один предмет в багаж игрока; пустой (потерянный или украденный) багаж заменяется им, полный — самым ценным. */
function addItemTo(g: GameState, playerId: string, item: Card): GameState {
  const slot = g.players.find((x) => x.id === playerId)!.slots.luggage;
  const bag = addToBag(itemsOf(slot.card), item);
  let next: GameState = {
    ...g,
    players: g.players.map((x) => (x.id === playerId ? { ...x, slots: { ...x.slots, luggage: { ...slot, card: composeItems(bag.items, () => slot.card) } } } : x)),
  };
  if (bag.dropped) next = toDiscard(next, 'luggage', bag.dropped);
  return next;
}

/** Предметы профессии попадают в инвентарь (сколько и какие — по опытности и жребию); если он полон, остаются самые ценные. */
function addItems(g: GameState, playerId: string, perk: ItemPerk, level: PerkLevel): GameState {
  const p = g.players.find((x) => x.id === playerId)!;
  const slot = p.slots.luggage;
  const rng = rngFor(g, saltOf(playerId) ^ 0x5bd1e995);
  const chosen = shuffle(perk.pool, rng).slice(0, rollCount(level, rng));
  let items = itemsOf(slot.card);
  const dropped: Card[] = [];
  for (const def of chosen) {
    const bag = addToBag(items, { id: `perk-${def.d}`, category: 'luggage', description: def.d, modifier: 'positive', tags: def.tags });
    items = bag.items;
    if (bag.dropped) dropped.push(bag.dropped);
  }
  let next: GameState = {
    ...g,
    players: g.players.map((x) => (x.id === playerId ? { ...x, slots: { ...x.slots, luggage: { ...slot, card: composeItems(items, () => slot.card) } } } : x)),
    log: [...g.log, { round: g.round, text: t('{who} получает бонус профессии ({level}): {items}', { who: p.name, level: t(LEVELS[level].label), items: chosen.map((c) => t(c.d)).join(', ') }) }],
  };
  for (const card of dropped) next = toDiscard(next, 'luggage', card);
  return next;
}

/**
 * Открыта карта с навыком (профессия, хобби, факт, багаж, характер, телосложение, биология): по её навыкам игрок получает бонус.
 * Предметы выдаются сразу; действие с выбором игрока остаётся до голосования. Одновременно действует один бонус:
 * пока он не потрачен, следующий навык бонуса не заменяет.
 */
export function onSkillRevealed(g: GameState, playerId: string, category: Category): GameState {
  if (!g.config.professionPerks || !SKILL_CATEGORIES.includes(category as (typeof SKILL_CATEGORIES)[number])) return g;
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.isEliminated) return g;
  const perk = perkFor(p.slots[category].card);
  if (!perk) return g;
  if ('fixed' in perk) return addFixed(g, playerId, perk.fixed);
  const level = rollLevel(g, playerId);
  if (perk.kind === 'item') return addItems(g, playerId, perk, level);
  if (g.players.filter((x) => !x.isEliminated).length < 2) return g;
  if (perkOf(g, playerId)) return g;
  return {
    ...g,
    perks: [...(g.perks ?? []), { playerId, kind: perk.kind, level }],
    log: [...g.log, { round: g.round, text: t('{who} получает бонус навыка: «{label}»', { who: p.name, label: perkLabel(perk.kind, level) }) }],
  };
}

/**
 * Карту могли открыть не по ходу, а принудительно (допрос, утечка, карта «Заставить открыть»): владельцу всё равно
 * положен бонус. Сравнивает состояния до и после и выдаёт бонусы за каждую только что открытую карту навыка.
 */
export function grantPerksForNewReveals(prev: GameState, next: GameState): GameState {
  if (next === prev || !next.config.professionPerks) return next;
  let cur = next;
  for (const p of next.players) {
    const was = prev.players.find((x) => x.id === p.id);
    if (!was) continue;
    for (const c of SKILL_CATEGORIES) {
      if (p.slots[c].isRevealed && !was.slots[c].isRevealed) cur = onSkillRevealed(cur, p.id, c);
    }
  }
  return cur;
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
  const level = perk.level ?? 'experienced';
  const effect = PERK_EFFECT[perk.kind];
  const base: ActionParams = { ...params, perk: true };
  if (perk.kind === 'heal') {
    const next = runEffect(g, playerId, effect, { ...base, chance: LEVELS[level].chance });
    return next === g ? g : withoutPerk(next, playerId);
  }
  let cur = runEffect(g, playerId, effect, base);
  if (cur === g) return g;
  if (perk.kind === 'steal_junk' && params.target) {
    // Подменяем украденное бесполезной статуэткой: жертва остаётся с хламом, а не с пустым местом.
    cur = addItemTo(cur, params.target, { id: 'perk-statuette', category: 'luggage', description: 'Бесполезная статуэтка', modifier: 'negative' });
    return grantPerksForNewReveals(g, withoutPerk(cur, playerId));
  }
  if (perk.kind !== 'steal' && perk.kind !== 'reveal') return grantPerksForNewReveals(g, withoutPerk(cur, playerId));
  // Дополнительные результаты по опытности: ещё предметы (кража) или ещё случайные скрытые карты (допрос).
  const rng = rngFor(g, saltOf(playerId) ^ 0x1b873593);
  const extra = rollCount(level, rng) - 1;
  for (let i = 0; i < extra && params.target; i++) {
    if (perk.kind === 'steal') {
      if (!canApply(cur, playerId, effect, base).ok) break;
      cur = runEffect(cur, playerId, effect, base);
    } else {
      const tg = cur.players.find((x) => x.id === params.target);
      const hidden = tg ? CATEGORIES.filter((c) => c !== 'action' && !tg.slots[c].isRevealed) : [];
      if (!hidden.length) break;
      cur = runEffect(cur, playerId, effect, { ...base, category: hidden[Math.floor(rng() * hidden.length)] });
    }
  }
  return grantPerksForNewReveals(g, withoutPerk(cur, playerId));
}

/** Отказаться от бонуса. */
export function skipPerk(g: GameState, playerId: string): GameState {
  return perkOf(g, playerId) ? withoutPerk(g, playerId) : g;
}
