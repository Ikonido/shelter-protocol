import {
  CATEGORIES,
  type Card,
  type CardPack,
  type Category,
  type GameState,
  type PlayerCharacter,
  type Scenario,
  type VotingMode,
} from '../types';
import {
  alive,
  allVoted,
  castVote,
  createGame,
  nextRound,
  pendingReveal,
  playAction,
  resolveVote,
  revealCard,
  revealOptions,
  startVote,
} from './game';
import { newSeed } from './rng';

/* ---------- Протокол ---------- */

export type C2H =
  | { t: 'hello'; name: string; token: string }
  | { t: 'reveal'; category: Category }
  | { t: 'action' }
  | { t: 'vote'; target: string };

export interface LobbyMember {
  name: string;
  connected: boolean;
}
export type H2C =
  | { t: 'lobby'; members: LobbyMember[]; scenario: string; slots: number; you: number }
  | { t: 'view'; view: GameState; me: string }
  | { t: 'reject'; reason: string };

/** Минимальный дуплексный канал: в проде — WebRTC DataChannel (PeerJS), в тестах — in-memory. */
export interface Conn<Out> {
  send(m: Out): void;
  onMessage(cb: (m: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export const MAX_ONLINE_PLAYERS = 20;

/* ---------- Маскирование состояния ---------- */

const hiddenCard = (category: Category): Card => ({ id: `hidden-${category}`, category, description: '???' });

/** Что игрок `me` вправе знать: чужие закрытые карты вырезаются на хосте, до клиента они не доходят. */
export function viewFor(g: GameState, me: string, voting: VotingMode = g.config.voting): GameState {
  const final = g.phase === 'final';
  const players: PlayerCharacter[] = g.players.map((p) => {
    if (p.id === me || (final && !p.isEliminated)) return p;
    const slots = Object.fromEntries(
      CATEGORIES.map((c) => [c, p.slots[c].isRevealed ? p.slots[c] : { card: hiddenCard(c), isRevealed: false }]),
    ) as PlayerCharacter['slots'];
    return { ...p, slots };
  });
  const votes =
    voting === 'secret' && g.phase === 'vote'
      ? Object.fromEntries(Object.keys(g.votes).map((v) => [v, v === me ? g.votes[v] : v]))
      : g.votes;
  return { ...g, players, votes, seed: 0, config: { ...g.config, seed: 0 } };
}

/* ---------- Хост ---------- */

interface Member {
  token: string;
  name: string;
  conn: Conn<H2C> | null; // null — сам хост
  connected: boolean;
  playerId?: string;
}

export interface HostSetup {
  scenario: Scenario;
  packs: CardPack[];
  slots: number;
  voting: VotingMode;
}

const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 24) : '');

export class OnlineHost {
  members: Member[];
  game: GameState | null = null;
  private listeners = new Set<() => void>();

