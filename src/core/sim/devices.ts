import type { TWIEventHandler, AVRTWI } from 'avr8js';
import type { Component, FootprintDef, Id, Project } from '../model/types';
import type { Circuit, Level } from './circuit';
import { Hd44780 } from './hd44780';
import { MCU_FREQ, type McuPin } from './mcu';
import { Ssd1306 } from './ssd1306';

/*
 * Детали вокруг контроллера: распознаются по корпусу из библиотеки и именам выводов,
 * подключаются к группам цепей схемы. Каждая деталь отдаёт «вид» для интерфейса
 * (горит, нажата, что на экране) и принимает управление (нажать, крутить ползунок).
 */

export interface SimParam {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export interface DeviceView {
  id: string;
  comp: Id;
  ref: string;
  kind: 'led' | 'button' | 'pot' | 'analog' | 'digital' | 'buzzer' | 'relay' | 'lcd' | 'oled' | 'sensor';
  title: string;
  /** Не подключено к контроллеру как нужно — объяснение. */
  warning?: string;
  on?: boolean;
  brightness?: number;
  color?: string;
  pressed?: boolean;
  params?: SimParam[];
  hz?: number;
  lines?: string[];
  backlight?: boolean;
  frame?: Uint8Array;
  width?: number;
  height?: number;
  channels?: boolean[];
}

export interface Device {
  id: string;
  comp: Component;
  view(): DeviceView;
  press?(down: boolean): void;
  set?(key: string, value: number): void;
}

const US = MCU_FREQ / 1e6;
const up = (s: string | undefined) => (s ?? '').toUpperCase();

/** Выводы корпуса по имени (без учёта регистра). */
function padsOf(fp: FootprintDef): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of fp.pads) {
    if (p.type === 'npth') continue;
    const k = up(p.name ?? p.number);
    m.set(k, [...(m.get(k) ?? []), p.number]);
  }
  return m;
}

function ledColor(c: Component): string {
  const t = `${c.value} ${c.description ?? ''}`.toLowerCase();
  if (/зел|green/.test(t)) return '#34c759';
  if (/син|blue/.test(t)) return '#0a84ff';
  if (/жёлт|желт|yellow/.test(t)) return '#ffd60a';
  if (/бел|white/.test(t)) return '#f2f2f2';
  if (/оранж|orange/.test(t)) return '#ff9f0a';
  return '#ff3b30';
}

const param = (key: string, label: string, value: number, min: number, max: number, step: number, unit: string): SimParam => ({ key, label, value, min, max, step, unit });

/* ---------------- I²C ---------------- */

interface I2cDevice {
  start(write: boolean): void;
  write(v: number): boolean;
  read(): number;
  stop(): void;
}

class I2cBus implements TWIEventHandler {
  readonly devices = new Map<number, I2cDevice>();
  private cur: I2cDevice | null = null;
  constructor(private twi: AVRTWI) {}
  start(): void {
    this.twi.completeStart();
  }
  stop(): void {
    this.cur?.stop();
    this.cur = null;
    this.twi.completeStop();
  }
  connectToSlave(addr: number, write: boolean): void {
    this.cur?.stop();
    this.cur = this.devices.get(addr) ?? null;
    this.cur?.start(write);
    this.twi.completeConnect(!!this.cur);
  }
  writeByte(v: number): void {
    this.twi.completeWrite(this.cur ? this.cur.write(v) : false);
  }
  readByte(): void {
    this.twi.completeRead(this.cur ? this.cur.read() & 0xff : 0xff);
  }
}

const bcd = (v: number) => ((Math.floor(v / 10) << 4) | v % 10) & 0xff;
const unbcd = (v: number) => (v >> 4) * 10 + (v & 15);

/* ---------------- сборка ---------------- */

export interface BuildResult {
  devices: Device[];
  /** Детали, которые симуляция не знает (для подсказки). */
  unknown: string[];
}

