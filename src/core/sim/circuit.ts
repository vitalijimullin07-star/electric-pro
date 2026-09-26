import type { Component, FootprintDef, Id, Project } from '../model/types';
import { ARDUINO_PINS, Avr, MCU_FREQ, type McuKind, type McuPin, type PinMode } from './mcu';

/*
 * Схема для симуляции на уровне логики: цепи проекта объединяются в группы (резистор
 * между двумя сигнальными цепями передаёт уровень), у каждой группы — уровень 0/1 и
 * напряжение для АЦП. Кто задаёт уровень, по старшинству:
 *   питание → выход контроллера → устройства (кнопка, датчик, транзисторный ключ; «0»
 *   сильнее «1», как у открытого стока) → аналоговый источник → подтяжка резисторами
 *   (делитель считается по номиналам) → подтяжка в контроллере.
 * Диоды и нажатые кнопки между сигнальными цепями связывают группы: кнопка замыкает две
 * группы в одну, диод передаёт «0» от катода к аноду и «1» от анода к катоду.
 * Группа, которую никто не задаёт, «висит в воздухе» (читается как 0 и отмечается).
 */

export type Level = 0 | 1;
export type Power = 'gnd' | 'vcc' | null;

export interface GroupInfo {
  nets: Id[];
  name: string;
  power: Power;
  /** Резисторы на цепи питания (для делителей): цепь питания и сопротивление. */
  pulls: { net: Id; ohms: number }[];
  pins: McuPin[];
  /** Цепь «жёсткая»: через шунт в несколько ом сидит на питании — выход контроллера её не пересилит. */
  stiff?: boolean;
}

/** Имена выводов контроллера, которые означают питание. */
const MCU_GND = /^(GND|GNDL|GNDR|AGND|VSS)$/i;
const MCU_VCC = /^(5V|\+5V|VCC|VDD|AVCC|3V3|3\.3V|VIN|RAW|IOREF)$/i;
/** Цепи с такими именами — питание, даже если к контроллеру не подключены. */
const NET_GND = /^(GND|GNDA|GNDD|AGND|DGND|PGND|0V|VSS|-VO|ЗЕМЛЯ)$/i;
const NET_VCC = /^(\+?5V|\+?5VD|VCC|VDD|AVCC|\+?3V3|\+?3\.3V|VIN|VBUS|\+?12V|\+?9V|\+?24V|\+?VBAT|\+?BATT?|RAW|\+VO)$/i;

/** Напряжение цепи питания по имени: +12V → 12, 3V3 → 3,3, аккумулятор — 12, остальное — 5 В. */
export function powerVoltsOf(name: string): number {
  const n = name.toUpperCase().replace(/^\+/, '');
  const m = /^(\d+)(?:[V.,](\d+))?V?$/.exec(n);
  if (m) return parseFloat(`${m[1]}.${m[2] || 0}`);
  if (/BAT/.test(n)) return 12;
  return 5;
}

/** Сопротивление по номиналу: «4,3 кОм*», «1K1», «47R», «100 Ом», «2k2», «1M». */
export function parseOhms(value: string): number | null {
  const v = value.replace(/\*/g, '').replace(/\s+/g, '').replace(',', '.').toLowerCase();
  const code = /^(\d+)(k|к|m|м|r)(\d+)$/.exec(v);
  if (code) {
    const mul = code[2] === 'k' || code[2] === 'к' ? 1e3 : code[2] === 'm' || code[2] === 'м' ? 1e6 : 1;
    return parseFloat(`${code[1]}.${code[3]}`) * mul;
  }
  const m = /^(\d+(?:\.\d+)?)(ком|kohm|k|к|мом|mohm|meg|m|м|ом|ohm|r|ω)?/.exec(v);
  if (!m) return null;
  const u = m[2] ?? '';
  const mul = /^(ком|kohm|k|к)$/.test(u) ? 1e3 : /^(мом|mohm|meg|m|м)$/.test(u) ? 1e6 : 1;
  return parseFloat(m[1]) * mul;
}

