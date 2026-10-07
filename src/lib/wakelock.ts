import { useEffect } from 'react';

type Sentinel = { release(): Promise<void>; addEventListener(t: 'release', cb: () => void): void };

/** Не даёт экрану гаснуть, пока идёт партия (Screen Wake Lock). Если браузер не умеет — тихо ничего не делает. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } }).wakeLock;
    if (!active || !wl) return;
    let sentinel: Sentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      try {
        const s = await wl.request('screen');
        if (stopped) return void s.release().catch(() => undefined);
        sentinel = s;
      } catch {
        /* отказ (экономия батареи, вкладка в фоне) — не критично */
      }
    };
    // Блокировка снимается при сворачивании вкладки: возвращаем её при возвращении.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
