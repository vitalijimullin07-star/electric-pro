import type { McuPin, PinListener, PinMode, SimMcu } from './types';

/*
 * ESP32 в симуляции. Процессор Xtensa не эмулируется: исполняется ядро прошивки
 * (тот же код на C, что и в ESP32), собранное в WebAssembly, а его «железо»
 * (vac_hal.h) — здесь: время в микросекундах, выводы, прерывания по фронтам,
 * таймер 100 мкс, АЦП (напряжение берётся из схемы в момент измерения), I²C,
 * зуммер (меандр на выводе), настройки во «флеше».
 * Такт симуляции — 1 мкс.
 */

/** Период вызова vac_tick (аппаратный таймер прошивки), мкс. */
const TICK_US = 100;
/** Как часто крутится loop(), мкс. */
const LOOP_US = 500;

interface WasmExports {
  memory: WebAssembly.Memory;
  vac_setup(): void;
  vac_loop(): void;
  vac_tick(): void;
  vac_on_pin(pin: number, level: number, us: number): void;
  vac_serial(ch: number): void;
}

interface Ev {
  t: number;
  seq: number;
  fn: () => void;
}

export interface Esp32Options {
  /** Настройки из прошлого запуска (энергонезависимая память). */
  nvs?: Uint8Array | null;
  onNvs?: (data: Uint8Array) => void;
}

/** Передача по I²C: запись (write) или чтение readLen байт; null — устройство не ответило. */
export type I2cTransfer = (sda: McuPin, scl: McuPin, addr: number, write: Uint8Array | null, readLen: number) => number[] | null;

export class Esp32 implements SimMcu {
  readonly kind = 'esp32' as const;
  readonly title = 'ESP32-WROOM-32E';
  readonly freq = 1_000_000;
  readonly vdd = 3.3;
  forcedRef: number | null = null;
  /** Напряжение на выводе для АЦП, В (задаёт симуляция: схема в момент чтения). */
  analogRead: ((pin: McuPin) => number) | null = null;
  i2cTransfer: I2cTransfer | null = null;
  /** Строки прошивки в монитор порта. */
  onLog: ((text: string) => void) | null = null;
  /** Скорость порта (для подписи). */
  readonly baud = 115200;

  private now = 0;
  private ex: WasmExports | null = null;
  private started = false;
  private depth = 0;
  private nextTick = TICK_US;
  private nextLoop = 0;
  private heap: Ev[] = [];
  private seq = 0;
  private modes = new Map<McuPin, PinMode>();
  private out = new Map<McuPin, 0 | 1>();
  private inputs = new Map<McuPin, boolean>();
  private forced = new Map<McuPin, boolean>();
  private listeners: PinListener[] = [];
  private irq = new Set<number>();
  private pendingIrq: [number, number, number][] = [];
  private buses: { sda: McuPin; scl: McuPin }[] = [];
  private tones = new Map<McuPin, number>();
  private toneToken = new Map<McuPin, number>();
  private nvs: Uint8Array | null;
  private rng = 12345;
  private decoder = new TextDecoder();

  private constructor(private opts: Esp32Options) {
    this.nvs = opts.nvs ? new Uint8Array(opts.nvs) : null;
  }

  /** Для браузера: модуль больше 4 КБ компилируется только асинхронно. */
  static async create(wasm: Uint8Array, opts: Esp32Options = {}): Promise<Esp32> {
    const esp = new Esp32(opts);
    const { instance } = await WebAssembly.instantiate(wasm as BufferSource, esp.imports());
    esp.attach(instance);
    return esp;
  }

  /** Синхронно (Node, тесты). */
  static createSync(wasm: Uint8Array, opts: Esp32Options = {}): Esp32 {
    const esp = new Esp32(opts);
    const inst = new WebAssembly.Instance(new WebAssembly.Module(wasm as BufferSource), esp.imports());
    esp.attach(inst);
    return esp;
  }

  private attach(inst: WebAssembly.Instance): void {
    const ex = inst.exports as unknown as WasmExports;
    for (const k of ['memory', 'vac_setup', 'vac_loop', 'vac_tick', 'vac_on_pin', 'vac_serial'] as const) if (!ex[k]) throw new Error(`В прошивке ESP32 нет ${k}: соберите её из firmware/vacuum-esp32 (build-sim.sh).`);
    this.ex = ex;
  }

