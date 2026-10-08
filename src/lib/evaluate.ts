import { CATEGORIES, type Card, type Difficulty, type Hazard, type PlayerCharacter, type Scenario } from '../types';
import { rulesFor } from './difficulty';
import { plural, t } from './i18n';

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
  // Составной багаж: у каждого предмета свои способности (в том числе отключённые в конструкторе).
  if (card.items?.length) return card.items.some((item) => cardMatchesSkill(item, skill));
  if (card.tags?.some((tag) => norm(tag) === k)) return true;
  // Пользователь сознательно задал способности карты (в том числе пустые): текст описания их не заменяет.
  if (card.strictTags) return false;
  const hay = norm(`${card.title ?? ''} ${card.description}`);
  return hay.includes(stem(k));
}

/** Навыки дают профессия, биология (расы со способностями), хобби, багаж и факт. */
export const SKILL_CATEGORIES = ['profession', 'biology', 'physique', 'character', 'hobby', 'fact', 'luggage'] as const;

/** Тяжесть болезни по названию карты здоровья: критическая — 3, тяжёлая — 2, средняя — 1.5, остальные — 1. */
export function severityOf(card: Card): number {
  if (card.modifier !== 'negative') return 0;
  const text = norm(`${card.title ?? ''} ${card.description}`);
  if (text.includes('критич')) return 3;
  if (text.includes('тяжел') || text.includes('тяжёл')) return 2;
  if (text.includes('средн')) return 1.5;
  return 1;
}

const HEALING = ['медицина', 'лечение'];

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
  // Тяжёлые и критические болезни бьют сильнее; хоть один врач или лекарь смягчает каждую на единицу.
  const healers = survivors.filter((p) => SKILL_CATEGORIES.some((c) => HEALING.some((sk) => cardMatchesSkill(p.slots[c].card, sk)))).length;
  const severe = survivors.filter((p) => severityOf(p.slots.health.card) >= 2);
  const badWeight = survivors.reduce((s, p) => {
    const w = severityOf(p.slots.health.card);
    return s + (w > 1 && healers > 0 ? w - 1 : w);
  }, 0);
  const goodHealth = count('health', 'positive');
  const health = clamp01(0.6 + (goodHealth - badWeight * 1.5) / n / 2);

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
    survivors.length === 0 || fatal || skillRatio < rules.failSkill || score < rules.failScore
      ? 'failed'
      : score >= rules.winScore && skillRatio === 1 && open.length === 0
        ? 'survived'
        : 'fragile';

  const notes: string[] = [];
  const missing = coverage.filter((c) => c.by.length === 0).map((c) => c.skill);
  if (missing.length) notes.push(t('Не хватило специалистов: {skills}.', { skills: missing.join(', ') }));
  if (badHealth) notes.push(t('Проблемы со здоровьем у {bad} из {total} выживших.', { bad: badHealth, total: survivors.length }));
  if (severe.length) notes.push(healers > 0 ? t('Тяжёлых больных: {n}, но врач держит их на ногах.', { n: severe.length }) : t('Тяжёлых больных: {n}, а лечить их некому.', { n: severe.length }));
  if (resources < 0.4) notes.push(t('Запасов и снаряжения мало — зимовка будет тяжёлой.'));
  for (const r of open) {
    const lack = r.by.length ? ` ${t('(нужно {need}, есть {have})', { need: r.need, have: r.by.length })}` : '';
    const doom = r.hazard.severity === 'critical' && fatal ? ` — ${t('это гибель убежища')}` : '';
    notes.push(t('Угроза «{title}» не нейтрализована{lack}{doom}.', { title: t(r.hazard.title), lack, doom }));
  }
  if (overcrowd) {
    notes.push(
      t('Бункер переполнен: {n} {people} на {slots} {places}.', {
        n: survivors.length,
        people: plural(survivors.length, { ru: ['человек', 'человека', 'человек'], uk: ['людина', 'людини', 'людей'], en: ['person', 'people'], de: ['Person', 'Personen'] }),
        slots: slots ?? 0,
        places: plural(slots ?? 0, { ru: ['место', 'места', 'мест'], uk: ['місце', 'місця', 'місць'], en: ['place', 'places'], de: ['Platz', 'Plätze'] }),
      }),
    );
  }
  if (!survivors.length) notes.push(t('В убежище никого не осталось.'));

  const headline =
    verdict === 'survived'
      ? t('Убежище выстояло')
      : verdict === 'fragile'
        ? t('Колония на грани')
        : fatal
          ? t('Убежище погубила угроза: {title}', { title: t(criticalOpen[0].hazard.title) })
          : t('Убежище не пережило катастрофу');
  return { hazards: hazardResults, fatal, coverage, coveredCount, health, resources, stability, score, verdict, headline, notes };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
