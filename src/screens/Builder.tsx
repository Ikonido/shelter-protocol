import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Play, Plus, Save, Trash2, Wand2 } from 'lucide-react';
import { useStore } from '../store';
import { categoryLabel, type Card, type CardPack, type Category, type Hazard, type Modifier, type Scenario, type Severity } from '../types';
import { HAZARD_TEMPLATES, SCENARIO_TEMPLATES } from '../data/templates';
import { LIMITS as L } from '../lib/limits';
import { uid } from '../lib/rng';
import { MY_PACK_ID, blankScenario, buildMyPack, canSaveScenario, newHazard, ownCardCount } from '../lib/builder';
import { cardLabel, cardsWithSkill, skillCards, skillVocabulary, validateScenario, type SkillInfo } from '../lib/vocab';
import { mergePools } from '../lib/generator';
import { t, plural } from '../lib/i18n';
import { Stepper } from '../ui/bits';
import { ChipPicker } from '../ui/ChipPicker';

const STEPS = ['Основа', 'Навыки', 'Угрозы', 'Способности', 'Проверка'] as const;
const ABILITY_CATS: Category[] = ['profession', 'biology', 'physique', 'character', 'hobby', 'luggage', 'fact'];
const DURATIONS = ['1 год', '2 года', '3 года', '5 лет', '10 лет'];
const SEVERITY: [Severity, string, string][] = [
  ['critical', 'Смертельная', 'border-danger text-danger bg-danger/10'],
  ['major', 'Серьёзная', 'border-amber text-amber bg-amber/10'],
  ['minor', 'Лёгкая', 'border-ok text-ok bg-ok/10'],
];

interface Ctx {
  draft: Scenario;
  setDraft: (s: Scenario) => void;
  vocab: SkillInfo[];
  cards: Card[];
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t.toLowerCase() === b[i]?.toLowerCase());

/* ---------- Шаг 1: основа ---------- */

function StepBasics({ draft, setDraft }: Ctx) {
  const applyTemplate = (key: string) => {
    const tpl = SCENARIO_TEMPLATES[key];
    if ((draft.title || draft.requiredSkills.length || draft.hazards?.length) && !confirm(t('Заменить введённое шаблоном?'))) return;
    const { hazards, ...rest } = tpl;
    setDraft({ ...blankScenario(), ...rest, id: draft.id, hazards: hazards.map((h) => newHazard(h)) });
  };
  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <h2 className="step-title">{t('Начать с шаблона')}</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(SCENARIO_TEMPLATES).map(([key, tpl]) => (
            <button key={key} className="btn btn-sm" onClick={() => applyTemplate(key)}><Wand2 size={14} /> {t(tpl.title)}</button>
          ))}
        </div>
        <p className="mt-2 text-xs text-dim">{t('Шаблон заполнит все шаги — потом можно всё изменить. Или сочиняйте с нуля ниже.')}</p>
      </section>

      <section className="panel flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="b-title">{t('Название катастрофы')}</label>
          <input id="b-title" className="input" maxLength={L.scenarioTitle} placeholder={t('Например: Подводная лодка')} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="b-desc">{t('Что случилось')}</label>
          <textarea id="b-desc" rows={4} className="input" maxLength={L.scenarioDescription} placeholder={t('Опишите катастрофу и положение убежища.')} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <span className="mt-1 block text-right text-[10px] text-dim">{draft.description.length}/{L.scenarioDescription}</span>
        </div>
        <div>
          <span className="label">{t('Срок изоляции')}</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {DURATIONS.map((d) => (
              <button key={d} className={`chip ${draft.isolationDuration === d ? '!border-amber !text-amber' : ''}`} onClick={() => setDraft({ ...draft, isolationDuration: d })}>{t(d)}</button>
            ))}
          </div>
          <input className="input" maxLength={L.scenarioDuration} aria-label={t('Срок изоляции')} value={draft.isolationDuration} onChange={(e) => setDraft({ ...draft, isolationDuration: e.target.value })} />
          <p className="mt-1 text-xs text-dim">{t('От срока зависит шкала времени в хронике («через 3 года и 4 месяца…»). Пишите «N лет», «N года» или «N месяцев».')}</p>
        </div>
        <Stepper label={t('Мест в бункере по умолчанию')} value={draft.shelterSlots} min={1} max={19} onChange={(v) => setDraft({ ...draft, shelterSlots: v })} />
      </section>
    </div>
  );
}

