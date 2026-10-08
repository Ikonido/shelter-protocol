import type { GameState } from '../../types';
import { parseSecretCommand } from './engine';
import { criminalsFor, isCriminal, validateThreatConfig } from './roles';
import { EVIDENCE_KINDS } from './types';

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, max = 10000): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const str = (v: unknown): v is string => typeof v === 'string' && v.length <= 2000;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100000 && v.every(str);
const array = (v: unknown, valid: (x: unknown) => boolean) => Array.isArray(v) && v.length <= 10000 && v.every(valid);
const finding = (v: unknown) => obj(v) && str(v.id) && str(v.target) && int(v.round) && ['connections', 'dossier', 'actions'].includes(String(v.direction)) && str(v.text) && typeof v.analyzed === 'boolean' && (v.evidenceId === undefined || str(v.evidenceId)) && (v.analysis === undefined || str(v.analysis));
const secretPlayer = (v: unknown) => obj(v) && ['civilian', 'officer', 'maniac', 'mafia'].includes(String(v.role)) && int(v.points) && int(v.checks, 2) && int(v.lastCheckRound) && strings(v.notices) && array(v.results, finding) && (v.results as unknown[]).length <= 2;
const evidence = (v: unknown) => obj(v) && str(v.id) && str(v.actor) && str(v.target) && int(v.round) && EVIDENCE_KINDS.includes(v.kind as typeof EVIDENCE_KINDS[number]) && typeof v.forged === 'boolean';
const audit = (v: unknown) => obj(v) && str(v.actor) && int(v.round) && str(v.kind) && str(v.text) && (v.target === undefined || str(v.target)) && (v.points === undefined || int(v.points));
const publication = (v: unknown) => obj(v) && str(v.id) && str(v.target) && int(v.round) && ['connections', 'dossier', 'actions'].includes(String(v.direction)) && str(v.text) && (v.analysis === undefined || str(v.analysis));

/** Fail closed: never turn a projected snapshot or damaged roles into a resumable authority. */
export function validThreatSave(g: GameState): boolean {
  if (g.threatView !== undefined) return false;
  if (g.config.variant !== 'hidden-threat') return g.hiddenThreat === undefined && !['secret', 'secret-review'].includes(g.phase);
  const raw: unknown = g.hiddenThreat;
  if (!obj(raw) || raw.version !== 1 || !obj(raw.players)) return false;
  const s = raw;
  if (validateThreatConfig(g.players.length, g.config.shelterSlots, g.config.hiddenThreat!) || g.config.playerCount !== g.players.length) return false;
  const ids = g.players.map(p => p.id);
  if (new Set(ids).size !== ids.length || !ids.every(id => Object.hasOwn(raw.players as object, id)) || Object.keys(s.players as object).length !== ids.length || !Object.values(s.players as object).every(secretPlayer)) return false;
  if (!array(s.evidence, evidence) || !array(s.audit, audit) || !array(s.publications, publication) || !array(s.reports, v => obj(v) && int(v.round) && typeof v.active === 'boolean' && (v.checks === undefined || int(v.checks, 2)) && (v.sabotages === undefined || int(v.sabotages, 1)))) return false;
  if (!strings(s.processed) || new Set(s.processed).size !== s.processed.length || !strings(s.rewarded) || new Set(s.rewarded).size !== s.rewarded.length || !strings(s.auxiliary) || !int(s.sabotageUses, 2) || !int(s.sabotageRound) || !int(s.resolvedRound)) return false;
  if (!array(s.pending, v => obj(v) && ids.includes(String(v.actor)) && !!parseSecretCommand(v.command))) return false;
  const state = g.hiddenThreat!;
  if (state.sabotageUses !== state.evidence.length || state.resolvedRound > g.round || state.sabotageRound > g.round || new Set(state.pending.map(p => p.actor)).size !== state.pending.length) return false;
  if (state.pending.length && !['secret', 'secret-review'].includes(g.phase)) return false;
  if (state.pending.some(p => p.command.round !== g.round || !state.processed.includes(`${p.actor}:${p.command.id}`))) return false;
  if (state.pending.some(({ actor, command }) => {
    const p = state.players[actor], op = command.operation;
    if (g.players.find(p => p.id === actor)?.isEliminated || g.phase === 'secret-review' && op.kind !== 'skip') return true;
    if ('target' in op && (op.target === actor || !g.players.some(p => p.id === op.target && !p.isEliminated))) return true;
    if (op.kind === 'investigate' && (p.role !== 'officer' || p.checks >= 2 || p.lastCheckRound === g.round || p.checks > 0 && p.points < 3)) return true;
    if ((op.kind === 'plant' || op.kind === 'forge') && (!isCriminal(p.role) || state.sabotageUses >= 2 || state.sabotageRound === g.round || state.sabotageUses > 0 && p.points < 3)) return true;
    if (op.kind === 'analyze' && (p.role !== 'officer' || p.points < 2 || !p.results.some(r => r.id === op.findingId && r.evidenceId && !r.analyzed))) return true;
    return !!command.publish?.length && (g.phase !== 'secret-review' || p.role !== 'officer' || command.publish.some(id => !p.results.some(r => r.id === id)));
  })) return false;
  if (new Set(state.evidence.map(e => e.id)).size !== state.evidence.length || state.evidence.some(e => !ids.includes(e.actor) || !ids.includes(e.target) || e.round > g.round || !isCriminal(state.players[e.actor].role))) return false;
  if (Object.values(state.players).filter(p => p.role === 'officer').length !== 1 || Object.values(state.players).filter(p => isCriminal(p.role)).length !== criminalsFor(ids.length)) return false;
  if (ids.length < 6 && Object.values(state.players).some(p => p.role === 'mafia') || ids.length >= 8 && Object.values(state.players).some(p => p.role === 'maniac')) return false;
  return ids.every(id => {
    const p = state.players[id];
    return p.results.every(r => ids.includes(r.target) && r.round <= g.round && (!r.evidenceId || state.evidence.some(e => e.id === r.evidenceId && e.target === r.target))) && (p.role === 'officer' || p.checks === 0 && p.results.length === 0);
  });
}
