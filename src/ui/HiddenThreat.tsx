import { useState } from 'react';
import { Lock, Shield } from 'lucide-react';
import type { GameState } from '../types';
import { t, tPacked } from '../lib/i18n';
import { randomToken } from '../lib/rng';
import { itemsOf } from '../lib/inventory';
import { viewFor } from '../lib/online';
import { allSecretReady, finishSecret, submitSecret } from '../lib/threat/engine';
import { auxiliaryAction, type Auxiliary } from '../lib/threat/economy';
import { isCriminal, ROLE_LABELS } from '../lib/threat/roles';
import { EVIDENCE_LABELS } from '../lib/threat/investigations';
import { EVIDENCE_KINDS, type EvidenceKind, type Investigation, type SecretCommand, type SecretOperation, type SecretRole } from '../lib/threat/types';
import { Gate } from './Gate';
import { Modal } from './bits';
import { useStore } from '../store';
import { auditLabel } from '../lib/threat/chronicle';

const GOALS: Record<SecretRole, string> = {
  civilian: 'Не допустить преступников в убежище и сохранить полезных специалистов.',
  officer: 'Расследуйте скрытно. Находки не исключают людей: решение принимает голосование.',
  maniac: 'Ваша цель — лично попасть в убежище. Убийств нет.',
  mafia: 'Ваша цель — провести хотя бы одного союзника в убежище. Убийств нет.',
};
const DIRECTIONS: Record<Investigation, string> = { connections: 'Проверка связей', dossier: 'Проверка досье', actions: 'Проверка действий' };

export function ThreatPublic({ game }: { game: GameState }) {
  const v = game.threatView;
  const publications = v?.publications ?? game.hiddenThreat?.publications ?? [];
  const reports = v?.reports ?? game.hiddenThreat?.reports ?? [];
  if (game.config.variant !== 'hidden-threat') return null;
  return <section className="panel flex flex-col gap-2">
    <h2 className="h-hud"><Shield size={16} className="mr-2 inline" />{t('Скрытая угроза')}</h2>
    <p className="text-xs text-dim">{t('Находки не доказывают виновность. Исключение — только голосованием.')}</p>
    {reports.filter(r => r.round === game.round && r.active).map(r => <p key={r.round} className="text-sm" role="status">{r.checks === undefined ? t('Зафиксирована активность в системе безопасности. Подробности засекречены.') : t('Активность безопасности: проверки — {checks}, саботажи — {sabotages}. Подробности засекречены.', { checks: r.checks, sabotages: r.sabotages ?? 0 })}</p>)}
    {publications.map((p, i) => <article key={i} className="rounded border border-edge p-3 text-sm">
      <p className="label">{t('Системная находка · анонимная публикация')} · {game.players.find(x => x.id === p.target)?.name}</p>
      <p>{tPacked(p.text)}</p>{p.analysis && <p className="mt-2 text-amber">{t(p.analysis)}</p>}
    </article>)}
    {['secret', 'secret-review'].includes(game.phase) && <p className="text-xs">{t(game.phase === 'secret-review' ? 'Получите личные результаты и подтвердите готовность. Публикации появятся после подтверждения всех участников.' : 'Закрытая фаза: каждый отправляет действие или пропуск. Затем обсуждение и голосование.')}</p>}
  </section>;
}

