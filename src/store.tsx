import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CardPack, GameState, Scenario, VotingMode } from './types';
import { BUILTIN_PACKS } from './data/classicPack';
import { loadGame, loadPacks, saveGame, savePacks } from './lib/storage';
import { packFromHash } from './lib/packs';
import { uid } from './lib/rng';

export interface OnlineDraft {
  scenario: Scenario;
  packs: CardPack[];
  slots: number;
  voting: VotingMode;
  revealsPerVote: number;
  timeLimitMin: number;
}

export type Screen =
  | { name: 'home' }
  | { name: 'setup' }
  | { name: 'game' }
  | { name: 'packs' }
  | { name: 'editor'; packId: string }
  | { name: 'rules' }
  | { name: 'lobby'; draft: OnlineDraft }
  | { name: 'join'; code?: string; ticket?: string }
  | { name: 'install' };

interface Store {
  screen: Screen;
  go: (s: Screen) => void;
  builtinPacks: CardPack[];
  customPacks: CardPack[];
  allPacks: CardPack[];
  upsertPack: (p: CardPack) => void;
  removePack: (id: string) => void;
  game: GameState | null;
  setGame: (g: GameState | null | ((g: GameState | null) => GameState | null)) => void;
  incoming: CardPack | null;
  acceptIncoming: () => void;
  dismissIncoming: () => void;
  toast: string | null;
  notify: (msg: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [screen, go] = useState<Screen>({ name: 'home' });
  const [customPacks, setCustom] = useState<CardPack[]>(loadPacks);
  const [game, setGameState] = useState<GameState | null>(loadGame);
  const [incoming, setIncoming] = useState<CardPack | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => savePacks(customPacks), [customPacks]);
  useEffect(() => saveGame(game), [game]);

  // Ссылка-шеринг: #pack=... → предложение добавить пак.
  useEffect(() => {
    const check = () => {
      const join = /^#join=([A-Za-z0-9]{5})(?:\.([A-Za-z0-9]{6}))?$/.exec(window.location.hash);
      if (join) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        go({ name: 'join', code: join[1].toUpperCase(), ticket: join[2]?.toUpperCase() });
        return;
      }
      if (!window.location.hash.startsWith('#pack=')) return;
      const pack = packFromHash(window.location.hash);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      if (pack) setIncoming(pack);
      else setToast('Ссылка на пак повреждена');
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const upsertPack = useCallback((p: CardPack) => {
    setCustom((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]));
  }, []);
  const removePack = useCallback((id: string) => setCustom((l) => l.filter((p) => p.id !== id)), []);

  const acceptIncoming = useCallback(() => {
    if (!incoming) return;
    // Новый id, чтобы чужой пак не перезаписал существующий.
    upsertPack({ ...incoming, id: uid('pack'), isCustom: true });
    setToast(`Пак «${incoming.name}» добавлен`);
    setIncoming(null);
    go({ name: 'packs' });
  }, [incoming, upsertPack]);

  const value = useMemo<Store>(
    () => ({
      screen,
      go,
      builtinPacks: BUILTIN_PACKS,
      customPacks,
      allPacks: [...BUILTIN_PACKS, ...customPacks],
      upsertPack,
      removePack,
      game,
      setGame: setGameState,
      incoming,
      acceptIncoming,
      dismissIncoming: () => setIncoming(null),
      toast,
      notify: setToast,
    }),
    [screen, customPacks, game, incoming, toast, upsertPack, removePack, acceptIncoming],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
