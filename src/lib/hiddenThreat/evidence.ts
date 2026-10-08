import type { HiddenThreatState, Finding, Investigation } from './types';
import { secretId } from './roles';

/** Returns observable facts, never raw evidence provenance or the target's role. */
export function investigate(
  s: HiddenThreatState,
  target: string,
  direction: Investigation,
  round: number,
): Finding {
  const base = { id: secretId(), target, direction, round };
  if (direction === 'connections') {
    const forgery = s.evidence
      .slice()
      .reverse()
      .find((e) => e.target === target && e.forged);
    return {
      ...base,
      result:
        forgery || s.players[target].role === 'mafia' ? 'links' : 'no-links',
      ...(forgery ? { evidenceId: forgery.id } : {}),
    };
  }
  if (direction === 'dossier') {
    const materials = s.evidence.filter((e) => e.target === target);
    const e =
      materials
        .slice()
        .reverse()
        .find((e) => e.planted || e.forged || e.type !== 'permit') ??
      materials[0];
    return e
      ? { ...base, result: 'material', evidence: e.type, evidenceId: e.id }
      : { ...base, result: 'no-material' };
  }
  const act = s.activities
    .slice()
    .reverse()
    .find((a) => a.actor === target && a.kind === 'harm');
  return act
    ? { ...base, result: 'activity', detail: act.detail }
    : { ...base, result: 'no-activity' };
}
export function analyse(
  s: HiddenThreatState,
  finding: Finding,
  round: number,
): Finding {
  const e = s.evidence.find((e) => e.id === finding.evidenceId)!;
  return {
    ...finding,
    id: secretId(),
    round,
    result: e.forged || e.planted ? 'tampered' : 'genuine',
    analysed: true,
  };
}
