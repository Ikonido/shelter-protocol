import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Dices, Eye, EyeOff, Flame, Gauge, Globe, Printer, Skull, Smartphone, Smile } from 'lucide-react';
import { useStore } from '../store';
import { Stepper } from '../ui/bits';
import { clampConfig, createGame } from '../lib/game';
import { newSeed } from '../lib/rng';
import type { Difficulty, PlayMode, SessionConfig, VotingMode } from '../types';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../lib/difficulty';

const DIFF_STYLE = {
  easy: { Icon: Smile, tone: { text: 'text-ok', border: 'border-ok', bg: 'bg-ok/10 shadow-[0_0_22px_-10px_var(--color-ok)]' } },
  normal: { Icon: Gauge, tone: { text: 'text-amber', border: 'border-amber', bg: 'bg-amber/10 shadow-[0_0_22px_-10px_var(--color-amber)]' } },
  hard: { Icon: Flame, tone: { text: 'text-orange-400', border: 'border-orange-400', bg: 'bg-orange-400/10 shadow-[0_0_22px_-10px_#fb923c]' } },
  nightmare: { Icon: Skull, tone: { text: 'text-danger', border: 'border-danger', bg: 'bg-danger/10 shadow-[0_0_22px_-10px_var(--color-danger)]' } },
} as const;

