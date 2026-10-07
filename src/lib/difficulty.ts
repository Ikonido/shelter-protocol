import type { Difficulty, Severity } from '../types';

export interface DifficultyRules {
  label: string;
  tagline: string;
  /** Что именно меняется — показывается игроку при выборе. */
  details: string[];
  /** Значения по умолчанию для настроек партии (игрок может их поменять). */
  hazardCount: number;
  speechSec: number;
  timeLimitMin: number;
  /** Очки для полной победы / ниже которых убежище гибнет. */
  winScore: number;
  failScore: number;
  /** Доля закрытых требований сценария, ниже которой убежище гибнет. */
  failSkill: number;
  hazardPenalty: Record<Severity, number>;
  overcrowdPenalty: number;
  /** Сколько разных выживших нужно, чтобы нейтрализовать смертельную угрозу. */
  criticalNeeds: number;
  /** Сколько неснятых смертельных угроз ведёт к гибели (в лёгкой одна ещё не фатальна, но мешает победе). */
  fatalCriticals: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyRules> = {
  easy: {
    label: 'Лёгкая',
    tagline: 'Для первой партии и компании с детьми',
    details: ['1 фактор угрозы', 'Одна неснятая смертельная угроза ещё не гибель', 'Победа от 65 очков', 'Речь 60 с, партия 60 мин'],
    hazardCount: 1,
    speechSec: 60,
    timeLimitMin: 60,
    winScore: 65,
    failScore: 35,
    failSkill: 0.34,
    hazardPenalty: { critical: 15, major: 7, minor: 3 },
    overcrowdPenalty: 6,
    criticalNeeds: 1,
    fatalCriticals: 2,
  },
  normal: {
    label: 'Обычная',
    tagline: 'Баланс по умолчанию',
    details: ['2 фактора угрозы', 'Смертельная угроза без ответа — гибель', 'Победа от 75 очков', 'Речь 45 с, партия 45 мин'],
    hazardCount: 2,
    speechSec: 45,
    timeLimitMin: 45,
    winScore: 75,
    failScore: 45,
    failSkill: 0.5,
    hazardPenalty: { critical: 25, major: 12, minor: 5 },
    overcrowdPenalty: 10,
    criticalNeeds: 1,
    fatalCriticals: 1,
  },
  hard: {
    label: 'Сложная',
    tagline: 'Придётся думать, кого оставлять',
    details: ['3 фактора угрозы', 'Штрафы за угрозы ×1,3', 'Победа от 80 очков', 'Речь 30 с, партия 30 мин'],
    hazardCount: 3,
    speechSec: 30,
    timeLimitMin: 30,
    winScore: 80,
    failScore: 50,
    failSkill: 0.5,
    hazardPenalty: { critical: 32, major: 16, minor: 7 },
    overcrowdPenalty: 12,
    criticalNeeds: 1,
    fatalCriticals: 1,
  },
  nightmare: {
    label: 'Кошмар',
    tagline: 'Выжить смогут единицы',
    details: ['4 фактора угрозы', 'Смертельную угрозу должны снимать двое выживших', 'Победа от 85 очков', 'Речь 20 с, партия 20 мин'],
    hazardCount: 4,
    speechSec: 20,
    timeLimitMin: 20,
    winScore: 85,
    failScore: 55,
    failSkill: 0.67,
    hazardPenalty: { critical: 40, major: 20, minor: 9 },
    overcrowdPenalty: 15,
    criticalNeeds: 2,
    fatalCriticals: 1,
  },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard', 'nightmare'];
export const rulesFor = (d?: Difficulty) => DIFFICULTIES[d ?? 'normal'] ?? DIFFICULTIES.normal;
