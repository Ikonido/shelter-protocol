import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import { createGame } from './game';
import { validateSavedGame } from './storage';
import type { SessionConfig } from '../types';

const config: SessionConfig = {
  scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: [CLASSIC_PACK.id], playerCount: 3, shelterSlots: 1, mode: 'pass-and-play', voting: 'open',
  revealsPerVote: 1, timeLimitMin: 0, speechSec: 0, hazardCount: 0, difficulty: 'normal', roundEvents: false, names: ['А', 'Б', 'В'], seed: 5,
};
const fresh = () => JSON.parse(JSON.stringify(createGame(config, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK])));

describe('saved game validation', () => {
  it('accepts a real game, including after a JSON round-trip', () => {
    expect(validateSavedGame(fresh())).not.toBeNull();
  });

  it('accepts old saves that predate physique and character', () => {
    const g = fresh();
    for (const p of g.players) { delete p.slots.physique; delete p.slots.character; }
    expect(validateSavedGame(g)).not.toBeNull();
  });

  it('rejects broken or foreign data instead of crashing later', () => {
    const broken = (mutate: (g: any) => void) => { const g = fresh(); mutate(g); return validateSavedGame(g); };
    expect(validateSavedGame(null)).toBeNull();
    expect(validateSavedGame('x')).toBeNull();
    expect(validateSavedGame([])).toBeNull();
    expect(validateSavedGame({})).toBeNull();
    expect(broken((g) => { g.players = []; })).toBeNull();
    expect(broken((g) => { g.phase = 'weird'; })).toBeNull();
    expect(broken((g) => { g.round = 'один'; })).toBeNull();
    expect(broken((g) => { g.votes = null; })).toBeNull();
    expect(broken((g) => { g.log = {}; })).toBeNull();
    expect(broken((g) => { delete g.players[0].slots.health; })).toBeNull();
    expect(broken((g) => { g.players[1].slots.fact.card = null; })).toBeNull();
    expect(broken((g) => { g.players[2].slots.profession.card.description = 42; })).toBeNull();
    expect(broken((g) => { g.scenario = { id: 'x' }; })).toBeNull();
  });
});

describe('saved game validation: deep checks', () => {
  const broken = (mutate: (g: any) => void) => { const g = fresh(); mutate(g); return validateSavedGame(g); };
  it('rejects malformed log, votes, schedule and fx', () => {
    expect(broken((g) => { g.log = [{ round: 1 }]; })).toBeNull();
    expect(broken((g) => { g.votes = { p1: 42 }; })).toBeNull();
    expect(broken((g) => { g.schedule = ['x']; })).toBeNull();
    expect(broken((g) => { g.fx = { double: 'p1', veto: [], immune: [], allies: [] }; })).toBeNull();
    expect(broken((g) => { g.fx = { double: [], veto: [], immune: [], allies: [['p1']] }; })).toBeNull();
  });
  it('rejects a player with a wrong elimination flag or a broken card', () => {
    expect(broken((g) => { g.players[0].isEliminated = 'yes'; })).toBeNull();
    expect(broken((g) => { g.players[0].slots.health.card = null; })).toBeNull();
  });
  it('still accepts a valid game with allies and deadlines', () => {
    expect(broken((g) => { g.fx = { double: ['p1'], veto: [], immune: [], allies: [['p1', 'p2']] }; g.deadline = Date.now() + 1000; })).not.toBeNull();
  });
});
