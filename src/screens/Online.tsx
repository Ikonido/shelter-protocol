import { useEffect, useReducer, useState } from 'react';
import { ArrowLeft, Camera, Copy, Lock, LogIn, RefreshCw, Unlock, UserX, Users, Wifi, WifiOff, Zap } from 'lucide-react';
import { useStore, type OnlineDraft } from '../store';
import { OnlineClient, OnlineHost, type C2H, type Conn, type H2C } from '../lib/online';
import { QRScanner } from '../ui/QRScanner';
import { createRoom, isValidCode, isValidTicket, joinRoom, normalizeCode, probeLan, shareOrigin, type NetMode } from '../lib/net';
import { randomToken } from '../lib/rng';
import { plural, t, tPacked } from '../lib/i18n';
import { copyText } from '../ui/clipboard';
import { QR } from '../ui/QR';
import { ABSTAIN, alive, currentSpeaker, perVote, quotaThisRound, revealOptions, stepOf } from '../lib/game';
import { CATEGORIES, categoryLabel, type Category, type GameState } from '../types';
import { CardFace, Stepper } from '../ui/bits';
import { Board } from '../ui/Board';
import { GameHud } from '../ui/GameHud';
import { SpeechTimer } from '../ui/SpeechTimer';
import { SkillsStrip } from '../ui/SkillsStrip';
import { ActionTargetPicker } from '../ui/ActionTarget';
import { PerkPanel } from '../ui/PerkPanel';
import { needsTarget } from '../lib/actions';
import { signal } from '../lib/feedback';
import { ThreatsPanel } from '../ui/Threats';
import { Avatar } from '../ui/Avatar';
import { Tally } from '../ui/Tally';
import { EventCard } from '../ui/EventCard';
import { MatchClock } from '../ui/MatchClock';
import { FinalReport } from './Final';
import { ThreatPrivate, ThreatPublic } from '../ui/HiddenThreat';
import { Gate } from '../ui/Gate';
import { Modal } from '../ui/bits';
import { validateThreatConfig } from '../lib/threat/roles';
import { clearHostedRoom, loadHostedRoom, saveHostedRoom } from '../lib/threat/hostStorage';

type Send = (m: Exclude<C2H, { t: 'hello' }>) => void;

/** Перерисовка при изменении внешнего объекта (хост/клиент). */
function useLive(obj: { subscribe(cb: () => void): () => void } | null) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => obj?.subscribe(force), [obj]);
}

const readLS = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ok */ } };
const removeLS = (k: string) => { try { localStorage.removeItem(k); } catch { /* ok */ } };

function NetBadge({ mode }: { mode: NetMode | null }) {
  if (!mode) return null;
  return mode === 'lan' ? (
    <p className="text-xs text-ok">{t('Локальная сеть: интернет не нужен, данные не покидают вашу сеть.')}</p>
  ) : (
    <p className="text-xs text-dim">
      {t('Через интернет: публичный брокер PeerJS и STUN-серверы видят IP-адреса участников и код комнаты, но не содержимое игры (оно шифруется и идёт напрямую). Для полной приватности используйте LAN-режим.')}
    </p>
  );
}

/* ---------- Хост: лобби ---------- */

