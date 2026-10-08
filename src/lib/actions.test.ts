import { describe, expect, it } from 'vitest';
import { BUILTIN_PACKS, CLASSIC_PACK } from '../data/classicPack';
import { ACTION_EFFECTS, type ActionEffect, type GameState, type SessionConfig } from '../types';
import { canApply, effectiveVotes, runEffect } from './actions';
import { composeItems, itemsOf, MAX_ITEMS } from './inventory';
import { ABSTAIN, castVote, createGame, playAction, resolveVote, startVote } from './game';
import { sanitizePack } from './packs';
import { viewFor } from './online';

const cfg = (n: number, autoActions = true): SessionConfig => ({
  scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: [CLASSIC_PACK.id], playerCount: n, shelterSlots: 1, mode: 'pass-and-play', voting: 'open',
  revealsPerVote: 1, timeLimitMin: 0, speechSec: 0, hazardCount: 0, difficulty: 'normal', roundEvents: false, autoActions,
  names: Array.from({ length: n }, (_, i) => `П${i + 1}`), seed: 11,
});
const fresh = (n = 5, auto = true) => createGame(cfg(n, auto), CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
/** Выдаёт игроку карту действия с нужным эффектом. */
const give = (g: GameState, id: string, effect: ActionEffect): GameState => ({
  ...g,
  players: g.players.map((p) => (p.id === id ? { ...p, slots: { ...p.slots, action: { card: { ...p.slots.action.card, title: effect, effect }, isRevealed: false } } } : p)),
});
const P = (g: GameState, id: string) => g.players.find((p) => p.id === id)!;
const luggage = (g: GameState, id: string) => P(g, id).slots.luggage.card;
const bag = (g: GameState, id: string) => itemsOf(luggage(g, id)).map((c) => c.id);
const item = (id: string, tags?: string[]) => ({ id, category: 'luggage' as const, description: `Предмет ${id}`, modifier: 'neutral' as const, ...(tags ? { tags } : {}) });
/** Выдаёт игроку багаж из нескольких предметов. */
const withBag = (g: GameState, id: string, items: ReturnType<typeof item>[]): GameState => ({ ...g, players: g.players.map((p) => (p.id === id ? { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: composeItems(items, () => p.slots.luggage.card) } } } : p)) });
const used = (g: GameState, id: string) => P(g, id).slots.action.isRevealed;

describe('deck', () => {
  it('holds only cards that were not dealt, deterministically', () => {
    const g = fresh();
    const dealt = new Set(g.players.map((p) => p.slots.luggage.card.id));
    expect(g.deck!.luggage!.length).toBeGreaterThan(0);
    expect(g.deck!.luggage!.some((c) => dealt.has(c.id))).toBe(false);
    expect(fresh().deck!.luggage!.map((c) => c.id)).toEqual(g.deck!.luggage!.map((c) => c.id));
    expect(g.deck!.physique!.length).toBeGreaterThan(0);
  });
});

