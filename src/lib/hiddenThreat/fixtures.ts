import { CLASSIC_PACK } from '../../data/classicPack';
import type { GameState, SessionConfig } from '../../types';
import { createGame } from '../game';
import { beginSecretRound, submitSecret } from './engine';
import { distributeRoles } from './roles';
import type { SecretOperation } from './types';
export function game(n = 4, mafia = false): GameState {
  const config: SessionConfig = {
    scenarioId: CLASSIC_PACK.scenarios[0].id,
    packIds: [CLASSIC_PACK.id],
    playerCount: n,
    shelterSlots: 1,
    mode: 'pass-and-play',
    voting: 'secret',
    revealsPerVote: 1,
    hazardCount: 0,
    roundEvents: false,
    autoActions: true,
    professionPerks: true,
    difficulty: 'normal',
    speechSec: 0,
    timeLimitMin: 0,
    names: Array.from({ length: n }, (_, i) => `Player ${i + 1}`),
    seed: 123,
    hiddenThreat: {
      loneCriminal: mafia ? 'mafia' : 'maniac',
      report: 'hidden',
    },
  };
  const g = createGame(config, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
  // Reproducible fixtures use a separately controlled role allocation, never the character seed.
  const roles = distributeRoles(
    g.players.map((p) => p.id),
    config.hiddenThreat!,
    () => 0.999,
  );
  g.hiddenThreat!.players = Object.fromEntries(
    Object.entries(g.hiddenThreat!.players).map(([id, p]) => [
      id,
      { ...p, role: roles[id] },
    ]),
  );
  g.hiddenThreat!.evidence = g.hiddenThreat!.evidence.filter(
    (e) => e.type === 'permit',
  );
  return g;
}
export const idOf = (g: GameState, role: string) =>
  Object.keys(g.hiddenThreat!.players).find(
    (id) => g.hiddenThreat!.players[id].role === role,
  )!;
export const commit = (
  g: GameState,
  actor: string,
  operation: SecretOperation,
) =>
  submitSecret(g, actor, {
    id: `command-${g.round}-${actor}`,
    round: g.round,
    operation,
  });
export function finishBatch(g: GameState): GameState {
  let next = g;
  for (const p of g.players.filter((p) => !p.isEliminated))
    if (!next.hiddenThreat!.pending[p.id] && next.phase === 'secret')
      next = commit(next, p.id, { kind: 'pass' });
  return next;
}
export const round = (g: GameState, n: number) =>
  beginSecretRound({ ...g, round: n, phase: 'reveal' });
