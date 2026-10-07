import type { ActiveEvent, GameState, ScenarioEvent } from '../types';
import { mulberry32 } from './rng';
import { LIMITS } from './limits';

/** Описание события: текст для игроков и «вес» по тону (на лёгкой чаще везёт, на «Кошмаре» чаще беды). */
export type EventDef = ScenarioEvent;

export const EVENTS: EventDef[] = [
  { id: 'vent', kind: 'shrink', tone: 'bad', title: 'Отказ вентиляции', text: 'Фильтры забиты, воздуха хватит на одного меньше. Мест в бункере стало на 1 меньше, и в этом раунде уйдёт на одного больше.' },
  { id: 'plague', kind: 'plague', tone: 'bad', title: 'Вспышка болезни', text: 'Кашель в коридорах. Все, у кого есть проблемы со здоровьем, обязаны открыть эту карту.' },
  { id: 'volunteer', kind: 'volunteer', tone: 'neutral', title: 'Кто готов уйти добровольно?', text: 'Срочный вопрос ко всем: если кто-то выйдет сам, ему не придётся ждать голосования, а остальным — выбирать. Герой может вызваться прямо сейчас.' },
  { id: 'leak', kind: 'leak', tone: 'bad', title: 'Утечка из архива', text: 'Кто-то выложил личные дела. Каждый обязан открыть ещё одну случайную карту.' },
  { id: 'silence', kind: 'silence', tone: 'bad', title: 'Радиомолчание', text: 'Эфир забит помехами, тянуть нельзя. Речи в этом раунде вдвое короче.' },
  { id: 'trouble', kind: 'newHazard', tone: 'bad', title: 'Новая беда', text: 'Не успели справиться с одним — случилось ещё: в игру входит дополнительный фактор угрозы.' },
  { id: 'relief', kind: 'relief', tone: 'good', title: 'Подмога', text: 'Спасатели оставили у входа припасы и инструменты: самая лёгкая из угроз снята.' },
];

const TONE_WEIGHT: Record<string, Record<ActiveEvent['tone'], number>> = {
  easy: { good: 3, neutral: 2, bad: 1 },
  normal: { good: 2, neutral: 2, bad: 2 },
  hard: { good: 1, neutral: 2, bad: 3 },
  nightmare: { good: 1, neutral: 1, bad: 4 },
};

const alivePlayers = (g: GameState) => g.players.filter((p) => !p.isEliminated);
const quota = (g: GameState) => g.schedule[g.round - 1] ?? 0;

/** Можно ли применить событие в текущем состоянии (иначе оно выпасть не может). */
export function isEligible(def: EventDef, g: GameState): boolean {
  const living = alivePlayers(g);
  switch (def.kind) {
    case 'shrink':
      return g.config.shelterSlots >= 2 && quota(g) + 1 <= living.length - 1 && living.length > g.config.shelterSlots;
    case 'plague':
      return living.some((p) => p.slots.health.card.modifier === 'negative' && !p.slots.health.isRevealed);
    case 'volunteer':
      return quota(g) >= 1 && living.length > g.config.shelterSlots + 1;
    case 'leak':
      return living.some((p) => hiddenForLeak(p, g).length > 0);
    case 'silence':
      return (g.config.speechSec ?? 0) > 0;
    case 'newHazard':
      return unusedHazards(g).length > 0 && (g.hazards?.length ?? 0) < LIMITS.maxHazardsPerGame + 2;
    case 'relief':
      return (g.hazards ?? []).some((h) => h.severity !== 'critical');
    default:
      return true;
  }
}

export const unusedHazards = (g: GameState) => {
  const active = new Set((g.hazards ?? []).map((h) => h.id));
  return (g.scenario.hazards ?? []).filter((h) => !active.has(h.id));
};

/** Какие скрытые карты может «слить» утечка (биологию в первом вскрытии не трогаем: её открывают по правилу). */
function hiddenForLeak(p: GameState['players'][number], g: GameState) {
  const cats = (['profession', 'biology', 'physique', 'character', 'health', 'hobby', 'luggage', 'fact'] as const).filter((c) => !p.slots[c].isRevealed);
  return g.round === 1 && cats.includes('biology') ? cats.filter((c) => c !== 'biology') : cats;
}

export { hiddenForLeak };

/** Выбор события без повторов, с учётом сложности и применимости. null — подходящих нет. */
export function drawEvent(g: GameState): EventDef | null {
  const used = new Set(g.usedEvents ?? []);
  // Сценарий может принести свои тематические события; иначе общие.
  const source = g.scenario.events?.length ? g.scenario.events : EVENTS;
  const pool = source.filter((e) => !used.has(e.id) && isEligible(e, g));
  if (!pool.length) return null;
  const w = TONE_WEIGHT[g.config.difficulty ?? 'normal'] ?? TONE_WEIGHT.normal;
  const weights = pool.map((e) => w[e.tone]);
  let r = mulberry32((g.seed ^ Math.imul(g.round, 0x9e3779b1) ^ 0x51ed270b) >>> 0)() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
