import type { GameState } from '../../types';
import { packT } from '../i18n';
import type { EvidenceKind, Finding, Investigation } from './types';

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = { knife: 'Нож со следами крови', identity: 'Поддельное удостоверение', messages: 'Подозрительная переписка', supplies: 'Украденные припасы', medical: 'Фальшивые медицинские записи', pass: 'Поддельный пропуск' };
export function investigate(g: GameState, actor: string, target: string, direction: Investigation): Finding {
  const s = g.hiddenThreat!;
  const found = s.evidence.find(e => e.target === target && !s.players[actor].results.some(r => r.evidenceId === e.id));
  let text: string, evidenceId: string | undefined;
  if (direction === 'connections') {
    text = s.players[target].role === 'mafia' ? 'Выявлены признаки связи с преступной организацией.' : 'Признаков связи с преступной организацией не обнаружено. Это не гарантирует невиновность.';
  } else if (direction === 'dossier') {
    text = found ? packT('В досье обнаружено: {desc}. Находка не доказывает виновность владельца.', { desc: EVIDENCE_LABELS[found.kind] }) : 'В досье не обнаружено подозрительных материалов. Это не гарантирует невиновность.';
    evidenceId = found?.id;
  } else {
    const action = s.audit.find(a => a.actor === target && a.target && (a.kind.startsWith('aux:') || a.kind.startsWith('action:') || a.kind.startsWith('perk:')));
    text = action ? 'Зафиксировано вредоносное действие. Оно не устанавливает тайную роль.' : 'Зафиксированных подозрительных поступков не обнаружено. Это не гарантирует невиновность.';
  }
  return { id: `finding-${g.round}-${actor}`, target, round: g.round, direction, text, ...(evidenceId ? { evidenceId } : {}), analyzed: false };
}
export function analyze(g: GameState, finding: Finding): string | undefined {
  if (!finding.evidenceId || finding.analyzed) return undefined;
  const evidence = g.hiddenThreat!.evidence.find(e => e.id === finding.evidenceId);
  if (!evidence) return undefined;
  return evidence.forged ? 'Экспертиза выявила подделку документов и противоречия. Исполнитель не установлен.' : 'Экспертиза выявила признаки искусственно подброшенного предмета. Исполнитель не установлен.';
}
