import { describe, expect, it, vi } from 'vitest';
import { CLASSIC_PACK } from '../../data/classicPack';
import type { Card, CardPack, GameState } from '../../types';
import { alive, castVote, continueEvent, createGame, currentSpeaker, endSpeech, nextRound, playAction, playPerk, resolveVote, revealCard, revealOptions, volunteer } from '../game';
import { needsTarget } from '../actions';
import { composeItems, itemsOf, MAX_ITEMS } from '../inventory';
import { OnlineClient, OnlineHost, sanitizeView, viewFor, type C2H, type Conn, type H2C } from '../online';
import { validateSavedGame } from '../storage';
import { auxiliaryAction, rewardTransition } from './economy';
import { allSecretReady, finishSecret, parseSecretCommand, submitSecret } from './engine';
import { investigate } from './investigations';
import { collect, config, game, review } from './testHelpers';
import { openLobbySession } from './hostStorage';
import { dealRoles, isCriminal } from './roles';
import type { SecretOperation } from './types';

const item = (id: string, modifier: Card['modifier'] = 'positive'): Card => ({ id, category: 'luggage', description: id, modifier, tags: ['медицина'] });
const points = (g: GameState, id: string, n: number): GameState => ({ ...g, hiddenThreat: { ...g.hiddenThreat!, players: { ...g.hiddenThreat!.players, [id]: { ...g.hiddenThreat!.players[id], points: n } } } });

