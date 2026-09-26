import type { Component, FootprintDef, Id, Project } from '../model/types';
import { ARDUINO_PINS, MCU_FREQ } from './mcu';
import type { McuKind, McuPin, PinMode, SimMcu } from './types';

/*
 * Схема для симуляции на уровне логики: цепи проекта объединяются в группы (резистор
 * между двумя сигнальными цепями передаёт уровень), у каждой группы — уровень 0/1.
 * Кто задаёт уровень, по старшинству:
 *   питание → выход контроллера → устройства (кнопка, датчик, транзисторный ключ; «0»
 *   сильнее «1», как у открытого стока) → аналоговый источник → подтяжка резисторами
 *   (делитель считается по номиналам) → подтяжка в контроллере.
 * Диоды и нажатые кнопки между сигнальными цепями связывают группы: кнопка замыкает две
 * группы в одну, диод передаёт «0» от катода к аноду и «1» от анода к катоду.
 * Группа, которую никто не задаёт, «висит в воздухе» (читается как 0 и отмечается).
 * Напряжения для АЦП считаются по узлам группы (закон Кирхгофа): резисторы между её
 * цепями, подтяжки к питанию, источники напряжения и тока от датчиков.
 */

export type Level = 0 | 1;
export type Power = 'gnd' | 'vcc' | null;

export interface GroupInfo {
  nets: Id[];
  name: string;
  power: Power;
  /** Резисторы на цепи питания (для делителей): цепь питания, сопротивление, к какой цепи группы, какая деталь. */
  pulls: { net: Id; ohms: number; at?: Id; comp?: Id }[];
  /** Резисторы между цепями группы. */
  res: { a: Id; b: Id; ohms: number; comp: Id }[];
  pins: McuPin[];
  /** Цепь «жёсткая»: через шунт в несколько ом сидит на питании — выход контроллера её не пересилит. */
  stiff?: boolean;
}

/** Имена выводов контроллера, которые означают питание. */
const MCU_GND = /^(GND|GNDL|GNDR|AGND|VSS|EPAD)$/i;
const MCU_VCC = /^(5V|\+5V|VCC|VDD|AVCC|3V3|3\.3V|VIN|RAW|IOREF)$/i;
/** Цепи с такими именами — питание, даже если к контроллеру не подключены. */
const NET_GND = /^(GND|GNDA|GNDD|AGND|DGND|PGND|0V|VSS|-VO|ЗЕМЛЯ)$/i;
const NET_VCC = /^(\+?5V|\+?5VD|VCC|VDD|AVCC|\+?3V3|\+?3\.3V|VIN|VBUS|\+?12V|\+?9V|\+?24V|\+?VBAT|\+?BATT?|RAW|\+VO)$/i;
/** Встроенная подтяжка вывода, Ом. */
const PULL_INTERNAL = 45_000;

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

/** Выводы ESP32, которые есть у модулей WROOM/WROVER. */
const ESP32_GPIO = new Set([0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39]);

