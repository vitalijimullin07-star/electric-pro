/*
 * Приложение «Пылесос S3» (APK): вертикально — экраны приложения, боком — экран пылесоса точь-в-точь.
 * До первого подключения — демо (пылесос в телефоне). Связь с настоящим — служба Android по Bluetooth.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FAULTS, faultList, type Link, type VacStatus } from '../protocol';
import type { DemoWorld } from '../demo-core';
import { VOICE_PHRASES } from '../../core/sim/voice-phrases';
import type { Ctx, LogItem, LogKind, Sub, Tab } from './ctx';
import { DemoApkLink } from './demo-apk';
import type { PanelMirror } from './panel-mirror';
import { SampleRing, SeriesTracker, parseOsc, sampleOf, type Osc, type PurgeSeries } from './history';
import { LINK_TEXT, NativeLink, native, nativeInfo, pushTables } from './native';
import { Home } from './screens/Home';
import { ScreenTab, PanelOrNote } from './screens/Screen';
import { Sensors } from './screens/Sensors';
import { Charts } from './screens/Charts';
import { Strikes } from './screens/Strikes';
import { Log } from './screens/Log';
import { AllParams, Settings, loadAlerts, pushAlerts } from './screens/Settings';
import { Update } from './screens/Update';
import { Icon } from './ui';

const MODE_KEY = 'pylesos-apk-mode';
const TABS: [Tab, string, React.ReactNode][] = [
  ['home', 'Главная', Icon.home],
  ['sensors', 'Датчики', Icon.gauge],
  ['charts', 'Графики', Icon.chart],
  ['log', 'Журнал', Icon.log],
  ['settings', 'Настройки', Icon.gear],
];

function initialMode(): 'demo' | 'device' {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === 'demo' || m === 'device') return native || m === 'demo' ? (m as 'demo' | 'device') : 'demo';
  } catch {
    /* нет памяти */
  }
  return nativeInfo()?.device ? 'device' : 'demo';
}

function kindOf(line: string): LogKind {
  if (/^!|неисправ|авари|перегр|ошибк|не открыва|не садится|порван|перелив/i.test(line)) return 'fault';
  if (/удар|серия|очистк|продув/i.test(line)) return 'series';
  if (/^set |^> ?set|уставк|настройк|сохран|=/i.test(line)) return 'set';
  if (/связ|bluetooth|wi-?fi|телефон|пульт/i.test(line)) return 'link';
  return 'log';
}

function sayInBrowser(n: number): void {
  const text = VOICE_PHRASES[n];
  if (!text || typeof speechSynthesis === 'undefined') return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU';
  speechSynthesis.speak(u);
}

