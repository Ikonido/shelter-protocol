import { plural, t } from './i18n';
import type { GameState, PlayerCharacter } from '../types';
import { evaluate, type Evaluation } from './evaluate';
import { mulberry32, shuffle } from './rng';

export type ChronicleTone = 'ok' | 'bad' | 'warn' | 'neutral';
export type ChronicleIcon = 'door' | 'hazard' | 'skill' | 'crowd' | 'health' | 'end';

export interface ChronicleEntry {
  id: string;
  /** «Через 3 месяца», «День 1»… */
  when: string;
  title: string;
  text: string;
  tone: ChronicleTone;
  icon: ChronicleIcon;
  /** Печать результата: «УГРОЗА СНЯТА», «ГИБЕЛЬ». */
  stamp?: string;
}

export interface Chronicle {
  entries: ChronicleEntry[];
  epilogue: string[];
  evaluation: Evaluation;
  /** Хроника оборвалась смертельной угрозой. */
  fatal: boolean;
}

export { plural } from './i18n';

const DAYS_PER_MONTH = 30.4375;

/** «5 лет» → 1826 дней, «2 недели» → 14, «10 дней» → 10, «18 месяцев» → 548; непонятное → 3 года. */
export function isolationDays(duration: string): number {
  // Русские и украинские единицы: «5 лет», «3 роки», «2 місяці», «10 днів».
  const m = /(\d+)\s*(лет|год|мес|недел|дн|сут|років|рок|місяц|тижн|днів|дні|доб)/i.exec(duration);
  if (!m) return Math.round(36 * DAYS_PER_MONTH);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const years = ['лет', 'год', 'років', 'рок'];
  const months = ['мес', 'місяц'];
  const weeks = ['недел', 'тижн'];
  const days = months.some((u) => unit.startsWith(u)) ? n * DAYS_PER_MONTH : years.includes(unit) ? n * 12 * DAYS_PER_MONTH : weeks.some((u) => unit.startsWith(u)) ? n * 7 : n;
  return Math.max(1, Math.round(days));
}

/** Подпись момента на шкале: «День 1», «Через 3 дня», «Через 2 недели», «Через 3 месяца», «Через 2 года и 6 месяцев». */
export function whenLabel(day: number): string {
  if (day <= 0) return t('День 1');
  if (day < 14) return t('Через {n} {unit}', { n: day, unit: plural(day, ['день', 'дня', 'дней'], ['день', 'дні', 'днів']) });
  if (day < 60) {
    const w = Math.round(day / 7);
    return t('Через {n} {unit}', { n: w, unit: plural(w, ['неделю', 'недели', 'недель'], ['тиждень', 'тижні', 'тижнів']) });
  }
  const months = Math.round(day / DAYS_PER_MONTH);
  if (months < 12) return t('Через {n} {unit}', { n: months, unit: plural(months, ['месяц', 'месяца', 'месяцев'], ['місяць', 'місяці', 'місяців']) });
  const y = Math.floor(months / 12);
  const rest = months % 12;
  const yUnit = plural(y, ['год', 'года', 'лет'], ['рік', 'роки', 'років']);
  if (!rest) return t('Через {n} {unit}', { n: y, unit: yUnit });
  return t('Через {y} {yUnit} и {m} {mUnit}', { y, yUnit, m: rest, mUnit: plural(rest, ['месяц', 'месяца', 'месяцев'], ['місяць', 'місяці', 'місяців']) });
}

const clipText = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const list = (items: string[]) => (items.length <= 1 ? items.join('') : t('{head} и {last}', { head: items.slice(0, -1).join(', '), last: items[items.length - 1] }));
const hash = (s: string) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

function who(via: { name: string; card: string }[], need = 1): string {
  return list(via.slice(0, Math.max(1, need)).map((v) => `${v.name} («${clipText(v.card)}»)`));
}

/**
 * Хроника изоляции: по очереди «проигрывает» проверки убежища — угрозы, нехватку навыков, тесноту, болезни —
 * и заканчивается эпилогом. Всё считается из данных партии, без ИИ и сервера; результат детерминирован,
 * поэтому у всех онлайн-игроков хроника одинакова.
 */