describe('audit: inventory, deductions and awards', () => {
  it.each(['positive', 'negative'] as const)('keeps a full custom bag (%s) inside the inventory/save contract', modifier => {
    const pack: CardPack = { ...CLASSIC_PACK, id: 'custom-full', isCustom: true, cards: { ...CLASSIC_PACK.cards, luggage: [composeItems(Array.from({ length: MAX_ITEMS }, (_, i) => item(`custom-${i}`, modifier)), () => item('empty'))] } };
    const g = createGame({ ...config(), packIds: [pack.id] }, pack.scenarios[0], [pack]);
    expect(g.players.every(p => itemsOf(p.slots.luggage.card).length <= MAX_ITEMS)).toBe(true);
    expect(validateSavedGame(JSON.parse(JSON.stringify(g)))).not.toBeNull();
    const final = { ...g, phase: 'final' as const, players: g.players.map((p, i) => ({ ...p, isEliminated: i > 0 })) };
    const v = sanitizeView(viewFor(final, 'p1'))!;
    expect(v.players[0].slots.luggage.card.tags).toEqual(final.players[0].slots.luggage.card.tags);
    expect(itemsOf(v.players[0].slots.luggage.card)).toEqual(itemsOf(final.players[0].slots.luggage.card));
  });
  it('returns conflict losses to the ordinary discard', () => {
    const g = game();
    g.players[2].slots.character.card = { ...g.players[2].slots.character.card, modifier: 'negative' };
    g.players[2].slots.luggage.card = item('conflict-item');
    const next = auxiliaryAction(g, 'p1', 'p3', 'obstruct');
    expect(itemsOf(next.players[2].slots.luggage.card)).toHaveLength(0);
    expect(next.discard?.luggage?.some(c => c.id === 'conflict-item')).toBe(true);
  });
  it('does not report a persistent clue as absent on a paid repeat dossier check', () => {
    let g = review(collect(game(), { p1: { kind: 'plant', target: 'p3', evidence: 'knife' }, p2: { kind: 'investigate', target: 'p3', direction: 'dossier' } }));
    g = collect(points({ ...g, round: 2 }, 'p2', 3), { p2: { kind: 'investigate', target: 'p3', direction: 'dossier' } });
    const [first, second] = g.hiddenThreat!.players.p2.results;
    expect(second.evidenceId).toBe(first.evidenceId);
    expect(second.text).toContain('Нож');
    expect(g.hiddenThreat!.players.p2.points).toBe(0);
  });
  it('records an inferior substitution even when the aggregate bag remains positive', () => {
    const g = game();
    g.players[0].slots.action.card.effect = 'giveLuggage';
    g.players[2].slots.luggage.card = composeItems(Array.from({ length: 4 }, (_, i) => item(`useful-${i}`)), () => item('empty'));
    g.deck!.luggage = [item('inferior', 'negative')];
    const next = playAction(g, 'p1', { target: 'p3' });
    expect(next.players[2].slots.luggage.card.modifier).toBe('positive');
    expect(next.hiddenThreat!.players.p1.points).toBe(2);
    expect(investigate(next, 'p2', 'p1', 'actions').text).toContain('Зафиксировано вредоносное');
  });
  it('does not reward a criminal for trading a better bag to another candidate', () => {
    const g = game();
    g.players[0].slots.action.card.effect = 'swapLuggage';
    g.players[0].slots.luggage.card = item('better', 'positive');
    g.players[2].slots.luggage.card = item('worse', 'neutral');
    const next = playAction(g, 'p1', { target: 'p3' });
    expect(next.players[2].slots.luggage.card.modifier).toBe('positive');
    expect(next.hiddenThreat!.players.p1.points).toBe(0);
  });
  it('cannot identify an officer versus civilian donor through subsequent theft points', () => {
    const worlds = [game(), game()];
    [worlds[1].hiddenThreat!.players.p2.role, worlds[1].hiddenThreat!.players.p4.role] = ['civilian', 'officer'];
    const resolved = worlds.map(g => {
      g.players[0].slots.action.card.effect = 'stealLuggage';
      g.players[1].slots.luggage.card = item('donated-item');
      g.players[2].slots.luggage.card = { id: 'lost-empty', category: 'luggage', description: 'Empty', modifier: 'negative' };
      return playAction(auxiliaryAction(g, 'p2', 'p3', 'transfer', 'donated-item'), 'p1', { target: 'p3' });
    });
    expect(resolved[0].players).toEqual(resolved[1].players);
    expect(resolved[0].log).toEqual(resolved[1].log);
    expect(viewFor(resolved[0], 'p1')).toEqual(viewFor(resolved[1], 'p1'));
  });
  it('cannot identify an officer versus civilian helper through later trait damage points', () => {
    const worlds = [game(), game()];
    [worlds[1].hiddenThreat!.players.p2.role, worlds[1].hiddenThreat!.players.p4.role] = ['civilian', 'officer'];
    const resolved = worlds.map(g => {
      g.players[2].slots.character.card = { ...g.players[2].slots.character.card, modifier: 'neutral' };
      const helped = auxiliaryAction(g, 'p2', 'p3', 'assist');
      const harmed = { ...helped, players: helped.players.map(p => p.id === 'p3' ? { ...p, slots: { ...p.slots, character: { ...p.slots.character, card: { ...p.slots.character.card, modifier: 'negative' as const } } } } : p) };
      return rewardTransition(helped, harmed, 'p1', 'action:p1');
    });
    expect(viewFor(resolved[0], 'p1')).toEqual(viewFor(resolved[1], 'p1'));
  });
  it('awards one standard harmful-card point for destroying a bag, not one for each item', () => {
    const g = game();
    g.players[0].slots.action.card.effect = 'sabotage';
    g.players[2].slots.luggage.card = composeItems(Array.from({ length: 4 }, (_, i) => item(`destroyed-${i}`)), () => item('empty'));
    const next = playAction(g, 'p1', { target: 'p3' });
    expect(next.hiddenThreat!.players.p1.points).toBe(1);
    expect(next.hiddenThreat!.rewarded.filter(k => k.startsWith('item:destroyed-'))).toHaveLength(4);
  });
  it('consumes neutral transitions without pretending that a civilian earned points', () => {
    const g = game();
    g.players[1].slots.character.card = { ...g.players[1].slots.character.card, modifier: 'neutral' };
    const next = auxiliaryAction(g, 'p3', 'p2', 'assist');
    expect(next.hiddenThreat!.rewarded).toContain('trait:p2:character');
    expect(next.hiddenThreat!.players.p3.points).toBe(0);
    expect(next.hiddenThreat!.audit.some(a => a.kind === 'points')).toBe(false);
  });
  it('runs expertise once per object even if it was discovered by two checks', () => {
    let g = review(collect(game(), { p1: { kind: 'plant', target: 'p3', evidence: 'knife' }, p2: { kind: 'investigate', target: 'p3', direction: 'dossier' } }));
    g = review(collect(points({ ...g, round: 2 }, 'p2', 3), { p2: { kind: 'investigate', target: 'p3', direction: 'dossier' } }));
    const first = g.hiddenThreat!.players.p2.results[0];
    g = collect(points({ ...g, round: 3 }, 'p2', 2), { p2: { kind: 'analyze', findingId: first.id } });
    expect(g.hiddenThreat!.players.p2.results.every(r => r.analyzed && r.analysis === g.hiddenThreat!.players.p2.results[0].analysis)).toBe(true);
    expect(g.hiddenThreat!.players.p2.points).toBe(0);
    expect(g.hiddenThreat!.audit.filter(a => a.kind === 'analysis')).toHaveLength(1);
  });
});

