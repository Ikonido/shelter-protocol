import type { GameState } from '../../types';
import { packT } from '../i18n';
import { credit } from './economy';
import { analyse, investigate } from './evidence';
import { isCriminal, secretId } from './roles';
import {
  DIRECTIONS,
  DIRECTION_LABEL,
  DOCUMENT_TYPES,
  EVIDENCE_TYPES,
  EVIDENCE_LABEL,
  RESULT_LABEL,
  type SecretCommand,
  type SecretOperation,
} from './types';

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
/** Strict command whitelist. Identity, roles, balances and outcomes are never accepted from the wire. */
export function parseSecretCommand(raw: unknown): SecretCommand | null {
  const r = object(raw),
    op = object(r.operation);
  if (
    typeof r.id !== 'string' ||
    r.id.length < 8 ||
    r.id.length > 80 ||
    !Number.isInteger(r.round) ||
    Number(r.round) < 1 ||
    Number(r.round) > 8
  )
    return null;
  let operation: SecretOperation;
  if (op.kind === 'pass') operation = { kind: 'pass' };
  else if (
    op.kind === 'investigate' &&
    typeof op.target === 'string' &&
    DIRECTIONS.includes(op.direction as never)
  )
    operation = {
      kind: 'investigate',
      target: op.target.slice(0, 12),
      direction: op.direction as 'connections' | 'dossier' | 'actions',
    };
  else if (
    op.kind === 'sabotage' &&
    typeof op.target === 'string' &&
    (op.method === 'plant' || op.method === 'forge') &&
    (op.method === 'forge' ? DOCUMENT_TYPES : EVIDENCE_TYPES).includes(
      op.evidence as never,
    )
  )
    operation = {
      kind: 'sabotage',
      target: op.target.slice(0, 12),
      method: op.method,
      evidence: op.evidence as (typeof EVIDENCE_TYPES)[number],
    };
  else if (
    op.kind === 'analyse' &&
    typeof op.finding === 'string' &&
    op.finding.length <= 80
  )
    operation = { kind: 'analyse', finding: op.finding };
  else return null;
  return { id: r.id, round: Number(r.round), operation };
}

export function secretCommandError(
  g: GameState,
  actor: string,
  command: SecretCommand,
): string | null {
  const s = g.hiddenThreat,
    p = s?.players[actor],
    op = command.operation;
  if (
    !s ||
    !p ||
    g.phase !== 'secret' ||
    command.round !== g.round ||
    !g.players.some((p) => p.id === actor && !p.isEliminated)
  )
    return 'Сейчас секретное действие недоступно';
  if (op.kind === 'pass') return null;
  if (
    'target' in op &&
    (op.target === actor ||
      !g.players.some((p) => p.id === op.target && !p.isEliminated))
  )
    return 'Выберите другого живого кандидата';
  if (
    op.kind === 'investigate' &&
    (p.role !== 'police' ||
      p.checks >= 2 ||
      p.lastCheckRound === g.round ||
      (p.checks > 0 && p.points < 3))
  )
    return 'Проверка недоступна: лимит или недостаточно очков';
  if (
    op.kind === 'sabotage' &&
    (!isCriminal(p.role) ||
      s.sabotageUsed >= 2 ||
      s.lastSabotageRound === g.round ||
      (s.sabotageUsed > 0 && p.points < 3))
  )
    return 'Саботаж недоступен: командный лимит или недостаточно очков';
  if (op.kind === 'analyse') {
    const f = p.findings.find((f) => f.id === op.finding);
    if (
      p.role !== 'police' ||
      p.points < 2 ||
      !f?.evidenceId ||
      f.analysed ||
      !s.evidence.some((e) => e.id === f.evidenceId)
    )
      return 'Для экспертизы нужен найденный материал и 2 очка';
  }
  return null;
}

export function beginSecretRound(g: GameState): GameState {
  if (
    !g.hiddenThreat ||
    g.phase === 'secret' ||
    g.hiddenThreat.resolvedRounds.includes(g.round)
  )
    return g;
  return {
    ...g,
    phase: 'secret',
    votes: {},
    speechEndsAt: undefined,
    hiddenThreat: { ...g.hiddenThreat, pending: {} },
  };
}

export function submitSecret(
  g: GameState,
  actor: string,
  raw: unknown,
): GameState {
  const command = parseSecretCommand(raw),
    s = g.hiddenThreat;
  if (
    !command ||
    !s ||
    s.pending[actor] ||
    s.processed.includes(`${actor}:${command.id}`) ||
    secretCommandError(g, actor, command)
  )
    return g;
  const next = {
    ...g,
    hiddenThreat: {
      ...s,
      pending: { ...s.pending, [actor]: command },
      processed: [...s.processed, `${actor}:${command.id}`],
    },
  };
  return g.players
    .filter((p) => !p.isEliminated)
    .every((p) => !!next.hiddenThreat.pending[p.id])
    ? resolveSecretRound(next)
    : next;
}

/** Resolve the complete batch in a fixed order. Simultaneous mafia requests never consume two slots.
 * The earliest player in roster order wins the shared slot; packet arrival order cannot choose the result. */
