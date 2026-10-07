import { useStore } from './store';
import Home from './screens/Home';
import Setup from './screens/Setup';
import Game from './screens/Game';
import Packs from './screens/Packs';
import Editor from './screens/Editor';
import Rules from './screens/Rules';
import { Join, Lobby } from './screens/Online';
import { Modal } from './ui/bits';
import { packStats } from './lib/packs';

export default function App() {
  const { screen, toast, incoming, acceptIncoming, dismissIncoming } = useStore();
  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 pb-[env(safe-area-inset-bottom)]">
      {screen.name === 'home' && <Home />}
      {screen.name === 'setup' && <Setup />}
      {screen.name === 'game' && <Game />}
      {screen.name === 'packs' && <Packs />}
      {screen.name === 'editor' && <Editor packId={screen.packId} />}
      {screen.name === 'rules' && <Rules />}
      {screen.name === 'lobby' && <Lobby draft={screen.draft} />}
      {screen.name === 'join' && <Join initialCode={screen.code} />}

      {incoming && (
        <Modal title="Получен пак по ссылке">
          <p className="font-bold text-amber">{incoming.name}</p>
          <p className="mt-1 text-sm text-dim">{incoming.description}</p>
          <p className="mt-2 text-xs">{packStats(incoming).scenarios} сценариев · {packStats(incoming).cards} карт</p>
          <p className="mt-2 text-xs text-dim">Пак придёт из внешнего источника — проверьте содержимое перед игрой.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="btn" onClick={dismissIncoming}>Отклонить</button>
            <button className="btn btn-primary" onClick={acceptIncoming}>Добавить</button>
          </div>
        </Modal>
      )}
      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-sm rounded-md border border-amber bg-panel px-4 py-3 text-center text-sm text-amber shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}
