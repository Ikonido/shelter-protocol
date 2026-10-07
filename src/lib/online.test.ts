import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import { EVENTS } from './events';
import { applyEvent } from './game';
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
  const host = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'secret', revealsPerVote: 1, speechSec: 0, roundEvents: false }, 'Хост');
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

  it('action cards can be played during the vote and are announced to everyone', async () => {
    const { host, clients } = await setup();
    host.start();
    await tick();
    host.actAsHost({ t: 'reveal', category: 'biology' });
    clients.forEach(({ c }) => c.send({ t: 'reveal', category: 'biology' }));
    await tick();
    expect(host.game!.phase).toBe('vote');
    clients[0].c.send({ t: 'action' });
    await tick();
    const me = host.game!.players.find((p) => p.id === 'p2')!;
    expect(me.slots.action.isRevealed).toBe(true);
    expect(host.game!.log.some((l) => l.text.includes('применяет карту действия'))).toBe(true);
    clients[0].c.send({ t: 'action' }); // повторно нельзя
    await tick();
    expect(host.game!.log.filter((l) => l.text.includes('применяет карту действия'))).toHaveLength(1);
  });

  it('plays a round: reveal → debate → secret vote → result; rejects bad input', async () => {
    const { host, clients } = await setup();
    host.start();
    await tick();
    clients.forEach(({ c }) => c.send({ t: 'reveal', category: 'health' })); // не биология в 1-м раунде и не их очередь — игнор
    clients[0].c.send({ t: 'reveal', category: 'biology' }); // очередь хоста (p1), а не гостя
    clients[0].c.send({ t: 'vote', target: 'p1' }); // голос вне фазы — игнор
    await tick();
    expect(host.game!.phase).toBe('reveal');
    expect(host.game!.revealedThisRound).toEqual([]);
    expect(host.game!.votes).toEqual({});
    host.actAsHost({ t: 'reveal', category: 'biology' });
    clients.forEach(({ c }) => c.send({ t: 'reveal', category: 'biology' }));
    await tick();
    expect(host.game!.phase).toBe('vote'); // все сходили, вскрытие одно -> голосование
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
    expect(host.game!.revealedThisRound).toEqual([]); // сейчас очередь хоста — за него автоход не делается
    host.actAsHost({ t: 'reveal', category: 'biology' });
    host.autofillDisconnected(); // очередь p2, а он отключён
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
    host.actAsHost({ t: 'reveal', category: 'biology' });
    clients.forEach(({ c }) => c.send({ t: 'reveal', category: 'biology' }));
    await tick();
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

describe('abstain, steps and timer online', () => {
  it('abstain is accepted; a majority of abstentions keeps everyone', async () => {
    const { host, clients } = await setup();
    host.start();
    await tick();
    host.actAsHost({ t: 'reveal', category: 'biology' });
    clients.forEach(({ c }) => c.send({ t: 'reveal', category: 'biology' }));
    await tick();
    host.actAsHost({ t: 'vote', target: 'abstain' });
    clients[0].c.send({ t: 'vote', target: 'abstain' });
    clients[1].c.send({ t: 'vote', target: 'p1' });
    await tick();
    expect(host.game!.phase).toBe('result');
    expect(host.game!.lastResult?.skipped).toBe(true);
    expect(host.game!.players.every((p) => !p.isEliminated)).toBe(true);
    const st = clients[0].c.state;
    if (st.status !== 'game') throw new Error('no view');
    expect(st.view.lastResult?.skipped).toBe(true);
    expect(st.view.votes).toEqual({}); // тайные бюллетени (включая воздержавшихся) не раскрываются
  });

  it('two reveals per vote online, and clients get time left instead of host clock', async () => {
    const host = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'open', timeLimitMin: 10, roundEvents: false }, 'Хост');
    const p = pair();
    host.addConn(p.hostSide);
    const c = new OnlineClient(p.clientSide, 'Гость', 'tok');
    await tick();
    host.start();
    await tick();
    expect(host.game!.config.revealsPerVote).toBe(2);
    const st = c.state;
    if (st.status !== 'game') throw new Error('no view');
    expect(st.view.deadline).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(st.view.deadline).toBeLessThan(Date.now() + 10 * 60_000 + 1000);
    host.actAsHost({ t: 'reveal', category: 'biology' });
    expect(host.game!.phase).toBe('speech');
    host.skipSpeech();
    c.send({ t: 'reveal', category: 'biology' });
    await tick();
    host.skipSpeech();
    expect(host.game!.phase).toBe('reveal'); // второе вскрытие
    expect(host.game!.revealStep).toBe(2);
    host.tick(host.game!.deadline! + 1); // время вышло
    expect(host.game!.phase).toBe('vote');
  });
});