/** Частота кварца по номиналу: «11,0592 МГц», «16MHz», «8M». */
export function parseHz(value: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(мгц|mhz|кгц|khz|м|m|к|k)?/i.exec(value);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  const u = (m[2] ?? '').toLowerCase();
  if (/^(кгц|khz|к|k)$/.test(u)) return v * 1e3;
  if (/^(мгц|mhz|м|m)$/.test(u) || v < 100) return v * 1e6;
  return v;
}

/** Имена выводов → выводы контроллера (включая синонимы Arduino). */
export function mcuPinOf(name: string, kind: McuKind = 'atmega328p'): McuPin | null {
  const n = name.toUpperCase().replace(/\s+/g, '');
  if (kind === 'atmega328p') {
    if (n in ARDUINO_PINS) return ARDUINO_PINS[n];
    const alias: Record<string, McuPin> = { RX: 'PD0', RX0: 'PD0', RXD: 'PD0', 'D0/RX': 'PD0', RX1: 'PD0', TX: 'PD1', TX0: 'PD1', TX1: 'PD1', TXD: 'PD1', 'D1/TX': 'PD1', SDA: 'PC4', SCL: 'PC5' };
    if (n in alias) return alias[n];
  }
  // «PB5», «PB5/MOSI», «(ADC0)PA0».
  const m = /(?:^|[^A-Z0-9])P([A-D])([0-7])(?:$|[^0-9])/.exec(n) ?? /^P([A-D])([0-7])/.exec(n);
  if (!m) return null;
  if (kind === 'atmega328p' && m[1] === 'A') return null;
  return `P${m[1]}${m[2]}` as McuPin;
}

export interface McuFound {
  comp: Component;
  fp: FootprintDef;
  pins: Map<string, McuPin>;
  kind: McuKind;
  freq: number;
  /** Откуда взята частота — для подсказки. */
  freqFrom: string;
}

const NOT_AVR = /esp|stm32|pico|rp2040|teensy|xiao|attiny|digispark|32u4|leonardo|micro\b|atmega(164|324|644|1284|2560|1280|8u2|16u2)/i;
const MEGA32 = /atmega\s*(16|32)a?(?![0-9u])/i;

/** Контроллеры, которые умеет симуляция: Arduino Uno/Nano/Pro Mini, ATmega328P, ATmega32A/16A. */
export function findMcu(p: Project): McuFound | null {
  let best: McuFound | null = null;
  for (const c of Object.values(p.components)) {
    const fp = p.footprints[c.footprint];
    if (!fp) continue;
    const text = `${fp.id} ${fp.name} ${(fp.tags ?? []).join(' ')} ${c.value}`;
    // Модули ESP32/ESP8266/STM32 не подходят, даже если выводы названы D0…D8.
    if (NOT_AVR.test(text)) continue;
    const want = p.firmware?.mcu === 'atmega32' || p.firmware?.mcu === 'atmega328p' ? (p.firmware.mcu as McuKind) : null;
    const kind: McuKind = want ?? (MEGA32.test(`${c.value} ${fp.id} ${fp.name}`) ? 'atmega32' : 'atmega328p');
    const pins = new Map<string, McuPin>();
    for (const pad of fp.pads) {
      const m = pad.name ? mcuPinOf(pad.name, kind) : null;
      if (m) pins.set(pad.number, m);
    }
    const distinct = new Set(pins.values()).size;
    if (distinct >= 8 && (!best || distinct > new Set(best.pins.values()).size)) best = { comp: c, fp, pins, kind, freq: MCU_FREQ, freqFrom: '' };
  }
  if (!best) return null;
  const f = mcuFrequency(p, best);
  best.freq = f.freq;
  best.freqFrom = f.from;
  return best;
}

