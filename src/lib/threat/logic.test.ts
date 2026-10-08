import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../../data/classicPack';
import { CATEGORIES, type Card, type GameState } from '../../types';
import { createGame, nextRound, playAction, playPerk, resolveVote, revealCard, startVote, tickGame } from '../game';
import { itemsOf } from '../inventory';
import { evaluate } from '../evaluate';
import { validateSavedGame } from '../storage';
import { applyUndo, canUndo } from '../undo';
import { buildChronicle } from '../chronicle';
import { auxiliaryAction, rewardTransition } from './economy';
import { finishSecret, parseSecretCommand, submitSecret } from './engine';
import { investigate } from './investigations';
import { dealRoles, socialOutcome, validateThreatConfig } from './roles';
import { declassifiedLines } from './chronicle';
import { collect, config, game, review } from './testHelpers';

const card = (modifier: Card['modifier'], id = 'item'): Card => ({ id, category: 'luggage', description: id, modifier, tags: modifier === 'positive' ? ['медицина'] : [] });
const withPoints = (g: GameState, id: string, points: number): GameState => ({ ...g, hiddenThreat: { ...g.hiddenThreat!, players: { ...g.hiddenThreat!.players, [id]: { ...g.hiddenThreat!.players[id], points } } } });
describe('Hidden Threat distribution and classic isolation', () => {
  it.each([2, 3, 13, 20])('rejects unsupported lobby size %i', n => {
    expect(() => createGame(config(n), CLASSIC_PACK.scenarios[0], [CLASSIC_PACK])).toThrow();
  });
  it.each([4, 5, 6, 7, 8, 9, 10, 11, 12])('deals the correct roles for %i players', n => {
    const g = game(n), roles = Object.values(g.hiddenThreat!.players).map(p => p.role);
    expect(roles.filter(r => r === 'officer')).toHaveLength(1);
    expect(roles.filter(r => ['maniac', 'mafia'].includes(r))).toHaveLength(n <= 7 ? 1 : n <= 9 ? 2 : 3);
    expect(validateSavedGame(JSON.parse(JSON.stringify(g)))).not.toBeNull();
  });
  it('supports either criminal for 6–7 and forbids mathematically guaranteed infiltration', () => {
    for (const n of [6, 7]) expect(Object.values(dealRoles(game(n).players, { criminal: 'mafia', report: 'hidden' }, 8).players).filter(p => p.role === 'mafia')).toHaveLength(1);
    expect(validateThreatConfig(8, 7, { criminal: 'mafia', report: 'hidden' })).toBeTruthy();
    expect(validateThreatConfig(8, 6, { criminal: 'mafia', report: 'hidden' })).toBeNull();
    expect(() => createGame({ ...config(), names: ['only one'] }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK])).toThrow();
  });
  it('roles use independent randomness and never change professions or ordinary traits', () => {
    const g = game(), a = dealRoles(g.players, g.config.hiddenThreat!, 1), b = dealRoles(g.players, g.config.hiddenThreat!, 2);
    expect(a.players).not.toEqual(b.players);
    const c = createGame({ ...config(), variant: 'classic', hiddenThreat: undefined }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
    for (let i = 0; i < 4; i++) for (const cat of CATEGORIES.filter(c => c !== 'luggage')) expect(g.players[i].slots[cat]).toEqual(c.players[i].slots[cat]);
    expect(c.hiddenThreat).toBeUndefined();
    expect(startVote(c).phase).toBe('vote');
  });
  it('keeps tabletop secrets sealed at creation', () => {
    const g = createGame({ ...config(), mode: 'tabletop' }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
    expect(g.phase).toBe('reveal');
    expect(declassifiedLines(g)).toEqual([]);
  });
  it('separates social victories from survival', () => {
    let g = { ...game(), phase: 'final' as const };
    const ev = evaluate(g.scenario, g.players, 1);
    expect(socialOutcome(g)).toEqual({ civilians: false, mafia: false, maniac: ['p1'] });
    g = { ...g, players: g.players.map(p => ({ ...p, isEliminated: p.id === 'p1' })) };
    expect(socialOutcome(g)?.civilians).toBe(true);
    expect(evaluate(g.scenario, game().players, 1)).toEqual(ev);
    const m = { ...game(8), phase: 'final' as const };
    m.players = m.players.map(p => ({ ...p, isEliminated: p.id !== 'p2' }));
    expect(socialOutcome(m)?.mafia).toBe(true);
  });
});
describe('secret resolution, findings and publication', () => {
  it('sabotage precedes investigations regardless of request arrival order', () => {
    let g: GameState = { ...game(), phase: 'secret' };
    g = submitSecret(g, 'p2', { id: 'first', round: 1, operation: { kind: 'investigate', target: 'p3', direction: 'dossier' } });
    g = submitSecret(g, 'p1', { id: 'second', round: 1, operation: { kind: 'plant', target: 'p3', evidence: 'knife' } });
    for (const id of ['p3', 'p4']) g = submitSecret(g, id, { id, round: 1, operation: { kind: 'skip' } });
    const before = g.players;
    g = finishSecret(g);
    expect(g.phase).toBe('secret-review');
    expect(g.hiddenThreat!.players.p2.results[0].text).toContain('Нож');
    expect(g.players).toBe(before); // evidence cannot change inventory, remove or kill anyone
    expect(g.log).toEqual([]);
    expect(g.hiddenThreat!.reports).toEqual([]);
    expect(review(g).phase).toBe('vote');
  });
  it('applies one team sabotage and does not charge simultaneous losers', () => {
    const g = collect(game(8), { p2: { kind: 'forge', target: 'p4', evidence: 'medical' }, p1: { kind: 'plant', target: 'p3', evidence: 'knife' } });
    expect(g.hiddenThreat!.evidence).toHaveLength(1);
    expect(g.hiddenThreat!.evidence[0].actor).toBe('p1');
    expect(g.hiddenThreat!.sabotageUses).toBe(1);
    expect(g.hiddenThreat!.players.p2.points).toBe(0);
    expect(g.hiddenThreat!.players.p2.notices).toHaveLength(1);
  });
  it('frames an officer once without identifying the criminal to the officer', () => {
    let g = collect(game(), { p1: { kind: 'plant', target: 'p2', evidence: 'identity' } });
    expect(g.hiddenThreat!.players.p2.points).toBe(1);
    expect(g.hiddenThreat!.players.p2.notices.join('')).not.toContain('p1');
    expect(finishSecret(g)).toBe(g);
    g = review(g);
    expect(finishSecret(g)).toBe(g);
    expect(g.hiddenThreat!.players.p2.points).toBe(1);
    expect(g.hiddenThreat!.audit.filter(a => a.kind === 'points')).toHaveLength(1);
  });
  it('does not award civilian targets and keeps planted clues separate from real cards', () => {
    const g = game(), next = collect(g, { p1: { kind: 'plant', target: 'p3', evidence: 'supplies' } });
    expect(next.hiddenThreat!.players.p3.points).toBe(0);
    expect(next.players).toBe(g.players);
    expect(next.players.every(p => !p.isEliminated)).toBe(true);
  });
  it('prices second checks at 3 points and enforces both party and round limits', () => {
    let g = review(collect(game(), { p2: { kind: 'investigate', target: 'p1', direction: 'connections' } }));
    expect(g.hiddenThreat!.players.p2.checks).toBe(1);
    g = { ...g, round: 2, phase: 'secret' };
    const cmd = { id: 'paid', round: 2, operation: { kind: 'investigate', target: 'p1', direction: 'actions' } };
    expect(submitSecret(g, 'p2', cmd)).toBe(g);
    g = collect(withPoints(g, 'p2', 3), { p2: { kind: 'investigate', target: 'p1', direction: 'actions' } });
    expect(g.hiddenThreat!.players.p2.points).toBe(0);
    expect(g.hiddenThreat!.players.p2.checks).toBe(2);
    const later = { ...review(g), phase: 'secret' as const, round: 3 };
    expect(submitSecret(withPoints(later, 'p2', 9), 'p2', { ...cmd, round: 3 })).toEqual(withPoints(later, 'p2', 9));
  });
  it('prices the second team sabotage at 3 and allows no third', () => {
    let g = review(collect(game(), { p1: { kind: 'plant', target: 'p3', evidence: 'pass' } }));
    g = { ...g, round: 2, phase: 'secret' };
    expect(submitSecret(g, 'p1', { id: 'paid', round: 2, operation: { kind: 'plant', target: 'p3', evidence: 'pass' } })).toBe(g);
    g = collect(withPoints(g, 'p1', 3), { p1: { kind: 'forge', target: 'p3', evidence: 'medical' } });
    expect(g.hiddenThreat!.players.p1.points).toBe(0);
    expect(g.hiddenThreat!.sabotageUses).toBe(2);
    expect(g.hiddenThreat!.evidence).toHaveLength(2);
    const later = withPoints({ ...review(g), round: 3, phase: 'secret' }, 'p1', 9);
    expect(submitSecret(later, 'p1', { id: 'third', round: 3, operation: { kind: 'plant', target: 'p3', evidence: 'pass' } })).toBe(later);
  });
  it('gives different truthful information in each direction', () => {
    const g = collect(game(8), { p1: { kind: 'plant', target: 'p4', evidence: 'knife' } });
    expect(investigate(g, 'p3', 'p1', 'connections').text).toContain('Выявлены');
    expect(investigate(g, 'p3', 'p2', 'dossier').text).toContain('не обнаружено');
    expect(investigate(g, 'p3', 'p1', 'actions').text).toContain('не обнаружено');
    expect(investigate(game(), 'p2', 'p1', 'connections').text).toContain('не обнаружено'); // maniac is not mafia
  });
  it.each(['plant', 'forge'] as const)('permits a paid once-only analysis of %s with an existing object', kind => {
    let g = collect(game(), { p1: { kind, target: 'p3', evidence: 'identity' }, p2: { kind: 'investigate', target: 'p3', direction: 'dossier' } });
    const id = g.hiddenThreat!.players.p2.results[0].id;
    g = withPoints({ ...review(g), round: 2, phase: 'secret' }, 'p2', 2);
    const next = collect(g, { p2: { kind: 'analyze', findingId: id } });
    expect(next.hiddenThreat!.players.p2.points).toBe(0);
    expect(next.hiddenThreat!.players.p2.results[0].analyzed).toBe(true);
    expect(next.hiddenThreat!.players.p2.results[0].analysis).toContain(kind === 'forge' ? 'подделку' : 'подброшенного');
    const later = withPoints({ ...review(next), round: 3, phase: 'secret' }, 'p2', 2);
    expect(submitSecret(later, 'p2', { id: 'twice', round: 3, operation: { kind: 'analyze', findingId: id } })).toBe(later);
    expect(submitSecret(later, 'p2', { id: 'fake', round: 3, operation: { kind: 'analyze', findingId: 'missing' } })).toBe(later);
  });
  it('publishes discovered evidence anonymously only after every review acknowledgement', () => {
    let g = collect(game(), { p1: { kind: 'plant', target: 'p3', evidence: 'knife' }, p2: { kind: 'investigate', target: 'p3', direction: 'dossier' } });
    const id = g.hiddenThreat!.players.p2.results[0].id;
    const partial = submitSecret(g, 'p2', { id: 'pub', round: 1, operation: { kind: 'skip' }, publish: [id] });
    expect(partial.hiddenThreat!.publications).toHaveLength(0);
    g = review(g, { p2: [id] });
    expect(g.hiddenThreat!.publications).toHaveLength(1);
    expect(g.hiddenThreat!.reports[0]).toEqual({ round: 1, active: true });
    expect(g.log[0].text).not.toContain('p2');
    expect(declassifiedLines(g)).toEqual([]);
    expect(buildChronicle(g).entries.some(e => e.id.startsWith('declassified'))).toBe(false);
    expect(declassifiedLines({ ...g, phase: 'final' }).join('\n')).toContain('Нож');
  });
  it('supports detailed reports without targets or executors', () => {
    const g = game(); g.config.hiddenThreat!.report = 'detailed';
    const next = review(collect(g, { p1: { kind: 'plant', target: 'p2', evidence: 'knife' }, p2: { kind: 'investigate', target: 'p3', direction: 'actions' } }));
    expect(next.hiddenThreat!.reports[0]).toEqual({ round: 1, active: true, checks: 1, sabotages: 1 });
  });
  it('publishes a refined analysis of an already published finding once', () => {
    let g = collect(game(), { p1: { kind: 'forge', target: 'p3', evidence: 'medical' }, p2: { kind: 'investigate', target: 'p3', direction: 'dossier' } });
    const id = g.hiddenThreat!.players.p2.results[0].id;
    g = review(g, { p2: [id] });
    g = collect(withPoints({ ...g, round: 2 }, 'p2', 2), { p2: { kind: 'analyze', findingId: id } });
    g = review(g, { p2: [id] });
    expect(g.hiddenThreat!.publications).toHaveLength(1);
    expect(g.hiddenThreat!.publications[0].analysis).toContain('подделку');
    const later = { ...g, phase: 'secret-review' as const, round: 3 };
    expect(submitSecret(later, 'p2', { id: 'repeat', round: 3, operation: { kind: 'skip' }, publish: [id] })).toBe(later);
  });
  it('prohibits investigating or sabotaging yourself and eliminated candidates', () => {
    const g = { ...game(), phase: 'secret' as const };
    g.players[2].isEliminated = true;
    for (const target of ['p1', 'p3']) expect(submitSecret(g, 'p1', { id: `target-${target}`, round: 1, operation: { kind: 'plant', target, evidence: 'knife' } })).toBe(g);
    expect(submitSecret(g, 'p2', { id: 'self', round: 1, operation: { kind: 'investigate', target: 'p2', direction: 'dossier' } })).toBe(g);
  });
  it('rejects role forgery, actor impersonation, fake awards, kill commands and invalid phases', () => {
    for (const operation of [{ kind: 'kill', target: 'p2' }, { kind: 'award', points: 50 }, { kind: 'investigate', target: 'p2', direction: 'all' }, { kind: 'skip', actor: 'p2' }]) expect(parseSecretCommand({ id: 'x', round: 1, operation })).toBeNull();
    expect(parseSecretCommand({ id: 'x', round: 1, operation: { kind: 'skip' }, role: 'officer' })).toBeNull();
    const g = { ...game(), phase: 'secret' as const };
    expect(submitSecret(g, 'p3', { id: 'x', round: 1, operation: { kind: 'investigate', target: 'p1', direction: 'dossier' } })).toBe(g);
    expect(submitSecret(g, 'p1', { id: 'x', round: 0, operation: { kind: 'skip' } })).toBe(g);
    expect(resolveVote(g)).toBe(g);
    expect(playAction(g, 'p1')).toBe(g);
  });
  it('replayed commands survive reload and cannot double-spend', () => {
    const cmd = { id: 'persist', round: 1, operation: { kind: 'plant', target: 'p2', evidence: 'identity' } };
    const g = submitSecret({ ...game(), phase: 'secret' }, 'p1', cmd);
    const resumed = validateSavedGame(JSON.parse(JSON.stringify(g)))!;
    expect(resumed).not.toBeNull();
    expect(submitSecret(resumed, 'p1', cmd)).toBe(resumed);
    expect(submitSecret(resumed, 'p1', { ...cmd, id: 'different' })).toBe(resumed);
    const after = collect(resumed);
    expect(after.hiddenThreat!.evidence).toHaveLength(1);
    expect(validateSavedGame(JSON.parse(JSON.stringify(after)))).not.toBeNull();
  });
});
describe('central economy and no farming', () => {
  it('awards only real improvement once, irrespective of repeated processing or reversals', () => {
    let g = game();
    g.players[2].slots.character.card = { ...g.players[2].slots.character.card, modifier: 'neutral' };
    const next = auxiliaryAction(g, 'p2', 'p3', 'assist');
    expect(next.hiddenThreat!.players.p2.points).toBe(2);
    expect(auxiliaryAction(next, 'p2', 'p4', 'assist')).toBe(next);
    expect(rewardTransition(g, next, 'p2', 'replay').hiddenThreat!.players.p2.points).toBe(2);
    const later = { ...next, round: 2 };
    expect(auxiliaryAction(later, 'p2', 'p3', 'assist')).toBe(later);
    expect(auxiliaryAction(later, 'p1', 'p3', 'obstruct')).toBe(later);
  });
  it('gives help/conflict opportunities even with saturated random traits and useless initial luggage', () => {
    let g = game();
    g.players = g.players.map(p => ({ ...p, slots: { ...p.slots, character: { ...p.slots.character, card: { ...p.slots.character.card, modifier: 'positive' } } } }));
    const helped = auxiliaryAction(g, 'p2', 'p3', 'assist');
    expect(helped.hiddenThreat!.players.p2.points).toBe(1);
    expect(itemsOf(helped.players[2].slots.luggage.card).some(i => i.id === 'aid-p2-1')).toBe(true);
    g = game();
    g.players[2].slots.character.card = { ...g.players[2].slots.character.card, modifier: 'negative' };
    const harmed = auxiliaryAction(g, 'p1', 'p3', 'obstruct');
    expect(harmed.hiddenThreat!.players.p1.points).toBeGreaterThan(0);
    expect(itemsOf(harmed.players[2].slots.luggage.card).length).toBe(itemsOf(g.players[2].slots.luggage.card).length - 1);
  });
  it('transfers actual items and blocks back-and-forth reward farming', () => {
    let g = game();
    g.players[1].slots.luggage.card = card('positive', 'shared');
    g.players[2].slots.luggage.card = card('neutral', 'other');
    g = auxiliaryAction(g, 'p2', 'p3', 'transfer', 'shared');
    expect(g.hiddenThreat!.players.p2.points).toBe(1);
    expect(itemsOf(g.players[1].slots.luggage.card)).toHaveLength(0);
    g = { ...g, round: 2 };
    g = auxiliaryAction(g, 'p3', 'p2', 'transfer', 'shared');
    g = auxiliaryAction(g, 'p2', 'p3', 'transfer', 'shared');
    expect(g.hiddenThreat!.players.p2.points).toBe(1);
  });
  it('awards curing a negative health trait once through an actual action card', () => {
    const g = game();
    g.players[1].slots.action.card.effect = 'healOther';
    g.players[2].slots.health.card = { ...g.players[2].slots.health.card, modifier: 'negative' };
    const next = playAction(g, 'p2', { target: 'p3' });
    expect(next.hiddenThreat!.players.p2.points).toBe(2);
    expect(playAction(next, 'p2', { target: 'p3' })).toBe(next);
    const replay = { ...next, players: next.players.map(p => p.id === 'p2' ? { ...p, slots: { ...p.slots, action: { ...p.slots.action, isRevealed: false } } } : p) };
    expect(playAction(replay, 'p2', { target: 'p3' }).hiddenThreat!.players.p2.points).toBe(2);
  });
  it('awards useful theft via profession perks and never awards a no-op', () => {
    const g = game();
    g.players[2].slots.luggage.card = card('positive', 'theft');
    g.perks = [{ playerId: 'p1', kind: 'steal', level: 'novice' }];
    const next = playPerk(g, 'p1', { target: 'p3' });
    expect(next.hiddenThreat!.players.p1.points).toBe(1);
    expect(playPerk(next, 'p1', { target: 'p3' })).toBe(next);
    expect(rewardTransition(g, g, 'p1', 'nothing')).toBe(g);
  });
  it('awards replacing useful equipment with inferior equipment exactly once', () => {
    const g = game();
    g.players[0].slots.action.card.effect = 'giveLuggage';
    g.players[2].slots.luggage.card = card('positive', 'replace');
    g.deck!.luggage = [card('negative', 'inferior')];
    const next = playAction(g, 'p1', { target: 'p3' });
    expect(next.hiddenThreat!.players.p1.points).toBe(2);
    expect(rewardTransition(g, next, 'p1', 'reprocess').hiddenThreat!.players.p1.points).toBe(2);
    expect(playAction(next, 'p1', { target: 'p3' })).toBe(next);
  });
  it('caps auxiliary participation at three uses and prevents undo erasing a secret command', () => {
    let g = game(8);
    for (let round = 1; round <= 3; round++) { g = { ...g, round }; g = auxiliaryAction(g, 'p1', `p${round + 3}`, 'obstruct'); }
    g = { ...g, round: 4 };
    expect(auxiliaryAction(g, 'p1', 'p7', 'obstruct')).toBe(g);
    const before = game(), after = revealCard(before, 'p1', 'biology');
    const changed = { ...after, hiddenThreat: { ...after.hiddenThreat!, processed: ['private-action'] } };
    expect(canUndo({ before, after }, changed)).toBe(false);
    expect(applyUndo(before, after).hiddenThreat).toBe(before.hiddenThreat);
  });
  it('does not finish over capacity after repeated abstentions and overtime stops at the curtain', () => {
    const g = { ...game(), phase: 'result' as const, round: 8, schedule: Array(8).fill(1) };
    expect(nextRound(g).phase).not.toBe('final');
    const timed = { ...game(), deadline: 1, config: { ...game().config, speechSec: 10 } };
    expect(tickGame(timed, 100000).phase).toBe('secret');
  });
});
