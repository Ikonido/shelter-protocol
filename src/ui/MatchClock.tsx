import { useEffect, useRef, useState } from 'react';
import { Hourglass, Plus } from 'lucide-react';
import { signal } from '../lib/feedback';
import { t } from '../lib/i18n';

/** Часы партии: обратный отсчёт до deadline с цветом «спокойно → торопитесь → время вышло». */
export function MatchClock({ deadline, totalMin, onExtend }: { deadline: number; totalMin: number; onExtend?: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, deadline - now);
  const flags = useRef({ minute: false, over: false });
  useEffect(() => {
    flags.current = { minute: false, over: false };
  }, [deadline]);
  const frac = Math.min(1, left / Math.max(1, totalMin * 60_000));
  const over = left === 0;
  // Предупреждение за минуту и сигнал, когда время вышло (один раз на дедлайн).
  useEffect(() => {
    if (totalMin > 2 && left > 0 && left <= 60_000 && !flags.current.minute) {
      flags.current.minute = true;
      signal('warn');
    }
    if (over && !flags.current.over) {
      flags.current.over = true;
      signal('end');
    }
  }, [left, over, totalMin]);
  const tone = over || frac < 0.15 ? 'text-danger' : frac < 0.35 ? 'text-amber' : 'text-ok';
  const bar = over || frac < 0.15 ? 'bg-danger' : frac < 0.35 ? 'bg-amber' : 'bg-ok';
  const s = Math.ceil(left / 1000);
  const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div className="panel flex flex-col gap-2 p-3" role="timer" aria-label={over ? t('Время партии вышло') : t('Осталось {time}', { time: label })}>
      <div className="flex items-center gap-2">
        <Hourglass size={16} className={`${tone} ${frac < 0.15 && !over ? 'animate-pulse' : ''}`} />
        <span className={`text-lg font-bold tabular-nums ${tone}`}>{over ? t('Время вышло') : label}</span>
        <span className="text-xs text-dim">{over ? t('— речи пропускаются, решайте быстрее') : frac < 0.15 ? t('— торопитесь!') : t('до конца партии')}</span>
        {onExtend && (
          <button className="btn btn-sm ml-auto" onClick={onExtend}><Plus size={14} /> {t('5 мин')}</button>
        )}
      </div>
      <div className="h-1.5 rounded bg-edge"><div className={`h-1.5 rounded transition-all ${bar}`} style={{ width: `${frac * 100}%` }} /></div>
    </div>
  );
}
