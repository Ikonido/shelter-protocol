import { useEffect, useState } from 'react';
import { APP_VERSION, applyUpdate, checkForUpdate, type AppVersion } from './update';

export type UpdateUi =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'latest'; latest: AppVersion }
  | { phase: 'available'; latest: AppVersion }
  | { phase: 'offline' }
  | { phase: 'error'; reason: string }
  | { phase: 'applying' };

let state: UpdateUi = { phase: 'idle' };
const listeners = new Set<() => void>();
const set = (s: UpdateUi) => {
  state = s;
  listeners.forEach((cb) => cb());
};

export function useUpdateUi(): UpdateUi {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force((n) => n + 1);
    listeners.add(cb);
    return () => void listeners.delete(cb);
  }, []);
  return state;
}

/** Ручная проверка: показывает любой результат (последняя версия, нет сети, ошибка). */
export async function runCheck(): Promise<void> {
  if (state.phase === 'checking' || state.phase === 'applying') return;
  set({ phase: 'checking' });
  const r = await checkForUpdate();
  if (r.status === 'latest') set({ phase: 'latest', latest: r.latest });
  else if (r.status === 'available') set({ phase: 'available', latest: r.latest });
  else if (r.status === 'offline') set({ phase: 'offline' });
  else set({ phase: 'error', reason: r.reason });
}

export async function runApply(): Promise<void> {
  set({ phase: 'applying' });
  try {
    await applyUpdate();
  } catch (e) {
    set({ phase: 'error', reason: (e as Error).message || 'Не удалось обновить' });
  }
}

const MIN_GAP_MS = 30 * 60_000;
let lastAuto = 0;

/** Тихая проверка при запуске и когда приложение возвращается на экран (не чаще раза в 30 минут): шумим только если есть новая версия. */
export function startAutoCheck(): void {
  const run = async () => {
    if (APP_VERSION.id === 'dev' || document.visibilityState !== 'visible' || Date.now() - lastAuto < MIN_GAP_MS) return;
    if (state.phase === 'checking' || state.phase === 'applying' || state.phase === 'available') return;
    lastAuto = Date.now();
    const r = await checkForUpdate();
    if (r.status === 'available') set({ phase: 'available', latest: r.latest });
  };
  void run();
  document.addEventListener('visibilitychange', () => void run());
}
