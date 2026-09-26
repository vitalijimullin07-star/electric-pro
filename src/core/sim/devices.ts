import type { TWIEventHandler, AVRTWI } from 'avr8js';
import type { Component, FootprintDef, Id, Project } from '../model/types';
import type { Circuit, Level } from './circuit';
import { Hd44780 } from './hd44780';
import type { McuPin } from './mcu';
import { CoilModel } from './metal-detector';
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
  /** Выбор из списка: значение — номер варианта. */
  options?: string[];
}

export interface DeviceView {
  id: string;
  comp: Id;
  ref: string;
  kind: 'led' | 'button' | 'pot' | 'analog' | 'digital' | 'buzzer' | 'relay' | 'lcd' | 'oled' | 'sensor' | 'coil' | 'battery';
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
  /** Кнопки действий (провести катушкой над целью). */
  actions?: { key: string; label: string }[];
  /** Уровень 0…1 для полоски (близость цели, заряд). */
  level?: number;
  /** ЖК: свои символы (коды 0…7) по строкам — растр 5×8, биты строк. */
  glyphs?: number[][];
  /** ЖК: коды символов по строкам экрана. */
  codes?: number[][];
}

export interface Device {
  id: string;
  comp: Component;
  view(): DeviceView;
  press?(down: boolean): void;
  set?(key: string, value: number): void;
  act?(key: string): void;
}
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
  const US = mcu.freq / 1e6;
  // Катушки металлоискателя — первыми: их сигнал читает АЦП приёмника.
  const coils: CoilModel[] = [];
  for (const comp of Object.values(p.components)) {
    const fp = p.footprints[comp.footprint];
    if (!fp || !(fp.tags ?? []).includes('dd-coil')) continue;
    const coil = new CoilModel(c, comp, fp, p);
    coils.push(coil);
    devices.push({ id: comp.id, comp, view: () => coil.view(), set: (k, v) => coil.set(k, v), act: (k) => coil.act(k) });
  }
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
    if (!fp || (fp.tags ?? []).includes('dd-coil')) continue;
    const tags = fp.tags ?? [];
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
          const dk = c.frameStats(k).lowDuty;
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
        // Тактовая кнопка: при нажатии её цепи замыкаются (на землю — «0», на питание — «1»,
        // между двумя сигналами — одна цепь, как в клавиатуре с диодами).
        const groups = [...new Set(fp.pads.map((x) => c.groupOfPad(comp, x.number)).filter((x): x is number => x !== undefined))];
        const sws = groups.slice(1).map((g) => c.addSwitch(groups[0], g));
        let down = false;
        subs.push({
          key: 'B',
          label: comp.description && !/^Кнопка/.test(comp.description) ? comp.description : 'кнопка',
          press: (d) => {
            down = d;
            for (const s of sws) c.setSwitch(s, d);
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

    // --- диоды: передают «0» с катода на анод (клавиатуры, развязка) ---
    if (fp.category === 'Диоды' && pads.has('A') && pads.has('K')) {
      const a = g('A');
      const k = g('K');
      if (a !== undefined && k !== undefined) c.addDiode(a, k);
      continue;
    }

    // --- транзисторы как ключи ---
    const pol = transistorType(fp, comp);
    if (pol) {
      const bjt = pol === 'npn' || pol === 'pnp';
      const ctl = g(bjt ? 'B' : 'G');
      const out = g(bjt ? 'C' : 'D');
      const com = g(bjt ? 'E' : 'S');
      if (ctl === undefined || out === undefined || com === undefined) continue;
      const nType = pol === 'npn' || pol === 'nmos';
      const owner = comp.id;
      // Эмиттер (исток) на земле для NPN/N-канального, на питании — для PNP/P-канального.
      const comOk = () => (nType ? c.voltsOf(com) < 1.5 : c.voltsOf(com) > 2.5);
      const update = () => {
        const on = comOk() && !c.isFloating(ctl) && c.levelOf(ctl) === (nType ? 1 : 0);
        c.drive(out, owner, on ? (nType ? 0 : 1) : null);
      };
      c.onChange((grp) => {
        if (grp === ctl || grp === com) update();
      });
      update();
      continue;
    }

    // --- АЦП MCP3201 (SPI, 12 бит) ---
    if (/MCP3201/i.test(`${id} ${comp.value} ${tags.join(' ')}`)) {
      const cs = g('CS') ?? g('CS/SHDN');
      const inp = g('IN+');
      const inn = g('IN-');
      const ref = g('VREF');
      let word = 0;
      let idx = 0;
      let last = 0;
      const coil = coils[0];
      c.onChange((grp, lvl, cycle) => {
        if (grp !== cs || lvl !== 0) return;
        const vref = ref !== undefined ? c.voltsOf(ref) : 5;
        const vin = coil ? coil.sample(cycle, vref / 2) : (inp !== undefined ? c.voltsOf(inp) : 0) - (inn !== undefined ? c.voltsOf(inn) : 0);
        word = Math.max(0, Math.min(4095, Math.round((vin / Math.max(0.1, vref)) * 4096)));
        last = word;
        idx = 0;
      });
      // Два байта: [x x 0 B11…B7] [B6…B0 B1], дальше — младшие биты вперёд (как у микросхемы).
      spiDevs.push({ cs, next: () => (idx++ === 0 ? (word >> 7) & 0x1f : idx === 2 ? ((word << 1) & 0xfe) | ((word >> 1) & 1) : 0) });
      use('CS', 'CLK', 'DOUT', 'IN+', 'IN-', 'VREF');
      devices.push({ id: comp.id, comp, view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'sensor', title: `${comp.ref} АЦП MCP3201: ${last} (${((last / 4096) * (ref !== undefined ? c.voltsOf(ref) : 5)).toFixed(3)} В)${coil ? ', сигнал с катушки ' + coil.comp.ref : ''}`, warning: cs === undefined ? 'CS не подключён' : undefined }) });
      continue;
    }

    // --- аккумулятор: напряжение цепи питания ---
    if (tags.includes('battery') && pads.has('+')) {
      const plus = g('+');
      const init = plus !== undefined ? c.powerOf(plus) || 12 : 12;
      const params = [param('u', 'напряжение', +init.toFixed(1), 3, 16, 0.1, 'В')];
      c.setPowerVolts(plus, init);
      devices.push({
        id: comp.id,
        comp,
        set: (_k, v) => {
          params[0].value = v;
          c.setPowerVolts(plus, v);
        },
        view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'battery', title: `${comp.ref} аккумулятор ${comp.value}`, params, warning: plus === undefined || c.groups[plus].power !== 'vcc' ? '«+» не на цепи питания' : undefined }),
      });
      continue;
    }

    // --- зуммер и динамик ---
    if (/^Buzzer_|^Speaker_|^Module_KY-006$|^Module_KY-012$/.test(id) || tags.includes('speaker')) {
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
          const what = /^Speaker_/.test(id) || tags.includes('speaker') ? 'динамик' : 'зуммер';
          return { id: comp.id, comp: comp.id, ref: comp.ref, kind: 'buzzer', title: `${comp.ref} ${what}${active ? ' активный' : ''}`, on, hz: tone ? Math.round(st.hz) : active && on ? 2300 : 0 };
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
      devices.push({ id: comp.id, comp, view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'lcd', title: `${comp.ref} ЖК ${lcd.cols}×${lcd.rows} по I²C (0x${addr.toString(16)})`, lines: lcd.lines(), ...lcdGlyphs(lcd), backlight: lcd.backlight, warning: i2cWarn() }) });
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
      use('RS', 'E', 'RW', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K');
      // Подсветка: анод к плюсу, катод через ключ — светит, пока катод держат в «0».
      const ba = g('A');
      const bk = g('K');
      const light = () => (ba === undefined || bk === undefined ? 1 : c.frameStats(ba).duty * c.frameStats(bk).lowDuty);
      devices.push({ id: comp.id, comp, view: () => ({ id: comp.id, comp: comp.id, ref: comp.ref, kind: 'lcd', title: `${comp.ref} ЖК ${lcd.cols}×${lcd.rows} (параллельный)`, lines: lcd.lines(), ...lcdGlyphs(lcd), backlight: light() > 0.05, brightness: light(), warning: rs === undefined ? 'RS не подключён' : undefined }) });
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

/** Тип транзистора: по меткам корпуса, описанию и номиналу (C945 — NPN, A733 — PNP, IRF9… — P-канальный). */
export function transistorType(fp: FootprintDef, comp: Component): 'npn' | 'pnp' | 'nmos' | 'pmos' | null {
  const names = new Set(fp.pads.map((q) => (q.name ?? '').toUpperCase()));
  const bjt = names.has('B') && names.has('C') && names.has('E');
  const fet = names.has('G') && names.has('D') && names.has('S');
  if (!bjt && !fet) return null;
  const t = `${(fp.tags ?? []).join(' ')} ${fp.id} ${fp.description ?? ''} ${comp.value} ${comp.description ?? ''}`.toLowerCase();
  if (bjt) {
    if (/\bpnp\b/.test(t)) return 'pnp';
    if (/\bnpn\b/.test(t)) return 'npn';
    const v = comp.value.toUpperCase().replace(/\s+/g, '');
    if (/^(2S)?A\d{3}|^BC(55[6-9]|85[6-9]|32[78]|636|640)|^2N(2907|3906|4403|5401)|^S(8550|9012|9015)|^KT(361|3107|814|816|818)|^TIP(3[02]|4[24]|12[5-7]|147)|^MJE(2955|350)|^BD(136|138|140)/.test(v)) return 'pnp';
    return 'npn';
  }
  if (/p-mosfet|pmos|p-канал|p-channel/.test(t)) return 'pmos';
  if (/n-mosfet|nmos|n-канал|n-channel/.test(t)) return 'nmos';
  const v = comp.value.toUpperCase().replace(/\s+/g, '');
  if (/^IRF9|^IRF(4905|5305|5210)|^AO340[17]|^SI23(01|05)|^FQP\d+P|^NDP\d+P|^BS250/.test(v)) return 'pmos';
  return 'nmos';
}

/** Свои символы ЖК (CGRAM) и коды экрана — чтобы нарисовать шкалы и значки как на дисплее. */
function lcdGlyphs(lcd: Hd44780): { glyphs?: number[][]; codes?: number[][] } {
  const codes = Array.from({ length: lcd.rows }, (_, r) => lcd.codes(r));
  if (!codes.some((row) => row.some((c) => c < 16))) return {};
  const glyphs = Array.from({ length: 8 }, (_, i) => Array.from(lcd.cgram.subarray(i * 8, i * 8 + 8)));
  return { glyphs, codes: lcd.displayOn ? codes : codes.map((r) => r.map(() => 32)) };
}
