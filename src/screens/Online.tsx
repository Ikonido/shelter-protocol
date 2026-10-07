import { useEffect, useReducer, useState } from 'react';
import { ArrowLeft, Copy, Gavel, Lock, LogIn, RefreshCw, Unlock, UserX, Users, Wifi, WifiOff, Zap } from 'lucide-react';
import { useStore, type OnlineDraft } from '../store';
import { OnlineClient, OnlineHost, type C2H, type Conn, type H2C } from '../lib/online';
import { createRoom, isValidCode, isValidTicket, joinRoom, normalizeCode, probeLan, shareOrigin, type NetMode } from '../lib/net';
import { randomToken } from '../lib/rng';
import { copyText } from '../ui/clipboard';
import { QR } from '../ui/QR';
import { ABSTAIN, alive, perVote, quotaThisRound, revealOptions, stepOf, suggestedDebateSec } from '../lib/game';
import { CATEGORIES, CATEGORY_LABEL, type Category, type GameState } from '../types';
import { CardFace, Stepper } from '../ui/bits';
import { Board, DebateTimer } from './Game';
import { MatchClock } from '../ui/MatchClock';
import { Verdict } from './Final';

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
    <p className="text-xs text-ok">Локальная сеть: интернет не нужен, данные не покидают вашу сеть.</p>
  ) : (
    <p className="text-xs text-dim">
      Через интернет: публичный брокер PeerJS и STUN-серверы видят IP-адреса участников и код комнаты, но не содержимое игры
      (оно шифруется и идёт напрямую). Для полной приватности используйте LAN-режим.
    </p>
  );
}

/* ---------- Хост: лобби ---------- */

