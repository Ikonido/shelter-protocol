import type { Card, CardPack, Hazard, Scenario } from '../types';
import { CATEGORIES } from '../types';
import { uid } from './rng';

/** Пак, в который конструктор складывает сценарии, свои карты и «переобученные» способности. */
export const MY_PACK_ID = 'my-scenarios';

export function emptyMyPack(): CardPack {
  return {
    id: MY_PACK_ID,
    // Русский ключ: на язык интерфейса переводится при показе, поэтому смена языка действует сразу.
    name: 'Мои сценарии',
    description: 'Сценарии, карты и способности, созданные в конструкторе.',
    isCustom: true,
    scenarios: [],
    cards: Object.fromEntries(CATEGORIES.map((c) => [c, []])) as unknown as CardPack['cards'],
  };
}

export function blankScenario(): Scenario {
  return { id: uid('sc'), title: '', description: '', shelterSlots: 4, isolationDuration: '3 года', requiredSkills: [], threats: [], hazards: [] };
}

export const newHazard = (partial: Partial<Hazard> = {}): Hazard => ({ id: uid('hz'), title: '', description: '', severity: 'major', counters: [], ...partial });

/** Собирает итоговый «Мои сценарии»: сценарий (новый или обновлённый), свои карты и переопределения способностей. */
export function buildMyPack(base: CardPack | undefined, scenario: Scenario, newCards: Card[], overrides: Record<string, string[]>, removedIds: string[] = []): CardPack {
  const pack = base ?? emptyMyPack();
  const cards = Object.fromEntries(CATEGORIES.map((c) => [c, (pack.cards[c] ?? []).filter((x) => !removedIds.includes(x.id))])) as unknown as CardPack['cards'];
  for (const c of newCards) cards[c.category] = [...(cards[c.category] ?? []).filter((x) => x.id !== c.id), c];
  const exists = pack.scenarios.some((s) => s.id === scenario.id);
  const clean: Scenario = { ...scenario, title: scenario.title.trim(), hazards: (scenario.hazards ?? []).filter((h) => h.title.trim()), threats: (scenario.hazards ?? []).filter((h) => h.title.trim()).map((h) => h.title.trim()).slice(0, 6) };
  const next: CardPack = {
    ...pack,
    scenarios: exists ? pack.scenarios.map((s) => (s.id === scenario.id ? clean : s)) : [...pack.scenarios, clean],
    cards,
    tagOverrides: Object.keys(overrides).length ? overrides : undefined,
  };
  if (!next.tagOverrides) delete next.tagOverrides;
  return next;
}
