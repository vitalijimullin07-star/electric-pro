import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useEditor } from '@editor/store';
import { simRuntime } from '@editor/sim-runtime';
import { parseHex } from '@core/sim/hex';
import type { DeviceView, SimView } from '@core/sim';
import { openFileBytes } from '../files';
import { bytesToBase64 } from '@core/sim';
import { charOf } from '@core/sim/hd44780';

/*
 * Вкладка «Симуляция»: прошивка, пуск и пауза, экраны, кнопки, ползунки датчиков,
 * монитор порта, выводы контроллера и логический анализатор.
 */

/** Снимок симуляции, не чаще ~15 раз в секунду (панели хватает, а холст рисуется каждый кадр). */
function useSimView(): SimView | null {
  const [v, setV] = useState<SimView | null>(simRuntime.view);
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const un = simRuntime.subscribe(() => {
      const now = performance.now();
      if (now - last > 66) {
        last = now;
        setV(simRuntime.view);
      } else if (!timer)
        timer = setTimeout(() => {
          timer = null;
          last = performance.now();
          setV(simRuntime.view);
        }, 70);
    });
    return () => {
      un();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return v;
}

export async function loadFirmware(): Promise<void> {
  const f = await openFileBytes('.hex,.ihex,.txt,.wasm');
  if (!f) return;
  const s = useEditor.getState();
  if (/\.wasm$/i.test(f.name)) {
    // Ядро прошивки ESP32, собранное в WebAssembly: проверяем, что браузер его примет.
    if (!WebAssembly.validate(f.bytes as BufferSource)) return s.setMessage(`«${f.name}» — не модуль WebAssembly.`);
    s.commit((d) => void (d.firmware = { name: f.name, hex: '', mcu: 'esp32', wasm: bytesToBase64(f.bytes) }));
    s.setMessage(`Прошивка для симуляции ESP32 «${f.name}» загружена: ${(f.bytes.length / 1024).toFixed(1).replace('.', ',')} КБ. Нажмите «Старт».`);
    if (simRuntime.active) simRuntime.start();
    return;
  }
  try {
    const flash = parseHex(f.text());
    let used = flash.length;
    while (used > 0 && flash[used - 1] === 0xff) used--;
    s.commit((d) => void (d.firmware = { name: f.name, hex: f.text() }));
    s.setMessage(`Прошивка «${f.name}» загружена: ${(used / 1024).toFixed(1).replace('.', ',')} КБ. Нажмите «Старт».`);
    if (simRuntime.active) simRuntime.start();
  } catch (e) {
    s.setMessage((e as Error).message);
  }
}

export { useSimView };

export function SimPanel() {
  const sim = useEditor((s) => s.sim);
  const fw = useEditor((s) => s.project.firmware);
  const project = useEditor((s) => s.project);
  const view = useSimView();
  const [tab, setTab] = useState<'dev' | 'serial' | 'pins'>('dev');
  const status = sim.status;
  return (
    <div className="sim-panel">
      <h3>Симуляция</h3>
      <div className="row">
        {status === 'running' ? (
          <button className="btn" onClick={() => simRuntime.pause()}>
            ⏸ Пауза
          </button>
        ) : (
          <button className="btn primary" onClick={() => (status === 'paused' ? simRuntime.resume() : simRuntime.start())} disabled={!fw || status === 'loading'}>
            ▶ {status === 'paused' ? 'Дальше' : status === 'loading' ? 'Запуск…' : 'Старт'}
          </button>
        )}
        <button className="btn" onClick={() => simRuntime.start()} disabled={!fw || status === 'off'} title="Сначала: сброс контроллера, схема заново">
          ⟲ Сброс
        </button>
        <button className="btn" onClick={() => simRuntime.stop()} disabled={status === 'off'}>
          ■ Стоп
        </button>
        <label className="sim-sound">
          <input type="checkbox" defaultChecked={simRuntime.sound} onChange={(e) => (simRuntime.sound = e.target.checked)} /> звук
        </label>
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => (status === 'off' && simRuntime.start(), simRuntime.setFull(true))} disabled={!fw} title="Пульт, мнемосхема, графики и все настройки на весь экран">
          ⛶ Во весь экран
        </button>
      </div>
      <div className="row">
        <button className="btn" onClick={() => void loadFirmware()}>
          Загрузить прошивку (.hex, .wasm)…
        </button>
        <span className="hint">{fw ? fw.name : 'не загружена'}</span>
      </div>
      {!fw && (
        <p className="hint">
          В Arduino IDE: «Скетч → Экспорт бинарного файла» — рядом со скетчем появится файл <b>.ino.hex</b> (без «with_bootloader»). Плата в IDE — Uno, Nano или Pro Mini 16 МГц. Для ATmega32A подойдёт .hex из CodeVision, WinAVR или Atmel Studio; частота берётся по кварцу на схеме. Для ESP32 — ядро прошивки, собранное в WebAssembly (<b>.wasm</b>, см. firmware/vacuum-esp32/build-sim.sh).
        </p>
      )}
      {sim.error && <p className="hint" style={{ color: 'var(--err)' }}>{sim.error}</p>}
      {status !== 'off' && simRuntime.sim && simRuntime.sim.project !== project && <p className="hint" style={{ color: 'var(--warn)' }}>Схема изменилась после запуска — нажмите «Сброс», чтобы симуляция учла правки.</p>}
      {status !== 'off' && (
        <p className="hint">
          {/* Длина строки не меняется, иначе панель прыгает, когда скорость колеблется около 90 %. */}
          Время {sim.seconds.toFixed(1).replace('.', ',')} с · скорость{' '}
          <span style={sim.speed && sim.speed < 0.9 ? { color: 'var(--warn)' } : undefined} title={sim.speed && sim.speed < 0.9 ? 'Устройство не успевает — время в симуляции идёт медленнее реального' : undefined}>
            {Math.round(sim.speed * 100)} %
          </span>{' '}
          от реальной
          {view && <> · {view.mcu}</>}
        </p>
      )}
      {view && (
        <>
          <div className="tabs sim-tabs">
            <button className={tab === 'dev' ? 'on' : ''} onClick={() => setTab('dev')}>
              Детали
            </button>
            <button className={tab === 'serial' ? 'on' : ''} onClick={() => setTab('serial')}>
              Монитор порта
            </button>
            <button className={tab === 'pins' ? 'on' : ''} onClick={() => setTab('pins')}>
              Выводы
            </button>
          </div>
          {tab === 'dev' && <Devices view={view} />}
          {tab === 'serial' && <Serial baud={view.baud} />}
          {tab === 'pins' && <Pins view={view} />}
        </>
      )}
    </div>
  );
}

