import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import type { GameState, SessionConfig } from '../types';
import { createGame, nextRound, resolveVote, revealCard, startVote } from './game';
import { itemsOf } from './inventory';
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

  const doctorGame = (level: 'novice' | 'experienced' | 'expert', seed = 7) => {
    let g = withProfession({ ...fresh(), seed }, 'p1', ['медицина']);
    g = { ...g, round: 2, players: g.players.map((p) => (p.id === 'p2' ? { ...p, slots: { ...p.slots, health: { ...p.slots.health, card: { ...p.slots.health.card, modifier: 'negative' as const, description: 'Простуда' } } } } : p.id === 'p3' ? { ...p, slots: { ...p.slots, health: { ...p.slots.health, card: { ...p.slots.health.card, modifier: 'neutral' as const } } } } : p)) };
    g = revealCard(g, 'p1', 'profession');
    return { ...g, perks: [{ playerId: 'p1', kind: 'heal' as const, level }] };
  };

  it('gives a doctor a random experience level with a pending heal that keeps the action card', () => {
    const levels = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      let g = withProfession({ ...fresh(), seed }, 'p1', ['медицина']);
      g = revealCard({ ...g, round: 2 }, 'p1', 'profession');
      expect(g.perks).toHaveLength(1);
      expect(g.perks![0].kind).toBe('heal');
      levels.add(g.perks![0].level!);
    }
    expect([...levels].sort()).toEqual(['experienced', 'expert', 'novice']);
  });

  it('an expert always cures a sick player; the result is private and the public log does not reveal it', () => {
    const g = doctorGame('expert');
    expect(canApplyPerk(g, 'p1', { target: 'p3' }).ok).toBe(true); // здоровых тоже можно выбрать: меню не выдаёт больных
    expect(canApplyPerk(g, 'p1', { target: 'p1' }).ok).toBe(false); // себя нельзя
    const cured = applyPerk(g, 'p1', { target: 'p2' });
    expect(cured.players[1].slots.health.card.modifier).toBe('neutral');
    expect(cured.players[0].slots.action.isRevealed).toBe(false); // карта действия цела
    expect(cured.perks).toBeUndefined();
    expect(cured.perkResult).toMatchObject({ playerId: 'p1' });
    expect(cured.perkResult!.text).toContain('Лечение удалось');
    expect(cured.log.at(-1)!.text).not.toMatch(/вылечен|удалось|здоров/);
    const healthy = applyPerk(g, 'p1', { target: 'p3' });
    expect(healthy.perkResult!.text).toContain('Лечить было нечего');
    expect(applyPerk(cured, 'p1', { target: 'p2' })).toBe(cured); // второй раз нельзя
  });

  it('a novice sometimes fails and an expert never does', () => {
    let novice = 0, experts = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = applyPerk(doctorGame('novice', seed), 'p1', { target: 'p2' });
      if (r.perkResult!.text.includes('удалось')) novice++;
      const e = applyPerk(doctorGame('expert', seed), 'p1', { target: 'p2' });
      if (e.perkResult!.text.includes('удалось')) experts++;
    }
    expect(experts).toBe(40);
    expect(novice).toBeGreaterThan(5);
    expect(novice).toBeLessThan(35);
  });

  it('lets a spy steal luggage, and a skipped perk is simply dropped', () => {
    let g = withProfession(fresh(), 'p1', ['шпионаж']);
    g = { ...g, round: 2 };
    g = revealCard(g, 'p1', 'profession');
    expect(g.perks?.[0].kind).toBe('steal');
    const victimItems = itemsOf(g.players[1].slots.luggage.card).map((c) => c.id);
    const stolen = applyPerk(g, 'p1', { target: 'p2' });
    expect(itemsOf(stolen.players[0].slots.luggage.card).some((c) => victimItems.includes(c.id))).toBe(true);
    expect(stolen.players[0].slots.action.isRevealed).toBe(false);
    expect(skipPerk(g, 'p1').perks).toBeUndefined();
  });

  it('a detective opens a chosen hidden card of a chosen player', () => {
    let g = withProfession(fresh(), 'p1', ['расследование', 'безопасность']);
    g = { ...g, round: 2 };
    g = revealCard(g, 'p1', 'profession');
    expect(g.perks).toEqual([{ playerId: 'p1', kind: 'reveal' }]);
    expect(canApplyPerk(g, 'p1', { target: 'p2' }).ok).toBe(false); // не выбрана карта
    expect(g.players[1].slots.fact.isRevealed).toBe(false);
    const done = applyPerk(g, 'p1', { target: 'p2', category: 'fact' });
    expect(done.players[1].slots.fact.isRevealed).toBe(true);
    expect(done.perks).toBeUndefined();
    expect(done.players[0].slots.action.isRevealed).toBe(false);
  });

  it('the classic pack has the detective profession with the investigation skill', () => {
    const d = CLASSIC_PACK.cards.profession.find((c) => c.description === 'Детектив')!;
    expect(d.tags).toContain('расследование');
    expect(perkFor(d)?.kind).toBe('reveal');
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