function mcuFrequency(p: Project, m: McuFound): { freq: number; from: string } {
  if (p.firmware?.freq) return { freq: p.firmware.freq, from: 'задана в проекте' };
  const isArduino = /arduino|^module_/i.test(m.fp.id + ' ' + (m.fp.tags ?? []).join(' '));
  if (isArduino && m.kind === 'atmega328p') return { freq: MCU_FREQ, from: 'Arduino' };
  // Кварц между выводами XTAL1 и XTAL2.
  const xt = new Set<Id>();
  for (const pad of m.fp.pads) if (pad.name && /^(XTAL|XT)[12]$/i.test(pad.name) && m.comp.padNets[pad.number]) xt.add(m.comp.padNets[pad.number]);
  for (const c of Object.values(p.components)) {
    const fp = p.footprints[c.footprint];
    if (!fp || c.id === m.comp.id) continue;
    const isXtal = fp.category === 'Кварцы и резонаторы' || (fp.tags ?? []).some((t) => /crystal|resonator|кварц/.test(t)) || /^(Y|ZQ|BQ|XTAL)\d/i.test(c.ref);
    if (!isXtal || !Object.values(c.padNets).some((n) => xt.has(n))) continue;
    const hz = parseHz(c.value);
    if (hz && hz >= 32768 && hz <= 32e6) return { freq: hz, from: `кварц ${c.ref} ${c.value}` };
  }
  return m.kind === 'atmega328p' ? { freq: MCU_FREQ, from: 'по умолчанию' } : { freq: 8e6, from: 'по умолчанию (кварц не найден)' };
}

interface Trace {
  t: number[];
  v: Level[];
}

/** Сила источника уровня: питание > выход/устройство > аналоговый или через диод > подтяжка > ничего. */
const FLOAT = 0;
const PULL = 1;
const ANALOG = 2;
const STRONG = 3;
const POWER = 4;

interface Base {
  lvl: Level;
  str: number;
  conflict: boolean;
  derived?: boolean;
}

export class Circuit {
  readonly mcu: Avr;
  readonly mcuComp: Component;
  readonly found: McuFound;
  readonly groups: GroupInfo[] = [];
  readonly netGroup = new Map<Id, number>();
  readonly pinGroup = new Map<McuPin, number>();
  private level: Level[] = [];
  private floating: boolean[] = [];
  private conflict: boolean[] = [];
  private drivers: Map<string, Level>[] = [];
  private analog: (number | null)[] = [];
  private derived: boolean[] = [];
  /** Напряжение цепей питания (по группе). */
  private powerVolts: number[] = [];
  private listeners: ((g: number, lvl: Level, cycle: number) => void)[] = [];
  private mcuListeners: ((pin: McuPin, g: number, mode: PinMode, cycle: number) => void)[] = [];
  private powerListeners: (() => void)[] = [];
  // Связи: кнопки (замыкают две группы) и диоды.
  private switches: { a: number; b: number; closed: boolean }[] = [];
  private diodes: { a: number; k: number }[] = [];
  private linked = new Set<number>();
  private solving = false;
  private again = false;
  // Статистика кадра: время в «1», время в «0» от источника и число переключений.
  private highAcc: number[] = [];
  private lowAcc: number[] = [];
  private lastEdge: number[] = [];
  /** 1 — «1», 0 — «0» от источника, 2 — висит в воздухе. */
  private lastState: number[] = [];
  private edges: number[] = [];
  private frameStart = 0;
  private traces = new Map<number, Trace>();
  private arefGroup: number | undefined;

