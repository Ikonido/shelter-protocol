import { useState } from 'react';
import { CATEGORIES, categoryLabel, type ActionEffect, type Category, type GameState } from '../types';
import { canApply, needsCategory, type ActionParams } from '../lib/actions';
import { Avatar } from './Avatar';

/** Выбор цели для карты действия: игрок (и скрытая карта, если нужно). Работает и на одном устройстве, и в онлайне. */
export function ActionTargetPicker({
  game,
  actorId,
  effect,
  title,
  onConfirm,
  onCancel,
}: {
  game: GameState;
  actorId: string;
  effect: ActionEffect;
  title: string;
  onConfirm: (p: ActionParams) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const targets = game.players.filter((p) => !p.isEliminated && p.id !== actorId);
  const chosen = game.players.find((p) => p.id === target);
  const hidden = chosen ? CATEGORIES.filter((c) => c !== 'action' && !chosen.slots[c].isRevealed) : [];
  const params: ActionParams = { target: target ?? undefined, category: category ?? undefined };
  const check = canApply(game, actorId, effect, params);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="h-hud">{title}: выберите цель</h3>
      <div className="grid grid-cols-2 gap-2">
        {targets.map((p) => (
          <button
            key={p.id}
            className={`btn btn-sm justify-start gap-2 normal-case ${target === p.id ? 'btn-primary' : ''}`}
            aria-pressed={target === p.id}
            onClick={() => {
              setTarget(p.id);
              setCategory(null);
            }}
          >
            <Avatar id={p.id} name={p.name} size={22} /> {p.name}
          </button>
        ))}
      </div>
      {needsCategory(effect) && chosen && (
        <>
          <span className="label mt-1">Какую скрытую карту открыть</span>
          {hidden.length === 0 ? (
            <p className="text-xs text-dim">У игрока всё уже открыто.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {hidden.map((c) => (
                <button key={c} className={`btn btn-sm ${category === c ? 'btn-primary' : ''}`} aria-pressed={category === c} onClick={() => setCategory(c)}>
                  {categoryLabel(c)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {target && !check.ok && <p className="text-xs text-danger">{check.reason}</p>}
      <div className="mt-1 grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>Отмена</button>
        <button className="btn btn-primary" disabled={!check.ok} onClick={() => onConfirm(params)}>Применить</button>
      </div>
    </div>
  );
}
