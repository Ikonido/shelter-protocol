import { afterEach, describe, expect, it, vi } from 'vitest';
import jsQR from 'jsqr';
import { qrMatrix } from '../ui/QR';
import { CLASSIC_PACK } from '../data/classicPack';
import { OnlineClient, OnlineHost, TICKET_TTL_MS, type C2H, type Conn, type H2C } from './online';

/** Растеризуем матрицу и отдаём независимому декодеру (jsQR): это проверяет, что код действительно сканируется. */
function decode(text: string): string | undefined {
  const m = qrMatrix(text);
  const scale = 6, quiet = 4, size = (m.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  m.forEach((row, r) => row.forEach((dark, c) => {
    if (!dark) return;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }));
  return jsQR(data, size, size)?.data;
}

function pair() {
  let toHost: (m: unknown) => void = () => {}, toClient: (m: unknown) => void = () => {};
  let hc = () => {}, cc = () => {};
  const hostSide: Conn<H2C> = { send: (m) => queueMicrotask(() => toClient(JSON.parse(JSON.stringify(m)))), onMessage: (cb) => (toHost = cb), onClose: (cb) => (hc = cb), close: () => cc() };
  const clientSide: Conn<C2H> = { send: (m) => queueMicrotask(() => toHost(JSON.parse(JSON.stringify(m)))), onMessage: (cb) => (toClient = cb), onClose: (cb) => (cc = cb), close: () => hc() };
  return { hostSide, clientSide };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const newHost = () => new OnlineHost({ scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'open' }, 'Хост');
async function joinWith(host: OnlineHost, ticket?: string) {
  const p = pair();
  host.addConn(p.hostSide);
  const c = new OnlineClient(p.clientSide, 'Гость', `tok${Math.random()}`, ticket);
  await tick();
  return c;
}

afterEach(() => vi.useRealTimers());

describe('QR code', () => {
  it('is decodable by an independent decoder', () => {
    for (const url of ['http://192.168.1.23:8080/#join=ABCDE.XYZ234', 'https://example.github.io/shelter-protocol/#join=K7P2M.ABCDEF']) expect(decode(url)).toBe(url);
  });
});

describe('temporary join ticket', () => {
  it('valid ticket joins; invalid or expired ticket is rejected', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const host = newHost();
    const t = host.currentTicket();
    expect((await joinWith(host, t.value)).state.status).toBe('lobby');
    expect((await joinWith(host, 'AAAAAA')).state.status).toBe('rejected');
    vi.setSystemTime(Date.now() + TICKET_TTL_MS + 60_000); // истёк срок + окно допуска
    expect((await joinWith(host, t.value)).state.status).toBe('rejected');
    const fresh = host.currentTicket();
    expect(fresh.value).not.toBe(t.value);
    expect((await joinWith(host, fresh.value)).state.status).toBe('lobby');
  });

  it('rotateTicket revokes the old QR immediately; ticket is case-insensitive', async () => {
    const host = newHost();
    const old = host.currentTicket().value;
    host.rotateTicket();
    expect((await joinWith(host, old)).state.status).toBe('rejected');
    expect((await joinWith(host, host.currentTicket().value.toLowerCase())).state.status).toBe('lobby');
  });

  it('"QR only" mode refuses plain code entry but allows token rejoin', async () => {
    const host = newHost();
    host.setRequireTicket(true);
    expect((await joinWith(host)).state.status).toBe('rejected');
    const p = pair();
    host.addConn(p.hostSide);
    new OnlineClient(p.clientSide, 'Анна', 'annatoken', host.currentTicket().value);
    await tick();
    expect(host.members.map((m) => m.name)).toContain('Анна');
    host.members.find((m) => m.name === 'Анна')!.conn?.close();
    await tick();
    const p2 = pair();
    host.addConn(p2.hostSide);
    const back = new OnlineClient(p2.clientSide, 'Анна', 'annatoken'); // без билета: вернуться по токену можно
    await tick();
    expect(back.state.status).toBe('lobby');
  });
});
