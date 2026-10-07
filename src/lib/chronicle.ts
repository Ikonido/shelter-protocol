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

/** Склонение: plural(3, ['месяц','месяца','месяцев']) → «месяца». */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  return b === 1 ? forms[0] : forms[2];
}

const DAYS_PER_MONTH = 30.4375;

/** «5 лет» → 1826 дней, «2 недели» → 14, «10 дней» → 10, «18 месяцев» → 548; непонятное → 3 года. */
export function isolationDays(duration: string): number {
  const m = /(\d+)\s*(лет|год|мес|недел|дн|сут)/i.exec(duration);
  if (!m) return Math.round(36 * DAYS_PER_MONTH);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const days = unit === 'мес' ? n * DAYS_PER_MONTH : unit === 'лет' || unit === 'год' ? n * 12 * DAYS_PER_MONTH : unit === 'недел' ? n * 7 : n;
  return Math.max(1, Math.round(days));
}

/** Подпись момента на шкале: «День 1», «Через 3 дня», «Через 2 недели», «Через 3 месяца», «Через 2 года и 6 месяцев». */
export function whenLabel(day: number): string {
  if (day <= 0) return 'День 1';
  if (day < 14) return `Через ${day} ${plural(day, ['день', 'дня', 'дней'])}`;
  if (day < 60) {
    const w = Math.round(day / 7);
    return `Через ${w} ${plural(w, ['неделю', 'недели', 'недель'])}`;
  }
  const months = Math.round(day / DAYS_PER_MONTH);
  if (months < 12) return `Через ${months} ${plural(months, ['месяц', 'месяца', 'месяцев'])}`;
  const y = Math.floor(months / 12);
  const rest = months % 12;
  const years = `${y} ${plural(y, ['год', 'года', 'лет'])}`;
  return rest ? `Через ${years} и ${rest} ${plural(rest, ['месяц', 'месяца', 'месяцев'])}` : `Через ${years}`;
}