describe('speech turns online', () => {
  it('speaker explains with a timer, anyone else cannot skip it, timeout/“done”/host skip move on', async () => {
    const host = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'open', revealsPerVote: 1, speechSec: 30, roundEvents: false }, 'Хост');
    const clients = [] as OnlineClient[];
    for (let i = 1; i <= 2; i++) {
      const p = pair();
      host.addConn(p.hostSide);
      clients.push(new OnlineClient(p.clientSide, `Гость${i}`, `t${i}`));
    }
    await tick();
    host.start();
    await tick();
    host.actAsHost({ t: 'reveal', category: 'biology' });
    await tick();
    const st = clients[0].state;
    if (st.status !== 'game') throw new Error('no view');
    expect(st.view.phase).toBe('speech');
    expect(st.view.lastReveal).toEqual({ playerId: 'p1', category: 'biology' });
    expect(st.view.speechEndsAt!).toBeGreaterThan(Date.now() + 29_000); // клиент получает «осталось», а не часы хоста
    expect(st.view.speechEndsAt!).toBeLessThan(Date.now() + 31_000);
    clients[0].send({ t: 'done' }); // не его речь — игнор
    await tick();
    expect(host.game!.phase).toBe('speech');
    host.tick(Date.now() + 1000); // рано
    expect(host.game!.phase).toBe('speech');
    host.tick(host.game!.speechEndsAt! + 1); // таймер -> ходит p2
    expect(host.game!.phase).toBe('reveal');
    clients[0].send({ t: 'reveal', category: 'biology' });
    await tick();
    expect(host.game!.phase).toBe('speech');
    clients[0].send({ t: 'done' }); // сам закончил раньше времени -> ходит p3
    await tick();
    expect(host.game!.phase).toBe('reveal');
    clients[1].send({ t: 'reveal', category: 'biology' });
    await tick();
    host.skipSpeech(); // хост пропустил последнюю речь -> голосование
    expect(host.game!.phase).toBe('vote');
  });
});

describe('threat factors online', () => {
  it('host picks hazards (default 2) and clients receive them sanitized', async () => {
    const host = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[2], packs: [CLASSIC_PACK], slots: 1, voting: 'open', revealsPerVote: 1, roundEvents: false }, 'Хост');
    const p = pair();
    host.addConn(p.hostSide);
    const c = new OnlineClient(p.clientSide, 'Гость', 'tok');
    await tick();
    host.start();
    await tick();
    expect(host.game!.hazards).toHaveLength(2);
    const st = c.state;
    if (st.status !== 'game') throw new Error('no view');
    expect(st.view.hazards!.map((h) => h.id)).toEqual(host.game!.hazards!.map((h) => h.id));
    expect(st.view.config.hazardCount).toBe(2);
  });
  it('hostile hazards from the host are clamped', async () => {
    const p = pair();
    const c = new OnlineClient(p.clientSide, 'a', 't');
    const { host } = await setup();
    host.start();
    const good = JSON.parse(JSON.stringify(host.viewFor(0)));
    good.hazards = Array.from({ length: 50 }, () => ({ id: 'x', title: 'y'.repeat(999), description: 'z'.repeat(999), counters: Array(50).fill('c'), severity: 'bogus' }));
    (p.hostSide as unknown as { send(m: unknown): void }).send({ t: 'view', me: 'p1', view: good });
    await tick();
    if (c.state.status !== 'game') throw new Error('should accept sanitized');
    const hs = c.state.view.hazards!;
    expect(hs.length).toBeLessThanOrEqual(4);
    expect(hs[0].title.length).toBe(40);
    expect(hs[0].counters.length).toBeLessThanOrEqual(4);
    expect(hs[0].severity).toBe('major');
  });
});