describe('luggage effects', () => {
  it('drawLuggage adds the top card to the inventory and spends the action', () => {
    const g = withBag(give(fresh(), 'p1', 'drawLuggage'), 'p1', [item('a')]);
    const top = g.deck!.luggage![0];
    const r = runEffect(g, 'p1', 'drawLuggage');
    expect(used(r, 'p1')).toBe(true);
    expect(r.deck!.luggage!).toHaveLength(g.deck!.luggage!.length - 1);
    expect(bag(r, 'p1')).toEqual(['a', top.id]);
    expect(r.discard!.luggage!).toHaveLength(0);
    expect(r.log.at(-1)!.text).toContain('П1');
  });

  it('a full inventory keeps the most valuable items and discards the rest', () => {
    const full = [item('a'), item('b'), item('c'), item('d')];
    expect(full.length).toBe(MAX_ITEMS);
    const g = withBag(give(fresh(), 'p1', 'drawLuggage'), 'p1', full);
    const r = runEffect(g, 'p1', 'drawLuggage');
    expect(bag(r, 'p1')).toHaveLength(MAX_ITEMS);
    expect(r.discard!.luggage!).toHaveLength(1);
  });

  it('drawLuggage log is the same whatever happens and a hidden bag stays hidden', () => {
    const logs = new Set<string>();
    for (let seed = 1; seed < 20; seed++) {
      const g = give(createGame({ ...cfg(5), seed }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]), 'p1', 'drawLuggage');
      const r = runEffect(g, 'p1', 'drawLuggage');
      logs.add(r.log.at(-1)!.text);
      expect(P(r, 'p1').slots.luggage.isRevealed).toBe(false);
    }
    expect(logs.size).toBe(1);
  });

  it('players start with one or two items, deterministically, and the deck loses what was dealt', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed < 30; seed++) {
      const g = createGame({ ...cfg(6), seed }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
      for (const p of g.players) counts.add(itemsOf(p.slots.luggage.card).length);
      const dealt = new Set(g.players.flatMap((p) => itemsOf(p.slots.luggage.card).map((c) => c.id)));
      expect(g.deck!.luggage!.some((c) => dealt.has(c.id))).toBe(false);
      expect(g.players.map((p) => bag(g, p.id))).toEqual(createGame({ ...cfg(6), seed }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]).players.map((p) => bag(g, p.id)));
    }
    expect([...counts].sort()).toEqual([1, 2]);
  });

  it('giveLuggage keeps the victim card hidden if it was hidden', () => {
    const g = give(fresh(), 'p1', 'giveLuggage');
    const r = runEffect(g, 'p1', 'giveLuggage', { target: 'p2' });
    expect(P(r, 'p2').slots.luggage.isRevealed).toBe(false);
  });

  it('stealLuggage takes one item from the victim into the actor inventory, and an emptied bag is marked stolen', () => {
    let g = withBag(give(fresh(), 'p1', 'stealLuggage'), 'p2', [item('x'), item('y')]);
    g = withBag(g, 'p1', [item('mine')]);
    const r = runEffect(g, 'p1', 'stealLuggage', { target: 'p2' });
    const rest = bag(r, 'p2');
    expect(rest).toHaveLength(1);
    expect(['x', 'y']).toContain(rest[0]);
    expect(bag(r, 'p1').sort()).toEqual(['mine', rest[0] === 'x' ? 'y' : 'x'].sort());
    expect(used(r, 'p1')).toBe(true);
    // у жертвы остался один предмет: вторая кража опустошает багаж
    const g2 = { ...r, players: r.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, action: { ...p.slots.action, isRevealed: false } } } : p)) };
    const r2 = runEffect(g2, 'p1', 'stealLuggage', { target: 'p2' });
    expect(luggage(r2, 'p2').description).toContain('украден');
    expect(bag(r2, 'p2')).toEqual([]);
    expect(canApply(r2, 'p3', 'stealLuggage', { target: 'p2' }).ok).toBe(false);
  });

  it('refuses invalid targets and leaves everything untouched', () => {
    const g = give(fresh(), 'p1', 'stealLuggage');
    expect(runEffect(g, 'p1', 'stealLuggage', { target: 'p1' })).toBe(g);
    expect(runEffect(g, 'p1', 'stealLuggage', { target: 'nobody' })).toBe(g);
    expect(runEffect(g, 'p1', 'stealLuggage')).toBe(g);
    const dead = { ...g, players: g.players.map((p) => (p.id === 'p2' ? { ...p, isEliminated: true } : p)) };
    expect(runEffect(dead, 'p1', 'stealLuggage', { target: 'p2' })).toBe(dead);
  });

  it('swapLuggage, sabotage and giveLuggage', () => {
    let g = give(fresh(), 'p1', 'swapLuggage');
    const a = luggage(g, 'p1'), b = luggage(g, 'p3');
    const swapped = runEffect(g, 'p1', 'swapLuggage', { target: 'p3' });
    expect(luggage(swapped, 'p1').id).toBe(b.id);
    expect(luggage(swapped, 'p3').id).toBe(a.id);
    g = give(fresh(), 'p1', 'sabotage');
    expect(luggage(runEffect(g, 'p1', 'sabotage', { target: 'p2' }), 'p2').description).toContain('потерян');
    g = give(fresh(), 'p1', 'giveLuggage');
    const top = g.deck!.luggage![0];
    const given = runEffect(g, 'p1', 'giveLuggage', { target: 'p2' });
    expect(bag(given, 'p2')).toContain(top.id);
  });

  it('an action can only be used once', () => {
    const g = runEffect(give(fresh(), 'p1', 'drawLuggage'), 'p1', 'drawLuggage');
    expect(canApply(g, 'p1', 'drawLuggage').ok).toBe(false);
    expect(runEffect(g, 'p1', 'drawLuggage')).toBe(g);
  });
});

