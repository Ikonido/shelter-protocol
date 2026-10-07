import { CheckCircle2, Home, RotateCcw, Skull, TriangleAlert } from 'lucide-react';
import type { GameState } from '../types';
import { CATEGORIES } from '../types';
import { evaluate } from '../lib/evaluate';
import { CardFace } from '../ui/bits';
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
  const ev = evaluate(game.scenario, survivors, game.config.shelterSlots);
  const Icon = ev.verdict === 'survived' ? CheckCircle2 : ev.verdict === 'fragile' ? TriangleAlert : Skull;
  const tone = ev.verdict === 'survived' ? 'text-ok' : ev.verdict === 'fragile' ? 'text-amber' : 'text-danger';
  return (
    <div className="flex flex-col gap-4">
      <div className="panel text-center">
        <Icon className={`mx-auto mb-2 ${tone}`} size={48} />
        <h2 className={`text-xl font-bold uppercase tracking-widest ${tone}`}>{ev.headline}</h2>
        <p className="mt-1 text-sm text-dim">Индекс выживаемости: <b className={tone}>{ev.score}</b> / 100</p>
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

      {game.scenario.threats.length > 0 && (
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

export default function Final({ game }: { game: GameState }) {
  const { go, setGame } = useStore();
  return (
    <div className="flex flex-col gap-4">
      <Verdict game={game} />
      <details className="panel">
        <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">Журнал партии</summary>
        <ol className="mt-2 flex flex-col gap-1 text-xs text-dim">
          {game.log.map((l, i) => <li key={i}>[Р{l.round}] {l.text}</li>)}
        </ol>
      </details>
      <div className="grid gap-2 sm:grid-cols-2">
        <button className="btn btn-primary" onClick={() => go({ name: 'setup' })}><RotateCcw size={18} /> Новая партия</button>
        <button className="btn" onClick={() => { setGame(null); go({ name: 'home' }); }}><Home size={18} /> В меню</button>
      </div>
    </div>
  );
}
