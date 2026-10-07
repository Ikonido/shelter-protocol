import { CATEGORIES, type Card, type PlayerCharacter, type Scenario } from '../types';

export interface SkillCoverage {
  skill: string;
  by: string[]; // имена выживших
}

export interface Evaluation {
  coverage: SkillCoverage[];
  coveredCount: number;
  health: number; // 0..1
  resources: number; // 0..1
  stability: number; // 0..1
  score: number; // 0..100
  verdict: 'survived' | 'fragile' | 'failed';
  headline: string;
  notes: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();
/** Грубая «основа» слова: «медицина» совпадёт и с «медицинский». */
const stem = (s: string) => (s.length >= 6 ? s.slice(0, s.length - 2) : s);

export function cardMatchesSkill(card: Card, skill: string): boolean {
  const k = norm(skill);
  if (!k) return false;
  if (card.tags?.some((t) => norm(t) === k)) return true;
  const hay = norm(`${card.title ?? ''} ${card.description}`);
  return hay.includes(stem(k));
}

/** Навыки засчитываются с карт профессии, хобби, факта и багажа; здоровье и биология дают штрафы, а не навыки. */
const SKILL_CATEGORIES = ['profession', 'hobby', 'fact', 'luggage'] as const;

export function evaluate(scenario: Scenario, survivors: PlayerCharacter[], slots?: number): Evaluation {
  const coverage: SkillCoverage[] = scenario.requiredSkills.map((skill) => ({
    skill,
    by: survivors
      .filter((p) => SKILL_CATEGORIES.some((c) => cardMatchesSkill(p.slots[c].card, skill)))
      .map((p) => p.name),
  }));
  const coveredCount = coverage.filter((c) => c.by.length > 0).length;
  const skillRatio = coverage.length ? coveredCount / coverage.length : 1;
  const n = Math.max(1, survivors.length);
  const count = (cat: (typeof CATEGORIES)[number], mod: Card['modifier']) =>
    survivors.filter((p) => p.slots[cat].card.modifier === mod).length;

  const badHealth = count('health', 'negative');
  const goodHealth = count('health', 'positive');
  const health = clamp01(0.6 + (goodHealth - badHealth * 1.5) / n / 2);

  const goodLuggage = count('luggage', 'positive');
  const badLuggage = count('luggage', 'negative');
  const resources = clamp01((goodLuggage - badLuggage * 0.5) / Math.max(1, Math.ceil(n / 2)));

  const negatives = CATEGORIES.filter((c) => c !== 'action' && c !== 'health' && c !== 'luggage').reduce(
    (s, c) => s + count(c, 'negative'),
    0,
  );
  const positives = CATEGORIES.filter((c) => c !== 'action' && c !== 'health' && c !== 'luggage').reduce(
    (s, c) => s + count(c, 'positive'),
    0,
  );
  const stability = clamp01(0.5 + (positives - negatives * 1.2) / (n * 6));

  // Переполненное убежище: ресурсы делятся на всех, и за каждого лишнего — штраф.
  const overcrowd = slots ? Math.max(0, survivors.length - slots) : 0;
  const score = Math.max(0, Math.round(100 * (0.6 * skillRatio + 0.15 * health + 0.15 * resources + 0.1 * stability)) - overcrowd * 10);
  const verdict = skillRatio < 0.5 || score < 45 ? 'failed' : score >= 75 && skillRatio === 1 ? 'survived' : 'fragile';

  const notes: string[] = [];
  const missing = coverage.filter((c) => c.by.length === 0).map((c) => c.skill);
  if (missing.length) notes.push(`Не хватило специалистов: ${missing.join(', ')}.`);
  if (badHealth) notes.push(`Проблемы со здоровьем у ${badHealth} из ${survivors.length} выживших.`);
  if (resources < 0.4) notes.push('Запасов и снаряжения мало — зимовка будет тяжёлой.');
  if (overcrowd) notes.push(`Бункер переполнен: ${survivors.length} человек на ${slots} мест.`);
  if (!survivors.length) notes.push('В убежище никого не осталось.');

  const headline =
    verdict === 'survived'
      ? 'Убежище выстояло'
      : verdict === 'fragile'
        ? 'Колония на грани'
        : 'Убежище не пережило катастрофу';
  return { coverage, coveredCount, health, resources, stability, score, verdict, headline, notes };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
