import { useState } from 'react';
import { Gift, MessagesSquare, Siren, UserMinus } from 'lucide-react';
import type { ActiveEvent, PlayerCharacter } from '../types';

const TONE = {
  bad: { Icon: Siren, text: 'text-danger', border: 'border-danger/60', label: 'кризис' },
  good: { Icon: Gift, text: 'text-ok', border: 'border-ok/60', label: 'удача' },
  neutral: { Icon: MessagesSquare, text: 'text-amber', border: 'border-amber/60', label: 'вопрос' },
} as const;

/**
 * Карта события раунда. Для события «доброволец» показывает кнопки вызова; `volunteers` — кто может вызваться
 * (локально все живые игроки, онлайн — только сам игрок).
 */
export function EventCard({
  round,
  event,
  volunteers,
  onVolunteer,
  action,
}: {
  round: number;
  event: ActiveEvent;
  volunteers?: PlayerCharacter[];
  onVolunteer?: (id: string) => void;
  action: React.ReactNode;
}) {
  const t = TONE[event.tone];
  const [sure, setSure] = useState<string | null>(null);
  return (
    <section className={`panel hud anim-rise flex flex-col gap-3 ${t.border}`}>
      <div className="flex items-center gap-3">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-full border ${t.border} ${t.text} bg-bg`}>
          <t.Icon size={22} className={event.tone === 'bad' ? 'animate-[var(--animate-blink)]' : ''} />
        </span>
        <div className="min-w-0">
          <p className={`text-[10px] uppercase tracking-[.3em] ${t.text}`}>Событие раунда {round} · {t.label}</p>
          <h2 className="text-lg font-bold uppercase leading-tight tracking-wider">{event.title}</h2>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-ink/90">{event.text}</p>
      {event.outcome.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-edge bg-bg p-3 text-sm">
          {event.outcome.map((o, i) => <li key={i} className={`${t.text} before:mr-2 before:content-['▸']`}>{o}</li>)}
        </ul>
      )}
      {event.kind === 'volunteer' && volunteers && volunteers.length > 0 && onVolunteer && (
        <div className="flex flex-col gap-2">
          <p className="label">Желающие уйти добровольно</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {volunteers.map((p) =>
              sure === p.id ? (
                <button key={p.id} className="btn btn-danger" onClick={() => { onVolunteer(p.id); setSure(null); }}>
                  <UserMinus size={16} /> {p.name}: точно уйти?
                </button>
              ) : (
                <button key={p.id} className="btn btn-sm normal-case" onClick={() => setSure(p.id)}>
                  <UserMinus size={14} /> {p.name} уходит
                </button>
              ),
            )}
          </div>
        </div>
      )}
      {action}
    </section>
  );
}
