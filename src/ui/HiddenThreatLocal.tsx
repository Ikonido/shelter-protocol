import { useState } from 'react';
import type { GameState } from '../types';
import { t } from '../lib/i18n';
import { auxiliaryAction, cooperate } from '../lib/hiddenThreat/economy';
import { publishFinding, submitSecret } from '../lib/hiddenThreat/engine';
import { threatViewFor } from '../lib/hiddenThreat/views';
import { PrivateAccess, ThreatPrivatePanel } from './HiddenThreatPrivate';
import { ThreatAuxiliary } from './HiddenThreatPublic';

export function LocalThreatHub({
  game,
  update,
  sequential = false,
}: {
  game: GameState;
  update: (fn: (g: GameState) => GameState) => void;
  sequential?: boolean;
}) {
  const [selected, setSelected] = useState('');
  const next = game.players.find(
    (p) => !p.isEliminated && !game.hiddenThreat?.pending[p.id],
  );
  const actor = sequential ? next?.id : selected;
  if (!game.hiddenThreat || game.phase === 'final') return null;
  const player = game.players.find((p) => p.id === actor);
  return (
    <div className="no-print flex flex-col gap-3">
      {!sequential && (
        <section className="panel">
          <h2 className="label">{t('Личное досье')}</h2>
          <select
            className="input"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">{t('Выберите владельца устройства')}</option>
            {game.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </section>
      )}
      {sequential && (
        <p className="panel text-sm">
          {t(
            'Все живые кандидаты подтверждают секретный выбор или пропуск. Передавайте устройство по очереди',
          )}
        </p>
      )}
      {player && (
        <PrivateAccess
          key={`${game.round}:${game.phase}:${game.hiddenThreat.public.publicationsReleased.length}:${actor}`}
          name={player.name}
          render={(close) => {
            const projection = threatViewFor(game, player.id)!;
            return (
              <>
                <ThreatPrivatePanel
                  game={{
                    ...game,
                    hiddenThreat: undefined,
                    threatView: projection,
                  }}
                  mine={projection.mine!}
                  onClose={() => {
                    close();
                    setSelected('');
                  }}
                  onSubmit={(command) =>
                    update((g) => submitSecret(g, player.id, command))
                  }
                  onPublish={(id) =>
                    update((g) => publishFinding(g, player.id, id))
                  }
                />
                <ThreatAuxiliary
                  game={game}
                  actor={player.id}
                  onAction={(target, kind) =>
                    update((g) => auxiliaryAction(g, player.id, target, kind))
                  }
                  onCooperate={() => update((g) => cooperate(g, player.id))}
                />
              </>
            );
          }}
        />
      )}
    </div>
  );
}
