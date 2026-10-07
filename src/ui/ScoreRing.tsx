/** Кольцевой индикатор итогового индекса выживаемости. */
export function ScoreRing({ score, tone }: { score: number; tone: 'ok' | 'amber' | 'danger' }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const color = { ok: 'var(--color-ok)', amber: 'var(--color-amber)', danger: 'var(--color-danger)' }[tone];
  return (
    <div className="relative mx-auto size-36" role="img" aria-label={`Индекс выживаемости ${score} из 100`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" style={{ filter: `drop-shadow(0 0 10px ${color})` }}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-edge)" strokeWidth="9" />
        <circle cx="60" cy="60" r={R} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(100, Math.max(0, score)) / 100)} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold tabular-nums" style={{ color }}>{score}</span>
        <span className="text-[10px] uppercase tracking-widest text-dim">из 100</span>
      </div>
    </div>
  );
}
