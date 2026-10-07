import { useEffect, useRef, useState } from 'react';
import { Eye, Play, Undo2, UserRound, Zap } from 'lucide-react';
import { CATEGORIES, CATEGORY_LABEL, type Category, type GameState, type PlayerCharacter } from '../types';
import { useStore } from '../store';
import {
  alive,
  allVoted,
  castVote,
  continueEvent,
  nextRound,
  pendingReveal,
  resolveVote,
  revealCard,
  revealOptions,
  ABSTAIN,
  currentSpeaker,
  endSpeech,
  extendDeadline,
  perVote,
  quotaThisRound,
  stepOf,
  tickGame,
  volunteer,
  playAction as applyAction,
} from '../lib/game';
import { CardFace, Modal } from '../ui/bits';
import { MatchClock } from '../ui/MatchClock';
import { SpeechTimer } from '../ui/SpeechTimer';
import { ThreatsPanel } from '../ui/Threats';
import { Board } from '../ui/Board';
import { ActionTargetPicker } from '../ui/ActionTarget';
import { canApply, needsTarget } from '../lib/actions';
import { applyUndo, undoable } from '../lib/undo';
import { SkillsStrip } from '../ui/SkillsStrip';
import { GameHud } from '../ui/GameHud';
import { Avatar } from '../ui/Avatar';
import { Tally } from '../ui/Tally';
import { EventCard } from '../ui/EventCard';
import { Gate } from '../ui/Gate';
import Final from './Final';
import Tabletop from './Tabletop';

type Update = (fn: (g: GameState) => GameState) => void;
interface Undo { name: string; run: () => void }

/** Кнопка «отменить» последнее вскрытие: случайно открыли не ту карту. Живёт, пока не началось голосование. */
function UndoButton({ undo }: { undo?: Undo }) {
  if (!undo) return null;
  return <button className="btn btn-sm self-center" onClick={undo.run}><Undo2 size={14} /> Отменить вскрытие ({undo.name})</button>;
}

export default function Game() {
  const { game, setGame, go } = useStore();
  const [showBrief, setShowBrief] = useState(false);
  // Снимок состояния до последнего вскрытия: нужен для кнопки «отменить».
  const prevRef = useRef<GameState | null>(null);
  const [undoSnap, setUndoSnap] = useState<{ before: GameState; after: GameState } | null>(null);
  useEffect(() => {
    const p = prevRef.current;
    if (!game || game.phase === 'vote' || game.phase === 'result' || game.phase === 'final' || game.phase === 'event') setUndoSnap(null);
    else if (p && p.phase === 'reveal' && game.lastReveal && game.lastReveal !== p.lastReveal && game.round === p.round) setUndoSnap({ before: p, after: game });
    prevRef.current = game;
  }, [game]);
  const timed = !!game?.deadline && game.config.mode === 'pass-and-play' && game.phase !== 'final';
  // Раз в секунду: кончилась речь → ходит следующий; вышло время партии → овертайм.
  // tickGame возвращает тот же объект, пока ничего не изменилось, поэтому лишних перерисовок нет.
  const ticking = game?.config.mode === 'pass-and-play' && (timed || game.phase === 'speech');
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setGame((g) => (g ? tickGame(g) : g)), 500);
    return () => clearInterval(t);
  }, [ticking, setGame]);
  if (!game) {
    return (
      <div className="py-10 text-center">
        <p className="mb-4 text-dim">Нет активной партии.</p>
        <button className="btn btn-primary" onClick={() => go({ name: 'setup' })}>Новая игра</button>
      </div>
    );
  }
  const update: Update = (fn) => setGame((g) => (g ? fn(g) : g));
  const undo: Undo | undefined =
    undoSnap && game.config.mode === 'pass-and-play' && (game.phase === 'speech' || game.phase === 'reveal') && undoable(undoSnap.after, game)
      ? { name: game.players.find((p) => p.id === game.lastReveal?.playerId)?.name ?? '', run: () => { setGame((cur) => (cur ? applyUndo(undoSnap.before, cur) : cur)); setUndoSnap(null); } }
      : undefined;

  const speaker = currentSpeaker(game);
  const live = game.config.mode !== 'tabletop' && game.phase !== 'final';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-6">
      <GameHud game={game} onBack={() => go({ name: 'home' })} onTitle={() => setShowBrief(true)} />
      {game.config.mode !== 'tabletop' && game.phase !== 'final' && <SkillsStrip scenario={game.scenario} />}

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
      ) : null}

      {live && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="anim-rise flex min-w-0 flex-col gap-4" key={`${game.round}-${stepOf(game)}-${game.phase}-${speaker?.id ?? ''}`}>
            {timed && game.deadline && (
              <MatchClock deadline={game.deadline} totalMin={game.config.timeLimitMin} onExtend={() => update((g) => extendDeadline(g, 5 * 60_000))} />
            )}
            {game.phase === 'event' && <EventPhase game={game} update={update} />}
            {game.phase === 'reveal' && <RevealPhase game={game} update={update} undo={undo} />}
            {game.phase === 'speech' && <SpeechPhase game={game} update={update} undo={undo} />}
            {game.phase === 'vote' && <VotePhase game={game} update={update} />}
            {game.phase === 'result' && <ResultPhase game={game} update={update} />}
          </div>
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
            <ThreatsPanel hazards={game.hazards ?? []} />
            <Board game={game} speakerId={speaker?.id} side />
          </aside>
        </div>
      )}
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
          {game.round === 1 ? 'В первом раунде открывается пол и возраст (биология), дальше — по желанию.' : 'Выберите карту, которую откроете всем.'}
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

