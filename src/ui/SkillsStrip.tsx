import { Target } from 'lucide-react';
import type { Scenario } from '../types';
import { t } from '../lib/i18n';

/** Что нужно убежищу: навыки сценария и расшифровка меток карт. Всегда под рукой во время партии. */
export function SkillsStrip({ scenario }: { scenario: Scenario }) {
  return (
    <details className="panel p-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 text-xs text-dim">
        <Target size={12} className="text-amber" />
        <span className="uppercase tracking-widest">{t('Убежищу нужны:')}</span>
        {scenario.requiredSkills.map((s) => <span key={s} className="chip text-amber">{t(s)}</span>)}
      </summary>
      <ul className="mt-2 flex flex-col gap-1 text-xs text-dim">
        <li><b className="text-ok">{t('ПЛЮС')}</b> {t('у карты — сильная сторона,')} <b className="text-danger">{t('МИНУС')}</b> {t('— слабость,')} <b>{t('НЕЙТР.')}</b> {t('— ни то ни сё.')}</li>
        <li>{t('Если на карте или в её описании есть нужный навык, игрок закрывает им требование сценария и угрозы.')}</li>
        <li>{t('Тяжёлые болезни сильнее бьют по здоровью колонии; врач или лекарь смягчает каждую.')}</li>
        <li>{t('Если мест не хватает всем, лишние выжившие снижают итоговый счёт.')}</li>
      </ul>
    </details>
  );
}
