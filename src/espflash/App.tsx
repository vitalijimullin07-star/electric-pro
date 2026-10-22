/*
 * «Прошивальщик ESP32»: плата по кабелю OTG (родной USB или переходник), чип и MAC, файлы .bin с адресами,
 * проверка набора, прошивка с проверкой MD5, монитор порта.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChipInfo, EspLoader } from '../pylesos/apk/esp-flash';
import { KIND_TEXT, checkPlan, flashSizeOf, planFile, type PlanFile } from './plan';
import { SerialPort, isNativeUsb, native, pickFile, type UsbInfo } from './port';
import { connectLoader, flashFiles } from './session';

const MARK: Record<string, string> = { ok: '✓', warn: '⚠', bad: '✗' };
const FLASH_SPEEDS = [115200, 460800, 921600];
const MON_SPEEDS = [9600, 57600, 74880, 115200, 230400, 460800, 921600];
const SIZES = ['auto', '2', '4', '8', '16'];
const hex = (n: number) => `0x${n.toString(16)}`;
const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadPref<T extends string>(k: string, def: T): T {
  try {
    return (localStorage.getItem(`espflash-${k}`) as T) ?? def;
  } catch {
    return def;
  }
}
function savePref(k: string, v: string): void {
  try {
    localStorage.setItem(`espflash-${k}`, v);
  } catch {
    /* без памяти — по умолчанию */
  }
}

type Mode = 'idle' | 'busy' | 'loader' | 'monitor';