  constructor(
    readonly project: Project,
    mcu: Avr,
    found?: McuFound,
  ) {
    this.mcu = mcu;
    const f = found ?? findMcu(project);
    if (!f) throw new Error('На схеме нет Arduino Uno/Nano/Pro Mini, ATmega328P или ATmega32A.');
    this.found = f;
    this.mcuComp = f.comp;
    this.buildGroups(f);
    mcu.onPin((pin, mode, cycle) => {
      const g = this.pinGroup.get(pin);
      if (g === undefined) return;
      for (const l of this.mcuListeners) l(pin, g, mode, cycle);
      this.resolve(g, cycle);
    });
    for (let g = 0; g < this.groups.length; g++) this.resolve(g, 0, true);
    this.applyPowerPins();
  }

  private buildGroups(found: McuFound): void {
    const p = this.project;
    const power = new Map<Id, Power>();
    for (const n of Object.values(p.nets)) {
      if (NET_GND.test(n.name)) power.set(n.id, 'gnd');
      else if (NET_VCC.test(n.name)) power.set(n.id, 'vcc');
    }
    for (const pad of found.fp.pads) {
      const net = found.comp.padNets[pad.number];
      if (!net || !pad.name) continue;
      if (MCU_GND.test(pad.name)) power.set(net, 'gnd');
      else if (MCU_VCC.test(pad.name) && !power.has(net)) power.set(net, 'vcc');
    }
    // Объединение цепей через резисторы (кроме питания).
    const parent = new Map<Id, Id>();
    const find = (a: Id): Id => {
      let r = a;
      while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
      parent.set(a, r);
      return r;
    };
    for (const n of Object.keys(p.nets)) parent.set(n, n);
    // Дроссели и предохранители по постоянному току — перемычки: цепи сливаются, питание проходит.
    for (const c of Object.values(p.components)) {
      const fp = p.footprints[c.footprint];
      if (!fp || !isWireLike(fp)) continue;
      const nets = fp.pads.filter((x) => x.type !== 'npth').map((x) => c.padNets[x.number]);
      if (nets.length !== 2 || !nets[0] || !nets[1] || nets[0] === nets[1]) continue;
      const [a, b] = nets as [Id, Id];
      if (power.has(a) && !power.has(b)) power.set(b, power.get(a)!);
      else if (power.has(b) && !power.has(a)) power.set(a, power.get(b)!);
      parent.set(find(a), find(b));
    }
    const pulls: [Id, Id, number][] = [];
    for (const c of Object.values(p.components)) {
      const fp = p.footprints[c.footprint];
      if (!fp || !isResistor(fp)) continue;
      const nets = fp.pads.filter((x) => x.type !== 'npth').map((x) => c.padNets[x.number]);
      if (nets.length !== 2 || !nets[0] || !nets[1] || nets[0] === nets[1]) continue;
      const [a, b] = nets as [Id, Id];
      const pa = power.get(a);
      const pb = power.get(b);
      const ohms = parseOhms(c.value) ?? 10_000;
      if (pa && pb) continue;
      if (pa) pulls.push([b, a, ohms]);
      else if (pb) pulls.push([a, b, ohms]);
      else parent.set(find(a), find(b));
    }
    const rootGroup = new Map<Id, number>();
    for (const n of Object.values(p.nets)) {
      const root = find(n.id);
      let g = rootGroup.get(root);
      if (g === undefined) {
        g = this.groups.length;
        rootGroup.set(root, g);
        this.groups.push({ nets: [], name: n.name, power: power.get(n.id) ?? null, pulls: [], pins: [] });
      }
      this.groups[g].nets.push(n.id);
      this.netGroup.set(n.id, g);
      if (!this.groups[g].power && power.has(n.id)) this.groups[g].power = power.get(n.id)!;
    }
    for (const [net, pnet, ohms] of pulls) {
      const g = this.netGroup.get(net);
      if (g === undefined) continue;
      this.groups[g].pulls.push({ net: pnet, ohms });
      if (ohms <= 10) this.groups[g].stiff = true;
    }
    for (const [padNo, pin] of found.pins) {
      const net = found.comp.padNets[padNo];
      if (!net) continue;
      const g = this.netGroup.get(net)!;
      if (this.groups[g].power) continue;
      if (!this.pinGroup.has(pin)) {
        this.pinGroup.set(pin, g);
        if (!this.groups[g].pins.includes(pin)) this.groups[g].pins.push(pin);
      }
    }
    for (const g of this.groups) {
      g.nets.sort();
      // Имя группы — самая «человеческая» цепь: не автоматическая Net-(…).
      const names = g.nets.map((n) => p.nets[n].name);
      g.name = (g.power && names.find((n) => NET_VCC.test(n) || NET_GND.test(n))) || (names.find((n) => !/^Net-/.test(n)) ?? names[0]);
    }
    const n = this.groups.length;
    this.level = new Array(n).fill(0);
    this.floating = new Array(n).fill(false);
    this.conflict = new Array(n).fill(false);
    this.drivers = Array.from({ length: n }, () => new Map());
    this.analog = new Array(n).fill(null);
    this.derived = new Array(n).fill(false);
    this.powerVolts = this.groups.map((gr) => (gr.power === 'vcc' ? powerVoltsOf(gr.name) : 0));
    this.highAcc = new Array(n).fill(0);
    this.lowAcc = new Array(n).fill(0);
    this.lastEdge = new Array(n).fill(0);
    this.lastState = new Array(n).fill(2);
    this.edges = new Array(n).fill(0);
    // AREF на цепи питания: опорное напряжение АЦП задаёт она, а не встроенный источник.
    const arefPad = found.fp.pads.find((x) => x.name && /^AREF$/i.test(x.name));
    const arefNet = arefPad ? found.comp.padNets[arefPad.number] : undefined;
    this.arefGroup = arefNet ? this.netGroup.get(arefNet) : undefined;
  }