describe('round events online', () => {
  const make = async (events: boolean) => {
    const host = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[2], packs: [CLASSIC_PACK], slots: 2, voting: 'open', revealsPerVote: 1, speechSec: 0, roundEvents: events }, 'Хост');
    const clients: OnlineClient[] = [];
    for (let i = 1; i <= 3; i++) {
      const p = pair();
      host.addConn(p.hostSide);
      clients.push(new OnlineClient(p.clientSide, `Гость${i}`, `t${i}`));
    }
    await tick();
    host.start();
    await tick();
    return { host, clients };
  };

  it('the round opens with a crisis card; nobody can reveal until the host starts the round', async () => {
    const { host, clients } = await make(true);
    expect(host.game!.phase).toBe('event');
    const st = clients[0].state;
    if (st.status !== 'game') throw new Error('no view');
    expect(st.view.phase).toBe('event');
    expect(st.view.event?.title).toBeTruthy();
    host.actAsHost({ t: 'reveal', category: 'biology' });
    await tick();
    expect(host.game!.revealedThisRound).toEqual([]); // события ещё не закончились
    host.startRound();
    await tick();
    expect(host.game!.phase).toBe('reveal');
    host.actAsHost({ t: 'reveal', category: 'biology' });
    expect(host.game!.revealedThisRound).toEqual(['p1']);
  });

  it('a guest can volunteer during the volunteer event, only then', async () => {
    const { host, clients } = await make(true);
    const g = host.game!;
    // подменяем событие на «добровольца» (выпавшее случайно может быть любым)
    host.game = { ...applyEvent({ ...g, event: undefined, usedEvents: [], phase: 'reveal' }, EVENTS.find((e) => e.kind === 'volunteer')!), phase: 'event' };
    clients[1].send({ t: 'volunteer' });
    await tick();
    expect(host.game!.players.find((p) => p.id === 'p3')!.isEliminated).toBe(true);
    host.startRound();
    clients[0].send({ t: 'volunteer' }); // вне фазы события — игнор
    await tick();
    expect(host.game!.players.find((p) => p.id === 'p2')!.isEliminated).toBe(false);
  });

  it('clients clamp a hostile event card', async () => {
    const p = pair();
    const c = new OnlineClient(p.clientSide, 'a', 't');
    const { host } = await make(true);
    const good = JSON.parse(JSON.stringify(host.viewFor(0)));
    good.event = { id: 'x', kind: 'plague', tone: 'bad', title: 'T'.repeat(999), text: 'x'.repeat(9999), outcome: Array(500).fill('o'.repeat(999)) };
    (p.hostSide as unknown as { send(m: unknown): void }).send({ t: 'view', me: 'p1', view: good });
    await tick();
    if (c.state.status !== 'game') throw new Error('should accept sanitized');
    expect(c.state.view.event!.title.length).toBe(80);
    expect(c.state.view.event!.outcome.length).toBe(24);
    const bad = JSON.parse(JSON.stringify(good));
    bad.event.kind = 'rm -rf';
    const p2 = pair();
    const c2 = new OnlineClient(p2.clientSide, 'a', 't');
    (p2.hostSide as unknown as { send(m: unknown): void }).send({ t: 'view', me: 'p1', view: bad });
    await tick();
    if (c2.state.status === 'game') expect(c2.state.view.event).toBeUndefined(); // неизвестный вид события отбрасывается
  });
});

describe('18+ notice online', () => {
  it('guests are told about adult content before the game starts', async () => {
    const host = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'open', adult: true, roundEvents: false }, 'Хост');
    const p = pair();
    host.addConn(p.hostSide);
    const c = new OnlineClient(p.clientSide, 'Гость', 'tok');
    await tick();
    if (c.state.status !== 'lobby') throw new Error('not in lobby');
    expect(c.state.adult).toBe(true);
    const plain = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'open', roundEvents: false }, 'Хост');
    const q = pair();
    plain.addConn(q.hostSide);
    const c2 = new OnlineClient(q.clientSide, 'Гость', 't2');
    await tick();
    if (c2.state.status !== 'lobby') throw new Error('not in lobby');
    expect(c2.state.adult).toBe(false);
  });
});