/* ---------- Фаза 0: карта кризиса в начале раунда ---------- */

function EventPhase({ game, update }: { game: GameState; update: Update }) {
  if (!game.event) return null;
  return (
    <EventCard
      round={game.round}
      event={game.event}
      volunteers={quotaThisRound(game) >= 1 ? alive(game) : []}
      onVolunteer={(id) => update((g) => volunteer(g, id))}
      action={<button className="btn btn-primary" onClick={() => update(continueEvent)}><Play size={18} /> Начать раунд</button>}
    />
  );
}

/* ---------- Фаза 1: ход игрока — открывает карту ---------- */

function RevealPhase({ game, update, undo }: { game: GameState; update: Update; undo?: Undo }) {
  const [open, setOpen] = useState(false);
  const speaker = currentSpeaker(game);
  if (!speaker) return null;
  if (open) {
    return (
      <Gate name={speaker.name}>
        <Dossier
          game={game}
          player={speaker}
          mode="reveal"
          onCancel={() => setOpen(false)}
          onDone={(c) => {
            if (c) update((g) => revealCard(g, speaker.id, c));
            setOpen(false);
          }}
        />
      </Gate>
    );
  }
  const total = alive(game).filter((p) => revealOptions(game, p).length > 0).length;
  const done = game.revealedThisRound.length;
  return (
    <>
      <section className="panel hud flex flex-col items-center gap-3 text-center">
        <h2 className="h-hud">Раунд {game.round} · вскрытие {stepOf(game)} из {perVote(game)}</h2>
        <p className="text-xs text-dim">Игрок {done + 1} из {total}. Возьмите устройство, откройте карту и затем объясните, чем вы полезны убежищу.</p>
        <Avatar id={speaker.id} name={speaker.name} size={72} ring />
        <p className="text-3xl font-bold text-amber">{speaker.name}</p>
        <button className="btn btn-primary w-full" onClick={() => setOpen(true)}><Eye size={18} /> Я — {speaker.name}: открыть карту</button>
        <UndoButton undo={undo} />
      </section>
      <ActionsPanel game={game} update={update} />
    </>
  );
}

/* ---------- Фаза 2: речь — игрок объясняет пользу, затем ходит следующий ---------- */

function SpeechPhase({ game, update, undo }: { game: GameState; update: Update; undo?: Undo }) {
  const speaker = currentSpeaker(game);
  const cat = game.lastReveal?.category;
  if (!speaker || !cat) return null;
  const upNext = pendingReveal(game)[0];
  return (
    <>
      <section className="panel hud flex flex-col gap-3">
        <h2 className="h-hud flex items-center gap-3"><Avatar id={speaker.id} name={speaker.name} size={36} ring /> <span><UserRound size={14} className="mr-1 inline" />{speaker.name} объясняет пользу</span></h2>
        <CardFace card={speaker.slots[cat].card} showMod flip />
        <SpeechTimer endsAt={game.speechEndsAt} totalSec={game.config.speechSec} />
        <p className="text-center text-xs text-dim">
          Почему именно вас нужно взять в убежище? {upNext ? `Затем ходит: ${upNext.name}.` : 'Это последняя речь вскрытия.'}
        </p>
        <button className="btn btn-primary" onClick={() => update(endSpeech)}><Play size={18} /> {upNext ? 'Следующий игрок' : 'Дальше'}</button>
        <UndoButton undo={undo} />
      </section>
      <ActionsPanel game={game} update={update} />
    </>
  );
}

/* ---------- Карты действий и просмотр своего досье (в любой момент вскрытий) ---------- */

