import { useEffect, useState } from 'react';
import { ArrowLeft, Eye, Gavel, Play, Timer, Zap } from 'lucide-react';
import { CATEGORIES, CATEGORY_LABEL, type Category, type GameState, type PlayerCharacter } from '../types';
import { useStore } from '../store';
import {
  alive,
  allVoted,
  castVote,
  nextRound,
  pendingReveal,
  quotaThisRound,
  resolveVote,
  revealCard,
  revealOptions,
  startVote,
  playAction as applyAction,
} from '../lib/game';
import { CardFace, Modal } from '../ui/bits';
import { Gate } from '../ui/Gate';
import Final from './Final';
import Tabletop from './Tabletop';

type Update = (fn: (g: GameState) => GameState) => void;

export default function Game() {
  const { game, setGame, go } = useStore();
  const [showBrief, setShowBrief] = useState(false);
  if (!game) {
    return (
      <div className="py-10 text-center">
        <p className="mb-4 text-dim">Нет активной партии.</p>
        <button className="btn btn-primary" onClick={() => go({ name: 'setup' })}>Новая игра</button>
      </div>
    );
  }
  const update: Update = (fn) => setGame((g) => (g ? fn(g) : g));
  const living = alive(game);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-4">
      <header className="no-print flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={() => go({ name: 'home' })}><ArrowLeft size={16} /> Меню</button>
        <button className="btn btn-sm" onClick={() => setShowBrief(true)}>{game.scenario.title}</button>
        <div className="ml-auto text-xs uppercase tracking-widest text-dim">
          {game.config.mode === 'pass-and-play' && game.phase !== 'final' && <>Раунд {game.round}/{game.schedule.length} · </>}
          В игре <b className="text-amber">{living.length}</b> · Мест <b className="text-amber">{game.config.shelterSlots}</b>
        </div>
      </header>

      {showBrief && (
        <Modal title={game.scenario.title} onClose={() => setShowBrief(false)}>
          <p className="text-sm">{game.scenario.description}</p>
          <p className="mt-3 text-xs text-dim">Изоляция: {game.scenario.isolationDuration}</p>
          <p className="mt-1 text-xs text-dim">Нужны: {game.scenario.requiredSkills.join(', ')}</p>
          <p className="mt-1 text-xs text-danger/80">Угрозы: {game.scenario.threats.join('; ')}</p>
        </Modal>
      )}

      {game.config.mode === 'tabletop' ? (
        <Tabletop game={game} />
      ) : game.phase === 'final' ? (
        <Final game={game} />
      ) : (
        <>
          <Board game={game} />
          {game.phase === 'reveal' && <RevealPhase game={game} update={update} />}
          {game.phase === 'debate' && <DebatePhase game={game} update={update} />}
          {game.phase === 'vote' && <VotePhase game={game} update={update} />}
          {game.phase === 'result' && <ResultPhase game={game} update={update} />}
        </>
      )}
    </div>
  );
}

/* ---------- Общая доска: открытые карты всех игроков ---------- */

