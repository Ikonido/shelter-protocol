import type { GameState, PlayerCharacter } from '../../types';
import { mulberry32, newSeed, shuffle } from '../rng';
import type { SecretPlayer, SecretRole, SocialOutcome, ThreatConfig, ThreatState } from './types';
export const ROLE_LABELS: Record<SecretRole, string> = { civilian: 'Мирный житель', officer: 'Полицейский', maniac: 'Маньяк', mafia: 'Мафия' };

export const criminalsFor = (n: number) => n <= 7 ? 1 : n <= 9 ? 2 : 3;
export function validateThreatConfig(n: number, slots: number, config: ThreatConfig): string | null {
  if (!Number.isInteger(n) || n < 4 || n > 12) return 'Скрытая угроза: требуется от 4 до 12 игроков.';
  if (!Number.isInteger(slots) || slots < 1 || slots > n - criminalsFor(n)) return 'Недостаточно мирных кандидатов для выбранного числа мест.';
  if (!config || !['maniac', 'mafia'].includes(config.criminal) || !['hidden', 'detailed'].includes(config.report)) return 'Некорректная конфигурация секретных ролей.';
  return null;
}
export function dealRoles(players: PlayerCharacter[], config: ThreatConfig, seed = newSeed()): ThreatState {
  const order = shuffle(players.map(p => p.id), mulberry32(seed));
  const n = players.length;
  const criminal = n < 6 ? 'maniac' : n >= 8 ? 'mafia' : config.criminal;
  const roles: Record<string, SecretPlayer> = {};
  order.forEach((id, i) => {
    roles[id] = { role: i < criminalsFor(n) ? criminal : i === criminalsFor(n) ? 'officer' : 'civilian', points: 0, checks: 0, lastCheckRound: 0, notices: [], results: [] };
  });
  return { version: 1, players: roles, evidence: [], pending: [], processed: [], rewarded: [], auxiliary: [], sabotageUses: 0, sabotageRound: 0, resolvedRound: 0, audit: [], publications: [], reports: [] };
}
export const isCriminal = (role?: string) => role === 'maniac' || role === 'mafia';
export function socialOutcome(g: GameState): SocialOutcome | undefined {
  if (g.phase !== 'final') return undefined;
  if (!g.hiddenThreat) return g.threatView?.final?.outcome;
  const inside = g.players.filter(p => !p.isEliminated).map(p => p.id);
  const roles = g.hiddenThreat.players;
  return { civilians: !inside.some(id => isCriminal(roles[id]?.role)), maniac: inside.filter(id => roles[id]?.role === 'maniac'), mafia: inside.some(id => roles[id]?.role === 'mafia') };
}
