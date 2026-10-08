import { useState } from 'react';
import type { GameState } from '../types';
import { t, tPacked } from '../lib/i18n';
import { threatViewFor } from '../lib/hiddenThreat/views';
import {
  DIRECTION_LABEL,
  EVIDENCE_LABEL,
  RESULT_LABEL,
  ROLE_LABEL,
} from '../lib/hiddenThreat/types';

export function ThreatPublicPanel({ game }: { game: GameState }) {
  const view = threatViewFor(game);
  if (!view) return null;
  const name = (id: string) =>
    game.players.find((p) => p.id === id)?.name ?? id;
  const report = view.public.reports.at(-1);
  return (
    <section className="panel no-print flex flex-col gap-3">
      <h2 className="h-hud">{t('Скрытая угроза')}</h2>
      <p className="text-xs text-dim">
        {t(
          'Роли скрыты до финала. Исключение — только голосованием. Находка не доказывает виновность',
        )}
      </p>
      <details>
        <summary className="cursor-pointer text-xs text-dim">
          {t('Подготовка кандидатов')}
        </summary>
        <ul className="mt-2 text-sm">
          {game.players.map((p) => (
            <li key={p.id}>
              {p.name}: {view.public.readiness[p.id] ?? 0}
            </li>
          ))}
        </ul>
      </details>
      {report && (
        <p className="text-xs text-amber">
          {report.checks !== undefined
            ? t(
                'Отчёт круга {round}: проверок {checks}, саботажей {sabotages}',
                {
                  round: report.round,
                  checks: report.checks,
                  sabotages: report.sabotages ?? 0,
                },
              )
            : t('Круг {round}: сведения об активности засекречены', {
                round: report.round,
              })}
        </p>
      )}
      {view.public.published.length > 0 && (
        <>
          <h3 className="label">{t('Опубликованные системные материалы')}</h3>
          <p className="text-xs text-dim">
            {t(
              'Источник анонимен. Устные обвинения и блеф не являются системными доказательствами',
            )}
          </p>
          {view.public.published.map((f) => (
            <article
              className="rounded border border-edge p-2 text-sm"
              key={f.id}
            >
              <b>{name(f.target)}</b> · {t(DIRECTION_LABEL[f.direction])}
              <p>{t(RESULT_LABEL[f.result])}</p>
              {f.evidence && <p>{t(EVIDENCE_LABEL[f.evidence])}</p>}
              {f.detail && <p>{t(f.detail)}</p>}
            </article>
          ))}
        </>
      )}
    </section>
  );
}

export function ThreatAuxiliary({
  game,
  actor,
  onAction,
  onCooperate,
}: {
  game: GameState;
  actor: string;
  onAction: (target: string, kind: 'aid' | 'disrupt') => void;
  onCooperate?: () => void;
}) {
  const [target, setTarget] = useState(
    game.players.find((p) => p.id !== actor && !p.isEliminated)?.id ?? '',
  );
  if (
    !game.config.hiddenThreat ||
    !game.players.some((p) => p.id === actor && !p.isEliminated)
  )
    return null;
  if (game.phase === 'event' && game.event?.kind === 'prompt' && onCooperate)
    return (
      <button className="btn" onClick={onCooperate}>
        {t('Помочь в совместном событии')}
      </button>
    );
  if (!['reveal', 'speech', 'discussion'].includes(game.phase)) return null;
  return (
    <section className="rounded border border-edge p-3 no-print">
      <h3 className="label">{t('Общие действия: доступны всем ролям')}</h3>
      <p className="mb-2 text-xs text-dim">
        {t(
          'Раз за круг: помочь или помешать подготовке другого кандидата. Каждое направление для цели — раз за партию. Поступок фиксируется в досье',
        )}
      </p>
      <select
        className="input"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      >
        {game.players
          .filter((p) => p.id !== actor && !p.isEliminated)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn btn-sm" onClick={() => onAction(target, 'aid')}>
          {t('Помочь подготовке')}
        </button>
        <button
          className="btn btn-sm"
          onClick={() => onAction(target, 'disrupt')}
        >
          {t('Помешать подготовке')}
        </button>
      </div>
    </section>
  );
}

export function ThreatFinalReport({ game }: { game: GameState }) {
  const final = game.phase === 'final' ? threatViewFor(game)?.final : undefined;
  if (!final) return null;
  const name = (id?: string) =>
    game.players.find((p) => p.id === id)?.name ?? '—';
  const winner = {
    civilian: 'Мирные победили: преступники не проникли',
    mafia: 'Мафия проникла в убежище',
    maniac: 'Маньяк проник в убежище',
    unresolved: 'Социальный исход не определён: отбор кандидатов не завершён',
  };
  const kinds = {
    sabotage: 'Саботаж',
    investigate: 'Проверка',
    analyse: 'Экспертиза',
    publish: 'Публикация',
    points: 'Начисление очков',
  };
  return (
    <section className="panel flex flex-col gap-3">
      <h2 className="h-hud">{t('Рассекреченные материалы')}</h2>
      <p className="text-amber">{t(winner[final.winner])}</p>
      <p className="text-xs text-dim">
        {t('Социальный исход и оценка выживания рассчитываются независимо')}
      </p>
      <ul className="text-sm">
        {final.roles.map((r) => (
          <li key={r.playerId}>
            {name(r.playerId)}: <b>{t(ROLE_LABEL[r.role])}</b>
          </li>
        ))}
      </ul>
      <ol className="flex flex-col gap-2 text-xs">
        {final.audit.map((a, i) => (
          <li key={i} className="rounded border border-edge p-2">
            {t('Раунд {n}', { n: a.round })} · {t(kinds[a.kind])} ·{' '}
            {name(a.actor)} → {name(a.target)}: {tPacked(a.detail)}
            {a.points ? ` (+${a.points})` : ''}
          </li>
        ))}
      </ol>
    </section>
  );
}
