import { lazy, Suspense, useEffect } from 'react';
import { useStore } from './store';
import Home from './screens/Home';
import Setup from './screens/Setup';
import Game from './screens/Game';
import { Modal } from './ui/bits';
import { useWakeLock } from './lib/wakelock';
import { packStats } from './lib/packs';
import { useSettings } from './lib/settings';
import { plural, t } from './lib/i18n';

// Второстепенные экраны подгружаются при первом открытии: основной бандл (главная, настройка партии, игра) остаётся лёгким.
const Packs = lazy(() => import('./screens/Packs'));
const Editor = lazy(() => import('./screens/Editor'));
const Rules = lazy(() => import('./screens/Rules'));
const Install = lazy(() => import('./screens/Install'));
const Builder = lazy(() => import('./screens/Builder'));
const Settings = lazy(() => import('./screens/Settings'));
const Join = lazy(() => import('./screens/Online').then((m) => ({ default: m.Join })));
const Lobby = lazy(() => import('./screens/Online').then((m) => ({ default: m.Lobby })));

export default function App() {
  const { screen, toast, incoming, acceptIncoming, dismissIncoming } = useStore();
  // Смена языка перерисовывает всё приложение: переводы берутся при рендере.
  useSettings();
  // Новый экран всегда открывается сверху, а не на прежней прокрутке.
  // Фигурные скобки важны: эффект не должен возвращать результат scrollTo — некоторые браузеры возвращают не undefined,
  // и React пытается вызвать это значение как функцию очистки.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen.name]);
  // Пока открыта партия или лобби, экран телефона не гаснет.
  useWakeLock(screen.name === 'game' || screen.name === 'lobby' || screen.name === 'join');
  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 pb-[env(safe-area-inset-bottom)]">
      <div key={screen.name} className="anim-rise">
      <Suspense fallback={null}>
      {screen.name === 'home' && <Home />}
      {screen.name === 'setup' && <Setup initialMode={screen.mode} initialPacks={screen.packIds} initialScenario={screen.scenarioId} />}
      {screen.name === 'builder' && <Builder scenarioId={screen.scenarioId} />}
      {screen.name === 'game' && <Game />}
      {screen.name === 'packs' && <Packs />}
      {screen.name === 'editor' && <Editor packId={screen.packId} />}
      {screen.name === 'rules' && <Rules />}
      {screen.name === 'install' && <Install />}
      {screen.name === 'settings' && <Settings />}
      {screen.name === 'lobby' && <Lobby draft={screen.draft} resume={screen.resume} />}
      {screen.name === 'join' && <Join initialCode={screen.code} initialTicket={screen.ticket} />}
      </Suspense>
      </div>

      {incoming && (
        <Modal title={t('Получен пак по ссылке')}>
          <p className="font-bold text-amber">{incoming.name}</p>
          <p className="mt-1 text-sm text-dim">{incoming.description}</p>
          <p className="mt-2 text-xs">
            {packStats(incoming).scenarios} {plural(packStats(incoming).scenarios, { ru: ['сценарий', 'сценария', 'сценариев'], uk: ['сценарій', 'сценарії', 'сценаріїв'], en: ['scenario', 'scenarios'], de: ['Szenario', 'Szenarien'] })} · {packStats(incoming).cards} {plural(packStats(incoming).cards, { ru: ['карта', 'карты', 'карт'], uk: ['картка', 'картки', 'карток'], en: ['card', 'cards'], de: ['Karte', 'Karten'] })}
          </p>
          <p className="mt-2 text-xs text-dim">{t('Пак придёт из внешнего источника — проверьте содержимое перед игрой.')}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="btn" onClick={dismissIncoming}>{t('Отклонить')}</button>
            <button className="btn btn-primary" onClick={acceptIncoming}>{t('Добавить')}</button>
          </div>
        </Modal>
      )}
      {toast && (
        <div role="status" className="anim-rise fixed inset-x-4 top-4 z-[60] mx-auto max-w-sm rounded-md border border-amber bg-panel/95 px-4 py-3 text-center text-sm text-amber shadow-[0_8px_30px_-6px_rgba(0,0,0,.8)] backdrop-blur-md">
          {toast}
        </div>
      )}
    </main>
  );
}
