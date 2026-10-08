import { t, plural } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Link2, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { filterCards } from '../lib/cardFilter';
import { ACTION_EFFECTS, CATEGORIES, categoryLabel, type Card, type CardPack, type Category, type Hazard, type Modifier, type Scenario, type Severity } from '../types';
import { exportPackFile, shareUrl } from '../lib/packs';
import { uid } from '../lib/rng';
import { copyText } from '../ui/clipboard';
import { CATEGORY_ICON } from '../ui/bits';
import { LIMITS as L, clip, clipList } from '../lib/limits';

const Counter = ({ v, max }: { v: string; max: number }) => (
  <span className={`mt-1 block text-right text-[10px] ${v.length >= max ? 'text-amber' : 'text-dim'}`}>{v.length}/{max}</span>
);

/** Поле «список через запятую/строки»: фиксирует значение на blur, чтобы курсор не прыгал при вводе. */
function ListInput({ value, onCommit, multiline = false, placeholder, maxItems, maxLen }: { value: string[]; onCommit: (v: string[]) => void; multiline?: boolean; placeholder?: string; maxItems: number; maxLen: number }) {
  const sep = multiline ? '\n' : ', ';
  const [text, setText] = useState(value.join(sep));
  const commit = () => {
    const next = clipList(text.split(multiline ? /\n/ : /[,;]/), maxItems, maxLen);
    onCommit(next);
    setText(next.join(sep));
  };
  const props = { value: text, placeholder, className: 'input', onChange: (e: { target: { value: string } }) => setText(e.target.value), onBlur: commit };
  return (
    <>
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
      <span className="mt-1 block text-right text-[10px] text-dim">{t('до {n} шт. по {len} симв.', { n: maxItems, len: maxLen })}</span>
    </>
  );
}

const SEVERITY_OPTIONS: [Severity, string][] = [['critical', 'смертельная — без ответа убежище гибнет'], ['major', 'серьёзная'], ['minor', 'лёгкая']];
const MOD_OPTIONS: [Modifier, string][] = [['positive', '+ полезная'], ['neutral', '· нейтральная'], ['negative', '− вредная']];

