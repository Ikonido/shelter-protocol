import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { GameState, Perk } from '../types';
import { PERK_EFFECT, perkLabel } from '../lib/perks';
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

  const picker = activePerk && activePlayer && (
    <ActionTargetPicker
      game={game}
      actorId={activePlayer.id}
      effect={PERK_EFFECT[activePerk.kind]}
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
        return (
          <div key={perk.playerId} className="flex flex-wrap items-center gap-2">
            <span className="text-sm"><b>{owner.name}</b></span>
            <button className="btn btn-sm btn-primary" onClick={() => setActive(perk.playerId)}>{perkLabel(perk.kind, perk.level)}</button>
            <button className="btn btn-sm" onClick={() => onSkip(perk.playerId)}>{t('Пропустить')}</button>
          </div>
        );
      })}
      {picker && (me ? picker : <Modal><Gate name={activePlayer!.name}>{picker}</Gate></Modal>)}
      {resultView && (me ? resultView : <Modal><Gate name={resultOwner!.name}>{resultView}</Gate></Modal>)}
    </section>
  );
}