  /** Выводы контроллера на цепях питания видят их уровень и напряжение; AREF на питании — опора АЦП. */
  private applyPowerPins(): void {
    for (const [padNo, pin] of this.found.pins) {
      const net = this.found.comp.padNets[padNo];
      const g = net ? this.netGroup.get(net) : undefined;
      if (g === undefined || !this.groups[g].power) continue;
      this.mcu.setInput(pin, this.groups[g].power === 'vcc');
      this.mcu.forcePin(pin, this.groups[g].power === 'vcc');
      this.mcu.setAnalog(pin, this.powerVolts[g]);
    }
    const ag = this.arefGroup;
    this.mcu.forcedRef = ag !== undefined && this.groups[ag].power === 'vcc' ? this.powerVolts[ag] : null;
  }

  /** Группа, к которой подключён вывод компонента. */
  groupOfPad(c: Component, pad: string): number | undefined {
    const net = c.padNets[pad];
    return net ? this.netGroup.get(net) : undefined;
  }

  levelOf(g: number): Level {
    return this.level[g];
  }
  isFloating(g: number): boolean {
    return this.floating[g];
  }
  isConflict(g: number): boolean {
    return this.conflict[g];
  }

  /** Напряжение питания группы (для цепей питания). */
  powerOf(g: number): number {
    return this.powerVolts[g] ?? 0;
  }

  /** AREF контроллера соединён с питанием (опора АЦП — это напряжение). */
  get arefFromSupply(): boolean {
    return this.mcu.forcedRef !== null;
  }

  /** Меняет напряжение цепи питания (аккумулятор разряжается): делители и АЦП пересчитываются. */
  setPowerVolts(g: number | undefined, v: number): void {
    if (g === undefined || this.groups[g].power !== 'vcc') return;
    this.powerVolts[g] = v;
    this.applyPowerPins();
    for (let i = 0; i < this.groups.length; i++) if (this.groups[i].pulls.some((q) => this.netGroup.get(q.net) === g)) this.resolve(i, this.mcu.cycles);
    for (const l of this.powerListeners) l();
  }

  onPower(l: () => void): void {
    this.powerListeners.push(l);
  }

