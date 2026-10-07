/** Эмблема главного экрана: гермодверь с вращающимися кольцами. Чистый SVG, без внешних ресурсов. */
export function Emblem({ size = 168 }: { size?: number }) {
  return (
    <div className="relative mx-auto lg:mx-0" style={{ width: size, height: size }} aria-hidden>
      <div className="absolute inset-0 rounded-full bg-amber/10 blur-2xl" />
      <svg viewBox="0 0 200 200" className="relative size-full text-amber" fill="none" stroke="currentColor" style={{ filter: 'drop-shadow(0 0 8px rgba(251,191,36,.45))' }}>
        <g className="origin-center animate-[var(--animate-spin-slow)]" style={{ transformOrigin: '100px 100px' }}>
          <circle cx="100" cy="100" r="94" strokeWidth="1.5" strokeDasharray="2 9" opacity=".7" />
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="100" y1="3" x2="100" y2="13" strokeWidth="3" transform={`rotate(${i * 30} 100 100)`} />
          ))}
        </g>
        <g className="animate-[var(--animate-spin-rev)]" style={{ transformOrigin: '100px 100px' }}>
          <circle cx="100" cy="100" r="78" strokeWidth="2" strokeDasharray="40 12 8 12" opacity=".55" />
        </g>
        <circle cx="100" cy="100" r="62" strokeWidth="3" />
        <circle cx="100" cy="100" r="50" strokeWidth="1.5" opacity=".5" />
        <path d="M100 64 70 90v34h16v-20h28v20h16V90z" strokeWidth="4" strokeLinejoin="round" />
        <circle cx="100" cy="88" r="5" fill="currentColor" stroke="none" className="animate-[var(--animate-blink)]" />
      </svg>
    </div>
  );
}
