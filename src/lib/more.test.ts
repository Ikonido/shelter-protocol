import { describe, expect, it } from 'vitest';
import { BUILTIN_PACKS } from '../data/classicPack';
import { filterCards } from './cardFilter';
import { buildQuickGame } from './quick';
import { resultCard } from './shareResult';
import { TOUR } from '../ui/Onboarding';

describe('editor search', () => {
  const cards = BUILTIN_PACKS[0].cards.profession;
  it('finds by text, title and tags, ignoring case and ё', () => {
    expect(filterCards(cards, '')).toHaveLength(cards.length);
    const withTag = cards.find((c) => c.tags?.length)!;
    expect(filterCards(cards, withTag.tags![0].toUpperCase()).length).toBeGreaterThan(0);
    expect(filterCards(cards, withTag.description.slice(0, 6)).some((c) => c.id === withTag.id)).toBe(true);
    expect(filterCards(cards, 'такого-текста-нет-нигде')).toEqual([]);
  });
  it('treats ё and е the same', () => {
    const c = [{ id: 'x', category: 'fact' as const, description: 'Всё хорошо' }];
    expect(filterCards(c, 'все')).toHaveLength(1);
  });
});

describe('share card', () => {
  it('contains only public information (names of survivors, threats, score)', () => {
    const g = buildQuickGame(BUILTIN_PACKS, null)!;
    const card = resultCard(g);
    expect(card.survivors).toHaveLength(g.players.filter((p) => !p.isEliminated).length);
    expect(['survived', 'fragile', 'failed']).toContain(card.verdict);
    expect(card.score).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(card)).not.toMatch(/seed/);
  });
});

describe('tour', () => {
  it('has five short steps', () => {
    expect(TOUR).toHaveLength(5);
    for (const s of TOUR) expect(s.text.length).toBeLessThan(330);
  });
});
