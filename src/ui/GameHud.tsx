import { ArrowLeft, Check, DoorClosed, Users } from 'lucide-react';
import type { GameState } from '../types';
import { alive, perVote, stepOf } from '../lib/game';
import { rulesFor } from '../lib/difficulty';
import { t } from '../lib/i18n';

/** Полоса шагов раунда: вскрытие 1 → вскрытие 2 → голосование → итоги. */
export function PhaseSteps({ game }: { game: GameState }) {
  const n = perVote(game);
  const secret = game.config.variant === 'hidden-threat' ? 1 : 0;
  const ev = game.config.roundEvents ? 1 : 0;
  const steps = [...(ev ? [t('Событие')] : []), ...Array.from({ length: n }, (_, i) => t('Вскрытие {n}', { n: i + 1 })), ...(secret ? [t('Закрытая фаза')] : []), t('Голосование'), t('Итоги')];
  const current = game.phase === 'event' ? 0 : ['secret', 'secret-review'].includes(game.phase) ? ev + n : game.phase === 'vote' ? ev + n + secret : game.phase === 'result' ? ev + n + secret + 1 : ev + stepOf(game) - 1;
  return (
    <ol className="flex items-center gap-1 overflow-x-auto text-[10px] uppercase tracking-widest" aria-label={t('Шаги раунда')}>
      {steps.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} className="flex items-center gap-1">
            {i > 0 && <span className={`h-px w-3 ${done || now ? 'bg-amber' : 'bg-edge'}`} />}
            <span
              aria-current={now ? 'step' : undefined}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 ${
                now ? 'border-amber bg-amber/15 text-amber' : done ? 'border-ok/40 text-ok' : 'border-edge text-dim'
              }`}
            >
              {done && <Check size={10} />}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Закреплённая шапка игры: назад, сценарий, сложность, счётчики и шаги раунда. */
export function GameHud({ game, onBack, backLabel = t('Меню'), onTitle }: { game: GameState; onBack: () => void; backLabel?: string; onTitle?: () => void }) {
  const living = alive(game).length;
  const playing = game.phase !== 'final';
  return (
    <header className="no-print sticky top-0 z-30 -mx-4 border-b border-edge bg-bg/85 px-4 py-2 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <button className="btn btn-sm" onClick={onBack} aria-label={backLabel}><ArrowLeft size={16} /> <span className="hidden sm:inline">{backLabel}</span></button>
        <button className="min-w-0 flex-1 truncate text-left text-sm font-bold uppercase tracking-wider text-amber" onClick={onTitle} disabled={!onTitle}>
          {t(game.scenario.title)}
        </button>
        <span className="chip hidden sm:inline-flex">{t(rulesFor(game.config.difficulty).label)}</span>
        <span className="chip" title={t('Игроков в игре')}><Users size={11} /> <b className="text-amber">{living}</b></span>
        <span className="chip" title={t('Мест в бункере')}><DoorClosed size={11} /> <b className="text-amber">{game.config.shelterSlots}</b></span>
      </div>
      {playing && (
        <div className="mt-2 flex items-center gap-2">
          <span className="whitespace-nowrap text-[10px] uppercase tracking-widest text-dim">{t('Раунд {n}/{total}', { n: game.round, total: game.schedule.length })}</span>
          <PhaseSteps game={game} />
        </div>
      )}
    </header>
  );
}
