import { useState } from 'react';
import { Dices, Eye, EyeOff, Printer, UserX, UserCheck } from 'lucide-react';
import { CATEGORIES, categoryLabel, type GameState } from '../types';
import { CardFace } from '../ui/bits';
import { useStore } from '../store';
import { rerollCard } from '../lib/generator';
import { setEliminated } from '../lib/game';
import { FinalReport } from './Final';
import { Avatar } from '../ui/Avatar';
import { ThreatsPanel } from '../ui/Threats';
import { copyText } from '../ui/clipboard';
import { t } from '../lib/i18n';

/** Режим «генератор карточек»: раздаём персонажей на бумаге/в мессенджер, а исход считаем по отметкам выживших. */
export default function Tabletop({ game }: { game: GameState }) {
  const { allPacks, setGame, notify } = useStore();
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const packs = allPacks.filter((p) => game.config.packIds.includes(p.id));
  const survivors = game.players.filter((p) => !p.isEliminated).length;

  const copyCard = (id: string) => {
    const p = game.players.find((x) => x.id === id)!;
    const text = `${p.name}\n` + CATEGORIES.map((c) => {
      const card = p.slots[c].card;
      return `${categoryLabel(c)}: ${card.title ? t(card.title) + '. ' : ''}${t(card.description)}`;
    }).join('\n');
    copyText(text).then((ok) => notify(ok ? t('Карточка скопирована') : t('Не удалось скопировать')));
  };

  return (
    <div className="flex flex-col gap-5">
      <ThreatsPanel hazards={game.hazards ?? []} defaultOpen />
      <div className="no-print flex flex-wrap gap-2">
        <button className="btn btn-sm" onClick={() => window.print()}><Printer size={16} /> {t('Печать карточек')}</button>
        <button className="btn btn-sm" onClick={() => setShown(Object.fromEntries(game.players.map((p) => [p.id, true])))}><Eye size={16} /> {t('Показать все')}</button>
        <button className="btn btn-sm" onClick={() => setShown({})}><EyeOff size={16} /> {t('Скрыть все')}</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {game.players.map((p) => {
          const visible = !!shown[p.id];
          return (
            <section key={p.id} className={`panel print-card ${p.isEliminated ? 'opacity-50' : ''}`}>
              <div className="mb-3 flex items-center gap-2">
                <Avatar id={p.id} name={p.name} size={32} dim={p.isEliminated} />
                <h3 className="font-bold text-amber">{p.name}</h3>
                <button className="btn btn-sm no-print ml-auto" onClick={() => setShown((s) => ({ ...s, [p.id]: !visible }))}>
                  {visible ? <EyeOff size={14} /> : <Eye size={14} />}{visible ? t('Скрыть') : t('Показать')}
                </button>
                <button className="btn btn-sm no-print" onClick={() => copyCard(p.id)}>{t('Копир.')}</button>
              </div>
              {!visible && <p className="no-print text-xs tracking-widest text-dim">{t('▓▓▓▓▓▓ карточка скрыта — нажмите «Показать», когда её держит владелец')}</p>}
              <div className={`flex flex-col gap-2 ${visible ? '' : 'hidden print:flex'}`}>
                {CATEGORIES.map((c) => (
                  <CardFace
                    key={c}
                    card={p.slots[c].card}
                    // На экране скрытый блок не показывается вовсе, а на бумагу карточки печатаются с содержимым.
                    hidden={false}
                    compact
                    extra={visible && (
                      <button
                        className="no-print self-end text-[10px] uppercase tracking-widest text-dim hover:text-amber"
                        onClick={() => setGame((g) => (g ? { ...g, players: g.players.map((x) => (x.id === p.id ? rerollCard(x, c, packs, Math.random) : x)) } : g))}
                      >
                        <Dices className="mr-1 inline" size={12} />{t('перекинуть')}
                      </button>
                    )}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <section className="panel no-print">
        <h2 className="h-hud mb-1">{t('Итог партии')}</h2>
        <p className="mb-3 text-xs text-dim">
          {t('Проведите раунды за столом, затем отметьте исключённых. Выжило: {alive} из {total} (мест: {slots}).', { alive: survivors, total: game.players.length, slots: game.config.shelterSlots })}
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {game.players.map((p) => (
            <button key={p.id} className={`btn btn-sm ${p.isEliminated ? 'btn-danger line-through' : ''}`} onClick={() => setGame((g) => (g ? setEliminated(g, p.id, !p.isEliminated) : g))}>
              {p.isEliminated ? <UserX size={14} /> : <UserCheck size={14} />} {p.name}
            </button>
          ))}
        </div>
        <FinalReport game={game} auto={false} />
      </section>
    </div>
  );
}
