import { padKey, type Project } from '../model/types';
import { Circuit, findMcu } from './circuit';
import { buildDevices, type Device, type DeviceView } from './devices';
import { AnalogSim } from './analog/build';
import { analogDevices } from './analog/devices';
import { NullMcu, noMcuFound } from './null-mcu';
import { Avr, pinTitle } from './mcu';
import type { McuPin, PinMode, SimMcu } from './types';

/*
 * Симуляция проекта с прошивкой: контроллер + детали схемы. Время — такты контроллера
 ; интерфейс вызывает run() порциями (обычно раз в кадр)
 * и забирает view().
 */

export { MCU_FREQ, MCU_TITLES } from './mcu';
export type { DeviceView, SimParam } from './devices';
export type { AnalogPart, AnalogReading, ScopeProbe } from './analog/build';
export { fmtSi, WAVE_TITLES } from './analog/build';
export { KIND_INFO, detectKind, kindChoices, type SimKind } from './analog/kinds';
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

const ESP32_OFF = 'Симуляция ESP32 в этом редакторе недоступна: симулируются Arduino (AVR), ATmega и схемы без контроллера.';

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
  /** Всё, что контроллер отправил в порт. */
  serial = '';
  readonly mcuTitle: string;
  onSerial: ((text: string) => void) | null = null;
  /** Аналоговый расчёт схемы (если включён и схема собралась). */
  readonly analog: AnalogSim | null = null;
  /** Почему аналоговый расчёт не включился. */
  analogError: string | null = null;

  /** Схема без контроллера: время отсчитывает NullMcu, всё считает аналоговый расчёт. */
  readonly noMcu: boolean;

  /** AVR: прошивка .hex текстом (или готовый контроллер); без контроллера — null. */
  constructor(
    readonly project: Project,
    firmware: string | SimMcu | null,
    opts: SimOptions = {},
  ) {
    const found = findMcu(project) ?? noMcuFound();
    this.noMcu = found.kind === 'none';
    if (this.noMcu && firmware)
      throw new Error(
        'Прошивка есть, а контроллера на плате нет: поставьте Arduino Nano/Uno/Pro Mini или ATmega. Без прошивки схема симулируется и без контроллера.',
      );
    if (this.noMcu) {
      this.mcu = new NullMcu();
      opts = { ...opts, analog: true };
    } else if (typeof firmware === 'string') {
      if (found.kind === 'esp32') throw new Error(ESP32_OFF);
      this.mcu = Avr.fromHex(firmware, found.kind, found.freq);
    } else if (firmware) this.mcu = firmware;
    else throw new Error('Сначала загрузите прошивку (.hex).');
    this.circuit = new Circuit(project, this.mcu, found);
    if (this.noMcu) this.mcuTitle = 'схема без контроллера';
    else this.mcuTitle = `${this.mcu.title}, ${(found.freq / 1e6).toLocaleString('ru', { maximumFractionDigits: 4 })} МГц (${found.freqFrom})`;
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
        if (this.noMcu) throw new Error(`Схема без контроллера не собралась для расчёта: ${this.analogError}`);
      }
    }
    if (this.noMcu) {
      // Без контроллера логических деталей нет: всё показывает аналоговый расчёт.
      this.devices = analogDevices(this.analog!);
      for (const d of this.devices) this.analogIds.add(d.id);
      this.unknown = this.analog!.skipped.map((r) => `${r} (нет модели)`);
      return;
    }
    const b = buildDevices(this.circuit, project, { analog: !!this.analog });
    this.devices = b.devices;
    this.unknown = b.unknown;
    if (this.analog) this.mergeAnalogDevices(analogDevices(this.analog));
    if (this.mcu instanceof Avr) this.mcu.usart.onByteTransmit = (v) => this.log(String.fromCharCode(v));
  }

  /** Карточки аналогового расчёта (их нажатия не повторяются в расчёт второй раз). */
  private analogIds = new Set<string>();

  /**
   * С контроллером: светодиоды, динамики и т. п. показываются по аналоговому расчёту
   * (яркость — по среднему току, частота — по току), кнопки остаются логическими (их
   * читает прошивка; нажатие повторяется в расчёт), остальное добавляется.
   */
  private mergeAnalogDevices(list: Device[]): void {
    for (const d of list) {
      const kind = d.view().kind;
      const same = this.devices.findIndex((x) => x.comp.id === d.comp.id && (x.id === d.id || x.view().kind === kind));
      if (same >= 0) {
        if (kind === 'button' || kind === 'panel' || kind === 'pot') continue;
        this.devices.splice(same, 1, d);
      } else if (this.devices.some((x) => x.comp.id === d.comp.id && x.view().kind !== 'led' && x.view().kind !== 'buzzer')) continue;
      else this.devices.push(d);
      this.analogIds.add(d.id);
      this.unknown = this.unknown.filter((u) => !u.startsWith(`${d.comp.ref} `));
    }
  }

  /** Создать симуляцию (для совместимости — то же, что createSync). */
  static async create(project: Project, opts: SimOptions = {}): Promise<Simulation> {
    return Simulation.createSync(project, opts);
  }

  /** Синхронно (Node, тесты). */
  static createSync(project: Project, opts: SimOptions = {}): Simulation {
    const found = findMcu(project);
    if (!found) return new Simulation(project, null, opts);
    if (found.kind === 'esp32') throw new Error(ESP32_OFF);
    const fw = project.firmware;
    if (!fw?.hex) throw new Error('Сначала загрузите прошивку (.hex) — или уберите контроллер со схемы, чтобы симулировать только схему.');
    return new Simulation(project, fw.hex, opts);
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
    if (this.noMcu) this.analog?.sync();
  }

  /** Отправить текст в порт контроллера (как из монитора порта). */
  serialWrite(text: string): void {
    const mcu = this.mcu;
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
    const dev = this.devices.find((d) => d.id === id);
    dev?.press?.(down);
    // Логическая кнопка (её читает прошивка) — нажатие повторяется в аналоговый расчёт.
    if (!dev || !this.analogIds.has(dev.id)) this.analog?.press(id, down);
  }

  set(id: string, key: string, value: number): void {
    const dev = this.devices.find((d) => d.id === id);
    dev?.set?.(key, value);
    if (!dev || !this.analogIds.has(dev.id)) this.analog?.set(id.replace(/:B$/, ''), key, value);
  }

  /** Действие устройства (провести катушкой над целью, включить инструмент). */
  act(id: string, key: string): void {
    const dev = this.devices.find((d) => d.id === id);
    if (dev?.act) return dev.act(key);
    this.analog?.partOf.get(id)?.act?.(key);
  }

  private get baud(): number {
    const m = this.mcu;
    return m instanceof Avr ? m.usart.baudRate : 0;
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
      if (gr.power || this.noMcu) return;
      const st = { level: c.levelOf(g), duty: c.frameStats(g).duty };
      for (const n of gr.nets) nets.set(n, st);
    });
    this.analog?.sync();
    const devices = this.devices.map((d) => d.view());
    const a = this.analog;
    c.endFrame();
    return { seconds: this.seconds, pins, devices, nets, baud: this.baud, mcu: this.mcuTitle, analog: a ? this.analogSnapshot(a) : undefined };
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
