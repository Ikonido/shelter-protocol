import { useState } from 'react';
import { ArrowLeft, Download, Link2, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { CATEGORIES, CATEGORY_LABEL, type Card, type CardPack, type Category, type Hazard, type Modifier, type Scenario, type Severity } from '../types';
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
      <span className="mt-1 block text-right text-[10px] text-dim">до {maxItems} шт. по {maxLen} симв.</span>
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
  if (!pack) {
    return <div className="py-10 text-center"><p className="mb-4">Пак не найден.</p><button className="btn" onClick={() => go({ name: 'packs' })}>К пакам</button></div>;
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
    notify(`Добавлено карт: ${added.length}`);
  };

  const tabs: ['info' | 'scenarios' | Category, string][] = [['info', 'Инфо'], ['scenarios', `Сценарии (${pack.scenarios.length})`], ...CATEGORIES.map((c): [Category, string] => [c, `${CATEGORY_LABEL[c]} (${pack.cards[c].length})`])];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={() => go({ name: 'packs' })}><ArrowLeft size={16} /> Паки</button>
        <h1 className="truncate text-sm font-bold text-amber">{pack.name}</h1>
        <div className="ml-auto flex gap-2">
          <button className="btn btn-sm" onClick={() => exportPackFile(pack)}><Download size={14} /> JSON</button>
          <button className="btn btn-sm" onClick={async () => { const u = shareUrl(pack); notify(!u ? 'Пак слишком большой для ссылки — используйте JSON-файл' : (await copyText(u)) ? 'Ссылка скопирована' : 'Не удалось скопировать'); }}><Link2 size={14} /> Ссылка</button>
        </div>
      </div>
      <p className="text-[10px] uppercase tracking-widest text-dim">Изменения сохраняются автоматически</p>

      <nav className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(([id, label]) => (
          <button key={id} className={`btn btn-sm shrink-0 ${tab === id ? 'btn-primary' : ''}`} onClick={() => { setTab(id); setBulk(''); }}>{label}</button>
        ))}
      </nav>

      {tab === 'info' && (
        <div className="panel flex flex-col gap-3">
          <div><span className="label">Название</span><input className="input" maxLength={L.packName} value={pack.name} onChange={(e) => save({ ...pack, name: e.target.value })} /><Counter v={pack.name} max={L.packName} /></div>
          <div><span className="label">Описание</span><textarea rows={3} maxLength={L.packDescription} className="input" value={pack.description} onChange={(e) => save({ ...pack, description: e.target.value })} /><Counter v={pack.description} max={L.packDescription} /></div>
        </div>
      )}

      {tab === 'scenarios' && (
        <div className="flex flex-col gap-3">
          {pack.scenarios.map((s) => (
            <div key={s.id} className="panel flex flex-col gap-3">
              <div className="flex gap-2">
                <input className="input font-bold" maxLength={L.scenarioTitle} placeholder="Название катастрофы" value={s.title} onChange={(e) => setScenario(s.id, { title: e.target.value })} />
                <button className="btn btn-danger btn-sm" aria-label="удалить" onClick={() => confirm('Удалить сценарий?') && save({ ...pack, scenarios: pack.scenarios.filter((x) => x.id !== s.id) })}><Trash2 size={14} /></button>
              </div>
              <div><textarea rows={3} maxLength={L.scenarioDescription} className="input" placeholder="Описание" value={s.description} onChange={(e) => setScenario(s.id, { description: e.target.value })} /><Counter v={s.description} max={L.scenarioDescription} /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><span className="label">Мест по умолчанию</span><input type="number" min={1} max={19} className="input" value={s.shelterSlots} onChange={(e) => setScenario(s.id, { shelterSlots: Math.min(19, Math.max(1, Number(e.target.value) || 1)) })} /></div>
                <div><span className="label">Срок изоляции</span><input className="input" maxLength={L.scenarioDuration} placeholder="например, 3 года" value={s.isolationDuration} onChange={(e) => setScenario(s.id, { isolationDuration: e.target.value })} /></div>
              </div>
              <div><span className="label">Требуемые навыки (через запятую)</span><ListInput value={s.requiredSkills} onCommit={(v) => setScenario(s.id, { requiredSkills: v })} placeholder="медицина, агрономия" maxItems={L.skills} maxLen={L.skillLen} /></div>
              <div><span className="label">Угрозы (по одной в строке)</span><ListInput multiline value={s.threats} onCommit={(v) => setScenario(s.id, { threats: v })} maxItems={L.threats} maxLen={L.threatLen} /></div>
              <div className="flex flex-col gap-2">
                <span className="label">Факторы угрозы: в партию берётся случайный набор ({(s.hazards ?? []).length}/{L.hazards})</span>
                {(s.hazards ?? []).map((h) => (
                  <div key={h.id} className="rounded-md border border-edge p-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input className="input" maxLength={L.hazardTitle} placeholder="Например: Крысы на корабле" value={h.title} onChange={(e) => setHazard(s.id, h.id, { title: e.target.value })} />
                      <button className="btn btn-danger btn-sm" aria-label="удалить угрозу" onClick={() => setScenario(s.id, { hazards: (s.hazards ?? []).filter((x) => x.id !== h.id) })}><Trash2 size={14} /></button>
                    </div>
                    <textarea rows={2} className="input" maxLength={L.hazardDescription} placeholder="Описание" value={h.description} onChange={(e) => setHazard(s.id, h.id, { description: e.target.value })} />
                    <select className="input" value={h.severity} onChange={(e) => setHazard(s.id, h.id, { severity: e.target.value as Severity })}>
                      {SEVERITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <div><span className="label">Нейтрализуют навыки/теги (через запятую)</span><ListInput value={h.counters} onCommit={(v) => setHazard(s.id, h.id, { counters: v })} placeholder="дератизация, санитария" maxItems={L.hazardCounters} maxLen={L.tagLen} /></div>
                  </div>
                ))}
                <button className="btn btn-sm" disabled={(s.hazards ?? []).length >= L.hazards} onClick={() => setScenario(s.id, { hazards: [...(s.hazards ?? []), { id: uid('hz'), title: '', description: '', counters: [], severity: 'major' }] })}><Plus size={14} /> Добавить угрозу</button>
              </div>
            </div>
          ))}
          <button className="btn" disabled={pack.scenarios.length >= L.scenarios} onClick={() => save({ ...pack, scenarios: [...pack.scenarios, { id: uid('sc'), title: 'Новая катастрофа', description: '', shelterSlots: 4, isolationDuration: '1 год', requiredSkills: [], threats: [] }] })}><Plus size={16} /> Добавить сценарий ({pack.scenarios.length}/{L.scenarios})</button>
        </div>
      )}

      {CATEGORIES.includes(tab as Category) && (() => {
        const cat = tab as Category;
        const Icon = CATEGORY_ICON[cat];
        return (
          <div className="flex flex-col gap-3">
            <h2 className="h-hud flex items-center gap-2"><Icon size={16} /> {CATEGORY_LABEL[cat]}</h2>
            {pack.cards[cat].map((c) => {
              const patch = (p: Partial<Card>) => setCards(cat, pack.cards[cat].map((x) => (x.id === c.id ? { ...x, ...p } : x)));
              return (
                <div key={c.id} className="panel flex flex-col gap-2 p-3">
                  {cat === 'action' && <input className="input" maxLength={L.cardTitle} placeholder="Название действия" value={c.title ?? ''} onChange={(e) => patch({ title: e.target.value })} />}
                  <div><textarea rows={2} maxLength={L.cardDescription} className="input" placeholder="Описание карты" value={c.description} onChange={(e) => patch({ description: e.target.value })} /><Counter v={c.description} max={L.cardDescription} /></div>
                  <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                    <select className="input" value={c.modifier ?? 'neutral'} onChange={(e) => patch({ modifier: e.target.value as Modifier })}>
                      {MOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <ListInput value={c.tags ?? []} onCommit={(v) => patch({ tags: v.length ? v : undefined })} placeholder="теги-навыки: медицина, связь" maxItems={L.cardTags} maxLen={L.tagLen} />
                    <button className="btn btn-danger btn-sm" aria-label="удалить" onClick={() => setCards(cat, pack.cards[cat].filter((x) => x.id !== c.id))}><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
            <button className="btn" disabled={pack.cards[cat].length >= L.cardsPerCategory} onClick={() => setCards(cat, [...pack.cards[cat], { id: uid('c'), category: cat, description: '', modifier: 'neutral' }])}><Plus size={16} /> Добавить карту ({pack.cards[cat].length}/{L.cardsPerCategory})</button>
            <details className="panel p-3">
              <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">Массовое добавление</summary>
              <p className="my-2 text-xs text-dim">По карте в строке: <code>Текст | + | тег1, тег2</code> (знак «+», «-» или пусто; теги необязательны).</p>
              <textarea rows={5} className="input" value={bulk} onChange={(e) => setBulk(e.target.value)} />
              <button className="btn btn-sm mt-2" disabled={!bulk.trim()} onClick={() => addBulk(cat)}>Добавить</button>
            </details>
          </div>
        );
      })()}
    </div>
  );
}