  constructor(
    public setup: HostSetup,
    hostName = 'Хост',
  ) {
    this.members = [{ token: 'host', name: cleanName(hostName) || 'Хост', conn: null, connected: true }];
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  addConn(conn: Conn<H2C>) {
    conn.onMessage((raw) => this.onRaw(conn, raw));
    conn.onClose(() => {
      const m = this.members.find((x) => x.conn === conn);
      if (m) {
        m.connected = false;
        m.conn = null;
        this.changed();
      }
    });
  }

  private onRaw(conn: Conn<H2C>, raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;
    if (msg.t === 'hello') {
      const token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : '';
      const name = cleanName(msg.name);
      if (!token || !name || token === 'host') return conn.send({ t: 'reject', reason: 'Некорректные данные' });
      const known = this.members.find((m) => m.token === token);
      if (known) {
        known.conn?.close();
        known.conn = conn;
        known.connected = true;
      } else if (this.game) {
        return conn.send({ t: 'reject', reason: 'Партия уже началась' });
      } else if (this.members.length >= MAX_ONLINE_PLAYERS) {
        return conn.send({ t: 'reject', reason: 'Комната заполнена' });
      } else {
        this.members.push({ token, name, conn, connected: true });
      }
      return this.changed();
    }
    const member = this.members.find((m) => m.conn === conn);
    if (!member) return;
    if (msg.t === 'reveal' && CATEGORIES.includes(msg.category as Category)) this.act(member, { t: 'reveal', category: msg.category as Category });
    else if (msg.t === 'action') this.act(member, { t: 'action' });
    else if (msg.t === 'vote' && typeof msg.target === 'string') this.act(member, { t: 'vote', target: msg.target });
  }

  /** Действие игрока (в том числе самого хоста через index 0). Все проверки — здесь, клиенту не доверяем. */
  act(member: Member, msg: Exclude<C2H, { t: 'hello' }>) {
    const g = this.game;
    const id = member.playerId;
    if (!g || !id) return;
    const me = g.players.find((p) => p.id === id);
    if (!me || me.isEliminated) return;
    let next = g;
    if (msg.t === 'reveal') next = revealCard(g, id, msg.category);
    else if (msg.t === 'action') {
      if (g.phase === 'reveal' || g.phase === 'debate') next = playAction(g, id);
    } else if (msg.t === 'vote' && g.phase === 'vote') {
      const target = alive(g).find((p) => p.id === msg.target);
      if (target) next = castVote(g, id, target.id);
      if (allVoted(next)) next = resolveVote(next);
    }
    if (next !== g) this.setGame(next);
  }

  actAsHost(msg: Exclude<C2H, { t: 'hello' }>) {
    this.act(this.members[0], msg);
  }

  rename(name: string) {
    this.members[0].name = cleanName(name) || 'Хост';
    this.changed();
  }

  start(): boolean {
    if (this.game || this.members.length < 2) return false;
    const names = uniqueNames(this.members.map((m) => m.name));
    const n = names.length;
    const g = createGame(
      {
        scenarioId: this.setup.scenario.id,
        packIds: this.setup.packs.map((p) => p.id),
        playerCount: n,
        shelterSlots: Math.max(1, Math.min(this.setup.slots, n - 1)),
        mode: 'online',
        voting: this.setup.voting,
        names,
        seed: newSeed(),
      },
      this.setup.scenario,
      this.setup.packs,
    );
    this.members.forEach((m, i) => (m.playerId = g.players[i].id));
    this.setGame(g);
    return true;
  }

  /* Управление раундом — только у хоста */
  toVote() {
    if (this.game?.phase === 'debate') this.setGame(startVote(this.game));
  }
  next() {
    if (this.game?.phase === 'result') this.setGame(nextRound(this.game));
  }
  /** Автоход за отключившихся: открыть первую доступную карту / отдать голос за случайного, чтобы партия не зависла. */
  autofillDisconnected() {
    let g = this.game;
    if (!g) return;
    for (const m of this.members) {
      if (m.connected || !m.playerId) continue;
      const p = g.players.find((x) => x.id === m.playerId);
      if (!p || p.isEliminated) continue;
      if (g.phase === 'reveal' && pendingReveal(g).some((x) => x.id === p.id)) {
        g = revealCard(g, p.id, revealOptions(g, p)[0]);
      } else if (g.phase === 'vote' && !g.votes[p.id]) {
        const others = alive(g).filter((x) => x.id !== p.id);
        if (others.length) g = castVote(g, p.id, others[Math.floor(Math.random() * others.length)].id);
      }
    }
    if (g.phase === 'vote' && allVoted(g)) g = resolveVote(g);
    if (g !== this.game) this.setGame(g);
  }

  disconnectedPending(): string[] {
    return this.members.filter((m) => !m.connected).map((m) => m.name);
  }

  viewFor(index: number): GameState | null {
    const m = this.members[index];
    return this.game && m?.playerId ? viewFor(this.game, m.playerId) : null;
  }

  destroy() {
    this.members.forEach((m) => m.conn?.close());
    this.listeners.clear();
  }

  private setGame(g: GameState) {
    this.game = g;
    this.changed();
  }

  private changed() {
    this.members.forEach((m, i) => {
      if (!m.conn || !m.connected) return;
      if (this.game && m.playerId) m.conn.send({ t: 'view', view: viewFor(this.game, m.playerId), me: m.playerId });
      else
        m.conn.send({
          t: 'lobby',
          members: this.members.map((x) => ({ name: x.name, connected: x.connected })),
          scenario: this.setup.scenario.title,
          slots: this.setup.slots,
          you: i,
        });
    });
    this.listeners.forEach((cb) => cb());
  }
}

function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const c = (seen.get(n) ?? 0) + 1;
    seen.set(n, c);
    return c > 1 ? `${n} ${c}` : n;
  });
}

/* ---------- Клиент ---------- */

export type ClientState =
  | { status: 'connecting' }
  | { status: 'lobby'; members: LobbyMember[]; scenario: string; slots: number; you: number }
  | { status: 'game'; view: GameState; me: string }
  | { status: 'closed' }
  | { status: 'rejected'; reason: string };

export class OnlineClient {
  state: ClientState = { status: 'connecting' };
  private listeners = new Set<() => void>();

  constructor(
    private conn: Conn<C2H>,
    name: string,
    token: string,
  ) {
    conn.onMessage((raw) => this.onRaw(raw));
    conn.onClose(() => {
      if (this.state.status !== 'rejected') this.set({ status: 'closed' });
    });
    conn.send({ t: 'hello', name, token });
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
  send(m: Exclude<C2H, { t: 'hello' }>) {
    this.conn.send(m);
  }
  destroy() {
    this.conn.close();
    this.listeners.clear();
  }

  private set(s: ClientState) {
    this.state = s;
    this.listeners.forEach((cb) => cb());
  }

  private onRaw(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const m = raw as Partial<H2C> & Record<string, unknown>;
    if (m.t === 'reject') this.set({ status: 'rejected', reason: typeof m.reason === 'string' ? m.reason.slice(0, 100) : 'Отказано' });
    else if (m.t === 'lobby' && Array.isArray(m.members)) this.set({ status: 'lobby', members: m.members, scenario: String(m.scenario ?? ''), slots: Number(m.slots) || 0, you: Number(m.you) || 0 });
    else if (m.t === 'view' && typeof m.me === 'string' && m.view && Array.isArray(m.view.players) && m.view.scenario) this.set({ status: 'game', view: m.view, me: m.me });
  }
}
