import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Dices, Eye, EyeOff, Flame, Gauge, Globe, Pencil, Printer, Skull, Smartphone, Smile, Wand2 } from 'lucide-react';
import { useStore } from '../store';
import { Stepper } from '../ui/bits';
import { clampConfig, createGame } from '../lib/game';
import { newSeed } from '../lib/rng';
import type { Difficulty, PlayMode, SessionConfig, VotingMode } from '../types';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../lib/difficulty';
import { MY_PACK_ID } from '../lib/builder';
import { loadLastSetup, saveLastSetup } from '../lib/quick';
import { t } from '../lib/i18n';

const DIFF_STYLE = {
  easy: { Icon: Smile, tone: { text: 'text-ok', border: 'border-ok', bg: 'bg-ok/10 shadow-[0_0_22px_-10px_var(--color-ok)]' } },
  normal: { Icon: Gauge, tone: { text: 'text-amber', border: 'border-amber', bg: 'bg-amber/10 shadow-[0_0_22px_-10px_var(--color-amber)]' } },
  hard: { Icon: Flame, tone: { text: 'text-orange-400', border: 'border-orange-400', bg: 'bg-orange-400/10 shadow-[0_0_22px_-10px_#fb923c]' } },
  nightmare: { Icon: Skull, tone: { text: 'text-danger', border: 'border-danger', bg: 'bg-danger/10 shadow-[0_0_22px_-10px_var(--color-danger)]' } },
} as const;

const ADULT_KEY = 'shelter:adultOk';
const adultConfirmed = () => {
  try {
    return localStorage.getItem(ADULT_KEY) === '1';
  } catch {
    return false;
  }
};
const rememberAdult = () => {
  try {
    localStorage.setItem(ADULT_KEY, '1');
  } catch {
    /* ок: спросим снова */
  }
};

