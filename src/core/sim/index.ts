import type { Project } from '../model/types';
import { Circuit, findMcu } from './circuit';
import { buildDevices, type Device, type DeviceView } from './devices';
import { Avr, pinTitle, type McuPin, type PinMode } from './mcu';

/*
 * Симуляция проекта с прошивкой: контроллер + детали схемы. Время — такты контроллера;
 * интерфейс вызывает run() порциями (обычно раз в кадр) и забирает view().
 */

export { MCU_FREQ, MCU_TITLES } from './mcu';
export type { DeviceView, SimParam } from './devices';

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
}

export class Simulation {
  readonly mcu: Avr;
  readonly circuit: Circuit;
  readonly devices: Device[];
  readonly unknown: string[];
  /** Всё, что контроллер отправил в порт. */
  serial = '';
  readonly mcuTitle: string;
  onSerial: ((text: string) => void) | null = null;

  constructor(
    readonly project: Project,
    hex: string,
  ) {
    const found = findMcu(project);
    if (!found) throw new Error('Симуляция умеет Arduino Uno, Nano, Pro Mini, ATmega328P и ATmega32A: поставьте такой модуль или микросхему на схему. ESP32 и ESP8266 пока не поддерживаются.');
    this.mcu = Avr.fromHex(hex, found.kind, found.freq);
    this.circuit = new Circuit(project, this.mcu, found);
    this.mcuTitle = `${this.mcu.title}, ${(found.freq / 1e6).toLocaleString('ru', { maximumFractionDigits: 4 })} МГц (${found.freqFrom})`;
    const b = buildDevices(this.circuit, project);
    this.devices = b.devices;
    this.unknown = b.unknown;
    this.mcu.usart.onByteTransmit = (v) => {
      const ch = String.fromCharCode(v);
      this.serial += ch;
      if (this.serial.length > 20000) this.serial = this.serial.slice(-15000);
      this.onSerial?.(ch);
    };
  }

  get seconds(): number {
    return this.mcu.cycles / this.mcu.freq;
  }

  run(cycles: number): void {
    this.mcu.run(cycles);
  }

  /** Отправить текст в порт контроллера (как из монитора порта). */
  serialWrite(text: string): void {
    // Байты уходят по одному с паузой, как по настоящей линии.
    const bytes = [...new TextEncoder().encode(text)];
    const perChar = Math.max(1, Math.round((this.mcu.freq / Math.max(300, this.mcu.usart.baudRate)) * 10));
    let i = 0;
    const send = () => {
      if (i >= bytes.length) return;
      this.mcu.usart.writeByte(bytes[i++]);
      this.mcu.cpu.addClockEvent(send, perChar);
    };
    send();
  }

  press(id: string, down: boolean): void {
    this.devices.find((d) => d.id === id)?.press?.(down);
  }

  set(id: string, key: string, value: number): void {
    this.devices.find((d) => d.id === id)?.set?.(key, value);
  }

  /** Действие устройства (провести катушкой над целью). */
  act(id: string, key: string): void {
    this.devices.find((d) => d.id === id)?.act?.(key);
  }

  /** Снимок для интерфейса; сбрасывает статистику кадра (яркость ШИМ, частоты). */
  view(): SimView {
    const c = this.circuit;
    const pins: PinView[] = [];
    for (const [pin, g] of [...c.pinGroup].sort((a, b) => a[0].localeCompare(b[0]))) {
      pins.push({ pin, title: pinTitle(pin, this.mcu.kind), mode: this.mcu.pinMode(pin), level: c.levelOf(g), duty: c.frameStats(g).duty, net: c.groups[g].name, floating: c.isFloating(g), conflict: c.isConflict(g) });
    }
    const nets = new Map<string, { level: 0 | 1; duty: number }>();
    c.groups.forEach((gr, g) => {
      if (gr.power) return;
      const st = { level: c.levelOf(g), duty: c.frameStats(g).duty };
      for (const n of gr.nets) nets.set(n, st);
    });
    const devices = this.devices.map((d) => d.view());
    c.endFrame();
    return { seconds: this.seconds, pins, devices, nets, baud: this.mcu.usart.baudRate, mcu: this.mcuTitle };
  }
}
