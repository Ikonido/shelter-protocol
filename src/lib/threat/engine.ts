import type { GameState } from '../../types';
import { markImmune } from '../actions';
import { packT } from '../i18n';
import { analyze, investigate } from './investigations';
import { isCriminal } from './roles';
import { applySabotage, rewardFraming } from './sabotage';
import { EVIDENCE_KINDS, type SecretCommand, type SecretOperation } from './types';

/** Strict wire parser: actor, role, balances, truth claims and unknown fields are rejected. */
export function parseSecretCommand(raw: unknown): SecretCommand | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some(k => !['id', 'round', 'operation', 'publish'].includes(k)) || typeof r.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.id) || !Number.isInteger(r.round) || (r.round as number) < 1) return null;
  const o = r.operation as Record<string, unknown>;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  let operation: SecretOperation;
  if (o.kind === 'skip' && Object.keys(o).length === 1) operation = { kind: 'skip' };
  else if (o.kind === 'investigate' && Object.keys(o).length === 3 && typeof o.target === 'string' && o.target.length <= 12 && ['connections', 'dossier', 'actions'].includes(String(o.direction))) operation = { kind: 'investigate', target: o.target, direction: o.direction as 'connections' | 'dossier' | 'actions' };
  else if ((o.kind === 'plant' || o.kind === 'forge') && Object.keys(o).length === 3 && typeof o.target === 'string' && o.target.length <= 12 && EVIDENCE_KINDS.includes(o.evidence as typeof EVIDENCE_KINDS[number])) operation = { kind: o.kind, target: o.target, evidence: o.evidence as typeof EVIDENCE_KINDS[number] };
  else if (o.kind === 'analyze' && Object.keys(o).length === 2 && typeof o.findingId === 'string' && o.findingId.length <= 80) operation = { kind: 'analyze', findingId: o.findingId };
  else return null;
  if (r.publish !== undefined && (!Array.isArray(r.publish) || r.publish.length > 2 || !r.publish.every(id => typeof id === 'string' && id.length <= 80))) return null;
  return { id: r.id, round: r.round as number, operation, ...(r.publish ? { publish: r.publish as string[] } : {}) };
}

export function submitSecret(g: GameState, actor: string, raw: unknown): GameState {
  const c = parseSecretCommand(raw), s = g.hiddenThreat;
  const p = s?.players[actor];
  if (!s || !p || !c || !['secret', 'secret-review'].includes(g.phase) || c.round !== g.round || !g.players.some(p => p.id === actor && !p.isEliminated) || (g.phase === 'secret' && s.resolvedRound >= g.round) || s.pending.some(p => p.actor === actor) || s.processed.includes(`${actor}:${c.id}`)) return g;
  const o = c.operation;
  if (g.phase === 'secret-review' && o.kind !== 'skip') return g;
  if (g.phase !== 'secret-review' && c.publish?.length) return g;
  if ('target' in o && (o.target === actor || !g.players.some(p => p.id === o.target && !p.isEliminated))) return g;
  if (o.kind === 'investigate' && (p.role !== 'officer' || p.checks >= 2 || p.lastCheckRound === g.round || (p.checks > 0 && p.points < 3))) return g;
  if ((o.kind === 'plant' || o.kind === 'forge') && (!isCriminal(p.role) || s.sabotageUses >= 2 || s.sabotageRound === g.round || (s.sabotageUses > 0 && p.points < 3))) return g;
  if (o.kind === 'analyze' && (p.role !== 'officer' || p.points < 2 || !p.results.some(r => r.id === o.findingId && r.evidenceId && !r.analyzed))) return g;
  if (c.publish?.length && (p.role !== 'officer' || c.publish.some(id => !p.results.some(r => r.id === id) || s.publications.some(r => r.id === id && r.analysis === p.results.find(f => f.id === id)?.analysis)))) return g;
  return { ...g, hiddenThreat: { ...s, pending: [...s.pending, { actor, command: c }], processed: [...s.processed, `${actor}:${c.id}`] } };
}
export const allSecretReady = (g: GameState) => !!g.hiddenThreat && g.players.filter(p => !p.isEliminated).every(p => g.hiddenThreat!.pending.some(c => c.actor === p.id));

