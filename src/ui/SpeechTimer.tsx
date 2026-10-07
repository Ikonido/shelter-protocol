import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { signal } from '../lib/feedback';

/** Обратный отсчёт речи ходящего игрока. Когда время выходит, телефон коротко вибрирует (если умеет). */
export function SpeechTimer({ endsAt, totalSec, mine = true }: { endsAt?: number; totalSec: number; mine?: boolean }) {
  const [now, setNow] = useState(Date.now());
  const buzzed = useRef(false);
  const warned = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    buzzed.current = false;
    warned.current = false;
  }, [endsAt]);
  if (!endsAt) {
    return <p className="text-center text-xs text-dim">Без таймера: когда закончите — нажмите «Следующий игрок».</p>;
  }
  const leftMs = Math.max(0, endsAt - now);
  // Сигналы нужны тому, кто говорит (в онлайне у остальных телефон молчит): за 10 секунд и по окончании.
  if (mine && totalSec > 20 && leftMs > 0 && leftMs <= 10_000 && !warned.current) {
    warned.current = true;
    signal('warn');
  }
  if (leftMs === 0 && !buzzed.current) {
    buzzed.current = true;
    if (mine) signal('end');
  }
  const frac = Math.min(1, leftMs / Math.max(1, totalSec * 1000));
  const s = Math.ceil(leftMs / 1000);
  const tone = frac < 0.2 ? 'text-danger' : frac < 0.5 ? 'text-amber' : 'text-ok';
  const bar = frac < 0.2 ? 'bg-danger' : frac < 0.5 ? 'bg-amber' : 'bg-ok';
  return (
    <div role="timer" aria-label={`Осталось ${s} секунд`} className="flex flex-col items-center gap-2">
      <div className={`flex items-center gap-2 text-5xl font-bold tabular-nums ${tone} ${frac < 0.2 && leftMs > 0 ? 'animate-pulse' : ''}`}>
        <Mic size={28} /> {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
      </div>
      <div className="h-2 w-full rounded bg-edge"><div className={`h-2 rounded transition-all ${bar}`} style={{ width: `${frac * 100}%` }} /></div>
    </div>
  );
}
