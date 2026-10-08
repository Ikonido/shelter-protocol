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
 * Бонусы открытых профессий. Выбор цели — меню с игроками.
 * На одном устройстве (me не задан) показываем бонусы всех игроков, и выбирает тот, чей бонус: перед меню экран передачи телефона.
 * В онлайне (me задан) — только свой бонус, без передачи.
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
  // Итог бонуса (лечение удалось или нет) видит только владелец: на одном устройстве — в окне за экраном передачи, в онлайне — у себя.
  const [watch, setWatch] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const perks: Perk[] = (game.perks ?? []).filter((x) => (me ? x.playerId === me : true) && game.players.some((p) => p.id === x.playerId && !p.isEliminated));
  const result = game.perkResult;
  const showResult = !!result && (me ? result.playerId === me && result.id !== dismissed : result.playerId === watch);
  const resultOwner = result && game.players.find((p) => p.id === result.playerId);
  const resultView = showResult && result && resultOwner && (
    <div className="panel flex flex-col gap-2 border-amber/60 p-3" role="status">
      <p className="text-sm">{tPacked(result.text)}</p>
      <button className="btn btn-sm self-start" onClick={() => { setDismissed(result.id); setWatch(null); }}>{t('Понятно')}</button>
    </div>
  );
  if (perks.length === 0 && !resultView) return null;
  const activePerk = perks.find((x) => x.playerId === active);
  const activePlayer = game.players.find((p) => p.id === active);

  // Связь адвоката: двое других игроков, без одиночного выбора.
  const bondPicker = activePerk && activePlayer && activePerk.kind === 'bond' && (
    <BondPicker
      game={game}
      actorId={activePlayer.id}
      onCancel={() => setActive(null)}
      onConfirm={(a, b) => {
        onApply(activePlayer.id, { target: a, target2: b });
        setWatch(activePlayer.id);
        setActive(null);
      }}
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
      onCancel={() => setActive(null)}
      onConfirm={(params) => {
        onApply(activePlayer.id, params);
        setWatch(activePlayer.id);
        setActive(null);
      }}
    />
  );

  return (
    <section className="panel flex flex-col gap-2 border-amber/60 p-3" aria-label={t('Бонусы профессий')}>
      <h3 className="h-hud flex items-center gap-2 text-xs"><Sparkles size={14} className="text-amber" /> {t('Бонусы профессий')}</h3>
      {perks.map((perk) => {
        const owner = game.players.find((p) => p.id === perk.playerId)!;
        // Без выбора цели бонус применяется сразу, если это возможно сейчас; причину показываем рядом.
        const ready = perkNeedsTarget(perk.kind) || canApplyPerk(game, perk.playerId, {}).ok;
        const reason = !ready ? canApplyPerk(game, perk.playerId, {}) : null;
        return (
          <div key={perk.playerId} className="flex flex-wrap items-center gap-2">
            <span className="text-sm"><b>{owner.name}</b></span>
            <button
              className="btn btn-sm btn-primary"
              disabled={!ready}
              onClick={() => (perkNeedsTarget(perk.kind) ? setActive(perk.playerId) : onApply(perk.playerId, {}))}
            >
              {perkLabel(perk.kind, perk.level)}
            </button>
            {reason && !reason.ok && <span className="text-xs text-danger">{reason.reason}</span>}
            <button className="btn btn-sm" onClick={() => onSkip(perk.playerId)}>{t('Пропустить')}</button>
          </div>
        );
      })}
      {(picker || bondPicker) && (me ? picker || bondPicker : <Modal><Gate name={activePlayer!.name}>{picker || bondPicker}</Gate></Modal>)}
      {resultView && (me ? resultView : <Modal><Gate name={resultOwner!.name}>{resultView}</Gate></Modal>)}
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
