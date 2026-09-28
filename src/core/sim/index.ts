import { padKey, type Firmware, type Project } from '../model/types';
import { Circuit, findMcu } from './circuit';
import { buildDevices, type Device, type DeviceView } from './devices';
import { Esp32 } from './esp32';
import { AnalogSim } from './analog/build';
import { Avr, pinTitle } from './mcu';
import { PANEL_H, PANEL_W, PanelS3 } from './panel-s3';
import type { McuPin, PinMode, SimMcu } from './types';
import type { VacuumPlant, VacuumView } from './vacuum';

/*
 * Симуляция проекта с прошивкой: контроллер + детали схемы. Время — такты контроллера
 * (у ESP32 такт — микросекунда); интерфейс вызывает run() порциями (обычно раз в кадр)
 * и забирает view().
 */

export { MCU_FREQ, MCU_TITLES } from './mcu';
export { PANEL_H, PANEL_W } from './panel-s3';
export type { DeviceView, SimParam } from './devices';
export type { VacuumView } from './vacuum';
export type { AnalogPart, AnalogReading, ScopeProbe } from './analog/build';
export { fmtSi } from './analog/build';
export type { AnalogParam } from './analog/engine';

export interface PinView {
  pin: McuPin;
  title: string;
  mode: PinMode;
  level: 0 | 1;
  duty: number;
  net: string | null;
  floating: boolean;
  conflict: boolean;
}

export interface SimView {
  seconds: number;
  pins: PinView[];
  devices: DeviceView[];
  /** Состояние цепей по имени группы (для подсветки на плате). */
  nets: Map<string, { level: 0 | 1; duty: number }>;
  baud: number;
  /** Контроллер и частота: «ATmega32A, 11,0592 МГц (кварц BQ1)». */
  mcu: string;
  /** Установка «пылесос» (мнемосхема во весь экран). */
  plant?: VacuumView;
  /** Аналоговый расчёт: напряжения цепей и токи через выводы деталей. */
  analog?: AnalogSnapshot;
}

export interface AnalogSnapshot {
  /** Напряжение цепи, В. */
  volts: Map<string, number>;
  /** Ток в деталь через площадку (ключ «компонент#вывод»), А. */
  pads: Map<string, number>;
  /** Наибольшее напряжение (для шкалы цвета). */
  vmax: number;
}

/** Настройки ESP32 между запусками — как энергонезависимая память (по проекту). */
const nvsStore = new Map<string, Uint8Array>();
const nvsKey = (p: Project) => `${p.meta.created}|${p.meta.name}`;

