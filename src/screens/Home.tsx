import { BookOpen, Globe, Library, Play, RotateCcw, ShieldAlert, Smartphone } from 'lucide-react';
import { isStandalone } from '../lib/pwa';
import { useStore } from '../store';

export default function Home() {
  const { go, game, setGame } = useStore();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 py-10">
      <header className="text-center">
        <ShieldAlert className="mx-auto mb-3 text-amber" size={56} strokeWidth={1.5} />
        <h1 className="text-3xl font-bold uppercase tracking-[.2em] text-amber">Протокол «Убежище»</h1>
        <p className="mt-3 text-sm text-dim">
          Мест на всех не хватит. Откройте карты, убедите остальных — и решите, кто войдёт в бункер.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {game && game.phase !== 'final' && (
          <button className="btn btn-primary" onClick={() => go({ name: 'game' })}>
            <Play size={18} /> Продолжить партию (раунд {game.round})
          </button>
        )}
        <button className="btn btn-primary" onClick={() => go({ name: 'setup' })}>
          <Play size={18} /> Новая игра
        </button>
        <button className="btn" onClick={() => go({ name: 'join' })}>
          <Globe size={18} /> Войти в онлайн-комнату
        </button>
        {game && game.phase === 'final' && (
          <button className="btn" onClick={() => go({ name: 'game' })}>
            <RotateCcw size={18} /> Результаты прошлой партии
          </button>
        )}
        <button className="btn" onClick={() => go({ name: 'packs' })}>
          <Library size={18} /> Паки и редактор
        </button>
        {!isStandalone() && (
          <button className="btn" onClick={() => go({ name: 'install' })}>
            <Smartphone size={18} /> Установить на телефон
          </button>
        )}
        <button className="btn" onClick={() => go({ name: 'rules' })}>
          <BookOpen size={18} /> Правила
        </button>
        {game && (
          <button
            className="btn btn-sm btn-danger"
            onClick={() => confirm('Удалить сохранённую партию?') && setGame(null)}
          >
            Сбросить сохранённую партию
          </button>
        )}
      </div>
      <p className="text-center text-xs text-dim">Работает офлайн · данные хранятся только в вашем браузере</p>
    </div>
  );
}
