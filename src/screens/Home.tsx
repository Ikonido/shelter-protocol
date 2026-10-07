import { BookOpen, ChevronRight, Globe, Library, Play, QrCode, RotateCcw, Smartphone, type LucideIcon } from 'lucide-react';
import { useStore, type Screen } from '../store';
import { Emblem } from '../ui/Emblem';
import { isStandalone } from '../lib/pwa';

function MenuItem({ icon: Icon, title, hint, onClick }: { icon: LucideIcon; title: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="panel group flex items-center gap-3 p-3 text-left transition hover:border-amber active:scale-[.99]">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-edge bg-bg text-amber transition group-hover:border-amber"><Icon size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold uppercase tracking-wider">{title}</span>
        <span className="block text-xs leading-snug text-dim">{hint}</span>
      </span>
      <ChevronRight size={16} className="text-dim transition group-hover:translate-x-0.5 group-hover:text-amber" />
    </button>
  );
}

export default function Home() {
  const { go, game, setGame } = useStore();
  const to = (s: Screen) => () => go(s);
  const resumable = game && game.phase !== 'final';
  return (
    <div className="mx-auto grid max-w-5xl items-center gap-8 py-8 lg:min-h-dvh lg:grid-cols-2 lg:gap-14 lg:py-0">
      <header className="anim-rise text-center lg:text-left">
        <Emblem size={176} />
        <p className="mt-5 text-[10px] uppercase tracking-[.5em] text-dim">Игра на выживание для компании</p>
        <h1 className="mt-2 text-4xl font-bold uppercase leading-tight tracking-[.12em] text-amber [text-shadow:0_0_28px_rgba(251,191,36,.35)] sm:text-5xl">
          Протокол<br />«Убежище»
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-dim lg:mx-0">
          Мест на всех не хватит. Откройте карты, убедите остальных, что вы нужны бункеру, — и решите, кто войдёт внутрь.
        </p>
        <ul className="mt-5 flex flex-wrap justify-center gap-2 lg:justify-start">
          {['2–20 игроков', 'один телефон или у каждого свой', 'без интернета в LAN', 'свои паки'].map((t) => <li key={t} className="chip">{t}</li>)}
        </ul>
      </header>

      <nav className="anim-rise flex flex-col gap-3" style={{ animationDelay: '.08s' }} aria-label="Главное меню">
        {resumable && (
          <button className="btn btn-primary hud min-h-14 justify-between" onClick={to({ name: 'game' })}>
            <span className="flex items-center gap-2"><Play size={18} /> Продолжить партию</span>
            <span className="text-xs opacity-80">раунд {game.round}</span>
          </button>
        )}
        <button className={`btn min-h-14 ${resumable ? '' : 'btn-primary hud'}`} onClick={to({ name: 'setup' })}>
          <Play size={18} /> Новая игра
        </button>
        <button className="btn min-h-12 border-amber/50 text-amber" onClick={to({ name: 'setup', mode: 'online' })}>
          <QrCode size={18} /> Создать онлайн-комнату <span className="hidden text-[10px] opacity-70 sm:inline">код и QR для друзей</span>
        </button>
        <div className="grid gap-3 sm:grid-cols-2">
          <MenuItem icon={Globe} title="Войти в комнату" hint="по коду или QR от друга" onClick={to({ name: 'join' })} />
          <MenuItem icon={Library} title="Паки" hint="свои сценарии и карты" onClick={to({ name: 'packs' })} />
          {!isStandalone() && <MenuItem icon={Smartphone} title="На телефон" hint="установить, работает офлайн" onClick={to({ name: 'install' })} />}
          <MenuItem icon={BookOpen} title="Правила" hint="разберётесь за минуту" onClick={to({ name: 'rules' })} />
          {game && game.phase === 'final' && <MenuItem icon={RotateCcw} title="Итоги" hint="прошлой партии" onClick={to({ name: 'game' })} />}
        </div>
        {game && (
          <button className="self-center text-xs uppercase tracking-widest text-dim underline-offset-4 hover:text-danger hover:underline" onClick={() => confirm('Удалить сохранённую партию?') && setGame(null)}>
            сбросить сохранённую партию
          </button>
        )}
        <p className="text-center text-[11px] text-dim">Работает офлайн · данные хранятся только в вашем браузере</p>
      </nav>
    </div>
  );
}