/** Fixed seat order settles simultaneous mafia requests; only the first eligible sabotage spends anything. */
export function resolveSecret(g: GameState): GameState {
  if (!g.hiddenThreat || g.phase !== 'secret' || g.hiddenThreat.resolvedRound >= g.round || !allSecretReady(g)) return g;
  let cur = g;
  const commands = g.players.flatMap(p => g.hiddenThreat!.pending.filter(c => c.actor === p.id));
  for (const { actor, command } of commands) {
    const o = command.operation;
    if (o.kind !== 'plant' && o.kind !== 'forge') continue;
    cur = applySabotage(cur, actor, o);
  }
  for (const { actor, command } of commands) {
    const o = command.operation, s = cur.hiddenThreat!, p = s.players[actor];
    if (o.kind === 'investigate') {
      if (p.role !== 'officer' || !cur.players.some(p => p.id === o.target && !p.isEliminated && p.id !== actor) || p.checks >= 2 || p.lastCheckRound === g.round || (p.checks > 0 && p.points < 3)) continue;
      const result = investigate(cur, actor, o.target, o.direction);
      cur = { ...cur, hiddenThreat: { ...s, players: { ...s.players, [actor]: { ...p, checks: p.checks + 1, lastCheckRound: g.round, points: p.points - (p.checks ? 3 : 0), results: [...p.results, result] } }, audit: [...s.audit, { round: g.round, actor, target: o.target, kind: o.direction, text: result.text }] } };
    } else if (o.kind === 'analyze') {
      if (p.role !== 'officer') continue;
      const found = p.results.find(r => r.id === o.findingId);
      const analysis = found && analyze(cur, found);
      if (!analysis || p.points < 2) continue;
      cur = { ...cur, hiddenThreat: { ...s, players: { ...s.players, [actor]: { ...p, points: p.points - 2, results: p.results.map(r => r.id === o.findingId ? { ...r, analyzed: true, analysis } : r) } }, audit: [...s.audit, { round: g.round, actor, target: found!.target, kind: 'analysis', text: analysis }] } };
    }
  }
  // Passive award after results; never reflected in the saboteur's own response.
  cur = rewardFraming(cur);
  return { ...cur, phase: 'secret-review', hiddenThreat: { ...cur.hiddenThreat!, pending: [], resolvedRound: g.round } };
}

/** A second uniform handoff lets everyone read their results and submit an anonymous publication. */
function finishReview(g: GameState): GameState {
  if (g.phase !== 'secret-review' || !allSecretReady(g)) return g;
  let cur = g;
  const commands = g.players.flatMap(p => g.hiddenThreat!.pending.filter(c => c.actor === p.id));
  for (const { actor, command } of commands) {
    if (cur.hiddenThreat!.players[actor].role !== 'officer') continue;
    for (const id of command.publish ?? []) {
      const s = cur.hiddenThreat!, finding = s.players[actor].results.find(r => r.id === id);
      if (!finding || s.publications.some(p => p.id === id && p.analysis === finding.analysis)) continue;
      // IDs must not expose the publisher. Private finding IDs are replaced in the public DTO.
      const publication = { id, round: g.round, target: finding.target, direction: finding.direction, text: finding.text, ...(finding.analysis ? { analysis: finding.analysis } : {}) };
      cur = { ...cur, hiddenThreat: { ...s, publications: [...s.publications.filter(p => p.id !== id), publication], audit: [...s.audit, { round: g.round, actor, target: finding.target, kind: 'publish', text: finding.analysis ?? finding.text }] } };
    }
  }
  const s = cur.hiddenThreat!;
  const checks = s.audit.filter(a => a.round === g.round && ['connections', 'dossier', 'actions', 'analysis'].includes(a.kind)).length;
  const sabotages = s.evidence.filter(e => e.round === g.round).length;
  const active = checks + sabotages > 0 || s.publications.some(p => p.round === g.round);
  const detailed = g.config.hiddenThreat?.report === 'detailed';
  const report = { round: g.round, active, ...(detailed ? { checks, sabotages } : {}) };
  return { ...cur, hiddenThreat: { ...s, pending: [], resolvedRound: g.round, reports: [...s.reports, report] }, log: [...cur.log, ...(active ? [{ round: g.round, text: detailed ? packT('Активность безопасности: проверки — {checks}, саботажи — {sabotages}. Подробности засекречены.', { checks, sabotages }) : 'Зафиксирована активность в системе безопасности. Подробности засекречены.' }] : [])] };
}
export function finishSecret(g: GameState): GameState {
  if (g.phase === 'secret') return resolveSecret(g);
  const next = finishReview(g);
  if (next === g) return g;
  if ((next.schedule[next.round - 1] ?? 0) <= 0) return { ...next, phase: 'result', votes: {}, fx: undefined, lastResult: { eliminated: [], tally: Object.fromEntries(next.players.filter(p => !p.isEliminated).map(p => [p.id, 0])), tieBreak: false, noVote: true } };
  return markImmune({ ...next, phase: 'vote', votes: {} });
}
