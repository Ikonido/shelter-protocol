import { useEffect, useState } from 'react';
import { CheckCircle2, Home, Newspaper, Repeat, RotateCcw, Skull, TriangleAlert } from 'lucide-react';
import type { GameState } from '../types';
import { CATEGORIES } from '../types';
import { evaluate } from '../lib/evaluate';
import { CardFace } from '../ui/bits';
import { ThreatsPanel } from '../ui/Threats';
import { ChroniclePlayer } from '../ui/ChroniclePlayer';
import { ScoreRing } from '../ui/ScoreRing';
import { rulesFor } from '../lib/difficulty';
import { replayGame } from '../lib/quick';
import { useStore } from '../store';

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs uppercase tracking-widest text-dim">
        <span>{label}</span><span>{Math.round(value * 100)}%</span>
      </div>
      <div className="h-2 rounded bg-edge"><div className="h-2 rounded bg-amber" style={{ width: `${value * 100}%` }} /></div>
    </div>
  );
}

export function Verdict({ game }: { game: GameState }) {
  const survivors = game.players.filter((p) => !p.isEliminated);
  const ev = evaluate(game.scenario, survivors, game.config.shelterSlots, game.hazards ?? [], game.config.difficulty);
  const Icon = ev.verdict === 'survived' ? CheckCircle2 : ev.verdict === 'fragile' ? TriangleAlert : Skull;
  const tone = ev.verdict === 'survived' ? 'text-ok' : ev.verdict === 'fragile' ? 'text-amber' : 'text-danger';
  return (
    <div className="flex flex-col gap-4">
      <div className={`panel hud anim-rise text-center ${ev.verdict === 'survived' ? 'border-ok/60' : ev.verdict === 'fragile' ? 'border-amber/60' : 'border-danger/60'}`}>
        <Icon className={`mx-auto mb-2 ${tone}`} size={32} />
        <h2 className={`text-xl font-bold uppercase tracking-widest ${tone}`}>{ev.headline}</h2>
        <p className="mb-4 mt-1 text-xs uppercase tracking-widest text-dim">
          {rulesFor(game.config.difficulty).label} сложность · нужно {rulesFor(game.config.difficulty).winScore}+ для победы
        </p>
        <ScoreRing score={ev.score} tone={ev.verdict === 'survived' ? 'ok' : ev.verdict === 'fragile' ? 'amber' : 'danger'} />
      </div>

      <div className="panel">
        <h3 className="label">Требования сценария «{game.scenario.title}»</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {ev.coverage.map((c) => (
            <li key={c.skill} className="flex gap-2">
              <span className={c.by.length ? 'text-ok' : 'text-danger'}>{c.by.length ? '✔' : '✘'}</span>
              <b>{c.skill}</b>
              <span className="text-dim">{c.by.length ? `— ${c.by.join(', ')}` : '— никто не владеет'}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Meter label="Здоровье" value={ev.health} />
          <Meter label="Ресурсы" value={ev.resources} />
          <Meter label="Стабильность" value={ev.stability} />
        </div>
        {ev.notes.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-sm text-danger/90">{ev.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        )}
      </div>

      <ThreatsPanel hazards={game.hazards ?? []} results={ev.hazards} />
      {!(game.hazards?.length) && game.scenario.threats.length > 0 && (
        <div className="panel">
          <h3 className="label">Угрозы изоляции ({game.scenario.isolationDuration})</h3>
          <ul className="list-disc pl-5 text-sm text-dim">{game.scenario.threats.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}

      <h3 className="label">Выжившие ({survivors.length})</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {survivors.map((p) => (
          <details key={p.id} className="panel" open={survivors.length <= 4}>
            <summary className="cursor-pointer font-bold text-amber">{p.name}</summary>
            <div className="mt-3 flex flex-col gap-2">
              {CATEGORIES.map((c) => <CardFace key={c} card={p.slots[c].card} compact showMod />)}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

/**
 * Финал: сначала «Хроника изоляции» (auto), затем итог с оценкой. В настольном режиме итог меняется по мере
 * того, как отмечают выживших, поэтому хроника там запускается по кнопке.
 */
export function FinalReport({ game, auto = true, onStoryChange }: { game: GameState; auto?: boolean; onStoryChange?: (playing: boolean) => void }) {
  const [story, setStory] = useState(auto);
  // Родитель прячет остальное (журнал, кнопки), пока играет хроника.
  useEffect(() => {
    onStoryChange?.(story);
  }, [story, onStoryChange]);
  if (story) return <ChroniclePlayer game={game} onDone={() => setStory(false)} />;
  return (
    <div className="flex flex-col gap-4">
      <Verdict game={game} />
      <button className="btn" onClick={() => setStory(true)}><Newspaper size={16} /> Посмотреть хронику изоляции</button>
    </div>
  );
}

export default function Final({ game }: { game: GameState }) {
  const { go, setGame, allPacks, notify } = useStore();
  const [playing, setPlaying] = useState(true);
  return (
    <div className="flex flex-col gap-4">
      <FinalReport game={game} onStoryChange={setPlaying} />
      {!playing && (<>
      <details className="panel">
        <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">Журнал партии</summary>
        <ol className="mt-2 flex flex-col gap-1 text-xs text-dim">
          {game.log.map((l, i) => <li key={i}>[Р{l.round}] {l.text}</li>)}
        </ol>
      </details>
      <div className="grid gap-2 sm:grid-cols-2">
        {game.config.mode !== 'online' && (
          <button
            className="btn btn-primary sm:col-span-2"
            onClick={() => {
              const g = replayGame(game, allPacks);
              if (!g) return notify('Не удалось начать заново');
              setGame(g);
              notify('Новая раздача, те же игроки');
              go({ name: 'game' });
            }}
          >
            <Repeat size={18} /> Сыграть ещё раз тем же составом
          </button>
        )}
        <button className="btn" onClick={() => go({ name: 'setup' })}><RotateCcw size={18} /> Новая партия</button>
        <button className="btn" onClick={() => { setGame(null); go({ name: 'home' }); }}><Home size={18} /> В меню</button>
      </div>
      </>)}
    </div>
  );
}