export default function Setup() {
  const { allPacks, go, setGame, notify } = useStore();
  const [packIds, setPackIds] = useState<string[]>(() => [allPacks[0].id]);
  const [scenarioId, setScenarioId] = useState<string>('random');
  const [n, setN] = useState(8);
  const [k, setK] = useState(4);
  const [mode, setMode] = useState<PlayMode>('pass-and-play');
  const [voting, setVoting] = useState<VotingMode>('secret');
  const [names, setNames] = useState<string[]>([]);
  const [revealsPerVote, setRevealsPerVote] = useState(2);
  const [timeLimitMin, setTimeLimitMin] = useState(45);
  const [speechSec, setSpeechSec] = useState(45);
  const [hazardCount, setHazardCount] = useState(2);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  // Пресет подставляет рекомендуемые значения, после чего их можно поменять вручную.
  const pickDifficulty = (d: Difficulty) => {
    const r = DIFFICULTIES[d];
    setDifficulty(d);
    setHazardCount(r.hazardCount);
    setSpeechSec(r.speechSec);
    setTimeLimitMin(r.timeLimitMin);
  };

  const activePacks = useMemo(() => allPacks.filter((p) => packIds.includes(p.id)), [allPacks, packIds]);
  const scenarios = useMemo(() => activePacks.flatMap((p) => p.scenarios), [activePacks]);
  const scenario = scenarios.find((s) => s.id === scenarioId);

  // Сценарий, выпавший из выбранных паков, сбрасываем на «случайный».
  useEffect(() => {
    if (scenarioId !== 'random' && !scenario) setScenarioId('random');
  }, [scenario, scenarioId]);
  // Число мест подстраиваем под сценарий.
  useEffect(() => {
    if (scenario) setK(clampConfig(n, scenario.shelterSlots).k);
  }, [scenario]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPlayers = (v: number) => {
    const c = clampConfig(v, k);
    setN(c.n);
    setK(c.k);
  };
  const nameAt = (i: number) => names[i]?.trim() || `Игрок ${i + 1}`;
  const toggle = (id: string) => setPackIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  const canStart = scenarios.length > 0 && activePacks.some((p) => Object.values(p.cards).some((c) => c.length));
  const start = () => {
    const chosen = scenario ?? scenarios[Math.floor(Math.random() * scenarios.length)];
    if (mode === 'online') {
      go({ name: 'lobby', draft: { scenario: chosen, packs: activePacks, slots: k, voting, revealsPerVote, speechSec, hazardCount, difficulty, timeLimitMin } });
      return;
    }
    const config: SessionConfig = {
      scenarioId: chosen.id,
      packIds,
      playerCount: n,
      shelterSlots: k,
      mode,
      voting,
      revealsPerVote,
      speechSec,
      hazardCount,
      difficulty,
      timeLimitMin: mode === 'tabletop' ? 0 : timeLimitMin,
      names: Array.from({ length: n }, (_, i) => nameAt(i)),
      seed: newSeed(),
    };
    setGame(createGame(config, chosen, activePacks));
    notify('Персонажи сгенерированы');
    go({ name: 'game' });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 py-6">
      <button className="btn btn-sm self-start" onClick={() => go({ name: 'home' })}><ArrowLeft size={16} /> Назад</button>
      <h1 className="h-hud text-base">Настройка партии</h1>

      <section className="panel">
        <h2 className="step-title">1 · Паки карт</h2>
        <div className="flex flex-col gap-2">
          {allPacks.map((p) => (
            <label key={p.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-edge p-2">
              <input type="checkbox" className="mt-1 size-4 accent-amber" checked={packIds.includes(p.id)} onChange={() => toggle(p.id)} />
              <span className="text-sm">
                <b>{p.name}</b>{p.isCustom && <span className="ml-2 text-xs text-amber">[свой]</span>}
                <br /><span className="text-xs text-dim">{p.description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="step-title">2 · Сценарий катастрофы</h2>
        <select className="input" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
          <option value="random">🎲 Случайный</option>
          {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        {scenario ? (
          <div className="mt-3 text-sm">
            <p className="text-ink/90">{scenario.description}</p>
            <p className="mt-2 text-xs text-dim">
              Изоляция: {scenario.isolationDuration || '—'} · Нужны: {scenario.requiredSkills.join(', ') || '—'}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-dim">Сценарий выбирается при старте.</p>
        )}
        {scenarios.length === 0 && <p className="mt-2 text-xs text-danger">В выбранных паках нет сценариев.</p>}
      </section>

      <section className="panel">
        <h2 className="step-title">3 · Игроки и места</h2>
        <div className="flex flex-wrap gap-8">
          {mode !== 'online' && <Stepper label="Игроков (N)" value={n} min={2} max={20} onChange={setPlayers} />}
          <Stepper label="Мест в бункере (K)" value={k} min={1} max={mode === 'online' ? 19 : n - 1} onChange={(v) => setK(mode === 'online' ? Math.min(19, Math.max(1, v)) : clampConfig(n, v).k)} />
        </div>
        {mode === 'online' && <p className="mt-2 text-xs text-dim">Число игроков определится по тем, кто подключился к комнате.</p>}
        <details className={`mt-4 ${mode === 'online' ? 'hidden' : ''}`}>
          <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">Имена игроков</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {Array.from({ length: n }, (_, i) => (
              <input
                key={i}
                className="input"
                maxLength={24}
                placeholder={`Игрок ${i + 1}`}
                value={names[i] ?? ''}
                onChange={(e) => setNames((l) => Object.assign([...l], { [i]: e.target.value }))}
              />
            ))}
          </div>
        </details>
      </section>

      <section className="panel">
        <h2 className="step-title">4 · Режим</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <button className={`btn ${mode === 'online' ? 'btn-primary' : ''}`} onClick={() => setMode('online')}>
            <Globe size={18} /> Онлайн (по коду)
          </button>
          <button className={`btn ${mode === 'pass-and-play' ? 'btn-primary' : ''}`} onClick={() => setMode('pass-and-play')}>
            <Smartphone size={18} /> Pass-and-Play
          </button>
          <button className={`btn ${mode === 'tabletop' ? 'btn-primary' : ''}`} onClick={() => setMode('tabletop')}>
            <Printer size={18} /> Настольный (карточки)
          </button>
        </div>
        {mode !== 'tabletop' && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button className={`btn btn-sm ${voting === 'secret' ? 'btn-primary' : ''}`} onClick={() => setVoting('secret')}>
              <EyeOff size={16} /> Тайное голосование
            </button>
            <button className={`btn btn-sm ${voting === 'open' ? 'btn-primary' : ''}`} onClick={() => setVoting('open')}>
              <Eye size={16} /> Открытое голосование
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="step-title">5 · Сложность</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Сложность">
          {DIFFICULTY_ORDER.map((d) => {
            const { Icon, tone } = DIFF_STYLE[d];
            const on = difficulty === d;
            return (
              <button
                key={d}
                role="radio"
                aria-checked={on}
                onClick={() => pickDifficulty(d)}
                className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition active:scale-[.98] ${on ? `${tone.border} ${tone.bg}` : 'border-edge bg-bg hover:border-edge-hi'}`}
              >
                <Icon size={22} className={tone.text} />
                <span className={`text-sm font-bold uppercase tracking-wider ${on ? tone.text : ''}`}>{DIFFICULTIES[d].label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-ink/90">{DIFFICULTIES[difficulty].tagline}</p>
        <ul className="mt-1 list-disc pl-5 text-xs text-dim">
          {DIFFICULTIES[difficulty].details.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </section>

      <section className="panel">
        <h2 className="step-title">6 · Угрозы</h2>
        <Stepper label="Факторы угрозы" value={hazardCount} min={0} max={4} onChange={setHazardCount} />
        <p className="mt-1 max-w-md text-xs text-dim">
          Случайные угрозы сценария (крысы и паразиты, течь, мародёры…). В финале каждую нужно нейтрализовать подходящим навыком или картой выживших: смертельная угроза без ответа губит убежище, остальные мешают полной победе.
        </p>
      </section>

      {mode !== 'tabletop' && (
        <section className="panel">
          <h2 className="step-title w-full">7 · Темп партии</h2>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <Stepper label="Вскрытий до голосования" value={revealsPerVote} min={1} max={3} onChange={setRevealsPerVote} />
            <p className="mt-1 max-w-xs text-xs text-dim">Между голосованиями каждый по очереди открывает столько карт. Чем больше вскрытий, тем меньше раундов.</p>
          </div>
          <div>
            <label className="label" htmlFor="sp">Время на объяснение пользы</label>
            <select id="sp" className="input" value={speechSec} onChange={(e) => setSpeechSec(Number(e.target.value))}>
              <option value={0}>Без таймера</option>
              {[20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} сек</option>)}
            </select>
            <p className="mt-1 max-w-xs text-xs text-dim">После вскрытия игрок объясняет, чем полезен убежищу; по таймеру ход переходит к следующему.</p>
          </div>
          <div>
            <label className="label" htmlFor="tl">Время на партию</label>
            <select id="tl" className="input" value={timeLimitMin} onChange={(e) => setTimeLimitMin(Number(e.target.value))}>
              <option value={0}>Без лимита</option>
              {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} мин</option>)}
            </select>
            <p className="mt-1 max-w-xs text-xs text-dim">Когда время выйдет, речи пропускаются, а карты открываются автоматически. Голосовать всё равно придётся самим.</p>
          </div>
          </div>
        </section>
      )}

      <button className="btn btn-primary" disabled={!canStart} onClick={start}>
        <Dices size={18} /> {mode === 'online' ? 'Создать комнату' : 'Сгенерировать персонажей и начать'}
      </button>
    </div>
  );
}
