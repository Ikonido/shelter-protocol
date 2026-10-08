import type { GameState } from '../../types';
import { parseSecretCommand, secretCommandError } from './engine';
import { criminalCount, isCriminal, threatConfigError } from './roles';
import {
  DIRECTIONS,
  EVIDENCE_TYPES,
  RESULTS,
  ROLES,
  type HiddenThreatView,
  type Finding,
  type ThreatPublic,
  type ThreatAudit,
} from './types';

const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number): v is number =>
  Number.isInteger(v) && Number(v) >= lo && Number(v) <= hi;
const str = (v: unknown, max = 400): v is string =>
  typeof v === 'string' && v.length <= max;
const array = (v: unknown, max: number): v is unknown[] =>
  Array.isArray(v) && v.length <= max;
const strings = (v: unknown, max: number) =>
  array(v, max) && v.every((x) => str(x));
export const validThreatSettings = (v: unknown) =>
  obj(v) &&
  ['maniac', 'mafia'].includes(String(v.loneCriminal)) &&
  ['hidden', 'detailed'].includes(String(v.report));
const finding = (v: unknown, ids: string[]): v is Finding =>
  obj(v) &&
  str(v.id, 80) &&
  int(v.round, 0, 8) &&
  ids.includes(String(v.target)) &&
  DIRECTIONS.includes(v.direction as never) &&
  RESULTS.includes(v.result as never) &&
  (v.evidence === undefined || EVIDENCE_TYPES.includes(v.evidence as never)) &&
  (v.evidenceId === undefined || str(v.evidenceId, 80)) &&
  (v.detail === undefined || str(v.detail)) &&
  (v.analysed === undefined || typeof v.analysed === 'boolean');
const audit = (v: unknown, ids: string[]): v is ThreatAudit =>
  obj(v) &&
  int(v.round, 0, 8) &&
  ['sabotage', 'investigate', 'analyse', 'publish', 'points'].includes(
    String(v.kind),
  ) &&
  str(v.detail) &&
  (v.actor === undefined || ids.includes(String(v.actor))) &&
  (v.target === undefined || ids.includes(String(v.target))) &&
  (v.points === undefined || int(v.points, 1, 2));
function publicValid(v: unknown, ids: string[]): v is ThreatPublic {
  return (
    obj(v) &&
    obj(v.readiness) &&
    Object.keys(v.readiness).length === ids.length &&
    Object.entries(v.readiness).every(
      ([id, n]) => ids.includes(id) && int(n, -2, 2),
    ) &&
    array(v.published, 24) &&
    v.published.every((f) => finding(f, ids)) &&
    array(v.publicationsReleased, 8) &&
    v.publicationsReleased.every((r) => int(r, 1, 8)) &&
    array(v.reports, 8) &&
    v.reports.every(
      (r) =>
        obj(r) &&
        int(r.round, 1, 8) &&
        (r.checks === undefined || int(r.checks, 0, 1)) &&
        (r.sabotages === undefined || int(r.sabotages, 0, 1)),
    )
  );
}

