import { useState } from 'react';
import { ArrowLeft, Download, Link2, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { CATEGORIES, CATEGORY_LABEL, type Card, type CardPack, type Category, type Modifier, type Scenario } from '../types';
import { exportPackFile, shareUrl } from '../lib/packs';
import { uid } from '../lib/rng';
import { CATEGORY_ICON } from '../ui/bits';

/** Поле «список через запятую/строки»: фиксирует значение на blur, чтобы курсор не прыгал при вводе. */
function ListInput({ value, onCommit, multiline = false, placeholder }: { value: string[]; onCommit: (v: string[]) => void; multiline?: boolean; placeholder?: string }) {
  const sep = multiline ? '\n' : ', ';
  const [text, setText] = useState(value.join(sep));
  const commit = () => onCommit(text.split(multiline ? /\n/ : /[,;]/).map((s) => s.trim()).filter(Boolean));
  const props = { value: text, placeholder, className: 'input', onChange: (e: { target: { value: string } }) => setText(e.target.value), onBlur: commit };
  return multiline ? <textarea rows={3} {...props} /> : <input {...props} />;
}

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
  const setScenario = (id: string, patch: Partial<Scenario>) =>
    save({ ...pack, scenarios: pack.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const addBulk = (cat: Category) => {
    // Формат строки: «Текст | + | тег1, тег2» (знак и теги необязательны)
    const added: Card[] = bulk.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [desc, mod, tags] = line.split('|').map((s) => s.trim());
      const modifier: Modifier = mod === '+' ? 'positive' : mod === '-' || mod === '−' ? 'negative' : 'neutral';
      return { id: uid('c'), category: cat, description: desc.slice(0, 600), modifier, ...(tags ? { tags: tags.split(/[,;]/).map((t) => t.trim()).filter(Boolean) } : {}) };
    });
    setCards(cat, [...pack.cards[cat], ...added]);
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
          <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(shareUrl(pack)).then(() => notify('Ссылка скопирована'), () => notify('Не удалось скопировать'))}><Link2 size={14} /> Ссылка</button>
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
          <div><span className="label">Название</span><input className="input" maxLength={120} value={pack.name} onChange={(e) => save({ ...pack, name: e.target.value })} /></div>
          <div><span className="label">Описание</span><textarea rows={3} className="input" value={pack.description} onChange={(e) => save({ ...pack, description: e.target.value })} /></div>
        </div>
      )}

      {tab === 'scenarios' && (
        <div className="flex flex-col gap-3">
          {pack.scenarios.map((s) => (
            <div key={s.id} className="panel flex flex-col gap-3">
              <div className="flex gap-2">
                <input className="input font-bold" placeholder="Название катастрофы" value={s.title} onChange={(e) => setScenario(s.id, { title: e.target.value })} />
                <button className="btn btn-danger btn-sm" aria-label="удалить" onClick={() => confirm('Удалить сценарий?') && save({ ...pack, scenarios: pack.scenarios.filter((x) => x.id !== s.id) })}><Trash2 size={14} /></button>
              </div>
              <textarea rows={3} className="input" placeholder="Описание" value={s.description} onChange={(e) => setScenario(s.id, { description: e.target.value })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div><span className="label">Мест по умолчанию</span><input type="number" min={1} max={19} className="input" value={s.shelterSlots} onChange={(e) => setScenario(s.id, { shelterSlots: Math.min(19, Math.max(1, Number(e.target.value) || 1)) })} /></div>
                <div><span className="label">Срок изоляции</span><input className="input" placeholder="например, 3 года" value={s.isolationDuration} onChange={(e) => setScenario(s.id, { isolationDuration: e.target.value })} /></div>
              </div>
              <div><span className="label">Требуемые навыки (через запятую)</span><ListInput value={s.requiredSkills} onCommit={(v) => setScenario(s.id, { requiredSkills: v })} placeholder="медицина, агрономия" /></div>
              <div><span className="label">Угрозы (по одной в строке)</span><ListInput multiline value={s.threats} onCommit={(v) => setScenario(s.id, { threats: v })} /></div>
            </div>
          ))}
          <button className="btn" onClick={() => save({ ...pack, scenarios: [...pack.scenarios, { id: uid('sc'), title: 'Новая катастрофа', description: '', shelterSlots: 4, isolationDuration: '1 год', requiredSkills: [], threats: [] }] })}><Plus size={16} /> Добавить сценарий</button>
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
                  {cat === 'action' && <input className="input" placeholder="Название действия" value={c.title ?? ''} onChange={(e) => patch({ title: e.target.value })} />}
                  <textarea rows={2} className="input" placeholder="Описание карты" value={c.description} onChange={(e) => patch({ description: e.target.value })} />
                  <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                    <select className="input" value={c.modifier ?? 'neutral'} onChange={(e) => patch({ modifier: e.target.value as Modifier })}>
                      {MOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <ListInput value={c.tags ?? []} onCommit={(v) => patch({ tags: v.length ? v : undefined })} placeholder="теги-навыки: медицина, связь" />
                    <button className="btn btn-danger btn-sm" aria-label="удалить" onClick={() => setCards(cat, pack.cards[cat].filter((x) => x.id !== c.id))}><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
            <button className="btn" onClick={() => setCards(cat, [...pack.cards[cat], { id: uid('c'), category: cat, description: '', modifier: 'neutral' }])}><Plus size={16} /> Добавить карту</button>
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