/** Имена выводов → выводы контроллера (включая синонимы Arduino и платок ESP32). */
export function mcuPinOf(name: string, kind: McuKind = 'atmega328p'): McuPin | null {
  const n = name.toUpperCase().replace(/\s+/g, '');
  if (kind === 'esp32') {
    const alias: Record<string, number> = { VP: 36, SVP: 36, SENSOR_VP: 36, VN: 39, SVN: 39, SENSOR_VN: 39, TX: 1, TX0: 1, TXD0: 1, TXD: 1, RX: 3, RX0: 3, RXD0: 3, RXD: 3, TX2: 17, RX2: 16 };
    const m = /^(?:GPIO|IO|D)(\d{1,2})$/.exec(n);
    const io = m ? +m[1] : alias[n];
    return io !== undefined && ESP32_GPIO.has(io) ? (`IO${io}` as McuPin) : null;
  }
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
/** Классический ESP32 (WROOM, WROVER, DevKit), не S2/S3/C3. */
const ESP32 = /esp32(?![-_ ]?(s2|s3|c2|c3|c5|c6|h2|p4|cam))|wroom-?32|wrover/i;

/** Контроллеры, которые умеет симуляция: Arduino Uno/Nano/Pro Mini, ATmega328P, ATmega32A/16A, ESP32. */
export function findMcu(p: Project): McuFound | null {
  let best: McuFound | null = null;
  for (const c of Object.values(p.components)) {
    const fp = p.footprints[c.footprint];
    if (!fp) continue;
    const text = `${fp.id} ${fp.name} ${(fp.tags ?? []).join(' ')} ${c.value}`;
    let kind: McuKind;
    if (ESP32.test(text)) kind = 'esp32';
    else if (NOT_AVR.test(text)) continue; // ESP8266, STM32…: не подходят, даже если выводы названы D0…D8
    else {
      const want = p.firmware?.mcu === 'atmega32' || p.firmware?.mcu === 'atmega328p' ? (p.firmware.mcu as McuKind) : null;
      kind = want ?? (MEGA32.test(`${c.value} ${fp.id} ${fp.name}`) ? 'atmega32' : 'atmega328p');
    }
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
  if (m.kind === 'esp32') return { freq: 240e6, from: 'ESP32' };
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

type Source = (cycle: number) => number;

export class Circuit {
  readonly mcu: SimMcu;
  readonly mcuComp: Component;
  readonly found: McuFound;
  readonly groups: GroupInfo[] = [];
  readonly netGroup = new Map<Id, number>();
  readonly pinGroup = new Map<McuPin, number>();
  /** Цепь, к которой подключён вывод контроллера. */
  readonly pinNet = new Map<McuPin, Id>();
  private level: Level[] = [];
  private floating: boolean[] = [];
  private conflict: boolean[] = [];
  private drivers: Map<string, Level>[] = [];
  private analog: (number | null)[] = [];
  private derived: boolean[] = [];
  /** Источники напряжения и тока на отдельных цепях (датчики с выходом через делитель, трансформаторы тока). */
  private netSources = new Map<Id, Source>();
  /** Токи, втекающие в цепь (несколько источников на одну цепь — по ключу). */
  private netCurrents = new Map<Id, Map<string, Source>>();
  private groupHasSources: boolean[] = [];
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
    mcu: SimMcu,
    found?: McuFound,
  ) {
    this.mcu = mcu;
    const f = found ?? findMcu(project);
    if (!f) throw new Error('На схеме нет Arduino Uno/Nano/Pro Mini, ATmega328P, ATmega32A или ESP32.');
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

  private get hi(): number {
    return this.mcu.vdd;
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
      if (power.has(a) && power.has(b)) continue;
      if (power.has(a)) power.set(b, power.get(a)!);
      else if (power.has(b)) power.set(a, power.get(b)!);
      parent.set(find(a), find(b));
    }
    const pulls: [Id, Id, number, Id][] = [];
    const res: [Id, Id, number, Id][] = [];
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
      if (pa) pulls.push([b, a, ohms, c.id]);
      else if (pb) pulls.push([a, b, ohms, c.id]);
      else {
        parent.set(find(a), find(b));
        res.push([a, b, ohms, c.id]);
      }
    }
    const rootGroup = new Map<Id, number>();
    for (const n of Object.values(p.nets)) {
      const root = find(n.id);
      let g = rootGroup.get(root);
      if (g === undefined) {
        g = this.groups.length;
        rootGroup.set(root, g);
        this.groups.push({ nets: [], name: n.name, power: power.get(n.id) ?? null, pulls: [], res: [], pins: [] });
      }
      this.groups[g].nets.push(n.id);
      this.netGroup.set(n.id, g);
      if (!this.groups[g].power && power.has(n.id)) this.groups[g].power = power.get(n.id)!;
    }
    for (const [net, pnet, ohms, comp] of pulls) {
      const g = this.netGroup.get(net);
      if (g === undefined) continue;
      this.groups[g].pulls.push({ net: pnet, ohms, at: net, comp });
      if (ohms <= 10) this.groups[g].stiff = true;
    }
    for (const [a, b, ohms, comp] of res) {
      const g = this.netGroup.get(a);
      if (g !== undefined) this.groups[g].res.push({ a, b, ohms, comp });
    }
    for (const [padNo, pin] of found.pins) {
      const net = found.comp.padNets[padNo];
      if (!net) continue;
      const g = this.netGroup.get(net)!;
      if (this.groups[g].power) continue;
      if (!this.pinGroup.has(pin)) {
        this.pinGroup.set(pin, g);
        this.pinNet.set(pin, net);
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
    this.groupHasSources = new Array(n).fill(false);
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
      const v = this.netPowerVolts(q.net);
      num += v / q.ohms;
      den += 1 / q.ohms;
    }
    return num / den;
  }

  private netPowerVolts(net: Id): number {
    const pg = this.netGroup.get(net);
    return pg === undefined ? 0 : this.groups[pg].power === 'vcc' ? this.powerVolts[pg] : 0;
  }

  /** Группу держит цифровой источник: выход контроллера, устройство или связь через кнопку/диод. */
  private digitallyDriven(g: number): boolean {
    const info = this.groups[g];
    if (info.pins.some((p) => this.mcu.pinMode(p) === 'low' || this.mcu.pinMode(p) === 'high')) return true;
    return this.drivers[g].size > 0 || this.derived[g];
  }

  /** Напряжение группы, В: питание, выход, источник или делитель (в первой её цепи с выводом контроллера). */
  voltsOf(g: number): number {
    const info = this.groups[g];
    const net = (info.pins.length ? this.pinNet.get(info.pins[0]) : undefined) ?? info.nets[0];
    return this.netVolts(net);
  }

  /** Напряжение на входе контроллера, В. */
  pinVolts(pin: McuPin): number {
    const net = this.pinNet.get(pin);
    return net ? this.netVolts(net) : 0;
  }

  /** Напряжение цепи, В: по узлам группы с учётом резисторов, подтяжек и источников. */
  netVolts(net: Id): number {
    const g = this.netGroup.get(net);
    if (g === undefined) return 0;
    const info = this.groups[g];
    if (info.power) return this.powerVolts[g];
    if (info.stiff) return this.analog[g] ?? this.pullVolts(g) ?? 0;
    if (this.digitallyDriven(g)) return this.level[g] ? this.hi : 0;
    const a = this.analog[g];
    if (a !== null) return a;
    return this.solveNode(g, net);
  }

  /**
   * Узловой метод для одной группы: G·V = I, цепи с источником напряжения закреплены.
   * Групп обычно несколько цепей — считаем каждый раз заново (источники меняются во времени).
   */
  private solveNode(g: number, net: Id): number {
    const info = this.groups[g];
    const nets = info.nets;
    const n = nets.length;
    const idx = new Map<Id, number>(nets.map((x, i) => [x, i]));
    const at = idx.get(net);
    if (at === undefined) return 0;
    const now = this.mcu.cycles;
    // Без резисторов внутри и без источников — одна точка: делитель подтяжек.
    if (!info.res.length && !this.groupHasSources[g]) {
      const pv = this.pullVolts(g);
      const pins = info.pins.map((p) => this.mcu.pinMode(p));
      if (pv === null) return pins.includes('pullup') ? this.hi : 0;
      return pv;
    }
    const G: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const I: number[] = new Array(n).fill(0);
    const fixed: (number | null)[] = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      G[i][i] += 1e-9;
      const src = this.netSources.get(nets[i]);
      if (src) fixed[i] = src(now);
      const cur = this.netCurrents.get(nets[i]);
      if (cur) for (const f of cur.values()) I[i] += f(now);
    }
    for (const r of info.res) {
      const a = idx.get(r.a);
      const b = idx.get(r.b);
      if (a === undefined || b === undefined) continue;
      const c = 1 / Math.max(1e-3, r.ohms);
      G[a][a] += c;
      G[b][b] += c;
      G[a][b] -= c;
      G[b][a] -= c;
    }
    for (const q of info.pulls) {
      const i = idx.get(q.at ?? nets[0]);
      if (i === undefined) continue;
      const c = 1 / Math.max(1e-3, q.ohms);
      G[i][i] += c;
      I[i] += c * this.netPowerVolts(q.net);
    }
    for (const pin of info.pins) {
      const m = this.mcu.pinMode(pin);
      const i = idx.get(this.pinNet.get(pin) ?? '');
      if (i === undefined || (m !== 'pullup' && m !== 'pulldown')) continue;
      G[i][i] += 1 / PULL_INTERNAL;
      if (m === 'pullup') I[i] += this.hi / PULL_INTERNAL;
    }
    for (let i = 0; i < n; i++) {
      if (fixed[i] === null) continue;
      G[i].fill(0);
      G[i][i] = 1;
      I[i] = fixed[i]!;
    }
    const v = solveLinear(G, I);
    return v[at];
  }

  /** Источник напряжения на цепи (выход датчика), В; null — убрать. */
  setNetSource(net: Id | undefined, fn: Source | null): void {
    if (!net) return;
    if (fn) this.netSources.set(net, fn);
    else this.netSources.delete(net);
    this.markSources(net);
  }

  /** Источник тока в цепь (трансформатор тока), А; null — убрать. */
  setNetCurrent(net: Id | undefined, fn: Source | null, key = ''): void {
    if (!net) return;
    let m = this.netCurrents.get(net);
    if (fn) {
      if (!m) this.netCurrents.set(net, (m = new Map()));
      m.set(key, fn);
    } else if (m) {
      m.delete(key);
      if (!m.size) this.netCurrents.delete(net);
    }
    this.markSources(net);
  }

  private markSources(net: Id): void {
    const g = this.netGroup.get(net);
    if (g === undefined) return;
    this.groupHasSources[g] = this.groups[g].nets.some((n) => this.netSources.has(n) || this.netCurrents.has(n));
    this.resolve(g, this.mcu.cycles);
  }

  /** Новое сопротивление резистора (термистор нагрелся). */
  setResistance(comp: Id, ohms: number): void {
    for (let g = 0; g < this.groups.length; g++) {
      let hit = false;
      for (const q of this.groups[g].pulls) if (q.comp === comp) (q.ohms = ohms), (hit = true);
      for (const r of this.groups[g].res) if (r.comp === comp) (r.ohms = ohms), (hit = true);
      if (hit) this.resolve(g, this.mcu.cycles);
    }
  }

  /** Подтяжка группы к цепи питания (нагрузка: зуммер к плюсу), Ом. */
  addPull(g: number | undefined, powerGroup: number | undefined, ohms: number): void {
    if (g === undefined || powerGroup === undefined || this.groups[g].power || !this.groups[powerGroup].power) return;
    this.groups[g].pulls.push({ net: this.groups[powerGroup].nets[0], ohms, at: this.groups[g].nets[0] });
    this.resolve(g, this.mcu.cycles);
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

  /** Аналоговый источник на всю группу (потенциометр, датчик), В; null — убрать. */
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
    const half = this.hi / 2;
    if (info.power) return { lvl: info.power === 'vcc' ? 1 : 0, str: POWER, conflict: false };
    const modes = info.pins.map((p) => this.mcu.pinMode(p));
    const hasHigh = modes.includes('high');
    const hasLow = modes.includes('low');
    const d = [...this.drivers[g].values()];
    if (info.stiff) {
      const v = this.analog[g] ?? this.pullVolts(g) ?? 0;
      const lvl: Level = v > half ? 1 : 0;
      return { lvl, str: POWER, conflict: (lvl === 1 && hasLow) || (lvl === 0 && hasHigh) };
    }
    if (hasHigh || hasLow) return { lvl: hasLow ? 0 : 1, str: STRONG, conflict: (hasHigh && hasLow) || (hasHigh && d.includes(0)) || (hasLow && d.includes(1)) };
    if (d.length) return { lvl: d.includes(0) ? 0 : 1, str: STRONG, conflict: false };
    if (this.analog[g] !== null) return { lvl: this.analog[g]! > half ? 1 : 0, str: ANALOG, conflict: false };
    if (this.groupHasSources[g]) return { lvl: this.solveNode(g, info.nets[0]) > half ? 1 : 0, str: ANALOG, conflict: false };
    const pv = this.pullVolts(g);
    if (pv !== null) return { lvl: pv > half ? 1 : 0, str: PULL, conflict: false };
    if (modes.includes('pullup')) return { lvl: 1, str: PULL, conflict: false };
    if (modes.includes('pulldown')) return { lvl: 0, str: PULL, conflict: false };
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
      this.mcu.setAnalog(p, this.pinVolts(p));
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

/** Гаусс с выбором ведущего элемента (матрицы — несколько строк). */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (p !== c) {
      [A[p], A[c]] = [A[c], A[p]];
      [b[p], b[c]] = [b[c], b[p]];
    }
    const d = A[c][c];
    if (Math.abs(d) < 1e-15) continue;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = Math.abs(A[r][r]) < 1e-15 ? 0 : s / A[r][r];
  }
  return x;
}

/** Дроссель, предохранитель, перемычка: по постоянному току — провод. Варистор и супрессор — нет. */
function isWireLike(fp: FootprintDef): boolean {
  const two = fp.pads.filter((x) => x.type !== 'npth').length === 2;
  if (!two) return false;
  const pre = (fp.refPrefix ?? '').toUpperCase();
  if (/^(RV|RU|VR|TVS|GDT|FV)$/.test(pre) || /varistor|варистор|tvs|gdt|разрядник/i.test(`${fp.id} ${fp.name} ${(fp.tags ?? []).join(' ')}`)) return false;
  return fp.category === 'Индуктивности' || /^(L|FB|F|FU|JP)$/.test(pre) || (fp.category === 'Предохранители и защита' && /fuse|предохран|ptc/i.test(`${fp.id} ${fp.name}`));
}

export function isResistor(fp: FootprintDef): boolean {
  return (fp.refPrefix === 'R' || /^R_/.test(fp.id)) && fp.pads.filter((x) => x.type !== 'npth').length === 2;
}
