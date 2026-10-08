import type { ReactNode } from 'react';
import {
  Briefcase,
  Dna,
  HeartPulse,
  Palette,
  Backpack,
  FileText,
  Ruler,
  Smile,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { categoryLabel, type Card, type Category } from '../types';

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  profession: Briefcase,
  biology: Dna,
  physique: Ruler,
  character: Smile,
  health: HeartPulse,
  hobby: Palette,
  luggage: Backpack,
  fact: FileText,
  action: Zap,
};

const MOD_STYLE: Record<NonNullable<Card['modifier']>, string> = {
  positive: 'border-ok/40 bg-ok/10 text-ok',
  neutral: 'border-edge text-dim',
  negative: 'border-danger/40 bg-danger/10 text-danger',
};
const MOD_HINT = { positive: 'Плюс: сильная сторона, помогает убежищу', neutral: 'Нейтрально: ни помогает, ни вредит', negative: 'Минус: слабость, снижает шансы убежища' } as const;
const MOD_LABEL = { positive: 'плюс', neutral: 'нейтр.', negative: 'минус' } as const;

export function ModBadge({ mod = 'neutral' }: { mod?: Card['modifier'] }) {
  return <span className={`rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-widest ${MOD_STYLE[mod]}`} title={MOD_HINT[mod]}>{MOD_LABEL[mod]}</span>;
}

/** Карта персонажа: цветная полоса и иконка категории, значок «плюс/минус», «переворот» при появлении. */
export function CardFace({
  card,
  hidden = false,
  showMod = false,
  compact = false,
  onClick,
  selected,
  extra,
  flip = false,
}: {
  card: Card;
  hidden?: boolean;
  showMod?: boolean;
  compact?: boolean;
  onClick?: () => void;
  selected?: boolean;
  extra?: ReactNode;
  flip?: boolean;
}) {
  const Icon = CATEGORY_ICON[card.category];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`print-card cat-${card.category} relative flex w-full flex-col gap-1.5 overflow-hidden rounded-md border py-2.5 pl-4 pr-3 text-left transition ${flip ? 'anim-flip' : ''} ${
        selected
          ? 'border-[var(--c)] bg-[color-mix(in_srgb,var(--c)_14%,var(--color-bg))] shadow-[0_0_24px_-8px_var(--c)]'
          : 'border-edge bg-bg hover:border-[color-mix(in_srgb,var(--c)_55%,var(--color-edge))]'
      } ${onClick ? 'cursor-pointer active:scale-[.99]' : ''} ${compact ? 'min-h-0' : 'min-h-20'}`}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-[var(--c)]" style={{ opacity: hidden ? 0.35 : 1 }} />
      <span className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--c)]">
        <Icon size={14} /> {categoryLabel(card.category)}
        {showMod && !hidden && <span className="ml-auto"><ModBadge mod={card.modifier} /></span>}
      </span>
      {hidden ? (
        <span className="text-sm tracking-[.3em] text-dim">▓▓▓▓▓▓▓▓</span>
      ) : (
        <span className="text-sm leading-snug text-ink">
          {card.title && <b className="mr-1 text-[var(--c)]">{card.title}.</b>}
          {card.description}
        </span>
      )}
      {extra}
    </Tag>
  );
}

export function Modal({ children, onClose, title }: { children: ReactNode; onClose?: () => void; title?: string }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal>
      <div className="panel hud anim-rise max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-b-none sm:rounded-b-lg">
        {title && <h2 className="h-hud mb-3">{title}</h2>}
        {children}
        {onClose && (
          <button className="btn btn-sm mt-4 w-full" onClick={onClose}>
            Закрыть
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <button className="btn w-12" onClick={() => onChange(Math.max(min, value - 1))} aria-label="меньше">−</button>
        <span className="w-12 text-center text-xl text-amber">{value}</span>
        <button className="btn w-12" onClick={() => onChange(Math.min(max, value + 1))} aria-label="больше">+</button>
      </div>
    </div>
  );
}
