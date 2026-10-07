import { CATEGORIES, type Card, type Difficulty, type Hazard, type PlayerCharacter, type Scenario } from '../types';
import { rulesFor } from './difficulty';

export interface SkillCoverage {
  skill: string;
  by: string[]; // имена выживших
}

export interface HazardResult {
  hazard: Hazard;
  by: string[]; // кто из выживших нейтрализует
  /** Кто именно и какой картой (для хроники). */
  via: { name: string; card: string }[];
  need: number; // сколько человек нужно (на «Кошмаре» смертельную угрозу снимают двое)
  ok: boolean;
}

export interface Evaluation {
  hazards: HazardResult[];
  /** Неснятых смертельных угроз достаточно для гибели убежища. */
  fatal: boolean;
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

/** Навыки дают профессия, биология (расы со способностями), хобби, багаж и факт. */
export const SKILL_CATEGORIES = ['profession', 'biology', 'physique', 'character', 'hobby', 'fact', 'luggage'] as const;

export function evaluate(scenario: Scenario, survivors: PlayerCharacter[], slots?: number, hazards: Hazard[] = [], difficulty?: Difficulty): Evaluation {
  const rules = rulesFor(difficulty);
  // Угроза нейтрализована, если нужное число выживших (обычно один) имеет подходящий навык/карту.
  const hazardResults: HazardResult[] = hazards.map((hazard) => {
    const via = survivors.flatMap((p) => {
      const c = SKILL_CATEGORIES.find((cat) => hazard.counters.some((sk) => cardMatchesSkill(p.slots[cat].card, sk)));
      return c ? [{ name: p.name, card: p.slots[c].card.title ?? p.slots[c].card.description }] : [];
    });
    const by = via.map((v) => v.name);
    const need = hazard.severity === 'critical' ? rules.criticalNeeds : 1;
    return { hazard, by, via, need, ok: by.length >= need };
  });
  const open = hazardResults.filter((r) => !r.ok);
  const criticalOpen = open.filter((r) => r.hazard.severity === 'critical');
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
  const score = Math.max(0, Math.round(100 * (0.6 * skillRatio + 0.15 * health + 0.15 * resources + 0.1 * stability)) - overcrowd * rules.overcrowdPenalty - open.reduce((sum, r) => sum + rules.hazardPenalty[r.hazard.severity], 0));
  // Неснятая критическая угроза — это конец; для полной победы нужно убрать вообще все факторы угрозы.
  const fatal = criticalOpen.length >= rules.fatalCriticals;
  const verdict =
    fatal || skillRatio < rules.failSkill || score < rules.failScore
      ? 'failed'
      : score >= rules.winScore && skillRatio === 1 && open.length === 0
        ? 'survived'
        : 'fragile';

  const notes: string[] = [];
  const missing = coverage.filter((c) => c.by.length === 0).map((c) => c.skill);
  if (missing.length) notes.push(`Не хватило специалистов: ${missing.join(', ')}.`);
  if (badHealth) notes.push(`Проблемы со здоровьем у ${badHealth} из ${survivors.length} выживших.`);
  if (resources < 0.4) notes.push('Запасов и снаряжения мало — зимовка будет тяжёлой.');
  for (const r of open) {
    const lack = r.by.length ? ` (нужно ${r.need}, есть ${r.by.length})` : '';
    notes.push(`Угроза «${r.hazard.title}» не нейтрализована${lack}${r.hazard.severity === 'critical' && fatal ? ' — это гибель убежища' : ''}.`);
  }
  if (overcrowd) notes.push(`Бункер переполнен: ${survivors.length} человек на ${slots} мест.`);
  if (!survivors.length) notes.push('В убежище никого не осталось.');

  const headline =
    verdict === 'survived'
      ? 'Убежище выстояло'
      : verdict === 'fragile'
        ? 'Колония на грани'
        : fatal
          ? `Убежище погубила угроза: ${criticalOpen[0].hazard.title}`
          : 'Убежище не пережило катастрофу';
  return { hazards: hazardResults, fatal, coverage, coveredCount, health, resources, stability, score, verdict, headline, notes };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
