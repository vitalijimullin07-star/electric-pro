import { useEffect, useRef, useState } from 'react';
import { BleLink, WifiLink, bleSupported, servedByVacuum } from './links';
import type { DemoLink } from './demo-link';
import { faultList, stateText, type Link, type VacStatus } from './protocol';
import type { DemoWorld } from './demo-core';
import { HomeTab } from './tabs/Home';
import { CleanTab } from './tabs/Clean';
import { FilterTab } from './tabs/Filter';
import { LogTab } from './tabs/Log';
import { MoreTab } from './tabs/More';

/** Сборка для прошивки пылесоса: без демо (оно большое, а с пылесоса не нужно). */
const LITE = !!import.meta.env.VITE_PYLESOS_LITE;

const TABS = [
  ['home', 'Пылесос', '⏻'],
  ['clean', 'Очистка', '✺'],
  ['filter', 'Фильтр', '▤'],
  ['log', 'Журнал', '☰'],
  ['more', 'Ещё', '⋯'],
] as const;
export type TabId = (typeof TABS)[number][0];

export interface LogLine {
  t: number;
  text: string;
}

/** То, что нужно вкладкам. */
export interface Ctx {
  s: VacStatus;
  link: Link;
  send: (cmd: string) => void;
  world: DemoWorld | null;
  demo: DemoLink | null;
}

export function App() {
  const [link, setLink] = useState<Link | null>(null);
  const [s, setS] = useState<VacStatus | null>(null);
  const [world, setWorld] = useState<DemoWorld | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [tab, setTab] = useState<TabId>('home');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [unread, setUnread] = useState(0);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const attach = (l: Link) => {
    l.onStatus = setS;
    l.onLog = (text) => {
      setLog((x) => [...x.slice(-299), { t: Date.now(), text }]);
      if (tabRef.current !== 'log') setUnread((n) => n + 1);
    };
    l.onClose = (why) => setErr(why);
    if (l.kind === 'demo') (l as DemoLink).onWorld = setWorld;
    setErr('');
    setLink(l);
  };

  // Открыто с пылесоса — сразу по его Wi-Fi.
  useEffect(() => {
    if (servedByVacuum()) attach(new WifiLink());
  }, []);

  const disconnect = () => {
    link?.close();
    setLink(null);
    setS(null);
    setWorld(null);
  };

  const ble = async () => {
    setBusy(true);
    setErr('');
    try {
      attach(await BleLink.connect());
    } catch (e) {
      const m = (e as Error).message ?? '';
      if (!/cancel|chosen|отмен/i.test(m)) setErr(`Bluetooth: ${m || 'не удалось подключиться'}`);
    } finally {
      setBusy(false);
    }
  };

  const demo = LITE
    ? null
    : async () => {
        const { DemoLink } = await import('./demo-link');
        attach(new DemoLink());
      };

  if (!link) return <Connect onDemo={demo} onBle={ble} busy={busy} err={err} />;
  if (!s)
    return (
      <div className="wait">
        <div className="spin" />
        <p>{link.kind === 'demo' ? 'Запуск прошивки в телефоне…' : `Связь: ${link.title}…`}</p>
        {link.kind === 'ble' && <p className="hint">Если Android спросит код — он на экране пылесоса: «Ещё → Телефон».</p>}
        {err && <p className="err">{err}</p>}
        <button className="btn ghost" onClick={disconnect}>
          Отмена
        </button>
      </div>
    );

  const ctx: Ctx = { s, link, send: (c) => link.send(c), world, demo: link.kind === 'demo' ? (link as DemoLink) : null };
  const faults = faultList(s);
  return (
    <div className="app">
      <header className="top">
        <div>
          <div className="title">{stateText(s)}</div>
          <div className="sub">
            {link.title} · прошивка {s.ver}
          </div>
        </div>
        <span className={`dot ${err ? 'bad' : 'ok'}`} title={err || 'на связи'} />
      </header>
      {err && <div className="banner bad">{err}</div>}
      {faults.length > 0 && tab !== 'log' && (
        <div className="faults">
          {faults.slice(0, 3).map((f) => (
            <div key={f.text} className={`banner ${f.severe ? 'bad' : 'warn'}`}>
              {f.text}
            </div>
          ))}
          <button className="link" onClick={() => link.send('ack')}>
            Сбросить предупреждения
          </button>
        </div>
      )}
      <main className="body">
        {tab === 'home' && <HomeTab {...ctx} />}
        {tab === 'clean' && <CleanTab {...ctx} />}
        {tab === 'filter' && <FilterTab {...ctx} />}
        {tab === 'log' && <LogTab lines={log} faults={faults} onClear={() => setLog([])} />}
        {tab === 'more' && <MoreTab {...ctx} onDisconnect={disconnect} />}
      </main>
      <nav className="tabs">
        {TABS.map(([id, label, icon]) => (
          <button
            key={id}
            className={tab === id ? 'on' : ''}
            onClick={() => {
              setTab(id);
              if (id === 'log') setUnread(0);
            }}
          >
            <span className="ico">{icon}</span>
            {label}
            {id === 'log' && unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Connect({ onDemo, onBle, busy, err }: { onDemo: (() => void) | null; onBle: () => void; busy: boolean; err: string }) {
  const hasBle = bleSupported();
  return (
    <div className="connect">
      <h1>Пылесос S3</h1>
      <p className="muted">Управление, очистка фильтра, паспорт фильтров и журнал — с телефона.</p>
      <button className="btn big primary" onClick={onBle} disabled={!hasBle || busy}>
        {busy ? 'Подключение… (код — на экране пылесоса)' : 'Подключить по Bluetooth'}
      </button>
      <p className="hint">
        {hasBle
          ? 'Пылесос должен быть включён. При первом подключении Android спросит код — он на экране пылесоса.'
          : 'Bluetooth из браузера работает в Chrome на Android. На этом устройстве — только Wi-Fi или демо.'}
      </p>
      <div className="card">
        <b>По Wi-Fi пылесоса</b>
        <ol>
          <li>На экране пылесоса: «Ещё → Телефон» (или команда «wifi on») — там имя сети и пароль.</li>
          <li>Подключите телефон к сети Pylesos-S3-….</li>
          <li>
            Откройте <b>192.168.4.1</b> — приложение откроется с самого пылесоса.
          </li>
        </ol>
      </div>
      {onDemo && (
        <>
          <button className="btn big" onClick={onDemo}>
            Демо — без пылесоса
          </button>
          <p className="hint">В демо работает та же прошивка, а пылесос считается в телефоне: можно закрыть шланг, включить инструмент, запылить фильтр.</p>
        </>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