export default function Editor({ packId }: { packId: string }) {
  const { customPacks, upsertPack, go, notify } = useStore();
  const pack = customPacks.find((p) => p.id === packId);
  const [tab, setTab] = useState<'info' | 'scenarios' | Category>('info');
  const [bulk, setBulk] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    setQuery('');
  }, [tab]);
  if (!pack) {
    return <div className="py-10 text-center"><p className="mb-4">{t('Пак не найден.')}</p><button className="btn" onClick={() => go({ name: 'packs' })}>{t('К пакам')}</button></div>;
  }
  const save = (p: CardPack) => upsertPack(p);
  const setCards = (cat: Category, cards: Card[]) => save({ ...pack, cards: { ...pack.cards, [cat]: cards } });
  const setHazard = (sid: string, hid: string, patch: Partial<Hazard>) =>
    setScenario(sid, { hazards: (pack.scenarios.find((x) => x.id === sid)?.hazards ?? []).map((h) => (h.id === hid ? { ...h, ...patch } : h)) });
  const setScenario = (id: string, patch: Partial<Scenario>) =>
    save({ ...pack, scenarios: pack.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const addBulk = (cat: Category) => {
    // Формат строки: «Текст | + | тег1, тег2» (знак и теги необязательны)
    const added: Card[] = bulk.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [desc, mod, tags] = line.split('|').map((s) => s.trim());
      const modifier: Modifier = mod === '+' ? 'positive' : mod === '-' || mod === '−' ? 'negative' : 'neutral';
      return { id: uid('c'), category: cat, description: clip(desc ?? '', L.cardDescription), modifier, ...(tags ? { tags: clipList(tags.split(/[,;]/), L.cardTags, L.tagLen) } : {}) };
    });
    setCards(cat, [...pack.cards[cat], ...added.filter((c) => c.description)].slice(0, L.cardsPerCategory));
    setBulk('');
    notify(t('Добавлено {n} {w}', { n: added.length, w: plural(added.length, ['карта', 'карты', 'карт'], ['картка', 'картки', 'карток']) }));
  };

  const tabs: ['info' | 'scenarios' | Category, string][] = [['info', t('Инфо')], ['scenarios', t('Сценарии ({n})', { n: pack.scenarios.length })], ...CATEGORIES.map((c): [Category, string] => [c, `${categoryLabel(c)} (${pack.cards[c].length})`])];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={() => go({ name: 'packs' })}><ArrowLeft size={16} /> {t('Паки')}</button>
        <h1 className="truncate text-sm font-bold text-amber">{pack.name}</h1>
        <div className="ml-auto flex gap-2">
          <button className="btn btn-sm" onClick={() => exportPackFile(pack)}><Download size={14} /> JSON</button>
          <button className="btn btn-sm" onClick={async () => { const u = shareUrl(pack); notify(!u ? t('Пак слишком большой для ссылки — используйте JSON-файл') : (await copyText(u)) ? t('Ссылка скопирована') : t('Не удалось скопировать')); }}><Link2 size={14} /> {t('Ссылка')}</button>
        </div>
      </div>
      <p className="text-[10px] uppercase tracking-widest text-dim">{t('Изменения сохраняются автоматически')}</p>

      <nav className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(([id, label]) => (
          <button key={id} className={`btn btn-sm shrink-0 ${tab === id ? 'btn-primary' : ''}`} onClick={() => { setTab(id); setBulk(''); }}>{label}</button>
        ))}
      </nav>

      {tab === 'info' && (
        <div className="panel flex flex-col gap-3">
          <div><span className="label">{t('Название')}</span><input className="input" maxLength={L.packName} value={pack.name} onChange={(e) => save({ ...pack, name: e.target.value })} /><Counter v={pack.name} max={L.packName} /></div>
          <div><span className="label">{t('Описание')}</span><textarea rows={3} maxLength={L.packDescription} className="input" value={pack.description} onChange={(e) => save({ ...pack, description: e.target.value })} /><Counter v={pack.description} max={L.packDescription} /></div>
        </div>
      )}

      {tab === 'scenarios' && (
        <div className="flex flex-col gap-3">
          {pack.scenarios.map((s) => (
            <div key={s.id} className="panel flex flex-col gap-3">
              <div className="flex gap-2">
                <input className="input font-bold" maxLength={L.scenarioTitle} placeholder={t('Название катастрофы')} value={s.title} onChange={(e) => setScenario(s.id, { title: e.target.value })} />
                <button className="btn btn-danger btn-sm" aria-label={t('удалить')} onClick={() => confirm(t('Удалить сценарий?')) && save({ ...pack, scenarios: pack.scenarios.filter((x) => x.id !== s.id) })}><Trash2 size={14} /></button>
              </div>
              <div><textarea rows={3} maxLength={L.scenarioDescription} className="input" placeholder={t('Описание')} value={s.description} onChange={(e) => setScenario(s.id, { description: e.target.value })} /><Counter v={s.description} max={L.scenarioDescription} /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><span className="label">{t('Мест по умолчанию')}</span><input type="number" min={1} max={19} className="input" value={s.shelterSlots} onChange={(e) => setScenario(s.id, { shelterSlots: Math.min(19, Math.max(1, Number(e.target.value) || 1)) })} /></div>
                <div><span className="label">{t('Срок изоляции')}</span><input className="input" maxLength={L.scenarioDuration} placeholder={t('например, 3 года')} value={s.isolationDuration} onChange={(e) => setScenario(s.id, { isolationDuration: e.target.value })} /></div>
              </div>
              <div><span className="label">{t('Требуемые навыки (через запятую)')}</span><ListInput value={s.requiredSkills} onCommit={(v) => setScenario(s.id, { requiredSkills: v })} placeholder={t('медицина, агрономия')} maxItems={L.skills} maxLen={L.skillLen} /></div>
              <div><span className="label">{t('Угрозы (по одной в строке)')}</span><ListInput multiline value={s.threats} onCommit={(v) => setScenario(s.id, { threats: v })} maxItems={L.threats} maxLen={L.threatLen} /></div>
              <div className="flex flex-col gap-2">
                <span className="label">{t('Факторы угрозы: в партию берётся случайный набор ({n}/{max})', { n: (s.hazards ?? []).length, max: L.hazards })}</span>
                {(s.hazards ?? []).map((h) => (
                  <div key={h.id} className="rounded-md border border-edge p-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input className="input" maxLength={L.hazardTitle} placeholder={t('Например: Крысы на корабле')} value={h.title} onChange={(e) => setHazard(s.id, h.id, { title: e.target.value })} />
                      <button className="btn btn-danger btn-sm" aria-label={t('удалить угрозу')} onClick={() => setScenario(s.id, { hazards: (s.hazards ?? []).filter((x) => x.id !== h.id) })}><Trash2 size={14} /></button>
                    </div>
                    <textarea rows={2} className="input" maxLength={L.hazardDescription} placeholder={t('Описание')} value={h.description} onChange={(e) => setHazard(s.id, h.id, { description: e.target.value })} />
                    <select className="input" value={h.severity} onChange={(e) => setHazard(s.id, h.id, { severity: e.target.value as Severity })}>
                      {SEVERITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                    </select>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div><span className="label">{t('Хроника: угроза снята ({who} — кто справился)')}</span><textarea rows={2} className="input" maxLength={L.hazardStory} placeholder={t('{who} расставляет ловушки — грызуны уходят.')} value={h.onSuccess ?? ''} onChange={(e) => setHazard(s.id, h.id, { onSuccess: e.target.value || undefined })} /></div>
                      <div><span className="label">{t('Хроника: угроза не остановлена')}</span><textarea rows={2} className="input" maxLength={L.hazardStory} placeholder={t('Крысы прогрызают трюм и портят провизию.')} value={h.onFail ?? ''} onChange={(e) => setHazard(s.id, h.id, { onFail: e.target.value || undefined })} /></div>
                    </div>
                    <div><span className="label">{t('Нейтрализуют навыки/теги (через запятую)')}</span><ListInput value={h.counters} onCommit={(v) => setHazard(s.id, h.id, { counters: v })} placeholder={t('дератизация, санитария')} maxItems={L.hazardCounters} maxLen={L.tagLen} /></div>
                  </div>
                ))}
                <button className="btn btn-sm" disabled={(s.hazards ?? []).length >= L.hazards} onClick={() => setScenario(s.id, { hazards: [...(s.hazards ?? []), { id: uid('hz'), title: '', description: '', counters: [], severity: 'major' }] })}><Plus size={14} /> {t('Добавить угрозу')}</button>
              </div>
            </div>
          ))}
          <button className="btn" disabled={pack.scenarios.length >= L.scenarios} onClick={() => save({ ...pack, scenarios: [...pack.scenarios, { id: uid('sc'), title: t('Новая катастрофа'), description: '', shelterSlots: 4, isolationDuration: '1 год', requiredSkills: [], threats: [] }] })}><Plus size={16} /> {t('Добавить сценарий ({n}/{max})', { n: pack.scenarios.length, max: L.scenarios })}</button>
        </div>
      )}

      {CATEGORIES.includes(tab as Category) && (() => {
        const cat = tab as Category;
        const Icon = CATEGORY_ICON[cat];
        return (
          <div className="flex flex-col gap-3">
            <h2 className="h-hud flex items-center gap-2"><Icon size={16} /> {categoryLabel(cat)} <span className="text-dim">({pack.cards[cat].length})</span></h2>
            {pack.cards[cat].length > 6 && (
              <div>
                <input className="input" type="search" placeholder={t('Поиск по тексту, названию и тегам')} aria-label={t('Поиск карт')} value={query} onChange={(e) => setQuery(e.target.value)} />
                {query.trim() && <p className="mt-1 text-xs text-dim">{t('Найдено {found} из {total}', { found: filterCards(pack.cards[cat], query).length, total: pack.cards[cat].length })}</p>}
              </div>
            )}
            {filterCards(pack.cards[cat], query).map((c) => {
              const patch = (p: Partial<Card>) => setCards(cat, pack.cards[cat].map((x) => (x.id === c.id ? { ...x, ...p } : x)));
              return (
                <div key={c.id} className="panel flex flex-col gap-2 p-3">
                  {cat === 'action' && <input className="input" maxLength={L.cardTitle} placeholder={t('Название действия')} value={c.title ?? ''} onChange={(e) => patch({ title: e.target.value })} />}
                  {cat === 'action' && (
                    <select className="input" aria-label={t('Эффект карты при автоисполнении')} value={c.effect ?? ''} onChange={(e) => patch({ effect: (e.target.value || undefined) as Card['effect'] })}>
                      <option value="">{t('Без эффекта: действие только объявляется')}</option>
                      {Object.entries(ACTION_EFFECTS).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
                    </select>
                  )}
                  <div><textarea rows={2} maxLength={L.cardDescription} className="input" placeholder={t('Описание карты')} value={c.description} onChange={(e) => patch({ description: e.target.value })} /><Counter v={c.description} max={L.cardDescription} /></div>
                  <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                    <select className="input" value={c.modifier ?? 'neutral'} onChange={(e) => patch({ modifier: e.target.value as Modifier })}>
                      {MOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                    </select>
                    <ListInput value={c.tags ?? []} onCommit={(v) => patch({ tags: v.length ? v : undefined })} placeholder={t('теги-навыки: медицина, связь')} maxItems={L.cardTags} maxLen={L.tagLen} />
                    <button className="btn btn-danger btn-sm" aria-label={t('удалить')} onClick={() => setCards(cat, pack.cards[cat].filter((x) => x.id !== c.id))}><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
            <button className="btn" disabled={pack.cards[cat].length >= L.cardsPerCategory} onClick={() => setCards(cat, [...pack.cards[cat], { id: uid('c'), category: cat, description: '', modifier: 'neutral' }])}><Plus size={16} /> {t('Добавить карту ({n}/{max})', { n: pack.cards[cat].length, max: L.cardsPerCategory })}</button>
            <details className="panel p-3">
              <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">{t('Массовое добавление')}</summary>
              <p className="my-2 text-xs text-dim">{t('По карте в строке:')} <code>Текст | + | тег1, тег2</code> {t('(знак «+», «-» или пусто; теги необязательны).')}</p>
              <textarea rows={5} className="input" value={bulk} onChange={(e) => setBulk(e.target.value)} />
              <button className="btn btn-sm mt-2" disabled={!bulk.trim()} onClick={() => addBulk(cat)}>{t('Добавить')}</button>
            </details>
          </div>
        );
      })()}
    </div>
  );
}
