import { useEffect, useRef, useState } from 'react';
import { Eye, Play, Undo2, UserRound, Zap } from 'lucide-react';
import { CATEGORIES, categoryLabel, type Category, type GameState, type PlayerCharacter } from '../types';
import { useStore } from '../store';
import { t } from '../lib/i18n';
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
  shiftClock,
  CLOCK_GAP_MS,
  volunteer,
  playAction as applyAction,
  playPerk,
} from '../lib/game';
import { markSeen } from '../lib/storage';
import { CardFace, Modal } from '../ui/bits';
import { MatchClock } from '../ui/MatchClock';
import { SpeechTimer } from '../ui/SpeechTimer';
import { ThreatsPanel } from '../ui/Threats';
import { Board } from '../ui/Board';
import { ActionTargetPicker } from '../ui/ActionTarget';
import { PerkPanel } from '../ui/PerkPanel';
import { skipPerk } from '../lib/perks';
import { canApply, needsTarget } from '../lib/actions';
import { applyUndo, canUndo } from '../lib/undo';
import { SkillsStrip } from '../ui/SkillsStrip';
import { GameHud } from '../ui/GameHud';
import { Avatar } from '../ui/Avatar';
import { Tally } from '../ui/Tally';
import { EventCard } from '../ui/EventCard';
import { Gate } from '../ui/Gate';
import Final from './Final';
import Tabletop from './Tabletop';
import { ThreatLocal } from '../ui/HiddenThreat';

type Update = (fn: (g: GameState) => GameState) => void;
interface Undo { name: string; run: () => void }

/** Кнопка «отменить» последнее вскрытие: случайно открыли не ту карту. Живёт, пока не началось голосование. */
function UndoButton({ undo }: { undo?: Undo }) {
  if (!undo) return null;
  return <button className="btn btn-sm self-center" onClick={undo.run}><Undo2 size={14} /> {t('Отменить вскрытие ({name})', { name: undo.name })}</button>;
}

