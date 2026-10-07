import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import { CATEGORIES } from '../types';
import { OnlineClient, OnlineHost, type C2H, type Conn, type H2C } from './online';

function pair() {
  let toHost: (m: unknown) => void = () => {};
  let toClient: (m: unknown) => void = () => {};
  let hostClose = () => {}, clientClose = () => {};
  const hostSide: Conn<H2C> = { send: (m) => queueMicrotask(() => toClient(JSON.parse(JSON.stringify(m)))), onMessage: (cb) => (toHost = cb), onClose: (cb) => (hostClose = cb), close: () => clientClose() };
  const clientSide: Conn<C2H> = { send: (m) => queueMicrotask(() => toHost(JSON.parse(JSON.stringify(m)))), onMessage: (cb) => (toClient = cb), onClose: (cb) => (clientClose = cb), close: () => hostClose() };
  return { hostSide, clientSide, raw: (m: unknown) => toHost(m) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

async function setup(n = 3) {
  const host = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'secret' }, 'Хост');
  const clients = [] as { c: OnlineClient; p: ReturnType<typeof pair> }[];
  for (let i = 1; i < n; i++) {
    const p = pair();
    host.addConn(p.hostSide);
    clients.push({ c: new OnlineClient(p.clientSide, `Гость${i}`, `tok${i}`), p });
  }
  await tick();
  return { host, clients };
}

describe('online', () => {
  it('lobby → game, clients never receive foreign hidden cards or the seed', async () => {
    const { host, clients } = await setup();
    expect(clients[0].c.state.status).toBe('lobby');
    expect(host.start()).toBe(true);
    await tick();
    const st = clients[0].c.state;
    if (st.status !== 'game') throw new Error('not in game');
    for (const p of st.view.players) {
      if (p.id === st.me) continue;
      for (const c of CATEGORIES) expect(p.slots[c].card.description).toBe('???');
    }
    expect(st.view.seed).toBe(0);
    const mine = st.view.players.find((p) => p.id === st.me)!;
    expect(mine.slots.profession.card.description).not.toBe('???');
  });

  it('plays a round: reveal → debate → secret vote → result; rejects bad input', async () => {
    const { host, clients } = await setup();
    host.start();
    await tick();
    clients.forEach(({ c }) => c.send({ t: 'reveal', category: 'health' })); // не профессия в 1-м раунде — игнор
    await tick();
    expect(host.game!.phase).toBe('reveal');
    host.actAsHost({ t: 'reveal', category: 'profession' });
    clients.forEach(({ c }) => c.send({ t: 'reveal', category: 'profession' }));
    await tick();
    expect(host.game!.phase).toBe('debate');
    clients[0].c.send({ t: 'vote', target: 'p1' }); // голос вне фазы — игнор
    await tick();
    expect(host.game!.votes).toEqual({});
    host.toVote();
    host.actAsHost({ t: 'vote', target: 'p3' });
    clients[0].c.send({ t: 'vote', target: 'p1' });
    clients[0].c.send({ t: 'vote', target: 'ghost' }); // нет такого игрока
    await tick();
    expect(host.game!.phase).toBe('vote');
    clients[1].c.send({ t: 'vote', target: 'p3' }); // сам за себя нельзя? p3 голосует за p3
    await tick();
    expect(host.game!.phase).toBe('vote');
    clients[1].c.send({ t: 'vote', target: 'p1' });
    await tick();
    expect(host.game!.phase).toBe('result');
    expect(host.game!.players.filter((p) => p.isEliminated)).toHaveLength(1);
    host.next();
    expect(host.game!.round).toBe(2); // 3 игрока, 1 место: два раунда по одному исключению
    expect(host.game!.phase).toBe('reveal');
  });

  it('rejects late joiners, allows token rejoin, autofills for dropped players', async () => {
    const { host, clients } = await setup();
    host.start();
    await tick();
    const late = pair();
    host.addConn(late.hostSide);
    const lateClient = new OnlineClient(late.clientSide, 'Опоздал', 'newtok');
    await tick();
    expect(lateClient.state.status).toBe('rejected');
    clients[0].c.destroy();
    await tick();
    expect(host.disconnectedPending()).toEqual(['Гость1']);
    const again = pair();
    host.addConn(again.hostSide);
    const back = new OnlineClient(again.clientSide, 'Гость1', 'tok1');
    await tick();
    expect(back.state.status).toBe('game');
    back.destroy();
    await tick();
    host.autofillDisconnected();
    expect(host.game!.revealedThisRound).toContain('p2');
  });

  it('ignores garbage', async () => {
    const { host, clients } = await setup();
    clients[0].p.raw(null);
    clients[0].p.raw({ t: 'hello', name: '', token: '' });
    clients[0].p.raw({ t: 'nope' });
    await tick();
    expect(host.members).toHaveLength(3);
  });
});