export function Lobby({ draft, resume = false }: { draft: OnlineDraft; resume?: boolean }) {
  const { go, notify } = useStore();
  const [host, setHost] = useState<OnlineHost | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(readLS('shelter:name') ?? t('Хост'));
  const [slots, setSlots] = useState(draft.slots);
  const [net, setNet] = useState<NetMode | null>(null);
  const [origin, setOrigin] = useState(location.origin);
  const [now, setNow] = useState(Date.now());
  const [attempt, setAttempt] = useState(0);
  useLive(host);
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      host?.tick(); // кончилась речь -> ходит следующий; вышло время партии -> овертайм
    }, 1000);
    return () => clearInterval(t);
  }, [host]);
  useEffect(() => {
    if (net) void shareOrigin(net).then(setOrigin);
  }, [net]);

  useEffect(() => {
    let room: { destroy(): void } | null = null;
    let cancelled = false;
    const saved = resume ? loadHostedRoom() : null;
    const h = saved ? OnlineHost.restore(saved.checkpoint, saved.setup)! : new OnlineHost(draft, readLS('shelter:name') ?? t('Хост'));
    setError(null);
    setHost(h);
    (async () => {
      const mode: NetMode = (await probeLan()) ? 'lan' : 'internet';
      if (cancelled) return;
      setNet(mode);
      const r = await createRoom((c) => h.addConn(c as Conn<H2C>), mode, saved?.code);
      if (cancelled) r.destroy();
      else {
        room = r;
        setCode(r.code);
      }
    })().catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      room?.destroy();
      h.destroy();
    };
  }, [draft, resume, attempt]);
  useEffect(() => {
    if (!host || !code) return;
    const save = () => saveHostedRoom(code, host);
    save();
    return host.subscribe(save);
  }, [host, code]);

  if (!host) return null;
  // currentTicket() сам выпускает новый билет по истечении срока — QR «живой», старый перестаёт работать.
  const ticket = code ? host.currentTicket() : null;
  const left = ticket ? Math.max(0, Math.ceil((ticket.expiresAt - now) / 1000)) : 0;
  const link = code && ticket ? `${origin}${location.pathname}#join=${code}.${ticket.value}` : '';
  const localhostOnly = net === 'lan' && origin === location.origin && ['localhost', '127.0.0.1'].includes(location.hostname);
  const copy = async (text: string) => notify((await copyText(text)) ? t('Скопировано') : t('Не удалось скопировать'));

  if (host.game) {
    if (!code || error) return <section className="panel flex flex-col gap-3"><p>{error ?? t('Создаём комнату…')}</p>{error && <button className="btn" onClick={() => setAttempt(n => n + 1)}>{t('Повторить восстановление комнаты')}</button>}<button className="btn" onClick={() => go({ name: 'home' })}>{t('В меню')}</button></section>;
    // Хосту часы нужны по его же времени (клиенты получают «осталось» и пересчитывают у себя).
    const view = { ...host.viewFor(0)!, deadline: host.game.deadline };
    return (
      <OnlineGame
        view={view}
        me={host.members[0].playerId!}
        send={(m) => {
          const refusal = host.actAsHost(m);
          if (refusal) notify(t(refusal));
        }}
        host={host}
        onExit={() => { if (host.game?.phase === 'final') clearHostedRoom(); go({ name: 'home' }); }}
      />
    );
  }

  const n = host.members.length;
  const threatError = draft.variant === 'hidden-threat' ? validateThreatConfig(n, host.setup.slots, draft.hiddenThreat!) : null;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <button className="btn btn-sm self-start" onClick={() => go({ name: 'home' })}><ArrowLeft size={16} /> {t('Закрыть комнату')}</button>
      <h1 className="h-hud text-base">{t('Онлайн-комната · {title}', { title: t(draft.scenario.title) })}</h1>
      {draft.adult && <p className="rounded-md border border-danger/60 bg-danger/10 p-2 text-xs text-danger"><b>18+</b>: {t('гости увидят предупреждение о мате и грубом юморе, пока ждут начала. Приглашайте только взрослых.')}</p>}

      <section className="panel text-center">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : code ? (
          <>
            <p className="label">{t('Код комнаты')}</p>
            <p className="text-5xl font-bold tracking-[.3em] text-amber">{code}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button className="btn btn-sm" onClick={() => copy(code)}><Copy size={14} /> {t('Код')}</button>
              <button className="btn btn-sm" onClick={() => copy(link)}><Copy size={14} /> {t('Ссылка-приглашение')}</button>
            </div>
            {link && (
              <div className="mt-4">
                <QR value={link} size={208} label={t('QR-код для входа в комнату {code}', { code })} />
                <p className="mt-2 text-xs text-dim">
                  {t('Временный QR · действует')} <b className="text-amber">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>, {t('затем обновится сам')}
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button className="btn btn-sm" onClick={() => host.rotateTicket()}><RefreshCw size={14} /> {t('Обновить QR')}</button>
                  <label className="btn btn-sm cursor-pointer">
                    <input type="checkbox" className="size-4 accent-amber" checked={host.requireTicket} onChange={(e) => host.setRequireTicket(e.target.checked)} /> {t('Вход только по QR')}
                  </label>
                </div>
                {localhostOnly && <p className="mt-2 text-xs text-danger">{t('Не удалось определить адрес вашего устройства в сети — телефоны могут не открыть QR. Откройте приложение по LAN-адресу из консоли сервера.')}</p>}
              </div>
            )}
            <div className="mt-3"><NetBadge mode={net} /></div>
          </>
        ) : (
          <p className="text-sm text-dim">{t('Создаём комнату…')}</p>
        )}
      </section>

      <section className="panel flex flex-col gap-3">
        <div>
          <span className="label">{t('Ваше имя')}</span>
          <input className="input" maxLength={24} value={name} onChange={(e) => { setName(e.target.value); writeLS('shelter:name', e.target.value); host.rename(e.target.value); }} />
        </div>
        <h2 className="label flex items-center gap-2"><Users size={14} /> {t('Игроки ({n})', { n })}</h2>
        <ul className="text-sm">
          {host.members.map((m, i) => (
            <li key={m.token} className="flex items-center gap-2">
              {m.connected ? <Wifi size={14} className="text-ok" /> : <WifiOff size={14} className="text-danger" />}
              {m.name}{i === 0 && <span className="text-xs text-dim">{t('(хост)')}</span>}
              {i > 0 && (
                <button className="ml-auto text-dim hover:text-danger" aria-label={t('Исключить {name}', { name: m.name })} onClick={() => host.kick(i)}><UserX size={16} /></button>
              )}
            </li>
          ))}
        </ul>
        <Stepper label={t('Мест в бункере (K)')} value={Math.min(slots, Math.max(1, n - 1))} min={1} max={Math.max(1, n - 1)} onChange={(v) => { setSlots(v); host.setup = { ...host.setup, slots: v }; }} />
        <button className="btn btn-sm" onClick={() => host.setLocked(!host.locked)}>
          {host.locked ? <><Unlock size={14} /> {t('Открыть комнату')}</> : <><Lock size={14} /> {t('Закрыть комнату для новых игроков')}</>}
        </button>
        {threatError && <p className="text-xs text-danger">{t(threatError)}</p>}
        <button className="btn btn-primary" disabled={n < 2 || !!threatError || !code} onClick={() => host.start()}>
          {t('Начать игру ({n} {w})', { n, w: plural(n, { ru: ['игрок', 'игрока', 'игроков'], uk: ['гравець', 'гравці', 'гравців'], en: ['player', 'players'], de: ['Spieler', 'Spieler'] }) })}
        </button>
        {n < 2 && <p className="text-xs text-dim">{t('Нужен хотя бы ещё один игрок.')}</p>}
      </section>
    </div>
  );
}