  /** Напряжение делителя из резисторов на питание (или null, если их нет). */
  pullVolts(g: number): number | null {
    const pulls = this.groups[g].pulls;
    if (!pulls.length) return null;
    let num = 0;
    let den = 0;
    for (const q of pulls) {
      const pg = this.netGroup.get(q.net);
      const v = pg === undefined ? 0 : this.groups[pg].power === 'vcc' ? this.powerVolts[pg] : 0;
      num += v / q.ohms;
      den += 1 / q.ohms;
    }
    return num / den;
  }

  /** Напряжение группы, В: питание, выход, источник или делитель. */
  voltsOf(g: number): number {
    const info = this.groups[g];
    if (info.power) return this.powerVolts[g];
    if (info.stiff) return this.analog[g] ?? this.pullVolts(g) ?? 0;
    const hi = 5;
    const pins = info.pins.map((p) => this.mcu.pinMode(p));
    if (pins.some((m) => m === 'low' || m === 'high')) return this.level[g] ? hi : 0;
    if (this.drivers[g].size) return this.level[g] ? hi : 0;
    const a = this.analog[g];
    if (a !== null) return a;
    if (this.derived[g]) return this.level[g] ? hi : 0;
    const pv = this.pullVolts(g);
    if (pv !== null) return pv;
    return this.level[g] ? hi : 0;
  }

  onChange(l: (g: number, lvl: Level, cycle: number) => void): void {
    this.listeners.push(l);
  }
  onMcuPin(l: (pin: McuPin, g: number, mode: PinMode, cycle: number) => void): void {
    this.mcuListeners.push(l);
  }

  /** Устройство задаёт уровень (null — отпускает линию). */
  drive(g: number | undefined, owner: string, lvl: Level | null): void {
    if (g === undefined || this.groups[g].power) return;
    const d = this.drivers[g];
    if (lvl === null) {
      if (!d.has(owner)) return;
      d.delete(owner);
    } else {
      if (d.get(owner) === lvl) return;
      d.set(owner, lvl);
    }
    this.resolve(g, this.mcu.cycles);
  }

  /** Аналоговый источник (потенциометр, датчик), В; null — убрать. */
  setVolts(g: number | undefined, v: number | null): void {
    if (g === undefined || this.groups[g].power) return;
    if (this.analog[g] === v) return;
    this.analog[g] = v;
    this.resolve(g, this.mcu.cycles);
  }

  /** Кнопка между двумя группами. Возвращает номер для setSwitch. */
  addSwitch(a: number, b: number): number {
    this.switches.push({ a, b, closed: false });
    for (const g of [a, b]) if (!this.groups[g].power) this.linked.add(g);
    return this.switches.length - 1;
  }

  setSwitch(i: number, closed: boolean): void {
    const s = this.switches[i];
    if (!s || s.closed === closed) return;
    s.closed = closed;
    this.solveLinks(this.mcu.cycles);
  }

  /** Диод: передаёт «0» с катода на анод и «1» с анода на катод. */
  addDiode(a: number, k: number): void {
    if (a === k) return;
    this.diodes.push({ a, k });
    for (const g of [a, k]) if (!this.groups[g].power) this.linked.add(g);
  }