export function App() {
  const port = useRef<SerialPort | null>(null);
  const loader = useRef<EspLoader | null>(null);
  const [usb, setUsb] = useState<UsbInfo | null>(null);
  const [chip, setChip] = useState<ChipInfo | null>(null);
  const [mac, setMac] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [files, setFiles] = useState<PlanFile[]>([]);
  const [speed, setSpeed] = useState(() => Number(loadPref('speed', '460800')));
  const [monSpeed, setMonSpeed] = useState(() => Number(loadPref('mon', '115200')));
  const [size, setSize] = useState<string>(() => loadPref<string>('size', 'auto'));
  const [agree, setAgree] = useState(false);
  const [prog, setProg] = useState<[number, string] | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<'ok' | 'bad' | null>(null);
  const [mon, setMon] = useState('');
  const [input, setInput] = useState('');
  const monRef = useRef<HTMLPreElement>(null);

  const log = (l: string) => setLines((x) => [...x.slice(-80), l]);

  useEffect(() => {
    if (!native) return;
    const p = new SerialPort(native);
    p.onLost = () => {
      setUsb(null);
      setMode('idle');
      loader.current = null;
    };
    port.current = p;
    native.ready();
    (globalThis as unknown as { __espBack: () => boolean }).__espBack = () => false;
    return () => p.dispose();
  }, []);

  useEffect(() => {
    const el = monRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mon]);

  const flashBytes = size === 'auto' ? flashSizeOf(files) : Number(size) << 20;
  const check = checkPlan(files, chip, flashBytes);
  const warned = check.items.some((i) => i.level === 'warn' && !/Плата не подключена/.test(i.text));
  const canFlash = check.ok && (!warned || agree) && mode !== 'busy';

  useEffect(() => setAgree(false), [files, chip, size]);

  /** Открыть порт (если ещё нет). */
  const ensureOpen = async (p: SerialPort): Promise<UsbInfo> => {
    const info = p.info ?? (await p.open());
    setUsb(info);
    return info;
  };

  /** Перевести плату в загрузчик, узнать чип и MAC, поднять скорость. */
  const enterLoader = async (): Promise<EspLoader> => {
    const p = port.current!;
    const info = await ensureOpen(p);
    const { ld, chip: c, mac: m } = await connectLoader(p, info, speed, log);
    setChip(c);
    setMac(m);
    loader.current = ld;
    setMode('loader');
    // Адреса загрузчиков — под этот чип.
    setFiles((fs) => fs.map((f) => (f.kind === 'bootloader' ? { ...f, addr: c.bootAddr } : f)));
    return ld;
  };

  const run = async (what: () => Promise<void>) => {
    setMode('busy');
    setResult(null);
    try {
      await what();
    } catch (e) {
      log(`Не получилось: ${(e as Error).message}`);
      setResult('bad');
      loader.current = null;
      setMode('idle');
    }
  };

  const connect = () =>
    run(async () => {
      setLines([]);
      await enterLoader();
    });

  const startMonitor = async (reset: boolean) => {
    const p = port.current!;
    const info = await ensureOpen(p);
    loader.current = null;
    if (!isNativeUsb(info)) await p.setBaud(monSpeed);
    const dec = new TextDecoder();
    p.sink = (b) => setMon((t) => (t + dec.decode(b, { stream: true })).slice(-60000));
    setMode('monitor');
    if (reset) {
      await p.lines(false, true);
      await sleep(100);
      await p.lines(false, false);
      if (isNativeUsb(info)) await p.reopen();
    }
  };

  const flash = () =>
    run(async () => {
      setLines([]);
      const ld = loader.current ?? (await enterLoader());
      setProg([0, 'подготовка']);
      await flashFiles(ld, files, flashBytes, (f, w) => setProg([f, w]));
      log('Записано и проверено. Перезапускаю плату — её вывод в мониторе ниже');
      const nativeUsb = isNativeUsb(port.current!.info);
      await ld.hardReset();
      loader.current = null;
      setResult('ok');
      setMon('');
      // Родной USB после сброса переподключается к шине — сначала дождаться его.
      if (nativeUsb) setUsb(await port.current!.reopen());
      await startMonitor(false);
    });

  const addFile = async () => {
    if (!native) return;
    try {
      const f = await pickFile(native);
      if (f) setFiles((fs) => [...fs, planFile(f.name, f.data, chip)]);
    } catch (e) {
      log(`Файл не прочитан: ${(e as Error).message}`);
    }
  };

  const setAddr = (i: number, v: string) => {
    // Адреса — всегда шестнадцатеричные (как у esptool), «0x» можно не писать.
    const t = v.trim().toLowerCase().replace(/^0x/, '');
    const n = t === '' || !/^[0-9a-f]+$/.test(t) ? null : parseInt(t, 16);
    setFiles((fs) => fs.map((f, k) => (k === i ? { ...f, addr: n === null || Number.isNaN(n) ? null : n } : f)));
  };

  const send = () => {
    const p = port.current;
    if (!p?.info || !input) return;
    void p.write(new TextEncoder().encode(input + '\n'));
    setMon((t) => t + `> ${input}\n`);
    setInput('');
  };

  if (!native)
    return (
      <div className="app">
        <h1>Прошивальщик ESP32</h1>
        <p className="muted">Это приложение для Android (espflash.apk): плата подключается к телефону кабелем OTG.</p>
      </div>
    );

  const busy = mode === 'busy';
  return (
    <div className="app">
      <header className="top">
        <h1>Прошивальщик ESP32</h1>
        <span className={`pill ${usb ? 'on' : ''}`}>{usb ? usb.name : 'нет платы'}</span>
      </header>

      <section className="card">
        <h2>Плата</h2>
        <div className="rows">
          <div className="row">
            <span className="muted">Порт</span>
            <span>{usb ? `${usb.name}${usb.product ? ` · ${usb.product}` : ''}` : '—'}</span>
          </div>
          <div className="row">
            <span className="muted">Чип</span>
            <span>{chip ? chip.name : '—'}</span>
          </div>
          {mac && (
            <div className="row">
              <span className="muted">MAC</span>
              <span className="mono">{mac}</span>
            </div>
          )}
        </div>
        <button type="button" className="btn wide go" onClick={() => void connect()} disabled={busy}>
          {mode === 'loader' ? 'Подключить заново' : 'Подключить плату'}
        </button>
        <p className="small muted">
          Кабель OTG — в разъём платы: родной USB (у ESP32-S3 — «USB») или через переходник (CH340, CH343, CP2102, FTDI — «COM», «UART»). Плату телефон запитает сам. В режим прошивки она
          переходит сама; не вышло — держите BOOT, нажмите RST и отпустите BOOT.
        </p>
      </section>

      <section className="card">
        <h2>Файлы</h2>
        {files.length === 0 && <p className="small muted">Добавьте прошивку: один файл «целиком» (…merged.bin, с 0x0) или части сборки — загрузчик, разделы, boot_app0, программа. Адреса подставятся сами.</p>}
        {files.map((f, i) => (
          <div key={i} className="file">
            <div className="fname">
              <b>{f.name}</b>
              <span className="small muted">
                {KIND_TEXT[f.kind]} · {kb(f.data.length)}
              </span>
            </div>
            <input className="addr mono" value={f.addr === null ? '' : hex(f.addr)} placeholder="адрес, hex" onChange={(e) => setAddr(i, e.target.value)} aria-label={`Адрес ${f.name}`} inputMode="text" />
            <button type="button" className="iconbtn" aria-label={`Убрать ${f.name}`} onClick={() => setFiles((fs) => fs.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn wide" onClick={() => void addFile()} disabled={busy}>
          Добавить файл .bin
        </button>
        <div className="opts">
          <label>
            <span className="small muted">Скорость прошивки</span>
            <select
              value={speed}
              onChange={(e) => {
                setSpeed(Number(e.target.value));
                savePref('speed', e.target.value);
              }}
            >
              {FLASH_SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="small muted">Флеш</span>
            <select
              value={size}
              onChange={(e) => {
                setSize(e.target.value);
                savePref('size', e.target.value);
              }}
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s === 'auto' ? `авто${flashSizeOf(files) ? ` (${kb(flashSizeOf(files)!)})` : ''}` : `${s} МБ`}
                </option>
              ))}
            </select>
          </label>
        </div>
        {files.length > 0 && (
          <div className={`check ${check.ok ? (warned ? 'warn' : 'ok') : 'bad'}`}>
            <b className="small">{check.ok ? (warned ? 'Проверка: есть предупреждения' : 'Проверка пройдена') : 'Проверка не пройдена — прошивать нельзя'}</b>
            {check.items.map((it, k) => (
              <div key={k} className={`small ci ${it.level}`}>
                {MARK[it.level]} {it.text}
              </div>
            ))}
            {check.ok && warned && (
              <label className="small agree">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Предупреждения прочитал — прошить всё равно
              </label>
            )}
          </div>
        )}
        <button type="button" className="btn wide go" onClick={() => void flash()} disabled={!canFlash || !files.length}>
          {busy && prog ? 'Прошиваю…' : 'Прошить'}
        </button>
        {prog && (
          <div className="prog" role="progressbar" aria-valuenow={Math.round(prog[0] * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="bar">
              <i style={{ width: `${Math.round(prog[0] * 100)}%` }} />
            </div>
            <div className="small muted">
              {Math.round(prog[0] * 100)} % · {prog[1]}
            </div>
          </div>
        )}
        {lines.length > 0 && <pre className={`log ${result ?? ''}`}>{lines.join('\n')}</pre>}
      </section>

      <section className="card">
        <h2>Монитор порта</h2>
        <div className="opts">
          <label>
            <span className="small muted">Скорость</span>
            <select
              value={monSpeed}
              onChange={(e) => {
                setMonSpeed(Number(e.target.value));
                savePref('mon', e.target.value);
                if (mode === 'monitor' && !isNativeUsb(usb)) void port.current?.setBaud(Number(e.target.value));
              }}
            >
              {MON_SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="btns">
          <button type="button" className="btn" onClick={() => void run(async () => { setMon(''); await startMonitor(true); })} disabled={busy}>
            Перезапустить и смотреть
          </button>
          <button type="button" className="btn" onClick={() => void run(() => startMonitor(false))} disabled={busy || mode === 'monitor'}>
            Смотреть
          </button>
          <button type="button" className="btn" onClick={() => setMon('')}>
            Очистить
          </button>
        </div>
        <pre className="mon" ref={monRef}>
          {mon || 'Здесь — что пишет плата.'}
        </pre>
        <form
          className="cmd"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="команда плате" autoCapitalize="off" autoCorrect="off" aria-label="Команда плате" disabled={mode !== 'monitor'} />
          <button type="submit" className="btn" disabled={mode !== 'monitor' || !input}>
            Отправить
          </button>
        </form>
      </section>
    </div>
  );
}
