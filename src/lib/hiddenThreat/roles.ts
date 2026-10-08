import type { GameState, SessionConfig } from '../../types';
import type { HiddenThreatState, SecretRole, ThreatSettings } from './types';
import { EVIDENCE_TYPES } from './types';

export const defaultThreatSettings: ThreatSettings = {
  loneCriminal: 'maniac',
  report: 'hidden',
};
export const criminalCount = (n: number) => (n >= 10 ? 3 : n >= 8 ? 2 : 1);
export const isCriminal = (role: SecretRole) =>
  role === 'mafia' || role === 'maniac';
export function threatConfigError(n: number, slots: number): string | null {
  if (!Number.isInteger(n) || n < 4 || n > 12)
    return 'Скрытая угроза: требуется от 4 до 12 игроков';
  if (!Number.isInteger(slots) || slots < 1 || slots > n - criminalCount(n))
    return 'Слишком много мест: должна оставаться возможность исключить всех преступников';
  return null;
}
// Roles use independent cryptographic entropy, never the public character/config seed.
export function secretId(): string {
  return [...crypto.getRandomValues(new Uint32Array(4))]
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}
export function distributeRoles(
  ids: string[],
  settings: ThreatSettings,
  random: () => number = () =>
    crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
): Record<string, SecretRole> {
  const shuffled = ids.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const criminals = criminalCount(ids.length);
  const criminalRole =
    ids.length >= 8 || (ids.length >= 6 && settings.loneCriminal === 'mafia')
      ? 'mafia'
      : 'maniac';
  return Object.fromEntries(
    shuffled.map((id, i) => [
      id,
      i < criminals ? criminalRole : i === criminals ? 'police' : 'civilian',
    ]),
  );
}
export function initialThreat(g: GameState): HiddenThreatState {
  const roles = distributeRoles(
    g.players.map((p) => p.id),
    g.config.hiddenThreat ?? defaultThreatSettings,
  );
  return {
    version: 1,
    players: Object.fromEntries(
      g.players.map((p) => [
        p.id,
        {
          role: roles[p.id],
          points: 0,
          checks: 0,
          lastCheckRound: 0,
          findings: [],
          notices: [],
        },
      ]),
    ),
    // Physical archive materials are independently dealt facts, never an encoding of the secret role.
    evidence: g.players.map((p) => ({
      id: secretId(),
      target: p.id,
      type: EVIDENCE_TYPES[
        crypto.getRandomValues(new Uint32Array(1))[0] % EVIDENCE_TYPES.length
      ],
      planted: false,
      forged: false,
      round: 0,
    })),
    pending: {},
    pendingPublications: [],
    processed: [],
    resolvedRounds: [],
    sabotageUsed: 0,
    lastSabotageRound: 0,
    credited: [],
    auxiliary: [],
    activities: [],
    audit: [],
    public: {
      readiness: Object.fromEntries(g.players.map((p) => [p.id, 0])),
      published: [],
      reports: [],
      publicationsReleased: [],
    },
  };
}
export function validateThreatConfig(config: SessionConfig): void {
  if (
    !config.hiddenThreat ||
    !['maniac', 'mafia'].includes(config.hiddenThreat.loneCriminal) ||
    !['hidden', 'detailed'].includes(config.hiddenThreat.report)
  )
    throw new Error('Некорректные настройки секретных ролей');
  const error = threatConfigError(config.playerCount, config.shelterSlots);
  if (error || config.names.length !== config.playerCount)
    throw new Error(error ?? 'Неверное число кандидатов');
}
