import type { GameState } from '../../types';
import { packT } from '../i18n';
import { DIRECTION_LABEL, EVIDENCE_LABEL, RESULT_LABEL } from './types';

/** Collect privately; an immediate public update could identify the person holding the shared device. */
export function publishFinding(
  g: GameState,
  actor: string,
  findingId: string,
): GameState {
  const s = g.hiddenThreat,
    p = s?.players[actor];
  if (
    !s ||
    p?.role !== 'police' ||
    g.phase !== 'discussion' ||
    s.public.publicationsReleased.includes(g.round) ||
    !g.players.some((p) => p.id === actor && !p.isEliminated)
  )
    return g;
  const f = p.findings.find((f) => f.id === findingId);
  if (
    !f ||
    s.public.published.some((f) => f.id === findingId) ||
    s.pendingPublications.includes(findingId)
  )
    return g;
  return {
    ...g,
    hiddenThreat: {
      ...s,
      pendingPublications: [...s.pendingPublications, findingId],
    },
  };
}

/** One moderator-controlled batch, even when empty. No author/provenance in the public payload. */
export function releasePublications(g: GameState): GameState {
  const s = g.hiddenThreat;
  if (
    !s ||
    g.phase !== 'discussion' ||
    s.public.publicationsReleased.includes(g.round)
  )
    return g;
  const actor = Object.keys(s.players).find(
    (id) => s.players[id].role === 'police',
  )!;
  const findings = s.players[actor].findings.filter((f) =>
    s.pendingPublications.includes(f.id),
  );
  const published = findings.map((f) => {
    const { id, round, target, direction, result, evidence, detail } = f;
    return {
      id,
      round,
      target,
      direction,
      result,
      ...(evidence ? { evidence } : {}),
      ...(detail ? { detail } : {}),
    };
  });
  return {
    ...g,
    hiddenThreat: {
      ...s,
      pendingPublications: [],
      public: {
        ...s.public,
        published: [...s.public.published, ...published],
        publicationsReleased: [...s.public.publicationsReleased, g.round],
      },
      audit: [
        ...s.audit,
        ...findings.map((f) => ({
          kind: 'publish' as const,
          round: g.round,
          actor,
          target: f.target,
          detail: packT('{direction}: {result}. {evidence}', {
            direction: DIRECTION_LABEL[f.direction],
            result: RESULT_LABEL[f.result],
            evidence: f.evidence
              ? EVIDENCE_LABEL[f.evidence]
              : (f.detail ?? ''),
          }),
        })),
      ],
    },
  };
}
