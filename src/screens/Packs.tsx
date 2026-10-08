import { ArrowLeft, Copy, Download, FilePlus2, Link2, Pencil, Trash2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { clonePack, emptyPack, exportPackFile, importPackFile, packStats, shareUrl } from '../lib/packs';
import { uid } from '../lib/rng';
import { copyText } from '../ui/clipboard';
import type { CardPack } from '../types';
import { t, plural } from '../lib/i18n';

export default function Packs() {
  const { allPacks, upsertPack, removePack, go, notify } = useStore();

  const share = async (p: CardPack) => {
    const url = shareUrl(p);
    if (!url) return notify(t('Пак слишком большой для ссылки — передайте его файлом (JSON)'));
    if (await copyText(url)) notify(t('Ссылка на пак скопирована'));
    else prompt(t('Скопируйте ссылку:'), url);
  };
  const doImport = async () => {
    try {
      const pack = await importPackFile();
      if (pack) {
        upsertPack({ ...pack, id: uid('pack') });
        notify(t('Импортирован пак «{name}»', { name: pack.name }));
      }
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const create = () => {
    const p = emptyPack();
    upsertPack(p);
    go({ name: 'editor', packId: p.id });
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-6">
      <button className="btn btn-sm self-start" onClick={() => go({ name: 'home' })}><ArrowLeft size={16} /> {t('Назад')}</button>
      <h1 className="h-hud text-base">{t('Паки карт')}</h1>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={create}><FilePlus2 size={18} /> {t('Создать пак')}</button>
        <button className="btn" onClick={doImport}><Upload size={18} /> {t('Импорт JSON')}</button>
      </div>

      {allPacks.map((p) => {
        const s = packStats(p);
        return (
          <article key={p.id} className="panel flex flex-col gap-2">
            <div>
              <h2 className="font-bold text-amber">{p.name} {!p.isCustom && <span className="text-xs font-normal text-dim">{t('[встроенный]')}</span>}</h2>
              <p className="text-xs text-dim">{p.description || t('Без описания')}</p>
              <p className="mt-1 text-xs">{s.scenarios} {plural(s.scenarios, ['сценарий', 'сценария', 'сценариев'], ['сценарій', 'сценарії', 'сценаріїв'])} · {s.cards} {plural(s.cards, ['карта', 'карты', 'карт'], ['картка', 'картки', 'карток'])}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {p.isCustom && <button className="btn btn-sm" onClick={() => go({ name: 'editor', packId: p.id })}><Pencil size={14} /> {t('Править')}</button>}
              <button className="btn btn-sm" onClick={() => { const c = clonePack(p); upsertPack(c); notify(t('Копия создана')); }}><Copy size={14} /> {t('Дублировать')}</button>
              <button className="btn btn-sm" onClick={() => exportPackFile(p)}><Download size={14} /> JSON</button>
              <button className="btn btn-sm" onClick={() => share(p)}><Link2 size={14} /> {t('Ссылка')}</button>
              {p.isCustom && (
                <button className="btn btn-sm btn-danger" onClick={() => confirm(t('Удалить пак «{name}»?', { name: p.name })) && removePack(p.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
