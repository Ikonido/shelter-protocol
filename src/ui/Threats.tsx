import { Bug, ShieldCheck, Skull, TriangleAlert } from 'lucide-react';
import type { Hazard, Severity } from '../types';
import type { HazardResult } from '../lib/evaluate';

const SEV: Record<Severity, { label: string; tone: string; Icon: typeof Skull }> = {
  critical: { label: 'смертельная', tone: 'text-danger', Icon: Skull },
  major: { label: 'серьёзная', tone: 'text-amber', Icon: TriangleAlert },
  minor: { label: 'лёгкая', tone: 'text-dim', Icon: Bug },
};

/** Факторы угрозы партии: что нужно нейтрализовать и чем. Во время игры — подсказка, в финале — результат. */
export function ThreatsPanel({ hazards, results, defaultOpen = false }: { hazards: Hazard[]; results?: HazardResult[]; defaultOpen?: boolean }) {
  if (!hazards.length) return null;
  const byId = new Map(results?.map((r) => [r.hazard.id, r.by]));
  return (
    <details className="panel p-3" open={defaultOpen || !!results}>
      <summary className="cursor-pointer text-xs uppercase tracking-widest text-amber">
        Факторы угрозы ({hazards.length}) — их нужно убрать для победы
      </summary>
      <ul className="mt-3 flex flex-col gap-3">
        {hazards.map((h) => {
          const { label, tone, Icon } = SEV[h.severity];
          const by = byId.get(h.id);
          return (
            <li key={h.id} className="rounded-md border border-edge p-2 text-sm">
              <div className="flex items-center gap-2">
                <Icon size={16} className={tone} />
                <b>{h.title}</b>
                <span className={`ml-auto text-[10px] uppercase tracking-widest ${tone}`}>{label}</span>
              </div>
              {h.description && <p className="mt-1 text-xs text-dim">{h.description}</p>}
              <p className="mt-1 text-xs">
                Нейтрализуют: <span className="text-amber">{h.counters.join(', ') || '—'}</span>
              </p>
              {by && (
                <p className={`mt-1 flex items-center gap-1 text-xs ${by.length ? 'text-ok' : 'text-danger'}`}>
                  {by.length ? <><ShieldCheck size={14} /> убрана: {by.join(', ')}</> : <>✘ не нейтрализована{h.severity === 'critical' ? ' — убежище гибнет' : ''}</>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
