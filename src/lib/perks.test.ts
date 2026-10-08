import { describe, expect, it } from 'vitest';
import { CLASSIC_PACK } from '../data/classicPack';
import type { GameState, SessionConfig } from '../types';
import { createGame, nextRound, playAction, resolveVote, revealCard, startVote } from './game';
import { composeItems, itemsOf } from './inventory';
import { t } from './i18n';
import { BUILTIN_PACKS as BUILT } from '../data/classicPack';
import { applyPerk, canApplyPerk, onSkillRevealed, perkFor, skipPerk } from './perks';
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

  const POOL = ['Набор инструментов', 'Сварочный аппарат', 'Ящик запчастей'];
  const LEVEL_RANGE: Record<string, [number, number]> = { новичок: [1, 1], опытный: [1, 2], эксперт: [2, 3] };

  it('an engineer gets 1–3 random distinct items from the profession pool, the count depends on experience', () => {
    const seen = new Map<string, Set<number>>();
    const names = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      let g = withProfession({ ...fresh(), seed }, 'p1', ['инженерия']);
      // у игрока ровно один исходный предмет
      g = { ...g, round: 2, players: g.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: itemsOf(p.slots.luggage.card)[0] } } } : p)) };
      const before = itemsOf(g.players[0].slots.luggage.card);
      g = revealCard(g, 'p1', 'profession');
      const after = itemsOf(g.players[0].slots.luggage.card);
      const added = after.filter((c) => !before.some((b) => b.id === c.id));
      expect(added.length).toBeGreaterThanOrEqual(1);
      expect(added.length).toBeLessThanOrEqual(3);
      expect(new Set(added.map((c) => c.description)).size).toBe(added.length); // без повторов
      for (const c of added) { expect(POOL).toContain(c.description); expect(c.tags).toContain('ремонт'); names.add(c.description); }
      const level = Object.keys(LEVEL_RANGE).find((l) => g.log.at(-1)!.text.includes(`(${l})`))!;
      expect(level, g.log.at(-1)!.text).toBeTruthy();
      expect(added.length).toBeGreaterThanOrEqual(LEVEL_RANGE[level][0]);
      expect(added.length).toBeLessThanOrEqual(LEVEL_RANGE[level][1]);
      (seen.get(level) ?? seen.set(level, new Set()).get(level)!).add(added.length);
      expect(g.perks).toBeUndefined();
    }
    expect([...(seen.get('эксперт') ?? [])].sort()).toEqual([2, 3]); // у эксперта бывает и два, и три
    expect(names.size).toBe(3); // из пула выпадают разные предметы
  });

  it('an item perk fills an empty luggage without the stolen placeholder', () => {
    let g = withProfession(fresh(), 'p1', ['инженерия']);
    g = { ...g, round: 2, players: g.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, luggage: { card: { id: 'stolen-luggage', category: 'luggage' as const, description: 'Багаж украден: пусто' }, isRevealed: true } } } : p)) };
    g = revealCard(g, 'p1', 'profession');
    const desc = g.players[0].slots.luggage.card.description;
    expect(desc).not.toContain('украден');
    expect(desc.split(' + ').every((d) => POOL.includes(d))).toBe(true);
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
    expect(canApplyPerk(g, 'p1', { target: 'p1' }).ok).toBe(true); // врач может лечить себя
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

  it('a detective always opens the chosen card and, by experience, up to two more hidden cards of that player', () => {
    const hiddenCount = (g: GameState) => Object.values(g.players[1].slots).filter((x) => !x.isRevealed).length;
    const run = (level: 'novice' | 'experienced' | 'expert', seed: number) => {
      let g = withProfession({ ...fresh(), seed }, 'p1', ['расследование']);
      g = { ...g, round: 2 };
      g = { ...revealCard(g, 'p1', 'profession'), perks: [{ playerId: 'p1', kind: 'reveal' as const, level }] };
      const before = hiddenCount(g);
      const done = applyPerk(g, 'p1', { target: 'p2', category: 'fact' });
      return { g, done, opened: before - hiddenCount(done) };
    };
    const base = run('novice', 1);
    expect(canApplyPerk(base.g, 'p1', { target: 'p2' }).ok).toBe(false); // не выбрана карта
    expect(base.done.players[1].slots.fact.isRevealed).toBe(true);
    expect(base.done.perks).toBeUndefined();
    expect(base.done.players[0].slots.action.isRevealed).toBe(false);
    const counts = (level: 'novice' | 'experienced' | 'expert') => new Set(Array.from({ length: 60 }, (_, i) => run(level, i + 1).opened));
    expect([...counts('novice')]).toEqual([1]);
    expect([...counts('experienced')].sort()).toEqual([1, 2]);
    expect([...counts('expert')].sort()).toEqual([2, 3]);
  });

  it('a spy steals one to three items depending on experience, never more than the victim has', () => {
    const run = (level: 'novice' | 'experienced' | 'expert', seed: number, victimItems: number) => {
      let g = withProfession({ ...fresh(), seed }, 'p1', ['шпионаж']);
      const stock = Array.from({ length: victimItems }, (_, i) => ({ id: `v${i}`, category: 'luggage' as const, description: `Вещь ${i}` }));
      g = { ...g, players: g.players.map((p) => (p.id === 'p2' ? { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: composeItems(stock, () => p.slots.luggage.card) } } } : p.id === 'p1' ? { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: p.slots.luggage.card } } } : p)), perks: [{ playerId: 'p1', kind: 'steal' as const, level }] };
      const done = applyPerk(g, 'p1', { target: 'p2' });
      return victimItems - itemsOf(done.players[1].slots.luggage.card).length;
    };
    expect(new Set(Array.from({ length: 60 }, (_, i) => run('novice', i + 1, 4)))).toEqual(new Set([1]));
    expect([...new Set(Array.from({ length: 60 }, (_, i) => run('expert', i + 1, 4)))].sort()).toEqual([2, 3]);
    expect(run('expert', 5, 1)).toBe(1); // у жертвы всего один предмет
  });

  it('a forced reveal of a profession still gives its owner the bonus', () => {
    const cfg2 = { ...cfg(true), autoActions: true };
    let g = createGame(cfg2, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
    g = withProfession(g, 'p2', ['инженерия']);
    g = { ...g, players: g.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, action: { card: { ...p.slots.action.card, title: 'Допрос', effect: 'forceReveal' as const }, isRevealed: false } } } : p)) };
    const before = itemsOf(g.players[1].slots.luggage.card).length;
    const done = playAction(g, 'p1', { target: 'p2', category: 'profession' });
    expect(done.players[1].slots.profession.isRevealed).toBe(true);
    expect(itemsOf(done.players[1].slots.luggage.card).length).toBeGreaterThan(before);
    // карты, которые не профессия, бонуса не дают
    const other = playAction(g, 'p1', { target: 'p2', category: 'fact' });
    expect(itemsOf(other.players[1].slots.luggage.card).length).toBe(before);
  });

  it('a detective opening a profession gives that player a bonus too', () => {
    let g = withProfession(fresh(), 'p1', ['расследование']);
    g = withProfession(g, 'p2', ['медицина']);
    g = { ...g, round: 2 };
    g = { ...revealCard(g, 'p1', 'profession'), perks: [{ playerId: 'p1', kind: 'reveal' as const, level: 'novice' as const }] };
    const done = applyPerk(g, 'p1', { target: 'p2', category: 'profession' });
    expect(done.perks?.map((x) => x.playerId)).toEqual(['p2']); // бонус детектива потрачен, у врача p2 появился свой
    expect(done.perks![0].kind).toBe('heal');
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

  it('a composite luggage stays translatable part by part', () => {
    let g = withProfession(fresh(), 'p1', ['инженерия']);
    g = revealCard({ ...g, round: 2 }, 'p1', 'profession');
    const desc = g.players[0].slots.luggage.card.description;
    expect(desc).toContain(' + ');
    updateSettings({ lang: 'en' });
    const shown = t(desc);
    updateSettings({ lang: 'ru' });
    expect(shown).not.toMatch(/[А-Яа-яЁё]{4,} \+ /); // части переведены, а не склеены по-русски целиком
  });

  it('a doctor healing himself re-rolls his health into a random condition from the deck, which can be worse', () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      // колода собирается из seed конфигурации, поэтому меняем именно её
      let g = createGame({ ...cfg(true), seed }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);
      g = withProfession(g, 'p1', ['медицина']);
      g = { ...g, round: 2, perks: [{ playerId: 'p1', kind: 'heal', level: 'expert' }], players: g.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, health: { ...p.slots.health, card: { ...p.slots.health.card, modifier: 'negative' as const, description: 'Перелом' } } } } : p)) };
      expect(canApplyPerk(g, 'p1', { target: 'p1' }).ok).toBe(true);
      const r = applyPerk(g, 'p1', { target: 'p1' });
      expect(r.perks).toBeUndefined();
      const health = r.players[0].slots.health.card;
      expect(health.description).not.toBe('Перелом');
      expect(r.perkResult?.playerId).toBe('p1');
      expect(r.perkResult!.text).toContain('Самолечение');
      expect(r.perkResult!.text).toContain(health.description);
      outcomes.add(health.modifier ?? 'none');
    }
    // исход случайный: бывают и худшие состояния, и лучшие
    expect(outcomes.has('negative')).toBe(true);
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('self-healing is refused when the condition deck is empty', () => {
    let g = doctorGame('expert', 3);
    g = { ...g, deck: { ...g.deck, health: [] }, discard: { ...g.discard, health: [] } };
    expect(canApplyPerk(g, 'p1', { target: 'p1' }).ok).toBe(false);
  });

  it('a hobby or fact with a skill gives a bonus on reveal, one bonus at a time', () => {
    let g = withProfession(fresh(), 'p1', ['шпионаж']);
    g = { ...g, round: 2, players: g.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, hobby: { ...p.slots.hobby, card: { ...p.slots.hobby.card, tags: ['расследование'] } } } } : p)) };
    g = revealCard(g, 'p1', 'hobby');
    expect(g.perks).toEqual([expect.objectContaining({ playerId: 'p1', kind: 'reveal' })]);
    // второй навык не заменяет неиспользованный бонус
    g = { ...g, perks: [{ playerId: 'p1', kind: 'steal', level: 'novice' }] };
    const again = onSkillRevealed(g, 'p1', 'fact');
    expect(again.perks).toEqual([{ playerId: 'p1', kind: 'steal', level: 'novice' }]);
  });

  it('the fifteen professions without skills each get their own bonus', () => {
    const names = ['Видеоблогер-инфлюенсер', 'Сомелье', 'Придворный астролог', 'Безработный герой', 'Мастер маникюра', 'Сборщик налогов', 'Торговец поддельными реликвиями', 'Королевский шут', 'Придворный фокусник', 'Блогер-«эксперт по жизни»', 'Коуч по «поиску себя»', 'Менеджер по продажам'];
    for (const n of names) {
      const card = BUILT.flatMap((p) => p.cards.profession).find((c) => c.description === n)!;
      expect(card, n).toBeDefined();
      expect(perkFor({ ...card, tags: [] }), n).toBeDefined();
    }
  });

  it('a sommelier gets wine and cheese, an unemployed hero a sword, at once', () => {
    let g = withProfession(fresh(), 'p1', []);
    g = { ...g, round: 2, players: g.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, profession: { ...p.slots.profession, card: { ...p.slots.profession.card, description: 'Сомелье', tags: [] } } } } : p)) };
    g = revealCard(g, 'p1', 'profession');
    const names = itemsOf(g.players[0].slots.luggage.card).map((c) => c.description);
    expect(names).toEqual(expect.arrayContaining(['5 бутылок вина', 'Кусок сыра']));
    expect(g.perks).toBeUndefined();
  });

  it('a merchant steals one item and leaves a useless figurine behind', () => {
    let g = withProfession(fresh(), 'p1', []);
    g = { ...g, round: 2, players: g.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, profession: { ...p.slots.profession, card: { ...p.slots.profession.card, description: 'Торговец поддельными реликвиями', tags: [] } } } } : p)) };
    g = { ...g, players: g.players.map((p) => (p.id === 'p2' ? { ...p, slots: { ...p.slots, luggage: { ...p.slots.luggage, card: composeItems([{ id: 'x', category: 'luggage', description: 'Ценность' }, { id: 'y', category: 'luggage', description: 'Хлам' }], () => p.slots.luggage.card) } } } : p)) };
    g = revealCard(g, 'p1', 'profession');
    expect(g.perks).toEqual([expect.objectContaining({ playerId: 'p1', kind: 'steal_junk' })]);
    const done = applyPerk(g, 'p1', { target: 'p2' });
    const victim = itemsOf(done.players[1].slots.luggage.card).map((c) => c.description);
    expect(victim).toContain('Бесполезная статуэтка');
    expect(victim.length).toBe(2); // украли один, подбросили одну статуэтку
  });

  it('a royal jester is immune for the round without choosing anyone', () => {
    let g = withProfession(fresh(), 'p1', []);
    g = { ...g, round: 2, players: g.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, profession: { ...p.slots.profession, card: { ...p.slots.profession.card, description: 'Королевский шут', tags: [] } } } } : p)) };
    g = revealCard(g, 'p1', 'profession');
    expect(g.perks?.[0].kind).toBe('immunity');
    const done = applyPerk(g, 'p1', {});
    expect(done.fx?.immune).toContain('p1');
    expect(done.perks).toBeUndefined();
  });

  it('a court magician re-rolls another player’s health, never his own', () => {
    let g = withProfession(fresh(), 'p1', []);
    g = { ...g, round: 2, perks: [{ playerId: 'p1', kind: 'reroll_health', level: 'novice' }] };
    expect(canApplyPerk(g, 'p1', { target: 'p1' }).ok).toBe(false);
    const before = g.players[1].slots.health.card.id;
    const done = applyPerk(g, 'p1', { target: 'p2' });
    expect(done.players[1].slots.health.card.id).not.toBe(before);
    expect(done.perks).toBeUndefined();
  });

  const sixGame = (slots = 2) => createGame({ ...cfg(true), playerCount: 6, shelterSlots: slots, names: ['A', 'B', 'C', 'D', 'E', 'F'], seed: 11 }, CLASSIC_PACK.scenarios[0], [CLASSIC_PACK]);

  it('a lawyer links two other players; they leave together, but only while the shelter keeps enough places', () => {
    let g = sixGame(2);
    g = { ...g, round: 1, schedule: [1], perks: [{ playerId: 'p1', kind: 'bond', level: 'novice' }] };
    expect(canApplyPerk(g, 'p1', { target: 'p2', target2: 'p1' }).ok).toBe(false); // сам себя нельзя
    expect(canApplyPerk(g, 'p1', { target: 'p2' }).ok).toBe(false); // нужны двое
    expect(canApplyPerk(g, 'p1', { target: 'p2', target2: 'p3' }).ok).toBe(true);
    const bound = applyPerk(g, 'p1', { target: 'p2', target2: 'p3' });
    expect(bound.bonds).toEqual([{ a: 'p2', b: 'p3', votes: 2 }]);
    expect(bound.perks).toBeUndefined();
    // голосование: выгоняют p2 — вместе с ним уходит p3
    let v: GameState = { ...bound, phase: 'vote', votes: { p1: 'p2', p2: 'p2', p3: 'p2', p4: 'p2', p5: 'p2', p6: 'p2' } };
    v = resolveVote(v);
    expect(v.lastResult!.eliminated.sort()).toEqual(['p2', 'p3']);
    expect(v.bonds).toEqual([{ a: 'p2', b: 'p3', votes: 1 }]); // срок: второе голосование
    // мест мало: связь не работает
    const crowded = sixGame(5);
    expect(canApplyPerk({ ...crowded, perks: [{ playerId: 'p1', kind: 'bond', level: 'novice' }] }, 'p1', { target: 'p2', target2: 'p3' }).ok).toBe(false);
  });

  it('a bond ends after two votes', () => {
    let g: GameState = sixGame(2);
    g = { ...g, round: 1, schedule: [0, 0, 0], bonds: [{ a: 'p2', b: 'p3', votes: 1 }], phase: 'vote', votes: { p1: 'p4', p2: 'p4', p3: 'p4', p4: 'p5', p5: 'p5', p6: 'p5' } };
    const after = resolveVote(g as GameState);
    expect(after.bonds).toBeUndefined();
  });

  it('a middle manager’s vote counts double only once someone has been expelled', () => {
    let g = sixGame(2);
    g = { ...g, perks: [{ playerId: 'p1', kind: 'double', level: 'novice' }] };
    expect(canApplyPerk(g, 'p1', {}).ok).toBe(false);
    expect(applyPerk(g, 'p1', {})).toBe(g);
    const withExpelled = { ...g, players: g.players.map((p) => (p.id === 'p6' ? { ...p, isEliminated: true } : p)) };
    expect(canApplyPerk(withExpelled, 'p1', {}).ok).toBe(true);
    const done = applyPerk(withExpelled, 'p1', {});
    expect(done.fx?.double).toEqual(['p1']);
    expect(done.perks).toBeUndefined();
  });

  it('a potion seller can use his skill bonus a second time', () => {
    let g = withProfession(sixGame(2), 'p1', []);
    g = { ...g, round: 2, players: g.players.map((p) => (p.id === 'p1' ? { ...p, slots: { ...p.slots, profession: { ...p.slots.profession, card: { ...p.slots.profession.card, description: 'Продавец «зелий бодрости»', tags: [] } }, hobby: { ...p.slots.hobby, card: { ...p.slots.hobby.card, tags: ['расследование'] } } } } : p)) };
    g = revealCard(g, 'p1', 'hobby');
    expect(g.perks?.[0]).toMatchObject({ kind: 'reveal', charges: 2 });
    const once = applyPerk(g, 'p1', { target: 'p2', category: 'fact' });
    expect(once.perks?.[0]).toMatchObject({ playerId: 'p1', charges: 1 });
    const twice = applyPerk(once, 'p1', { target: 'p3', category: 'fact' });
    expect(twice.perks).toBeUndefined();
  });
});