  /** Уровень группы без учёта связей. */
  private base(g: number): Base {
    const info = this.groups[g];
    if (info.power) return { lvl: info.power === 'vcc' ? 1 : 0, str: POWER, conflict: false };
    const modes = info.pins.map((p) => this.mcu.pinMode(p));
    const hasHigh = modes.includes('high');
    const hasLow = modes.includes('low');
    const d = [...this.drivers[g].values()];
    if (info.stiff) {
      const v = this.analog[g] ?? this.pullVolts(g) ?? 0;
      const lvl: Level = v > 2.5 ? 1 : 0;
      return { lvl, str: POWER, conflict: (lvl === 1 && hasLow) || (lvl === 0 && hasHigh) };
    }
    if (hasHigh || hasLow) return { lvl: hasLow ? 0 : 1, str: STRONG, conflict: (hasHigh && hasLow) || (hasHigh && d.includes(0)) || (hasLow && d.includes(1)) };
    if (d.length) return { lvl: d.includes(0) ? 0 : 1, str: STRONG, conflict: false };
    if (this.analog[g] !== null) return { lvl: this.analog[g]! > 2.5 ? 1 : 0, str: ANALOG, conflict: false };
    const pv = this.pullVolts(g);
    if (pv !== null) return { lvl: pv > 2.5 ? 1 : 0, str: PULL, conflict: false };
    if (modes.includes('pullup')) return { lvl: 1, str: PULL, conflict: false };
    return { lvl: 0, str: FLOAT, conflict: false };
  }

  private resolve(g: number, cycle: number, init = false): void {
    if (!init && this.linked.has(g)) return this.solveLinks(cycle);
    const b = this.base(g);
    this.apply(g, b.lvl, b.str === FLOAT, b.conflict, false, cycle, init);
  }

  /** Группы, связанные кнопками и диодами, решаются вместе. */
  private solveLinks(cycle: number): void {
    if (this.solving) {
      this.again = true;
      return;
    }
    this.solving = true;
    let rounds = 0;
    do {
      this.again = false;
      const groups = [...this.linked];
      // Нажатые кнопки склеивают группы в узлы.
      const parent = new Map<number, number>();
      const find = (x: number): number => {
        while (parent.has(x) && parent.get(x) !== x) x = parent.get(x)!;
        return x;
      };
      for (const s of this.switches) if (s.closed && !this.groups[s.a].power && !this.groups[s.b].power && find(s.a) !== find(s.b)) parent.set(find(s.a), find(s.b));
      const node = new Map<number, Base>();
      for (const g of groups) {
        const r = find(g);
        const b = this.base(g);
        const cur = node.get(r);
        if (!cur) node.set(r, b);
        else if (b.str > cur.str) node.set(r, { ...b, conflict: cur.conflict || b.conflict });
        else if (b.str === cur.str && b.lvl !== cur.lvl) node.set(r, { lvl: 0, str: cur.str, conflict: cur.conflict || b.str === STRONG });
      }
      // Кнопка на питание: узел получает уровень питания.
      for (const s of this.switches) {
        if (!s.closed) continue;
        const pw = this.groups[s.a].power ? s.a : this.groups[s.b].power ? s.b : -1;
        if (pw < 0) continue;
        const r = find(pw === s.a ? s.b : s.a);
        const lvl: Level = this.groups[pw].power === 'vcc' ? 1 : 0;
        const cur = node.get(r);
        if (cur && (cur.str < STRONG || lvl === 0)) node.set(r, { lvl, str: STRONG, conflict: cur.str === STRONG && cur.lvl !== lvl, derived: true });
      }
      const at = (g: number): Base | undefined => (this.groups[g].power ? this.base(g) : node.get(find(g)));
      for (let i = 0; i < 8; i++) {
        let changed = false;
        for (const d of this.diodes) {
          const A = at(d.a);
          const K = at(d.k);
          if (!A || !K) continue;
          // «0» с катода тянет анод (если анод не держит выход или питание).
          if (!this.groups[d.a].power && K.lvl === 0 && K.str >= ANALOG && A.str < STRONG && !(A.lvl === 0 && A.str >= ANALOG)) {
            node.set(find(d.a), { lvl: 0, str: ANALOG, conflict: false, derived: true });
            changed = true;
          }
          // «1» с анода проходит на катод.
          if (!this.groups[d.k].power && A.lvl === 1 && A.str >= ANALOG && K.str < STRONG && !(K.lvl === 1 && K.str >= ANALOG)) {
            node.set(find(d.k), { lvl: 1, str: ANALOG, conflict: false, derived: true });
            changed = true;
          }
        }
        if (!changed) break;
      }
      for (const g of groups) {
        const n = node.get(find(g))!;
        this.apply(g, n.lvl, n.str === FLOAT, n.conflict, !!n.derived, cycle, false);
      }
    } while (this.again && ++rounds < 10);
    this.solving = false;
  }

