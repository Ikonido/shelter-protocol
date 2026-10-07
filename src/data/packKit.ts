import type { Card, Category, Hazard, Modifier, ScenarioEvent, Severity } from '../types';
import { CATEGORIES } from '../types';

/** [описание, полезность, навыки, название (для действий)] */
export type Row = [description: string, modifier?: Modifier, tags?: string[], title?: string];

export const cards = (prefix: string, category: Category, rows: Row[]): Card[] =>
  rows.map(([description, modifier = 'neutral', tags, title], i) => ({
    id: `${prefix}-${category}-${i + 1}`,
    category,
    description,
    modifier,
    ...(tags ? { tags } : {}),
    ...(title ? { title } : {}),
  }));

export const emptyDeck = (): Record<Category, Card[]> => Object.fromEntries(CATEGORIES.map((c) => [c, []])) as unknown as Record<Category, Card[]>;

/** Угроза: {who} в фразе успеха заменяется тем, кто с ней справился. */
export const haz = (
  prefix: string,
  id: string,
  title: string,
  description: string,
  severity: Severity,
  counters: string[],
  onSuccess: string,
  onFail: string,
): Hazard => ({ id: `${prefix}-hz-${id}`, title, description, severity, counters, onSuccess, onFail });

export const ev = (prefix: string, id: string, kind: ScenarioEvent['kind'], tone: ScenarioEvent['tone'], title: string, text: string): ScenarioEvent => ({
  id: `${prefix}-ev-${id}`,
  kind,
  tone,
  title,
  text,
});
