import { useEffect, useState, type ReactNode } from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import type { GameState } from '../types';
import { t } from '../lib/i18n';
import { secretId } from '../lib/hiddenThreat/roles';
import {
  DIRECTION_LABEL,
  DIRECTIONS,
  DOCUMENT_TYPES,
  EVIDENCE_LABEL,
  EVIDENCE_TYPES,
  RESULT_LABEL,
  ROLE_LABEL,
  type HiddenThreatView,
  type SecretCommand,
  type SecretOperation,
} from '../lib/hiddenThreat/types';

/** Closed means unmounted, not CSS-hidden. No persisted unlock. Switching owner must change the key. */
export function PrivateAccess({
  name,
  render,
}: {
  name: string;
  render: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const lock = () => setOpen(false);
    window.addEventListener('blur', lock);
    document.addEventListener('visibilitychange', lock);
    return () => {
      window.removeEventListener('blur', lock);
      document.removeEventListener('visibilitychange', lock);
    };
  }, []);
  return (
    <section className="panel no-print flex flex-col gap-3">
      {open ? (
        render(() => setOpen(false))
      ) : (
        <>
          <Lock className="text-amber" size={28} />
          <p>
            {t('Передайте устройство игроку')}{' '}
            <b className="text-amber">{name}</b>
          </p>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            {t('Это я — показать')}
          </button>
        </>
      )}
    </section>
  );
}

const goals = {
  civilian:
    'Ваша цель: исключить всех преступников и сохранить специалистов для выживания',
  police:
    'Ваша цель: помочь мирным. Проверки и публикации анонимны; они не исключают кандидатов',
  maniac: 'Ваша цель: лично попасть в убежище. Убийств нет',
  mafia: 'Ваша цель: провести хотя бы одного союзника в убежище. Убийств нет',
};

