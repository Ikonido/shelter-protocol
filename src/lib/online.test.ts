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

describe('security', () => {
  const play = async () => {
    const { host, clients } = await setup();
    host.start();
    await tick();
    host.actAsHost({ t: 'reveal', category: 'profession' });
    clients.forEach(({ c }) => c.send({ t: 'reveal', category: 'profession' }));
    await tick();
    host.toVote();
    host.actAsHost({ t: 'vote', target: 'p3' });
    clients[0].c.send({ t: 'vote', target: 'p3' });
    clients[1].c.send({ t: 'vote', target: 'p1' });
    await tick();
    return { host, clients };
  };

  it('secret ballots are not leaked in the result phase', async () => {
    const { host, clients } = await play();
    expect(host.game!.phase).toBe('result');
    const st = clients[0].c.state;
    if (st.status !== 'game') throw new Error('no view');
    // клиент p2 не должен узнать, кто за кого голосовал (кроме себя)
    expect(st.view.votes).toEqual({});
  });

  it('one connection cannot register several members', async () => {
    const { host, clients } = await setup();
    clients[0].p.raw({ t: 'hello', name: 'Клон', token: 'other' });
    clients[0].p.raw({ t: 'hello', name: 'Клон2', token: 'other2' });
    await tick();
    expect(host.members).toHaveLength(3);
  });

  it('locked room and kick', async () => {
    const { host } = await setup();
    host.locked = true;
    const p = pair();
    host.addConn(p.hostSide);
    const late = new OnlineClient(p.clientSide, 'Поздний', 'zzz');
    await tick();
    expect(late.state.status).toBe('rejected');
    host.kick(1);
    await tick();
    expect(host.members.map((m) => m.name)).toEqual(['Хост', 'Гость2']);
  });

  it('drops flooding connections', async () => {
    const { host, clients } = await setup();
    for (let i = 0; i < 200; i++) clients[0].p.raw({ t: 'action' });
    await tick();
    expect(host.members.find((m) => m.name === 'Гость1')!.connected).toBe(false);
  });

  it('client rejects malformed or hostile host state without crashing', async () => {
    const p = pair();
    const c = new OnlineClient(p.clientSide, 'a', 't');
    const send = (m: unknown) => (p.hostSide as unknown as { send(m: unknown): void }).send(m);
    send({ t: 'view', me: 'p1', view: { players: [{}], scenario: {} } });
    await tick();
    expect(c.state.status).toBe('connecting');
    const { host } = await setup();
    host.start();
    const good = JSON.parse(JSON.stringify(host.viewFor(0)));
    good.players[0].name = 'x'.repeat(5000);
    good.log = Array.from({ length: 5000 }, () => ({ round: 1, text: 'y'.repeat(5000) }));
    send({ t: 'view', me: 'p1', view: good });
    await tick();
    if (c.state.status !== 'game') throw new Error('should accept sanitized');
    expect(c.state.view.players[0].name.length).toBe(24);
    expect(c.state.view.log.length).toBeLessThanOrEqual(200);
  });
});
