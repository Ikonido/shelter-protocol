import type { ReactNode } from 'react';
import {
  Briefcase,
  Dna,
  HeartPulse,
  Palette,
  Backpack,
  FileText,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { CATEGORY_LABEL, type Card, type Category } from '../types';

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  profession: Briefcase,
  biology: Dna,
  health: HeartPulse,
  hobby: Palette,
  luggage: Backpack,
  fact: FileText,
  action: Zap,
};

const MOD_STYLE: Record<NonNullable<Card['modifier']>, string> = {
  positive: 'text-ok',
  neutral: 'text-dim',
  negative: 'text-danger',
};
const MOD_LABEL = { positive: '+', neutral: '·', negative: '−' } as const;

export function ModBadge({ mod = 'neutral' }: { mod?: Card['modifier'] }) {
  return <span className={`font-bold ${MOD_STYLE[mod]}`} title={mod}>{MOD_LABEL[mod]}</span>;
}

export function CardFace({
  card,
  hidden = false,
  showMod = false,
  compact = false,
  onClick,
  selected,
  extra,
}: {
  card: Card;
  hidden?: boolean;
  showMod?: boolean;
  compact?: boolean;
  onClick?: () => void;
  selected?: boolean;
  extra?: ReactNode;
}) {
  const Icon = CATEGORY_ICON[card.category];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`print-card flex w-full flex-col gap-1 rounded-md border p-3 text-left ${
        selected ? 'border-amber bg-amber/10' : 'border-edge bg-bg'
      } ${onClick ? 'cursor-pointer hover:border-amber' : ''} ${compact ? 'min-h-0' : 'min-h-20'}`}
    >
      <span className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-dim">
        <Icon size={14} /> {CATEGORY_LABEL[card.category]}
        {showMod && !hidden && <span className="ml-auto"><ModBadge mod={card.modifier} /></span>}
      </span>
      {hidden ? (
        <span className="text-sm tracking-widest text-dim">▓▓▓▓▓ СКРЫТО ▓▓▓▓▓</span>
      ) : (
        <span className="text-sm leading-snug">
          {card.title && <b className="mr-1 text-amber">{card.title}.</b>}
          {card.description}
        </span>
      )}
      {extra}
    </Tag>
  );
}

export function Modal({ children, onClose, title }: { children: ReactNode; onClose?: () => void; title?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4" role="dialog" aria-modal>
      <div className="panel max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-b-none sm:rounded-b-lg">
        {title && <h2 className="h-hud mb-3">{title}</h2>}
        {children}
        {onClose && (
          <button className="btn btn-sm mt-4 w-full" onClick={onClose}>
            Закрыть
          </button>
        )}
      </div>
    </div>
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