export function Devices({ view }: { view: SimView }) {
  const order: DeviceView['kind'][] = ['panel', 'lcd', 'oled', 'coil', 'button', 'encoder', 'pot', 'analog', 'digital', 'battery', 'mains', 'motor', 'valve', 'tool', 'plant', 'sensor', 'triac', 'led', 'buzzer', 'relay'];
  const list = [...view.devices].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const unknown = simRuntime.sim?.unknown ?? [];
  return (
    <div className="sim-devices">
      {!list.length && <p className="hint">Деталей вокруг контроллера не нашлось: подключите светодиоды, кнопки, датчики к его выводам на схеме или плате.</p>}
      {list.map((d) => (
        <div key={d.id} className={`sim-dev k-${d.kind}`}>
          <div className="sim-title">
            {d.kind === 'led' && <span className="sim-led" style={{ background: d.color, opacity: 0.25 + 0.75 * (d.brightness ?? 0), boxShadow: d.on ? `0 0 10px ${d.color}` : 'none' }} />}
            {d.kind === 'buzzer' && <span className="sim-note">{d.on ? '♪' : '·'}</span>}
            <span>{d.title}</span>
            {d.kind === 'led' && <span className="hint">{d.on ? `горит ${Math.round((d.brightness ?? 0) * 100)} %` : 'не горит'}</span>}
            {d.kind === 'buzzer' && d.on && <span className="hint">{d.hz} Гц</span>}
          </div>
          {d.warning && <div className="hint" style={{ color: 'var(--warn)' }}>⚠ {d.warning}</div>}
          {d.readings && d.readings.length > 0 && <Readings d={d} />}
          {d.kind === 'lcd' && d.lines && <Lcd d={d} />}
          {d.kind === 'oled' && d.frame && <Oled frame={d.frame} w={d.width!} h={d.height!} />}
          {d.kind === 'panel' && d.pixels && <PanelScreen d={d} />}
          {d.kind === 'button' && <HoldButton id={d.id} pressed={!!d.pressed} />}
          {d.kind === 'digital' && (
            <button className={`btn sm ${d.on ? 'primary' : ''}`} onClick={() => simRuntime.set(d.id, 'v', d.on ? 0 : 1)}>
              {d.on ? '1 — высокий' : '0 — низкий'}
            </button>
          )}
          {d.kind === 'relay' && (
            <div className="row">
              {d.channels?.map((on, i) => (
                <span key={i} className={`tag ${on ? 'ok' : ''}`}>
                  {d.channels!.length > 1 ? `${i + 1}: ` : ''}
                  {on ? 'включено' : 'выключено'}
                </span>
              ))}
            </div>
          )}
          {d.params?.map((p) =>
            p.options ? (
              <label key={p.key} className="sim-param">
                <span>{p.label}</span>
                <select value={Math.round(p.value)} onChange={(e) => simRuntime.set(d.id, p.key, +e.target.value)}>
                  {p.options.map((o, i) => (
                    <option key={i} value={i}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label key={p.key} className="sim-param">
                <span>{p.label}</span>
                <input type="range" min={p.min} max={p.max} step={p.step} defaultValue={p.value} onChange={(e) => simRuntime.set(d.id, p.key, +e.target.value)} />
                <b>
                  {String(+p.value.toFixed(2)).replace('.', ',')} {p.unit}
                </b>
              </label>
            ),
          )}
          {d.kind === 'coil' && d.level !== undefined && (
            <div className="sim-meter" title="Насколько цель близко к катушке">
              <span style={{ width: `${Math.round(Math.min(1, Math.sqrt(d.level)) * 100)}%` }} />
            </div>
          )}
          {d.actions && (
            <div className="row">
              {d.actions.map((a) => (
                <button key={a.key} className="btn sm primary" onClick={() => simRuntime.act(d.id, a.key)}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {unknown.length > 0 && <p className="hint">Не участвуют в симуляции: {unknown.join(', ')}.</p>}
    </div>
  );
}

/** Показания детали: «ток 4,93 А · температура 41 °C». */
export function Readings({ d }: { d: DeviceView }) {
  return (
    <div className="sim-readings">
      {d.readings!.map((r) => (
        <span key={r.label}>
          {r.label} <b>{fmtNum(r.value)}</b>
          {r.unit ? ` ${r.unit}` : ''}
        </span>
      ))}
    </div>
  );
}

export const fmtNum = (v: number): string => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(+v.toFixed(Math.abs(v) >= 10 ? 1 : 2))).replace('.', ',');

export function HoldButton({ id, pressed, label }: { id: string; pressed: boolean; label?: string }) {
  const up = () => simRuntime.press(id, false);
  return (
    <button
      className={`btn sim-hold${pressed ? ' primary' : ''}`}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        simRuntime.press(id, true);
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label ?? (pressed ? 'нажата' : 'нажать и держать')}
    </button>
  );
}

/** Экран ЖК: обычные знаки — текстом, свои символы прошивки (шкалы, значки) — растром 5×8. */
function Lcd({ d }: { d: DeviceView }) {
  const lit = d.backlight === false ? 0 : (d.brightness ?? 1);
  const style = lit < 0.999 && lit > 0.05 ? { filter: `brightness(${(0.45 + 0.55 * lit).toFixed(2)})` } : undefined;
  if (!d.codes || !d.glyphs)
    return (
      <div className={`sim-lcd${lit > 0.05 ? '' : ' dark'}`} style={style}>
        {d.lines!.map((l, i) => (
          <div key={i}>{l.replace(/ /g, '\u00a0')}</div>
        ))}
      </div>
    );
  const glyphs = d.glyphs;
  return (
    <div className={`sim-lcd${lit > 0.05 ? '' : ' dark'}`} style={style}>
      {d.codes.map((row, r) => (
        <div key={r}>
          {row.map((c, i) =>
            c < 16 ? (
              <svg key={i} className="lcd-glyph" viewBox="0 0 5 8" aria-hidden>
                {glyphs[c & 7].flatMap((bits, y) => [0, 1, 2, 3, 4].filter((x) => (bits >> (4 - x)) & 1).map((x) => <rect key={`${x}-${y}`} x={x + 0.05} y={y + 0.05} width={0.9} height={0.9} />))}
              </svg>
            ) : (
              <span key={i}>{charOf(c) === ' ' ? '\u00a0' : charOf(c)}</span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

export function Oled({ frame, w, h }: { frame: Uint8Array; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const on = frame[i];
      img.data[i * 4] = on ? 120 : 6;
      img.data[i * 4 + 1] = on ? 210 : 10;
      img.data[i * 4 + 2] = on ? 255 : 16;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [frame, w, h]);
  return <canvas ref={ref} className="sim-oled" width={w} height={h} style={{ aspectRatio: `${w} / ${h}` }} />;
}

/**
 * Экран пульта (кадр RGB565 из прошивки пульта) с касаниями: палец или мышь — как по
 * сенсору, координаты пересчитываются в точки кадра.
 */
export function PanelScreen({ d }: { d: DeviceView }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const img = useRef<ImageData | null>(null);
  const w = d.width!;
  const h = d.height!;
  useEffect(() => {
    const cv = ref.current;
    const px = d.pixels;
    if (!cv || !px) return;
    const ctx = cv.getContext('2d')!;
    if (!img.current) img.current = ctx.createImageData(w, h);
    const out = img.current.data;
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      const c = px[i];
      const r = c >> 11;
      const g = (c >> 5) & 63;
      const b = c & 31;
      out[j] = (r << 3) | (r >> 2);
      out[j + 1] = (g << 2) | (g >> 4);
      out[j + 2] = (b << 3) | (b >> 2);
      out[j + 3] = 255;
    }
    ctx.putImageData(img.current, 0, 0);
    // Кадр перерисовывается, только когда пульт его поменял.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.version, w, h]);
  const at = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h] as const;
  };
  const down = useRef(false);
  return (
    <canvas
      ref={ref}
      className="sim-panel-screen"
      width={w}
      height={h}
      style={{ aspectRatio: `${w} / ${h}` }}
      aria-label="Экран пульта: касания работают"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        down.current = true;
        simRuntime.touch(d.id, ...at(e), true);
      }}
      onPointerMove={(e) => down.current && simRuntime.touch(d.id, ...at(e), true)}
      onPointerUp={(e) => {
        down.current = false;
        simRuntime.touch(d.id, ...at(e), false);
      }}
      onPointerCancel={(e) => {
        down.current = false;
        simRuntime.touch(d.id, ...at(e), false);
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

export function Serial({ baud }: { baud: number }) {
  const [text, setText] = useState(simRuntime.sim?.serial ?? '');
  const [input, setInput] = useState('');
  const [eol, setEol] = useState('\n');
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const un = simRuntime.subscribe(() => {
      const s = simRuntime.sim?.serial ?? '';
      setText((t) => (t === s ? t : s));
    });
    return () => void un();
  }, []);
  useEffect(() => {
    const el = pre.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  const send = () => {
    simRuntime.serialWrite(input + eol);
    setInput('');
  };
  return (
    <div>
      <p className="hint">Скорость порта в прошивке: {standardBaud(baud)} бод.</p>
      <pre ref={pre} className="sim-serial">
        {text.slice(-6000) || 'Пока ничего не пришло.'}
      </pre>
      <div className="row">
        <input className="inp" style={{ flex: 1 }} value={input} placeholder="Отправить в порт" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && send())} />
        <select className="sel" value={eol} onChange={(e) => setEol(e.target.value)} aria-label="Конец строки">
          <option value="">без конца строки</option>
          <option value={'\n'}>\n</option>
          <option value={'\r\n'}>\r\n</option>
        </select>
        <button className="btn" onClick={send}>
          Отправить
        </button>
        <button
          className="btn"
          onClick={() => {
            if (simRuntime.sim) simRuntime.sim.serial = '';
            setText('');
          }}
        >
          Очистить
        </button>
      </div>
    </div>
  );
}

/** Скорость порта: ближайшая стандартная (делитель UBRR даёт 9615 вместо 9600). */
function standardBaud(b: number): number {
  const std = [300, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 76800, 115200, 230400, 250000, 500000, 1000000];
  const best = std.reduce((a, x) => (Math.abs(x - b) < Math.abs(a - b) ? x : a), std[0]);
  return Math.abs(best - b) / best < 0.04 ? best : Math.round(b);
}

function Pins({ view }: { view: SimView }) {
  const [watch, setWatch] = useState<string[]>([]);
  const [win, setWin] = useState(20);
  const toggle = (pin: string) => {
    const c = simRuntime.sim?.circuit;
    if (!c) return;
    const g = c.pinGroup.get(pin as never);
    const on = !watch.includes(pin);
    if (g !== undefined) c.watch(g, on);
    setWatch((w) => (on ? [...w, pin].slice(-6) : w.filter((x) => x !== pin)));
  };
  const state = (p: SimView['pins'][number]) =>
    p.mode === 'high' || p.mode === 'low'
      ? p.duty > 0.02 && p.duty < 0.98
        ? `выход, ШИМ ${Math.round(p.duty * 100)} %`
        : `выход ${p.level}`
      : `${p.mode === 'pullup' ? 'вход с подтяжкой' : 'вход'}: ${p.floating ? 'висит' : p.level}`;
  return (
    <div>
      {watch.length > 0 && (
        <>
          <div className="row">
            <span className="hint">Окно</span>
            {[2, 20, 200, 2000].map((m) => (
              <button key={m} className={`btn sm ${win === m ? 'primary' : ''}`} onClick={() => setWin(m)}>
                {m} мс
              </button>
            ))}
          </div>
          <Scope pins={watch} windowMs={win} tick={view.seconds} />
        </>
      )}
      <table className="grid sim-pins">
        <tbody>
          {view.pins.map((p) => (
            <tr key={p.pin} className={p.conflict ? 'bad' : ''}>
              <td>
                <label>
                  <input type="checkbox" checked={watch.includes(p.pin)} onChange={() => toggle(p.pin)} title="На логический анализатор" /> {p.title}
                </label>
              </td>
              <td>{p.net}</td>
              <td>
                <span className={`sim-lvl l${p.level}`} /> {p.conflict ? 'замыкание: выход против другого источника' : state(p)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Отметьте выводы галочкой — появится логический анализатор.</p>
    </div>
  );
}

/** Логический анализатор: последние windowMs миллисекунд отмеченных выводов. */
function Scope({ pins, windowMs, tick }: { pins: string[]; windowMs: number; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const sim = simRuntime.sim;
    if (!cv || !sim) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const rowH = 26;
    const H = pins.length * rowH + 16;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, W, H);
    const now = sim.mcu.cycles;
    const span = (windowMs / 1000) * sim.mcu.freq;
    const x0 = 52;
    const X = (cyc: number) => x0 + ((cyc - (now - span)) / span) * (W - x0 - 4);
    ctx.font = '11px system-ui';
    pins.forEach((pin, i) => {
      const g = sim.circuit.pinGroup.get(pin as never);
      const tr = g !== undefined ? sim.circuit.trace(g) : undefined;
      const y0 = 8 + i * rowH;
      ctx.fillStyle = '#93a0ae';
      ctx.fillText(pin, 4, y0 + 15);
      if (!tr) return;
      ctx.strokeStyle = '#4fd1ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const Y = (v: number) => y0 + (v ? 3 : 19);
      let k = tr.t.length - 1;
      while (k > 0 && tr.t[k] > now - span) k--;
      let lv = tr.v[k];
      ctx.moveTo(x0, Y(lv));
      for (let j = k + 1; j < tr.t.length; j++) {
        const x = X(tr.t[j]);
        ctx.lineTo(x, Y(lv));
        lv = tr.v[j];
        ctx.lineTo(x, Y(lv));
      }
      ctx.lineTo(W - 4, Y(lv));
      ctx.stroke();
    });
    ctx.fillStyle = '#5b6775';
    ctx.fillText(`−${windowMs} мс`, x0, H - 2);
    ctx.fillText('сейчас', W - 44, H - 2);
  }, [pins, windowMs, tick]);
  return <canvas ref={ref} className="sim-scope" />;
}