export function buildChronicle(game: GameState): Chronicle {
  const survivors = game.players.filter((p) => !p.isEliminated);
  const outside = game.players.filter((p) => p.isEliminated);
  const slots = game.config.shelterSlots;
  const ev = evaluate(game.scenario, survivors, slots, game.hazards ?? [], game.config.difficulty);
  const rng = mulberry32(hash(game.scenario.id + game.players.map((p) => p.name).join('|')));
  const total = isolationDays(game.scenario.isolationDuration);
  const isolation = game.scenario.isolationDuration || t('долгий срок');

  type Draft = Omit<ChronicleEntry, 'when'>;
  const middle: Draft[] = [];
  let fatalEntry: Draft | null = null;

  for (const r of ev.hazards) {
    const h = r.hazard;
    if (r.ok) {
      const text = h.onSuccess
        ? h.onSuccess.replaceAll('{who}', who(r.via, r.need))
        : t('{who} берётся за дело — угроза «{title}» снята.', { who: who(r.via, r.need), title: h.title });
      middle.push({ id: `hz-${h.id}`, title: h.title, text, tone: 'ok', icon: 'hazard', stamp: t('УГРОЗА СНЯТА') });
    } else {
      const lack = r.via.length
        ? ` ${t('Нужно {n} {people}, а есть только {have}.', { n: r.need, people: plural(r.need, ['человек', 'человека', 'человек'], ['людина', 'людини', 'людей']), have: r.via.length })}`
        : '';
      const base = h.onFail ?? t('Угроза «{title}» не остановлена: {desc}.', { title: h.title, desc: h.description || t('никто не знал, что с ней делать') });
      const deadly = h.severity === 'critical';
      const draft: Draft = { id: `hz-${h.id}`, title: h.title, text: base + lack, tone: 'bad', icon: 'hazard', stamp: deadly ? t('СМЕРТЕЛЬНО') : t('ПРОВАЛ') };
      if (deadly && ev.fatal && !fatalEntry) {
        fatalEntry = { ...draft, title: t('{title} — конец', { title: h.title }), text: t('{base}{lack} Убежище не выдерживает.', { base, lack }), stamp: t('ГИБЕЛЬ'), icon: 'end' };
      } else middle.push(draft);
    }
  }

  const missing = ev.coverage.filter((c) => c.by.length === 0).slice(0, 2);
  for (const c of missing) {
    middle.push({
      id: `sk-${c.skill}`,
      title: t('Нет навыка: {skill}', { skill: c.skill }),
      text: t('Колонии нужен навык «{skill}», но среди выживших никто им не владеет. Приходится действовать наугад — и платить за ошибки.', { skill: c.skill }),
      tone: 'warn',
      icon: 'skill',
    });
  }
  const covered = ev.coverage.filter((c) => c.by.length > 0).slice(0, 2);
  for (const c of covered) {
    middle.push({
      id: `sk-${c.skill}`,
      title: t('Навык: {skill}', { skill: c.skill }),
      text: t('{who} закрывает вопрос «{skill}» — колония получает то, без чего долго не протянуть.', { who: c.by[0], skill: c.skill }),
      tone: 'ok',
      icon: 'skill',
    });
  }
  if (slots && survivors.length > slots) {
    middle.push({
      id: 'crowd',
      title: t('В бункере тесно'),
      text: t('{n} {people} на {slots} {places}: еда и воздух заканчиваются раньше срока, начинаются ссоры.', {
        n: survivors.length,
        people: plural(survivors.length, ['человек', 'человека', 'человек'], ['людина', 'людини', 'людей']),
        slots,
        places: plural(slots, ['место', 'места', 'мест'], ['місце', 'місця', 'місць']),
      }),
      tone: 'bad',
      icon: 'crowd',
      stamp: t('ПЕРЕПОЛНЕНО'),
    });
  }
  const sick = survivors.filter((p) => p.slots.health.card.modifier === 'negative').length;
  if (ev.health < 0.45 && sick) {
    middle.push({
      id: 'health',
      title: t('Болезни'),
      text: t('У {sick} из {total} выживших проблемы со здоровьем, а лекарств мало. Каждая зима даётся тяжелее предыдущей.', { sick, total: survivors.length }),
      tone: 'warn',
      icon: 'health',
    });
  }

  // Порядок событий случаен (но одинаков у всех игроков): так хроника не читается как список из таблицы
  const ordered = shuffle(middle, rng);
  const timeline: Draft[] = [
    { id: 'intro', title: t('Гермодверь закрыта'), text: introText(survivors, outside, slots, isolation), tone: 'neutral', icon: 'door' },
    ...ordered,
    ...(fatalEntry ? [fatalEntry] : []),
  ];
  const tail: Draft | null = fatalEntry ? null : outroEntry(ev.verdict, isolation);
  if (tail) timeline.push(tail);

  const inner = timeline.length - 1; // «День 1» — первая запись; остальные размазываем по сроку изоляции
  const entries: ChronicleEntry[] = timeline.map((d, i) => {
    let day = i === 0 ? 0 : Math.max(i, Math.round((total * i) / inner));
    if (!fatalEntry && i === timeline.length - 1) day = total;
    return { ...d, when: whenLabel(day) };
  });

  return { entries, epilogue: epilogue(game, survivors, outside, ev, isolation, !!fatalEntry), evaluation: ev, fatal: !!fatalEntry };
}

