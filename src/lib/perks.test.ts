import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import type { GameState, SessionConfig } from '../types';
import { createGame, nextRound, resolveVote, revealCard, startVote } from './game';
import { applyPerk, canApplyPerk, perkFor, skipPerk } from './perks';
import { updateSettings } from './settings';

const cfg = (perks = true): SessionConfig => ({
  scenarioId: CLASSIC_PACK.scenarios[0].id, packIds: [CLASSIC_PACK.id], playerCount: 4, shelterSlots: 2, mode: 'pass-and-play', voting: 'open',
  revealsPerVote: 2, timeLimitMin: 0, speechSec: 0, hazardCount: 0, difficulty: 'normal', roundEvents: false, autoActions: false, professionPerks: perks,
  names: ['А', 'Б', 'В', 'Г'], seed: 7,
});
const fresh = (perks = true) => createGame(cfg(perks), CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
/** Выдаёт игроку профессию с нужными навыками и пропускает первое вскрытие (биология). */
const withProfession = (g: GameState, id: string, tags: string[]): GameState => ({
  ...g,
  players: g.players.map((p) => (p.id === id ? { ...p, slots: { ...p.slots, profession: { ...p.slots.profession, card: { ...p.slots.profession.card, tags } } } } : p)),
});

describe('profession perks', () => {
  it('maps skills to perks and ignores professions without a matching skill', () => {
    const card = (tags?: string[]) => ({ id: 'x', category: 'profession' as const, description: 'x', ...(tags ? { tags } : {}) });
    expect(perkFor(card(['медицина']))?.kind).toBe('heal');
    expect(perkFor(card(['инженерия']))?.kind).toBe('item');
    expect(perkFor(card(['психология']))?.kind).toBe('reveal');
    expect(perkFor(card(['магия']))).toBeUndefined();
    expect(perkFor(card())).toBeUndefined();
  });

  it('does nothing when the option is off', () => {
    let g = withProfession(fresh(false), 'p1', ['медицина']);
    g = revealCard(g, 'p1', 'biology');
    expect(g.perks).toBeUndefined();
  });

  it('adds an item to the luggage of an engineer when the profession is opened', () => {
    let g = withProfession(fresh(), 'p1', ['инженерия']);
    // в 1-м раунде открывается только биология, поэтому открываем профессию напрямую через состояние 2-го вскрытия
    g = { ...g, round: 2 };
    const before = g.players[0].slots.luggage.card;
    g = revealCard(g, 'p1', 'profession');
    const after = g.players[0].slots.luggage.card;
    expect(after.description).toContain('Набор инструментов');
    expect(after.description).toContain(before.description);
    expect(after.tags).toContain('ремонт');
    expect(g.log.at(-1)!.text).toContain('Набор инструментов');
    expect(g.perks).toBeUndefined();
  });

  it('replaces an empty luggage with the item', () => {
    let g = withProfession(fresh(), 'p1', ['инженерия']);
    g = { ...g, round: 2, players: g.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, luggage: { card: { id: 'stolen-luggage', category: 'luggage' as const, description: 'Багаж украден: пусто' }, isRevealed: true } } } : p)) };
    g = revealCard(g, 'p1', 'profession');
    expect(g.players[0].slots.luggage.card.description).toBe('Набор инструментов');
  });

  it('gives a doctor a pending heal that cures another player, keeps the action card and then disappears', () => {
    let g = withProfession(fresh(), 'p1', ['медицина']);
    g = { ...g, round: 2, players: g.players.map((p) => (p.id === 'p2' ? { ...p, slots: { ...p.slots, health: { ...p.slots.health, card: { ...p.slots.health.card, modifier: 'negative' as const, description: 'Простуда' } } } } : p.id === 'p3' ? { ...p, slots: { ...p.slots, health: { ...p.slots.health, card: { ...p.slots.health.card, modifier: 'neutral' as const } } } } : p)) };
    g = revealCard(g, 'p1', 'profession');
    expect(g.perks).toEqual([{ playerId: 'p1', kind: 'heal' }]);
    expect(canApplyPerk(g, 'p1', { target: 'p3' }).ok).toBe(false); // у p3 здоровье в порядке
    expect(canApplyPerk(g, 'p1', { target: 'p1' }).ok).toBe(false); // себя нельзя
    const cured = applyPerk(g, 'p1', { target: 'p2' });
    expect(cured.players[1].slots.health.card.modifier).toBe('neutral');
    expect(cured.players[0].slots.action.isRevealed).toBe(false); // карта действия цела
    expect(cured.perks).toBeUndefined();
    expect(applyPerk(cured, 'p1', { target: 'p2' })).toBe(cured); // второй раз нельзя
  });

  it('lets a spy steal luggage, and a skipped perk is simply dropped', () => {
    let g = withProfession(fresh(), 'p1', ['шпионаж']);
    g = { ...g, round: 2 };
    g = revealCard(g, 'p1', 'profession');
    expect(g.perks?.[0].kind).toBe('steal');
    const victimLuggage = g.players[1].slots.luggage.card.id;
    const stolen = applyPerk(g, 'p1', { target: 'p2' });
    expect(stolen.players[0].slots.luggage.card.id).toBe(victimLuggage);
    expect(stolen.players[0].slots.action.isRevealed).toBe(false);
    expect(skipPerk(g, 'p1').perks).toBeUndefined();
  });

  it('unused perks burn at the end of the vote and never reach the next round', () => {
    let g = withProfession(fresh(), 'p1', ['психология']);
    g = { ...g, round: 2 };
    g = revealCard(g, 'p1', 'profession');
    expect(g.perks).toHaveLength(1);
    const voting = startVote({ ...g, phase: 'vote', votes: {} });
    expect(voting.perks).toHaveLength(1); // голосование идёт — бонус ещё можно применить
    const done = resolveVote({ ...voting, votes: { p1: 'p4', p2: 'p4', p3: 'p4', p4: 'p1' } });
    expect(done.perks).toBeUndefined();
    expect(nextRound({ ...done, perks: [{ playerId: 'p1', kind: 'reveal' }] }).perks).toBeUndefined();
  });

  it('works in other languages: the item keeps both parts translatable', () => {
    updateSettings({ lang: 'ru' });
    const g = revealCard({ ...withProfession(fresh(), 'p1', ['инженерия']), round: 2 }, 'p1', 'profession');
    expect(g.players[0].slots.luggage.card.description).toMatch(/ \+ Набор инструментов$/);
  });
});