  get cycles(): number {
    return this.now;
  }

  private mem(): Uint8Array {
    return new Uint8Array(this.ex!.memory.buffer);
  }

  private cstr(ptr: number): string {
    const m = this.mem();
    let end = ptr;
    while (m[end]) end++;
    return this.decoder.decode(m.subarray(ptr, end));
  }

  private imports(): WebAssembly.Imports {
    const pin = (n: number) => `IO${n}` as McuPin;
    return {
      env: {
        hal_pin_mode: (n: number, mode: number) => {
          const p = pin(n);
          this.setMode(p, mode === 1 ? (this.out.get(p) ? 'high' : 'low') : mode === 2 ? 'pullup' : 'input');
        },
        hal_pin_write: (n: number, level: number) => {
          const p = pin(n);
          this.out.set(p, level ? 1 : 0);
          const m = this.modes.get(p);
          if (m === 'low' || m === 'high') this.setMode(p, level ? 'high' : 'low');
        },
        hal_pin_read: (n: number) => this.readPin(pin(n)),
        hal_pin_irq: (n: number) => void this.irq.add(n),
        hal_micros: () => this.now >>> 0,
        hal_millis: () => Math.floor(this.now / 1000) >>> 0,
        hal_adc_mv: (n: number) => this.adc(pin(n)),
        hal_i2c_begin: (bus: number, sda: number, scl: number) => {
          this.buses[bus] = { sda: pin(sda), scl: pin(scl) };
          return 0;
        },
        hal_i2c_write: (bus: number, addr: number, ptr: number, len: number) => {
          const b = this.buses[bus];
          if (!b || !this.i2cTransfer) return 2;
          const data = this.mem().slice(ptr, ptr + len);
          return this.i2cTransfer(b.sda, b.scl, addr, data, 0) ? 0 : 2;
        },
        hal_i2c_read: (bus: number, addr: number, ptr: number, len: number) => {
          const b = this.buses[bus];
          if (!b || !this.i2cTransfer) return 2;
          const r = this.i2cTransfer(b.sda, b.scl, addr, null, len);
          if (!r) return 2;
          this.mem().set(r.slice(0, len).map((x) => x & 0xff), ptr);
          return 0;
        },
        hal_tone: (n: number, hz: number) => this.tone(pin(n), hz),
        hal_log: (ptr: number) => this.onLog?.(this.cstr(ptr) + '\n'),
        hal_settings_load: (ptr: number, len: number) => {
          if (!this.nvs || this.nvs.length !== len) return 0;
          this.mem().set(this.nvs, ptr);
          return len;
        },
        hal_settings_save: (ptr: number, len: number) => {
          this.nvs = this.mem().slice(ptr, ptr + len);
          this.opts.onNvs?.(this.nvs);
        },
      },
    };
  }

  /* ---------------- выводы ---------------- */

  onPin(l: PinListener): void {
    this.listeners.push(l);
  }

  private setMode(p: McuPin, m: PinMode): void {
    if (this.modes.get(p) === m) return;
    this.modes.set(p, m);
    for (const l of this.listeners) l(p, m, this.now);
  }

  pinMode(pin: McuPin): PinMode {
    return this.modes.get(pin) ?? 'input';
  }

  private readPin(p: McuPin): number {
    const f = this.forced.get(p);
    if (f !== undefined) return f ? 1 : 0;
    const m = this.modes.get(p);
    if (m === 'high') return 1;
    if (m === 'low') return 0;
    const v = this.inputs.get(p);
    return v === undefined ? (m === 'pullup' ? 1 : 0) : v ? 1 : 0;
  }

  setInput(pin: McuPin, high: boolean): void {
    const was = this.readPin(pin);
    this.inputs.set(pin, high);
    const now = this.readPin(pin);
    if (now !== was) this.edge(pin, now);
  }