/** Receives only one recipient's DTO, including when mounted inside the local handoff curtain. */
export function ThreatPrivate({ view, me, submit, auxiliary, close }: { view: GameState; me: string; submit: (command: SecretCommand) => void; auxiliary: (kind: Auxiliary, target: string, itemId?: string) => void; close: () => void }) {
  const own = view.threatView?.me;
  const [target, setTarget] = useState('');
  const [direction, setDirection] = useState<Investigation>('dossier');
  const [evidence, setEvidence] = useState<EvidenceKind>('identity');
  const [operation, setOperation] = useState<SecretOperation['kind']>('skip');
  const [findingId, setFinding] = useState('');
  const [publish, setPublish] = useState<string[]>([]);
  const [item, setItem] = useState('');
  if (!own || own.playerId !== me) return null;
  const player = view.players.find(p => p.id === me)!;
  const active = !player.isEliminated;
  const crime = isCriminal(own.role);
  const secret = ['secret', 'secret-review'].includes(view.phase) && active && !own.submitted;
  const checkAllowed = view.phase === 'secret' && own.role === 'officer' && own.checks < 2 && own.lastCheckRound !== view.round && (own.checks === 0 || own.points >= 3);
  const sabotageAllowed = view.phase === 'secret' && crime && (own.sabotageUses ?? 2) < 2 && own.sabotageRound !== view.round && (own.sabotageUses === 0 || own.points >= 3);
  const findings = own.results.filter(r => r.evidenceId && !r.analyzed);
  const chooseTarget = <label className="label">{t('Живой кандидат')}<select className="input mt-1" value={target} onChange={e => setTarget(e.target.value)}><option value="">{t('выберите…')}</option>{view.players.filter(p => p.id !== me && !p.isEliminated).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>;
  const confirm = () => {
    const op: SecretOperation = operation === 'investigate' ? { kind: operation, target, direction } : operation === 'plant' || operation === 'forge' ? { kind: operation, target, evidence } : operation === 'analyze' ? { kind: operation, findingId } : { kind: 'skip' };
    submit({ id: randomToken(), round: view.round, operation: op, ...(publish.length ? { publish } : {}) });
    close();
  };
  return <div className="no-print flex flex-col gap-3">
    <h2 className="h-hud">{player.name} · {t('Личный кабинет')}</h2>
    <p className="text-xl font-bold text-amber">{t(ROLE_LABELS[own.role])}</p><p className="text-sm">{t(GOALS[own.role])}</p>
    {own.role !== 'civilian' && <p>{t('Личные очки: {n}', { n: own.points })}</p>}
    {own.role === 'officer' && <p className="text-xs text-dim">{t('Проверок использовано: {n}/2. Первая бесплатна, следующая стоит 3 очка. Не более одной за круг.', { n: own.checks })}</p>}
    {crime && <p className="text-xs text-dim">{t('Саботажей команды: {n}/2. Первый бесплатен, следующий стоит 3 очка исполнителя. Один на команду за круг.', { n: own.sabotageUses ?? 0 })}</p>}
    {own.allies.length > 0 && <p>{t('Союзники мафии: {names}', { names: own.allies.map(id => view.players.find(p => p.id === id)?.name).join(', ') })}</p>}
    {own.notices.map((text, i) => <p key={i} className="rounded border border-amber p-2 text-sm" role="status">{t(text)}</p>)}
    {own.results.map(r => <article key={r.id} className="rounded border border-edge p-3 text-sm"><p className="label">{t(DIRECTIONS[r.direction])} · {view.players.find(p => p.id === r.target)?.name} · {t('раунд {n}', { n: r.round })}</p><p>{tPacked(r.text)}</p>{r.analysis && <p className="mt-2 text-amber">{t(r.analysis)}</p>}
      {secret && view.phase === 'secret-review' && !view.threatView?.publications.some(p => p.target === r.target && p.direction === r.direction && p.text === r.text && p.analysis === r.analysis) && <label className="mt-2 flex gap-2"><input type="checkbox" checked={publish.includes(r.id)} onChange={e => setPublish(ids => e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id))} />{t('Опубликовать анонимно в конце круга')}</label>}
    </article>)}
    {active && ['reveal', 'speech'].includes(view.phase) && !own.auxiliaryUsed && <section className="flex flex-col gap-2 rounded border border-edge p-3">
      <h3 className="label">{t('Общие вспомогательные действия')}</h3>
      <p className="text-xs text-dim">{t('Один раз за круг, до трёх за партию. Поддержка и конфликт меняют характер кандидата один раз за партию. Передача перемещает настоящий предмет. Очки начисляются только за реальный результат.')}</p>
      {chooseTarget}
      <div className="grid gap-2 sm:grid-cols-2"><button className="btn btn-sm" disabled={!target} onClick={() => auxiliary('assist', target)}>{t('Поддержать кандидата')}</button><button className="btn btn-sm" disabled={!target} onClick={() => auxiliary('obstruct', target)}>{t('Спровоцировать конфликт')}</button></div>
      <select className="input" aria-label={t('Передать предмет')} value={item} onChange={e => setItem(e.target.value)}><option value="">{t('выберите…')}</option>{itemsOf(player.slots.luggage.card).map((i, index) => <option key={index} value={i.id}>{tPacked(i.description)}</option>)}</select>
      <button className="btn btn-sm" disabled={!target || !item} onClick={() => auxiliary('transfer', target, item)}>{t('Передать предмет')}</button>
    </section>}
    {secret && <section className="flex flex-col gap-2 rounded border border-edge p-3">
      <h3 className="label">{t('Секретное действие')}</h3>
      <select className="input" aria-label={t('Секретное действие')} value={operation} onChange={e => setOperation(e.target.value as SecretOperation['kind'])}>
        <option value="skip">{t('Пропустить')}</option>
        {checkAllowed && <option value="investigate">{t('Расследовать')}</option>}
        {view.phase === 'secret' && own.role === 'officer' && own.points >= 2 && findings.length > 0 && <option value="analyze">{t('Повторная экспертиза · 2 очка')}</option>}
        {sabotageAllowed && <><option value="plant">{t('Подбросить улику')}</option><option value="forge">{t('Подмена документов')}</option></>}
      </select>
      {['investigate', 'plant', 'forge'].includes(operation) && chooseTarget}
      {operation === 'investigate' && <select className="input" aria-label={t('Направление расследования')} value={direction} onChange={e => setDirection(e.target.value as Investigation)}>{Object.entries(DIRECTIONS).map(([id, text]) => <option key={id} value={id}>{t(text)}</option>)}</select>}
      {(operation === 'plant' || operation === 'forge') && <select className="input" aria-label={t('Тип улики')} value={evidence} onChange={e => setEvidence(e.target.value as EvidenceKind)}>{EVIDENCE_KINDS.map(id => <option key={id} value={id}>{t(EVIDENCE_LABELS[id])}</option>)}</select>}
      {operation === 'analyze' && <select className="input" aria-label={t('Повторная экспертиза · 2 очка')} value={findingId} onChange={e => setFinding(e.target.value)}><option value="">{t('выберите…')}</option>{findings.map(r => <option key={r.id} value={r.id}>{view.players.find(p => p.id === r.target)?.name} · {t('раунд {n}', { n: r.round })}</option>)}</select>}
      <button className="btn btn-primary" disabled={['investigate', 'plant', 'forge'].includes(operation) ? !target : operation === 'analyze' ? !findingId : false} onClick={confirm}>{t('Отправить и скрыть')}</button>
    </section>}
    {own.submitted && <p className="text-sm text-dim">{t('Решение принято. Результаты будут доступны после окончания закрытой фазы.')}</p>}
    <button className="btn" onClick={close}>{t('Скрыть')}</button>
  </div>;
}

