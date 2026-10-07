export type Category =
  | 'profession'
  | 'biology'
  | 'health'
  | 'hobby'
  | 'luggage'
  | 'fact'
  | 'action';

export const CATEGORIES: Category[] = [
  'profession',
  'biology',
  'health',
  'hobby',
  'luggage',
  'fact',
  'action',
];

export const CATEGORY_LABEL: Record<Category, string> = {
  profession: 'Профессия',
  biology: 'Биология',
  health: 'Здоровье',
  hobby: 'Хобби',
  luggage: 'Багаж',
  fact: 'Факт',
  action: 'Действие',
};

export type Modifier = 'positive' | 'neutral' | 'negative';

export type Severity = 'critical' | 'major' | 'minor';

/** Фактор угрозы (крысы на корабле, течь, заражённая вода…): для победы его нужно нейтрализовать. */
export interface Hazard {
  id: string;
  title: string;
  description: string;
  /** Навыки/теги карт выживших, которые нейтрализуют угрозу (достаточно одного совпадения). */
  counters: string[];
  /** critical — без нейтрализации убежище гибнет; major/minor — снижают шансы и мешают полной победе. */
  severity: Severity;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  shelterSlots: number; // базовый дефолт
  isolationDuration: string;
  requiredSkills: string[]; // ключевые требования (например, медицина, агрономия)
  threats: string[];
  /** Пул факторов угрозы; на партию выбирается случайный набор. */
  hazards?: Hazard[];
}

export interface Card {
  id: string;
  category: Category;
  title?: string; // актуально для action
  description: string;
  modifier?: Modifier;
  /** Навыки/свойства, которые карта даёт при финальной оценке (сопоставляются с requiredSkills). */
  tags?: string[];
}

export interface CardPack {
  id: string;
  name: string;
  description: string;
  isCustom?: boolean;
  scenarios: Scenario[];
  cards: Record<Category, Card[]>;
}

export interface PlayerSlot {
  card: Card;
  isRevealed: boolean; // для action — «использована»
}

export interface PlayerCharacter {
  id: string;
  name: string;
  isEliminated: boolean;
  slots: Record<Category, PlayerSlot>;
}

export type PlayMode = 'pass-and-play' | 'tabletop' | 'online';
export type VotingMode = 'secret' | 'open';

export interface SessionConfig {
  scenarioId: string;
  packIds: string[];
  playerCount: number; // N
  shelterSlots: number; // K < N
  mode: PlayMode;
  voting: VotingMode;
  /** Сколько вскрытий (у каждого — карта и речь) проходит между голосованиями. */
  revealsPerVote: number;
  /** Сколько факторов угрозы из пула сценария берётся в партию. */
  hazardCount: number;
  /** Секунд на объяснение пользы после вскрытия, 0 — без таймера (только кнопка). */
  speechSec: number;
  /** Лимит времени на партию в минутах, 0 — без лимита. */
  timeLimitMin: number;
  names: string[];
  seed: number;
}

/** reveal — ходящий открывает карту; speech — он объясняет пользу (таймер); затем следующий игрок. */
export type Phase = 'reveal' | 'speech' | 'vote' | 'result' | 'final';

export interface LogEntry {
  round: number;
  text: string;
}

export interface RoundResult {
  eliminated: string[];
  tally: Record<string, number>;
  tieBreak: boolean;
  /** Сколько игроков воздержались. */
  abstained?: number;
  /** Большинство воздержалось — никто не покидает игру. */
  skipped?: boolean;
}

export interface GameState {
  config: SessionConfig;
  scenario: Scenario; // снимок: правка пака не ломает идущую партию
  players: PlayerCharacter[];
  round: number; // с 1
  schedule: number[]; // исключений в каждом раунде
  phase: Phase;
  /** Кто уже открыл карту в текущем вскрытии (шаге раунда). */
  revealedThisRound: string[];
  /** Активные факторы угрозы этой партии (нет в старых сохранениях → пусто). */
  hazards?: Hazard[];
  /** Что открыто последним (показываем во время объяснения). */
  lastReveal?: { playerId: string; category: Category };
  /** Когда закончится речь ходящего (мс, часы хоста). */
  speechEndsAt?: number;
  /** Только в «видах» для онлайн-клиентов: сколько осталось на речь. */
  speechLeftMs?: number;
  /** Номер вскрытия внутри раунда, с 1 (нет в старых сохранениях → 1). */
  revealStep?: number;
  /** Момент окончания партии (мс, часы хоста); нет — без лимита. */
  deadline?: number;
  /** Только в «видах» для онлайн-клиентов: сколько осталось по часам хоста. */
  timeLeftMs?: number;
  votes: Record<string, string>;
  lastResult?: RoundResult;
  log: LogEntry[];
  /** Tabletop-режим: выжившие отмечаются вручную перед финалом. */
  seed: number;
}
