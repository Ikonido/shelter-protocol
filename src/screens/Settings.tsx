import { ArrowLeft, Moon, Sun, Vibrate, Volume2 } from 'lucide-react';
import { useStore } from '../store';
import { DEFAULT_SETTINGS, updateSettings, useSettings } from '../lib/settings';
import { signal } from '../lib/feedback';

function Toggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-edge p-3">
      <input type="checkbox" className="mt-1 size-4 accent-amber" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm"><b>{title}</b><br /><span className="text-xs text-dim">{hint}</span></span>
    </label>
  );
}

export default function Settings() {
  const { go } = useStore();
  const s = useSettings();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-6">
      <button className="btn btn-sm self-start" onClick={() => go({ name: 'home' })}><ArrowLeft size={16} /> Назад</button>
      <h1 className="h-hud text-base">Настройки устройства</h1>
      <p className="text-xs text-dim">Хранятся только на этом телефоне или компьютере и не влияют на других игроков.</p>

      <section className="panel flex flex-col gap-3">
        <h2 className="step-title">Сигналы</h2>
        <Toggle checked={s.sound} onChange={(v) => { updateSettings({ sound: v }); if (v) signal('tick'); }} title="Звук" hint="Сигнал за 10 секунд до конца речи, в конце речи и когда время партии выходит; «ваш ход» в онлайне." />
        <Toggle checked={s.vibrate} onChange={(v) => { updateSettings({ vibrate: v }); if (v) signal('tick'); }} title="Вибрация" hint="То же, но вибрацией (работает не на всех телефонах)." />
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm" onClick={() => signal('warn')}><Volume2 size={14} /> Проверить сигнал</button>
          <button className="btn btn-sm" onClick={() => signal('end')}><Vibrate size={14} /> Проверить конец времени</button>
        </div>
      </section>

      <section className="panel flex flex-col gap-3">
        <h2 className="step-title">Вид</h2>
        <div>
          <span className="label">Тема</span>
          <div className="grid grid-cols-2 gap-2">
            <button className={`btn ${s.theme === 'dark' ? 'btn-primary' : ''}`} aria-pressed={s.theme === 'dark'} onClick={() => updateSettings({ theme: 'dark' })}><Moon size={16} /> Тёмная</button>
            <button className={`btn ${s.theme === 'light' ? 'btn-primary' : ''}`} aria-pressed={s.theme === 'light'} onClick={() => updateSettings({ theme: 'light' })}><Sun size={16} /> Светлая</button>
          </div>
        </div>
        <div>
          <span className="label">Размер текста</span>
          <div className="grid grid-cols-3 gap-2">
            {([['normal', 'Обычный'], ['large', 'Крупный'], ['xl', 'Очень крупный']] as const).map(([v, label]) => (
              <button key={v} className={`btn btn-sm ${s.textSize === v ? 'btn-primary' : ''}`} aria-pressed={s.textSize === v} onClick={() => updateSettings({ textSize: v })}>{label}</button>
            ))}
          </div>
        </div>
      </section>

      <button className="btn btn-sm self-start" onClick={() => updateSettings(DEFAULT_SETTINGS)}>Сбросить настройки</button>
    </div>
  );
}