/* ---------- Шаг 2: требуемые навыки ---------- */

function StepSkills({ draft, setDraft, vocab }: Ctx) {
  return (
    <section className="panel flex flex-col gap-3">
      <h2 className="step-title">{t('Что нужно для выживания')}</h2>
      <p className="text-sm text-dim">{t('Выберите навыки, которые должны быть у выживших. Число рядом — сколько карт в колоде даёт навык (красный «0» — таких карт нет, и победить нельзя; добавьте способность на шаге 4).')}</p>
      <ChipPicker options={vocab} value={draft.requiredSkills} max={L.skills} onChange={(v) => setDraft({ ...draft, requiredSkills: v })} />
    </section>
  );
}

/* ---------- Шаг 3: угрозы ---------- */

function StepHazards({ draft, setDraft, vocab, cards }: Ctx) {
  const hazards = draft.hazards ?? [];
  const [open, setOpen] = useState<string | null>(hazards[0]?.id ?? null);
  const set = (id: string, patch: Partial<Hazard>) => setDraft({ ...draft, hazards: hazards.map((h) => (h.id === id ? { ...h, ...patch } : h)) });
  const add = (h: Hazard) => {
    setDraft({ ...draft, hazards: [...hazards, h] });
    setOpen(h.id);
  };
  const fresh = HAZARD_TEMPLATES.filter((tpl) => !hazards.some((h) => h.title === tpl.title));

  return (
    <div className="flex flex-col gap-3">
      <section className="panel">
        <h2 className="step-title">{t('Факторы угрозы')}</h2>
        <p className="text-sm text-dim">{t('Угрозу нужно «снять» в финале: достаточно, чтобы у кого-то из выживших была карта с подходящим навыком. Смертельная угроза без ответа губит убежище.')}</p>
      </section>

      {hazards.map((h) => {
        const isOpen = open === h.id;
        const matching = [...new Set(h.counters.flatMap((s) => cardsWithSkill(cards, s)))];
        return (
          <section key={h.id} className="panel flex flex-col gap-3 p-3">
            <button className="flex items-center gap-2 text-left" onClick={() => setOpen(isOpen ? null : h.id)} aria-expanded={isOpen}>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${SEVERITY.find((s) => s[0] === h.severity)![2]}`}>{t(SEVERITY.find((s) => s[0] === h.severity)![1])}</span>
              <b className="min-w-0 flex-1 truncate">{h.title ? t(h.title) : t('Без названия')}</b>
              {!matching.length && <AlertTriangle size={16} className="text-danger" aria-label={t('Никто не снимет')} />}
              <ChevronDown size={16} className={`transition ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="flex flex-col gap-3">
                <input className="input" maxLength={L.hazardTitle} placeholder={t('Название: Крысы на корабле')} aria-label={t('Название угрозы')} value={h.title} onChange={(e) => set(h.id, { title: e.target.value })} />
                <textarea rows={2} className="input" maxLength={L.hazardDescription} placeholder={t('Что происходит')} aria-label={t('Описание угрозы')} value={h.description} onChange={(e) => set(h.id, { description: e.target.value })} />
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('Тяжесть')}>
                  {SEVERITY.map(([v, label, cls]) => (
                    <button key={v} role="radio" aria-checked={h.severity === v} className={`rounded-md border px-2 py-2 text-xs uppercase tracking-wider ${h.severity === v ? cls : 'border-edge text-dim'}`} onClick={() => set(h.id, { severity: v })}>{t(label)}</button>
                  ))}
                </div>
                <div>
                  <span className="label">{t('Чем нейтрализуется (навыки)')}</span>
                  <ChipPicker options={vocab} value={h.counters} max={L.hazardCounters} onChange={(v) => set(h.id, { counters: v })} />
                  <p className={`mt-2 text-xs ${matching.length ? 'text-ok' : 'text-danger'}`}>
                    {matching.length
                      ? t('Снимут: {list}', { list: `${matching.slice(0, 5).map((c) => clip(t(cardLabel(c)), 28)).join(', ')}${matching.length > 5 ? ` ${t('и ещё {n}', { n: matching.length - 5 })}` : ''}` })
                      : t('Ни одна карта колоды не подходит — добавьте способность на шаге 4.')}
                  </p>
                </div>
                <details>
                  <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">{t('Фразы для хроники (необязательно)')}</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea rows={2} className="input" maxLength={L.hazardStory} placeholder={t('Если снята: {who} расставляет ловушки — грызуны уходят. ({who} — тот, кто справился)')} aria-label={t('Фраза при успехе')} value={h.onSuccess ?? ''} onChange={(e) => set(h.id, { onSuccess: e.target.value || undefined })} />
                    <textarea rows={2} className="input" maxLength={L.hazardStory} placeholder={t('Если не остановлена: Крысы прогрызают трюм.')} aria-label={t('Фраза при провале')} value={h.onFail ?? ''} onChange={(e) => set(h.id, { onFail: e.target.value || undefined })} />
                  </div>
                </details>
                <button className="btn btn-danger btn-sm self-end" onClick={() => setDraft({ ...draft, hazards: hazards.filter((x) => x.id !== h.id) })}><Trash2 size={14} /> {t('Удалить угрозу')}</button>
              </div>
            )}
          </section>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm" disabled={hazards.length >= L.hazards} onClick={() => add(newHazard())}><Plus size={14} /> {t('Своя угроза ({n}/{max})', { n: hazards.length, max: L.hazards })}</button>
      </div>
      {fresh.length > 0 && hazards.length < L.hazards && (
        <details className="panel p-3">
          <summary className="cursor-pointer text-xs uppercase tracking-widest text-amber">{t('Добавить из шаблонов')}</summary>
          <div className="mt-3 flex flex-col gap-2">
            {fresh.map((tpl) => (
              <button key={tpl.title} className="rounded-md border border-edge p-2 text-left text-sm hover:border-amber" onClick={() => add(newHazard(tpl))}>
                <b>{t(tpl.title)}</b> <span className="text-xs text-dim">{t('· {sev} · нейтрализует: {list}', { sev: t(SEVERITY.find((s) => s[0] === tpl.severity)![1]).toLowerCase(), list: tpl.counters.map((c) => t(c)).join(', ') })}</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/* ---------- Шаг 4: способности карт ---------- */

function StepAbilities({
  vocab, draft, preview, base, overrides, setOverrides, newCards, setNewCards, setRemoved, removed,
}: Ctx & {
  preview: CardPack[];
  base: Record<Category, Card[]>;
  overrides: Record<string, string[]>;
  setOverrides: (o: Record<string, string[]>) => void;
  newCards: Card[];
  setNewCards: (c: Card[]) => void;
  removed: string[];
  setRemoved: (ids: string[]) => void;
}) {
  const [cat, setCat] = useState<Category>('profession');
  // Лимит относится к своим картам категории, а не к общей колоде вместе со встроенными паками.
  const ownFull = ownCardCount(preview, cat) >= L.cardsPerCategory;
  const [onlyRelevant, setOnlyRelevant] = useState(draft.requiredSkills.length + (draft.hazards?.length ?? 0) > 0);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ text: string; modifier: Modifier; tags: string[] }>({ text: '', modifier: 'positive', tags: [] });

  const pool = useMemo(() => mergePools(preview)[cat].filter((c) => !removed.includes(c.id)), [preview, cat, removed]);
  const needed = useMemo(() => [...draft.requiredSkills, ...(draft.hazards ?? []).flatMap((h) => h.counters)], [draft]);
  const relevant = (c: Card) => needed.some((s) => cardsWithSkill([c], s).length > 0);
  const rows = pool.filter((c) => (!onlyRelevant || relevant(c) || Object.prototype.hasOwnProperty.call(overrides, c.id) || newCards.some((n) => n.id === c.id)) && (!q || matchesQuery(cardLabel(c), q)));
  const origin = (id: string) => base[cat].find((c) => c.id === id)?.tags ?? [];

  const setTags = (c: Card, tags: string[]) => {
    const next = { ...overrides };
    if (sameTags(tags, origin(c.id))) delete next[c.id];
    else next[c.id] = tags;
    setOverrides(next);
  };
  const isMine = (id: string) => newCards.some((n) => n.id === id);
  const addCard = () => {
    const text = form.text.trim();
    if (!text || ownFull) return;
    setNewCards([...newCards, { id: uid('c'), category: cat, description: text.slice(0, L.cardDescription), modifier: form.modifier, ...(form.tags.length ? { tags: form.tags } : {}) }]);
    setForm({ text: '', modifier: 'positive', tags: [] });
  };

  return (
    <div className="flex flex-col gap-3">
      <section className="panel">
        <h2 className="step-title">{t('Способности карт')}</h2>
        <p className="text-sm text-dim">{t('Каждая карта «умеет» то, что указано в навыках. Выберите карту и отметьте, что она нейтрализует: например, научите «Хирурга» снимать вашу новую угрозу. Это можно сделать и со встроенными картами — оригиналы не изменятся, а новые способности будут работать в играх с паком «Мои сценарии».')}</p>
      </section>

      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {ABILITY_CATS.map((c) => (
          <button key={c} role="tab" aria-selected={cat === c} className={`btn btn-sm shrink-0 ${cat === c ? 'btn-primary' : ''}`} onClick={() => { setCat(c); setOpenId(null); }}>{categoryLabel(c)}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs flex-1" placeholder={t('Поиск по картам')} aria-label={t('Поиск по картам')} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex cursor-pointer items-center gap-2 text-xs text-dim">
          <input type="checkbox" className="size-4 accent-amber" checked={onlyRelevant} onChange={(e) => setOnlyRelevant(e.target.checked)} /> {t('только нужные сценарию')}
        </label>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((c) => {
          const changed = Object.prototype.hasOwnProperty.call(overrides, c.id);
          const isOpen = openId === c.id;
          return (
            <li key={c.id} className={`cat-${c.category} rounded-md border bg-bg ${isOpen ? 'border-[var(--c)]' : 'border-edge'}`}>
              <button className="flex w-full items-start gap-2 p-3 text-left" onClick={() => setOpenId(isOpen ? null : c.id)} aria-expanded={isOpen}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{clip(t(cardLabel(c)), 80)}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {(c.tags ?? []).length ? (c.tags ?? []).map((tag) => <span key={tag} className={`chip !px-1.5 ${needed.some((n) => n.toLowerCase() === tag.toLowerCase()) ? '!border-ok !text-ok' : ''}`}>{t(tag)}</span>) : <span className="text-[10px] text-dim">{t('нет способностей')}</span>}
                  </span>
                </span>
                {(changed || isMine(c.id)) && <span className="chip !border-amber !text-amber">{isMine(c.id) ? t('моя') : t('изменена')}</span>}
                <ChevronDown size={16} className={`mt-1 shrink-0 transition ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="flex flex-col gap-2 border-t border-edge p-3">
                  <span className="label">{t('Что умеет нейтрализовать эта карта')}</span>
                  <ChipPicker options={vocab} value={c.tags ?? []} max={L.cardTags} onChange={(tags) => setTags(c, tags)} />
                  <div className="flex gap-2">
                    {changed && <button className="btn btn-sm" onClick={() => { const n = { ...overrides }; delete n[c.id]; setOverrides(n); }}>{t('Вернуть исходные')}</button>}
                    {cardsMineSaved(preview, c.id) && (
                      <button className="btn btn-danger btn-sm" onClick={() => { setNewCards(newCards.filter((n) => n.id !== c.id)); if (!isMine(c.id)) setRemoved([...removed, c.id]); setOpenId(null); }}><Trash2 size={14} /> {t('Удалить карту')}</button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {rows.length === 0 && <li className="text-sm text-dim">{t('Нет карт по фильтру. Снимите «только нужные сценарию» или создайте свою карту ниже.')}</li>}
      </ul>

      <details className="panel p-3">
        <summary className="cursor-pointer text-xs uppercase tracking-widest text-amber">{t('Создать свою карту ({cat})', { cat: categoryLabel(cat).toLowerCase() })}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <input className="input" maxLength={L.cardDescription} placeholder={cat === 'profession' ? t('Например: Экзорцист') : cat === 'luggage' ? t('Например: Мешок соли') : t('Описание карты')} aria-label={t('Текст карты')} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          <select className="input" aria-label={t('Полезность карты')} value={form.modifier} onChange={(e) => setForm({ ...form, modifier: e.target.value as Modifier })}>
            <option value="positive">{t('+ полезная')}</option>
            <option value="neutral">{t('· нейтральная')}</option>
            <option value="negative">{t('− вредная')}</option>
          </select>
          <span className="label">{t('Что умеет нейтрализовать')}</span>
          <ChipPicker options={vocab} value={form.tags} max={L.cardTags} onChange={(tags) => setForm({ ...form, tags })} />
          <button className="btn btn-primary" disabled={!form.text.trim() || ownFull} onClick={addCard}><Plus size={16} /> {t('Добавить карту')}</button>
          {ownFull && <p className="text-xs text-danger">{t('Достигнут лимит своих карт в этой категории ({n})', { n: L.cardsPerCategory })}</p>}
        </div>
      </details>
    </div>
  );
}

/** Эта карта была создана в конструкторе раньше и лежит в сохранённом паке «Мои сценарии». */
function cardsMineSaved(preview: CardPack[], id: string): boolean {
  const mine = preview.find((p) => p.id === MY_PACK_ID);
  return !!mine && Object.values(mine.cards).some((list) => list.some((c) => c.id === id));
}

/* ---------- Шаг 5: проверка и сохранение ---------- */

function StepReview({ draft, vocab, cards, preview, onSave, onDelete, editing, saved }: Ctx & { preview: CardPack[]; onSave: (play: boolean) => void; onDelete?: () => void; editing: boolean; saved: boolean }) {
  void vocab;
  const problems = useMemo(() => validateScenario(draft, preview), [draft, preview]);
  const errors = problems.filter((p) => p.level === 'error');
  const warns = problems.filter((p) => p.level === 'warn');
  return (
    <div className="flex flex-col gap-3">
      <section className="panel hud">
        <h2 className="step-title">{draft.title ? t(draft.title) : t('Без названия')}</h2>
        <p className="text-sm text-ink/90">{draft.description ? t(draft.description) : t('Описание не задано.')}</p>
        <p className="mt-2 text-xs text-dim">{t('Срок: {dur} · мест: {slots} · навыков: {skills} · угроз: {threats}', { dur: draft.isolationDuration ? t(draft.isolationDuration) : '—', slots: draft.shelterSlots, skills: draft.requiredSkills.length, threats: draft.hazards?.length ?? 0 })}</p>
      </section>

      {errors.length === 0 && warns.length === 0 && (
        <p className="panel flex items-center gap-2 border-ok/50 text-sm text-ok"><Check size={16} /> {t('Всё в порядке: каждый навык и каждая угроза имеют карты, которые их закрывают.')}</p>
      )}
      {[...errors, ...warns].map((p, i) => (
        <p key={i} className={`panel flex gap-2 text-sm ${p.level === 'error' ? 'border-danger/60 text-danger' : 'border-amber/50 text-amber'}`}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {t(p.text)}
        </p>
      ))}

      {draft.requiredSkills.length > 0 && (
        <section className="panel">
          <h3 className="label">{t('Кто закроет навыки')}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {draft.requiredSkills.map((s) => {
              const m = cardsWithSkill(cards, s);
              return <li key={s}><b className={m.length ? 'text-ok' : 'text-danger'}>{t(s)}</b> <span className="text-xs text-dim">— {m.length ? t('{n} {cards}: {list}', { n: m.length, cards: plural(m.length, { ru: ['карта', 'карты', 'карт'], uk: ['картка', 'картки', 'карток'], en: ['card', 'cards'], de: ['Karte', 'Karten'] }), list: m.slice(0, 3).map((c) => clip(t(cardLabel(c)), 22)).join(', ') }) : t('никто')}</span></li>;
            })}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-2">
        <button className="btn btn-primary" disabled={errors.length > 0} onClick={() => onSave(true)}><Play size={18} /> {t('Сохранить и играть')}</button>
        <button className="btn" disabled={errors.length > 0} onClick={() => onSave(false)}><Save size={16} /> {t('Сохранить')}</button>
        {saved && <p className="text-center text-xs text-ok">{t('Сохранено в «Мои сценарии». Найдёте его в настройках новой игры.')}</p>}
        {editing && onDelete && <button className="btn btn-danger btn-sm" onClick={onDelete}><Trash2 size={14} /> {t('Удалить сценарий')}</button>}
      </div>
    </div>
  );
}

/* ---------- Мастер ---------- */


/** Поиск по тексту карты: и по исходному русскому, и по переводу, чтобы украинский запрос тоже находил карту. */
const matchesQuery = (raw: string, q: string) => {
  const needle = q.toLowerCase();
  return raw.toLowerCase().includes(needle) || t(raw).toLowerCase().includes(needle);
};

export default function Builder({ scenarioId }: { scenarioId?: string }) {
  const { allPacks, builtinPacks, customPacks, upsertPack, go, notify } = useStore();
  const myPack = customPacks.find((p) => p.id === MY_PACK_ID);
  const editing = !!scenarioId && !!myPack?.scenarios.some((s) => s.id === scenarioId);

  const [draft, setDraft] = useState<Scenario>(() => {
    const found = myPack?.scenarios.find((s) => s.id === scenarioId);
    return found ? (JSON.parse(JSON.stringify(found)) as Scenario) : blankScenario();
  });
  const [overrides, setOverrides] = useState<Record<string, string[]>>(() => ({ ...(myPack?.tagOverrides ?? {}) }));
  const [newCards, setNewCards] = useState<Card[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(false);
  const snap = useRef(JSON.stringify([draft, overrides, newCards, removed]));
  const dirty = JSON.stringify([draft, overrides, newCards, removed]) !== snap.current;

  // «Предпросмотр» колоды: все паки, где «Мои сценарии» заменён на версию с текущим черновиком.
  const preview = useMemo(() => {
    const mine = buildMyPack(myPack, { ...draft, hazards: draft.hazards ?? [] }, newCards, overrides, removed);
    return [...allPacks.filter((p) => p.id !== MY_PACK_ID), mine];
  }, [allPacks, myPack, draft, newCards, overrides, removed]);
  const base = useMemo(() => mergePools(preview.map((p) => (p.id === MY_PACK_ID ? { ...p, tagOverrides: undefined } : p))), [preview]);
  const cards = useMemo(() => skillCards(preview), [preview]);
  const vocab = useMemo(() => skillVocabulary(preview, [...draft.requiredSkills, ...(draft.hazards ?? []).flatMap((h) => h.counters)]), [preview, draft]);
  const ctx: Ctx = { draft, setDraft, vocab, cards };

  const leave = () => {
    if (dirty && !confirm(t('Выйти без сохранения? Изменения пропадут.'))) return;
    go({ name: 'home' });
  };
  const save = (play: boolean) => {
    // Штатная загрузка оставляет не больше L.scenarios сценариев: лишний нельзя «сохранить», чтобы он потом не исчез.
    if (!canSaveScenario(myPack, draft.id)) {
      notify(t('Достигнут лимит сценариев ({n}). Удалите один из своих сценариев, чтобы добавить новый.', { n: L.scenarios }));
      return;
    }
    const pack = buildMyPack(myPack, draft, newCards, overrides, removed);
    upsertPack(pack);
    snap.current = JSON.stringify([draft, overrides, newCards, removed]);
    setSaved(true);
    notify(t('Сценарий сохранён'));
    if (play) go({ name: 'setup', packIds: [...builtinPacks.map((p) => p.id), MY_PACK_ID], scenarioId: draft.id });
  };
  const remove = () => {
    if (!myPack || !confirm(t('Удалить сценарий «{title}»?', { title: draft.title }))) return;
    upsertPack({ ...myPack, scenarios: myPack.scenarios.filter((s) => s.id !== draft.id) });
    notify(t('Сценарий удалён'));
    go({ name: 'setup' });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-28 pt-4">
      <header className="flex items-center gap-2">
        <button className="btn btn-sm" onClick={leave}><ArrowLeft size={16} /> {t('Выход')}</button>
        <h1 className="h-hud min-w-0 flex-1 truncate text-sm">{t('Конструктор сценария')}</h1>
      </header>

      <nav aria-label={t('Шаги конструктора')}>
        <ol className="flex gap-1 overflow-x-auto">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                aria-current={i === step ? 'step' : undefined}
                onClick={() => setStep(i)}
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] uppercase tracking-widest ${i === step ? 'border-amber bg-amber/15 text-amber' : i < step ? 'border-ok/40 text-ok' : 'border-edge text-dim'}`}
              >
                {i + 1} · {t(s)}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="anim-rise" key={step}>
        {step === 0 && <StepBasics {...ctx} />}
        {step === 1 && <StepSkills {...ctx} />}
        {step === 2 && <StepHazards {...ctx} />}
        {step === 3 && (
          <StepAbilities {...ctx} preview={preview} base={base} overrides={overrides} setOverrides={setOverrides} newCards={newCards} setNewCards={setNewCards} removed={removed} setRemoved={setRemoved} />
        )}
        {step === 4 && <StepReview {...ctx} preview={preview} onSave={save} onDelete={editing ? remove : undefined} editing={editing} saved={saved && !dirty} />}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-bg/90 p-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl gap-2">
          <button className="btn flex-1" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> {t('Назад')}</button>
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary flex-1" onClick={() => setStep(step + 1)}>{t('Далее')} <ArrowRight size={16} /></button>
          ) : (
            <button className="btn btn-primary flex-1" onClick={() => save(true)} disabled={!draft.title.trim()}><Play size={16} /> {t('Играть')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