export default function Game() {
  const { game, setGame, go } = useStore();
  const [showBrief, setShowBrief] = useState(false);
  const [privatePlayerId, setPrivatePlayerId] = useState<string | null>(null);
  // Окно навыков игрока не должно само вернуться в одной из следующих фаз или раундов.
  const privateAllowed = !!game && game.config.mode === 'pass-and-play' && ['reveal', 'speech', 'vote'].includes(game.phase);
  useEffect(() => { if (!privateAllowed) setPrivatePlayerId(null); }, [privateAllowed]);
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
    let last = Date.now();
    markSeen(last);
    const t = setInterval(() => {
      const now = Date.now();
      // Большой разрыв между тиками: телефон уснул или вкладка была заморожена. Время партии это время не считает.
      const gap = now - last;
      last = now;
      markSeen(now);
      setGame((g) => (g ? tickGame(gap > CLOCK_GAP_MS ? shiftClock(g, gap) : g, now) : g));
    }, 500);
    return () => clearInterval(t);
  }, [ticking, setGame]);
  if (!game) {
    return (
      <div className="py-10 text-center">
        <p className="mb-4 text-dim">{t('Нет активной партии.')}</p>
        <button className="btn btn-primary" onClick={() => go({ name: 'setup' })}>{t('Новая игра')}</button>
      </div>
    );
  }
  const update: Update = (fn) => setGame((g) => (g ? fn(g) : g));
  const undo: Undo | undefined =
    undoSnap && game.config.mode === 'pass-and-play' && (game.phase === 'speech' || game.phase === 'reveal') && canUndo(undoSnap, game)
      ? { name: game.players.find((p) => p.id === game.lastReveal?.playerId)?.name ?? '', run: () => { setGame((cur) => (cur ? applyUndo(undoSnap.before, cur) : cur)); setUndoSnap(null); } }
      : undefined;

  const speaker = currentSpeaker(game);
  const privatePlayer = game.players.find((p) => p.id === privatePlayerId && !p.isEliminated);
  const canOpenPrivate = game.config.mode === 'pass-and-play' && ['reveal', 'speech', 'vote'].includes(game.phase);
  const live = (game.config.mode !== 'tabletop' || !!game.hiddenThreat) && game.phase !== 'final';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-6">
      <GameHud game={game} onBack={() => go({ name: 'home' })} onTitle={() => setShowBrief(true)} />
      {game.config.mode !== 'tabletop' && game.phase !== 'final' && <SkillsStrip scenario={game.scenario} />}

      {showBrief && (
        <Modal title={t(game.scenario.title)} onClose={() => setShowBrief(false)}>
          <p className="text-sm">{t(game.scenario.description)}</p>
          <p className="mt-3 text-xs text-dim">{t('Изоляция: {duration}', { duration: t(game.scenario.isolationDuration) })}</p>
          <p className="mt-1 text-xs text-dim">{t('Нужны: {list}', { list: game.scenario.requiredSkills.map((s) => t(s)).join(', ') })}</p>
          <p className="mt-1 text-xs text-danger/80">{t('Угрозы: {list}', { list: game.scenario.threats.map((s) => t(s)).join('; ') })}</p>
        </Modal>
      )}

      {game.config.mode === 'tabletop' && !game.hiddenThreat ? (
        <Tabletop game={game} />
      ) : game.phase === 'final' ? (
        <Final game={game} />
      ) : null}

      {live && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="anim-rise flex min-w-0 flex-col gap-4" key={`${game.round}-${stepOf(game)}-${game.phase}-${speaker?.id ?? ''}`}>
            {game.hiddenThreat && <ThreatLocal game={game} update={update} />}
            {timed && game.deadline && (
              <MatchClock deadline={game.deadline} totalMin={game.config.timeLimitMin} onExtend={() => update((g) => extendDeadline(g, 5 * 60_000))} />
            )}
            {game.phase === 'event' && <EventPhase game={game} update={update} />}
            {game.phase === 'reveal' && <RevealPhase game={game} update={update} undo={undo} onPrivate={setPrivatePlayerId} />}
            {game.phase === 'speech' && <SpeechPhase game={game} update={update} undo={undo} onPrivate={setPrivatePlayerId} />}
            {game.phase === 'vote' && <VotePhase game={game} update={update} />}
            {game.phase === 'result' && <ResultPhase game={game} update={update} />}
          </div>
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
            <ThreatsPanel hazards={game.hazards ?? []} />
            <Board game={game} speakerId={speaker?.id} side onPrivate={canOpenPrivate ? setPrivatePlayerId : undefined} />
          </aside>
        </div>
      )}
      {live && canOpenPrivate && privatePlayer && (
        <PlayerControls key={privatePlayer.id} game={game} player={privatePlayer} update={update} onClose={() => setPrivatePlayerId(null)} />
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
  onAction,
}: {
  game: GameState;
  player: PlayerCharacter;
  mode: 'reveal' | 'action' | 'view';
  onDone?: (category?: Category) => void;
  onCancel: () => void;
  onAction?: () => void;
}) {
  const options = mode === 'reveal' ? revealOptions(game, player) : [];
  const [pick, setPick] = useState<Category | null>(options.length === 1 ? options[0] : null);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="h-hud">{t('Досье: {name}', { name: player.name })}</h3>
      {mode === 'reveal' && (
        <p className="text-xs text-dim">
          {game.round === 1 ? t('В первом раунде открывается пол и возраст (биология), дальше — по желанию.') : t('Выберите карту, которую откроете всем.')}
        </p>
      )}
      {(onAction ? (['action', ...CATEGORIES.filter((c) => c !== 'action')] as Category[]) : CATEGORIES).map((c) => {
        const slot = player.slots[c];
        const selectable = options.includes(c) || (c === 'action' && !slot.isRevealed && (mode === 'action' || !!onAction));
        return (
          <CardFace
            key={c}
            card={slot.card}
            showMod
            compact
            selected={pick === c}
            onClick={selectable ? () => (c === 'action' && onAction ? onAction() : setPick(c)) : undefined}
            extra={slot.isRevealed ? <span className="text-[10px] uppercase text-dim">{c === 'action' ? t('использована') : t('открыта всем')}</span> : c === 'action' && onAction ? <span className="text-xs text-amber">{t('Нажмите, чтобы применить')}</span> : undefined}
          />
        );
      })}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="btn" onClick={onCancel}>{mode === 'view' ? t('Скрыть') : t('Отмена')}</button>
        {mode !== 'view' && (
          <button
            className="btn btn-primary"
            disabled={mode === 'reveal' ? !pick : !player.slots.action || player.slots.action.isRevealed}
            onClick={() => onDone?.(mode === 'action' ? 'action' : pick ?? undefined)}
          >
            {mode === 'reveal' ? t('Открыть: {card}', { card: pick ? categoryLabel(pick) : '…' }) : t('Применить')}
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
      action={<button className="btn btn-primary" onClick={() => update(continueEvent)}><Play size={18} /> {t('Начать раунд')}</button>}
    />
  );
}

/* ---------- Фаза 1: ход игрока — открывает карту ---------- */

function RevealPhase({ game, update, undo, onPrivate }: { game: GameState; update: Update; undo?: Undo; onPrivate: (id: string) => void }) {
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
          onAction={game.config.mode === 'pass-and-play' ? () => { setOpen(false); onPrivate(speaker.id); } : undefined}
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
        <h2 className="h-hud">{t('Раунд {n} · вскрытие {step} из {total}', { n: game.round, step: stepOf(game), total: perVote(game) })}</h2>
        <p className="text-xs text-dim">{t('Игрок {n} из {total}. Возьмите устройство, откройте карту и затем объясните, чем вы полезны убежищу.', { n: done + 1, total })}</p>
        <Avatar id={speaker.id} name={speaker.name} size={72} ring />
        <p className="text-3xl font-bold text-amber">{speaker.name}</p>
        <button className="btn btn-primary w-full" onClick={() => setOpen(true)}><Eye size={18} /> {t('Я — {name}: открыть карту', { name: speaker.name })}</button>
        <UndoButton undo={undo} />
      </section>
    </>
  );
}