export function App() {
  const [mode, setModeState] = useState<'demo' | 'device'>(initialMode);
  const [s, setS] = useState<VacStatus | null>(null);
  const [world, setWorld] = useState<DemoWorld | null>(null);
  const [linkState, setLinkState] = useState('off');
  const [linkName, setLinkName] = useState('');
  const [log, setLog] = useState<LogItem[]>([]);
  const [series, setSeries] = useState<PurgeSeries[]>([]);
  const [oscs, setOscs] = useState<Osc[]>([]);
  const [tab, setTab] = useState<Tab>('home');
  const [sub, setSub] = useState<Sub>(null);
  const [tick, setTick] = useState(0);
  const [landscape, setLandscape] = useState(() => matchMedia('(orientation: landscape)').matches);
  const [demo, setDemo] = useState<DemoApkLink | null>(null);
  const [mirror, setMirror] = useState<PanelMirror | null>(null);
  const ring = useRef(new SampleRing()).current;
  const tracker = useRef(new SeriesTracker()).current;
  const linkRef = useRef<Link | null>(null);
  const prevFaults = useRef(0);
  const tabRef = useRef({ tab, sub });
  tabRef.current = { tab, sub };

  const addLog = useCallback((text: string, kind?: LogKind) => {
    setLog((x) => [...x.slice(-1999), { t: Date.now() / 1000, text, kind: kind ?? kindOf(text) }]);
  }, []);

  // Связь: демо или служба Android.
  useEffect(() => {
    pushTables();
    pushAlerts(loadAlerts());
    setS(null);
    let l: Link;
    if (mode === 'device' && native) {
      const n = new NativeLink(native);
      n.onLink = (st, name) => {
        setLinkState(st);
        setLinkName(name);
      };
      try {
        ring.loadCsv(native.recTail(6 * 3600));
      } catch {
        /* записи нет */
      }
      l = n;
      n.onStatus = onStatus;
      n.onLog = (line) => addLog(line);
      linkRef.current = n;
      n.start();
      setDemo(null);
      setMirror(n.panel);
    } else {
      const d = new DemoApkLink();
      d.onWorld = setWorld;
      d.onVoice = (n) => (native ? native.voice(n) : sayInBrowser(n));
      d.onOsc = (line) => {
        const o = parseOsc(line);
        if (o) setOscs((x) => [o, ...x].slice(0, 100));
      };
      l = d;
      d.onStatus = (st) => {
        onStatus(st);
        native?.demoStatus(JSON.stringify(st));
      };
      d.onLog = (line) => addLog(line);
      linkRef.current = d;
      setDemo(d);
      setMirror(null);
      setLinkState('on');
    }
    return () => {
      // Связь с настоящим не рвём (её держит служба), демо — останавливаем.
      if (l.kind === 'demo') l.close();
      linkRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const onStatus = (st: VacStatus) => {
    setS(st);
    ring.push(sampleOf(st));
    if (tracker.push(st)) {
      setSeries([...tracker.list]);
      const x = tracker.list[0];
      addLog(`Серия: ${x.pulses} уд., R ${x.rBefore.toFixed(2)} → ${x.rAfter.toFixed(2)}`, 'series');
    }
    // Неисправности — в журнал (уведомления и голос делает служба Android).
    const f = st.faults >>> 0;
    const was = prevFaults.current;
    if (f !== was) {
      for (const [bit, text] of FAULTS) {
        const on = ((f & bit) >>> 0) !== 0;
        const prev = ((was & bit) >>> 0) !== 0;
        if (on && !prev) addLog(text, 'fault');
        else if (!on && prev) addLog(`Прошло: ${text}`, 'fault');
      }
      prevFaults.current = f;
    }
  };

  useEffect(() => {
    if (mode === 'device') addLog(LINK_TEXT[linkState] ?? linkState, 'link');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkState]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    const mq = matchMedia('(orientation: landscape)');
    const on = () => setLandscape(mq.matches);
    mq.addEventListener('change', on);
    return () => {
      clearInterval(t);
      mq.removeEventListener('change', on);
    };
  }, []);

  useEffect(() => {
    native?.fullscreen(landscape);
    native?.keepOn(landscape);
  }, [landscape]);

  // Кнопка «Назад» Android: закрыть вложенный экран, потом — на главную, потом — свернуть.
  useEffect(() => {
    (globalThis as unknown as { __vacBack: () => boolean }).__vacBack = () => {
      const { tab: t, sub: su } = tabRef.current;
      if (su) {
        setSub(null);
        return true;
      }
      if (t !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    };
  }, []);

  const setMode = (m: 'demo' | 'device') => {
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* нет памяти */
    }
    if (m === 'device' && !native) {
      addLog('Подключение к пылесосу — в приложении для Android (pylesos.apk)', 'link');
      return;
    }
    if (m === 'demo' && native && mode === 'device') native.disconnect();
    setTab('home');
    setSub(null);
    setModeState(m);
  };

  const ctx: Ctx | null = useMemo(
    () =>
      s
        ? {
            s,
            send: (cmd: string) => {
              linkRef.current?.send(cmd);
              addLog(`> ${cmd}`, cmd.startsWith('set') || / (thr|runon|end|limit|auto|free) /.test(cmd) ? 'set' : 'log');
            },
            mode,
            linkState,
            linkName,
            demo,
            mirror,
            world,
            ring,
            series,
            oscs,
            log,
            tick,
            go: setTab,
            open: setSub,
            setMode,
            clearLog: () => setLog([]),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, mode, linkState, linkName, demo, mirror, world, series, oscs, log, tick],
  );

  if (landscape && ctx) return <PanelOrNote {...ctx} full />;
  if (!ctx) return <Waiting mode={mode} linkState={linkState} setMode={setMode} />;

  const faults = faultList(ctx.s);
  return (
    <div className="app">
      <Top {...ctx} />
      {mode === 'device' && linkState !== 'on' && <LinkBanner state={linkState} />}
      {faults.length > 0 && tab !== 'log' && !sub && (
        <div className={`banner ${faults[0].severe ? 'bad' : 'warn'}`}>
          {faults[0].text}
          {faults.length > 1 && ` · ещё ${faults.length - 1}`}
          <button type="button" className="link" onClick={() => ctx.send('ack')}>
            Сбросить
          </button>
        </div>
      )}
      <main className="body">
        {sub === 'strikes' ? (
          <Strikes {...ctx} />
        ) : sub === 'update' ? (
          <Update {...ctx} />
        ) : sub === 'all' ? (
          <AllParams {...ctx} />
        ) : sub === 'screen' ? (
          <ScreenTab {...ctx} />
        ) : tab === 'home' ? (
          <Home {...ctx} />
        ) : tab === 'sensors' ? (
          <Sensors {...ctx} />
        ) : tab === 'charts' ? (
          <Charts {...ctx} />
        ) : tab === 'log' ? (
          <Log {...ctx} />
        ) : (
          <Settings {...ctx} />
        )}
      </main>
      <nav className="tabs">
        {TABS.map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            className={tab === id && !sub ? 'on' : ''}
            onClick={() => {
              setTab(id);
              setSub(null);
            }}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Top(c: Ctx) {
  const on = c.mode === 'demo' || c.linkState === 'on';
  return (
    <header className="top">
      <button type="button" className="devbtn" onClick={() => c.go('settings')}>
        Пылесос S3 {Icon.down}
      </button>
      <span className="linkst">
        <i className={on ? 'dot ok' : 'dot bad'} />
        {c.mode === 'demo' ? 'Демо' : c.linkState === 'on' ? 'Bluetooth · на связи' : LINK_TEXT[c.linkState] ?? c.linkState}
      </span>
    </header>
  );
}

function LinkBanner({ state }: { state: string }) {
  return (
    <div className="banner warn">
      {LINK_TEXT[state] ?? state}
      {state === 'btoff' && (
        <button type="button" className="link" onClick={() => native?.connect()}>
          Включить
        </button>
      )}
      {state === 'noperm' && (
        <button type="button" className="link" onClick={() => native?.askPermissions()}>
          Разрешить
        </button>
      )}
    </div>
  );
}

function Waiting({ mode, linkState, setMode }: { mode: string; linkState: string; setMode: (m: 'demo' | 'device') => void }) {
  return (
    <div className="wait">
      <div className="spin" />
      <h1>Пылесос S3</h1>
      <p>{mode === 'demo' ? 'Запуск пылесоса в телефоне…' : LINK_TEXT[linkState] ?? 'Подключение…'}</p>
      {mode === 'device' && linkState === 'pairing' && <p className="small muted">Код — на экране пылесоса: «Ещё → Телефон».</p>}
      {mode === 'device' && linkState === 'noperm' && (
        <button type="button" className="btn" onClick={() => native?.askPermissions()}>
          Разрешить Bluetooth
        </button>
      )}
      {mode === 'device' && (
        <button type="button" className="btn ghost" onClick={() => setMode('demo')}>
          Пока демо
        </button>
      )}
    </div>
  );
}