  forcePin(pin: McuPin, high: boolean | null): void {
    const was = this.readPin(pin);
    if (high === null) this.forced.delete(pin);
    else this.forced.set(pin, high);
    const now = this.readPin(pin);
    if (now !== was) this.edge(pin, now);
  }

  setAnalog(): void {
    /* ESP32 читает напряжение сам в момент измерения (analogRead). */
  }

  private edge(pin: McuPin, level: number): void {
    const n = +pin.slice(2);
    if (!this.irq.has(n) || !this.ex) return;
    // Внутри вызова прошивки прерывание ждёт его окончания.
    if (this.depth) this.pendingIrq.push([n, level, this.now]);
    else this.call(() => this.ex!.vac_on_pin(n, level, this.now >>> 0));
  }

  /** АЦП с ослаблением 11 дБ: мВ после калибровки, насыщение около 3,15 В, шум ±3 мВ. */
  private adc(pin: McuPin): number {
    const v = this.analogRead?.(pin) ?? 0;
    this.rng = (this.rng * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((this.rng / 0x7fffffff) * 2 - 1) * 3;
    const mv = Math.max(0, Math.min(3150, v * 1000 + noise));
    return Math.round(mv);
  }

  /** Зуммер: меандр на выводе, переключения — события по времени. */
  private tone(p: McuPin, hz: number): void {
    const token = (this.toneToken.get(p) ?? 0) + 1;
    this.toneToken.set(p, token);
    this.tones.set(p, hz);
    if (!hz) {
      this.out.set(p, 0);
      this.setMode(p, 'low');
      return;
    }
    const half = Math.max(20, Math.round(500_000 / hz));
    let lvl: 0 | 1 = 1;
    const step = () => {
      if (this.toneToken.get(p) !== token) return;
      this.setMode(p, lvl ? 'high' : 'low');
      lvl = lvl ? 0 : 1;
      this.schedule(step, half);
    };
    step();
  }

  /* ---------------- время ---------------- */

  schedule(fn: () => void, cycles: number): void {
    const ev: Ev = { t: this.now + Math.max(1, Math.round(cycles)), seq: this.seq++, fn };
    const h = this.heap;
    h.push(ev);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(h[p], h[i])) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }

  private pop(): Ev {
    const h = this.heap;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && less(h[l], h[m])) m = l;
        if (r < h.length && less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }

  /** Вызов прошивки; после него — отложенные прерывания. */
  private call(fn: () => void): void {
    this.depth++;
    try {
      fn();
    } catch (e) {
      throw new Error(`Прошивка ESP32 остановилась: ${(e as Error).message}`);
    } finally {
      this.depth--;
    }
    while (!this.depth && this.pendingIrq.length) {
      const [n, level, t] = this.pendingIrq.shift()!;
      this.depth++;
      try {
        this.ex!.vac_on_pin(n, level, t >>> 0);
      } finally {
        this.depth--;
      }
    }
  }

  run(cycles: number): void {
    const ex = this.ex!;
    if (!this.started) {
      this.started = true;
      this.call(() => ex.vac_setup());
    }
    const end = this.now + Math.max(0, Math.round(cycles));
    for (;;) {
      const tEv = this.heap.length ? this.heap[0].t : Infinity;
      const t = Math.min(tEv, this.nextTick, this.nextLoop);
      if (t > end) break;
      this.now = t;
      if (tEv === t) {
        this.pop().fn();
        continue;
      }
      if (this.nextTick === t) {
        this.nextTick += TICK_US;
        this.call(() => ex.vac_tick());
      }
      if (this.nextLoop === t) {
        this.nextLoop += LOOP_US;
        this.call(() => ex.vac_loop());
      }
    }
    this.now = end;
  }

  /** Байты в порт прошивки (как из монитора порта, 115200 бод). */
  serialWrite(text: string): void {
    const bytes = [...new TextEncoder().encode(text)];
    let i = 0;
    const send = () => {
      if (i >= bytes.length || !this.ex) return;
      const b = bytes[i++];
      this.call(() => this.ex!.vac_serial(b));
      this.schedule(send, 87);
    };
    this.schedule(send, 1);
  }
}

function less(a: Ev, b: Ev): boolean {
  return a.t < b.t || (a.t === b.t && a.seq < b.seq);
}