describe('body effects', () => {
  it('reroll hits the previous alive neighbour, skipping eliminated players', () => {
    let g = give(fresh(), 'p1', 'rerollPrevPhysique');
    g = { ...g, players: g.players.map((p) => (p.id === 'p5' ? { ...p, isEliminated: true } : p)) };
    const before = P(g, 'p4').slots.physique.card.id;
    const r = runEffect(g, 'p1', 'rerollPrevPhysique');
    expect(P(r, 'p4').slots.physique.card.id).not.toBe(before);
    expect(P(r, 'p5').slots.physique.card.id).toBe(P(g, 'p5').slots.physique.card.id);
  });

  it('swapNeighbors swaps the cards of the players before and after, and needs three alive players', () => {
    const g = give(fresh(), 'p3', 'swapNeighborsPhysique');
    const a = P(g, 'p2').slots.physique.card.id, b = P(g, 'p4').slots.physique.card.id;
    const r = runEffect(g, 'p3', 'swapNeighborsPhysique');
    expect(P(r, 'p2').slots.physique.card.id).toBe(b);
    expect(P(r, 'p4').slots.physique.card.id).toBe(a);
    const two = give(fresh(2), 'p1', 'swapNeighborsPhysique');
    expect(canApply(two, 'p1', 'swapNeighborsPhysique').ok).toBe(false);
  });

  it('rerollHobby changes only the own hobby', () => {
    const g = give(fresh(), 'p1', 'rerollHobby');
    const r = runEffect(g, 'p1', 'rerollHobby');
    expect(P(r, 'p1').slots.hobby.card.id).not.toBe(P(g, 'p1').slots.hobby.card.id);
    expect(P(r, 'p2').slots.hobby.card.id).toBe(P(g, 'p2').slots.hobby.card.id);
  });
});