export function Lobby({ draft }: { draft: OnlineDraft }) {
  const { go, notify } = useStore();
  const [host, setHost] = useState<OnlineHost | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(readLS('shelter:name') ?? 'Хост');
  const [slots, setSlots] = useState(draft.slots);
  const [net, setNet] = useState<NetMode | null>(null);
  const [origin, setOrigin] = useState(location.origin);
  const [now, setNow] = useState(Date.now());
  useLive(host);
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      host?.tick(); // время вышло -> дебаты пропускаются, карты открываются автоматически
    }, 1000);
    return () => clearInterval(t);
  }, [host]);
  useEffect(() => {
    if (net) void shareOrigin(net).then(setOrigin);
  }, [net]);

  useEffect(() => {
    let room: { destroy(): void } | null = null;
    let cancelled = false;
    const h = new OnlineHost(draft, readLS('shelter:name') ?? 'Хост');
    setHost(h);
    (async () => {
      const mode: NetMode = (await probeLan()) ? 'lan' : 'internet';
      if (cancelled) return;
      setNet(mode);
      const r = await createRoom((c) => h.addConn(c as Conn<H2C>), mode);
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
  }, [draft]);

  if (!host) return null;
  // currentTicket() сам выпускает новый билет по истечении срока — QR «живой», старый перестаёт работать.
  const ticket = code ? host.currentTicket() : null;
  const left = ticket ? Math.max(0, Math.ceil((ticket.expiresAt - now) / 1000)) : 0;
  const link = code && ticket ? `${origin}${location.pathname}#join=${code}.${ticket.value}` : '';
  const localhostOnly = net === 'lan' && origin === location.origin && ['localhost', '127.0.0.1'].includes(location.hostname);
  const copy = async (text: string) => notify((await copyText(text)) ? 'Скопировано' : 'Не удалось скопировать');

  if (host.game) {
    // Хосту часы нужны по его же времени (клиенты получают «осталось» и пересчитывают у себя).
    const view = { ...host.viewFor(0)!, deadline: host.game.deadline };
    return (
      <OnlineGame
        view={view}
        me={host.members[0].playerId!}
        send={(m) => host.actAsHost(m)}
        host={host}
        onExit={() => go({ name: 'home' })}
      />
    );
  }

  const n = host.members.length;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <button className="btn btn-sm self-start" onClick={() => go({ name: 'home' })}><ArrowLeft size={16} /> Закрыть комнату</button>
      <h1 className="h-hud text-base">Онлайн-комната · {draft.scenario.title}</h1>

      <section className="panel text-center">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : code ? (
          <>
            <p className="label">Код комнаты</p>
            <p className="text-5xl font-bold tracking-[.3em] text-amber">{code}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button className="btn btn-sm" onClick={() => copy(code)}><Copy size={14} /> Код</button>
              <button className="btn btn-sm" onClick={() => copy(link)}><Copy size={14} /> Ссылка-приглашение</button>
            </div>
            {link && (
              <div className="mt-4">
                <QR value={link} size={208} label={`QR-код для входа в комнату ${code}`} />
                <p className="mt-2 text-xs text-dim">
                  Временный QR · действует <b className="text-amber">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>, затем обновится сам
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button className="btn btn-sm" onClick={() => host.rotateTicket()}><RefreshCw size={14} /> Обновить QR</button>
                  <label className="btn btn-sm cursor-pointer">
                    <input type="checkbox" className="size-4 accent-amber" checked={host.requireTicket} onChange={(e) => host.setRequireTicket(e.target.checked)} /> Вход только по QR
                  </label>
                </div>
                {localhostOnly && <p className="mt-2 text-xs text-danger">Не удалось определить адрес вашего устройства в сети — телефоны могут не открыть QR. Откройте приложение по LAN-адресу из консоли сервера.</p>}
              </div>
            )}
            <div className="mt-3"><NetBadge mode={net} /></div>
          </>
        ) : (
          <p className="text-sm text-dim">Создаём комнату…</p>
        )}
      </section>

      <section className="panel flex flex-col gap-3">
        <div>
          <span className="label">Ваше имя</span>
          <input className="input" maxLength={24} value={name} onChange={(e) => { setName(e.target.value); writeLS('shelter:name', e.target.value); host.rename(e.target.value); }} />
        </div>
        <h2 className="label flex items-center gap-2"><Users size={14} /> Игроки ({n})</h2>
        <ul className="text-sm">
          {host.members.map((m, i) => (
            <li key={m.token} className="flex items-center gap-2">
              {m.connected ? <Wifi size={14} className="text-ok" /> : <WifiOff size={14} className="text-danger" />}
              {m.name}{i === 0 && <span className="text-xs text-dim">(хост)</span>}
              {i > 0 && (
                <button className="ml-auto text-dim hover:text-danger" aria-label={`Исключить ${m.name}`} onClick={() => host.kick(i)}><UserX size={16} /></button>
              )}
            </li>
          ))}
        </ul>
        <Stepper label="Мест в бункере (K)" value={Math.min(slots, Math.max(1, n - 1))} min={1} max={Math.max(1, n - 1)} onChange={(v) => { setSlots(v); host.setup = { ...host.setup, slots: v }; }} />
        <button className="btn btn-sm" onClick={() => host.setLocked(!host.locked)}>
          {host.locked ? <><Unlock size={14} /> Открыть комнату</> : <><Lock size={14} /> Закрыть комнату для новых игроков</>}
        </button>
        <button className="btn btn-primary" disabled={n < 2 || !code} onClick={() => host.start()}>
          Начать игру ({n} игроков)
        </button>
        {n < 2 && <p className="text-xs text-dim">Нужен хотя бы ещё один игрок.</p>}
      </section>
    </div>
  );
}

/* ---------- Гость: вход ---------- */

