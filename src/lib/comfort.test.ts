import { describe, expect, it } from 'vitest';
import { BUILTIN_PACKS } from '../data/classicPack';
import { buildQuickGame, defaultAutoActions, parseLastSetup, replayGame } from './quick';
import { DEFAULT_SETTINGS, parseSettings } from './settings';
import { revealCard, currentSpeaker } from './game';

describe('settings', () => {
  it('falls back to defaults and drops junk', () => {
    // Язык без сохранения берётся из браузера, поэтому его не сравниваем с константой.
    const { lang: _lang, ...rest } = DEFAULT_SETTINGS;
    expect(parseSettings(null)).toMatchObject(rest);
    expect(parseSettings({ sound: 'yes', theme: 'neon', textSize: 'huge', evil: 1 })).toMatchObject(rest);
    expect(parseSettings({ sound: false, theme: 'light', textSize: 'xl' })).toMatchObject({ sound: false, theme: 'light', textSize: 'xl', vibrate: true });
    expect(parseSettings({ lang: 'de' }).lang).toBe('de');
    expect(parseSettings({ lang: 'fr' }).lang).not.toBe('fr');
  });
});

describe('quick game and replay', () => {
  it('quick game works with no history', () => {
    const g = buildQuickGame(BUILTIN_PACKS, null)!;
    expect(g.players).toHaveLength(6);
    expect(g.config.mode).toBe('pass-and-play');
    expect(g.players[0].name).toBe('Игрок 1');
  });

  it('enables action effects by default in pass-and-play, including quick games', () => {
    expect(defaultAutoActions('pass-and-play', null)).toBe(true);
    expect(defaultAutoActions('online', null)).toBe(false);
    expect(defaultAutoActions('tabletop', null)).toBe(false);
    expect(buildQuickGame(BUILTIN_PACKS, null)!.config.autoActions).toBe(true);
  });

  it('migrates legacy false defaults but remembers explicit choices', () => {
    const legacy = parseLastSetup({ packIds: ['classic'], autoActions: false })!;
    expect(legacy.autoActionsExplicit).toBe(false);
    expect(defaultAutoActions('pass-and-play', legacy)).toBe(true);
    expect(defaultAutoActions('online', legacy)).toBe(false);
    expect(buildQuickGame(BUILTIN_PACKS, legacy)!.config.autoActions).toBe(true);

    const disabled = parseLastSetup({ packIds: ['classic'], autoActions: false, autoActionsExplicit: true })!;
    expect(defaultAutoActions('pass-and-play', disabled)).toBe(false);
    expect(buildQuickGame(BUILTIN_PACKS, disabled)!.config.autoActions).toBe(false);

    const enabled = parseLastSetup({ packIds: ['classic'], autoActions: true, autoActionsExplicit: true })!;
    expect(defaultAutoActions('online', enabled)).toBe(true);
    expect(defaultAutoActions('tabletop', enabled)).toBe(false);
    expect(buildQuickGame(BUILTIN_PACKS, enabled)!.config.autoActions).toBe(true);
  });

  it('quick game reuses last names and settings, and never pulls in an adult pack without confirmation', () => {
    const adult = BUILTIN_PACKS.find((p) => p.adult)!;
    const last = parseLastSetup({ packIds: [adult.id], n: 3, k: 1, names: ['Аня', 'Боб', 'Ви'], difficulty: 'hard', voting: 'open', revealsPerVote: 1, speechSec: 30, timeLimitMin: 20, hazardCount: 1, roundEvents: true, scenarioId: 'random' })!;
    const g = buildQuickGame(BUILTIN_PACKS, last)!;
    expect(g.config.names).toEqual(['Аня', 'Боб', 'Ви']);
    expect(g.config.difficulty).toBe('hard');
    expect(g.config.voting).toBe('open');
    // подтверждения 18+ в тестовой среде нет, поэтому вместо 18+ берётся первый безопасный пак
    expect(g.config.packIds).not.toContain(adult.id);
  });

  it('rejects broken saved setups', () => {
    expect(parseLastSetup(null)).toBeNull();
    expect(parseLastSetup({ packIds: [] })).toBeNull();
    const ok = parseLastSetup({ packIds: ['x'], n: 999, k: -3, difficulty: 'boom', names: [1, 'ок'] })!;
    expect(ok.n).toBeLessThanOrEqual(20);
    expect(ok.k).toBeGreaterThanOrEqual(1);
    expect(ok.difficulty).toBe('normal');
    expect(ok.names).toEqual(['', 'ок']);
  });

  it('replay keeps players, scenario and settings but deals new cards', () => {
    const g = buildQuickGame(BUILTIN_PACKS, null)!;
    const again = replayGame(g, BUILTIN_PACKS)!;
    expect(again.config.names).toEqual(g.config.names);
    expect(again.scenario.id).toBe(g.scenario.id);
    expect(again.config.seed).not.toBe(g.config.seed);
    expect(again.round).toBe(1);
    expect(again.players.every((p) => !p.isEliminated)).toBe(true);
  });

  it('a reveal can be undone by restoring the previous snapshot (no hidden shared state)', () => {
    const g = buildQuickGame(BUILTIN_PACKS, null)!;
    const speaker = currentSpeaker(g)!;
    const after = revealCard(g, speaker.id, 'biology');
    expect(after.players.find((p) => p.id === speaker.id)!.slots.biology.isRevealed).toBe(true);
    expect(g.players.find((p) => p.id === speaker.id)!.slots.biology.isRevealed).toBe(false);
  });
});