export function Board({ game }: { game: GameState }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {game.players.map((p) => {
        const open = CATEGORIES.filter((c) => p.slots[c].isRevealed && c !== 'action');
        return (
          <details key={p.id} className={`panel p-3 ${p.isEliminated ? 'opacity-40' : ''}`}>
            <summary className="cursor-pointer text-sm">
              <b className={p.isEliminated ? 'line-through' : 'text-amber'}>{p.name}</b>
              <span className="ml-2 text-xs text-dim">
                {p.isEliminated ? 'исключён' : `открыто: ${open.length}/6`}
                {p.slots.action.isRevealed && ' · действие использовано'}
              </span>
            </summary>
            <div className="mt-2 flex flex-col gap-1">
              {open.length === 0 && <span className="text-xs text-dim">Ничего не открыто</span>}
              {open.map((c) => <CardFace key={c} card={p.slots[c].card} compact />)}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/* ---------- Приватное досье игрока ---------- */

export function Dossier({
  game,
  player,
  mode,
  onDone,
  onCancel,
}: {
  game: GameState;
  player: PlayerCharacter;
  mode: 'reveal' | 'action' | 'view';
  onDone?: (category?: Category) => void;
  onCancel: () => void;
}) {
  const options = mode === 'reveal' ? revealOptions(game, player) : [];
  const [pick, setPick] = useState<Category | null>(options.length === 1 ? options[0] : null);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="h-hud">Досье: {player.name}</h3>
      {mode === 'reveal' && (
        <p className="text-xs text-dim">
          {game.round === 1 ? 'В первом раунде нужно открыть профессию.' : 'Выберите карту, которую откроете всем.'}
        </p>
      )}
      {CATEGORIES.map((c) => {
        const slot = player.slots[c];
        const selectable = options.includes(c) || (mode === 'action' && c === 'action' && !slot.isRevealed);
        return (
          <CardFace
            key={c}
            card={slot.card}
            showMod
            compact
            selected={pick === c}
            onClick={selectable ? () => setPick(c) : undefined}
            extra={slot.isRevealed && <span className="text-[10px] uppercase text-dim">{c === 'action' ? 'использована' : 'открыта всем'}</span>}
          />
        );
      })}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>{mode === 'view' ? 'Скрыть' : 'Отмена'}</button>
        {mode !== 'view' && (
          <button
            className="btn btn-primary"
            disabled={mode === 'reveal' ? !pick : !player.slots.action || player.slots.action.isRevealed}
            onClick={() => onDone?.(mode === 'action' ? 'action' : pick ?? undefined)}
          >
            {mode === 'reveal' ? `Открыть: ${pick ? CATEGORY_LABEL[pick] : '…'}` : 'Применить'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Фаза 1: открытие карт ---------- */

function RevealPhase({ game, update }: { game: GameState; update: Update }) {
  const [current, setCurrent] = useState<string | null>(null);
  const pending = pendingReveal(game);
  const player = pending.find((p) => p.id === current);
  if (player) {
    return (
      <Gate name={player.name}>
        <Dossier
          game={game}
          player={player}
          mode="reveal"
          onCancel={() => setCurrent(null)}
          onDone={(c) => {
            if (c) update((g) => revealCard(g, player.id, c));
            setCurrent(null);
          }}
        />
      </Gate>
    );
  }
  return (
    <section className="panel">
      <h2 className="h-hud mb-1">Раунд {game.round}: открытие карт</h2>
      <p className="mb-3 text-xs text-dim">Каждый по очереди берёт устройство и открывает одну карту. Осталось: {pending.length}.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {pending.map((p) => (
          <button key={p.id} className="btn" onClick={() => setCurrent(p.id)}><Eye size={16} /> {p.name}</button>
        ))}
      </div>
    </section>
  );
}

/* ---------- Фаза 2: дебаты ---------- */

export function DebateTimer() {
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setLeft((l) => (l <= 1 ? (setRunning(false), 0) : l - 1)), 1000);
    return () => clearInterval(t);
  }, [running]);
  const start = (s: number) => { setLeft(s); setRunning(true); };
  const fmt = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Timer size={18} className="text-amber" />
      <span className={`w-16 text-2xl ${running && left <= 10 ? 'text-danger' : 'text-amber'}`}>{fmt}</span>
      {[60, 120, 180].map((s) => <button key={s} className="btn btn-sm" onClick={() => start(s)}>{s / 60} мин</button>)}
      {running && <button className="btn btn-sm" onClick={() => setRunning(false)}>Стоп</button>}
    </div>
  );
}

function DebatePhase({ game, update }: { game: GameState; update: Update }) {
  const [actor, setActor] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const living = alive(game);
  const actorP = living.find((p) => p.id === actor);
  const peekP = living.find((p) => p.id === peek);
  return (
    <>
      <section className="panel flex flex-col gap-3">
        <h2 className="h-hud">Дебаты</h2>
        <p className="text-xs text-dim">Обсудите, кто нужнее убежищу. В этом раунде уйдёт: {quotaThisRound(game)}.</p>
        <DebateTimer />
        <div className="flex flex-wrap gap-2">
          {living.map((p) => (
            <button key={p.id} className="btn btn-sm" disabled={p.slots.action.isRevealed} onClick={() => setActor(p.id)}>
              <Zap size={14} /> {p.name}
            </button>
          ))}
        </div>
        <p className="text-[10px] uppercase tracking-widest text-dim">↑ применить карту действия (один раз за партию)</p>
        <details>
          <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">Посмотреть своё досье</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {living.map((p) => <button key={p.id} className="btn btn-sm" onClick={() => setPeek(p.id)}>{p.name}</button>)}
          </div>
        </details>
        <button className="btn btn-primary" onClick={() => update(startVote)}><Gavel size={18} /> К голосованию</button>
      </section>
      {actorP && (
        <Modal>
          <Gate name={actorP.name}>
            <Dossier
              game={game}
              player={actorP}
              mode="action"
              onCancel={() => setActor(null)}
              onDone={() => { update((g) => applyAction(g, actorP.id)); setActor(null); }}
            />
          </Gate>
        </Modal>
      )}
      {peekP && (
        <Modal>
          <Gate name={peekP.name}>
            <Dossier game={game} player={peekP} mode="view" onCancel={() => setPeek(null)} />
          </Gate>
        </Modal>
      )}
    </>
  );
}

/* ---------- Фаза 3: голосование ---------- */

function VotePhase({ game, update }: { game: GameState; update: Update }) {
  const living = alive(game);
  const [voterId, setVoterId] = useState<string | null>(null);
  const voter = living.find((p) => p.id === voterId);
  const waiting = living.filter((p) => !game.votes[p.id]);
  const finish = () => update(resolveVote);

  if (game.config.voting === 'open') {
    return (
      <section className="panel flex flex-col gap-3">
        <h2 className="h-hud">Открытое голосование</h2>
        {living.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <span className="w-28 truncate text-amber">{p.name}</span>→
            <select className="input" value={game.votes[p.id] ?? ''} onChange={(e) => update((g) => castVote(g, p.id, e.target.value))}>
              <option value="" disabled>выберите…</option>
              {living.filter((t) => t.id !== p.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        ))}
        <button className="btn btn-primary" disabled={!allVoted(game)} onClick={finish}>Подвести итоги</button>
      </section>
    );
  }

  if (voter) {
    return (
      <Gate name={voter.name}>
        <section className="panel flex flex-col gap-2">
          <h2 className="h-hud">{voter.name}: против кого вы голосуете?</h2>
          {living.filter((t) => t.id !== voter.id).map((t) => (
            <button key={t.id} className="btn" onClick={() => { update((g) => castVote(g, voter.id, t.id)); setVoterId(null); }}>
              {t.name}
            </button>
          ))}
          <button className="btn btn-sm" onClick={() => setVoterId(null)}>Отмена</button>
        </section>
      </Gate>
    );
  }
  return (
    <section className="panel flex flex-col gap-3">
      <h2 className="h-hud">Тайное голосование</h2>
      <p className="text-xs text-dim">Проголосовало {living.length - waiting.length} из {living.length}. Голос можно изменить до подсчёта.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {living.map((p) => (
          <button key={p.id} className="btn" onClick={() => setVoterId(p.id)}>
            {game.votes[p.id] ? '✔ ' : ''}{p.name}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" disabled={!allVoted(game)} onClick={finish}><Play size={18} /> Подвести итоги</button>
    </section>
  );
}

/* ---------- Фаза 4: итоги раунда ---------- */

function ResultPhase({ game, update }: { game: GameState; update: Update }) {
  const r = game.lastResult;
  if (!r) return null;
  const sorted = Object.entries(r.tally).sort((a, b) => b[1] - a[1]);
  const nameOf = (id: string) => game.players.find((p) => p.id === id)?.name ?? id;
  const finishing = alive(game).length <= game.config.shelterSlots || game.round >= game.schedule.length;
  return (
    <section className="panel flex flex-col gap-3">
      <h2 className="h-hud">Итоги раунда {game.round}</h2>
      <ul className="text-sm">
        {sorted.map(([id, v]) => (
          <li key={id} className={r.eliminated.includes(id) ? 'text-danger' : ''}>
            {nameOf(id)} — {v} гол. {r.eliminated.includes(id) && '← покидает игру'}
          </li>
        ))}
      </ul>
      {r.tieBreak && <p className="text-xs text-amber">Ничья на границе — решено жребием.</p>}
      <button className="btn btn-primary" onClick={() => update(nextRound)}>
        {finishing ? 'К финалу' : 'Следующий раунд'}
      </button>
    </section>
  );
}