export function Join({ initialCode, initialTicket }: { initialCode?: string; initialTicket?: string }) {
  const { go } = useStore();
  const [code, setCode] = useState(initialCode ?? '');
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
      const ticket = initialTicket && isValidTicket(initialTicket) && c === initialCode ? initialTicket : undefined;
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
      <button className="btn btn-sm self-start" onClick={() => go({ name: 'home' })}><ArrowLeft size={16} /> Назад</button>
      <h1 className="h-hud text-base">Вход в онлайн-комнату</h1>
      {(!client || st?.status === 'closed' || st?.status === 'rejected') && (
        <section className="panel flex flex-col gap-3">
          {st?.status === 'rejected' && <p className="text-sm text-danger">{st.reason}</p>}
          {st?.status === 'closed' && <p className="text-sm text-danger">Связь с хостом потеряна. Можно переподключиться — ваш персонаж сохранится.</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div>
            <span className="label">Код комнаты</span>
            <input className="input text-center text-2xl uppercase tracking-[.3em]" value={code} maxLength={5} autoCapitalize="characters" onChange={(e) => setCode(normalizeCode(e.target.value))} />
          </div>
          <div>
            <span className="label">Ваше имя</span>
            <input className="input" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <NetBadge mode={net} />
          <button className="btn btn-primary" disabled={busy || !net || !isValidCode(normalizeCode(code)) || !name.trim()} onClick={() => { client?.destroy(); setClient(null); connect(); }}>
            <LogIn size={18} /> {busy ? 'Подключаемся…' : st?.status === 'closed' ? 'Переподключиться' : 'Войти'}
          </button>
        </section>
      )}
      {st?.status === 'connecting' && <p className="text-center text-sm text-dim">Ожидаем ответ хоста…</p>}
      {st?.status === 'lobby' && (
        <section className="panel">
          <p className="text-sm">Вы в комнате. Сценарий: <b className="text-amber">{st.scenario}</b></p>
          <h2 className="label mt-3">Игроки ({st.members.length})</h2>
          <ul className="text-sm">{st.members.map((m, i) => <li key={i}>{m.name}{i === st.you && ' (вы)'}</li>)}</ul>
          <p className="mt-3 text-xs text-dim">Ждём, пока хост начнёт игру…</p>
        </section>
      )}
    </div>
  );
}

/* ---------- Общий игровой экран (хост и гости) ---------- */