describe('audit: full-party state invariants', () => {
  const cases = Array.from({ length: 9 }, (_, i) => i + 4).flatMap(n => [0, 13, 741].map(seed => [n, seed] as const));
  it.each(cases)('preserves resumability and secrecy through a complete %i-player game, seed %i', (n, seed) => {
    let g = createGame({ ...config(n), seed, shelterSlots: Math.floor(n / 2), revealsPerVote: 2, roundEvents: true, professionPerks: true }, CLASSIC_PACK.scenarios[seed % 4], [CLASSIC_PACK]);
    g.hiddenThreat = dealRoles(g.players, g.config.hiddenThreat!, seed ^ 0x7654);
    const assertState = () => {
      expect(validateSavedGame(JSON.parse(JSON.stringify(g))) !== null, `invalid ${g.phase}, round ${g.round}`).toBe(true);
      for (const p of g.players) {
        const v = viewFor(g, p.id);
        expect(v.hiddenThreat).toBeUndefined();
        if (g.phase !== 'final') expect(v.threatView?.final).toBeUndefined();
      }
    };
    assertState();
    for (let step = 0; step < 200 && g.phase !== 'final'; step++) {
      if (g.phase === 'event') {
        if (g.event?.kind === 'volunteer') g = volunteer(g, alive(g)[0].id);
        g = continueEvent(g);
      } else if (g.phase === 'reveal') {
        const sp = currentSpeaker(g)!;
        const target = alive(g).find(p => p.id !== sp.id)!;
        g = auxiliaryAction(g, sp.id, target.id, isCriminal(g.hiddenThreat!.players[sp.id].role) ? 'obstruct' : 'assist');
        const effect = sp.slots.action.card.effect;
        if (effect) g = playAction(g, sp.id, { ...(needsTarget(effect) ? { target: target.id } : {}), category: revealOptions(g, target)[0] });
        const perk = g.perks?.find(p => p.playerId === sp.id);
        if (perk) g = playPerk(g, sp.id, { target: target.id, category: revealOptions(g, target)[0] });
        if (g.phase === 'reveal') {
          const speaker = currentSpeaker(g)!;
          g = revealCard(g, speaker.id, revealOptions(g, speaker)[0]);
        }
      } else if (g.phase === 'speech') g = endSpeech(g);
      else if (g.phase === 'secret' || g.phase === 'secret-review') {
        const phase = g.phase;
        for (const p of alive(g)) {
          const own = g.hiddenThreat!.players[p.id];
          const target = alive(g).find(x => x.id !== p.id)!;
          let operation: SecretOperation = { kind: 'skip' };
          if (phase === 'secret' && own.role === 'officer' && own.checks < 2 && (own.checks === 0 || own.points >= 3)) operation = { kind: 'investigate', target: target.id, direction: 'dossier' };
          if (phase === 'secret' && isCriminal(own.role) && g.hiddenThreat!.sabotageUses < 2 && (g.hiddenThreat!.sabotageUses === 0 || own.points >= 3)) operation = { kind: 'plant', target: target.id, evidence: 'identity' };
          const pub = phase === 'secret-review' && own.role === 'officer' ? own.results.filter(r => !g.hiddenThreat!.publications.some(p => p.id === r.id && p.analysis === r.analysis)).map(r => r.id) : [];
          g = submitSecret(g, p.id, { id: `run-${phase}-${g.round}-${p.id}`, round: g.round, operation, ...(pub.length ? { publish: pub } : {}) });
        }
        expect(allSecretReady(g)).toBe(true);
        g = finishSecret(g);
      } else if (g.phase === 'vote') {
        for (const p of alive(g)) g = castVote(g, p.id, alive(g).find(t => t.id !== p.id)!.id);
        g = resolveVote(g);
      } else if (g.phase === 'result') g = nextRound(g);
      assertState();
    }
    expect(g.phase).toBe('final');
    expect(alive(g).length).toBeLessThanOrEqual(g.config.shelterSlots);
  });
});