function ActionsPanel({ game, update }: { game: GameState; update: Update }) {
  const { notify } = useStore();
  const [actor, setActor] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [peek, setPeek] = useState<string | null>(null);
  const living = alive(game);
  const actorP = living.find((p) => p.id === actor);
  const peekP = living.find((p) => p.id === peek);
  // Автоисполнение: у карты есть эффект, и партия создана с этой опцией.
  const autoEffect = game.config.autoActions ? actorP?.slots.action.card.effect : undefined;
  const lastAction = [...game.log].reverse().find((l) => l.round === game.round && l.text.includes(' применяет '));
  return (
    <>
      {lastAction && <p className="panel border-[#e879f9]/60 text-sm" role="status"><Zap size={14} className="mr-1 inline text-[#e879f9]" />{lastAction.text}</p>}
      <details className="panel p-3" open>
        <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">Карты действий и своё досье</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {living.map((p) => (
            <button key={p.id} className="btn btn-sm" disabled={p.slots.action.isRevealed} onClick={() => setActor(p.id)}>
              <Zap size={14} /> {p.name}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-widest text-dim">↑ применить карту действия (один раз за партию)</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {living.map((p) => <button key={p.id} className="btn btn-sm" onClick={() => setPeek(p.id)}>Досье: {p.name}</button>)}
        </div>
      </details>
      {actorP && (
        <Modal>
          <Gate name={actorP.name}>
            {picking && autoEffect ? (
              <ActionTargetPicker
                game={game}
                actorId={actorP.id}
                effect={autoEffect}
                title={actorP.slots.action.card.title ?? 'Действие'}
                onCancel={() => setPicking(false)}
                onConfirm={(params) => { update((g) => applyAction(g, actorP.id, params)); setPicking(false); setActor(null); }}
              />
            ) : (
              <Dossier
                game={game}
                player={actorP}
                mode="action"
                onCancel={() => setActor(null)}
                onDone={() => {
                  if (autoEffect && needsTarget(autoEffect)) return setPicking(true);
                  const check = autoEffect ? canApply(game, actorP.id, autoEffect) : null;
                  if (check && !check.ok) return notify(check.reason);
                  update((g) => applyAction(g, actorP.id));
                  setActor(null);
                }}
              />
            )}
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
  return (
    <>
      <VoteBody game={game} update={update} />
      <ActionsPanel game={game} update={update} />
    </>
  );
}

function VoteBody({ game, update }: { game: GameState; update: Update }) {
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
            <Avatar id={p.id} name={p.name} size={28} /><span className="w-24 truncate text-amber">{p.name}</span>→
            <select className="input" value={game.votes[p.id] ?? ''} onChange={(e) => update((g) => castVote(g, p.id, e.target.value))}>
              <option value="" disabled>выберите…</option>
              <option value={ABSTAIN}>— воздержаться —</option>
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
            <button key={t.id} className="btn justify-start gap-3 normal-case" onClick={() => { update((g) => castVote(g, voter.id, t.id)); setVoterId(null); }}>
              <Avatar id={t.id} name={t.name} size={28} /> {t.name}
            </button>
          ))}
          <button className="btn border-dashed" onClick={() => { update((g) => castVote(g, voter.id, ABSTAIN)); setVoterId(null); }}>Воздержаться</button>
          <p className="text-xs text-dim">Если воздержится больше половины игроков — в этом раунде никто не покидает игру.</p>
          <button className="btn btn-sm" onClick={() => setVoterId(null)}>Отмена</button>
        </section>
      </Gate>
    );
  }
  return (
    <section className="panel flex flex-col gap-3">
      <h2 className="h-hud">Тайное голосование</h2>
      <p className="text-xs text-dim">Проголосовало {living.length - waiting.length} из {living.length}. Голос можно изменить до подсчёта. Воздержаться тоже можно: если таких больше половины, никто не уходит.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {living.map((p) => (
          <button key={p.id} className={`btn justify-start gap-3 normal-case ${game.votes[p.id] ? 'border-ok/50 text-ok' : ''}`} onClick={() => setVoterId(p.id)}>
            <Avatar id={p.id} name={p.name} size={28} /> {p.name}
            {game.votes[p.id] && <span className="ml-auto text-xs uppercase tracking-widest">✔ проголосовал</span>}
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
  const finishing = alive(game).length <= game.config.shelterSlots || game.round >= game.schedule.length;
  return (
    <section className="panel flex flex-col gap-3">
      <h2 className="h-hud">Итоги раунда {game.round}</h2>
      {r.noVote ? <p className="text-sm text-amber">Добровольцы закрыли квоту раунда — голосования не будет.</p> : <Tally players={game.players} result={r} />}
      {r.skipped && <p className="text-sm text-amber">Большинство воздержалось ({r.abstained} из {alive(game).length}) — никто не покидает игру. Пропущенное исключение перенесено в дополнительный раунд.</p>}
      {!r.skipped && !!r.abstained && <p className="text-xs text-dim">Воздержались: {r.abstained}.</p>}
      {r.tieBreak && <p className="text-xs text-amber">Ничья на границе — решено жребием.</p>}
      <button className="btn btn-primary" onClick={() => update(nextRound)}>
        {finishing ? 'К финалу' : 'Следующий раунд'}
      </button>
    </section>
  );
}
