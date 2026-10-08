import {
  ACTION_EFFECTS,
  CATEGORIES,
  type ActionEffect,
  type ActiveEvent,
  type Card,
  type CardPack,
  type Category,
  type Difficulty,
  type GameState,
  type Hazard,
  type PlayerCharacter,
  type Perk,
  type PerkResult,
  type Scenario,
  type VotingMode,
} from '../types';
import {
  alive,
  allVoted,
  castVote,
  createGame,
  nextRound,
  playAction,
  playPerk,
  resolveVote,
  revealCard,
  revealOptions,
  ABSTAIN,
  continueEvent,
  currentSpeaker,
  endSpeech,
  extendDeadline,
  tickGame,
  volunteer,
  MAX_TOTAL_ROUNDS,
} from './game';
import { canApply } from './actions';
import { MAX_ITEMS } from './inventory';
import { canApplyPerk, skipPerk } from './perks';
import { newSeed, randomCode } from './rng';
import { LIMITS as L, clip } from './limits';
import { sanitizeHazard, sanitizeScenario } from './packs';
import { t } from './i18n';
import type { SecretCommand, ThreatConfig } from './threat/types';
import { finishSecret, parseSecretCommand, submitSecret, allSecretReady } from './threat/engine';
import { auxiliaryAction, type Auxiliary } from './threat/economy';
import { validateThreatConfig } from './threat/roles';
import { sanitizeThreatView, threatViewFor } from './threat/projection';
import { validateSavedGame } from './storage';

/* ---------- Протокол ---------- */

export type C2H =
  | { t: 'secret'; command: SecretCommand }
  | { t: 'auxiliary'; round: number; kind: Auxiliary; target: string; itemId?: string }
  | { t: 'hello'; name: string; token: string; ticket?: string }
  | { t: 'reveal'; category: Category }
  | { t: 'action'; target?: string; category?: Category }
  | { t: 'perk'; target?: string; category?: Category; skip?: boolean } // бонус открытой профессии
  | { t: 'vote'; target: string }
  | { t: 'done' } // ходящий закончил речь раньше времени
  | { t: 'volunteer' }; // вызваться добровольцем (событие раунда)

export interface LobbyMember {
  name: string;
  connected: boolean;
}
export type H2C =
  | { t: 'lobby'; members: LobbyMember[]; scenario: string; slots: number; you: number; locked?: boolean; adult?: boolean }
  | { t: 'view'; view: GameState; me: string; offline?: string[] }
  | { t: 'reject'; reason: string }
  | { t: 'notice'; text: string }; // игра продолжается; хост объясняет, почему действие не сработало