/* ---------- Гость: вход ---------- */

export function Join({ initialCode, initialTicket }: { initialCode?: string; initialTicket?: string }) {
  const { go } = useStore();
  const [code, setCode] = useState(initialCode ?? '');
  const [ticketIn, setTicketIn] = useState(initialTicket);
  const [scanning, setScanning] = useState(false);
  const [name, setName] = useState(readLS('shelter:name') ?? '');
  const [client, setClient] = useState<OnlineClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [net, setNet] = useState<NetMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLive(client);
  useEffect(() => () => client?.destroy(), [client]);
  useEffect(() => void probeLan().then((lan) => setNet(lan ? 'lan' : 'internet')), []);

  const connect = async () => {
    const c = normalizeCode(code);
    const n = name.trim();
    if (!isValidCode(c) || !n) return;
    writeLS('shelter:name', n);
    let token = readLS(`shelter:token:${c}`);
    if (!token) {
      token = randomToken();
      writeLS(`shelter:token:${c}`, token);
    }
    setBusy(true);
    setError(null);
    try {
      const { conn, destroy } = await joinRoom(c, net ?? 'internet');
      const ticket = ticketIn && isValidTicket(ticketIn) ? ticketIn : undefined;
      const cl = new OnlineClient(conn as Conn<C2H>, n, token, ticket);
      const orig = cl.destroy.bind(cl);
      cl.destroy = () => (orig(), destroy());
      setClient(cl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const st = client?.state;
  if (client && st && (st.status === 'game')) {
    return (
      <OnlineGame
        view={st.view}
        me={st.me}
        offline={st.offline}
        notice={st.notice}
        send={(m) => client.send(m)}
        onExit={() => {
          removeLS(`shelter:token:${normalizeCode(code)}`); // токен переподключения больше не нужен
          go({ name: 'home' });
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-6">
      <button className="btn btn-sm self-start" onClick={() => go({ name: 'home' })}><ArrowLeft size={16} /> {t('Назад')}</button>
      <h1 className="h-hud text-base">{t('Вход в онлайн-комнату')}</h1>
      {(!client || st?.status === 'closed' || st?.status === 'rejected') && (
        <section className="panel flex flex-col gap-3">
          {st?.status === 'rejected' && <p className="text-sm text-danger">{t(st.reason)}</p>}
          {st?.status === 'closed' && <p className="text-sm text-danger">{t('Связь с хостом потеряна. Можно переподключиться — ваш персонаж сохранится.')}</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div>
            <span className="label">{t('Код комнаты')}</span>
            <input className="input text-center text-2xl uppercase tracking-[.3em]" value={code} maxLength={5} autoCapitalize="characters" onChange={(e) => { setCode(normalizeCode(e.target.value)); setTicketIn(undefined); }} />
          </div>
          {scanning ? (
            <QRScanner
              onClose={() => setScanning(false)}
              onInvite={(i) => {
                setCode(i.code);
                setTicketIn(i.ticket);
                setScanning(false);
              }}
            />
          ) : (
            <button className="btn" onClick={() => setScanning(true)}><Camera size={18} /> {t('Сканировать QR-код')}</button>
          )}
          <div>
            <span className="label">{t('Ваше имя')}</span>
            <input className="input" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <NetBadge mode={net} />
          <button className="btn btn-primary" disabled={busy || !net || !isValidCode(normalizeCode(code)) || !name.trim()} onClick={() => { client?.destroy(); setClient(null); connect(); }}>
            <LogIn size={18} /> {busy ? t('Подключаемся…') : st?.status === 'closed' ? t('Переподключиться') : t('Войти')}
          </button>
        </section>
      )}
      {st?.status === 'connecting' && <p className="text-center text-sm text-dim">{t('Ожидаем ответ хоста…')}</p>}
      {st?.status === 'lobby' && (
        <section className="panel">
          <p className="text-sm">{t('Вы в комнате. Сценарий:')} <b className="text-amber">{t(st.scenario)}</b></p>
          {st.adult && (
            <p className="mt-2 rounded-md border border-danger/60 bg-danger/10 p-2 text-xs text-danger" role="alert">
              <b>18+</b>: {t('в этой комнате ненормативная лексика и грубый юмор. Если вам нет 18 лет или это не для вас, нажмите «Назад» и выйдите.')}
            </p>
          )}
          <h2 className="label mt-3">{t('Игроки ({n})', { n: st.members.length })}</h2>
          <ul className="text-sm">{st.members.map((m, i) => <li key={i}>{m.name}{i === st.you && t(' (вы)')}</li>)}</ul>
          <p className="mt-3 text-xs text-dim">{t('Ждём, пока хост начнёт игру…')}</p>
        </section>
      )}
    </div>
  );
}

/* ---------- Общий игровой экран (хост и гости) ---------- */

function OnlineGame({ view, me, send, host, onExit, offline = [], notice }: { view: GameState; me: string; send: Send; host?: OnlineHost; onExit: () => void; offline?: string[]; notice?: { text: string; id: number } }) {
  const [privateOpen, setPrivateOpen] = useState(false);
  const { notify: say } = useStore();
  const player = view.players.find((p) => p.id === me)!;
  const living = alive(view);
  const noticeId = notice?.id;
  useEffect(() => {
    if (noticeId && notice) say(t(notice.text));
  }, [noticeId]);
  const [pick, setPick] = useState<Category | null>(null);
  const [picking, setPicking] = useState(false);
  const [storyOn, setStoryOn] = useState(true); // идёт хроника изоляции — остальное скрыто
  const speaker = currentSpeaker(view);
  const myTurn = speaker?.id === me;
  const options = view.phase === 'reveal' && myTurn && !player.isEliminated ? revealOptions(view, player) : [];
  const canAction = (view.phase === 'reveal' || view.phase === 'speech' || view.phase === 'vote') && !player.isEliminated && !player.slots.action.isRevealed;
  const lastAction = [...view.log].reverse().find((l) => l.round === view.round && l.kind === 'action');
  // «Ваш ход»: сигнал и заметная плашка, чтобы не пропустить очередь, пока телефон лежит на столе.
  const myRevealTurn = myTurn && view.phase === 'reveal' && !player.isEliminated;
  useEffect(() => {
    if (myRevealTurn) signal('turn');
  }, [myRevealTurn, view.round, view.revealStep]);
  const autoEffect = view.config.autoActions ? player.slots.action.card.effect : undefined;
  const lonely = options.length === 1 ? options[0] : null;
  const chosen = pick && (options.includes(pick) || (pick === 'action' && canAction)) ? pick : lonely;

  const live = view.phase !== 'final';
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-6">
      <GameHud game={view} backLabel={t('Выйти')} onBack={() => confirm(t('Выйти из партии?')) && onExit()} />
      {view.phase !== 'final' && <SkillsStrip scenario={view.scenario} />}

      {!live ? (
        <>
          <FinalReport game={view} onStoryChange={setStoryOn} />
          {!storyOn && (
            <>
              <details className="panel">
                <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">{t('Журнал партии')}</summary>
                <ol className="mt-2 flex flex-col gap-1 text-xs text-dim">{view.log.map((l, i) => <li key={i}>{t('[Р{n}] {text}', { n: l.round, text: tPacked(l.text) })}</li>)}</ol>
              </details>
              <button className="btn btn-primary" onClick={onExit}>{t('В меню')}</button>
            </>
          )}
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="anim-rise flex min-w-0 flex-col gap-4" key={`${view.round}-${stepOf(view)}-${view.phase}-${speaker?.id ?? ''}`}>
            {view.threatView && <>
              <ThreatPublic game={view} />
              <button className="btn" onClick={() => setPrivateOpen(true)}><Lock size={16} />{t('Личный кабинет')}</button>
              {['secret', 'secret-review'].includes(view.phase) && <p className="panel text-sm">{t('Готовы: {n}/{total}', { n: view.threatView.ready.length, total: living.length })}</p>}
              {privateOpen && <Modal><Gate key={`${view.round}-${view.phase}-${me}`} name={player.name}><ThreatPrivate key={`${view.round}-${view.phase}-${me}`} view={view} me={me} close={() => setPrivateOpen(false)} submit={command => send({ t: 'secret', command })} auxiliary={(kind, target, itemId) => send({ t: 'auxiliary', round: view.round, kind, target, ...(itemId ? { itemId } : {}) })} /></Gate></Modal>}
            </>}
            {view.deadline && (
              <MatchClock deadline={view.deadline} totalMin={view.config.timeLimitMin} onExtend={host ? () => host.extendTime(5 * 60_000) : undefined} />
            )}

            {view.phase === 'event' && view.event && (
              <EventCard
                round={view.round}
                event={view.event}
                volunteers={!player.isEliminated && quotaThisRound(view) >= 1 ? [player] : []}
                onVolunteer={() => send({ t: 'volunteer' })}
                action={host ? <button className="btn btn-primary" onClick={() => host.startRound()}>{t('Начать раунд')}</button> : <p className="text-xs text-dim">{t('Раунд начнёт хост, когда все прочитают.')}</p>}
              />
            )}

            {view.phase === 'reveal' && speaker && (
              <p className={`panel hud flex items-center gap-3 text-sm ${myTurn ? 'border-amber text-amber' : 'text-dim'}`}>
                <Avatar id={speaker.id} name={speaker.name} size={40} ring={myTurn} />
                <span>
                  {t('Вскрытие {step} из {total}.', { step: stepOf(view), total: perVote(view) })}{' '}
                  {myTurn ? t('Ваш ход: выберите карту ниже и откройте её всем, затем объясните, чем вы полезны.') : <>{t('Ходит:')} <b className="text-amber">{speaker.name}</b></>}
                </span>
              </p>
            )}

            {view.phase === 'speech' && speaker && view.lastReveal && (
              <section className="panel hud flex flex-col gap-3">
                <h2 className="h-hud flex items-center gap-3">
                  <Avatar id={speaker.id} name={speaker.name} size={36} ring />
                  {myTurn ? t('Объясните, чем вы полезны убежищу') : t('{name} объясняет пользу', { name: speaker.name })}
                </h2>
                <CardFace card={speaker.slots[view.lastReveal.category].card} showMod flip />
                <SpeechTimer endsAt={view.speechEndsAt} totalSec={view.config.speechSec} mine={myTurn} />
                {myTurn ? (
                  <button className="btn btn-primary" onClick={() => send({ t: 'done' })}>{t('Закончил — следующий игрок')}</button>
                ) : host ? (
                  <button className="btn btn-sm" onClick={() => host.skipSpeech()}>{t('Пропустить речь (хост)')}</button>
                ) : null}
              </section>
            )}

            {view.phase === 'vote' && (
              <section className="panel hud flex flex-col gap-2">
                <h2 className="h-hud">{t(view.config.voting === 'secret' ? 'Тайное голосование' : 'Открытое голосование')}</h2>
                <p className="text-xs text-dim">{t('Проголосовало {voted} из {total}. Голос можно менять, пока не проголосуют все. Воздержаться можно — если таких больше половины, никто не уходит.', { voted: Object.keys(view.votes).length, total: living.length })}</p>
                {player.isEliminated ? (
                  <p className="text-sm text-dim">{t('Вы выбыли и не голосуете.')}</p>
                ) : (
                  living.filter((p) => p.id !== me).map((p) => {
                    const mine = view.votes[me] === p.id;
                    const count = view.config.voting === 'open' ? Object.values(view.votes).filter((t) => t === p.id).length : null;
                    return (
                      <button key={p.id} className={`btn justify-start gap-3 normal-case ${mine ? 'btn-primary' : ''}`} onClick={() => send({ t: 'vote', target: p.id })}>
                        <Avatar id={p.id} name={p.name} size={28} /> {p.name}
                        {mine && <span className="ml-auto text-xs uppercase tracking-widest">{t('✔ ваш выбор')}</span>}
                        {!mine && !!count && <span className="ml-auto text-xs text-dim">{count}</span>}
                      </button>
                    );
                  })
                )}
                {!player.isEliminated && (
                  <button className={`btn border-dashed ${view.votes[me] === ABSTAIN ? 'btn-primary' : ''}`} onClick={() => send({ t: 'vote', target: ABSTAIN })}>
                    {view.votes[me] === ABSTAIN ? '✔ ' : ''}{t('Воздержаться')}
                  </button>
                )}
              </section>
            )}

            {view.phase === 'result' && view.lastResult && (
              <section className="panel hud flex flex-col gap-3">
                <h2 className="h-hud">{t('Итоги раунда {n}', { n: view.round })}</h2>
                {view.lastResult.noVote ? <p className="text-sm text-amber">{t('Добровольцы закрыли квоту раунда — голосования не будет.')}</p> : <Tally players={view.players} result={view.lastResult} />}
                {view.lastResult.tieBreak && <p className="text-xs text-amber">{t('Ничья на границе — решено жребием.')}</p>}
                {view.lastResult.skipped && <p className="text-sm text-amber">{t('Большинство воздержалось ({abstained} из {total}) — никто не покидает игру. Пропущенное исключение перенесено в дополнительный раунд.', { abstained: view.lastResult.abstained ?? 0, total: alive(view).length })}</p>}
                {!view.lastResult.skipped && !!view.lastResult.abstained && <p className="text-xs text-dim">{t('Воздержались: {n}.', { n: view.lastResult.abstained })}</p>}
                {host ? <button className="btn btn-primary" onClick={() => host.next()}>{t('Дальше')}</button> : <p className="text-xs text-dim">{t('Следующий шаг запускает хост.')}</p>}
              </section>
            )}

            {!host && offline.length > 0 && (
              <p className="panel border-danger/60 text-sm" role="status">
                <WifiOff size={14} className="mr-1 inline text-danger" />{t('Нет связи:')} <b>{offline.join(', ')}</b>. {t('Они могут вернуться по тому же коду, а хост способен сделать ход за них.')}
              </p>
            )}
            {myRevealTurn && <p className="panel animate-pulse border-amber text-center text-sm font-bold uppercase tracking-widest text-amber" role="alert">{t('Ваш ход: откройте карту')}</p>}
            <PerkPanel game={view} me={me} onApply={(_id, params) => send({ t: 'perk', ...(params.target ? { target: params.target } : {}), ...(params.category ? { category: params.category } : {}) })} onSkip={() => send({ t: 'perk', skip: true })} />
            {lastAction && <p className="panel border-[#e879f9]/60 text-sm" role="status"><Zap size={14} className="mr-1 inline text-[#e879f9]" />{t(lastAction.text)}</p>}
            <section className="panel flex flex-col gap-2">
              <h2 className="h-hud flex items-center gap-2"><Avatar id={player.id} name={player.name} size={24} /> {player.name}{player.isEliminated ? t(' — вы наблюдатель') : t(' — ваши карты')}</h2>
              {CATEGORIES.map((c) => {
                const selectable = options.includes(c) || (c === 'action' && canAction);
                return (
                  <CardFace
                    key={c}
                    card={player.slots[c].card}
                    showMod
                    compact
                    selected={chosen === c}
                    onClick={selectable ? () => setPick(c) : undefined}
                    extra={player.slots[c].isRevealed && <span className="text-[10px] uppercase text-dim">{c === 'action' ? t('использована') : t('открыта всем')}</span>}
                  />
                );
              })}
              {canAction && !chosen && <p className="text-xs text-dim">{t('Карту действия можно применить в любой момент вскрытия, речи или голосования: коснитесь её и нажмите «Применить». Все увидят объявление.')}</p>}
              {chosen && picking && autoEffect ? (
                <ActionTargetPicker
                  game={view}
                  actorId={player.id}
                  effect={autoEffect}
                  title={t(player.slots.action.card.title ?? 'Действие')}
                  onCancel={() => setPicking(false)}
                  onConfirm={(params) => { send({ t: 'action', ...params }); setPicking(false); setPick(null); }}
                />
              ) : (
                chosen && (
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      if (chosen === 'action' && autoEffect && needsTarget(autoEffect)) return setPicking(true);
                      send(chosen === 'action' ? { t: 'action' } : { t: 'reveal', category: chosen });
                      setPick(null);
                    }}
                  >
                    {chosen === 'action' ? <><Zap size={16} /> {t('Применить действие')}</> : t('Открыть всем: {cat}', { cat: categoryLabel(chosen) })}
                  </button>
                )
              )}
            </section>

            {host && host.disconnectedPending().length > 0 && (
              <section className="panel border-danger/50">
                <p className="text-sm text-danger">{t('Отключены: {names}', { names: host.disconnectedPending().join(', ') })}</p>
                <p className="mb-2 text-xs text-dim">{t('Они смогут вернуться по тому же коду. Чтобы не ждать — сделайте ход за них.')}</p>
                <button className="btn btn-sm" onClick={() => host.autofillDisconnected()}>{t('Автоход за отключённых')}</button>
              </section>
            )}
          </div>
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
            <ThreatsPanel hazards={view.hazards ?? []} />
            <Board game={view} speakerId={speaker?.id} meId={me} side />
          </aside>
        </div>
      )}
    </div>
  );
}
