import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CLASSIC_PACK } from '../../data/classicPack';
import type { GameState } from '../../types';
import { Gate } from '../../ui/Gate';
import { ThreatFinal, ThreatPublic } from '../../ui/HiddenThreat';
import { OnlineClient, OnlineHost, sanitizeView, viewFor, type C2H, type Conn, type H2C } from '../online';
import { validateSavedGame, saveGame, loadGame } from '../storage';
import { clearHostedRoom, loadHostedRoom, saveHostedRoom } from './hostStorage';
import { collect, game, review } from './testHelpers';

function pair() {
  let toHost = (_m: unknown) => {}, toClient = (_m: unknown) => {}, closeHost = () => {}, closeClient = () => {};
  const wire: H2C[] = [];
  const h: Conn<H2C> = { send: m => { wire.push(JSON.parse(JSON.stringify(m))); toClient(JSON.parse(JSON.stringify(m))); }, onMessage: cb => { toHost = cb; }, onClose: cb => { closeHost = cb; }, close: () => closeClient() };
  const c: Conn<C2H> = { send: m => toHost(JSON.parse(JSON.stringify(m))), onMessage: cb => { toClient = cb; }, onClose: cb => { closeClient = cb; }, close: () => closeHost() };
  return { h, c, wire, raw: (m: unknown) => toHost(m) };
}
function room(n = 4) {
  const host = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'secret', variant: 'hidden-threat', hiddenThreat: { criminal: n >= 8 ? 'mafia' : 'maniac', report: 'hidden' }, speechSec: 0, revealsPerVote: 1 }, 'Candidate 1');
  const peers = Array.from({ length: n - 1 }, (_, i) => { const p = pair(); host.addConn(p.h); const client = new OnlineClient(p.c, `Candidate ${i + 2}`, `token${i + 2}`); return { ...p, client }; });
  host.start();
  host.game = { ...game(n), config: { ...game(n).config, mode: 'online' } };
  return { host, peers };
}
describe('private host projections', () => {
  it.each([4, 8, 12])('transmits only the recipient role and authorized mafia allies for %i', n => {
    const g = collect(game(n), { p1: { kind: 'plant', target: n >= 8 ? 'p4' : 'p3', evidence: 'medical' } });
    for (const p of g.players) {
      const v = JSON.parse(JSON.stringify(viewFor(g, p.id))) as GameState;
      expect(v.hiddenThreat).toBeUndefined();
      expect(v.threatView?.final).toBeUndefined();
      expect(v.threatView?.me?.role).toBe(g.hiddenThreat!.players[p.id].role);
      expect(v.threatView?.me?.playerId).toBe(p.id);
      expect(JSON.stringify(v)).not.toContain('evidence-1');
      expect(JSON.stringify(v)).not.toContain('"pending"');
      expect(JSON.stringify(v)).not.toContain('"audit"');
      expect(JSON.stringify(v)).not.toContain('"rewarded"');
      if (g.hiddenThreat!.players[p.id].role === 'mafia') expect(v.threatView?.me?.allies).toHaveLength(n <= 9 ? 1 : 2);
      else expect(v.threatView?.me?.allies).toEqual([]);
      if (g.hiddenThreat!.players[p.id].role === 'civilian') expect(v.threatView?.me?.sabotageUses).toBeUndefined();
      const clean = sanitizeView(v)!;
      expect(clean.threatView?.me).toEqual(v.threatView?.me);
      expect(clean.hiddenThreat).toBeUndefined();
    }
  });
  it('only the officer receives investigation results and their finding identifiers', () => {
    const g = collect(game(), { p1: { kind: 'plant', target: 'p3', evidence: 'medical' }, p2: { kind: 'investigate', target: 'p3', direction: 'dossier' } });
    expect(viewFor(g, 'p2').threatView?.me?.results).toHaveLength(1);
    for (const id of ['p1', 'p3', 'p4']) {
      expect(viewFor(g, id).threatView?.me?.results).toEqual([]);
      expect(JSON.stringify(viewFor(g, id))).not.toContain('finding-');
      expect(JSON.stringify(viewFor(g, id))).not.toContain('Фальшивые медицинские записи');
    }
  });
  it('criminal response is indistinguishable when the framed target is officer versus civilian', () => {
    const a = game(), b = game();
    [b.hiddenThreat!.players.p2.role, b.hiddenThreat!.players.p3.role] = [b.hiddenThreat!.players.p3.role, b.hiddenThreat!.players.p2.role];
    const ops = { p1: { kind: 'plant' as const, target: 'p2', evidence: 'knife' as const } };
    const ga = review(collect(a, ops)), gb = review(collect(b, ops));
    expect(viewFor(ga, 'p1')).toEqual(viewFor(gb, 'p1'));
    expect(ga.hiddenThreat!.players.p2.points).toBe(1);
    expect(gb.hiddenThreat!.players.p2.points).toBe(0);
    expect(viewFor(ga, 'p2').threatView?.me?.notices).not.toEqual(viewFor(gb, 'p2').threatView?.me?.notices);
  });
  it('published IDs cannot identify the anonymous officer', () => {
    let g = collect(game(), { p1: { kind: 'plant', target: 'p3', evidence: 'knife' }, p2: { kind: 'investigate', target: 'p3', direction: 'dossier' } });
    g = review(g, { p2: [g.hiddenThreat!.players.p2.results[0].id] });
    const pub = viewFor(g, 'p1').threatView!.publications[0];
    expect(pub.id).toBe('public-1');
    expect(JSON.stringify(pub)).not.toContain('p2');
    expect('actor' in pub).toBe(false);
    expect('evidenceId' in pub).toBe(false);
    expect('forged' in pub).toBe(false);
  });
  it('elimination never discloses roles, final does, and projected snapshots cannot be resumed', () => {
    const g = game();
    g.players[0].isEliminated = true;
    const result = viewFor({ ...g, phase: 'result' }, 'p4');
    expect(result.threatView?.final).toBeUndefined();
    expect(validateSavedGame(result)).toBeNull();
    const final = viewFor({ ...g, phase: 'final' }, 'p4');
    expect(Object.keys(final.threatView!.final!.roles)).toHaveLength(4);
    expect(final.threatView!.final!.roles.p1).toBe('maniac');
    expect(sanitizeView(final)?.threatView?.final).toEqual(final.threatView?.final);
    expect(sanitizeView({ ...final, phase: 'vote' })?.threatView?.final).toBeUndefined();
  });
  it('sanitizer discards injected authority, arbitrary private fields and pre-final materials', () => {
    const v = viewFor(game(), 'p3');
    const malicious = { ...v, hiddenThreat: game().hiddenThreat, threatView: { ...v.threatView, evidence: [{ actor: 'p1' }], pending: [{ actor: 'p1' }], final: { roles: { p1: 'mafia' } }, me: { ...v.threatView!.me, others: game().hiddenThreat!.players, sabotageUses: 2 } } };
    const clean = sanitizeView(malicious)!;
    expect(clean.hiddenThreat).toBeUndefined();
    expect(clean.threatView?.final).toBeUndefined();
    expect(clean.threatView?.me?.sabotageUses).toBeUndefined();
    expect(JSON.stringify(clean)).not.toContain('"others"');
    expect(JSON.stringify(clean)).not.toContain('"evidence"');
  });
  it('the host public allowlist excludes unknown root and player secret fields', () => {
    const g = { ...game(), futureSecret: { roles: ['maniac', 'officer'] } };
    g.players = g.players.map(p => ({ ...p, confidentialRole: g.hiddenThreat!.players[p.id].role }));
    const wire = JSON.stringify(viewFor(g, 'p3'));
    expect(wire).not.toContain('futureSecret');
    expect(wire).not.toContain('confidentialRole');
  });
  it('a missing or invalid private DTO cannot silently downgrade a Hidden Threat snapshot', () => {
    const v = viewFor(game(), 'p3');
    expect(sanitizeView({ ...v, threatView: undefined })).toBeNull();
    expect(sanitizeView({ ...v, threatView: { ...v.threatView, me: { ...v.threatView?.me, role: 'unknown-role' } } })).toBeNull();
  });
  it('SSR public components and a closed curtain never render secret information', () => {
    const g = collect(game(), { p1: { kind: 'plant', target: 'p2', evidence: 'knife' } });
    expect(renderToStaticMarkup(<ThreatPublic game={g} />)).not.toContain('Нож');
    expect(renderToStaticMarkup(<ThreatFinal game={g} />)).toBe('');
    expect(renderToStaticMarkup(<Gate name="Candidate"><span>classified-role-value</span></Gate>)).not.toContain('classified-role-value');
  });
});
describe('host authorization, network replay and reconnect', () => {
  it('rejects a start below four and validates the actual lobby and slots', () => {
    const { host } = room();
    host.game = null;
    host.kick(3);
    expect(host.start()).toBe(false);
    const h = room(8).host;
    h.game = null; h.setup.slots = 7;
    expect(h.start()).toBe(false);
  });
  it('binds commands to the connection instead of client actor fields', () => {
    const { host, peers } = room();
    host.game = { ...host.game!, phase: 'secret' };
    peers[1].raw({ t: 'secret', command: { id: 'impersonate', round: 1, operation: { kind: 'investigate', target: 'p1', direction: 'dossier' } } });
    expect(host.game.hiddenThreat!.pending).toEqual([]);
    peers[1].raw({ t: 'secret', actor: 'p2', command: { id: 'impersonate', round: 1, operation: { kind: 'skip' } } });
    expect(host.game.hiddenThreat!.pending).toEqual([]);
    peers[1].raw({ t: 'secret', command: { id: 'forgery', round: 1, operation: { kind: 'skip' }, points: 100, role: 'officer' } });
    expect(host.game.hiddenThreat!.pending).toEqual([]);
    peers[1].client.send({ t: 'secret', command: { id: 'valid', round: 1, operation: { kind: 'skip' } } });
    expect(host.game.hiddenThreat!.pending[0].actor).toBe('p3');
    peers[1].client.send({ t: 'secret', command: { id: 'valid', round: 1, operation: { kind: 'skip' } } });
    expect(host.game.hiddenThreat!.pending).toHaveLength(1);
  });
  it('processes complete room operations and sends no secret authority through any transport message', () => {
    const { host, peers } = room();
    host.game = { ...host.game!, phase: 'secret' };
    host.actAsHost({ t: 'secret', command: { id: 'plant', round: 1, operation: { kind: 'plant', target: 'p2', evidence: 'identity' } } });
    peers[0].client.send({ t: 'secret', command: { id: 'check', round: 1, operation: { kind: 'investigate', target: 'p3', direction: 'dossier' } } });
    for (const peer of peers.slice(1)) peer.client.send({ t: 'secret', command: { id: 'skip', round: 1, operation: { kind: 'skip' } } });
    expect(host.game.phase).toBe('secret-review');
    expect(host.game.hiddenThreat!.players.p2.points).toBe(1);
    host.actAsHost({ t: 'secret', command: { id: 'read', round: 1, operation: { kind: 'skip' } } });
    for (const peer of peers) peer.client.send({ t: 'secret', command: { id: 'read', round: 1, operation: { kind: 'skip' } } });
    expect(host.game.phase).toBe('vote');
    for (const peer of peers) for (const msg of peer.wire) if (msg.t === 'view') {
      expect(msg.view.hiddenThreat).toBeUndefined();
      expect(msg.view.threatView?.final).toBeUndefined();
      expect(msg.view.threatView?.me?.playerId).toBe(msg.me);
      expect(JSON.stringify(msg)).not.toContain('"audit"');
      expect(JSON.stringify(msg)).not.toContain('"evidence"');
    }
    host.destroy();
  });
  it('restores the same private role and unspent state after reconnect', () => {
    const { host, peers } = room();
    host.game = { ...host.game!, phase: 'secret' };
    peers[0].client.send({ t: 'secret', command: { id: 'check', round: 1, operation: { kind: 'investigate', target: 'p3', direction: 'dossier' } } });
    peers[0].client.destroy();
    const p = pair(); host.addConn(p.h);
    const client = new OnlineClient(p.c, 'renamed', 'token2');
    expect(client.state.status).toBe('game');
    if (client.state.status !== 'game') throw new Error('missing game');
    expect(client.state.me).toBe('p2');
    expect(client.state.view.threatView?.me?.role).toBe('officer');
    expect(client.state.view.threatView?.me?.submitted).toBe(true);
    client.send({ t: 'secret', command: { id: 'check', round: 1, operation: { kind: 'investigate', target: 'p3', direction: 'dossier' } } });
    expect(host.game.hiddenThreat!.pending).toHaveLength(1);
    host.destroy();
  });
  it('a restored host preserves role assignment, queued commands, economy ledgers and reconnect tokens', () => {
    const { host, peers } = room();
    host.game = { ...host.game!, phase: 'secret' };
    host.actAsHost({ t: 'secret', command: { id: 'plant', round: 1, operation: { kind: 'plant', target: 'p2', evidence: 'knife' } } });
    const restored = OnlineHost.restore(JSON.parse(JSON.stringify(host.checkpoint())), host.setup)!;
    expect(restored.game).toEqual(host.game);
    expect(restored.members[1].connected).toBe(false);
    expect(restored.members[1].token).toBe('token2');
    const p = pair(); restored.addConn(p.h); const client = new OnlineClient(p.c, 'again', 'token2');
    expect(client.state.status === 'game' && client.state.view.threatView?.me?.role).toBe('officer');
    expect(restored.actAsHost({ t: 'secret', command: { id: 'plant', round: 1, operation: { kind: 'plant', target: 'p2', evidence: 'knife' } } })).toBeNull();
    expect(restored.game!.hiddenThreat!.pending).toHaveLength(1);
    peers.forEach(p => p.client.destroy()); restored.destroy(); host.destroy();
  });
});
describe('save validation', () => {
  it('rejects missing, invalid or inconsistent secret authority instead of downgrading it', () => {
    const g = game();
    expect(validateSavedGame({ ...g, hiddenThreat: undefined })).toBeNull();
    expect(validateSavedGame({ ...g, hiddenThreat: { ...g.hiddenThreat, version: 2 } })).toBeNull();
    expect(validateSavedGame({ ...g, hiddenThreat: { ...g.hiddenThreat, evidence: [{}] } })).toBeNull();
    const duplicate = JSON.parse(JSON.stringify(g)); duplicate.hiddenThreat.players.p3.role = 'officer';
    expect(validateSavedGame(duplicate)).toBeNull();
    const malformed = JSON.parse(JSON.stringify(g)); malformed.hiddenThreat.players.p2.results = [{ text: 'bad' }];
    expect(validateSavedGame(malformed)).toBeNull();
  });
  it('rejects saved commands that do not match their owners role', () => {
    const g = game();
    g.phase = 'secret';
    g.hiddenThreat!.pending = [{ actor: 'p3', command: { id: 'tampered', round: 1, operation: { kind: 'investigate', target: 'p1', direction: 'dossier' } } }];
    g.hiddenThreat!.processed = ['p3:tampered'];
    expect(validateSavedGame(g)).toBeNull();
  });
  it('stores only authoritative games and reloads private data without publicly rendering it', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    try {
      const g = collect(game(), { p1: { kind: 'plant', target: 'p2', evidence: 'knife' } });
      saveGame(g);
      expect(loadGame()).toEqual(g);
      saveGame(viewFor(g, 'p1'));
      expect(loadGame()).toEqual(g);
      const { host } = room();
      saveHostedRoom('ABCDE', host);
      expect(loadHostedRoom()?.checkpoint.game).toEqual(host.game);
      clearHostedRoom(); expect(loadHostedRoom()).toBeNull();
      host.destroy();
    } finally { vi.unstubAllGlobals(); }
  });
});