/** Минимальный дуплексный канал: в проде — WebRTC DataChannel (PeerJS), в тестах — in-memory. */
export interface Conn<Out> {
  send(m: Out): void;
  onMessage(cb: (m: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export const MAX_ONLINE_PLAYERS = 20;
const MAX_PENDING = 40;
const HANDSHAKE_MS = 10_000;
const MAX_MSGS_PER_SEC = 30;
/** Билет QR-кода живёт столько, потом хост выпускает новый; ещё GRACE_MS после смены старый принимается — вдруг кто-то уже навёл камеру. */
export const TICKET_TTL_MS = 5 * 60_000;
const TICKET_GRACE_MS = 20_000;

/* ---------- Маскирование состояния ---------- */

const hiddenCard = (category: Category): Card => ({ id: `hidden-${category}`, category, description: '???' });

/** Что игрок `me` вправе знать: чужие закрытые карты вырезаются на хосте, до клиента они не доходят. */
export function viewFor(g: GameState, me: string, voting: VotingMode = g.config.voting): GameState {
  const final = g.phase === 'final';
  const players: PlayerCharacter[] = g.players.map((p) => {
    if (p.id === me || (final && !p.isEliminated)) return g.hiddenThreat ? { id: p.id, name: p.name, isEliminated: p.isEliminated, slots: p.slots } : p;
    const slots = Object.fromEntries(
      CATEGORIES.map((c) => [c, p.slots[c].isRevealed ? p.slots[c] : { card: hiddenCard(c), isRevealed: false }]),
    ) as PlayerCharacter['slots'];
    return g.hiddenThreat ? { id: p.id, name: p.name, isEliminated: p.isEliminated, slots } : { ...p, slots };
  });
  // Тайное голосование: во время голосования видно лишь кто уже проголосовал (и свой выбор), после — ничего.
  const votes =
    voting !== 'secret'
      ? g.votes
      : g.phase === 'vote'
        ? Object.fromEntries(Object.keys(g.votes).map((v) => [v, v === me ? g.votes[v] : v]))
        : {};
  // Часы хоста клиентам не нужны (у телефонов они расходятся): передаём «сколько осталось» на момент отправки.
  // Колода, сброс и накопленные действия (тайные союзы) остаются у хоста.
  const { deadline, speechEndsAt, deck: _deck, discard: _discard, fx: _fx, perkResult, hiddenThreat: _secrets, threatView: _oldView, ...rest } = g;
  // New mode uses an allowlist: future host-only fields cannot silently become wire fields.
  const publicState = g.hiddenThreat ? {
    config: g.config, scenario: g.scenario, round: g.round, schedule: g.schedule, phase: g.phase,
    revealedThisRound: g.revealedThisRound, event: g.event, usedEvents: g.usedEvents,
    speechFactor: g.speechFactor, hazards: g.hazards, lastReveal: g.lastReveal, revealStep: g.revealStep,
    perks: g.perks, lastResult: g.lastResult,
    log: g.log.map(l => ({ round: l.round, text: l.text, ...(l.kind ? { kind: l.kind } : {}), ...(l.volunteer ? { volunteer: l.volunteer } : {}) })),
  } : rest;
  return {
    ...publicState,
    players,
    votes,
    seed: 0,
    config: { ...g.config, seed: 0 },
    ...(g.hiddenThreat ? { threatView: threatViewFor(g, me) } : {}),
    // Итог бонуса (например лечения) видит только владелец.
    ...(perkResult && perkResult.playerId === me ? { perkResult } : {}),
    ...(deadline ? { timeLeftMs: Math.max(0, deadline - Date.now()) } : {}),
    ...(speechEndsAt ? { speechLeftMs: Math.max(0, speechEndsAt - Date.now()) } : {}),
  };
}

/* ---------- Хост ---------- */

interface Member {
  token: string;
  name: string;
  conn: Conn<H2C> | null; // null — сам хост
  connected: boolean;
  playerId?: string;
}
export interface HostCheckpoint {
  version: 1;
  game: GameState;
  members: { token: string; name: string; playerId: string }[];
  locked: boolean;
  requireTicket: boolean;
}

export interface HostSetup {
  variant?: 'classic' | 'hidden-threat';
  hiddenThreat?: ThreatConfig;
  scenario: Scenario;
  packs: CardPack[];
  slots: number;
  voting: VotingMode;
  revealsPerVote?: number; // по умолчанию 2
  speechSec?: number; // секунд на объяснение пользы, по умолчанию 45; 0 — без таймера
  hazardCount?: number; // факторов угрозы из пула сценария, по умолчанию 2
  difficulty?: Difficulty; // по умолчанию normal
  roundEvents?: boolean; // карта кризиса перед каждым раундом, по умолчанию нет
  autoActions?: boolean; // карты действий исполняются в игре сами (бета), по умолчанию нет
  professionPerks?: boolean; // открытая профессия даёт бонус, по умолчанию нет
  adult?: boolean; // в комнате пак 18+: гостям показывается предупреждение до начала игры
  timeLimitMin?: number; // 0 — без лимита; по умолчанию 0
}

const NAME_MAX = 24;
const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '');

export class OnlineHost {
  members: Member[];
  game: GameState | null = null;
  /** Закрытая комната не принимает новых игроков (вернуться по токену можно). */
  locked = false;
  /** «Только по QR»: без действующего билета новые игроки не принимаются (код комнаты один не работает). */
  requireTicket = false;
  private tickets: { value: string; expires: number }[] = [];
  private listeners = new Set<() => void>();
  private pending = new Set<Conn<H2C>>();
  private rate = new Map<Conn<H2C>, { t: number; n: number }>();

  constructor(
    public setup: HostSetup,
    hostName = t('Хост'),
  ) {
    this.members = [{ token: 'host', name: cleanName(hostName) || t('Хост'), conn: null, connected: true }];
  }
  checkpoint(): HostCheckpoint | null {
    if (!this.game?.hiddenThreat) return null;
    return { version: 1, game: this.game, members: this.members.map(m => ({ token: m.token, name: m.name, playerId: m.playerId! })), locked: this.locked, requireTicket: this.requireTicket };
  }
  static restore(raw: unknown, setup: HostSetup): OnlineHost | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<HostCheckpoint>;
    const game = validateSavedGame(r.game);
    if (r.version !== 1 || !game?.hiddenThreat || game.config.mode !== 'online' || !Array.isArray(r.members) || r.members.length !== game.players.length) return null;
    if (!r.members.every((m, i) => m && typeof m.name === 'string' && typeof m.token === 'string' && m.token.length > 0 && m.token.length <= 64 && m.playerId === game.players[i].id && (i === 0 ? m.token === 'host' : m.token !== 'host')) || new Set(r.members.map(m => m.token)).size !== r.members.length) return null;
    const host = new OnlineHost(setup, r.members[0].name);
    host.game = game;
    host.members = r.members.map((m, i) => ({ token: m.token, name: cleanName(m.name), playerId: m.playerId, conn: null, connected: i === 0 }));
    host.locked = r.locked === true;
    host.requireTicket = r.requireTicket === true;
    return host;
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  addConn(conn: Conn<H2C>) {
    if (this.pending.size >= MAX_PENDING) return conn.close();
    this.pending.add(conn);
    // Соединение, не представившееся за HANDSHAKE_MS, отбрасываем — иначе слоты можно занять «пустыми» подключениями.
    const timer = setTimeout(() => this.pending.has(conn) && this.drop(conn, true), HANDSHAKE_MS);
    (timer as { unref?: () => void }).unref?.();
    conn.onMessage((raw) => {
      if (this.tooFast(conn)) return this.drop(conn, true);
      this.onRaw(conn, raw);
    });
    conn.onClose(() => this.drop(conn, false));
  }

  private tooFast(conn: Conn<H2C>): boolean {
    const now = Date.now();
    const w = this.rate.get(conn);
    if (!w || now - w.t > 1000) {
      this.rate.set(conn, { t: now, n: 1 });
      return false;
    }
    return ++w.n > MAX_MSGS_PER_SEC;
  }

  private drop(conn: Conn<H2C>, close: boolean) {
    this.pending.delete(conn);
    this.rate.delete(conn);
    const m = this.members.find((x) => x.conn === conn);
    if (close) conn.close();
    if (m) {
      m.connected = false;
      m.conn = null;
      this.changed();
    }
  }

  /** Действующий билет для QR; по истечении TTL автоматически выпускается новый. */
  currentTicket(): { value: string; expiresAt: number } {
    const now = Date.now();
    this.tickets = this.tickets.filter((t) => now < t.expires + TICKET_GRACE_MS);
    let cur = this.tickets[this.tickets.length - 1];
    if (!cur || now >= cur.expires) {
      cur = { value: randomCode(6), expires: now + TICKET_TTL_MS };
      this.tickets.push(cur);
    }
    return { value: cur.value, expiresAt: cur.expires };
  }

  /** Немедленно аннулировать все билеты и выпустить новый (кнопка «Обновить QR»). */
  rotateTicket() {
    this.tickets = [];
    this.currentTicket();
    this.changed();
  }

  private ticketValid(t: unknown): boolean {
    this.currentTicket();
    return typeof t === 'string' && this.tickets.some((x) => x.value === t.toUpperCase());
  }

  setRequireTicket(v: boolean) {
    this.requireTicket = v;
    this.changed();
  }

  setLocked(v: boolean) {
    this.locked = v;
    this.changed();
  }

  /** Лобби: удалить игрока из комнаты. */
  kick(index: number) {
    const m = this.members[index];
    if (this.game || index === 0 || !m) return;
    m.conn?.send({ t: 'reject', reason: t('Хост исключил вас из комнаты') });
    const conn = m.conn;
    this.members.splice(index, 1);
    if (conn) {
      this.pending.delete(conn);
      conn.close();
    }
    this.changed();
  }

  private onRaw(conn: Conn<H2C>, raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;
    if (msg.t === 'hello') {
      const token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : '';
      const name = cleanName(msg.name);
      if (!token || !name || token === 'host') return conn.send({ t: 'reject', reason: t('Некорректные данные') });
      // Одно соединение — один участник: повторный hello с другим токеном игнорируется.
      const bound = this.members.find((m) => m.conn === conn);
      if (bound) return bound.token === token ? this.changed() : undefined;
      const known = this.members.find((m) => m.token === token);
      if (known) {
        const old = known.conn;
        known.conn = conn;
        known.connected = true;
        if (old && old !== conn) {
          this.pending.delete(old);
          old.close();
        }
      } else if (this.game) {
        return conn.send({ t: 'reject', reason: t('Партия уже началась') });
      } else if (this.locked) {
        return conn.send({ t: 'reject', reason: t('Комната закрыта хостом') });
      } else if (msg.ticket !== undefined && !this.ticketValid(msg.ticket)) {
        return conn.send({ t: 'reject', reason: t('QR-код устарел — отсканируйте актуальный у хоста') });
      } else if (this.requireTicket && msg.ticket === undefined) {
        return conn.send({ t: 'reject', reason: t('Вход только по QR-коду хоста') });
      } else if (this.members.length >= MAX_ONLINE_PLAYERS) {
        return conn.send({ t: 'reject', reason: t('Комната заполнена') });
      } else {
        this.members.push({ token, name, conn, connected: true });
      }
      this.pending.delete(conn);
      return this.changed();
    }
    const member = this.members.find((m) => m.conn === conn);
    if (!member) return;
    let refusal: string | null = null;
    if (msg.t === 'secret') {
      const command = Object.keys(msg).every(k => ['t', 'command'].includes(k)) && parseSecretCommand(msg.command);
      if (command) this.act(member, { t: 'secret', command });
    }
    else if (msg.t === 'auxiliary' && Object.keys(msg).every(k => ['t', 'round', 'kind', 'target', 'itemId'].includes(k)) && typeof msg.kind === 'string' && ['assist', 'obstruct', 'transfer'].includes(msg.kind) && typeof msg.target === 'string' && Number.isInteger(msg.round)) refusal = this.act(member, { t: 'auxiliary', round: msg.round as number, kind: msg.kind as Auxiliary, target: msg.target.slice(0, 12), ...(typeof msg.itemId === 'string' ? { itemId: msg.itemId.slice(0, 60) } : {}) });
    else if (msg.t === 'reveal' && CATEGORIES.includes(msg.category as Category)) this.act(member, { t: 'reveal', category: msg.category as Category });
    else if (msg.t === 'action') refusal = this.act(member, { t: 'action', ...(typeof msg.target === 'string' ? { target: msg.target.slice(0, 12) } : {}), ...(CATEGORIES.includes(msg.category as Category) ? { category: msg.category as Category } : {}) });
    else if (msg.t === 'perk') refusal = this.act(member, { t: 'perk', ...(msg.skip === true ? { skip: true } : {}), ...(typeof msg.target === 'string' ? { target: msg.target.slice(0, 12) } : {}), ...(CATEGORIES.includes(msg.category as Category) ? { category: msg.category as Category } : {}) });
    else if (msg.t === 'done') this.act(member, { t: 'done' });
    else if (msg.t === 'volunteer') this.act(member, { t: 'volunteer' });
    else if (msg.t === 'vote' && typeof msg.target === 'string') this.act(member, { t: 'vote', target: msg.target });
    if (refusal) member.conn?.send({ t: 'notice', text: refusal });
  }

  /** Действие игрока (в том числе самого хоста через index 0). Все проверки — здесь, клиенту не доверяем. */
  act(member: Member, msg: Exclude<C2H, { t: 'hello' }>): string | null {
    const g = this.game;
    const id = member.playerId;
    if (!g || !id) return null;
    const me = g.players.find((p) => p.id === id);
    if (!me || me.isEliminated) return null;
    let next = g;
    let refusal: string | null = null;
    if (msg.t === 'secret') {
      next = submitSecret(g, id, msg.command);
      if (allSecretReady(next)) next = finishSecret(next);
    }
    else if (msg.t === 'auxiliary') {
      if (msg.round === g.round) next = auxiliaryAction(g, id, msg.target, msg.kind, msg.itemId);
      if (next === g) refusal = t('Действие не сработало');
    }
    else if (msg.t === 'reveal') next = revealCard(g, id, msg.category);
    else if (msg.t === 'action') {
      if (g.phase === 'reveal' || g.phase === 'speech' || g.phase === 'vote') {
        const effect = g.config.autoActions ? me.slots.action.card.effect : undefined;
        const check = effect && !me.slots.action.isRevealed ? canApply(g, id, effect, { target: msg.target, category: msg.category }) : null;
        if (check && !check.ok) refusal = check.reason;
        else next = playAction(g, id, { target: msg.target, category: msg.category });
      } else refusal = t('Сейчас действие применить нельзя');
      if (!refusal && next === g) refusal = me.slots.action.isRevealed ? t('Действие уже использовано') : t('Действие не сработало');
    } else if (msg.t === 'perk') {
      if (g.phase === 'reveal' || g.phase === 'speech' || g.phase === 'vote') {
        if (msg.skip) next = skipPerk(g, id);
        else {
          const check = canApplyPerk(g, id, { target: msg.target, category: msg.category });
          if (check.ok) next = playPerk(g, id, { target: msg.target, category: msg.category });
          else refusal = check.reason;
        }
      } else refusal = t('Сейчас бонус применить нельзя');
    } else if (msg.t === 'volunteer') {
      next = volunteer(g, id);
    } else if (msg.t === 'done') {
      if (g.phase === 'speech' && currentSpeaker(g)?.id === id) next = endSpeech(g);
    } else if (msg.t === 'vote' && g.phase === 'vote') {
      const target = msg.target === ABSTAIN ? { id: ABSTAIN } : alive(g).find((p) => p.id === msg.target);
      if (target) next = castVote(g, id, target.id);
      if (allVoted(next)) next = resolveVote(next);
    }
    // Действие в голосовании (неприкосновенность последнего голосующего) могло закрыть голосование: считаем итог сразу.
    if (next !== g && next.phase === 'vote' && allVoted(next)) next = resolveVote(next);
    if (next !== g) this.setGame(next);
    return refusal;
  }

  /** Действие самого хоста; если оно не сработало, возвращает причину (её показывает интерфейс хоста). */
  actAsHost(msg: Exclude<C2H, { t: 'hello' }>): string | null {
    return this.act(this.members[0], msg);
  }

  rename(name: string) {
    this.members[0].name = cleanName(name) || t('Хост');
    this.changed();
  }

  start(): boolean {
    if (this.game || this.members.length < 2) return false;
    if (this.setup.variant === 'hidden-threat' && validateThreatConfig(this.members.length, this.setup.slots, this.setup.hiddenThreat!)) return false;
    const names = uniqueNames(this.members.map((m) => m.name));
    const n = names.length;
    const g = createGame(
      {
        scenarioId: this.setup.scenario.id,
        packIds: this.setup.packs.map((p) => p.id),
        playerCount: n,
        shelterSlots: Math.max(1, Math.min(this.setup.slots, n - 1)),
        mode: 'online',
        ...(this.setup.variant === 'hidden-threat' ? { variant: this.setup.variant, hiddenThreat: this.setup.hiddenThreat } : {}),
        voting: this.setup.voting,
        revealsPerVote: Math.min(3, Math.max(1, this.setup.revealsPerVote ?? 2)),
        speechSec: Math.min(300, Math.max(0, this.setup.speechSec ?? 45)),
        hazardCount: Math.min(L.maxHazardsPerGame, Math.max(0, this.setup.hazardCount ?? 2)),
        difficulty: this.setup.difficulty ?? 'normal',
        roundEvents: this.setup.roundEvents ?? false,
        autoActions: this.setup.autoActions === true,
        professionPerks: this.setup.professionPerks === true,
        timeLimitMin: Math.min(180, Math.max(0, this.setup.timeLimitMin ?? 0)),
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
  /** Игроки прочитали карту кризиса — хост запускает вскрытия. */
  startRound() {
    if (this.game?.phase === 'event') this.setGame(continueEvent(this.game));
  }
  /** Хост может прервать чужую речь («Следующий игрок»). */
  skipSpeech() {
    if (this.game?.phase === 'speech') this.setGame(endSpeech(this.game));
  }
  /** Раз в секунду: кончилась речь → ходит следующий; вышло время партии → овертайм. */
  tick(now = Date.now()) {
    if (!this.game) return;
    const next = tickGame(this.game, now);
    if (next !== this.game) this.setGame(next);
  }
  extendTime(ms: number) {
    if (this.game) this.setGame(extendDeadline(this.game, ms));
  }
  next() {
    if (this.game?.phase === 'result') this.setGame(nextRound(this.game));
  }
  /**
   * Автоход за отключившихся, чтобы партия не зависла: если сейчас очередь отключённого игрока — открываем
   * ему первую доступную карту и пропускаем речь; отсутствующие голосуют за случайного игрока.
   */
  autofillDisconnected() {
    let g = this.game;
    if (!g) return;
    const absent = (playerId?: string) => this.members.some((m) => m.playerId === playerId && !m.connected);
    for (let i = 0; i < 100; i++) {
      const sp = currentSpeaker(g);
      if (!sp || !absent(sp.id)) break;
      g = g.phase === 'reveal' ? revealCard(g, sp.id, revealOptions(g, sp)[0]) : endSpeech(g);
    }
    for (const m of this.members) {
      if (!m.connected && m.playerId && (g.phase === 'secret' || g.phase === 'secret-review')) g = submitSecret(g, m.playerId, { id: `offline-${g.phase}-${g.round}`, round: g.round, operation: { kind: 'skip' } });
      if (m.connected || !m.playerId || g.phase !== 'vote') continue;
      const p = g.players.find((x) => x.id === m.playerId);
      if (!p || p.isEliminated || g.votes[p.id]) continue;
      const others = alive(g).filter((x) => x.id !== p.id);
      if (others.length) g = castVote(g, p.id, others[Math.floor(Math.random() * others.length)].id);
    }
    if (g.phase === 'vote' && allVoted(g)) g = resolveVote(g);
    if (allSecretReady(g)) g = finishSecret(g);
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
      if (this.game && m.playerId) m.conn.send({ t: 'view', view: viewFor(this.game, m.playerId), me: m.playerId, offline: this.disconnectedPending() });
      else
        m.conn.send({
          t: 'lobby',
          members: this.members.map((x) => ({ name: x.name, connected: x.connected })),
          scenario: this.setup.scenario.title,
          slots: this.setup.slots,
          you: i,
          locked: this.locked,
          adult: this.setup.adult === true,
        });
    });
    this.listeners.forEach((cb) => cb());
  }
}

/**
 * Делает имена уникальными: первое вхождение остаётся как есть, повтор получает суффикс « 2», « 3»… Суффикс укладывается
 * в общий лимит имени, и результат сверяется со всеми занятыми именами (включая «A 2», введённое игроком).
 */
function uniqueNames(names: string[]): string[] {
  const taken = new Set<string>();
  const out = names.map((n) => {
    if (taken.has(n)) return null;
    taken.add(n);
    return n;
  });
  return out.map((first, i) => {
    if (first !== null) return first;
    for (let k = 2; ; k++) {
      const suffix = ` ${k}`;
      const name = `${names[i].slice(0, NAME_MAX - suffix.length)}${suffix}`;
      if (!taken.has(name)) {
        taken.add(name);
        return name;
      }
    }
  });
}

/* ---------- Клиент ---------- */

export type ClientState =
  | { status: 'connecting' }
  | { status: 'lobby'; members: LobbyMember[]; scenario: string; slots: number; you: number; adult: boolean }
  | { status: 'game'; view: GameState; me: string; offline: string[]; notice?: { text: string; id: number } }
  | { status: 'closed' }
  | { status: 'rejected'; reason: string };

export class OnlineClient {
  state: ClientState = { status: 'connecting' };
  private listeners = new Set<() => void>();
  private noticeId = 0;

  constructor(
    private conn: Conn<C2H>,
    name: string,
    token: string,
    ticket?: string,
  ) {
    conn.onMessage((raw) => this.onRaw(raw));
    conn.onClose(() => {
      if (this.state.status !== 'rejected') this.set({ status: 'closed' });
    });
    conn.send({ t: 'hello', name, token, ...(ticket ? { ticket } : {}) });
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
    if (m.t === 'reject') this.set({ status: 'rejected', reason: typeof m.reason === 'string' ? m.reason.slice(0, 100) : t('Отказано') });
    else if (m.t === 'lobby' && Array.isArray(m.members))
      this.set({
        status: 'lobby',
        members: m.members.slice(0, MAX_ONLINE_PLAYERS).map((x) => ({ name: clip(String(x?.name ?? ''), 24), connected: !!x?.connected })),
        scenario: clip(String(m.scenario ?? ''), L.scenarioTitle),
        slots: Number(m.slots) || 0,
        you: Number(m.you) || 0,
        adult: m.adult === true,
      });
    else if (m.t === 'view' && typeof m.me === 'string') {
      const view = sanitizeView(m.view);
      // Имена отключившихся (нужны всем, чтобы понимать, кого ждём); приходят от хоста, поэтому чистим и ограничиваем.
      const offline = Array.isArray(m.offline) ? m.offline.slice(0, MAX_ONLINE_PLAYERS).map((x) => clip(String(x ?? ''), 24)).filter(Boolean) : [];
      if (view && view.players.some((p) => p.id === m.me) && (view.config.variant !== 'hidden-threat' || view.threatView?.me?.playerId === m.me)) {
        const prev = this.state.status === 'game' ? this.state.notice : undefined;
        this.set({ status: 'game', view, me: m.me, offline, ...(prev ? { notice: prev } : {}) });
      }
    } else if (m.t === 'notice' && typeof m.text === 'string' && this.state.status === 'game') {
      this.noticeId += 1;
      this.set({ ...this.state, notice: { text: clip(m.text, 100), id: this.noticeId } });
    }
  }
}

const ACTION_EFFECT_IDS = Object.keys(ACTION_EFFECTS);
const EVENT_KINDS = ['shrink', 'plague', 'volunteer', 'leak', 'silence', 'newHazard', 'relief', 'prompt'] as const;
const EVENT_TONES = ['good', 'bad', 'neutral'] as const;

/* ---------- Недоверенное состояние от хоста ---------- */

const PHASES = ['event', 'reveal', 'speech', 'secret', 'secret-review', 'vote', 'result', 'final'];
const MODS = ['positive', 'neutral', 'negative'];
const text = (v: unknown, max: number) => (typeof v === 'string' ? clip(v, max) : '');
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function cleanCard(raw: unknown, category: Category, nested = false): Card | null {
  const r = rec(raw);
  if (typeof r.description !== 'string') return null;
  const card: Card = { id: text(r.id, 60), category, description: text(r.description, L.cardDescription) };
  if (typeof r.title === 'string') card.title = text(r.title, L.cardTitle);
  if (MODS.includes(r.modifier as string)) card.modifier = r.modifier as Card['modifier'];
  // Составной багаж объединяет навыки до четырёх предметов: лимит одной карты к нему не применим.
  const tagLimit = category === 'luggage' ? L.cardTags * MAX_ITEMS : L.cardTags;
  if (Array.isArray(r.tags)) card.tags = r.tags.slice(0, tagLimit).map((t) => text(t, L.tagLen)).filter(Boolean);
  if (r.strictTags === true) card.strictTags = true;
  // Предметы составного багажа нужны клиенту, чтобы считать навыки так же, как хост.
  if (category === 'luggage' && !nested && Array.isArray(r.items)) {
    const items = r.items.slice(0, MAX_ITEMS).map((i) => cleanCard(i, 'luggage', true)).filter((c): c is Card => !!c);
    if (items.length) card.items = items;
  }
  if (category === 'action' && ACTION_EFFECT_IDS.includes(r.effect as ActionEffect)) card.effect = r.effect as ActionEffect;
  return card;
}

const PERK_KINDS = ['steal', 'heal', 'reveal'] as const;

function cleanPerkResult(raw: unknown): PerkResult | null {
  const r = rec(raw);
  return typeof r.playerId === 'string' && typeof r.text === 'string' ? { id: Math.min(100000, Math.max(0, Math.round(Number(r.id)) || 0)), playerId: text(r.playerId, 12), text: text(r.text, 300) } : null;
}

function cleanPerks(raw: unknown): Perk[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ONLINE_PLAYERS).flatMap((x) => {
    const r = rec(x);
    const kind = PERK_KINDS.find((k) => k === r.kind);
    const level = (['novice', 'experienced', 'expert'] as const).find((l) => l === r.level);
    return kind && typeof r.playerId === 'string' ? [{ playerId: text(r.playerId, 12), kind, ...(level ? { level } : {}) }] : [];
  });
}

/** Хост — внешний источник: заново собираем состояние только из проверенных полей и обрезаем строки по лимитам. */
function cleanEvent(raw: unknown): ActiveEvent | null {
  const e = rec(raw);
  const kind = EVENT_KINDS.find((k) => k === e.kind);
  const tone = EVENT_TONES.find((t) => t === e.tone);
  if (!kind || !tone || typeof e.title !== 'string') return null;
  return {
    id: text(e.id, 40),
    kind,
    tone,
    title: text(e.title, 80),
    text: text(e.text, 400),
    outcome: Array.isArray(e.outcome) ? e.outcome.slice(0, 24).map((o) => text(o, 300)) : [],
  };
}

export function sanitizeView(raw: unknown): GameState | null {
  const r = rec(raw);
  if (!Array.isArray(r.players) || r.players.length < 1 || r.players.length > MAX_ONLINE_PLAYERS) return null;
  const scenario = sanitizeScenario(r.scenario, 0);
  if (!scenario || !PHASES.includes(r.phase as string)) return null;
  const players: PlayerCharacter[] = [];
  for (const rp of r.players) {
    const p = rec(rp);
    const slots = rec(p.slots);
    const out: Partial<PlayerCharacter['slots']> = {};
    for (const c of CATEGORIES) {
      const slot = rec(slots[c]);
      const card = cleanCard(slot.card, c);
      if (!card) return null;
      out[c] = { card, isRevealed: slot.isRevealed === true };
    }
    players.push({ id: text(p.id, 12), name: text(p.name, 24), isEliminated: p.isEliminated === true, slots: out as PlayerCharacter['slots'] });
  }
  const cfg = rec(r.config);
  if (cfg.variant === 'hidden-threat' && !sanitizeThreatView(r.threatView, r.phase === 'final')?.me) return null;
  const int = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || lo));
  const votes: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(r.votes)).slice(0, MAX_ONLINE_PLAYERS)) votes[text(k, 12)] = text(v, 12);
  const lr = rec(r.lastResult);
  const tally: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(lr.tally)).slice(0, MAX_ONLINE_PLAYERS)) tally[text(k, 12)] = int(v, 0, 99);
  const game: GameState = {
    config: {
      scenarioId: scenario.id,
      packIds: [],
      playerCount: players.length,
      shelterSlots: int(cfg.shelterSlots, 1, 19),
      mode: 'online',
      voting: cfg.voting === 'open' ? 'open' : 'secret',
      revealsPerVote: int(cfg.revealsPerVote, 1, 3),
      speechSec: int(cfg.speechSec, 0, 300),
      hazardCount: int(cfg.hazardCount, 0, L.maxHazardsPerGame),
      difficulty: (['easy', 'normal', 'hard', 'nightmare'] as const).find((d) => d === cfg.difficulty) ?? 'normal',
      roundEvents: cfg.roundEvents === true,
      autoActions: cfg.autoActions === true,
      professionPerks: cfg.professionPerks === true,
      timeLimitMin: int(cfg.timeLimitMin, 0, 180),
      names: players.map((p) => p.name),
      seed: 0,
      ...(cfg.variant === 'hidden-threat' ? { variant: 'hidden-threat' as const, hiddenThreat: { criminal: rec(cfg.hiddenThreat).criminal === 'mafia' ? 'mafia' as const : 'maniac' as const, report: rec(cfg.hiddenThreat).report === 'detailed' ? 'detailed' as const : 'hidden' as const } } : {}),
    },
    scenario,
    players,
    round: int(r.round, 1, cfg.variant === 'hidden-threat' ? 10000 : 50),
    // Дополнительные раунды (воздержавшиеся) удлиняют расписание до MAX_TOTAL_ROUNDS: обрезать нельзя, иначе у клиента «Раунд 7/6».
    schedule: Array.isArray(r.schedule) ? r.schedule.slice(0, cfg.variant === 'hidden-threat' ? 10000 : MAX_TOTAL_ROUNDS).map((n) => int(n, 0, 19)) : [],
    phase: r.phase as GameState['phase'],
    revealStep: int(r.revealStep, 1, 3),
    ...(cleanEvent(r.event) ? { event: cleanEvent(r.event)! } : {}),
    ...(cleanPerks(r.perks).length ? { perks: cleanPerks(r.perks) } : {}),
    ...(cleanPerkResult(r.perkResult) ? { perkResult: cleanPerkResult(r.perkResult)! } : {}),
    hazards: (Array.isArray(r.hazards) ? r.hazards.slice(0, L.maxHazardsActive) : [])
      .map((h, i) => sanitizeHazard(h, i))
      .filter((h): h is Hazard => !!h),
    ...(r.timeLeftMs !== undefined ? { deadline: Date.now() + int(r.timeLeftMs, 0, 180 * 60_000) } : {}),
    ...(r.speechLeftMs !== undefined ? { speechEndsAt: Date.now() + int(r.speechLeftMs, 0, 300_000) } : {}),
    ...(rec(r.lastReveal).playerId !== undefined && CATEGORIES.includes(rec(r.lastReveal).category as Category)
      ? { lastReveal: { playerId: text(rec(r.lastReveal).playerId, 12), category: rec(r.lastReveal).category as Category } }
      : {}),
    revealedThisRound: Array.isArray(r.revealedThisRound) ? r.revealedThisRound.slice(0, MAX_ONLINE_PLAYERS).map((x) => text(x, 12)) : [],
    votes,
    log: Array.isArray(r.log)
      ? r.log.slice(-200).map((l) => ({
          round: int(rec(l).round, 1, cfg.variant === 'hidden-threat' ? 10000 : 50),
          text: text(rec(l).text, 400),
          // Признаки записи нужны интерфейсу и хронике: баннер последнего действия и добровольцы в эпилоге.
          ...(rec(l).kind === 'action' ? { kind: 'action' as const } : {}),
          ...(typeof rec(l).volunteer === 'string' ? { volunteer: text(rec(l).volunteer, 24) } : {}),
        }))
      : [],
    seed: 0,
    ...(cfg.variant === 'hidden-threat' && sanitizeThreatView(r.threatView, r.phase === 'final') ? { threatView: sanitizeThreatView(r.threatView, r.phase === 'final') } : {}),
  };
  if (r.lastResult) {
    game.lastResult = {
      eliminated: Array.isArray(lr.eliminated) ? lr.eliminated.slice(0, MAX_ONLINE_PLAYERS).map((x) => text(x, 12)) : [],
      tally,
      tieBreak: lr.tieBreak === true,
      abstained: int(lr.abstained, 0, MAX_ONLINE_PLAYERS),
      skipped: lr.skipped === true,
      noVote: lr.noVote === true,
    };
  }
  return game;
}