function OnlineGame({ view, me, send, host, onExit }: { view: GameState; me: string; send: Send; host?: OnlineHost; onExit: () => void }) {
  const player = view.players.find((p) => p.id === me)!;
  const living = alive(view);
  const [pick, setPick] = useState<Category | null>(null);
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? id;
  const iRevealed = view.revealedThisRound.includes(me);
  const options = view.phase === 'reveal' && !player.isEliminated && !iRevealed ? revealOptions(view, player) : [];
  const canAction = (view.phase === 'reveal' || view.phase === 'debate') && !player.isEliminated && !player.slots.action.isRevealed;
  const lonely = options.length === 1 ? options[0] : null;
  const chosen = pick && (options.includes(pick) || (pick === 'action' && canAction)) ? pick : lonely;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-4">
      <header className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={() => confirm('Выйти из партии?') && onExit()}><ArrowLeft size={16} /> Выйти</button>
        <span className="text-sm text-amber">{view.scenario.title}</span>
        <div className="ml-auto text-xs uppercase tracking-widest text-dim">
          {view.phase !== 'final' && <>Раунд {view.round}/{view.schedule.length} · вскрытие {stepOf(view)}/{perVote(view)} · </>}
          В игре <b className="text-amber">{living.length}</b> · Мест <b className="text-amber">{view.config.shelterSlots}</b>
        </div>
      </header>

      {view.phase === 'final' ? (
        <>
          <Verdict game={view} />
          <details className="panel">
            <summary className="cursor-pointer text-xs uppercase tracking-widest text-dim">Журнал партии</summary>
            <ol className="mt-2 flex flex-col gap-1 text-xs text-dim">{view.log.map((l, i) => <li key={i}>[Р{l.round}] {l.text}</li>)}</ol>
          </details>
          <button className="btn btn-primary" onClick={onExit}>В меню</button>
        </>
      ) : (
        <>
          {view.deadline && (
            <MatchClock deadline={view.deadline} totalMin={view.config.timeLimitMin} onExtend={host ? () => host.extendTime(5 * 60_000) : undefined} />
          )}
          <Board game={view} />

          <section className="panel flex flex-col gap-2">
            <h2 className="h-hud">{player.name}{player.isEliminated ? ' — вы наблюдатель' : ' — ваши карты'}</h2>
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
                  extra={player.slots[c].isRevealed && <span className="text-[10px] uppercase text-dim">{c === 'action' ? 'использована' : 'открыта всем'}</span>}
                />
              );
            })}
            {chosen && (
              <button className="btn btn-primary" onClick={() => { send(chosen === 'action' ? { t: 'action' } : { t: 'reveal', category: chosen }); setPick(null); }}>
                {chosen === 'action' ? <><Zap size={16} /> Применить действие</> : `Открыть всем: ${CATEGORY_LABEL[chosen]}`}
              </button>
            )}
          </section>

          {view.phase === 'reveal' && (
            <p className="panel text-sm text-dim">
              Раунд {view.round}, вскрытие {stepOf(view)} из {perVote(view)}. {iRevealed ? 'Вы открыли карту. ' : ''}Ждём:{' '}
              {living.filter((p) => !view.revealedThisRound.includes(p.id) && revealOptions(view, p).length).map((p) => p.name).join(', ') || '—'}
            </p>
          )}

          {view.phase === 'debate' && (
            <section className="panel flex flex-col gap-3">
              <h2 className="h-hud">Дебаты</h2>
              <p className="text-xs text-dim">Обсуждайте голосом или в чате. В этом раунде уйдёт: {quotaThisRound(view)}.</p>
              <DebateTimer suggested={suggestedDebateSec(view)} />
              {host ? (
                <button className="btn btn-primary" onClick={() => host.endDebate()}><Gavel size={18} /> {stepOf(view) < perVote(view) && view.players.some((p) => !p.isEliminated && revealOptions({ ...view, revealStep: stepOf(view) + 1 }, p).length) ? 'К следующему вскрытию' : 'К голосованию'}</button>
              ) : (
                <p className="text-xs text-dim">Дальше ведёт хост.</p>
              )}
            </section>
          )}

          {view.phase === 'vote' && (
            <section className="panel flex flex-col gap-2">
              <h2 className="h-hud">{view.config.voting === 'secret' ? 'Тайное' : 'Открытое'} голосование</h2>
              <p className="text-xs text-dim">Проголосовало {Object.keys(view.votes).length} из {living.length}. Голос можно менять, пока не проголосуют все. Воздержаться можно — если таких больше половины, никто не уходит.</p>
              {player.isEliminated ? (
                <p className="text-sm text-dim">Вы выбыли и не голосуете.</p>
              ) : (
                living.filter((p) => p.id !== me).map((p) => {
                  const mine = view.votes[me] === p.id;
                  const count = view.config.voting === 'open' ? Object.values(view.votes).filter((t) => t === p.id).length : null;
                  return (
                    <button key={p.id} className={`btn ${mine ? 'btn-primary' : ''}`} onClick={() => send({ t: 'vote', target: p.id })}>
                      {mine ? '✔ ' : ''}{p.name}{count ? ` · ${count}` : ''}
                    </button>
                  );
                })
              )}
              {!player.isEliminated && (
                <button className={`btn border-dashed ${view.votes[me] === ABSTAIN ? 'btn-primary' : ''}`} onClick={() => send({ t: 'vote', target: ABSTAIN })}>
                  {view.votes[me] === ABSTAIN ? '✔ ' : ''}Воздержаться
                </button>
              )}
            </section>
          )}

          {view.phase === 'result' && view.lastResult && (
            <section className="panel flex flex-col gap-2">
              <h2 className="h-hud">Итоги раунда {view.round}</h2>
              <ul className="text-sm">
                {Object.entries(view.lastResult.tally).sort((a, b) => b[1] - a[1]).map(([id, v]) => (
                  <li key={id} className={view.lastResult!.eliminated.includes(id) ? 'text-danger' : ''}>
                    {nameOf(id)} — {v} гол. {view.lastResult!.eliminated.includes(id) && '← покидает игру'}
                  </li>
                ))}
              </ul>
              {view.lastResult.tieBreak && <p className="text-xs text-amber">Ничья на границе — решено жребием.</p>}
              {view.lastResult.skipped && <p className="text-sm text-amber">Большинство воздержалось ({view.lastResult.abstained} из {alive(view).length}) — никто не покидает игру. Пропущенное исключение перенесено в дополнительный раунд.</p>}
              {!view.lastResult.skipped && !!view.lastResult.abstained && <p className="text-xs text-dim">Воздержались: {view.lastResult.abstained}.</p>}
              {host ? <button className="btn btn-primary" onClick={() => host.next()}>Дальше</button> : <p className="text-xs text-dim">Следующий шаг запускает хост.</p>}
            </section>
          )}

          {host && host.disconnectedPending().length > 0 && (
            <section className="panel border-danger/50">
              <p className="text-sm text-danger">Отключены: {host.disconnectedPending().join(', ')}</p>
              <p className="mb-2 text-xs text-dim">Они смогут вернуться по тому же коду. Чтобы не ждать — сделайте ход за них.</p>
              <button className="btn btn-sm" onClick={() => host.autofillDisconnected()}>Автоход за отключённых</button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