function introText(survivors: PlayerCharacter[], outside: PlayerCharacter[], slots: number, isolation: string): string {
  const n = survivors.length;
  const base = t('В бункере {n} {people} на {slots} {places}: {names}. Впереди — {isolation}.', {
    n,
    people: plural(n, ['человек', 'человека', 'человек'], ['людина', 'людини', 'людей']),
    slots,
    places: plural(slots, ['место', 'места', 'мест'], ['місце', 'місця', 'місць']),
    names: list(survivors.map((p) => p.name)),
    isolation,
  });
  return outside.length ? t('{base} Снаружи остались: {outside}.', { base, outside: list(outside.map((p) => p.name)) }) : base;
}

function outroEntry(verdict: Evaluation['verdict'], isolation: string): Draft | null {
  if (verdict === 'survived') return { id: 'outro', title: t('Дверь открывается'), text: t('Спустя {isolation} датчики показывают: снаружи можно жить. Колония выходит на поверхность.', { isolation }), tone: 'ok', icon: 'end', stamp: t('ВЫЖИЛИ') };
  if (verdict === 'fragile') return { id: 'outro', title: t('Дверь открывается — еле-еле'), text: t('Колония доживает до конца изоляции, но потери и нужда оставили след. Наверх выходят самые упрямые.'), tone: 'warn', icon: 'end', stamp: t('НА ГРАНИ') };
  return { id: 'outro', title: t('Дверь остаётся закрытой'), text: t('Запасы и силы иссякают раньше срока. Изнутри дверь так никто и не открыл.'), tone: 'bad', icon: 'end', stamp: t('ПРОВАЛ') };
}
type Draft = Omit<ChronicleEntry, 'when'>;

function epilogue(g: GameState, survivors: PlayerCharacter[], outside: PlayerCharacter[], ev: Evaluation, isolation: string, fatal: boolean): string[] {
  const lines: string[] = [];
  const profession = (p: PlayerCharacter) => clipText(p.slots.profession.card.description, 36);
  const title = g.scenario.title;
  lines.push(
    fatal
      ? t('Убежище «{title}» не пережило изоляции. {headline}.', { title, headline: ev.headline })
      : ev.verdict === 'survived'
        ? t('Через {isolation} убежище «{title}» открылось. Это была настоящая победа.', { isolation, title })
        : ev.verdict === 'fragile'
          ? t('Через {isolation} убежище «{title}» открылось, но заплатили за это дорого.', { isolation, title })
          : t('Убежище «{title}» осталось запертым навсегда.', { title }),
  );
  if (survivors.length) {
    const first = survivors.slice(0, 4).map((p) => `${p.name} (${profession(p)})`);
    const more = survivors.length - first.length;
    const crew = more > 0 ? t('{list} и ещё {more}', { list: list(first), more }) : list(first);
    lines.push(fatal ? t('Последними в бункере были: {crew}.', { crew }) : t('Колонию основали: {crew}.', { crew }));
    const lucky = survivors.find((p) => p.slots.luggage.card.modifier === 'positive');
    if (lucky && !fatal) lines.push(t('Лучше всего пригодился багаж {name}: «{desc}».', { name: lucky.name, desc: clipText(lucky.slots.luggage.card.description, 60) }));
    const trouble = survivors.flatMap((p) => (['fact', 'hobby', 'luggage', 'health'] as const).filter((c) => p.slots[c].card.modifier === 'negative').map((c) => ({ p, card: p.slots[c].card })))[0];
    if (trouble) lines.push(t('Больше всех хлопот добавил {name}: «{desc}».', { name: trouble.p.name, desc: clipText(trouble.card.description, 60) }));
  }
  // Имя берём из поля записи; регулярка по русскому тексту — только для старых сохранений без этого поля.
  const heroes = g.log.map((l) => l.volunteer ?? /^(.+) вызвался добровольцем/.exec(l.text)?.[1]).filter((x): x is string => !!x);
  if (heroes.length) {
    const act = heroes.length > 1 ? t('вызвались добровольцем') : t('вызвался добровольцем');
    lines.push(t('{list} {act}, чтобы остальные жили. Об этом помнят.', { list: list(heroes), act }));
  } else if (outside.length) lines.push(t('Не попали в бункер: {list}. Их судьбу узнает только поверхность.', { list: list(outside.map((p) => p.name)) }));
  return lines;
}
