import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../../data/classicPack';
import type { GameState } from '../../types';
import {
  createGame,
  revealCard,
  startVote,
  finishDiscussion,
  playAction,
  playPerk,
  nextRound,
  castVote,
  resolveVote,
} from '../game';
import { validateSavedGame } from '../storage';
import { viewFor, sanitizeView } from '../online';
import { evaluate } from '../evaluate';
import { buildChronicle } from '../chronicle';
import { undoable } from '../undo';
import { auxiliaryAction, cooperate, rewardTransitions } from './economy';
import {
  beginSecretRound,
  submitSecret,
  resolveSecretRound,
  publishFinding,
  releasePublications,
} from './engine';
import {
  distributeRoles,
  threatConfigError,
  defaultThreatSettings,
} from './roles';
import { threatFinal, threatViewFor } from './views';

import { game, idOf, round, commit, finishBatch } from './fixtures';

describe('hidden threat roles and classic compatibility', () => {
  it.each([2, 3, 13, 20])('rejects unsupported %i-player games', (n) => {
    expect(threatConfigError(n, 1)).not.toBeNull();
    expect(() => game(n)).toThrow();
  });
  it.each([4, 5, 6, 7, 8, 9, 10, 11, 12])(
    'allocates the specified roles at %i players independently of profession',
    (n) => {
      const g = game(n),
        roles = Object.values(g.hiddenThreat!.players).map((p) => p.role);
      expect(roles.filter((r) => r === 'police')).toHaveLength(1);
      expect(roles.filter((r) => r === 'mafia' || r === 'maniac')).toHaveLength(
        n >= 10 ? 3 : n >= 8 ? 2 : 1,
      );
      const classic = createGame(
        { ...g.config, hiddenThreat: undefined },
        g.scenario,
        [CLASSIC_PACK],
      );
      expect(g.players).toEqual(classic.players);
      expect(g.deck).toEqual(classic.deck);
      expect(classic.hiddenThreat).toBeUndefined();
      const other = distributeRoles(
        g.players.map((p) => p.id),
        defaultThreatSettings,
        () => 0,
      );
      expect(other).not.toEqual(
        Object.fromEntries(
          Object.entries(g.hiddenThreat!.players).map(([id, p]) => [
            id,
            p.role,
          ]),
        ),
      );
    },
  );
  it.each([6, 7])('allows a single mafia member in %i-player games', (n) => {
    expect(
      Object.values(game(n, true).hiddenThreat!.players).filter(
        (p) => p.role === 'mafia',
      ),
    ).toHaveLength(1);
  });
  it.each([
    [8, 7],
    [9, 8],
    [10, 8],
    [12, 10],
  ])('rejects guaranteed infiltration at %i players / %i seats', (n, k) => {
    expect(threatConfigError(n, k)).not.toBeNull();
  });
  it('uses the real reveal → secret → discussion → vote → final flow', () => {
    let g = game();
    for (const p of g.players) g = revealCard(g, p.id, 'biology');
    expect(g.phase).toBe('secret');
    expect(startVote(g).phase).toBe('secret');
    g = finishBatch(g);
    expect(g.phase).toBe('discussion');
    g = finishDiscussion(g);
    expect(g.phase).toBe('vote');
    for (const p of g.players)
      g = castVote(g, p.id, p.id === 'p1' ? 'p2' : 'p1');
    g = resolveVote(g);
    expect(g.phase).toBe('result');
    expect(nextRound(g).phase).not.toBe('final');
  });
  it('plays a complete multi-round selection and declassifies only after the final seat is assigned', () => {
    let g = game();
    for (let i = 0; i < 8 && g.phase !== 'final'; i++) {
      g = finishDiscussion(finishBatch(startVote(g)));
      const living = g.players.filter((p) => !p.isEliminated);
      for (const voter of living)
        g = castVote(
          g,
          voter.id,
          voter.id === living[0].id ? living[1].id : living[0].id,
        );
      g = resolveVote(g);
      expect(threatViewFor(g, living.at(-1)!.id)!.final).toBeUndefined();
      g = nextRound(g);
      expect(validateSavedGame(JSON.parse(JSON.stringify(g)))).not.toBeNull();
    }
    expect(g.phase).toBe('final');
    expect(g.players.filter((p) => !p.isEliminated)).toHaveLength(1);
    expect(threatFinal(g)!.winner).toBe('civilian');
    expect(threatFinal(g)!.roles).toHaveLength(4);
  });
  it('runs configured first-round events in managed tabletop while keeping classic tabletop a generator', () => {
    const g = game();
    const config = {
      ...g.config,
      mode: 'tabletop' as const,
      roundEvents: true,
    };
    const managed = createGame(config, g.scenario, [CLASSIC_PACK]);
    expect(managed.phase).toBe('event');
    expect(managed.event).toBeDefined();
    expect(
      createGame({ ...config, hiddenThreat: undefined }, g.scenario, [
        CLASSIC_PACK,
      ]).phase,
    ).toBe('final');
  });
  it('does not change survival scoring or the inventory when applying secret sabotage', () => {
    const g = beginSecretRound(game()),
      crime = idOf(g, 'maniac'),
      police = idOf(g, 'police');
    const next = finishBatch(
      commit(g, crime, {
        kind: 'sabotage',
        target: police,
        method: 'plant',
        evidence: 'knife',
      }),
    );
    expect(next.players).toEqual(g.players);
    expect(next.deck).toEqual(g.deck);
    expect(evaluate(next.scenario, next.players)).toEqual(
      evaluate(g.scenario, g.players),
    );
    expect(next.players.some((p) => p.isEliminated)).toBe(false);
  });
  it.each(['civilian', 'maniac', 'mafia'])(
    'separates %s victory from survival',
    (winner) => {
      const g = game(winner === 'mafia' ? 8 : 4),
        chosen = idOf(g, winner);
      g.players = g.players.map((p) => ({
        ...p,
        isEliminated: p.id !== chosen,
      }));
      expect(threatFinal(g)).toBeUndefined();
      g.phase = 'final';
      expect(threatFinal(g)!.winner).toBe(winner);
      expect(threatFinal(g)!.roles).toHaveLength(g.players.length);
    },
  );
  it('reports an incomplete selection instead of pretending extra survivors fit the shelter', () => {
    const g = game();
    g.phase = 'final';
    expect(threatFinal(g)!.winner).toBe('unresolved');
  });
});

