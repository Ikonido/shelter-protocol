import type { GameState } from '../../types';
import { t, tPacked } from '../i18n';
import { threatViewFor } from './projection';
import type { ThreatAudit } from './types';
import { ROLE_LABELS } from './roles';
export function auditLabel(a: ThreatAudit): string {
  const labels: Record<string, string> = { plant: 'Подброшена улика', forge: 'Подмена документов', connections: 'Проверка связей', dossier: 'Проверка досье', actions: 'Проверка действий', analysis: 'Повторная экспертиза', publish: 'Публикация улики', points: 'Начисление очков' };
  return t(labels[a.kind] ?? 'Подозрительный поступок');
}
export function declassifiedLines(g: GameState): string[] {
  if (g.phase !== 'final') return [];
  const f = g.threatView?.final ?? threatViewFor(g, '')?.final;
  if (!f) return [];
  const name = (id?: string) => g.players.find(p => p.id === id)?.name ?? '';
  return [t(f.outcome.civilians ? 'Мирные победили: преступники не проникли.' : f.outcome.mafia ? 'Мафия проникла в убежище.' : 'Маньяк проник в убежище.'), ...g.players.map(p => `${p.name}: ${t(ROLE_LABELS[f.roles[p.id]])}`), ...f.audit.map(a => `[${a.round}] ${name(a.actor)}${a.target ? ` → ${name(a.target)}` : ''} · ${auditLabel(a)}: ${tPacked(a.text)}${a.points ? ` (+${a.points})` : ''}`)];
}
