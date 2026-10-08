import { useState } from 'react';
import { Skull, Zap } from 'lucide-react';
import { CATEGORIES, type GameState, type PlayerCharacter } from '../types';
import { REVEALABLE } from '../lib/game';
import { Avatar } from './Avatar';
import { CardFace, Modal } from './bits';
import { t } from '../lib/i18n';

function Pips({ p }: { p: PlayerCharacter }) {
  return (
    <span className="flex gap-1" aria-label={t('Открыто карт: {n} из {total}', { n: REVEALABLE.filter((c) => p.slots[c].isRevealed).length, total: REVEALABLE.length })}>
      {REVEALABLE.map((c) => (
        <span key={c} className={`cat-${c} h-1.5 flex-1 rounded-full transition-colors ${p.slots[c].isRevealed ? 'bg-[var(--c)] shadow-[0_0_8px_-1px_var(--c)]' : 'bg-edge'}`} />
      ))}
    </span>
  );
}

/** Плитка игрока: жетон, имя, шесть индикаторов (какие карты уже открыты) и статус. */
function PlayerTile({ p, active, you, onClick }: { p: PlayerCharacter; active: boolean; you: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex min-h-[4.5rem] flex-col gap-2 overflow-hidden rounded-lg border p-2.5 text-left transition active:scale-[.98] ${
        active ? 'border-amber bg-amber/10 shadow-[0_0_24px_-10px_var(--color-amber)]' : 'border-edge bg-panel hover:border-edge-hi'
      } ${p.isEliminated ? 'opacity-55' : ''}`}
    >
      <span className="flex items-center gap-2">
        <Avatar id={p.id} name={p.name} size={32} dim={p.isEliminated} ring={active} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-bold ${p.isEliminated ? 'text-dim line-through' : active ? 'text-amber' : 'text-ink'}`}>{p.name}</span>
          <span className="block text-[10px] uppercase tracking-widest text-dim">
            {p.isEliminated ? t('исключён') : active ? t('говорит') : you ? t('вы') : p.slots.action.isRevealed ? t('действие использовано') : t('в игре')}
          </span>
        </span>
        {p.isEliminated ? <Skull size={16} className="text-danger" /> : p.slots.action.isRevealed ? <Zap size={14} className="text-[#e879f9]" /> : null}
      </span>
      <Pips p={p} />
    </button>
  );
}

/** Общая доска: все игроки одним взглядом; по нажатию — их открытые карты. */
/** side — доска в узкой боковой колонке: всегда два столбца. */
export function Board({ game, speakerId, meId, side = false }: { game: GameState; speakerId?: string; meId?: string; side?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const sel = game.players.find((p) => p.id === openId);
  return (
    <>
      <div className={`grid grid-cols-2 gap-2 ${side ? 'lg:grid-cols-2' : 'sm:grid-cols-3 lg:grid-cols-4'}`}>
        {game.players.map((p) => (
          <PlayerTile key={p.id} p={p} active={p.id === speakerId} you={p.id === meId} onClick={() => setOpenId(p.id)} />
        ))}
      </div>
      {sel && (
        <Modal onClose={() => setOpenId(null)}>
          <div className="mb-3 flex items-center gap-3">
            <Avatar id={sel.id} name={sel.name} size={44} dim={sel.isEliminated} />
            <div>
              <p className="font-bold text-amber">{sel.name}</p>
              <p className="text-xs text-dim">{sel.isEliminated ? t('исключён из игры') : t('в игре')}{sel.slots.action.isRevealed ? ` · ${t('действие использовано')}` : ''}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {CATEGORIES.filter((c) => c !== 'action' && sel.slots[c].isRevealed).map((c) => <CardFace key={c} card={sel.slots[c].card} compact showMod />)}
            {CATEGORIES.every((c) => c === 'action' || !sel.slots[c].isRevealed) && <p className="text-sm text-dim">{t('Пока ничего не открыто.')}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
