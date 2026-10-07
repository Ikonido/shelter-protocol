import { useSyncExternalStore } from 'react';

/** Личные настройки устройства: звук, вибрация, тема и размер текста. Хранятся только в этом браузере. */
export interface Settings {
  sound: boolean;
  vibrate: boolean;
  theme: 'dark' | 'light';
  textSize: 'normal' | 'large' | 'xl';
}

export const DEFAULT_SETTINGS: Settings = { sound: true, vibrate: true, theme: 'dark', textSize: 'normal' };
const KEY = 'shelter:settings';
const SIZE_PX = { normal: 16, large: 18, xl: 20 } as const;

/** Разбор сохранённого значения: любые лишние или повреждённые поля отбрасываются. */
export function parseSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    sound: typeof r.sound === 'boolean' ? r.sound : DEFAULT_SETTINGS.sound,
    vibrate: typeof r.vibrate === 'boolean' ? r.vibrate : DEFAULT_SETTINGS.vibrate,
    theme: r.theme === 'light' ? 'light' : 'dark',
    textSize: r.textSize === 'large' || r.textSize === 'xl' ? r.textSize : 'normal',
  };
}

function load(): Settings {
  try {
    const v = localStorage.getItem(KEY);
    return parseSettings(v ? JSON.parse(v) : null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

/** Применяет тему и размер текста к странице. */
export function applySettings(s: Settings = current) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.style.fontSize = `${SIZE_PX[s.textSize]}px`;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', s.theme === 'light' ? '#f4f1e8' : '#060a09');
}

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>) {
  current = parseSettings({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* приватный режим: настройки живут до перезагрузки */
  }
  applySettings(current);
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
