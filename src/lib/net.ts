import type { DataConnection, Peer as PeerT, PeerOptions } from 'peerjs';
import type { Conn } from './online';

/**
 * WebRTC через PeerJS: публичный брокер нужен только для рукопожатия (SDP/ICE),
 * дальше данные идут напрямую между браузерами, поэтому играть можно из разных сетей.
 * Свой брокер/TURN задаются переменными окружения при сборке (см. README).
 */
const ROOM_PREFIX = 'shelterprotocol-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без 0/O/1/I
const env = import.meta.env as Record<string, string | undefined>;

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
export const isValidCode = (s: string) => new RegExp(`^[${ALPHABET}]{5}$`).test(s);

function randomCode(): string {
  const buf = new Uint8Array(5);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export type NetMode = 'internet' | 'lan';

/** Есть ли на этом же адресе LAN-сервер (`npm run lan`)? Тогда играем через него, без интернета и сторонних сервисов. */
export async function probeLan(): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const res = await fetch(new URL('peerjs/', location.origin + '/').toString(), { signal: ctl.signal, cache: 'no-store' });
    const j = (await res.json()) as { name?: string };
    return res.ok && j.name === 'PeerJS Server';
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function lanOptions(): PeerOptions {
  return {
    host: location.hostname,
    port: Number(location.port) || (location.protocol === 'https:' ? 443 : 80),
    path: '/peerjs',
    secure: location.protocol === 'https:',
    config: { iceServers: [] }, // только локальные кандидаты: никаких запросов к STUN/внешним сервисам
    debug: 0,
  };
}

function peerOptions(mode: NetMode = 'internet'): PeerOptions {
  if (mode === 'lan') return lanOptions();
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  if (env.VITE_TURN_URL) {
    iceServers.push({ urls: env.VITE_TURN_URL, username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  }
  const opts: PeerOptions = { config: { iceServers }, debug: 0 };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.port = Number(env.VITE_PEER_PORT) || 443;
    opts.path = env.VITE_PEER_PATH || '/';
    opts.secure = env.VITE_PEER_SECURE !== 'false';
  }
  return opts;
}

async function newPeer(mode: NetMode, id?: string): Promise<PeerT> {
  const { Peer } = await import('peerjs');
  return id ? new Peer(id, peerOptions(mode)) : new Peer(peerOptions(mode));
}

function wrap<Out>(dc: DataConnection): Conn<Out> {
  return {
    send: (m) => dc.open && dc.send(m),
    onMessage: (cb) => void dc.on('data', cb),
    onClose: (cb) => {
      dc.on('close', cb);
      dc.on('error', cb);
    },
    close: () => dc.close(),
  };
}

const waitOpen = (peer: PeerT, ms: number) =>
  new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Нет ответа от брокера соединений')), ms);
    peer.once('open', (id) => (clearTimeout(t), resolve(id)));
    peer.once('error', (e) => (clearTimeout(t), reject(e)));
  });

export interface Room {
  code: string;
  destroy(): void;
}

/** Хост: занимает случайный код комнаты и отдаёт каждое входящее соединение в `onConn`. */
export async function createRoom(onConn: (c: Conn<unknown>) => void, mode: NetMode = 'internet'): Promise<Room> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const peer = await newPeer(mode, ROOM_PREFIX + code);
    try {
      await waitOpen(peer, 12000);
    } catch (e) {
      peer.destroy();
      if ((e as { type?: string }).type === 'unavailable-id') continue; // код занят — берём другой
      throw new Error('Не удалось связаться с брокером соединений. Проверьте интернет.');
    }
    peer.on('connection', (dc) => dc.on('open', () => onConn(wrap(dc))));
    // Потеря связи с брокером не рвёт уже установленные P2P-каналы, но мешает входу новых игроков — переподключаемся.
    peer.on('disconnected', () => !peer.destroyed && peer.reconnect());
    return { code, destroy: () => peer.destroy() };
  }
  throw new Error('Не удалось получить код комнаты, попробуйте ещё раз');
}

/** Гость: подключение к комнате по коду. */
export async function joinRoom(code: string, mode: NetMode = 'internet'): Promise<{ conn: Conn<unknown>; destroy(): void }> {
  const peer = await newPeer(mode);
  try {
    await waitOpen(peer, 12000);
  } catch {
    peer.destroy();
    throw new Error('Не удалось связаться с брокером соединений. Проверьте интернет.');
  }
  return new Promise((resolve, reject) => {
    const dc = peer.connect(ROOM_PREFIX + code, { serialization: 'json', reliable: true });
    const fail = (msg: string) => (peer.destroy(), reject(new Error(msg)));
    const t = setTimeout(
      () => fail('Не удалось соединиться. Проверьте код — или сеть хоста/ваша блокирует прямые соединения (нужен TURN).'),
      15000,
    );
    peer.once('error', (e) =>
      (clearTimeout(t), fail((e as { type?: string }).type === 'peer-unavailable' ? 'Комната с таким кодом не найдена' : 'Ошибка соединения')),
    );
    dc.on('open', () => (clearTimeout(t), resolve({ conn: wrap(dc), destroy: () => peer.destroy() })));
  });
}