describe('secret resolution, budgets and evidence', () => {
  it('always credits the mandatory framing bonus even after a large legitimate balance', () => {
    const g = beginSecretRound(game());
    const police = idOf(g, 'police');
    g.hiddenThreat!.players[police].points = 20;
    const done = finishBatch(
      commit(g, idOf(g, 'maniac'), {
        kind: 'sabotage',
        target: police,
        method: 'plant',
        evidence: 'knife',
      }),
    );
    expect(done.hiddenThreat!.players[police].points).toBe(21);
    expect(validateSavedGame(JSON.parse(JSON.stringify(done)))).not.toBeNull();
  });
  it('applies sabotage before inspection regardless of submission order', () => {
    let g = beginSecretRound(game());
    const crime = idOf(g, 'maniac'),
      police = idOf(g, 'police');
    g = commit(g, police, {
      kind: 'investigate',
      target: 'p4',
      direction: 'dossier',
    });
    expect(threatViewFor(g, police)!.mine!.findings).toHaveLength(0);
    expect(g.log).toHaveLength(0);
    g = commit(g, crime, {
      kind: 'sabotage',
      target: 'p4',
      method: 'plant',
      evidence: 'knife',
    });
    g = finishBatch(g);
    const f = g.hiddenThreat!.players[police].findings[0];
    expect(f.evidence).toBe('knife');
    expect(f.result).toBe('material');
    expect(g.log).toHaveLength(1);
    expect(g.log[0].text).not.toContain(police);
  });
  it('grants exactly one private +1 for framing police; duplicate/reload/re-resolution are no-ops', () => {
    const start = beginSecretRound(game()),
      crime = idOf(start, 'maniac'),
      police = idOf(start, 'police');
    const cmd = {
      id: 'same-command-123',
      round: 1,
      operation: {
        kind: 'sabotage' as const,
        target: police,
        method: 'plant' as const,
        evidence: 'knife' as const,
      },
    };
    const queued = submitSecret(start, crime, cmd);
    expect(submitSecret(queued, crime, cmd)).toBe(queued);
    const saved = validateSavedGame(JSON.parse(JSON.stringify(queued)))!;
    expect(saved).not.toBeNull();
    const done = finishBatch(saved);
    expect(done.hiddenThreat!.players[police].points).toBe(1);
    expect(done.hiddenThreat!.players[police].notices).toHaveLength(1);
    expect(done.hiddenThreat!.players[police].notices[0]).not.toContain(crime);
    expect(resolveSecretRound(done)).toBe(done);
    expect(submitSecret(done, crime, cmd)).toBe(done);
    expect(undoable(queued, done)).toBe(false);
  });
  it('does not grant the framing bonus to an ordinary player', () => {
    const g = beginSecretRound(game());
    const crime = idOf(g, 'maniac');
    const next = finishBatch(
      commit(g, crime, {
        kind: 'sabotage',
        target: 'p4',
        method: 'plant',
        evidence: 'knife',
      }),
    );
    expect(next.hiddenThreat!.players['p4'].points).toBe(0);
  });
  it('resolves simultaneous mafia requests by roster priority with a shared two-use budget', () => {
    let g = beginSecretRound(game(8));
    g = commit(g, 'p2', {
      kind: 'sabotage',
      target: 'p8',
      method: 'plant',
      evidence: 'knife',
    });
    g = commit(g, 'p1', {
      kind: 'sabotage',
      target: 'p7',
      method: 'plant',
      evidence: 'medical',
    });
    g = finishBatch(g);
    expect(g.hiddenThreat!.sabotageUsed).toBe(1);
    expect(g.hiddenThreat!.evidence.filter((e) => e.planted)).toHaveLength(1);
    expect(g.hiddenThreat!.evidence.find((e) => e.planted)!.actor).toBe('p1');
    g = round(g, 2);
    expect(
      commit(g, 'p2', {
        kind: 'sabotage',
        target: 'p8',
        method: 'plant',
        evidence: 'knife',
      }),
    ).toBe(g);
    g.hiddenThreat!.players['p2'].points = 3;
    g = finishBatch(
      commit(g, 'p2', {
        kind: 'sabotage',
        target: 'p8',
        method: 'forge',
        evidence: 'permit',
      }),
    );
    expect(g.hiddenThreat!.players['p2'].points).toBe(0);
    expect(g.hiddenThreat!.sabotageUsed).toBe(2);
    const third = round(g, 3);
    third.hiddenThreat!.players['p1'].points = 20;
    expect(
      commit(third, 'p1', {
        kind: 'sabotage',
        target: 'p8',
        method: 'plant',
        evidence: 'knife',
      }),
    ).toBe(third);
  });
  it('charges 3 for a second check and never allows a third', () => {
    let g = beginSecretRound(game());
    const police = idOf(g, 'police');
    g = finishBatch(
      commit(g, police, {
        kind: 'investigate',
        target: 'p4',
        direction: 'connections',
      }),
    );
    expect(g.hiddenThreat!.players[police].points).toBe(0);
    g = round(g, 2);
    expect(
      commit(g, police, {
        kind: 'investigate',
        target: 'p4',
        direction: 'dossier',
      }),
    ).toBe(g);
    g.hiddenThreat!.players[police].points = 3;
    g = finishBatch(
      commit(g, police, {
        kind: 'investigate',
        target: 'p4',
        direction: 'dossier',
      }),
    );
    expect(g.hiddenThreat!.players[police].points).toBe(0);
    const third = round(g, 3);
    third.hiddenThreat!.players[police].points = 20;
    expect(
      commit(third, police, {
        kind: 'investigate',
        target: 'p4',
        direction: 'actions',
      }),
    ).toBe(third);
  });
  it('detects forged connection evidence on a paid, single-use reanalysis without identifying the saboteur', () => {
    let g = beginSecretRound(game());
    const police = idOf(g, 'police'),
      crime = idOf(g, 'maniac');
    g = commit(g, police, {
      kind: 'investigate',
      target: 'p4',
      direction: 'connections',
    });
    g = finishBatch(
      commit(g, crime, {
        kind: 'sabotage',
        target: 'p4',
        method: 'forge',
        evidence: 'identity',
      }),
    );
    const original = g.hiddenThreat!.players[police].findings[0];
    expect(original.result).toBe('links');
    expect(publishFinding(g, crime, original.id)).toBe(g);
    g = publishFinding(g, police, original.id);
    expect(g.hiddenThreat!.public.published).toHaveLength(0);
    expect(threatViewFor(g, crime)!.mine!.queuedPublications).toEqual([]);
    g = releasePublications(g);
    const publicText = JSON.stringify(g.hiddenThreat!.public.published);
    expect(publicText).not.toContain('evidenceId');
    expect(publicText).not.toContain('actor');
    expect(publicText).not.toContain(police);
    expect(publishFinding(g, police, original.id)).toBe(g);
    g = round(g, 2);
    expect(commit(g, police, { kind: 'analyse', finding: original.id })).toBe(
      g,
    );
    g.hiddenThreat!.players[police].points = 2;
    g = finishBatch(
      commit(g, police, { kind: 'analyse', finding: original.id }),
    );
    const f = g.hiddenThreat!.players[police].findings.at(-1)!;
    expect(f.result).toBe('tampered');
    expect(g.hiddenThreat!.players[police].points).toBe(0);
    const third = round(g, 3);
    third.hiddenThreat!.players[police].points = 20;
    expect(
      commit(third, police, { kind: 'analyse', finding: original.id }),
    ).toBe(third);
  });
  it('does not allow evidence-less expertise or investigations by civilians', () => {
    const g = beginSecretRound(game());
    expect(
      commit(g, 'p4', {
        kind: 'investigate',
        target: 'p1',
        direction: 'connections',
      }),
    ).toBe(g);
    expect(
      commit(g, idOf(g, 'police'), { kind: 'analyse', finding: 'invented' }),
    ).toBe(g);
  });
});