export default function Setup({ initialMode, initialPacks, initialScenario }: { initialMode?: PlayMode; initialPacks?: string[]; initialScenario?: string }) {
  const { allPacks, go, setGame, notify } = useStore();
  // Прошлая партия на этом устройстве: настройки и имена подставляются заново, чтобы не вводить всё с нуля.
  const [last] = useState(loadLastSetup);
  const lastPackIds = last?.packIds.filter((id) => allPacks.some((p) => p.id === id));
  const [packIds, setPackIds] = useState<string[]>(() => initialPacks?.filter((id) => allPacks.some((p) => p.id === id)) ?? (lastPackIds?.length ? lastPackIds : [allPacks[0].id]));
  const [scenarioId, setScenarioId] = useState<string>(initialScenario ?? last?.scenarioId ?? 'random');
  const [n, setN] = useState(last?.n ?? 8);
  const [k, setK] = useState(last?.k ?? 4);
  const [mode, setMode] = useState<PlayMode>(initialMode ?? 'pass-and-play');
  const [voting, setVoting] = useState<VotingMode>(last?.voting ?? 'secret');
  const [names, setNames] = useState<string[]>(last?.names ?? []);
  const [revealsPerVote, setRevealsPerVote] = useState(last?.revealsPerVote ?? 2);
  const [timeLimitMin, setTimeLimitMin] = useState(last?.timeLimitMin ?? 45);
  const [speechSec, setSpeechSec] = useState(last?.speechSec ?? 45);
  const [hazardCount, setHazardCount] = useState(last?.hazardCount ?? 2);
  const [difficulty, setDifficulty] = useState<Difficulty>(last?.difficulty ?? 'normal');
  const [roundEvents, setRoundEvents] = useState(last?.roundEvents ?? false);
  const [autoActions, setAutoActions] = useState(last?.autoActions ?? false);
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
  const nameAt = (i: number) => names[i]?.trim() || t('Игрок {n}', { n: i + 1 });
  const toggle = (id: string) => {
    const pack = allPacks.find((p) => p.id === id);
    // Контент 18+ включается только после подтверждения возраста (запоминается на этом устройстве).
    if (pack?.adult && !packIds.includes(id) && !adultConfirmed() && !confirm(t('Этот пак содержит мат, чёрный юмор и грубые шутки. Вам есть 18 лет, и вы согласны это увидеть?'))) return;
    if (pack?.adult && !packIds.includes(id)) rememberAdult();
    setPackIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  };

  const canStart = scenarios.length > 0 && activePacks.some((p) => Object.values(p.cards).some((c) => c.length));
  const start = () => {
    const chosen = scenario ?? scenarios[Math.floor(Math.random() * scenarios.length)];
    saveLastSetup({ packIds, n, k, names: Array.from({ length: n }, (_, i) => nameAt(i)), voting, revealsPerVote, timeLimitMin, speechSec, hazardCount, difficulty, roundEvents, autoActions, scenarioId });
    if (mode === 'online') {
      go({ name: 'lobby', draft: { scenario: chosen, packs: activePacks, slots: k, voting, revealsPerVote, speechSec, hazardCount, difficulty, roundEvents, autoActions, timeLimitMin, adult: activePacks.some((p) => p.adult) } });
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
      roundEvents: mode === 'tabletop' ? false : roundEvents,
      autoActions: mode === 'tabletop' ? false : autoActions,
      timeLimitMin: mode === 'tabletop' ? 0 : timeLimitMin,
      names: Array.from({ length: n }, (_, i) => nameAt(i)),
      seed: newSeed(),
    };
    setGame(createGame(config, chosen, activePacks));
    notify(t('Персонажи сгенерированы'));
    go({ name: 'game' });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 py-6">
      <button className="btn btn-sm self-start" onClick={() => go({ name: 'home' })}><ArrowLeft size={16} /> {t('Назад')}</button>
      <h1 className="h-hud text-base">{t('Настройка партии')}</h1>

      <section className="panel">
        <h2 className="step-title">{t('1 · Паки карт')}</h2>
        <div className="flex flex-col gap-2">
          {allPacks.map((p) => (
            <label key={p.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-edge p-2">
              <input type="checkbox" className="mt-1 size-4 accent-amber" checked={packIds.includes(p.id)} onChange={() => toggle(p.id)} />
              <span className="text-sm">
                <b>{t(p.name)}</b>
                {p.adult && <span className="ml-2 rounded border border-danger px-1 text-[10px] font-bold text-danger">18+</span>}
                {p.isCustom && <span className="ml-2 text-xs text-amber">{t('[свой]')}</span>}
                <span className="ml-2 text-[10px] uppercase tracking-widest text-dim">{p.scenarios.length} {t('сцен.')}</span>
                <br /><span className="text-xs text-dim">{t(p.description)}</span>
              </span>
            </label>
          ))}
        </div>
        {activePacks.length > 1 && <p className="mt-2 text-xs text-dim">{t('Выбрано несколько паков: карты перемешаются, а сценарии объединятся. Для цельной атмосферы возьмите один тематический пак.')}</p>}
      </section>

      <section className="panel">
        <h2 className="step-title">{t('2 · Сценарий катастрофы')}</h2>
        <select className="input" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
          <option value="random">🎲 {t('Случайный')}</option>
          {scenarios.map((s) => <option key={s.id} value={s.id}>{t(s.title)}</option>)}
        </select>
        {scenario ? (
          <div className="mt-3 text-sm">
            <p className="text-ink/90">{t(scenario.description)}</p>
            <p className="mt-2 text-xs text-dim">
              {t('Изоляция: {iso} · Нужны: {skills}', { iso: scenario.isolationDuration ? t(scenario.isolationDuration) : '—', skills: scenario.requiredSkills.map((s) => t(s)).join(', ') || '—' })}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-dim">{t('Сценарий выбирается при старте.')}</p>
        )}
        {scenarios.length === 0 && <p className="mt-2 text-xs text-danger">{t('В выбранных паках нет сценариев.')}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-sm" onClick={() => go({ name: 'builder' })}><Wand2 size={14} /> {t('Создать свой сценарий')}</button>
          {scenario && allPacks.some((p) => p.id === MY_PACK_ID && p.scenarios.some((x) => x.id === scenario.id)) && (
            <button className="btn btn-sm" onClick={() => go({ name: 'builder', scenarioId: scenario.id })}><Pencil size={14} /> {t('Изменить этот')}</button>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="step-title">{t('3 · Игроки и места')}</h2>
        <div className="flex flex-wrap gap-8">
          {mode !== 'online' && <Stepper label={t('Игроков (N)')} value={n} min={2} max={20} onChange={setPlayers} />}
          <Stepper label={t('Мест в бункере (K)')} value={k} min={1} max={mode === 'online' ? 19 : n - 1} onChange={(v) => setK(mode === 'online' ? Math.min(19, Math.max(1, v)) : clampConfig(n, v).k)} />
        </div>
        {mode === 'online' && <p className="mt-2 text-xs text-dim">{t('Число игроков определится по тем, кто подключился к комнате.')}</p>}
        <details className={`mt-4 ${mode === 'online' ? 'hidden' : ''}`}>
          <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">{t('Имена игроков')}</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {Array.from({ length: n }, (_, i) => (
              <input
                key={i}
                className="input"
                maxLength={24}
                placeholder={t('Игрок {n}', { n: i + 1 })}
                value={names[i] ?? ''}
                onChange={(e) => setNames((l) => Object.assign([...l], { [i]: e.target.value }))}
              />
            ))}
          </div>
        </details>
      </section>

      <section className="panel">
        <h2 className="step-title">{t('4 · Режим')}</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <button className={`btn ${mode === 'online' ? 'btn-primary' : ''}`} onClick={() => setMode('online')}>
            <Globe size={18} /> {t('Онлайн (по коду)')}
          </button>
          <button className={`btn ${mode === 'pass-and-play' ? 'btn-primary' : ''}`} onClick={() => setMode('pass-and-play')}>
            <Smartphone size={18} /> Pass-and-Play
          </button>
          <button className={`btn ${mode === 'tabletop' ? 'btn-primary' : ''}`} onClick={() => setMode('tabletop')}>
            <Printer size={18} /> {t('Настольный (карточки)')}
          </button>
        </div>
        {mode !== 'tabletop' && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button className={`btn btn-sm ${voting === 'secret' ? 'btn-primary' : ''}`} onClick={() => setVoting('secret')}>
              <EyeOff size={16} /> {t('Тайное голосование')}
            </button>
            <button className={`btn btn-sm ${voting === 'open' ? 'btn-primary' : ''}`} onClick={() => setVoting('open')}>
              <Eye size={16} /> {t('Открытое голосование')}
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="step-title">{t('5 · Сложность')}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t('Сложность')}>
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
                <span className={`text-sm font-bold uppercase tracking-wider ${on ? tone.text : ''}`}>{t(DIFFICULTIES[d].label)}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-ink/90">{t(DIFFICULTIES[difficulty].tagline)}</p>
        <ul className="mt-1 list-disc pl-5 text-xs text-dim">
          {DIFFICULTIES[difficulty].details.map((line) => <li key={line}>{t(line)}</li>)}
        </ul>
      </section>

      <section className="panel">
        <h2 className="step-title">{t('6 · Угрозы')}</h2>
        <Stepper label={t('Факторы угрозы')} value={hazardCount} min={0} max={4} onChange={setHazardCount} />
        <p className="mt-1 max-w-md text-xs text-dim">
          {t('Случайные угрозы сценария (крысы и паразиты, течь, мародёры…). В финале каждую нужно нейтрализовать подходящим навыком или картой выживших: смертельная угроза без ответа губит убежище, остальные мешают полной победе.')}
        </p>
      </section>

      {mode !== 'tabletop' && (
        <section className="panel">
          <h2 className="step-title w-full">{t('7 · Темп и события')}</h2>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <label className="flex w-full max-w-md cursor-pointer items-start gap-3 rounded-md border border-edge p-3">
              <input type="checkbox" className="mt-1 size-4 accent-amber" checked={roundEvents} onChange={(e) => setRoundEvents(e.target.checked)} />
              <span className="text-sm"><b>{t('События раунда (необязательно)')}</b><br /><span className="text-xs text-dim">{t('Усложняют игру. Перед каждым раундом выпадает карта кризиса: сокращается число мест, вспыхивает болезнь, появляется новая угроза — или приходит помощь. Можно вызваться добровольцем.')}</span></span>
            </label>
            <label className="flex w-full max-w-md cursor-pointer items-start gap-3 rounded-md border border-edge p-3">
              <input type="checkbox" className="mt-1 size-4 accent-amber" checked={autoActions} onChange={(e) => setAutoActions(e.target.checked)} />
              <span className="text-sm"><b>{t('Карты действий исполняются сами (бета)')}</b><br /><span className="text-xs text-dim">{t('Кража и подмена багажа, смена телосложения соседей, вето, двойной голос, тайный союз и прочее выполняются в игре после выбора цели. Выключено: действие только объявляется, а выполняют его игроки.')}</span></span>
            </label>
          <div>
            <Stepper label={t('Вскрытий до голосования')} value={revealsPerVote} min={1} max={3} onChange={setRevealsPerVote} />
            <p className="mt-1 max-w-xs text-xs text-dim">{t('Между голосованиями каждый по очереди открывает столько карт. Чем больше вскрытий, тем меньше раундов.')}</p>
          </div>
          <div>
            <label className="label" htmlFor="sp">{t('Время на объяснение пользы')}</label>
            <select id="sp" className="input" value={speechSec} onChange={(e) => setSpeechSec(Number(e.target.value))}>
              <option value={0}>{t('Без таймера')}</option>
              {[20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} {t('сек')}</option>)}
            </select>
            <p className="mt-1 max-w-xs text-xs text-dim">{t('После вскрытия игрок объясняет, чем полезен убежищу; по таймеру ход переходит к следующему.')}</p>
          </div>
          <div>
            <label className="label" htmlFor="tl">{t('Время на партию')}</label>
            <select id="tl" className="input" value={timeLimitMin} onChange={(e) => setTimeLimitMin(Number(e.target.value))}>
              <option value={0}>{t('Без лимита')}</option>
              {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} {t('мин')}</option>)}
            </select>
            <p className="mt-1 max-w-xs text-xs text-dim">{t('Когда время выйдет, речи пропускаются, а карты открываются автоматически. Голосовать всё равно придётся самим.')}</p>
          </div>
          </div>
        </section>
      )}

      <button className="btn btn-primary" disabled={!canStart} onClick={start}>
        <Dices size={18} /> {mode === 'online' ? t('Создать комнату') : t('Сгенерировать персонажей и начать')}
      </button>
    </div>
  );
}
