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

export interface Scenario {
  id: string;
  title: string;
  description: string;
  shelterSlots: number; // базовый дефолт
  isolationDuration: string;
  requiredSkills: string[]; // ключевые требования (например, медицина, агрономия)
  threats: string[];
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
  names: string[];
  seed: number;
}

export type Phase = 'reveal' | 'debate' | 'vote' | 'result' | 'final';

export interface LogEntry {
  round: number;
  text: string;
}

export interface RoundResult {
  eliminated: string[];
  tally: Record<string, number>;
  tieBreak: boolean;
}

export interface GameState {
  config: SessionConfig;
  scenario: Scenario; // снимок: правка пака не ломает идущую партию
  players: PlayerCharacter[];
  round: number; // с 1
  schedule: number[]; // исключений в каждом раунде
  phase: Phase;
  revealedThisRound: string[];
  votes: Record<string, string>;
  lastResult?: RoundResult;
  log: LogEntry[];
  /** Tabletop-режим: выжившие отмечаются вручную перед финалом. */
  seed: number;
}