  private apply(g: number, lvl: Level, float: boolean, conflict: boolean, derived: boolean, cycle: number, init: boolean): void {
    const info = this.groups[g];
    this.floating[g] = float;
    this.conflict[g] = conflict;
    this.derived[g] = derived;
    // Входы контроллера видят уровень и напряжение группы.
    for (const p of info.pins) {
      this.mcu.setInput(p, lvl === 1);
      if (info.stiff) this.mcu.forcePin(p, lvl === 1);
      this.mcu.setAnalog(p, this.voltsOf(g));
    }
    const state = info.power ? (info.power === 'vcc' ? 1 : 0) : lvl === 1 ? 1 : float ? 2 : 0;
    if (init) this.lastEdge[g] = cycle;
    else if (state !== this.lastState[g]) {
      const from = Math.max(this.lastEdge[g], this.frameStart);
      if (this.lastState[g] === 1) this.highAcc[g] += cycle - from;
      else if (this.lastState[g] === 0) this.lowAcc[g] += cycle - from;
      this.lastEdge[g] = cycle;
    }
    this.lastState[g] = state;
    if (!init && lvl === this.level[g]) return;
    this.level[g] = lvl;
    if (init) return;
    this.edges[g]++;
    const tr = this.traces.get(g);
    if (tr) {
      tr.t.push(cycle);
      tr.v.push(lvl);
      if (tr.t.length > 20000) {
        tr.t.splice(0, 5000);
        tr.v.splice(0, 5000);
      }
    }
    for (const l of this.listeners) l(g, lvl, cycle);
  }

  /**
   * Итоги кадра по группе: доля времени в «1» (для яркости при ШИМ), доля времени,
   * когда «0» кто-то держит (катод светодиода, подсветка через ключ), и частота переключений.
   * Вызывать раз в кадр для всех групп, потом endFrame().
   */
  frameStats(g: number): { duty: number; lowDuty: number; hz: number } {
    const now = this.mcu.cycles;
    const span = Math.max(1, now - this.frameStart);
    let high = this.highAcc[g];
    let low = this.lowAcc[g];
    const from = Math.max(this.lastEdge[g], this.frameStart);
    if (this.lastState[g] === 1) high += now - from;
    else if (this.lastState[g] === 0) low += now - from;
    return { duty: Math.min(1, high / span), lowDuty: Math.min(1, low / span), hz: (this.edges[g] / 2) * (this.mcu.freq / span) };
  }

  endFrame(): void {
    this.frameStart = this.mcu.cycles;
    this.highAcc.fill(0);
    this.lowAcc.fill(0);
    this.edges.fill(0);
  }

  /** Запись переключений группы для логического анализатора. */
  watch(g: number, on: boolean): void {
    if (on && !this.traces.has(g)) this.traces.set(g, { t: [this.mcu.cycles], v: [this.level[g]] });
    if (!on) this.traces.delete(g);
  }
  trace(g: number): Trace | undefined {
    return this.traces.get(g);
  }
}

/** Дроссель, предохранитель, перемычка: по постоянному току — провод. */
function isWireLike(fp: FootprintDef): boolean {
  const two = fp.pads.filter((x) => x.type !== 'npth').length === 2;
  return two && (fp.category === 'Индуктивности' || fp.category === 'Предохранители и защита' || /^(L|FB|F|JP)$/.test(fp.refPrefix ?? ''));
}

export function isResistor(fp: FootprintDef): boolean {
  return (fp.refPrefix === 'R' || /^R_/.test(fp.id)) && fp.pads.filter((x) => x.type !== 'npth').length === 2;
}
