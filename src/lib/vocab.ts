import type { Card, CardPack, Scenario } from '../types';
import { cardMatchesSkill, SKILL_CATEGORIES } from './evaluate';
import { mergePools } from './generator';
import { t } from './i18n';

/** Все карты, из которых игроки получают навыки (профессия, хобби, багаж, факт), с учётом переопределений способностей. */
export function skillCards(packs: CardPack[]): Card[] {
  const pools = mergePools(packs);
  return SKILL_CATEGORIES.flatMap((c) => pools[c]);
}

export interface SkillInfo {
  skill: string;
  /** Сколько карт в колоде дают этот навык. */
  count: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

/**
 * Словарь навыков: все теги карт плюс то, что уже требуют сценарии и угрозы (даже если карт с этим навыком нет).
 * Отсортирован: сначала самые распространённые.
 */
export function skillVocabulary(packs: CardPack[], extra: string[] = []): SkillInfo[] {
  const cards = skillCards(packs);
  const names = new Map<string, string>();
  const add = (s: string) => {
    const k = norm(s);
    if (k && !names.has(k)) names.set(k, s.trim());
  };
  for (const c of cards) c.tags?.forEach(add);
  for (const p of packs) for (const sc of p.scenarios) {
    sc.requiredSkills.forEach(add);
    sc.hazards?.forEach((h) => h.counters.forEach(add));
  }
  extra.forEach(add);
  return [...names.values()]
    .map((skill) => ({ skill, count: cardsWithSkill(cards, skill).length }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill, 'ru'));
}

export const cardsWithSkill = (cards: Card[], skill: string): Card[] => cards.filter((c) => cardMatchesSkill(c, skill));

export const cardLabel = (c: Card) => c.title ?? c.description;
/** Название навыка для показа. Сам навык (русский ключ) остаётся данными для сравнения. */
export const skillLabel = (name: string): string => t(name);

export interface Problem {
  level: 'error' | 'warn';
  text: string;
}

/**
 * Проверка сценария перед сохранением: ошибки мешают сохранить, предупреждения — «выиграть невозможно».
 * Навык или угроза, которые не даёт ни одна карта колоды, делают победу недостижимой.
 */
export function validateScenario(sc: Scenario, packs: CardPack[]): Problem[] {
  const cards = skillCards(packs);
  const out: Problem[] = [];
  if (!sc.title.trim()) out.push({ level: 'error', text: t('Дайте сценарию название.') });
  if (sc.shelterSlots < 1) out.push({ level: 'error', text: t('Нужно хотя бы одно место в бункере.') });
  for (const skill of sc.requiredSkills) {
    if (!cardsWithSkill(cards, skill).length) out.push({ level: 'warn', text: t('Навык «{skill}» требуется, но ни одна карта его не даёт — выиграть будет нельзя. Откройте шаг «Способности карт».', { skill: skillLabel(skill) }) });
  }
  for (const h of sc.hazards ?? []) {
    if (!h.title.trim()) out.push({ level: 'error', text: t('У одной из угроз нет названия.') });
    else if (!h.counters.length) out.push({ level: 'warn', text: t('Угрозу «{title}» ничто не нейтрализует — она всегда будет непобедимой.', { title: h.title }) });
    else if (!h.counters.some((s) => cardsWithSkill(cards, s).length)) out.push({ level: 'warn', text: t('Угрозу «{title}» не может снять ни одна карта колоды.', { title: h.title }) });
  }
  if (!(sc.hazards?.length)) out.push({ level: 'warn', text: t('Угроз нет — игра будет проще и без хроники угроз.') });
  return out;
}

