import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../../data/classicPack';
import {
  OnlineClient,
  OnlineHost,
  viewFor,
  sanitizeView,
  type C2H,
  type H2C,
  type Conn,
} from '../online';
import { beginSecretRound } from './engine';
import { defaultThreatSettings } from './roles';
import { validateSavedGame } from '../storage';

function pair() {
  let hostRead: (m: unknown) => void = () => {},
    clientRead: (m: unknown) => void = () => {},
    hostClose = () => {},
    clientClose = () => {};
  const received: H2C[] = [];
  const hostSide: Conn<H2C> = {
    send: (m) => {
      const serialized = JSON.parse(JSON.stringify(m));
      received.push(serialized);
      queueMicrotask(() => clientRead(serialized));
    },
    onMessage: (cb) => {
      hostRead = cb;
    },
    onClose: (cb) => {
      hostClose = cb;
    },
    close: () => clientClose(),
  };
  const clientSide: Conn<C2H> = {
    send: (m) => queueMicrotask(() => hostRead(JSON.parse(JSON.stringify(m)))),
    onMessage: (cb) => {
      clientRead = cb;
    },
    onClose: (cb) => {
      clientClose = cb;
    },
    close: () => hostClose(),
  };
  return { hostSide, clientSide, received, raw: (m: unknown) => hostRead(m) };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function setup(n = 4) {
  const host = new OnlineHost({
    scenario: CLASSIC_PACK.scenarios[0],
    packs: [CLASSIC_PACK],
    slots: 1,
    voting: 'secret',
    revealsPerVote: 1,
    speechSec: 0,
    hiddenThreat: defaultThreatSettings,
  });
  const guests = Array.from({ length: n - 1 }, (_, i) => {
    const p = pair();
    host.addConn(p.hostSide);
    return {
      p,
      client: new OnlineClient(p.clientSide, `Guest ${i}`, `token-${i}`),
    };
  });
  await tick();
  expect(host.start()).toBe(true);
  await tick();
  if (n === 4) {
    const s = host.game!.hiddenThreat!;
    for (const [id, p] of Object.entries(s.players))
      p.role = id === 'p1' ? 'maniac' : id === 'p2' ? 'police' : 'civilian';
    s.evidence = s.evidence.filter((e) => e.type === 'permit');
  }
  return { host, guests };
}
const command = (id: string, operation: unknown, round = 1) => ({
  t: 'secret',
  command: { id, round, operation },
});

// Inspect the serialized host messages as well as sanitized client state: sanitizing at the receiver cannot hide a host leak.
describe('hidden threat authoritative online protocol', () => {
  it('does not send a foreign role map, dossiers, ledger, commands, audit or tokens to any recipient', async () => {
    const { host, guests } = await setup(8);
    const s = host.game!.hiddenThreat!;
    s.audit.push({
      round: 1,
      actor: 'p1',
      kind: 'sabotage',
      target: 'p8',
      detail: 'PRIVATE-AUDIT-SENTINEL',
    });
    s.credited.push('PRIVATE-LEDGER-SENTINEL');
    s.players['p3'].notices.push('PRIVATE-NOTICE-SENTINEL');
    for (const { p } of guests)
      p.raw({
        t: 'hello',
        name: 'same',
        token: host.members.find((m) => m.conn === p.hostSide)!.token,
      });
    await tick();
    for (const [i, { p, client }] of guests.entries()) {
      const last = p.received.filter((m) => m.t === 'view').at(-1)!;
      if (last.t !== 'view' || client.state.status !== 'game')
        throw new Error('missing view');
      const me = host.members[i + 1].playerId!;
      expect(last.view.hiddenThreat).toBeUndefined();
      expect(last.view.threatView!.mine!.playerId).toBe(me);
      const wire = JSON.stringify(last);
      expect(wire).not.toContain('PRIVATE-AUDIT-SENTINEL');
      expect(wire).not.toContain('PRIVATE-LEDGER-SENTINEL');
      expect(wire).not.toContain('token-');
      if (me !== 'p3') expect(wire).not.toContain('PRIVATE-NOTICE-SENTINEL');
      expect(last.view.threatView!.final).toBeUndefined();
      const mine = last.view.threatView!.mine!;
      expect(mine.allies).toEqual(
        mine.role === 'mafia'
          ? Object.keys(s.players).filter(
              (id) => id !== me && s.players[id].role === 'mafia',
            )
          : [],
      );
    }
    host.destroy();
  });
  it('binds operations to the connection and ignores fake roles, balances and another player id', async () => {
    const { host, guests } = await setup();
    host.game = beginSecretRound(host.game!);
    const civilian = guests[2];
    const before = JSON.stringify(host.game!.hiddenThreat);
    civilian.p.raw({
      ...command('forged-command-id', {
        kind: 'investigate',
        target: 'p1',
        direction: 'connections',
      }),
      playerId: 'p2',
      role: 'police',
      points: 100,
    });
    civilian.p.raw({ t: 'grantPoints', playerId: 'p4', points: 100 });
    await tick();
    expect(JSON.stringify(host.game!.hiddenThreat)).toBe(before);
    expect(civilian.p.received.some((m) => m.t === 'notice')).toBe(true);
    host.destroy();
  });
  it('duplicates, stale rounds and a second commit never spend resources or grant points', async () => {
    const { host, guests } = await setup();
    host.game = beginSecretRound(host.game!);
    const police = guests[0];
    const cmd = command('network-check-123', {
      kind: 'investigate',
      target: 'p4',
      direction: 'dossier',
    });
    police.p.raw(cmd);
    police.p.raw(cmd);
    police.p.raw(
      command('new-command-123', {
        kind: 'investigate',
        target: 'p3',
        direction: 'actions',
      }),
    );
    guests[1].p.raw(command('stale-command-123', { kind: 'pass' }, 2));
    await tick();
    expect(Object.keys(host.game!.hiddenThreat!.pending)).toEqual(['p2']);
    host.actAsHost({
      t: 'secret',
      command: {
        id: 'host-sabotage-123',
        round: 1,
        operation: {
          kind: 'sabotage',
          target: 'p2',
          method: 'plant',
          evidence: 'knife',
        },
      },
    });
    guests[1].p.raw(command('pass-network-333', { kind: 'pass' }));
    guests[2].p.raw(command('pass-network-444', { kind: 'pass' }));
    await tick();
    expect(host.game!.phase).toBe('discussion');
    expect(host.game!.hiddenThreat!.players['p2'].points).toBe(1);
    expect(host.game!.hiddenThreat!.players['p2'].checks).toBe(1);
    police.p.raw(cmd);
    await tick();
    expect(host.game!.hiddenThreat!.players['p2'].points).toBe(1);
    expect(
      host.game!.hiddenThreat!.evidence.filter((e) => e.planted),
    ).toHaveLength(1);
    host.destroy();
  });
  it('does not let a saboteur infer that the chosen target is police through its snapshot', async () => {
    const { host, guests } = await setup();
    host.game = beginSecretRound(host.game!);
    host.actAsHost({
      t: 'secret',
      command: {
        id: 'framing-command-123',
        round: 1,
        operation: {
          kind: 'sabotage',
          target: 'p2',
          method: 'plant',
          evidence: 'knife',
        },
      },
    });
    for (const [i, guest] of guests.entries())
      guest.p.raw(command(`pass-command-${i}`, { kind: 'pass' }));
    await tick();
    const criminal = host.viewFor(0)!;
    const wire = JSON.stringify(criminal);
    expect(wire).not.toContain('Подстава полицейского');
    expect(wire).not.toContain('Попытка вмешательства');
    expect(wire).not.toContain('evidenceId');
    expect(criminal.threatView!.mine!.points).toBe(0);
    expect(criminal.threatView!.mine!.notices).toEqual([]);
    const police = guests[0].client.state;
    if (police.status !== 'game') throw new Error();
    expect(police.view.threatView!.mine!.points).toBe(1);
    host.destroy();
  });
  it('reconnects and resumes host checkpoints without redistributing roles or losing the committed batch', async () => {
    const { host, guests } = await setup();
    host.game = beginSecretRound(host.game!);
    guests[0].p.raw(
      command('saved-police-command', {
        kind: 'investigate',
        target: 'p4',
        direction: 'dossier',
      }),
    );
    await tick();
    const saved = JSON.parse(JSON.stringify(host.checkpoint()));
    const restored = OnlineHost.restoreCheckpoint(saved)!;
    expect(restored).not.toBeNull();
    expect(validateSavedGame(restored.game)).not.toBeNull();
    expect(restored.game!.hiddenThreat).toEqual(host.game!.hiddenThreat);
    const p = pair();
    restored.addConn(p.hostSide);
    const returned = new OnlineClient(p.clientSide, 'Changed', 'token-0');
    await tick();
    expect(returned.state.status).toBe('game');
    if (returned.state.status !== 'game') throw new Error();
    expect(returned.state.me).toBe('p2');
    expect(returned.state.view.threatView!.mine!.role).toBe('police');
    expect(returned.state.view.threatView!.mine!.submitted).toBe(true);
    p.raw(
      command('saved-police-command', {
        kind: 'investigate',
        target: 'p4',
        direction: 'dossier',
      }),
    );
    await tick();
    expect(Object.keys(restored.game!.hiddenThreat!.pending)).toEqual(['p2']);
    saved.members[1].playerId = 'p1';
    expect(OnlineHost.restoreCheckpoint(saved)).toBeNull();
    host.destroy();
    restored.destroy();
  });
  it('fills disconnected candidates with pass, not an invented role-specific action', async () => {
    const { host, guests } = await setup();
    host.game = beginSecretRound(host.game!);
    guests.forEach((g) => g.client.destroy());
    await tick();
    host.actAsHost({
      t: 'secret',
      command: {
        id: 'host-pass-command',
        round: 1,
        operation: { kind: 'pass' },
      },
    });
    host.autofillDisconnected();
    expect(host.game!.phase).toBe('discussion');
    expect(host.game!.hiddenThreat!.sabotageUsed).toBe(0);
    expect(host.game!.hiddenThreat!.players['p2'].checks).toBe(0);
    host.destroy();
  });
  it('recipient sanitization whitelists nested fields and refuses a foreign private identity', async () => {
    const { host } = await setup();
    const projected = viewFor(host.game!, 'p4');
    const injected = JSON.parse(JSON.stringify(projected));
    injected.hiddenThreat = host.game!.hiddenThreat;
    injected.threatView.players = host.game!.hiddenThreat!.players;
    injected.threatView.mine.points = 1001;
    expect(sanitizeView(injected, 'p4')).toBeNull();
    injected.threatView.mine.points = 0;
    expect(sanitizeView(injected, 'p4')!.hiddenThreat).toBeUndefined();
    expect(
      JSON.stringify(sanitizeView(injected, 'p4')!.threatView),
    ).not.toContain('players');
    expect(sanitizeView(projected, 'p2')).toBeNull();
    host.destroy();
  });
  it('discloses final roles and activity only in the final snapshot', async () => {
    const { host } = await setup();
    host.game!.phase = 'result';
    expect(host.viewFor(0)!.threatView!.final).toBeUndefined();
    host.game!.phase = 'final';
    const final = sanitizeView(host.viewFor(0), 'p1')!;
    expect(final.threatView!.final!.roles).toHaveLength(4);
    host.destroy();
  });
  it('queues publications privately, preserves them on resume and releases only a host-controlled anonymous batch', async () => {
    const { host, guests } = await setup();
    host.game = beginSecretRound(host.game!);
    host.actAsHost({
      t: 'secret',
      command: {
        id: 'publication-plant',
        round: 1,
        operation: {
          kind: 'sabotage',
          target: 'p4',
          method: 'plant',
          evidence: 'knife',
        },
      },
    });
    guests[0].p.raw(
      command('publication-check', {
        kind: 'investigate',
        target: 'p4',
        direction: 'dossier',
      }),
    );
    guests[1].p.raw(command('publication-pass3', { kind: 'pass' }));
    guests[2].p.raw(command('publication-pass4', { kind: 'pass' }));
    await tick();
    const before = JSON.stringify(host.viewFor(3));
    const finding = host.game!.hiddenThreat!.players['p2'].findings[0];
    guests[2].p.raw({ t: 'publish', finding: finding.id });
    await tick();
    expect(host.game!.hiddenThreat!.pendingPublications).toEqual([]);
    guests[0].p.raw({ t: 'publish', finding: finding.id });
    await tick();
    expect(JSON.stringify(host.viewFor(3))).toBe(before);
    const wire = guests[2].p.received.filter((m) => m.t === 'view').at(-1)!;
    if (wire.t !== 'view') throw new Error('missing view');
    expect(wire.view).toEqual(host.viewFor(3));
    const restored = OnlineHost.restoreCheckpoint(
      JSON.parse(JSON.stringify(host.checkpoint())),
    )!;
    expect(restored.game!.hiddenThreat!.pendingPublications).toEqual([
      finding.id,
    ]);
    guests[0].p.raw({ t: 'releasePublications' });
    await tick();
    expect(JSON.stringify(host.viewFor(3))).toBe(before);
    host.releasePublications();
    await tick();
    const published = host.viewFor(3)!.threatView!.public.published;
    expect(published).toHaveLength(1);
    expect(JSON.stringify(published)).not.toMatch(
      /actor|evidenceId|planted|forged|p2/,
    );
    expect(host.game!.hiddenThreat!.audit.at(-1)!.actor).toBe('p2');
    host.destroy();
    restored.destroy();
  });
});