describe('economy, safe persistence and declassification', () => {
  it('prevents useful-item ping-pong from earning a second transfer bonus', () => {
    let g = game();
    const police = idOf(g, 'police');
    g.players[1].slots.luggage.card = {
      id: 'transfer-item',
      category: 'luggage',
      description: 'Tools',
      modifier: 'positive',
    };
    g.players[3].slots.luggage.card = {
      id: 'plain-item',
      category: 'luggage',
      description: 'Stone',
      modifier: 'neutral',
    };
    g.players[1].slots.action.card.effect = 'swapLuggage';
    g = playAction(g, police, { target: 'p4' });
    expect(g.hiddenThreat!.players[police].points).toBe(1);
    g.players[3].slots.action.card.effect = 'swapLuggage';
    g = playAction(g, 'p4', { target: police });
    const saved = validateSavedGame(JSON.parse(JSON.stringify(g)))!;
    expect(saved).not.toBeNull();
    saved.players[1].slots.action.isRevealed = false;
    const returned = playAction(saved, police, { target: 'p4' });
    expect(returned.hiddenThreat!.players[police].points).toBe(1);
  });
  it('does not pay for an equal-value replacement but pays once for a forced reveal', () => {
    let g = game();
    const crime = idOf(g, 'maniac');
    g.players[3].slots.luggage.card = {
      id: 'old-supplies',
      category: 'luggage',
      description: 'Food',
      modifier: 'positive',
    };
    g.deck!.luggage = [
      {
        id: 'new-supplies',
        category: 'luggage',
        description: 'Water',
        modifier: 'positive',
      },
    ];
    g.players[0].slots.action.card.effect = 'giveLuggage';
    g = playAction(g, crime, { target: 'p4' });
    expect(g.hiddenThreat!.players[crime].points).toBe(0);
    g.players[0].slots.action.isRevealed = false;
    g.players[0].slots.action.card.effect = 'forceReveal';
    g = playAction(g, crime, { target: 'p4', category: 'fact' });
    expect(g.hiddenThreat!.players[crime].points).toBe(1);
    g.players[0].slots.action.isRevealed = false;
    g.players[3].slots.fact.isRevealed = false;
    g = playAction(g, crime, { target: 'p4', category: 'fact' });
    expect(g.hiddenThreat!.players[crime].points).toBe(1);
  });
  it('records cooperative contributions once per event and persists the reward ledger', () => {
    let g = game();
    const police = idOf(g, 'police');
    g.phase = 'event';
    g.event = {
      id: 'joint-event',
      kind: 'prompt',
      title: 'Repair',
      text: 'Work together',
      tone: 'neutral',
      outcome: [],
    };
    g = cooperate(g, police);
    expect(g.hiddenThreat!.players[police].points).toBe(1);
    expect(g.event!.outcome).toHaveLength(1);
    const saved = validateSavedGame(JSON.parse(JSON.stringify(g)))!;
    expect(saved).not.toBeNull();
    expect(cooperate(saved, police)).toBe(saved);
    const criminal = cooperate(saved, idOf(saved, 'maniac'));
    expect(criminal.hiddenThreat!.players[idOf(saved, 'maniac')].points).toBe(
      0,
    );
    expect(criminal.event!.outcome).toHaveLength(2);
    expect(
      cooperate({ ...criminal, phase: 'reveal' }, police).event!.outcome,
    ).toHaveLength(2);
  });
  it('provides card-independent actions and prevents repeated/oscillating rewards', () => {
    let g = game();
    const police = idOf(g, 'police'),
      crime = idOf(g, 'maniac');
    g = auxiliaryAction(g, police, 'p4', 'aid');
    expect(g.hiddenThreat!.players[police].points).toBe(2);
    expect(auxiliaryAction(g, police, 'p3', 'aid')).toBe(g);
    g = auxiliaryAction(g, crime, 'p4', 'disrupt');
    expect(g.hiddenThreat!.players[crime].points).toBe(2);
    const later = { ...g, round: 2 };
    expect(auxiliaryAction(later, police, 'p4', 'aid')).toBe(later);
    expect(auxiliaryAction(later, crime, 'p4', 'disrupt')).toBe(later);
    expect(
      auxiliaryAction({ ...g, phase: 'final' }, police, 'p3', 'aid')
        .hiddenThreat,
    ).toBe(g.hiddenThreat);
  });
  it('only pays for successful healing and not for repeated healing after re-injury', () => {
    let g = game();
    const police = idOf(g, 'police');
    const target = g.players.find((p) => p.id === 'p4')!;
    target.slots.health.card = {
      id: 'sick',
      category: 'health',
      description: 'Болен',
      modifier: 'negative',
    };
    g.perks = [{ playerId: police, kind: 'heal', level: 'expert' }];
    g = playPerk(g, police, { target: 'p4' });
    expect(g.hiddenThreat!.players[police].points).toBe(2);
    const copy = JSON.parse(JSON.stringify(g)) as GameState;
    copy.players[3].slots.health.card.modifier = 'negative';
    copy.perks = [{ playerId: police, kind: 'heal', level: 'expert' }];
    const healed = playPerk(copy, police, { target: 'p4' });
    expect(healed.hiddenThreat!.players[police].points).toBe(2);
    expect(rewardTransitions(healed, healed, police)).toBe(healed);
  });
  it('scores successful standard theft once for an item and does not reward an empty sabotage', () => {
    let g = game();
    const crime = idOf(g, 'maniac');
    const actor = g.players.find((p) => p.id === crime)!;
    actor.slots.action.card.effect = 'stealLuggage';
    g.players[3].slots.luggage.card = {
      id: 'valuable',
      category: 'luggage',
      description: 'Припасы',
      modifier: 'positive',
    };
    g = playAction(g, crime, { target: 'p4' });
    expect(g.hiddenThreat!.players[crime].points).toBe(1);
    expect(playAction(g, crime, { target: 'p4' })).toBe(g);
    const empty = JSON.parse(JSON.stringify(g)) as GameState;
    empty.players[0].slots.action.isRevealed = false;
    empty.players[0].slots.action.card.effect = 'sabotage';
    expect(
      playAction(empty, crime, { target: 'p4' }).hiddenThreat!.players[crime]
        .points,
    ).toBe(1);
  });
  it('rejects unsupported/partial secrets and projections instead of recovering them as classic games', () => {
    const g = game();
    expect(validateSavedGame(JSON.parse(JSON.stringify(g)))).not.toBeNull();
    for (const mutate of [
      (x: GameState) => {
        x.hiddenThreat!.version = 2 as 1;
      },
      (x: GameState) => {
        delete x.hiddenThreat;
      },
      (x: GameState) => {
        delete x.hiddenThreat!.players['p4'];
      },
      (x: GameState) => {
        x.hiddenThreat!.players['p4'].points = -1;
      },
      (x: GameState) => {
        x.round = 0;
      },
    ]) {
      const broken = JSON.parse(JSON.stringify(g)) as GameState;
      mutate(broken);
      expect(validateSavedGame(broken)).toBeNull();
    }
    const projection = viewFor(g, 'p4');
    expect(validateSavedGame(projection)).toBeNull();
    const classic = createGame(
      { ...g.config, hiddenThreat: undefined },
      g.scenario,
      [CLASSIC_PACK],
    );
    expect(
      validateSavedGame(JSON.parse(JSON.stringify(classic))),
    ).not.toBeNull();
  });
  it('does not expose roles of eliminated candidates or declassified materials before final', () => {
    const g = game();
    g.players[0].isEliminated = true;
    const view = viewFor(g, 'p4');
    expect(view.hiddenThreat).toBeUndefined();
    expect(view.threatView!.final).toBeUndefined();
    expect(Object.keys(view.threatView!.mine!)).not.toContain('players');
    expect(view.threatView!.mine!.allies).toEqual([]);
    expect(
      buildChronicle(g).entries.some((e) => e.id.startsWith('declassified')),
    ).toBe(false);
    const poisoned = {
      ...view,
      threatView: {
        ...view.threatView!,
        final: threatFinal({ ...g, phase: 'final' }),
      },
    };
    expect(sanitizeView(poisoned, 'p4')!.threatView!.final).toBeUndefined();
    g.phase = 'final';
    expect(viewFor(g, 'p4').threatView!.final!.roles).toHaveLength(4);
    expect(
      buildChronicle(g).entries.some((e) => e.id === 'declassified-roles'),
    ).toBe(true);
  });
});
