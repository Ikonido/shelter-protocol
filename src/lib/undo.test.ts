import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import type { SessionConfig } from '../types';
import { createGame, extendDeadline, playAction, revealCard } from './game';
import { applyUndo, undoable } from './undo';

const cfg: SessionConfig = {
  scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: [CLASSIC_PACK.id], playerCount: 4, shelterSlots: 1, mode: 'pass-and-play', voting: 'open',
  revealsPerVote: 1, timeLimitMin: 30, speechSec: 0, hazardCount: 0, difficulty: 'normal', roundEvents: false, autoActions: false,
  names: ['А', 'Б', 'В', 'Г'], seed: 5,
};
const start = () => createGame(cfg, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);

describe('undo of a reveal', () => {
  it('is allowed right after the reveal and after the clock was extended', () => {
    const before = start();
    const after = revealCard(before, 'p1', 'biology');
    expect(after).not.toBe(before);
    expect(undoable(after, after)).toBe(true);
    expect(undoable(after, extendDeadline(after, 60_000))).toBe(true);
  });

  it('is refused once another action changed the table', () => {
    const after = revealCard(start(), 'p1', 'biology');
    expect(undoable(after, playAction(after, 'p2'))).toBe(false);
  });

  it('keeps the current match clock when rolled back', () => {
    const before = start();
    const after = revealCard(before, 'p1', 'biology');
    const later = extendDeadline(after, 5 * 60_000);
    const back = applyUndo(before, later);
    expect(back.deadline).toBe(later.deadline);
    expect(back.deadline).not.toBe(before.deadline);
    expect(back.players).toBe(before.players);
  });
});