/* ---------- Фаза 2: речь — игрок объясняет пользу, затем ходит следующий ---------- */

function SpeechPhase({ game, update, undo, onPrivate }: { game: GameState; update: Update; undo?: Undo; onPrivate: (id: string) => void }) {
  const speaker = currentSpeaker(game);
  const cat = game.lastReveal?.category;
  if (!speaker || !cat) return null;
  const upNext = pendingReveal(game)[0];
  return (
    <>
      <section className="panel hud flex flex-col gap-3">
        <h2 className="h-hud flex items-center gap-3"><Avatar id={speaker.id} name={speaker.name} size={36} ring /> <span><UserRound size={14} className="mr-1 inline" />{t('{name} объясняет пользу', { name: speaker.name })}</span></h2>
        {/* Действие соседа (обмен багажом, соседей) может поставить на место открытой карты чужую закрытую: общий экран её не показывает. */}
        <CardFace card={speaker.slots[cat].card} hidden={!speaker.slots[cat].isRevealed} showMod flip />
        <SpeechTimer endsAt={game.speechEndsAt} totalSec={game.config.speechSec} />
        <p className="text-center text-xs text-dim">
          {t('Почему именно вас нужно взять в убежище?')} {upNext ? t('Затем ходит: {name}.', { name: upNext.name }) : t('Это последняя речь вскрытия.')}
        </p>
        {game.config.mode === 'pass-and-play' && <button className="btn btn-sm" onClick={() => onPrivate(speaker.id)}><Zap size={16} /> {t('Навыки')}</button>}
        <button className="btn btn-primary" onClick={() => update(endSpeech)}><Play size={18} /> {upNext ? t('Следующий игрок') : t('Дальше')}</button>
        <UndoButton undo={undo} />
      </section>
    </>
  );
}

/* ---------- Навык и личные карты: доступны с плитки игрока ---------- */