const clipText = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`);
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
  const isolation = game.scenario.isolationDuration || 'долгий срок';

  type Draft = Omit<ChronicleEntry, 'when'>;
  const middle: Draft[] = [];
  let fatalEntry: Draft | null = null;

  for (const r of ev.hazards) {
    const h = r.hazard;
    if (r.ok) {
      const text = h.onSuccess
        ? h.onSuccess.replaceAll('{who}', who(r.via, r.need))
        : `${who(r.via, r.need)} берётся за дело — угроза «${h.title}» снята.`;
      middle.push({ id: `hz-${h.id}`, title: h.title, text, tone: 'ok', icon: 'hazard', stamp: 'УГРОЗА СНЯТА' });
    } else {
      const lack = r.via.length ? ` Нужно ${r.need} ${plural(r.need, ['человек', 'человека', 'человек'])}, а есть только ${r.via.length}.` : '';
      const base = h.onFail ?? `Угроза «${h.title}» не остановлена: ${h.description || 'никто не знал, что с ней делать'}.`;
      const deadly = h.severity === 'critical';
      const draft: Draft = { id: `hz-${h.id}`, title: h.title, text: base + lack, tone: 'bad', icon: 'hazard', stamp: deadly ? 'СМЕРТЕЛЬНО' : 'ПРОВАЛ' };
      if (deadly && ev.fatal && !fatalEntry) {
        fatalEntry = { ...draft, title: `${h.title} — конец`, text: `${base}${lack} Убежище не выдерживает.`, stamp: 'ГИБЕЛЬ', icon: 'end' };
      } else middle.push(draft);
    }
  }

  const missing = ev.coverage.filter((c) => c.by.length === 0).slice(0, 2);
  for (const c of missing) {
    middle.push({ id: `sk-${c.skill}`, title: `Нет навыка: ${c.skill}`, text: `Колонии нужен навык «${c.skill}», но среди выживших никто им не владеет. Приходится действовать наугад — и платить за ошибки.`, tone: 'warn', icon: 'skill' });
  }
  const covered = ev.coverage.filter((c) => c.by.length > 0).slice(0, 2);
  for (const c of covered) {
    middle.push({ id: `sk-${c.skill}`, title: `Навык: ${c.skill}`, text: `${c.by[0]} закрывает вопрос «${c.skill}» — колония получает то, без чего долго не протянуть.`, tone: 'ok', icon: 'skill' });
  }
  if (slots && survivors.length > slots) {
    middle.push({ id: 'crowd', title: 'В бункере тесно', text: `${survivors.length} ${plural(survivors.length, ['человек', 'человека', 'человек'])} на ${slots} ${plural(slots, ['место', 'места', 'мест'])}: еда и воздух заканчиваются раньше срока, начинаются ссоры.`, tone: 'bad', icon: 'crowd', stamp: 'ПЕРЕПОЛНЕНО' });
  }
  const sick = survivors.filter((p) => p.slots.health.card.modifier === 'negative').length;
  if (ev.health < 0.45 && sick) {
    middle.push({ id: 'health', title: 'Болезни', text: `У ${sick} из ${survivors.length} выживших проблемы со здоровьем, а лекарств мало. Каждая зима даётся тяжелее предыдущей.`, tone: 'warn', icon: 'health' });
  }

  // Порядок событий случаен (но одинаков у всех игроков): так хроника не читается как список из таблицы
  const ordered = shuffle(middle, rng);
  const timeline: Draft[] = [
    { id: 'intro', title: 'Гермодверь закрыта', text: introText(survivors, outside, slots, isolation), tone: 'neutral', icon: 'door' },
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
  const base = `В бункере ${n} ${plural(n, ['человек', 'человека', 'человек'])} на ${slots} ${plural(slots, ['место', 'места', 'мест'])}: ${list(survivors.map((p) => p.name))}. Впереди — ${isolation}.`;
  return outside.length ? `${base} Снаружи остались: ${list(outside.map((p) => p.name))}.` : base;
}

function outroEntry(verdict: Evaluation['verdict'], isolation: string): Draft | null {
  if (verdict === 'survived') return { id: 'outro', title: 'Дверь открывается', text: `Спустя ${isolation} датчики показывают: снаружи можно жить. Колония выходит на поверхность.`, tone: 'ok', icon: 'end', stamp: 'ВЫЖИЛИ' };
  if (verdict === 'fragile') return { id: 'outro', title: 'Дверь открывается — еле-еле', text: `Колония доживает до конца изоляции, но потери и нужда оставили след. Наверх выходят самые упрямые.`, tone: 'warn', icon: 'end', stamp: 'НА ГРАНИ' };
  return { id: 'outro', title: 'Дверь остаётся закрытой', text: `Запасы и силы иссякают раньше срока. Изнутри дверь так никто и не открыл.`, tone: 'bad', icon: 'end', stamp: 'ПРОВАЛ' };
}
type Draft = Omit<ChronicleEntry, 'when'>;

function epilogue(g: GameState, survivors: PlayerCharacter[], outside: PlayerCharacter[], ev: Evaluation, isolation: string, fatal: boolean): string[] {
  const lines: string[] = [];
  const profession = (p: PlayerCharacter) => clipText(p.slots.profession.card.description, 36);
  lines.push(
    fatal
      ? `Убежище «${g.scenario.title}» не пережило изоляции. ${ev.headline}.`
      : ev.verdict === 'survived'
        ? `Через ${isolation} убежище «${g.scenario.title}» открылось. Это была настоящая победа.`
        : ev.verdict === 'fragile'
          ? `Через ${isolation} убежище «${g.scenario.title}» открылось, но заплатили за это дорого.`
          : `Убежище «${g.scenario.title}» осталось запертым навсегда.`,
  );
  if (survivors.length) {
    const first = survivors.slice(0, 4).map((p) => `${p.name} (${profession(p)})`);
    const more = survivors.length - first.length;
    lines.push(`${fatal ? 'Последними в бункере были' : 'Колонию основали'}: ${list(first)}${more > 0 ? ` и ещё ${more}` : ''}.`);
    const lucky = survivors.find((p) => p.slots.luggage.card.modifier === 'positive');
    if (lucky && !fatal) lines.push(`Лучше всего пригодился багаж ${lucky.name}: «${clipText(lucky.slots.luggage.card.description, 60)}».`);
    const trouble = survivors.flatMap((p) => (['fact', 'hobby', 'luggage', 'health'] as const).filter((c) => p.slots[c].card.modifier === 'negative').map((c) => ({ p, card: p.slots[c].card })))[0];
    if (trouble) lines.push(`Больше всех хлопот добавил ${trouble.p.name}: «${clipText(trouble.card.description, 60)}».`);
  }
  const heroes = g.log.map((l) => /^(.+) вызвался добровольцем/.exec(l.text)?.[1]).filter((x): x is string => !!x);
  if (heroes.length) lines.push(`${list(heroes)} ${heroes.length > 1 ? 'вызвались' : 'вызвался'} добровольцем${heroes.length > 1 ? '' : ''}, чтобы остальные жили. Об этом помнят.`);
  else if (outside.length) lines.push(`Не попали в бункер: ${list(outside.map((p) => p.name))}. Их судьбу узнает только поверхность.`);
  return lines;
}