export function ThreatPrivatePanel({
  game,
  mine,
  onSubmit,
  onPublish,
  onClose,
}: {
  game: GameState;
  mine: NonNullable<HiddenThreatView['mine']>;
  onSubmit: (command: SecretCommand) => void;
  onPublish: (finding: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<SecretOperation['kind']>('pass');
  const targets = game.players.filter(
    (p) => !p.isEliminated && p.id !== mine.playerId,
  );
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  const [direction, setDirection] =
    useState<(typeof DIRECTIONS)[number]>('dossier');
  const [evidence, setEvidence] =
    useState<(typeof EVIDENCE_TYPES)[number]>('knife');
  const [method, setMethod] = useState<'plant' | 'forge'>('plant');
  const analysable = mine.findings.filter((f) => !!f.evidenceId && !f.analysed);
  const [finding, setFinding] = useState(analysable[0]?.id ?? '');
  const name = (id: string) =>
    game.players.find((p) => p.id === id)?.name ?? id;
  const living = game.players.some(
    (p) => p.id === mine.playerId && !p.isEliminated,
  );
  const canCheck =
    mine.role === 'police' &&
    mine.checks < 2 &&
    mine.lastCheckRound !== game.round &&
    (mine.checks === 0 || mine.points >= 3);
  const canSabotage =
    (mine.role === 'maniac' || mine.role === 'mafia') &&
    (mine.sabotageUsed ?? 2) < 2 &&
    mine.lastSabotageRound !== game.round &&
    (mine.sabotageUsed === 0 || mine.points >= 3);
  const canAnalyse =
    mine.role === 'police' && mine.points >= 2 && analysable.length > 0;
  const submit = () => {
    const operation: SecretOperation =
      kind === 'investigate'
        ? { kind, target, direction }
        : kind === 'sabotage'
          ? { kind, target, method, evidence }
          : kind === 'analyse'
            ? { kind, finding }
            : { kind: 'pass' };
    onSubmit({ id: secretId(), round: game.round, operation });
    onClose();
  };
  return (
    <div className="flex flex-col gap-3">
      <h2 className="h-hud flex items-center gap-2">
        <ShieldAlert size={20} /> {t(ROLE_LABEL[mine.role])}
      </h2>
      <p className="text-sm">{t(goals[mine.role])}</p>
      <p className="text-xs text-dim">
        {t(
          'Тайная роль не связана с профессией. При исключении она остаётся скрытой',
        )}
      </p>
      <p className="text-xs text-dim">
        {t(
          'Архивные материалы выдаются независимо от роли. Даже подлинная находка не доказывает вину',
        )}
      </p>
      <p className="text-amber">
        {t('Очки действия: {n}', { n: mine.points })}
      </p>
      {mine.role === 'police' && (
        <p className="text-xs">
          {t(
            'Проверки: {used}/2. Первая бесплатна, следующая стоит 3 очка. Экспертиза: 2 очка',
            { used: mine.checks },
          )}
        </p>
      )}
      {(mine.role === 'mafia' || mine.role === 'maniac') && (
        <p className="text-xs">
          {t(
            'Саботажи: {used}/2. Первый бесплатный, следующий стоит 3 очка. Один на команду за круг',
            { used: mine.sabotageUsed ?? 0 },
          )}
        </p>
      )}
      {mine.role === 'mafia' && (
        <p>
          {t('Ваши союзники: {names}', {
            names: mine.allies.map(name).join(', ') || '—',
          })}
        </p>
      )}
      {mine.notices.map((n, i) => (
        <p className="rounded border border-amber p-2 text-sm" key={i}>
          {t(n)}
        </p>
      ))}
      {game.phase === 'secret' && living && !mine.submitted ? (
        <>
          <label className="label">{t('Секретный выбор')}</label>
          <select
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as SecretOperation['kind'])}
          >
            <option value="pass">{t('Пропустить секретное действие')}</option>
            {canCheck && (
              <option value="investigate">{t('Провести проверку')}</option>
            )}
            {canSabotage && (
              <option value="sabotage">{t('Совершить саботаж')}</option>
            )}
            {canAnalyse && (
              <option value="analyse">{t('Повторная экспертиза')}</option>
            )}
          </select>
          {(kind === 'investigate' || kind === 'sabotage') && (
            <select
              className="input"
              aria-label={t('Цель')}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {targets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {kind === 'investigate' && (
            <select
              className="input"
              aria-label={t('Направление проверки')}
              value={direction}
              onChange={(e) => setDirection(e.target.value as typeof direction)}
            >
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {t(DIRECTION_LABEL[d])}
                </option>
              ))}
            </select>
          )}
          {kind === 'sabotage' && (
            <>
              <select
                className="input"
                value={method}
                onChange={(e) => {
                  const next = e.target.value as typeof method;
                  setMethod(next);
                  if (next === 'forge' && !DOCUMENT_TYPES.includes(evidence))
                    setEvidence('identity');
                }}
              >
                <option value="plant">{t('Подбросить улику')}</option>
                <option value="forge">{t('Подменить документы')}</option>
              </select>
              <select
                className="input"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value as typeof evidence)}
              >
                {(method === 'forge' ? DOCUMENT_TYPES : EVIDENCE_TYPES).map(
                  (e) => (
                    <option key={e} value={e}>
                      {t(EVIDENCE_LABEL[e])}
                    </option>
                  ),
                )}
              </select>
            </>
          )}
          {kind === 'analyse' && (
            <select
              className="input"
              value={finding}
              onChange={(e) => setFinding(e.target.value)}
            >
              {analysable.map((f) => (
                <option key={f.id} value={f.id}>
                  {name(f.target)} · {t(DIRECTION_LABEL[f.direction])} ·{' '}
                  {t(f.evidence ? EVIDENCE_LABEL[f.evidence] : 'Документы')}
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-dim">
            {t(
              'Выбор окончательный. Результаты появятся после подтверждения всех живых кандидатов',
            )}
          </p>
          <button className="btn btn-primary" onClick={submit}>
            {t('Подтвердить и скрыть')}
          </button>
        </>
      ) : mine.submitted && game.phase === 'secret' ? (
        <p>{t('Выбор принят. Ожидаем остальных')}</p>
      ) : null}
      {mine.findings.length > 0 && (
        <>
          <h3 className="label">{t('Личные материалы расследования')}</h3>
          {mine.findings.map((f) => (
            <article
              className="rounded border border-edge p-3 text-sm"
              key={f.id}
            >
              <b>{name(f.target)}</b> · {t(DIRECTION_LABEL[f.direction])} ·{' '}
              {t('Раунд {n}', { n: f.round })}
              <p>{t(RESULT_LABEL[f.result])}</p>
              {f.evidence && <p>{t(EVIDENCE_LABEL[f.evidence])}</p>}
              {f.detail && <p>{t(f.detail)}</p>}
              {game.phase === 'discussion' &&
                living &&
                !game.threatView?.public.publicationsReleased.includes(
                  game.round,
                ) &&
                !game.threatView?.public.published.some((p) => p.id === f.id) &&
                (mine.queuedPublications.includes(f.id) ? (
                  <p className="text-xs text-amber">
                    {t(
                      'Материал выбран. Хост откроет все публикации одновременно',
                    )}
                  </p>
                ) : (
                  <button
                    className="btn btn-sm mt-2"
                    onClick={() => onPublish(f.id)}
                  >
                    {t('Опубликовать анонимно')}
                  </button>
                ))}
            </article>
          ))}
        </>
      )}
      <button className="btn" onClick={onClose}>
        {t('Скрыть и передать устройство')}
      </button>
    </div>
  );
}