describe('reveal and heal', () => {
  it('forceReveal reveals exactly the chosen hidden card', () => {
    const g = give(fresh(), 'p1', 'forceReveal');
    expect(runEffect(g, 'p1', 'forceReveal', { target: 'p2' })).toBe(g); // категория не выбрана
    const r = runEffect(g, 'p1', 'forceReveal', { target: 'p2', category: 'hobby' });
    expect(P(r, 'p2').slots.hobby.isRevealed).toBe(true);
    expect(P(r, 'p2').slots.fact.isRevealed).toBe(false);
    const again = give(r, 'p1', 'forceReveal');
    expect(runEffect(again, 'p1', 'forceReveal', { target: 'p2', category: 'hobby' })).toBe(again); // уже открыта
  });

  it('heal needs a sick actor and a doctor among the living', () => {
    let g = give(fresh(), 'p1', 'heal');
    const sick = (id: string, on: boolean) => (x: GameState): GameState => ({ ...x, players: x.players.map((p) => (p.id === id ? { ...p, slots: { ...p.slots, health: { ...p.slots.health, card: { ...p.slots.health.card, modifier: on ? ('negative' as const) : ('positive' as const) } } } } : p)) });
    const doctor = (id: string, on: boolean) => (x: GameState): GameState => ({ ...x, players: x.players.map((p) => (p.id === id ? { ...p, slots: { ...p.slots, profession: { ...p.slots.profession, card: { ...p.slots.profession.card, tags: on ? ['медицина'] : [] } } } } : p)) });
    g = sick('p1', false)(g);
    expect(canApply(g, 'p1', 'heal').ok).toBe(false);
    g = sick('p1', true)(g);
    for (const p of g.players) g = doctor(p.id, false)(g);
    expect(canApply(g, 'p1', 'heal').ok).toBe(false);
    g = doctor('p2', true)(g);
    const r = runEffect(g, 'p1', 'heal');
    expect(P(r, 'p1').slots.health.card.modifier).toBe('neutral');
    expect(P(r, 'p1').slots.health.card.description).toContain('вылечен');
  });
});

describe('voting effects', () => {
  const voteAll = (g: GameState, targets: Record<string, string>) => Object.entries(targets).reduce((x, [v, t]) => castVote(x, v, t), g);
  const eliminated = (g: GameState) => g.players.filter((p) => p.isEliminated).map((p) => p.id);

  it('doubleVote counts for two', () => {
    let g = startVote(give(fresh(3), 'p1', 'doubleVote'));
    g = runEffect(g, 'p1', 'doubleVote');
    g = resolveVote(voteAll(g, { p1: 'p3', p2: 'p1', p3: 'p1' }));
    expect(g.lastResult!.tally).toEqual({ p1: 2, p2: 0, p3: 2 }); // двойной голос p1 против p3
    expect(g.fx).toBeUndefined();
  });

  it('veto cancels one vote against the actor', () => {
    let g = startVote(give(fresh(3), 'p1', 'veto'));
    g = runEffect(g, 'p1', 'veto');
    g = resolveVote(voteAll(g, { p1: 'p2', p2: 'p1', p3: 'p1' }));
    expect(g.lastResult!.tally.p1).toBe(1);
  });

  it('immunity protects from elimination and removes the right to vote', () => {
    let g = startVote(give(fresh(3), 'p1', 'immunity'));
    g = runEffect(g, 'p1', 'immunity');
    expect(g.votes.p1).toBe('immune');
    expect(castVote(g, 'p1', 'p2').votes.p1).toBe('immune'); // голосовать не может
    g = resolveVote(voteAll(g, { p2: 'p1', p3: 'p1' }));
    expect(eliminated(g)).not.toContain('p1');
    expect(eliminated(g)).toHaveLength(1);
  });

  it('immunity declared before the vote is applied when the vote starts', () => {
    let g = runEffect(give(fresh(3), 'p1', 'immunity'), 'p1', 'immunity');
    g = startVote(g);
    expect(g.votes.p1).toBe('immune');
  });

  it('ally copies the actor vote to the partner; the secret partner never reaches the log', () => {
    let g = startVote(give(fresh(4), 'p1', 'ally'));
    g = runEffect(g, 'p1', 'ally', { target: 'p2' });
    expect(g.log.at(-1)!.text).not.toContain('П2');
    g = resolveVote(voteAll(g, { p1: 'p4', p2: 'p3', p3: 'p4', p4: 'p1' }));
    expect(g.lastResult!.tally.p4).toBe(3); // p1, p3 и союзник p2 против p4
  });

  it('ally copies read the original votes, so chains do not depend on order', () => {
    const g = startVote(fresh(4));
    const r = { ...g, votes: { p1: 'p4', p2: 'p1', p3: 'p2', p4: 'p1' }, fx: { double: [], veto: [], immune: [], allies: [['p1', 'p2'], ['p2', 'p3']] as [string, string][] } };
    const v = effectiveVotes(r as GameState);
    expect(v.p2).toBe('p4'); // копия голоса p1
    expect(v.p3).toBe('p1'); // p3 копирует исходный голос p2 (против p1), а не уже переписанный
  });

  it('a partner gets a copy from only one ally, the first in order', () => {
    const g = startVote(fresh(5));
    const r = { ...g, votes: { p1: 'p4', p2: 'p1', p3: 'p5', p4: 'p1', p5: 'p1' }, fx: { double: [], veto: [], immune: [], allies: [['p1', 'p2'], ['p3', 'p2']] as [string, string][] } };
    expect(effectiveVotes(r as GameState).p2).toBe('p4');
  });

  it('veto cancels a vote chosen by a seeded draw, not by the first voter in order', () => {
    const base = startVote(fresh(5));
    const votes: Record<string, string> = { p1: 'p5', p2: 'p5', p3: 'p5', p4: 'p1', p5: 'p2' };
    const picked = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const g = { ...base, seed, votes, fx: { double: [], veto: ['p5'], immune: [], allies: [] } } as GameState;
      const eff = effectiveVotes(g);
      const cancelled = Object.keys(votes).filter((v) => !(v in eff));
      expect(cancelled).toHaveLength(1);
      expect(['p1', 'p2', 'p3']).toContain(cancelled[0]); // отменяется один из голосов против p5
      picked.add(cancelled[0]);
    }
    expect(picked.size).toBeGreaterThan(1);
  });

  it('abstain majority still skips the round even with actions in play', () => {
    let g = startVote(give(fresh(3), 'p1', 'doubleVote'));
    g = runEffect(g, 'p1', 'doubleVote');
    g = resolveVote(voteAll(g, { p1: ABSTAIN, p2: ABSTAIN, p3: 'p1' }));
    expect(g.lastResult!.skipped).toBe(true);
  });
});

