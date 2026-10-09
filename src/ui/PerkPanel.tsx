import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { GameState, Perk } from '../types';
import { PERK_EFFECT, canApplyPerk, perkLabel, perkNeedsTarget } from '../lib/perks';
import type { ActionParams } from '../lib/actions';
import { t, tPacked } from '../lib/i18n';
import { ActionTargetPicker } from './ActionTarget';
import { Gate } from './Gate';
import { Modal } from './bits';

/**
 * Online: show only the local player's bonus and keep the existing direct picker.
 * Pass-and-play: selecting a bonus opens the SAME target picker behind one privacy
 * gate. Applying or skipping the bonus stays in that session until it is dismissed.
 */
export function PerkPanel({
  game,
  me,
  onApply,
  onSkip,
}: {
  game: GameState;
  me?: string;
  onApply: (playerId: string, params: ActionParams) => void;
  onSkip: (playerId: string) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const perks: Perk[] = (game.perks ?? []).filter((x) => (me ? x.playerId === me : true) && game.players.some((p) => p.id === x.playerId && !p.isEliminated));
  const result = game.perkResult;
  const showResult = !!result && (me ? result.playerId === me && result.id !== dismissed : completed && result.playerId === active && result.id !== dismissed);
  const resultOwner = result && game.players.find((p) => p.id === result.playerId);
  const resultView = showResult && result && resultOwner && (
    <div className="panel flex flex-col gap-2 border-amber/60 p-3" role="status">
      <p className="text-sm">{tPacked(result.text)}</p>
      <button className="btn btn-sm self-start" onClick={() => { setDismissed(result.id); }}>{t('Понятно')}</button>
    </div>
  );
  if (perks.length === 0 && !resultView && !active) return null;

  const activePerk = perks.find((x) => x.playerId === active);
  const activePlayer = game.players.find((p) => p.id === active);
  const close = () => {
    setActive(null);
    setCompleted(false);
    setConfirmSkip(false);
  };
  const open = (id: string) => {
    setCompleted(false);
    setConfirmSkip(false);
    setActive(id);
  };
  const apply = (id: string, params: ActionParams) => {
    onApply(id, params);
    if (me) setActive(null);
    else setCompleted(true);
  };

  const bondPicker = activePerk && activePlayer && activePerk.kind === 'bond' && (
    <BondPicker
      game={game}
      actorId={activePlayer.id}
      onCancel={close}
      onConfirm={(a, b) => apply(activePlayer.id, { target: a, target2: b })}
    />
  );
  const effect = activePerk ? PERK_EFFECT[activePerk.kind] : undefined;
  const picker = activePerk && activePlayer && activePerk.kind !== 'bond' && effect && (
    <ActionTargetPicker
      game={game}
      actorId={activePlayer.id}
      effect={effect}
      title={perkLabel(activePerk.kind, activePerk.level)}
      perk
      onCancel={close}
      onConfirm={(params) => apply(activePlayer.id, params)}
    />
  );

  return (
    <section className="panel flex flex-col gap-2 border-amber/60 p-3" aria-label={t('Бонусы профессий')}>
      <h3 className="h-hud flex items-center gap-2 text-xs"><Sparkles size={14} className="text-amber" /> {t('Бонусы профессий')}</h3>
      {perks.map((perk) => {
        const owner = game.players.find((p) => p.id === perk.playerId)!;
        const ready = perkNeedsTarget(perk.kind) || canApplyPerk(game, perk.playerId, {}).ok;
        const reason = !ready ? canApplyPerk(game, perk.playerId, {}) : null;
        return (
          <div key={perk.playerId} className="flex flex-wrap items-center gap-2">
            <span className="text-sm"><b>{owner.name}</b></span>
            <button
              className="btn btn-sm btn-primary"
              disabled={!ready}
              onClick={() => {
                if (!me || perkNeedsTarget(perk.kind)) open(perk.playerId);
                else apply(perk.playerId, {});
              }}
            >
              {perkLabel(perk.kind, perk.level)}
            </button>
            {reason && !reason.ok && <span className="text-xs text-danger">{reason.reason}</span>}
            {me && <button className="btn btn-sm" onClick={() => onSkip(perk.playerId)}>{t('Пропустить')}</button>}
          </div>
        );
      })}
      {me && (picker || bondPicker)}
      {me && resultView}
      {!me && activePlayer && (
        <Modal>
          <Gate key={activePlayer.id} name={activePlayer.name}>
            {completed ? (
              <div className="flex flex-col gap-3">
                {showResult && result && <p className="panel border-amber/60 p-3 text-sm" role="status">{tPacked(result.text)}</p>}
                <button className="btn btn-primary" onClick={() => { if (result) setDismissed(result.id); close(); }}>{t('Понятно')}</button>
              </div>
            ) : confirmSkip ? (
              <div className="flex flex-col gap-3">
                <h3 className="h-hud">{t('Отказаться от бонуса?')}</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn" onClick={() => setConfirmSkip(false)}>{t('Отмена')}</button>
                  <button className="btn btn-primary" onClick={() => { onSkip(activePlayer.id); close(); }}>{t('Пропустить')}</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {picker || bondPicker || (activePerk ? (
                  <div className="flex flex-col gap-2">
                    <h3 className="h-hud">{perkLabel(activePerk.kind, activePerk.level)}</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <button className="btn" onClick={close}>{t('Отмена')}</button>
                      <button className="btn btn-primary" disabled={!canApplyPerk(game, activePlayer.id, {}).ok} onClick={() => apply(activePlayer.id, {})}>{t('Применить')}</button>
                    </div>
                  </div>
                ) : <button className="btn" onClick={close}>{t('Отмена')}</button>)}
                {activePerk && <button className="btn btn-sm self-start" onClick={() => setConfirmSkip(true)}>{t('Пропустить')}</button>}
              </div>
            )}
          </Gate>
        </Modal>
      )}
    </section>
  );
}

/** Выбор двух игроков для связи адвоката. */
function BondPicker({ game, actorId, onConfirm, onCancel }: { game: GameState; actorId: string; onConfirm: (a: string, b: string) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const others = game.players.filter((p) => !p.isEliminated && p.id !== actorId);
  const check = picked.length === 2 ? canApplyPerk(game, actorId, { target: picked[0], target2: picked[1] }) : null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="h-hud">{t('Связать двух игроков')}</h3>
      <div className="grid grid-cols-2 gap-2">
        {others.map((p) => (
          <button
            key={p.id}
            className={`btn btn-sm ${picked.includes(p.id) ? 'btn-primary' : ''}`}
            aria-pressed={picked.includes(p.id)}
            onClick={() => setPicked((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : cur.length < 2 ? [...cur, p.id] : cur))}
          >
            {p.name}
          </button>
        ))}
      </div>
      {check && !check.ok && <p className="text-xs text-danger">{check.reason}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>{t('Отмена')}</button>
        <button className="btn btn-primary" disabled={!check?.ok} onClick={() => onConfirm(picked[0], picked[1])}>{t('Связать')}</button>
      </div>
    </div>
  );
}