export function resolveSecretRound(g: GameState): GameState {
  if (
    !g.hiddenThreat ||
    g.phase !== 'secret' ||
    g.hiddenThreat.resolvedRounds.includes(g.round)
  )
    return g;
  let s = g.hiddenThreat;
  const entries = g.players
    .filter((p) => !p.isEliminated)
    .flatMap((p) =>
      s.pending[p.id] ? [{ actor: p.id, command: s.pending[p.id] }] : [],
    );
  if (entries.length !== g.players.filter((p) => !p.isEliminated).length)
    return g;
  const bonus: { actor: string; evidenceId: string }[] = [];
  let sabotages = 0,
    checks = 0;
  for (const { actor, command } of entries) {
    const op = command.operation;
    if (op.kind !== 'sabotage') continue;
    const p = s.players[actor];
    if (
      s.lastSabotageRound === g.round ||
      s.sabotageUsed >= 2 ||
      (s.sabotageUsed > 0 && p.points < 3)
    ) {
      s = {
        ...s,
        players: {
          ...s.players,
          [actor]: {
            ...p,
            notices: [
              ...p.notices,
              'Командная квота саботажа уже использована; ресурсы не потрачены',
            ],
          },
        },
      };
      continue;
    }
    const e = {
      id: secretId(),
      target: op.target,
      type: op.evidence,
      planted: op.method === 'plant',
      forged: op.method === 'forge',
      actor,
      round: g.round,
    };
    s = {
      ...s,
      players: {
        ...s.players,
        [actor]: { ...p, points: p.points - (s.sabotageUsed > 0 ? 3 : 0) },
      },
      evidence: [...s.evidence, e],
      sabotageUsed: s.sabotageUsed + 1,
      lastSabotageRound: g.round,
      audit: [
        ...s.audit,
        {
          kind: 'sabotage',
          round: g.round,
          actor,
          target: op.target,
          detail: packT('{action}: {evidence}', {
            action:
              op.method === 'plant'
                ? 'Подброшена улика'
                : 'Подделаны документы',
            evidence: EVIDENCE_LABEL[op.evidence],
          }),
        },
      ],
    };
    if (e.planted && s.players[op.target].role === 'police')
      bonus.push({ actor: op.target, evidenceId: e.id });
    s = {
      ...s,
      activities: [
        ...s.activities,
        {
          round: g.round,
          actor,
          target: op.target,
          kind: 'harm',
          detail: 'Зафиксировано вмешательство в архив',
        },
      ],
    };
    sabotages++;
  }
  for (const { actor, command } of entries) {
    const p = s.players[actor],
      op = command.operation;
    if (op.kind === 'investigate') {
      const f = investigate(s, op.target, op.direction, g.round);
      s = {
        ...s,
        players: {
          ...s.players,
          [actor]: {
            ...p,
            points: p.points - (p.checks > 0 ? 3 : 0),
            checks: p.checks + 1,
            lastCheckRound: g.round,
            findings: [...p.findings, f],
          },
        },
        audit: [
          ...s.audit,
          {
            kind: 'investigate',
            round: g.round,
            actor,
            target: op.target,
            detail: packT('{direction}: {result}. {evidence}', {
              direction: DIRECTION_LABEL[op.direction],
              result: RESULT_LABEL[f.result],
              evidence: f.evidence
                ? EVIDENCE_LABEL[f.evidence]
                : (f.detail ?? ''),
            }),
          },
        ],
      };
      checks++;
    }
  }
  for (const { actor, command } of entries) {
    const p = s.players[actor],
      op = command.operation;
    if (op.kind !== 'analyse') continue;
    const original = p.findings.find((f) => f.id === op.finding)!;
    const f = analyse(s, original, g.round);
    s = {
      ...s,
      players: {
        ...s.players,
        [actor]: {
          ...p,
          points: p.points - 2,
          findings: [
            ...p.findings.map((a) =>
              a.id === original.id ? { ...a, analysed: true } : a,
            ),
            f,
          ],
        },
      },
      audit: [
        ...s.audit,
        {
          kind: 'analyse',
          round: g.round,
          actor,
          target: f.target,
          detail: RESULT_LABEL[f.result],
        },
      ],
    };
  }
  // Passive bonuses cannot finance a command that was unaffordable when committed.
  for (const b of bonus) {
    s = credit(
      s,
      b.actor,
      `framed:${b.evidenceId}`,
      1,
      'Подстава полицейского',
      g.round,
      b.actor,
    );
    const p = s.players[b.actor];
    s = {
      ...s,
      players: {
        ...s.players,
        [b.actor]: {
          ...p,
          notices: [
            ...p.notices,
            'Попытка вмешательства в ваше досье: +1 очко. Источник неизвестен',
          ],
        },
      },
    };
  }
  const report = {
    round: g.round,
    ...(g.config.hiddenThreat?.report === 'detailed'
      ? { checks, sabotages }
      : {}),
  };
  const log =
    checks || sabotages
      ? [
          ...g.log,
          {
            round: g.round,
            text: 'Зафиксирована активность в системе безопасности. Подробности засекречены',
          },
        ]
      : g.log;
  s = {
    ...s,
    resolvedRounds: [...s.resolvedRounds, g.round],
    pending: {},
    public: { ...s.public, reports: [...s.public.reports, report] },
  };
  return { ...g, phase: 'discussion', hiddenThreat: s, log };
}

export { publishFinding, releasePublications } from './publication';
