import { Skull } from 'lucide-react';
import type { PlayerCharacter, RoundResult } from '../types';
import { Avatar } from './Avatar';
import { t } from '../lib/i18n';

/** Итоги голосования: строка на игрока с полоской голосов; исключённые подсвечены. */
export function Tally({ players, result }: { players: PlayerCharacter[]; result: RoundResult }) {
  const rows = Object.entries(result.tally).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return (
    <ul className="flex flex-col gap-2" aria-label={t('Результаты голосования')}>
      {rows.map(([id, v]) => {
        const p = players.find((x) => x.id === id);
        if (!p) return null;
        const out = result.eliminated.includes(id);
        return (
          <li key={id} className={`flex items-center gap-3 rounded-md border p-2 ${out ? 'border-danger/50 bg-danger/10' : 'border-edge'}`}>
            <Avatar id={p.id} name={p.name} size={32} dim={out} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className={`truncate font-bold ${out ? 'text-danger' : ''}`}>{p.name}</span>
                {out && <span className="ml-auto flex items-center gap-1 text-[10px] uppercase tracking-widest text-danger"><Skull size={12} /> {t('покидает игру')}</span>}
              </div>
              <div className="mt-1 h-1.5 rounded bg-edge"><div className={`h-1.5 rounded transition-all duration-700 ${out ? 'bg-danger' : 'bg-amber'}`} style={{ width: `${(v / max) * 100}%` }} /></div>
            </div>
            <span className="w-6 text-right text-lg font-bold tabular-nums">{v}</span>
          </li>
        );
      })}
    </ul>
  );
}
