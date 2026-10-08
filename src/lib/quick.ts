import type { CardPack, Difficulty, GameState, SessionConfig, VotingMode } from '../types';
import { DIFFICULTIES } from './difficulty';
import { clampConfig, createGame } from './game';
import { newSeed } from './rng';
import { t } from './i18n';

/** Что запоминается между партиями: настройки и имена игроков (только на этом устройстве). */
export interface LastSetup {
  packIds: string[];
  n: number;
  k: number;
  names: string[];
  voting: VotingMode;
  revealsPerVote: number;
  timeLimitMin: number;
  speechSec: number;
  hazardCount: number;
  difficulty: Difficulty;
  roundEvents: boolean;
  autoActions: boolean;
  scenarioId: string;
}

const KEY = 'shelter:lastSetup';
const ADULT_KEY = 'shelter:adultOk';
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'nightmare'];
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** Разбор сохранённых настроек: всё лишнее и повреждённое отбрасывается. */
export function parseLastSetup(raw: unknown): LastSetup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const packIds = Array.isArray(r.packIds) ? r.packIds.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
  if (!packIds.length) return null;
  const c = clampConfig(int(r.n, 2, 20, 6), int(r.k, 1, 19, 3));
  return {
    packIds,
    n: c.n,
    k: c.k,
    names: Array.isArray(r.names) ? r.names.slice(0, 20).map((x) => (typeof x === 'string' ? x.slice(0, 24) : '')) : [],
    voting: r.voting === 'open' ? 'open' : 'secret',
    revealsPerVote: int(r.revealsPerVote, 1, 3, 2),
    timeLimitMin: int(r.timeLimitMin, 0, 180, 45),
    speechSec: int(r.speechSec, 0, 300, 45),
    hazardCount: int(r.hazardCount, 0, 4, 2),
    difficulty: DIFFS.find((d) => d === r.difficulty) ?? 'normal',
    roundEvents: r.roundEvents === true,
    autoActions: r.autoActions === true,
    scenarioId: typeof r.scenarioId === 'string' ? r.scenarioId.slice(0, 80) : 'random',
  };
}

export function loadLastSetup(): LastSetup | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? parseLastSetup(JSON.parse(v)) : null;
  } catch {
    return null;
  }
}

export function saveLastSetup(s: LastSetup) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* приватный режим: запоминание необязательно */
  }
}

const adultOk = () => {
  try {
    return localStorage.getItem(ADULT_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * «Быстрая игра»: берёт настройки прошлой партии (или разумные по умолчанию), случайный сценарий и сразу раздаёт карты.
 * Пак 18+ попадает в быструю игру только если возраст уже подтверждался на этом устройстве.
 */
export function buildQuickGame(allPacks: CardPack[], last: LastSetup | null): GameState | null {
  const allowed = (p: CardPack) => !p.adult || adultOk();
  let packs = (last ? allPacks.filter((p) => last.packIds.includes(p.id)) : []).filter(allowed);
  if (!packs.length) packs = allPacks.slice(0, 1).filter(allowed);
  const scenarios = packs.flatMap((p) => p.scenarios);
  if (!scenarios.length) return null;
  const chosen = scenarios[Math.floor(Math.random() * scenarios.length)];
  const rules = DIFFICULTIES[last?.difficulty ?? 'normal'];
  const base = clampConfig(last?.n ?? 6, last?.k ?? Math.ceil((last?.n ?? 6) / 2));
  const k = clampConfig(base.n, chosen.shelterSlots).k;
  const config: SessionConfig = {
    scenarioId: chosen.id,
    packIds: packs.map((p) => p.id),
    playerCount: base.n,
    shelterSlots: k,
    mode: 'pass-and-play',
    voting: last?.voting ?? 'secret',
    revealsPerVote: last?.revealsPerVote ?? 2,
    speechSec: last?.speechSec ?? rules.speechSec,
    hazardCount: last?.hazardCount ?? rules.hazardCount,
    difficulty: last?.difficulty ?? 'normal',
    roundEvents: last?.roundEvents ?? false,
    autoActions: last?.autoActions ?? false,
    timeLimitMin: last?.timeLimitMin ?? rules.timeLimitMin,
    names: Array.from({ length: base.n }, (_, i) => last?.names[i]?.trim() || t('Игрок {n}', { n: i + 1 })),
    seed: newSeed(),
  };
  return createGame(config, chosen, packs);
}

/** «Сыграть ещё раз»: те же игроки и настройки, новая раздача. Недостающие паки заменяются доступными. */
export function replayGame(game: GameState, allPacks: CardPack[]): GameState | null {
  let packs = allPacks.filter((p) => game.config.packIds.includes(p.id));
  if (!packs.length) packs = allPacks.slice(0, 1);
  const scenarios = packs.flatMap((p) => p.scenarios);
  const chosen = scenarios.find((s) => s.id === game.config.scenarioId) ?? scenarios[0];
  if (!chosen) return null;
  return createGame({ ...game.config, seed: newSeed() }, chosen, packs);
}
