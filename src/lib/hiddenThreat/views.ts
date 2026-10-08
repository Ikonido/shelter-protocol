import type { GameState } from '../../types';
import { isCriminal } from './roles';
import type { HiddenThreatView, ThreatFinal } from './types';

export function threatFinal(g: GameState): ThreatFinal | undefined {
  if (g.phase !== 'final' || !g.hiddenThreat) return undefined;
  const s = g.hiddenThreat;
  const living = g.players.filter((p) => !p.isEliminated);
  const inside = living.filter((p) => isCriminal(s.players[p.id].role));
  // An extended game ending with more candidates than seats has not made the final selection.
  const winner =
    living.length > g.config.shelterSlots
      ? 'unresolved'
      : !inside.length
        ? 'civilian'
        : inside.some((p) => s.players[p.id].role === 'mafia')
          ? 'mafia'
          : 'maniac';
  return {
    roles: g.players.map((p) => ({
      playerId: p.id,
      role: s.players[p.id].role,
    })),
    winner,
    audit: s.audit.map((a) => ({ ...a })),
  };
}

export function threatViewFor(
  g: GameState,
  me?: string,
): HiddenThreatView | undefined {
  const s = g.hiddenThreat;
  if (!s) return g.threatView;
  const p = me ? s.players[me] : undefined;
  const publicState = {
    readiness: { ...s.public.readiness },
    published: s.public.published.map((f) => ({ ...f })),
    reports: s.public.reports.map((r) => ({ ...r })),
    publicationsReleased: s.public.publicationsReleased.slice(),
  };
  const final = threatFinal(g);
  return {
    version: 1,
    public: publicState,
    ...(p && me
      ? {
          mine: {
            playerId: me,
            role: p.role,
            points: p.points,
            checks: p.checks,
            lastCheckRound: p.lastCheckRound,
            findings: p.findings.map((f) => ({ ...f })),
            notices: p.notices.slice(),
            allies:
              p.role === 'mafia'
                ? g.players
                    .filter(
                      (x) => x.id !== me && s.players[x.id].role === 'mafia',
                    )
                    .map((p) => p.id)
                : [],
            ...(isCriminal(p.role)
              ? {
                  sabotageUsed: s.sabotageUsed,
                  lastSabotageRound: s.lastSabotageRound,
                }
              : {}),
            submitted: !!s.pending[me],
            queuedPublications:
              p.role === 'police' ? s.pendingPublications.slice() : [],
          },
        }
      : {}),
    ...(final ? { final } : {}),
  };
}
