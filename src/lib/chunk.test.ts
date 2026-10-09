import { describe, expect, it } from 'vitest';
import type { DataConnection } from 'peerjs';
import { CHUNK_AT_BYTES, createAssembler, MAX_PIECES, PIECE_CHARS, toPieces } from './chunk';
import { wrap } from './net';

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const big = (kb: number) => ({ t: 'view', log: Array.from({ length: kb * 20 }, (_, i) => ({ round: i, text: `Запись журнала номер ${i}: игрок открывает карту «Багаж»` })) });

describe('chunking of large messages', () => {
  it('leaves small messages alone and cuts big ones into pieces that each fit the PeerJS json limit', () => {
    const small = { t: 'vote', target: 'p2' };
    expect(toPieces(small, 0)).toEqual([small]);
    const msg = big(60);
    expect(bytes(msg)).toBeGreaterThan(16300);
    const pieces = toPieces(msg, 7);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(bytes(p), 'часть не влезает в канал').toBeLessThan(16300);
    expect(CHUNK_AT_BYTES).toBeLessThan(16300);
  });

  it('even the worst case (three-byte characters) stays under the limit per piece', () => {
    const msg = { t: 'view', text: '€'.repeat(40_000) }; // 3 байта на символ
    for (const p of toPieces(msg, 1)) expect(bytes(p)).toBeLessThan(16300);
    const asm = createAssembler();
    let out: unknown;
    for (const p of toPieces(msg, 1)) out = asm(p) ?? out;
    expect(out).toEqual(msg);
  });

  it('reassembles the original message and passes ordinary ones through', () => {
    const asm = createAssembler();
    const msg = big(90);
    const got = toPieces(msg, 3).map((p) => asm(p)).filter((x) => x !== undefined);
    expect(got).toEqual([msg]);
    expect(asm({ t: 'ping' })).toEqual({ t: 'ping' });
    expect(asm(null)).toBeNull();
  });

  it('consecutive big messages do not mix, and a broken sequence is dropped without a crash', () => {
    const asm = createAssembler();
    const a = big(40), b = { ...big(50), marker: 'b' };
    const pa = toPieces(a, 1), pb = toPieces(b, 2);
    const outs: unknown[] = [];
    for (const p of [...pa, ...pb]) outs.push(asm(p));
    expect(outs.filter((x) => x !== undefined)).toEqual([a, b]);
    // потеряли часть: сборка сбрасывается, следующее сообщение собирается нормально
    const lost = pa.filter((_, i) => i !== 1);
    expect(lost.map((p) => asm(p)).filter((x) => x !== undefined)).toEqual([]);
    expect(pb.map((p) => asm(p)).filter((x) => x !== undefined)).toEqual([b]);
  });

  it('rejects hostile pieces: huge counts, oversized or malformed pieces, endless unfinished messages', () => {
    const asm = createAssembler();
    const piece = (o: object) => ({ __chunk: 1, id: 1, i: 0, n: 3, d: 'x', ...o });
    expect(asm(piece({ n: MAX_PIECES + 1 }))).toBeUndefined();
    expect(asm(piece({ n: 1 }))).toBeUndefined();
    expect(asm(piece({ d: 'я'.repeat(PIECE_CHARS + 1) }))).toBeUndefined();
    expect(asm(piece({ i: -1 }))).toBeUndefined();
    expect(asm(piece({ id: 'x' }))).toBeUndefined();
    expect(asm(piece({ d: 5 }))).toBeUndefined();
    // бесконечная череда начал не копит память: держится только одна сборка
    for (let id = 0; id < 5000; id++) expect(asm(piece({ id, d: 'я'.repeat(PIECE_CHARS) }))).toBeUndefined();
    // собранное, но не JSON — тихо отбрасывается
    const bad = createAssembler();
    expect([bad({ __chunk: 1, id: 1, i: 0, n: 2, d: '{не json' }), bad({ __chunk: 1, id: 1, i: 1, n: 2, d: '' })]).toEqual([undefined, undefined]);
  });
});

/** Канал, который ведёт себя как json-канал PeerJS: сообщение от 16300 байт не отправляется, а вызывает ошибку. */
function fakeChannel() {
  const handlers: Record<string, ((x?: unknown) => void)[]> = {};
  const other: { dc?: DataConnection } = {};
  const dc = {
    open: true,
    on: (ev: string, cb: (x?: unknown) => void) => ((handlers[ev] ??= []).push(cb), dc),
    send: (m: unknown) => {
      if (bytes(m) >= 16300) return void handlers.error?.forEach((cb) => cb({ type: 'message-too-big' }));
      queueMicrotask(() => (other.dc as unknown as { _deliver(m: unknown): void })._deliver(JSON.parse(JSON.stringify(m))));
    },
    _deliver: (m: unknown) => handlers.data?.forEach((cb) => cb(m)),
    close: () => handlers.close?.forEach((cb) => cb()),
  };
  return { dc: dc as unknown as DataConnection, other, handlers };
}

describe('wrap() over a json channel with the PeerJS size limit', () => {
  it('delivers a 60 KB view intact and does not report the connection as closed', async () => {
    const a = fakeChannel(), b = fakeChannel();
    a.other.dc = b.dc; b.other.dc = a.dc;
    const host = wrap<unknown>(a.dc), guest = wrap<unknown>(b.dc);
    const received: unknown[] = [];
    let closed = 0;
    guest.onMessage((m) => received.push(m));
    host.onClose(() => closed++);
    const view = big(60), small = { t: 'notice', text: 'ок' };
    host.send(view);
    host.send(small);
    host.send(big(33));
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toEqual([view, small, big(33)]);
    expect(closed).toBe(0);
  });

  it('still treats other channel errors as a lost connection', () => {
    const a = fakeChannel();
    const conn = wrap<unknown>(a.dc);
    let closed = 0;
    conn.onClose(() => closed++);
    a.handlers.error?.forEach((cb) => cb({ type: 'network' }));
    a.handlers.close?.forEach((cb) => cb());
    expect(closed).toBe(2);
  });
});