export function ThreatLocal({ game, update }: { game: GameState; update: (f: (g: GameState) => GameState) => void }) {
  const { notify } = useStore();
  const [owner, setOwner] = useState<string | null>(null);
  const player = game.players.find(p => p.id === owner);
  const ready = game.hiddenThreat?.pending.map(p => p.actor) ?? [];
  return <>
    <ThreatPublic game={game} />
    <section className="panel flex flex-col gap-2 no-print"><h2 className="label">{t('Личные кабинеты · передавайте устройство')}</h2><p className="text-xs text-dim">{t('Откройте только свой кабинет. Перед передачей нажмите «Скрыть».')}</p>
      {['secret', 'secret-review'].includes(game.phase) && <p className="text-xs">{t('Готовы: {n}/{total}', { n: ready.length, total: game.players.filter(p => !p.isEliminated).length })}</p>}
      <div className="flex flex-wrap gap-2">{game.players.map(p => <button className="btn btn-sm" key={p.id} onClick={() => setOwner(p.id)}><Lock size={14} />{p.name}{ready.includes(p.id) ? ' ✓' : ''}</button>)}</div>
    </section>
    {player && <Modal><Gate key={`${game.round}-${game.phase}-${player.id}`} name={player.name}><ThreatPrivate key={`${game.round}-${game.phase}-${player.id}`} view={viewFor(game, player.id)} me={player.id} close={() => setOwner(null)} auxiliary={(kind, target, item) => { if (auxiliaryAction(game, player.id, target, kind, item) === game) notify(t('Действие не сработало')); else update(g => auxiliaryAction(g, player.id, target, kind, item)); }} submit={command => update(g => { const next = submitSecret(g, player.id, command); return allSecretReady(next) ? finishSecret(next) : next; })} /></Gate></Modal>}
  </>;
}

export function ThreatFinal({ game }: { game: GameState }) {
  if (game.phase !== 'final') return null;
  const materials = game.threatView?.final ?? (game.hiddenThreat ? viewFor(game, '').threatView?.final : undefined);
  if (!materials) return null;
  const names = (id?: string) => game.players.find(p => p.id === id)?.name ?? '';
  return <section className="panel flex flex-col gap-3">
    <h2 className="h-hud">{t('Рассекреченные материалы')}</h2>
    <p className="text-amber">{t(materials.outcome.civilians ? 'Мирные победили: преступники не проникли.' : materials.outcome.mafia ? 'Мафия проникла в убежище.' : 'Маньяк проник в убежище.')}</p>
    <p className="text-xs text-dim">{t('Социальная победа и выживание убежища оцениваются отдельно.')}</p>
    <ul className="text-sm">{game.players.map(p => <li key={p.id}>{p.name}: <b>{t(ROLE_LABELS[materials.roles[p.id]])}</b> · {t(p.isEliminated ? 'исключён' : 'в игре')}</li>)}</ul>
    <ol className="flex flex-col gap-2 text-sm">{materials.audit.map((a, i) => <li key={i}>[{a.round}] {names(a.actor)}{a.target ? ` → ${names(a.target)}` : ''} · <b>{auditLabel(a)}</b>: {tPacked(a.text)}{a.points ? ` (+${a.points})` : ''}</li>)}</ol>
  </section>;
}
