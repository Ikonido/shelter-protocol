import type { GameState } from '../../types';
import { isCriminal, socialOutcome } from './roles';
import type { ActivityReport, Finding, Publication, SecretPlayer, SecretRole, ThreatAudit, ThreatView } from './types';

export function threatViewFor(g: GameState, id: string): ThreatView | undefined {
  const s = g.hiddenThreat;
  if (!s) return undefined;
  const p = s.players[id];
  return {
    version: 1,
    publications: s.publications.map((p, i) => ({ ...p, id: `public-${i + 1}` })),
    reports: s.reports.map(p => ({ ...p })),
    // Uniform acknowledgements include civilian skips, never operation kinds or targets.
    ready: s.pending.map(p => p.actor),
    ...(p ? { me: { ...p, notices: [...p.notices], results: p.results.map(r => ({ ...r })), playerId: id, allies: p.role === 'mafia' ? Object.keys(s.players).filter(other => other !== id && s.players[other].role === 'mafia') : [], ...(isCriminal(p.role) ? { sabotageUses: s.sabotageUses, sabotageRound: s.sabotageRound } : {}), auxiliaryUsed: s.auxiliary.includes(`${id}:${g.round}`) || s.auxiliary.filter(k => k.startsWith(`${id}:`)).length >= 3, submitted: s.pending.some(c => c.actor === id) } } : {}),
    ...(g.phase === 'final' ? { final: { roles: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, p.role])), audit: s.audit.map(a => ({ ...a })), outcome: socialOutcome(g)! } } : {}),
  };
}

const obj = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const str = (x: unknown, max = 80) => typeof x === 'string' ? x.slice(0, max) : '';
const num = (x: unknown, max = 10000) => typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(max, Math.floor(x))) : 0;
const list = (x: unknown, max = 200): unknown[] => Array.isArray(x) ? x.slice(0, max) : [];
const role = (x: unknown): SecretRole | undefined => (['civilian', 'officer', 'maniac', 'mafia'] as const).find(r => r === x);
const direction = (x: unknown) => (['connections', 'dossier', 'actions'] as const).find(r => r === x) ?? 'dossier';
function finding(x: unknown): Finding {
  const r = obj(x);
  return { id: str(r.id), target: str(r.target, 12), round: num(r.round), direction: direction(r.direction), text: str(r.text, 600), analyzed: r.analyzed === true, ...(typeof r.evidenceId === 'string' ? { evidenceId: str(r.evidenceId) } : {}), ...(typeof r.analysis === 'string' ? { analysis: str(r.analysis, 600) } : {}) };
}
export function cleanSecretPlayer(x: unknown): SecretPlayer | undefined {
  const r = obj(x), kind = role(r.role);
  return kind ? { role: kind, points: num(r.points), checks: num(r.checks, 2), lastCheckRound: num(r.lastCheckRound), notices: list(r.notices).map(x => str(x, 600)), results: list(r.results, 2).map(finding) } : undefined;
}
export function cleanAudit(x: unknown): ThreatAudit[] {
  return list(x, 1000).map(x => {
    const r = obj(x);
    return { round: num(r.round), actor: str(r.actor, 12), kind: str(r.kind), text: str(r.text, 600), ...(typeof r.target === 'string' ? { target: str(r.target, 12) } : {}), ...(typeof r.points === 'number' ? { points: num(r.points) } : {}) };
  });
}
/** Rebuild the DTO instead of accepting untrusted host fields through a spread. */
export function sanitizeThreatView(x: unknown, final: boolean): ThreatView | undefined {
  const r = obj(x);
  if (r.version !== 1) return undefined;
  const m = obj(r.me), p = cleanSecretPlayer(m);
  const publications: Publication[] = list(r.publications, 2).map(x => {
    const f = finding(x);
    return { id: f.id, round: f.round, target: f.target, direction: f.direction, text: f.text, ...(f.analysis ? { analysis: f.analysis } : {}) };
  });
  const reports: ActivityReport[] = list(r.reports, 50).map(x => {
    const a = obj(x);
    return { round: num(a.round), active: a.active === true, ...(a.checks !== undefined ? { checks: num(a.checks, 2), sabotages: num(a.sabotages, 1) } : {}) };
  });
  const view: ThreatView = { version: 1, publications, reports, ready: list(r.ready, 12).map(x => str(x, 12)), ...(p ? { me: { ...p, playerId: str(m.playerId, 12), allies: p.role === 'mafia' ? list(m.allies, 2).map(x => str(x, 12)) : [], ...(isCriminal(p.role) ? { sabotageUses: num(m.sabotageUses, 2), sabotageRound: num(m.sabotageRound) } : {}), auxiliaryUsed: m.auxiliaryUsed === true, submitted: m.submitted === true } } : {}) };
  if (final && r.final) {
    const f = obj(r.final), roles: Record<string, SecretRole> = {};
    for (const [id, value] of Object.entries(obj(f.roles)).slice(0, 12)) { const kind = role(value); if (kind) roles[str(id, 12)] = kind; }
    const o = obj(f.outcome);
    view.final = { roles, audit: cleanAudit(f.audit), outcome: { civilians: o.civilians === true, mafia: o.mafia === true, maniac: list(o.maniac, 1).map(x => str(x, 12)) } };
  }
  return view;
}
