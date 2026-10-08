/** Круглый «жетон» игрока: цвет стабилен для одного id, вместо инициала — номер у безымянных «Игрок N». */
const HUES = [38, 160, 200, 280, 330, 12, 100, 230];

export function avatarHue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const n = /\d+/.exec(seed);
  return HUES[(n ? Number(n[0]) : h) % HUES.length];
}

export function initialOf(name: string): string {
  // Имя по умолчанию «Игрок N» на любом языке интерфейса (Гравець, Player, Spieler): показываем номер, а не первую букву.
  const m = /^(?:Игрок|Гравець|Player|Spieler)\s+(\d+)$/i.exec(name.trim());
  return m ? m[1] : (name.trim()[0] ?? '?').toUpperCase();
}

export function Avatar({ id, name, size = 40, dim = false, ring = false }: { id: string; name: string; size?: number; dim?: boolean; ring?: boolean }) {
  const hue = avatarHue(id);
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full border font-bold ${ring ? 'animate-[var(--animate-ring)]' : ''} ${dim ? 'grayscale' : ''}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        color: `hsl(${hue} 90% 72%)`,
        borderColor: `hsl(${hue} 60% 45%)`,
        background: `radial-gradient(circle at 30% 25%, hsl(${hue} 55% 28%), hsl(${hue} 45% 12%))`,
      }}
    >
      {initialOf(name)}
    </span>
  );
}