describe('modes and data', () => {
  it('without autoActions a card is only announced, whatever its effect', () => {
    const g = give(fresh(5, false), 'p1', 'stealLuggage');
    const r = playAction(g, 'p1', { target: 'p2' });
    expect(used(r, 'p1')).toBe(true);
    expect(luggage(r, 'p1').id).toBe(luggage(g, 'p1').id);
    expect(luggage(r, 'p2').id).toBe(luggage(g, 'p2').id);
  });

  it('with autoActions playAction runs the effect and refuses an impossible one', () => {
    const g = give(fresh(), 'p1', 'stealLuggage');
    expect(bag(playAction(g, 'p1', { target: 'p2' }), 'p1').some((id) => bag(g, 'p2').includes(id))).toBe(true);
    expect(playAction(g, 'p1')).toBe(g); // цель не выбрана
  });

  it('views never carry the deck, discard or secret alliances', () => {
    let g = startVote(give(fresh(4), 'p1', 'ally'));
    g = runEffect(g, 'p1', 'ally', { target: 'p2' });
    const view = viewFor(g, 'p3');
    expect('deck' in view || 'discard' in view || 'fx' in view).toBe(false);
  });

  it('every built-in action card has a valid effect', () => {
    for (const p of BUILTIN_PACKS) for (const c of p.cards.action) expect(Object.keys(ACTION_EFFECTS), `${p.id}/${c.title}`).toContain(c.effect);
  });

  it('sanitizePack keeps known effects on action cards only', () => {
    const pack = sanitizePack({
      name: 'x', scenarios: [], cards: {
        action: [{ description: 'a', title: 'A', effect: 'veto' }, { description: 'b', effect: 'rm -rf' }],
        fact: [{ description: 'c', effect: 'veto' }],
      },
    })!;
    expect(pack.cards.action[0].effect).toBe('veto');
    expect(pack.cards.action[1].effect).toBeUndefined();
    expect(pack.cards.fact[0].effect).toBeUndefined();
  });
});
