import { CheckCircle2, CloudOff, Download, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { APP_VERSION, formatBuilt } from '../lib/update';
import { runApply, runCheck, useUpdateUi } from '../lib/updateStore';

/** Баннер «вышла новая версия» (появляется сам после тихой проверки). */
export function UpdateBanner() {
  const ui = useUpdateUi();
  if (ui.phase !== 'available' && ui.phase !== 'applying') return null;
  return (
    <div role="status" className="panel hud flex items-center gap-3 border-amber p-3 text-sm">
      <Download size={20} className="shrink-0 text-amber" />
      <div className="min-w-0 flex-1">
        <b className="text-amber">Вышла новая версия</b>
        <p className="text-xs text-dim">Партии и паки сохранятся.</p>
      </div>
      <button className="btn btn-primary btn-sm" disabled={ui.phase === 'applying'} onClick={() => void runApply()}>
        {ui.phase === 'applying' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Обновить
      </button>
    </div>
  );
}

/** Версия приложения и кнопка проверки обновлений. */
export function UpdateButton() {
  const ui = useUpdateUi();
  const built = formatBuilt(APP_VERSION.builtAt);
  const busy = ui.phase === 'checking' || ui.phase === 'applying';
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="text-[11px] text-dim">
        Версия <b className="text-ink">{APP_VERSION.id}</b>
        {built && <> · собрана {built}</>}
      </p>
      {ui.phase === 'available' || ui.phase === 'applying' ? (
        <button className="btn btn-primary btn-sm" disabled={ui.phase === 'applying'} onClick={() => void runApply()}>
          {ui.phase === 'applying' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {ui.phase === 'applying' ? 'Обновляю…' : `Обновить до ${ui.latest.id}`}
        </button>
      ) : (
        <button className="btn btn-sm" disabled={busy} onClick={() => void runCheck()}>
          {ui.phase === 'checking' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {ui.phase === 'checking' ? 'Проверяю…' : 'Проверить обновления'}
        </button>
      )}
      <p aria-live="polite" className="min-h-4 text-xs">
        {ui.phase === 'latest' && <span className="inline-flex items-center gap-1 text-ok"><CheckCircle2 size={13} /> У вас последняя версия</span>}
        {ui.phase === 'offline' && <span className="inline-flex items-center gap-1 text-amber"><CloudOff size={13} /> Нет связи: проверьте интернет и повторите</span>}
        {ui.phase === 'error' && <span className="inline-flex items-center gap-1 text-danger"><TriangleAlert size={13} /> {ui.reason}</span>}
      </p>
    </div>
  );
}
