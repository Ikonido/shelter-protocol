import { CLASSIC_PACK } from '../../data/classicPack';
import type { GameState, SessionConfig } from '../../types';
import { createGame } from '../game';
import type { SecretOperation } from './types';
import { finishSecret, submitSecret } from './engine';
export function config(n = 4): SessionConfig {
  return { scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: [CLASSIC_PACK.id], playerCount: n, shelterSlots: 1, mode: 'pass-and-play', voting: 'secret', revealsPerVote: 1, hazardCount: 0, roundEvents: false, autoActions: true, professionPerks: false, difficulty: 'normal', speechSec: 0, timeLimitMin: 0, names: Array.from({ length: n }, (_, i) => `Candidate ${i + 1}`), seed: 741, variant: 'hidden-threat', hiddenThreat: { criminal: n >= 8 ? 'mafia' : 'maniac', report: 'hidden' } };
}
export function game(n = 4): GameState {
  const g = createGame(config(n), CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
  const crimes = n <= 7 ? 1 : n <= 9 ? 2 : 3;
  g.hiddenThreat!.players = Object.fromEntries(g.players.map((p, i) => [p.id, { ...g.hiddenThreat!.players[p.id], role: i < crimes ? n >= 8 ? 'mafia' : 'maniac' : i === crimes ? 'officer' : 'civilian' }]));
  return g;
}
export function collect(g: GameState, ops: Record<string, SecretOperation> = {}): GameState {
  let next: GameState = { ...g, phase: 'secret' };
  for (const p of next.players.filter(p => !p.isEliminated)) next = submitSecret(next, p.id, { id: `act-${g.round}-${p.id}`, round: g.round, operation: ops[p.id] ?? { kind: 'skip' } });
  return finishSecret(next);
}
export function review(g: GameState, publish: Record<string, string[]> = {}): GameState {
  let next = g;
  for (const p of next.players.filter(p => !p.isEliminated)) next = submitSecret(next, p.id, { id: `review-${g.round}-${p.id}`, round: g.round, operation: { kind: 'skip' }, ...(publish[p.id] ? { publish: publish[p.id] } : {}) });
  return finishSecret(next);
}