export function buildDevices(c: Circuit, p: Project): BuildResult {
  const devices: Device[] = [];
  const used = new Set<string>();
  const unknown: string[] = [];
  const mcu = c.mcu;
  const bus = new I2cBus(mcu.twi);
  mcu.twi.eventHandler = bus;
  const spiDevs: { cs: number | undefined; next: () => number }[] = [];
  mcu.spi.onTransfer = () => {
    for (const d of spiDevs) if (d.cs !== undefined && c.levelOf(d.cs) === 0) return d.next();
    return 0xff;
  };
  const sda = c.pinGroup.get('PC4');
  const scl = c.pinGroup.get('PC5');
  const hasLcd2004 = Object.values(p.components).some((x) => /LCD2004/.test(x.footprint));

  for (const comp of Object.values(p.components)) {
    if (comp.id === c.mcuComp.id) continue;
    const fp = p.footprints[comp.footprint];
    if (!fp) continue;
    const pads = padsOf(fp);
    const g = (name: string): number | undefined => {
      const nums = pads.get(up(name));
      if (!nums) return undefined;
      for (const n of nums) {
        const grp = c.groupOfPad(comp, n);
        if (grp !== undefined) return grp;
      }
      return undefined;
    };
    const use = (...names: string[]) => names.forEach((n) => used.add(comp.id + ':' + up(n)));
    const id = fp.id;
    const onI2c = () => g('SDA') !== undefined && g('SDA') === sda && g('SCL') === scl;
    const i2cWarn = () => (onI2c() ? undefined : 'SDA и SCL не соединены с A4 и A5 контроллера');

    // --- светодиоды ---
    if (fp.category === 'Светодиоды' && pads.has('A') && pads.has('K')) {
      const a = g('A');
      const k = g('K');
      const color = ledColor(comp);
      devices.push({
        id: comp.id,
        comp,
        view: () => {
          if (a === undefined || k === undefined) return { id: comp.id, comp: comp.id, ref: comp.ref, kind: 'led', title: `${comp.ref} светодиод`, on: false, brightness: 0, color, warning: 'вывод не подключён' };
          const da = c.frameStats(a).duty;
          const dk = 1 - c.frameStats(k).duty;
          const b = Math.max(0, Math.min(1, da * dk));
          return { id: comp.id, comp: comp.id, ref: comp.ref, kind: 'led', title: `${comp.ref} светодиод`, on: b > 0.02, brightness: b, color };
        },
      });
      continue;
    }
    if (fp.category === 'Светодиоды' && pads.has('R') && pads.has('G') && pads.has('B') && pads.has('COM')) {
      const com = g('COM');
      const anode = com !== undefined && c.groups[com].power === 'vcc';
      const ch = ['R', 'G', 'B'].map((x) => g(x));
      devices.push({
        id: comp.id,
        comp,
        view: () => {
          const v = ch.map((x) => (x === undefined ? 0 : anode ? 1 - c.frameStats(x).duty : c.frameStats(x).duty));
          const b = Math.max(...v);
          const color = `rgb(${Math.round(v[0] * 255)},${Math.round(v[1] * 255)},${Math.round(v[2] * 255)})`;
          return { id: comp.id, comp: comp.id, ref: comp.ref, kind: 'led', title: `${comp.ref} RGB-светодиод`, on: b > 0.02, brightness: b, color };
        },
      });
      continue;
    }

    // --- кнопки ---
    if ((fp.category === 'Кнопки и переключатели' && /^SW_(PUSH|Tact)/i.test(id)) || /^Module_KY-004$|^Module_TTP223|^Module_Button_4$|Joystick/.test(id)) {
      const subs: { key: string; label: string; press: (down: boolean) => void; state: () => boolean }[] = [];
      if (/^Module_Button_4$/.test(id)) {
        for (const k of ['K1', 'K2', 'K3', 'K4']) {
          let down = false;
          const gg = g(k);
          subs.push({ key: k, label: k, press: (d) => ((down = d), c.drive(gg, comp.id + k, d ? 0 : null)), state: () => down });
          use(k);
        }
      } else if (/TTP223/.test(id)) {
        let down = false;
        const gg = g('I/O');
        c.drive(gg, comp.id, 0);
        subs.push({ key: 'T', label: 'касание', press: (d) => ((down = d), c.drive(gg, comp.id, d ? 1 : 0)), state: () => down });
        use('I/O');
      } else if (/KY-004/.test(id)) {
        let down = false;
        const gg = g('S');
        c.drive(gg, comp.id, 1);
        subs.push({ key: 'S', label: 'кнопка', press: (d) => ((down = d), c.drive(gg, comp.id, d ? 0 : 1)), state: () => down });
        use('S');
      } else if (/Joystick/.test(id)) {
        let down = false;
        const gg = g('SW');
        subs.push({ key: 'SW', label: 'кнопка', press: (d) => ((down = d), c.drive(gg, comp.id + 'SW', d ? 0 : null)), state: () => down });
        use('SW');
      } else {
        // Тактовая кнопка: при нажатии все её цепи замыкаются; со стороны земли — «0», со стороны питания — «1».
        const groups = [...new Set(fp.pads.map((x) => c.groupOfPad(comp, x.number)).filter((x): x is number => x !== undefined))];
        const gnd = groups.some((x) => c.groups[x].power === 'gnd');
        const vcc = groups.some((x) => c.groups[x].power === 'vcc');
        let down = false;
        subs.push({
          key: 'B',
          label: 'кнопка',
          press: (d) => {
            down = d;
            for (const x of groups) if (!c.groups[x].power) c.drive(x, comp.id, d && (gnd || vcc) ? (gnd ? 0 : 1) : null);
          },
          state: () => down,
        });
      }
      if (/Joystick/.test(id)) {
        // Оси джойстика — два потенциометра.
        for (const ax of ['VRX', 'VRY']) {
          const gg = g(ax);
          const dev = potDevice(c, comp, `${comp.id}:${ax}`, `${comp.ref} джойстик ${ax === 'VRX' ? 'X' : 'Y'}`, gg, 0.5);
          devices.push(dev);
          use(ax);
        }
      }
      for (const sb of subs) {
        devices.push({
          id: `${comp.id}:${sb.key}`,
          comp,
          press: sb.press,
          view: () => ({ id: `${comp.id}:${sb.key}`, comp: comp.id, ref: comp.ref, kind: 'button', title: `${comp.ref} ${sb.label}`, pressed: sb.state() }),
        });
      }
      continue;
    }

    // --- потенциометры ---
    if (/^Potentiometer_|^Module_Potentiometer$/.test(id)) {
      const w = g('W') ?? g('OUT');
      devices.push(potDevice(c, comp, comp.id, `${comp.ref} потенциометр`, w, 0.5, g('1') ?? g('GND'), g('3') ?? g('VCC')));
      use('W', 'OUT');
      continue;
    }

    // --- зуммер ---
    if (/^Buzzer_|^Module_KY-006$|^Module_KY-012$/.test(id)) {
      const sig = /KY-0/.test(id) ? g('S') : [...pads.keys()].map((k) => g(k)).find((x) => x !== undefined && !c.groups[x].power);
      const active = /KY-012|12x9\.5/.test(id);
      devices.push({
        id: comp.id,
        comp,
        view: () => {
          if (sig === undefined) return { id: comp.id, comp: comp.id, ref: comp.ref, kind: 'buzzer', title: `${comp.ref} зуммер`, on: false, warning: 'не подключён к выводу контроллера' };
          const st = c.frameStats(sig);
          const tone = st.hz > 40;
          const on = tone || (active && st.duty > 0.5);
          return { id: comp.id, comp: comp.id, ref: comp.ref, kind: 'buzzer', title: `${comp.ref} зуммер${active ? ' активный' : ''}`, on, hz: tone ? Math.round(st.hz) : active && on ? 2300 : 0 };
        },
      });
      use('S', '+', '-', '1', '2');
      continue;
    }

    // --- реле ---
    if (/^Module_Relay_|^Module_KY-019$|^Module_SSR_/.test(id)) {
      const ins = [...pads.keys()].filter((k) => /^(IN\d*|S|CH\d)$/.test(k));
      const lowTrig = /^Module_Relay_/.test(id);
      const gs = ins.map((k) => g(k));
      use(...ins);
      devices.push({
        id: comp.id,
        comp,
        view: () => ({
          id: comp.id,
          comp: comp.id,
          ref: comp.ref,
          kind: 'relay',
          title: `${comp.ref} реле (${lowTrig ? 'включается нулём' : 'включается единицей'})`,
          channels: gs.map((x) => x !== undefined && c.levelOf(x) === (lowTrig ? 0 : 1) && !c.isFloating(x)),
        }),
      });
      continue;
    }

    // --- ЖК через PCF8574 (I²C) ---
    if (/^Module_PCF8574_LCD_Backpack$|^IC_PCF8574/.test(id)) {
      const lcd = new Hd44780(hasLcd2004 ? 20 : 16, hasLcd2004 ? 4 : 2);
      let port = 0xff;
      let addr = 0x27;
      if (/^IC_/.test(id)) {
        addr = 0x20;
        ['A0', 'A1', 'A2'].forEach((k, i) => {
          const x = g(k);
          if (x !== undefined && c.groups[x].power === 'vcc') addr |= 1 << i;
        });
      }
      const dev: I2cDevice = {
        start: () => undefined,
        write: (v) => {
          const prevE = port & 4;
          port = v;
          lcd.backlight = !!(v & 8);
          if (prevE && !(v & 4)) lcd.strobe(!!(v & 1), v >> 4, 0);
          return true;
        },
        read: () => port,
        stop: () => undefined,
      };
      if (onI2c()) {
        bus.devices.set(addr, dev);
        if (!/^IC_/.test(id)) bus.devices.set(0x3f, dev);
      }
      use('SDA', 'SCL');
      devices.push({ id: comp.id, comp, view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'lcd', title: `${comp.ref} ЖК ${lcd.cols}×${lcd.rows} по I²C (0x${addr.toString(16)})`, lines: lcd.lines(), backlight: lcd.backlight, warning: i2cWarn() }) });
      continue;
    }

    // --- ЖК параллельный ---
    if (/^Module_LCD(1602|2004)$/.test(id)) {
      const rs = g('RS');
      const e = g('E');
      const d = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'].map((k) => g(k));
      const direct = e !== undefined && c.groups[e].pins.length > 0;
      if (!direct) continue; // вероятно, работает через переходник PCF8574 — его дисплей и покажем
      const lcd = new Hd44780(/2004/.test(id) ? 20 : 16, /2004/.test(id) ? 4 : 2);
      const bit = (x: number | undefined) => (x !== undefined && c.levelOf(x) ? 1 : 0);
      c.onChange((grp, lvl) => {
        if (grp !== e || lvl !== 0) return;
        const hi = (bit(d[7]) << 3) | (bit(d[6]) << 2) | (bit(d[5]) << 1) | bit(d[4]);
        const lo = (bit(d[3]) << 3) | (bit(d[2]) << 2) | (bit(d[1]) << 1) | bit(d[0]);
        lcd.strobe(rs !== undefined && c.levelOf(rs) === 1, hi, lo);
      });
      use('RS', 'E', 'RW', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7');
      devices.push({ id: comp.id, comp, view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'lcd', title: `${comp.ref} ЖК ${lcd.cols}×${lcd.rows} (параллельный)`, lines: lcd.lines(), backlight: true, warning: rs === undefined ? 'RS не подключён' : undefined }) });
      continue;
    }

    // --- OLED по I²C ---
    if (/^Module_OLED_.*I2C$/.test(id)) {
      const small = /0\.91/.test(id);
      const oled = new Ssd1306(128, small ? 32 : 64, /1\.3/.test(id));
      const dev: I2cDevice = { start: () => oled.begin(), write: (v) => (oled.byte(v), true), read: () => 0, stop: () => undefined };
      if (onI2c()) {
        bus.devices.set(0x3c, dev);
        bus.devices.set(0x3d, dev);
      }
      use('SDA', 'SCL');
      devices.push({ id: comp.id, comp, view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'oled', title: `${comp.ref} OLED ${oled.width}×${oled.height}${oled.sh1106 ? ' SH1106' : ''} (0x3C)`, frame: oled.frame(), width: oled.width, height: oled.height, warning: i2cWarn() }) });
      continue;
    }

    // --- часы ---
    if (/^Module_DS3231$|^Module_DS1307_RTC$|^IC_DS1307/.test(id)) {
      let offset = 0;
      let ptr = 0;
      let first = false;
      const regs = new Uint8Array(0x13);
      const fill = () => {
        const t = new Date(Date.now() + offset);
        regs.set([bcd(t.getSeconds()), bcd(t.getMinutes()), bcd(t.getHours()), bcd(t.getDay() || 7), bcd(t.getDate()), bcd(t.getMonth() + 1), bcd(t.getFullYear() % 100)], 0);
        regs[0x11] = 25;
      };
      const dev: I2cDevice = {
        start: (w) => {
          first = w;
          if (!w) fill();
        },
        write: (v) => {
          if (first) {
            ptr = v % regs.length;
            first = false;
            return true;
          }
          regs[ptr] = v;
          if (ptr <= 6) {
            const t = new Date(2000 + unbcd(regs[6]), unbcd(regs[5] & 0x1f) - 1, unbcd(regs[4]), unbcd(regs[2] & 0x3f), unbcd(regs[1]), unbcd(regs[0] & 0x7f));
            offset = t.getTime() - Date.now();
          }
          ptr = (ptr + 1) % regs.length;
          return true;
        },
        read: () => {
          const v = regs[ptr];
          ptr = (ptr + 1) % regs.length;
          return v;
        },
        stop: () => undefined,
      };
      if (onI2c()) bus.devices.set(0x68, dev);
      use('SDA', 'SCL');
      devices.push({ id: comp.id, comp, view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'sensor', title: `${comp.ref} часы (0x68): ${new Date(Date.now() + offset).toLocaleTimeString('ru')}`, warning: i2cWarn() }) });
      continue;
    }

    // --- АЦП ADS1115 ---
    if (/^Module_ADS1115$/.test(id)) {
      const ag = g('ADDR');
      const addr = ag === undefined || c.groups[ag].power === 'gnd' ? 0x48 : c.groups[ag].power === 'vcc' ? 0x49 : ag === sda ? 0x4a : ag === scl ? 0x4b : 0x48;
      const params = [0, 1, 2, 3].map((i) => param(`A${i}`, `A${i}`, 1 + i * 0.5, 0, 5, 0.01, 'В'));
      let config = 0x8583;
      let ptr = 0;
      let first = false;
      let wbuf: number[] = [];
      let rbyte = 0;
      const conversion = () => {
        const mux = (config >> 12) & 7;
        const fs = [6.144, 4.096, 2.048, 1.024, 0.512, 0.256, 0.256, 0.256][(config >> 9) & 7];
        const v = (i: number) => params[i].value;
        const diff = [v(0) - v(1), v(0) - v(3), v(1) - v(3), v(2) - v(3), v(0), v(1), v(2), v(3)][mux];
        return Math.max(-32768, Math.min(32767, Math.round((diff / fs) * 32768))) & 0xffff;
      };
      const dev: I2cDevice = {
        start: (w) => {
          first = w;
          wbuf = [];
          rbyte = 0;
        },
        write: (v) => {
          if (first) {
            ptr = v & 3;
            first = false;
          } else {
            wbuf.push(v);
            if (wbuf.length === 2 && ptr === 1) config = ((wbuf[0] << 8) | wbuf[1]) | 0x8000;
          }
          return true;
        },
        read: () => {
          const word = ptr === 0 ? conversion() : ptr === 1 ? config : 0x8000;
          return rbyte++ === 0 ? word >> 8 : word & 0xff;
        },
        stop: () => undefined,
      };
      if (onI2c()) bus.devices.set(addr, dev);
      use('SDA', 'SCL', 'ADDR', 'A0', 'A1', 'A2', 'A3');
      devices.push({
        id: comp.id,
        comp,
        set: (k, v) => {
          const pp = params.find((x) => x.key === k);
          if (pp) pp.value = v;
        },
        view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'sensor', title: `${comp.ref} АЦП ADS1115 (0x${addr.toString(16)})`, params, warning: i2cWarn() }),
      });
      continue;
    }

    // --- DHT11 / DHT22 ---
    if (/DHT|KY-015/.test(id)) {
      const data = g('DATA') ?? g('OUT') ?? g('S');
      const dht11 = /DHT11|KY-015/.test(id);
      const params = [param('t', 'температура', 24.5, -40, 80, 0.1, '°C'), param('h', 'влажность', 45, 0, 100, 0.1, '%')];
      let lowAt = -1;
      const owner = comp.id;
      const respond = () => {
        const t = params[0].value;
        const h = params[1].value;
        let bytes: number[];
        if (dht11) bytes = [Math.round(h), 0, Math.round(Math.abs(t)), 0];
        else {
          const hh = Math.round(h * 10);
          const tt = Math.round(Math.abs(t) * 10) | (t < 0 ? 0x8000 : 0);
          bytes = [hh >> 8, hh & 0xff, tt >> 8, tt & 0xff];
        }
        bytes.push((bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 0xff);
        const seq: [number, Level | null][] = [[30, 0], [80, 1], [80, 0]];
        for (const b of bytes) for (let i = 7; i >= 0; i--) seq.push([50, 1], [(b >> i) & 1 ? 70 : 26, 0]);
        seq.push([50, null]);
        // seq: задержка перед сменой уровня → уровень.
        let k = 0;
        const step = () => {
          const [, lvl] = seq[k];
          c.drive(data, owner, lvl);
          k++;
          if (k < seq.length) mcu.cpu.addClockEvent(step, seq[k][0] * US);
        };
        mcu.cpu.addClockEvent(step, seq[0][0] * US);
      };
      c.onMcuPin((_pin, grp, mode, cycle) => {
        if (grp !== data) return;
        if (mode === 'low') lowAt = cycle;
        else if (lowAt >= 0) {
          if (cycle - lowAt >= 500 * US) respond();
          lowAt = -1;
        }
      });
      use('DATA', 'OUT', 'S');
      devices.push({
        id: comp.id,
        comp,
        set: (k, v) => {
          const pp = params.find((x) => x.key === k);
          if (pp) pp.value = v;
        },
        view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'sensor', title: `${comp.ref} ${dht11 ? 'DHT11' : 'DHT22'}`, params, warning: data === undefined || !c.groups[data].pins.length ? 'DATA не подключён к выводу контроллера' : undefined }),
      });
      continue;
    }

    // --- ультразвуковой дальномер ---
    if (/HC-SR04|JSN-SR04T/.test(id)) {
      const trig = g('TRIG');
      const echo = g('ECHO');
      const params = [param('d', 'расстояние', 50, 2, 400, 1, 'см')];
      let riseAt = -1;
      c.onChange((grp, lvl, cycle) => {
        if (grp !== trig) return;
        if (lvl === 1) riseAt = cycle;
        else if (riseAt >= 0 && cycle - riseAt >= 8 * US) {
          riseAt = -1;
          const us = params[0].value * 58.3;
          mcu.cpu.addClockEvent(() => {
            c.drive(echo, comp.id, 1);
            mcu.cpu.addClockEvent(() => c.drive(echo, comp.id, 0), us * US);
          }, 250 * US);
        }
      });
      c.drive(echo, comp.id, 0);
      use('TRIG', 'ECHO');
      devices.push({
        id: comp.id,
        comp,
        set: (_k, v) => void (params[0].value = v),
        view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'sensor', title: `${comp.ref} дальномер`, params, warning: trig === undefined || echo === undefined ? 'TRIG или ECHO не подключены' : undefined }),
      });
      continue;
    }

    // --- термопара MAX6675 / MAX31855 ---
    if (/MAX6675|MAX31855/.test(id)) {
      const cs = g('CS');
      const sck = g('SCK');
      const so = g('SO');
      const is31855 = /31855/.test(id);
      const params = [param('t', 'температура', 25, -100, 1000, 0.25, '°C')];
      const word = (): { v: number; bits: number } => {
        const q = Math.round(params[0].value * 4);
        if (!is31855) return { v: (Math.max(0, q) & 0xfff) << 3, bits: 16 };
        return { v: (((q & 0x3fff) << 18) | ((25 * 16) << 4)) >>> 0, bits: 32 };
      };
      let cur = word();
      let bit = 0;
      let byteIdx = 0;
      const out = () => c.drive(so, comp.id, ((cur.v >>> (cur.bits - 1 - bit)) & 1) as Level);
      c.onChange((grp, lvl) => {
        if (grp === cs) {
          if (lvl === 0) {
            cur = word();
            bit = 0;
            byteIdx = 0;
            out();
          } else c.drive(so, comp.id, null);
        } else if (grp === sck && lvl === 0 && cs !== undefined && c.levelOf(cs) === 0) {
          bit = Math.min(cur.bits - 1, bit + 1);
          out();
        }
      });
      spiDevs.push({ cs, next: () => (cur.v >>> (cur.bits - 8 * ++byteIdx)) & 0xff });
      use('CS', 'SCK', 'SO');
      devices.push({
        id: comp.id,
        comp,
        set: (_k, v) => void (params[0].value = v),
        view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'sensor', title: `${comp.ref} термопара ${is31855 ? 'MAX31855' : 'MAX6675'}`, params, warning: cs === undefined || sck === undefined || so === undefined ? 'CS, SCK или SO не подключены' : undefined }),
      });
      continue;
    }

    // --- общий случай: выходы модулей и датчиков → ползунок или переключатель ---
    const isModule = /^Module_|^Sensor_/.test(id) || fp.category === 'Датчики';
    let added = false;
    if (isModule) {
      for (const [name] of pads) {
        if (used.has(comp.id + ':' + name)) continue;
        if (/^(VCC|VDD|VIN|GND|\+|-|5V|3V3|\+5V|NC|VS|V\+|G|RAW)$/.test(name)) continue;
        const gg = g(name);
        if (gg === undefined || !c.groups[gg].pins.length) continue;
        const analogPin = c.groups[gg].pins.some((x: McuPin) => /^PC[0-5]$|^ADC/.test(x));
        if (analogPin && /^(AO|A0|AOUT|VOUT|OUT|S|SIG|VRX|VRY|X|Y|Z)$/.test(name)) {
          devices.push(potDevice(c, comp, `${comp.id}:${name}`, `${comp.ref} ${fp.name}: ${name}`, gg, 0.5, undefined, undefined, 'analog'));
          added = true;
        } else if (/^(DO|D0|OUT|S|SIG|DATA|INT|ALRT|ALE|IRQ|STATE|BUSY|DOUT|ZC|D|DRDY)$/.test(name)) {
          let v: Level = 0;
          const key = `${comp.id}:${name}`;
          c.drive(gg, key, v);
          devices.push({
            id: key,
            comp,
            set: (_k, val) => {
              v = val ? 1 : 0;
              c.drive(gg, key, v);
            },
            view: () => ({ id: key, comp: comp.id, ref: comp.ref, kind: 'digital', title: `${comp.ref} ${fp.name}: ${name}`, on: v === 1 }),
          });
          added = true;
        }
      }
      if (!added && Object.keys(comp.padNets).length) unknown.push(`${comp.ref} (${fp.name})`);
    }
  }
  return { devices, unknown };
}

/** Потенциометр или аналоговый выход: напряжение на цепи = доля × (верх − низ) + низ. */
function potDevice(c: Circuit, comp: Component, id: string, title: string, wiper: number | undefined, init: number, lo?: number, hi?: number, kind: 'pot' | 'analog' = 'pot'): Device {
  const params = [param('v', kind === 'pot' ? 'положение' : 'напряжение', kind === 'pot' ? init * 100 : init * 5, 0, kind === 'pot' ? 100 : 5, kind === 'pot' ? 1 : 0.01, kind === 'pot' ? '%' : 'В')];
  const apply = () => {
    const vlo = lo === undefined ? 0 : c.voltsOf(lo);
    const vhi = hi === undefined ? 5 : c.voltsOf(hi);
    const f = kind === 'pot' ? params[0].value / 100 : params[0].value / 5;
    c.setVolts(wiper, vlo + (vhi - vlo) * f);
  };
  apply();
  return {
    id,
    comp,
    set: (_k, v) => {
      params[0].value = v;
      apply();
    },
    view: () => ({ id, comp: comp.id, ref: comp.ref, kind, title, params, warning: wiper === undefined || !c.groups[wiper].pins.length ? 'выход не подключён к выводу контроллера' : undefined }),
  };
}
