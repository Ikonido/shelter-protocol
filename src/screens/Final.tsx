import { useEffect, useState } from 'react';
import { CheckCircle2, Home, ImageDown, Newspaper, Repeat, RotateCcw, Skull, TriangleAlert } from 'lucide-react';
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
import { resultCard, shareResultImage } from '../lib/shareResult';
import { t } from '../lib/i18n';

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

/** Итог картинкой: делимся в мессенджер или скачиваем файл. */
function ShareButton({ game }: { game: GameState }) {
  const { notify } = useStore();
  return (
    <button
      className="btn"
      onClick={async () => {
        const r = await shareResultImage(resultCard(game));
        if (r === 'downloaded') notify(t('Картинка с итогом сохранена'));
        else if (r === 'failed') notify(t('Не удалось сделать картинку'));
      }}
    >
      <ImageDown size={16} /> {t('Поделиться итогом картинкой')}
    </button>
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
          {t('{label} сложность · нужно {score}+ для победы', { label: t(rulesFor(game.config.difficulty).label), score: rulesFor(game.config.difficulty).winScore })}
        </p>
        <ScoreRing score={ev.score} tone={ev.verdict === 'survived' ? 'ok' : ev.verdict === 'fragile' ? 'amber' : 'danger'} />
      </div>

      <div className="panel">
        <h3 className="label">{t('Требования сценария «{title}»', { title: game.scenario.title })}</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {ev.coverage.map((c) => (
            <li key={c.skill} className="flex gap-2">
              <span className={c.by.length ? 'text-ok' : 'text-danger'}>{c.by.length ? '✔' : '✘'}</span>
              <b>{c.skill}</b>
              <span className="text-dim">{c.by.length ? `— ${c.by.join(', ')}` : t('— никто не владеет')}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Meter label={t('Здоровье')} value={ev.health} />
          <Meter label={t('Ресурсы')} value={ev.resources} />
          <Meter label={t('Стабильность')} value={ev.stability} />
        </div>
        {ev.notes.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-sm text-danger/90">{ev.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        )}
      </div>

      <ThreatsPanel hazards={game.hazards ?? []} results={ev.hazards} />
      {!(game.hazards?.length) && game.scenario.threats.length > 0 && (
        <div className="panel">
          <h3 className="label">{t('Угрозы изоляции ({duration})', { duration: game.scenario.isolationDuration })}</h3>
          <ul className="list-disc pl-5 text-sm text-dim">{game.scenario.threats.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}

      <h3 className="label">{t('Выжившие ({n})', { n: survivors.length })}</h3>
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
      <button className="btn" onClick={() => setStory(true)}><Newspaper size={16} /> {t('Посмотреть хронику изоляции')}</button>
      <ShareButton game={game} />
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
        <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">{t('Журнал партии')}</summary>
        <ol className="mt-2 flex flex-col gap-1 text-xs text-dim">
          {game.log.map((l, i) => <li key={i}>{t('[Р{round}]', { round: l.round })} {l.text}</li>)}
        </ol>
      </details>
      <div className="grid gap-2 sm:grid-cols-2">
        {game.config.mode !== 'online' && (
          <button
            className="btn btn-primary sm:col-span-2"
            onClick={() => {
              const g = replayGame(game, allPacks);
              if (!g) return notify(t('Не удалось начать заново'));
              setGame(g);
              notify(t('Новая раздача, те же игроки'));
              go({ name: 'game' });
            }}
          >
            <Repeat size={18} /> {t('Сыграть ещё раз тем же составом')}
          </button>
        )}
        <button className="btn" onClick={() => go({ name: 'setup' })}><RotateCcw size={18} /> {t('Новая партия')}</button>
        <button className="btn" onClick={() => { setGame(null); go({ name: 'home' }); }}><Home size={18} /> {t('В меню')}</button>
      </div>
      </>)}
    </div>
  );
}
