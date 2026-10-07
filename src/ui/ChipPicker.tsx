import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { SkillInfo } from '../lib/vocab';
import { LIMITS } from '../lib/limits';

/**
 * Выбор навыков «чипами»: выбранные сверху (можно убрать), ниже — всё, что есть в колоде, с числом карт.
 * Красный «0» — навык никому не выдаётся, значит, победить с ним нельзя. Нового навыка можно придумать.
 */
export function ChipPicker({
  options,
  value,
  onChange,
  max,
  placeholder = 'свой навык',
}: {
  options: SkillInfo[];
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const has = (s: string) => value.some((v) => v.toLowerCase() === s.toLowerCase());
  const count = (s: string) => options.find((o) => o.skill.toLowerCase() === s.toLowerCase())?.count ?? 0;
  const full = value.length >= max;
  const add = (s: string) => {
    const t = s.trim().slice(0, LIMITS.tagLen);
    if (!t || has(t) || full) return;
    onChange([...value, t]);
  };
  const free = options.filter((o) => !has(o.skill));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-9 flex-wrap gap-1.5" aria-label="Выбрано">
        {value.length === 0 && <span className="text-xs text-dim">ничего не выбрано</span>}
        {value.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(value.filter((v) => v !== s))}
            className="inline-flex items-center gap-1 rounded-full border border-amber bg-amber/15 py-1 pl-3 pr-2 text-xs text-amber active:scale-95"
            aria-label={`Убрать «${s}»`}
          >
            {s}
            <span className={`rounded-full px-1.5 text-[10px] ${count(s) ? 'bg-bg text-ok' : 'bg-danger/20 text-danger'}`}>{count(s)}</span>
            <X size={12} />
          </button>
        ))}
      </div>
      {!full && (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-edge bg-bg p-2" aria-label="Доступные навыки">
          {free.map((o) => (
            <button key={o.skill} type="button" onClick={() => add(o.skill)} className="inline-flex items-center gap-1 rounded-full border border-edge px-3 py-1 text-xs text-ink hover:border-amber active:scale-95">
              {o.skill}
              <span className={`text-[10px] ${o.count ? 'text-dim' : 'text-danger'}`}>{o.count}</span>
            </button>
          ))}
          {free.length === 0 && <span className="text-xs text-dim">все навыки из колоды уже выбраны</span>}
        </div>
      )}
      <div className="flex gap-2">
        <input
          className="input"
          maxLength={LIMITS.tagLen}
          placeholder={full ? `не больше ${max}` : placeholder}
          disabled={full}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
              setDraft('');
            }
          }}
        />
        <button type="button" className="btn btn-sm" disabled={full || !draft.trim()} onClick={() => { add(draft); setDraft(''); }} aria-label="Добавить навык">
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}
