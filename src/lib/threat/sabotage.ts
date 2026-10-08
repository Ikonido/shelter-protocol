import type { GameState } from '../../types';
import { packT } from '../i18n';
import { reward } from './economy';
import { EVIDENCE_LABELS } from './investigations';
import { isCriminal } from './roles';
import type { SecretOperation } from './types';

export function applySabotage(g: GameState, actor: string, op: Extract<SecretOperation, { kind: 'plant' | 'forge' }>): GameState {
  if (!g.hiddenThreat || g.phase !== 'secret' || !g.players.some(p => p.id === actor && !p.isEliminated)) return g;
  const s = g.hiddenThreat!, p = s.players[actor];
  if (!p || !isCriminal(p.role) || !g.players.some(p => p.id === op.target && !p.isEliminated && p.id !== actor)) return g;
  if (s.sabotageRound === g.round || s.sabotageUses >= 2 || (s.sabotageUses > 0 && p.points < 3)) {
    return { ...g, hiddenThreat: { ...s, players: { ...s.players, [actor]: { ...p, notices: [...p.notices, 'Командная квота саботажа уже использована. Ресурсы сохранены.'] } } } };
  }
  const evidence = { id: `evidence-${g.round}`, actor, target: op.target, round: g.round, kind: op.evidence, forged: op.kind === 'forge' };
  return { ...g, hiddenThreat: {
    ...s, sabotageUses: s.sabotageUses + 1, sabotageRound: g.round, evidence: [...s.evidence, evidence],
    players: { ...s.players, [actor]: { ...p, points: p.points - (s.sabotageUses ? 3 : 0) } },
    audit: [...s.audit, { round: g.round, actor, target: op.target, kind: op.kind, text: packT(op.kind === 'forge' ? 'Подделаны документы: {desc}' : 'Подброшена улика: {desc}', { desc: EVIDENCE_LABELS[op.evidence] }) }],
  } };
}

/** Process after checks; the stable evidence ID protects both the bonus and its private notification. */
export function rewardFraming(g: GameState): GameState {
  let cur = g;
  for (const e of g.hiddenThreat!.evidence.filter(e => e.round === g.round)) {
    const s = cur.hiddenThreat!;
    if (s.players[e.target].role !== 'officer' || s.rewarded.includes(`framed:${e.id}`)) continue;
    cur = reward(cur, e.target, `framed:${e.id}`, 1, 'Подстава полицейского', e.target);
    const next = cur.hiddenThreat!, p = next.players[e.target];
    cur = { ...cur, hiddenThreat: { ...next, players: { ...next.players, [e.target]: { ...p, notices: [...p.notices, 'Обнаружена попытка вмешательства в ваше досье. +1 очко расследования. Исполнитель неизвестен.'] } } } };
  }
  return cur;
}