export function base64ToBytes(b64: string): Uint8Array {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

function noMcu(): Error {
  return new Error('Симуляция умеет Arduino Uno, Nano, Pro Mini, ATmega328P, ATmega32A и ESP32 (WROOM, DevKit): поставьте такой модуль или микросхему на схему.');
}

function espFirmware(fw: Firmware | undefined): Uint8Array {
  if (!fw?.wasm) throw new Error('Для ESP32 нужна прошивка для симуляции (.wasm): ядро прошивки, собранное в WebAssembly (firmware/vacuum-esp32/build-sim.sh).');
  return base64ToBytes(fw.wasm);
}

export interface SimOptions {
  /** Аналоговый расчёт схемы (токи, напряжения, номиналы на ходу). */
  analog?: boolean;
  /** Шаг аналогового расчёта, с (по умолчанию 1 мкс). */
  analogDt?: number;
}

export class Simulation {
  readonly mcu: SimMcu;
  readonly circuit: Circuit;
  readonly devices: Device[];
  unknown: string[];
  readonly plant: VacuumPlant | null;
  /** Всё, что контроллер отправил в порт. */
  serial = '';
  readonly mcuTitle: string;
  onSerial: ((text: string) => void) | null = null;
  /** Аналоговый расчёт схемы (если включён и схема собралась). */
  readonly analog: AnalogSim | null = null;
  /** Почему аналоговый расчёт не включился. */
  analogError: string | null = null;

  /** AVR: прошивка .hex текстом; ESP32 — готовый контроллер (см. create). */
  constructor(
    readonly project: Project,
    firmware: string | SimMcu,
    panels: Map<string, PanelS3> = new Map(),
    opts: SimOptions = {},
  ) {
    const found = findMcu(project);
    if (!found) throw noMcu();
    if (typeof firmware === 'string') {
      if (found.kind === 'esp32') throw new Error('Для ESP32 прошивка .hex не подходит: нужна прошивка для симуляции (.wasm).');
      this.mcu = Avr.fromHex(firmware, found.kind, found.freq);
    } else this.mcu = firmware;
    this.circuit = new Circuit(project, this.mcu, found);
    if (this.mcu instanceof Esp32) {
      const esp = this.mcu;
      esp.analogRead = (pin) => this.circuit.pinVolts(pin);
      esp.onLog = (text) => this.log(text);
      this.mcuTitle = `${esp.title}, 240 МГц · ядро прошивки в WebAssembly`;
    } else this.mcuTitle = `${this.mcu.title}, ${(found.freq / 1e6).toLocaleString('ru', { maximumFractionDigits: 4 })} МГц (${found.freqFrom})`;
    if (opts.analog) {
      try {
        const a = new AnalogSim(project, this.circuit, { dt: opts.analogDt });
        this.analog = a;
        this.circuit.analogNet = (net) => a.netVolts(net);
        const mcu = this.mcu;
        if (mcu instanceof Avr) {
          const adcPins = [...this.circuit.pinNet.keys()].filter((pin) => mcu.adcChannel(pin) >= 0);
          const arefNet = (() => {
            const pad = found.fp.pads.find((x) => x.name && /^AREF$/i.test(x.name));
            return pad ? found.comp.padNets[pad.number] : undefined;
          })();
          mcu.beforeAdc = () => {
            a.sync();
            for (const pin of adcPins) {
              const v = a.netVolts(this.circuit.pinNet.get(pin)!);
              if (v !== undefined) mcu.setAnalog(pin, v);
            }
            if (mcu.forcedRef !== null && arefNet) mcu.forcedRef = a.netVolts(arefNet) ?? mcu.forcedRef;
          };
        }
      } catch (err) {
        this.analogError = err instanceof Error ? err.message : String(err);
      }
    }
    const b = buildDevices(this.circuit, project, { analog: !!this.analog });
    this.devices = b.devices;
    this.unknown = b.unknown;
    this.plant = b.plant;
    if (this.mcu instanceof Avr) this.mcu.usart.onByteTransmit = (v) => this.log(String.fromCharCode(v));
    for (const [ref, panel] of panels) this.attachPanel(ref, panel);
  }

  /** Пульт на своей плате: UART к контроллеру, такт 10 мс, кадр и касания. */
  private attachPanel(ref: string, panel: PanelS3): void {
    const esp = this.mcu;
    const comp = Object.values(this.project.components).find((x) => x.ref === ref);
    if (!(esp instanceof Esp32) || !comp) return;
    this.unknown = this.unknown.filter((u) => !u.startsWith(`${ref} `));
    esp.onUart = (bytes) => panel.rx(bytes);
    panel.onTx = (bytes) => esp.uartWrite(bytes);
    const tick = () => {
      panel.loop(esp.cycles / 1000);
      esp.schedule(tick, 10_000);
    };
    esp.schedule(tick, 1);
    const fp = this.project.footprints[comp.footprint];
    const padNet = (name: string) => {
      const pad = fp?.pads.find((q) => (q.name ?? q.number).toUpperCase() === name);
      return pad ? comp.padNets[pad.number] : undefined;
    };
    const c = this.circuit;
    // Проводка: TX пульта — к RX контроллера, RX пульта — к TX.
    const wiring = (): string | undefined => {
      const u = esp.uart;
      if (!u) return 'прошивка контроллера не открыла UART к пульту';
      const same = (net: string | undefined, pin: McuPin) => net !== undefined && c.netGroup.get(net) !== undefined && c.netGroup.get(net) === c.pinGroup.get(pin);
      if (!same(padNet('TX'), u.rx)) return `TX пульта не соединён с ${u.rx} контроллера (RX)`;
      if (!same(padNet('RX'), u.tx)) return `RX пульта не соединён с ${u.tx} контроллера (TX)`;
      return undefined;
    };
    this.panels.set(comp.id, panel);
    this.devices.push({
      id: comp.id,
      comp,
      view: () => ({ id: comp.id, comp: comp.id, ref, kind: 'panel', title: `${ref} пульт: ${comp.value}`, width: PANEL_W, height: PANEL_H, pixels: panel.pixels(), version: panel.version, warning: wiring() }),
    });
  }

  private panels = new Map<string, PanelS3>();

  /** Касание экрана пульта (координаты кадра 800×480). */
  touch(id: string, x: number, y: number, down: boolean): void {
    this.panels.get(id)?.touch(x, y, down);
  }

  /** Создать симуляцию: для ESP32 прошивка WebAssembly компилируется асинхронно. */
  static async create(project: Project, opts: SimOptions = {}): Promise<Simulation> {
    const found = findMcu(project);
    if (!found) throw noMcu();
    const fw = project.firmware;
    if (found.kind === 'esp32') {
      const key = nvsKey(project);
      const esp = await Esp32.create(espFirmware(fw), { nvs: nvsStore.get(key), onNvs: (d) => nvsStore.set(key, d) });
      const panels = new Map<string, PanelS3>();
      for (const [ref, m] of Object.entries(fw?.modules ?? {})) panels.set(ref, await PanelS3.create(base64ToBytes(m.wasm)));
      return new Simulation(project, esp, panels, opts);
    }
    if (!fw?.hex) throw new Error('Сначала загрузите прошивку (.hex).');
    return new Simulation(project, fw.hex, new Map(), opts);
  }

  /** Синхронно (Node, тесты). */
  static createSync(project: Project, opts: { nvs?: Uint8Array } & SimOptions = {}): Simulation {
    const found = findMcu(project);
    if (!found) throw noMcu();
    if (found.kind === 'esp32') {
      const panels = new Map<string, PanelS3>();
      for (const [ref, m] of Object.entries(project.firmware?.modules ?? {})) panels.set(ref, PanelS3.createSync(base64ToBytes(m.wasm)));
      return new Simulation(project, Esp32.createSync(espFirmware(project.firmware), { nvs: opts.nvs }), panels, opts);
    }
    return new Simulation(project, project.firmware?.hex ?? '', new Map(), opts);
  }

  private log(text: string): void {
    this.serial += text;
    if (this.serial.length > 20000) this.serial = this.serial.slice(-15000);
    this.onSerial?.(text);
  }

  get seconds(): number {
    return this.mcu.cycles / this.mcu.freq;
  }

  run(cycles: number): void {
    this.mcu.run(cycles);
  }

  /** Отправить текст в порт контроллера (как из монитора порта). */
  serialWrite(text: string): void {
    const mcu = this.mcu;
    if (mcu instanceof Esp32) return mcu.serialWrite(text);
    if (!(mcu instanceof Avr)) return;
    // Байты уходят по одному с паузой, как по настоящей линии.
    const bytes = [...new TextEncoder().encode(text)];
    const perChar = Math.max(1, Math.round((mcu.freq / Math.max(300, mcu.usart.baudRate)) * 10));
    let i = 0;
    const send = () => {
      if (i >= bytes.length) return;
      mcu.usart.writeByte(bytes[i++]);
      mcu.cpu.addClockEvent(send, perChar);
    };
    send();
  }

  press(id: string, down: boolean): void {
    this.analog?.press(id, down);
    this.devices.find((d) => d.id === id)?.press?.(down);
  }

  set(id: string, key: string, value: number): void {
    const dev = this.devices.find((d) => d.id === id);
    if (dev?.set) return dev.set(key, value);
    this.analog?.set(id, key, value);
  }

  /** Действие устройства (провести катушкой над целью, включить инструмент). */
  act(id: string, key: string): void {
    const dev = this.devices.find((d) => d.id === id);
    if (dev?.act) return dev.act(key);
    this.analog?.partOf.get(id)?.act?.(key);
  }

  private get baud(): number {
    const m = this.mcu;
    return m instanceof Avr ? m.usart.baudRate : m instanceof Esp32 ? m.baud : 0;
  }

  /** Снимок для интерфейса; сбрасывает статистику кадра (яркость ШИМ, частоты). */
  view(): SimView {
    const c = this.circuit;
    const pins: PinView[] = [];
    const order = (x: string) => (/^IO\d+$/.test(x) ? x.slice(0, 2) + x.slice(2).padStart(2, '0') : x);
    for (const [pin, g] of [...c.pinGroup].sort((a, b) => order(a[0]).localeCompare(order(b[0])))) {
      pins.push({ pin, title: pinTitle(pin, this.mcu.kind), mode: this.mcu.pinMode(pin), level: c.levelOf(g), duty: c.frameStats(g).duty, net: c.groups[g].name, floating: c.isFloating(g), conflict: c.isConflict(g) });
    }
    const nets = new Map<string, { level: 0 | 1; duty: number }>();
    c.groups.forEach((gr, g) => {
      if (gr.power) return;
      const st = { level: c.levelOf(g), duty: c.frameStats(g).duty };
      for (const n of gr.nets) nets.set(n, st);
    });
    this.analog?.sync();
    const devices = this.devices.map((d) => d.view());
    const a = this.analog;
    if (a?.coil) {
      // Катушка в аналоговом расчёте — своя карточка (цель, глубина, сведение).
      const part = a.partOf.get(a.coil.rtx.comp!)!;
      const [amp, , freq] = part.readings();
      const hz = freq.value;
      devices.unshift({
        id: part.comp.id,
        comp: part.comp.id,
        ref: part.comp.ref,
        kind: 'coil',
        title: `${part.comp.ref} катушка DD: ${hz ? `TX ${Math.round(hz)} Гц, ${Math.round(amp.value * 1000)} мА` : 'передатчик выключен'} · аналоговый расчёт`,
        params: part.params.map((q) => ({ key: q.key, label: q.label, value: q.value, min: q.min, max: q.max, step: q.options ? 1 : q.log ? (q.max - q.min) / 200 : (q.max - q.min) / 100, unit: q.unit, options: q.options })),
        actions: part.actions,
        level: part.level?.(),
      });
    }
    c.endFrame();
    return { seconds: this.seconds, pins, devices, nets, baud: this.baud, mcu: this.mcuTitle, plant: this.plant?.view(), analog: a ? this.analogSnapshot(a) : undefined };
  }

  private analogSnapshot(a: AnalogSim): AnalogSnapshot {
    const volts = new Map<string, number>();
    let vmax = 1;
    for (const [net, node] of a.nodeOf) {
      const v = a.engine.volts(node);
      volts.set(net, v);
      vmax = Math.max(vmax, v);
    }
    const pads = new Map<string, number>();
    for (const [comp, m] of a.padCurrents()) for (const [pad, i] of m) pads.set(padKey(comp, pad), i);
    return { volts, pads, vmax };
  }
}