/** Reject projections, partial role sets and unknown versions, rather than 'repairing' secrets into public defaults. */
export function validSavedThreat(g: GameState): boolean {
  if (g.threatView !== undefined) return false;
  if (!g.config.hiddenThreat)
    return (
      g.hiddenThreat === undefined &&
      !['secret', 'discussion'].includes(g.phase)
    );
  if (
    !validThreatSettings(g.config.hiddenThreat) ||
    threatConfigError(g.players.length, g.config.shelterSlots) ||
    g.players.length !== g.config.playerCount ||
    !int(g.round, 1, 8)
  )
    return false;
  const raw: unknown = g.hiddenThreat;
  if (!obj(raw) || raw.version !== 1 || !obj(raw.players)) return false;
  const ids = g.players.map((p) => p.id);
  if (
    ids.some((id, i) => id !== `p${i + 1}`) ||
    Object.keys(raw.players).length !== ids.length
  )
    return false;
  for (const id of ids) {
    const p = raw.players[id];
    if (
      !obj(p) ||
      !ROLES.includes(p.role as never) ||
      !int(p.points, 0, 1000) ||
      !int(p.checks, 0, 2) ||
      !int(p.lastCheckRound, 0, g.round) ||
      !array(p.findings, 24) ||
      !p.findings.every((f) => finding(f, ids)) ||
      !strings(p.notices, 8)
    )
      return false;
    if (p.role !== 'police' && (p.checks !== 0 || p.findings.length !== 0))
      return false;
  }
  const roles = Object.values(raw.players) as {
    role: (typeof ROLES)[number];
  }[];
  if (
    roles.filter((p) => p.role === 'police').length !== 1 ||
    roles.filter((p) => isCriminal(p.role)).length !== criminalCount(ids.length)
  )
    return false;
  if (
    roles.some((p) => p.role === 'maniac') &&
    roles.some((p) => p.role === 'mafia')
  )
    return false;
  const expected =
    ids.length >= 8 ||
    (ids.length >= 6 && g.config.hiddenThreat.loneCriminal === 'mafia')
      ? 'mafia'
      : 'maniac';
  if (roles.some((p) => isCriminal(p.role) && p.role !== expected))
    return false;
  if (
    !array(raw.evidence, 16) ||
    !raw.evidence.every(
      (e) =>
        obj(e) &&
        str(e.id, 80) &&
        ids.includes(String(e.target)) &&
        EVIDENCE_TYPES.includes(e.type as never) &&
        typeof e.planted === 'boolean' &&
        typeof e.forged === 'boolean' &&
        int(e.round, 0, g.round) &&
        (e.actor === undefined || ids.includes(String(e.actor))),
    )
  )
    return false;
  if (
    !obj(raw.pending) ||
    Object.entries(raw.pending).some(
      ([id, c]) =>
        !ids.includes(id) ||
        !parseSecretCommand(c) ||
        (c as { round: number }).round !== g.round,
    )
  )
    return false;
  if (g.phase !== 'secret' && Object.keys(raw.pending).length) return false;
  if (
    !strings(raw.pendingPublications, 24) ||
    (g.phase !== 'discussion' && raw.pendingPublications.length)
  )
    return false;
  if (
    !strings(raw.processed, 120) ||
    !strings(raw.credited, 300) ||
    !strings(raw.auxiliary, 120) ||
    !array(raw.resolvedRounds, 8) ||
    !raw.resolvedRounds.every((r) => int(r, 1, g.round)) ||
    new Set(raw.resolvedRounds).size !== raw.resolvedRounds.length ||
    !int(raw.sabotageUsed, 0, 2) ||
    !int(raw.lastSabotageRound, 0, g.round)
  )
    return false;
  if (
    !array(raw.activities, 400) ||
    !raw.activities.every(
      (a) =>
        obj(a) &&
        int(a.round, 1, g.round) &&
        ids.includes(String(a.actor)) &&
        ids.includes(String(a.target)) &&
        ['help', 'harm'].includes(String(a.kind)) &&
        str(a.detail),
    )
  )
    return false;
  if (
    !array(raw.audit, 400) ||
    !raw.audit.every((a) => audit(a, ids)) ||
    !publicValid(raw.public, ids)
  )
    return false;
  if (g.phase === 'secret' && raw.resolvedRounds.includes(g.round))
    return false;
  if (g.phase === 'discussion' && !raw.resolvedRounds.includes(g.round))
    return false;
  const police = Object.values(raw.players).find(
    (p) => obj(p) && p.role === 'police',
  ) as Record<string, unknown>;
  const materials = raw.evidence as { id: string }[];
  const findings = police.findings as Finding[];
  if (
    new Set(materials.map((e) => e.id)).size !== materials.length ||
    new Set(findings.map((f) => f.id)).size !== findings.length ||
    findings.some(
      (f) => f.evidenceId && !materials.some((e) => e.id === f.evidenceId),
    )
  )
    return false;
  if (
    new Set(raw.processed).size !== raw.processed.length ||
    new Set(raw.credited).size !== raw.credited.length ||
    new Set(raw.pendingPublications).size !== raw.pendingPublications.length
  )
    return false;
  if (
    !(raw.pendingPublications as string[]).every((id) =>
      (police.findings as Finding[]).some((f) => f.id === id),
    )
  )
    return false;
  return Object.entries(raw.pending).every(([id, c]) => {
    const command = parseSecretCommand(c)!;
    return (
      (raw.processed as string[]).includes(`${id}:${command.id}`) &&
      !secretCommandError(g, id, command)
    );
  });
}

