import { Bug, ShieldCheck, Skull, TriangleAlert } from 'lucide-react';
import type { Hazard, Severity } from '../types';
import type { HazardResult } from '../lib/evaluate';
import { t } from '../lib/i18n';

const SEV: Record<Severity, { label: string; tone: string; Icon: typeof Skull }> = {
  critical: { label: 'смертельная', tone: 'text-danger', Icon: Skull },
  major: { label: 'серьёзная', tone: 'text-amber', Icon: TriangleAlert },
  minor: { label: 'лёгкая', tone: 'text-dim', Icon: Bug },
};

/** Факторы угрозы партии: что нужно нейтрализовать и чем. Во время игры — подсказка, в финале — результат. */
export function ThreatsPanel({ hazards, results, defaultOpen = false }: { hazards: Hazard[]; results?: HazardResult[]; defaultOpen?: boolean }) {
  if (!hazards.length) return null;
  const byId = new Map(results?.map((r) => [r.hazard.id, r.by]));
  const needById = new Map(results?.map((r) => [r.hazard.id, r.need]));
  const okById = new Map(results?.map((r) => [r.hazard.id, r.ok]));
  return (
    <details className="panel p-3" open={defaultOpen || !!results}>
      <summary className="cursor-pointer text-xs uppercase tracking-widest text-amber">
        {t('Факторы угрозы ({n}) — их нужно убрать для победы', { n: hazards.length })}
      </summary>
      <ul className="mt-3 flex flex-col gap-3">
        {hazards.map((h) => {
          const { label, tone, Icon } = SEV[h.severity];
          const by = byId.get(h.id);
          const need = needById.get(h.id) ?? 1;
          const ok = okById.get(h.id);
          return (
            <li key={h.id} className="rounded-md border border-edge p-2 text-sm">
              <div className="flex items-center gap-2">
                <Icon size={16} className={tone} />
                <b>{t(h.title)}</b>
                <span className={`ml-auto text-[10px] uppercase tracking-widest ${tone}`}>{t(label)}</span>
              </div>
              {h.description && <p className="mt-1 text-xs text-dim">{t(h.description)}</p>}
              <p className="mt-1 text-xs">
                {t('Нейтрализуют:')} <span className="text-amber">{h.counters.map((c) => t(c)).join(', ') || '—'}</span>
                {need > 1 && <span className="text-danger"> {t('· нужно {n} чел.', { n: need })}</span>}
              </p>
              {by && (
                <p className={`mt-1 flex items-center gap-1 text-xs ${ok ? 'text-ok' : 'text-danger'}`}>
                  {ok ? <><ShieldCheck size={14} /> {t('убрана: {list}', { list: by.join(', ') })}</> : <>✘ {t('не нейтрализована')}{by.length ? ` ${t('({n} из {need})', { n: by.length, need })}` : ''}{h.severity === 'critical' ? ` ${t('— смертельная угроза')}` : ''}</>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