function PlayerControls({
  game, player, update, onClose,
}: {
  game: GameState;
  player: PlayerCharacter;
  update: Update;
  onClose: () => void;
}) {
  const { notify } = useStore();
  const [actionStep, setActionStep] = useState<'cards' | 'target' | 'confirm'>('cards');
  const [confirmSkip, setConfirmSkip] = useState(false);
  const autoEffect = game.config.autoActions ? player.slots.action.card.effect : undefined;
  const actionAvailable = !player.slots.action.isRevealed && !player.isEliminated && ['reveal', 'speech', 'vote'].includes(game.phase);

  const useAction = (params?: Parameters<typeof applyAction>[2]) => {
    if (autoEffect) {
      const check = canApply(game, player.id, autoEffect, params);
      if (!check.ok) { notify(check.reason); return; }
    }
    update((g) => applyAction(g, player.id, params));
    onClose();
  };

  return (
    <Modal>
      <Gate key={player.id} name={player.name}>
        {actionStep === 'target' && autoEffect ? (
          <ActionTargetPicker
            game={game}
            actorId={player.id}
            effect={autoEffect}
            title={t(player.slots.action.card.title ?? 'Действие')}
            onCancel={() => setActionStep('cards')}
            onConfirm={useAction}
          />
        ) : actionStep === 'confirm' ? (
          <div className="flex flex-col gap-3">
            <h3 className="h-hud">{t('Применить действие')}</h3>
            <CardFace card={player.slots.action.card} compact />
            <div className="grid grid-cols-2 gap-2">
              <button className="btn" onClick={() => setActionStep('cards')}>{t('Отмена')}</button>
              <button className="btn btn-primary" onClick={() => useAction()}>{t('Применить')}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <PerkPanel
              game={game}
              me={player.id}
              onApply={(id, params) => update((g) => playPerk(g, id, params))}
              onSkip={() => setConfirmSkip(true)}
            />
            <Dossier
              game={game}
              player={player}
              mode="view"
              onAction={actionAvailable ? () => setActionStep(autoEffect && needsTarget(autoEffect) ? 'target' : 'confirm') : undefined}
              onCancel={onClose}
            />
            {confirmSkip && (
              <div className="panel flex flex-col gap-3 border-amber/60 p-3">
                <p className="text-sm">{t('Отказаться от бонуса?')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn" onClick={() => setConfirmSkip(false)}>{t('Отмена')}</button>
                  <button className="btn btn-primary" onClick={() => { update((g) => skipPerk(g, player.id)); setConfirmSkip(false); }}>{t('Пропустить')}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </Gate>
    </Modal>
  );
}

/* ---------- Фаза 3: голосование ---------- */

function VotePhase({ game, update }: { game: GameState; update: Update }) {
  return (
    <>
      <VoteBody game={game} update={update} />
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
        <h2 className="h-hud">{t('Открытое голосование')}</h2>
        {living.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <Avatar id={p.id} name={p.name} size={28} /><span className="w-24 truncate text-amber">{p.name}</span>→
            <select className="input" value={game.votes[p.id] ?? ''} onChange={(e) => update((g) => castVote(g, p.id, e.target.value))}>
              <option value="" disabled>{t('выберите…')}</option>
              <option value={ABSTAIN}>{t('— воздержаться —')}</option>
              {living.filter((t) => t.id !== p.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        ))}
        <button className="btn btn-primary" disabled={!allVoted(game)} onClick={finish}>{t('Подвести итоги')}</button>
      </section>
    );
  }

  if (voter) {
    return (
      <Gate name={voter.name}>
        <section className="panel flex flex-col gap-2">
          <h2 className="h-hud">{t('{name}: против кого вы голосуете?', { name: voter.name })}</h2>
          {living.filter((t) => t.id !== voter.id).map((t) => (
            <button key={t.id} className="btn justify-start gap-3 normal-case" onClick={() => { update((g) => castVote(g, voter.id, t.id)); setVoterId(null); }}>
              <Avatar id={t.id} name={t.name} size={28} /> {t.name}
            </button>
          ))}
          <button className="btn border-dashed" onClick={() => { update((g) => castVote(g, voter.id, ABSTAIN)); setVoterId(null); }}>{t('Воздержаться')}</button>
          <p className="text-xs text-dim">{t('Если воздержится больше половины игроков — в этом раунде никто не покидает игру.')}</p>
          <button className="btn btn-sm" onClick={() => setVoterId(null)}>{t('Отмена')}</button>
        </section>
      </Gate>
    );
  }
  return (
    <section className="panel flex flex-col gap-3">
      <h2 className="h-hud">{t('Тайное голосование')}</h2>
      <p className="text-xs text-dim">{t('Проголосовало {n} из {total}. Голос можно изменить до подсчёта. Воздержаться тоже можно: если таких больше половины, никто не уходит.', { n: living.length - waiting.length, total: living.length })}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {living.map((p) => (
          <button key={p.id} className={`btn justify-start gap-3 normal-case ${game.votes[p.id] ? 'border-ok/50 text-ok' : ''}`} onClick={() => setVoterId(p.id)}>
            <Avatar id={p.id} name={p.name} size={28} /> {p.name}
            {game.votes[p.id] && <span className="ml-auto text-xs uppercase tracking-widest">✔ {t('проголосовал')}</span>}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" disabled={!allVoted(game)} onClick={finish}><Play size={18} /> {t('Подвести итоги')}</button>
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
      <h2 className="h-hud">{t('Итоги раунда {n}', { n: game.round })}</h2>
      {r.noVote ? <p className="text-sm text-amber">{t('Добровольцы закрыли квоту раунда — голосования не будет.')}</p> : <Tally players={game.players} result={r} />}
      {r.skipped && <p className="text-sm text-amber">{t('Большинство воздержалось ({n} из {total}) — никто не покидает игру. Пропущенное исключение перенесено в дополнительный раунд.', { n: r.abstained ?? 0, total: alive(game).length })}</p>}
      {!r.skipped && !!r.abstained && <p className="text-xs text-dim">{t('Воздержались: {n}.', { n: r.abstained })}</p>}
      {r.tieBreak && <p className="text-xs text-amber">{t('Ничья на границе — решено жребием.')}</p>}
      <button className="btn btn-primary" onClick={() => update(nextRound)}>
        {finishing ? t('К финалу') : t('Следующий раунд')}
      </button>
    </section>
  );
}
