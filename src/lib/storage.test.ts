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
