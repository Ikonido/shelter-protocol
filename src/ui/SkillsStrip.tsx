import { Target } from 'lucide-react';
import type { Scenario } from '../types';

/** Что нужно убежищу: навыки сценария и расшифровка меток карт. Всегда под рукой во время партии. */
export function SkillsStrip({ scenario }: { scenario: Scenario }) {
  return (
    <details className="panel p-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 text-xs text-dim">
        <Target size={12} className="text-amber" />
        <span className="uppercase tracking-widest">Убежищу нужны:</span>
        {scenario.requiredSkills.map((s) => <span key={s} className="chip text-amber">{s}</span>)}
      </summary>
      <ul className="mt-2 flex flex-col gap-1 text-xs text-dim">
        <li><b className="text-ok">ПЛЮС</b> у карты — сильная сторона, <b className="text-danger">МИНУС</b> — слабость, <b>НЕЙТР.</b> — ни то ни сё.</li>
        <li>Если на карте или в её описании есть нужный навык, игрок закрывает им требование сценария и угрозы.</li>
        <li>Тяжёлые болезни сильнее бьют по здоровью колонии; врач или лекарь смягчает каждую.</li>
        <li>Если мест не хватает всем, лишние выжившие снижают итоговый счёт.</li>
      </ul>
    </details>
  );
}
