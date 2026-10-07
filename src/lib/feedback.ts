import { getSettings } from './settings';

let ctx: AudioContext | null = null;

/** Звук можно запускать только после касания пользователя: создаём контекст лениво и «будим» его первым жестом. */
function audio(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Вызывайте один раз при старте: первый жест разблокирует звук на телефонах. */
export function unlockAudio() {
  const once = () => {
    audio();
    window.removeEventListener('pointerdown', once);
  };
  window.addEventListener('pointerdown', once);
}

type Tone = 'tick' | 'warn' | 'end' | 'turn';
const TONES: Record<Tone, { freq: number[]; ms: number }> = {
  tick: { freq: [660], ms: 90 },
  warn: { freq: [520, 520], ms: 140 },
  end: { freq: [440, 330, 220], ms: 220 },
  turn: { freq: [660, 880], ms: 150 },
};
const BUZZ: Record<Tone, number | number[]> = { tick: 30, warn: [80, 60, 80], end: [250, 80, 250], turn: [120, 60, 120] };

/** Короткий сигнал и/или вибрация согласно настройкам устройства. Ничего не бросает: звук и вибрация необязательны. */
export function signal(tone: Tone) {
  const s = getSettings();
  if (s.vibrate) {
    try {
      navigator.vibrate?.(BUZZ[tone]);
    } catch {
      /* не критично */
    }
  }
  if (!s.sound) return;
  const a = audio();
  if (!a) return;
  const { freq, ms } = TONES[tone];
  freq.forEach((f, i) => {
    const osc = a.createOscillator();
    const gain = a.createGain();
    const t0 = a.currentTime + (i * ms) / 1000;
    osc.frequency.value = f;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(gain).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  });
}
