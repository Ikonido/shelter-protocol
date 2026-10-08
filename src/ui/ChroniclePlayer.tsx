import { useEffect, useMemo, useRef, useState } from 'react';
import { BedDouble, DoorClosed, DoorOpen, HeartPulse, ShieldAlert, SkipForward, Users, Wrench, type LucideIcon } from 'lucide-react';
import type { GameState } from '../types';
import { buildChronicle, type ChronicleEntry, type ChronicleIcon } from '../lib/chronicle';
import { t } from '../lib/i18n';

const ICON: Record<ChronicleIcon, LucideIcon> = { door: DoorClosed, hazard: ShieldAlert, skill: Wrench, crowd: Users, health: HeartPulse, end: DoorOpen };
const TONE: Record<ChronicleEntry['tone'], { text: string; border: string; dot: string }> = {
  ok: { text: 'text-ok', border: 'border-ok/50', dot: 'bg-ok' },
  bad: { text: 'text-danger', border: 'border-danger/60', dot: 'bg-danger' },
  warn: { text: 'text-amber', border: 'border-amber/50', dot: 'bg-amber' },
  neutral: { text: 'text-dim', border: 'border-edge', dot: 'bg-dim' },
};

/** Сколько держать запись на экране: время на чтение, но не слишком долго. */
const readMs = (e: ChronicleEntry) => Math.min(4800, 1700 + e.text.length * 20);

/**
 * «Хроника изоляции»: записи появляются по очереди, угрозы «штампуются» результатом.
 * После последней — эпилог и кнопка перехода к итогу. Пропустить можно в любой момент.
 */
export function ChroniclePlayer({ game, onDone }: { game: GameState; onDone: () => void }) {
  const chronicle = useMemo(() => buildChronicle(game), [game]);
  const { entries, epilogue } = chronicle;
  const [shown, setShown] = useState(1);
  const finished = shown >= entries.length;
  const [epiShown, setEpiShown] = useState(0);
  const last = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (finished) return;
    const t = setTimeout(() => setShown((n) => n + 1), readMs(entries[shown - 1]));
    return () => clearTimeout(t);
  }, [shown, finished, entries]);

  useEffect(() => {
    if (!finished || epiShown >= epilogue.length) return;
    const t = setTimeout(() => setEpiShown((n) => n + 1), epiShown === 0 ? 900 : 1500);
    return () => clearTimeout(t);
  }, [finished, epiShown, epilogue.length]);

  useEffect(() => {
    last.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [shown, epiShown]);

  const skip = () => {
    setShown(entries.length);
    setEpiShown(epilogue.length);
  };
  const showEnd = finished && epiShown >= epilogue.length;
  const fatalNow = chronicle.fatal && finished;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-24">
      {fatalNow && <div aria-hidden className="pointer-events-none fixed inset-0 z-40 bg-danger animate-[var(--animate-flash)]" />}
      <header className="text-center">
        <p className="text-[10px] uppercase tracking-[.4em] text-dim">{game.scenario.title}</p>
        <h2 className="mt-1 text-xl font-bold uppercase tracking-[.2em] text-amber">{t('Хроника изоляции')}</h2>
      </header>

      <ol className="relative flex flex-col gap-4 border-l border-edge-hi pl-6" aria-live="polite">
        {entries.slice(0, shown).map((e, i) => {
          const tone = TONE[e.tone];
          const Icon = ICON[e.icon];
          return (
            <li key={e.id} ref={i === shown - 1 && epiShown === 0 ? last : undefined} className="anim-rise relative">
              <span aria-hidden className={`absolute -left-[31px] top-3 size-3 rounded-full ring-4 ring-bg ${tone.dot}`} />
              <p className="mb-1 text-[10px] uppercase tracking-[.25em] text-dim">{e.when}</p>
              <div className={`panel relative overflow-hidden ${tone.border}`}>
                <h3 className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wider ${tone.text}`}><Icon size={16} /> {e.title}</h3>
                <p className="mt-2 pr-16 text-sm leading-relaxed text-ink/90">{e.text}</p>
                {e.stamp && (
                  <span className={`absolute bottom-3 right-3 rotate-[-8deg] rounded border-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest animate-[var(--animate-stamp)] ${tone.text} ${tone.border}`}>
                    {e.stamp}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {finished && (
        <section className="panel hud anim-rise flex flex-col gap-2">
          <h3 className="h-hud flex items-center gap-2"><BedDouble size={14} /> {t('Эпилог')}</h3>
          {epilogue.slice(0, Math.max(1, epiShown)).map((line, i) => (
            <p key={i} ref={i === Math.max(1, epiShown) - 1 ? (last as unknown as React.RefObject<HTMLParagraphElement>) : undefined} className="anim-rise text-sm leading-relaxed">{line}</p>
          ))}
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-bg/90 p-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl gap-2">
          {showEnd ? (
            <button className="btn btn-primary flex-1" onClick={onDone}>{t('Показать итог')}</button>
          ) : (
            <button className="btn flex-1" onClick={skip}><SkipForward size={16} /> {t('Пропустить хронику')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