describe('audit: wire validation and restoration', () => {
  it('migrates progressed legacy ledgers without exposing the former donor through theft rewards', () => {
    const worlds = [game(), game()];
    [worlds[1].hiddenThreat!.players.p2.role, worlds[1].hiddenThreat!.players.p4.role] = ['civilian', 'officer'];
    const restored = worlds.map((g, index) => {
      g.players[0].slots.action.card.effect = 'stealLuggage';
      g.players[1].slots.luggage.card = item('legacy-gift');
      g.players[2].slots.luggage.card = { id: 'lost-empty', category: 'luggage', description: 'Empty', modifier: 'negative' };
      const gifted = auxiliaryAction(g, 'p2', 'p3', 'transfer', 'legacy-gift');
      delete gifted.hiddenThreat!.resourceLedgerVersion;
      if (index === 1) gifted.hiddenThreat!.rewarded = [];
      const resumed = validateSavedGame(JSON.parse(JSON.stringify(gifted)))!;
      expect(resumed.hiddenThreat!.resourceLedgerVersion).toBe(2);
      expect(resumed.hiddenThreat!.legacyResourceCutoff).toBe(1);
      expect(resumed.hiddenThreat!.players.p2.points).toBe(gifted.hiddenThreat!.players.p2.points);
      expect(validateSavedGame(JSON.parse(JSON.stringify(resumed)))).toEqual(resumed);
      return playAction(resumed, 'p1', { target: 'p3' });
    });
    expect(viewFor(restored[0], 'p1')).toEqual(viewFor(restored[1], 'p1'));
    expect(restored[0].hiddenThreat!.players.p1.points).toBe(0);
  });
  it('migrates pristine legacy games without suppressing their first legitimate reward', () => {
    const g = game();
    delete g.hiddenThreat!.resourceLedgerVersion;
    g.players[2].slots.character.card = { ...g.players[2].slots.character.card, modifier: 'neutral' };
    const resumed = validateSavedGame(JSON.parse(JSON.stringify(g)))!;
    expect(resumed.hiddenThreat!.legacyResourceCutoff).toBeUndefined();
    expect(auxiliaryAction(resumed, 'p2', 'p3', 'assist').hiddenThreat!.players.p2.points).toBe(2);
  });
  it('allows genuinely minted future aid rewards after migration, but not forged aid IDs', () => {
    const g = game();
    g.players[1].slots.character.card = { ...g.players[1].slots.character.card, modifier: 'positive' };
    g.players[1].slots.luggage.card = item('old-gift');
    g.players[2].slots.luggage.card = { id: 'lost-empty', category: 'luggage', description: 'Empty', modifier: 'negative' };
    const legacy = auxiliaryAction(g, 'p2', 'p3', 'transfer', 'old-gift');
    delete legacy.hiddenThreat!.resourceLedgerVersion;
    const resumed = validateSavedGame(JSON.parse(JSON.stringify(legacy)))!;
    const roundTwo = nextRound({ ...review(collect(resumed)), phase: 'result' });
    const created = auxiliaryAction(roundTwo, 'p3', 'p2', 'assist');
    expect(created.hiddenThreat!.rewarded).toContain('cooperate:p3:2');
    const donated = auxiliaryAction(created, 'p2', 'p4', 'transfer', 'aid-p3-2');
    expect(donated.hiddenThreat!.players.p2.points).toBe(resumed.hiddenThreat!.players.p2.points + 1);
    const forged = { ...roundTwo, players: roundTwo.players.map(p => p.id === 'p2' ? { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: item('aid-p3-100') } } } : p) };
    expect(auxiliaryAction(forged, 'p2', 'p4', 'transfer', 'aid-p3-100').hiddenThreat!.players.p2.points).toBe(resumed.hiddenThreat!.players.p2.points);
  });
  it.each([null, '{broken-json'])('cannot start a fresh lobby when restoring an unavailable checkpoint (%s)', raw => {
    vi.stubGlobal('localStorage', { getItem: () => raw });
    try {
      const setup = { scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'secret' as const };
      expect(() => openLobbySession(setup, 'Host', true)).toThrow('Восстановление отменено');
      expect(openLobbySession(setup, 'Host', false).host.game).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
  it.each([['dossier'], ['connections'], ['actions']])('rejects non-string investigation direction %j', direction => {
    expect(parseSecretCommand({ id: 'bad-direction', round: 1, operation: { kind: 'investigate', target: 'p3', direction: [direction] } })).toBeNull();
  });
  it('notifies a remote player when a bounded auxiliary action is rejected', () => {
    let toHost = (_m: unknown) => {}, toClient = (_m: unknown) => {};
    const h: Conn<H2C> = { send: m => toClient(m), onMessage: cb => { toHost = cb; }, onClose: () => {}, close: () => {} };
    const c: Conn<C2H> = { send: m => toHost(m), onMessage: cb => { toClient = cb; }, onClose: () => {}, close: () => {} };
    const host = new OnlineHost({ scenario: CLASSIC_PACK.scenarios[0], packs: [CLASSIC_PACK], slots: 1, voting: 'secret' });
    host.addConn(h);
    const client = new OnlineClient(c, 'Candidate 2', 'token2');
    host.start();
    host.game = game();
    client.send({ t: 'auxiliary', round: 0, kind: 'assist', target: 'p3' });
    expect(client.state.status).toBe('game');
    expect(client.state.status === 'game' && client.state.notice?.text).toBe('Действие не сработало');
    host.destroy();
  });
  it('rejects a damaged save marked final while all candidates are still competing', () => {
    expect(validateSavedGame({ ...game(), phase: 'final' })).toBeNull();
  });
  it('rejects result-review saves whose operations were never resolved', () => {
    expect(validateSavedGame({ ...game(), phase: 'secret-review' })).toBeNull();
  });
  it('rejects array roles instead of restoring a client that cannot receive its own DTO', () => {
    const raw = JSON.parse(JSON.stringify(game()));
    raw.hiddenThreat.players.p3.role = ['civilian'];
    expect(validateSavedGame(raw)).toBeNull();
  });
  it('never serializes extra nested secret or provenance fields before the finale', () => {
    let g = collect(game(), { p1: { kind: 'plant', target: 'p3', evidence: 'knife' }, p2: { kind: 'investigate', target: 'p3', direction: 'dossier' } });
    Object.assign(g.hiddenThreat!.players.p2.results[0], { actor: 'p1', forged: true });
    const id = g.hiddenThreat!.players.p2.results[0].id;
    g = review(g, { p2: [id] });
    Object.assign(g.hiddenThreat!.players.p3, { otherRoles: g.hiddenThreat!.players });
    Object.assign(g.hiddenThreat!.publications[0], { publisher: 'p2' });
    Object.assign(g.hiddenThreat!.reports[0], { actor: 'p2', checks: 1, sabotages: 1 });
    const observer = viewFor(g, 'p3').threatView!;
    expect('otherRoles' in observer.me!).toBe(false);
    expect('publisher' in observer.publications[0]).toBe(false);
    expect('actor' in observer.reports[0]).toBe(false);
    expect(observer.reports[0].checks).toBeUndefined();
    const officer = viewFor(g, 'p2').threatView!;
    expect('actor' in officer.me!.results[0]).toBe(false);
    expect('forged' in officer.me!.results[0]).toBe(false);
  });
  it('rejects a damaged action effect that would crash auto execution after reload', () => {
    const g = game();
    Object.assign(g.players[0].slots.action.card, { effect: 'unknown-effect' });
    expect(validateSavedGame(g) === null).toBe(true);
  });
  it('still resumes a legitimate early finale caused by the standard volunteer event', () => {
    const g = game();
    g.config.shelterSlots = 3;
    g.schedule = [1];
    g.phase = 'event';
    g.event = { id: 'volunteer', kind: 'volunteer', title: 'Volunteer', text: '', tone: 'neutral', outcome: [] };
    const final = volunteer(g, 'p1');
    expect(final.phase).toBe('final');
    expect(validateSavedGame(JSON.parse(JSON.stringify(final)))).not.toBeNull();
  });
  it('keeps the current report and round number after more than 50 abstention rounds', () => {
    const g = game();
    g.round = 51; g.phase = 'vote'; g.schedule = Array(51).fill(1);
    g.log = [{ round: 51, text: 'latest' }];
    g.hiddenThreat!.reports = Array.from({ length: 51 }, (_, i) => ({ round: i + 1, active: true }));
    const v = sanitizeView(viewFor(g, 'p3'))!;
    expect(v.threatView!.reports.some(r => r.round === 51)).toBe(true);
    expect(v.log[0].round).toBe(51);
  });
});
