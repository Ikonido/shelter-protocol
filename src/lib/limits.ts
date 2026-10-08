/** Жёсткие ограничения на размер текста: пак должен оставаться лёгким (ссылка, localStorage, сеть). */
export const LIMITS = {
  packName: 60,
  packDescription: 300,
  scenarios: 12,
  scenarioTitle: 60,
  scenarioDescription: 400,
  scenarioDuration: 30,
  skills: 8,
  skillLen: 24,
  threats: 6,
  threatLen: 80,
  hazards: 8,
  hazardTitle: 40,
  hazardDescription: 160,
  hazardCounters: 4,
  hazardStory: 160,
  maxHazardsPerGame: 4,
  /** Сколько угроз может быть в партии одновременно: стартовые плюс те, что добавляют события раунда. */
  maxHazardsActive: 6,
  events: 12,
  eventTitle: 60,
  eventText: 300,
  cardDescription: 240,
  cardTitle: 40,
  cardTags: 5,
  tagLen: 24,
  cardsPerCategory: 120,
  tagOverrides: 1000,
} as const;

export const clip = (s: string, max: number) => s.slice(0, max);

/** Список строк с ограничением числа элементов и длины каждого. */
export const clipList = (items: string[], maxItems: number, maxLen: number) =>
  items.map((s) => clip(s.trim(), maxLen)).filter(Boolean).slice(0, maxItems);