const safeFinding = (f: Finding): Finding => ({
  id: f.id,
  round: f.round,
  target: f.target,
  direction: f.direction,
  result: f.result,
  ...(f.evidence ? { evidence: f.evidence } : {}),
  ...(f.evidenceId ? { evidenceId: f.evidenceId } : {}),
  ...(f.detail ? { detail: f.detail } : {}),
  ...(f.analysed ? { analysed: true } : {}),
});
/** Rebuild every field, including nested findings. Raw host data can never revive an authoritative role map. */
export function sanitizeThreatView(
  raw: unknown,
  phase: GameState['phase'],
  ids: string[],
  me?: string,
): HiddenThreatView | undefined {
  if (!obj(raw) || raw.version !== 1 || !publicValid(raw.public, ids))
    return undefined;
  const pub = raw.public;
  const out: HiddenThreatView = {
    version: 1,
    public: {
      readiness: { ...pub.readiness },
      published: pub.published.map((f) => {
        const {
          evidenceId: _id,
          analysed: _analysed,
          ...rest
        } = safeFinding(f);
        return rest;
      }),
      publicationsReleased: pub.publicationsReleased.slice(),
      reports: pub.reports.map((r) => ({
        round: r.round,
        ...(r.checks !== undefined ? { checks: r.checks } : {}),
        ...(r.sabotages !== undefined ? { sabotages: r.sabotages } : {}),
      })),
    },
  };
  const p = raw.mine;
  if (
    obj(p) &&
    ids.includes(String(p.playerId)) &&
    (!me || p.playerId === me) &&
    ROLES.includes(p.role as never) &&
    int(p.points, 0, 1000) &&
    int(p.checks, 0, 2) &&
    int(p.lastCheckRound, 0, 8) &&
    array(p.findings, 24) &&
    p.findings.every((f) => finding(f, ids)) &&
    strings(p.notices, 8) &&
    array(p.allies, 3) &&
    p.allies.every((id) => ids.includes(String(id))) &&
    strings(p.queuedPublications, 24) &&
    typeof p.submitted === 'boolean'
  ) {
    out.mine = {
      playerId: String(p.playerId),
      role: p.role as (typeof ROLES)[number],
      points: p.points,
      checks: p.checks,
      lastCheckRound: p.lastCheckRound,
      findings: p.findings.map((f) => safeFinding(f as Finding)),
      notices: (p.notices as string[]).slice(),
      allies: p.role === 'mafia' ? (p.allies as string[]).slice() : [],
      submitted: p.submitted,
      queuedPublications:
        p.role === 'police' ? (p.queuedPublications as string[]).slice() : [],
      ...(isCriminal(p.role as never) &&
      int(p.sabotageUsed, 0, 2) &&
      int(p.lastSabotageRound, 0, 8)
        ? {
            sabotageUsed: p.sabotageUsed,
            lastSabotageRound: p.lastSabotageRound,
          }
        : {}),
    };
  }
  const f = raw.final;
  if (
    phase === 'final' &&
    obj(f) &&
    array(f.roles, 12) &&
    f.roles.length === ids.length &&
    new Set(f.roles.map((r) => (obj(r) ? r.playerId : ''))).size ===
      ids.length &&
    f.roles.every(
      (r) =>
        obj(r) &&
        ids.includes(String(r.playerId)) &&
        ROLES.includes(r.role as never),
    ) &&
    ['civilian', 'maniac', 'mafia', 'unresolved'].includes(String(f.winner)) &&
    array(f.audit, 400) &&
    f.audit.every((a) => audit(a, ids))
  )
    out.final = {
      winner: f.winner as NonNullable<HiddenThreatView['final']>['winner'],
      roles: f.roles.map((r) => ({
        playerId: String((r as Record<string, unknown>).playerId),
        role: (r as Record<string, unknown>).role as (typeof ROLES)[number],
      })),
      audit: f.audit.map((a) => ({
        round: (a as ThreatAudit).round,
        kind: (a as ThreatAudit).kind,
        detail: (a as ThreatAudit).detail,
        ...((a as ThreatAudit).actor
          ? { actor: (a as ThreatAudit).actor }
          : {}),
        ...((a as ThreatAudit).target
          ? { target: (a as ThreatAudit).target }
          : {}),
        ...((a as ThreatAudit).points
          ? { points: (a as ThreatAudit).points }
          : {}),
      })),
    };
  return out;
}
