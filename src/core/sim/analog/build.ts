import type { Component, FootprintDef, Id, Project } from '../../model/types';
import { isResistor, isWireLike, parseOhms, type Circuit } from '../circuit';
import { transistorType } from '../devices';
import type { McuPin } from '../types';
import { COIL_TARGETS, DdCoil } from './coil';
import { Bjt, build555, buildMosfet, buildMotor, buildOpAmp, Diode, McuPinEl, OpAmp, Regulator, Tl431, type DcMotor, type DiodeModel, type MotorModel } from './elements';
import { Capacitor, CoupledCoils, Engine, GND, Inductor, Resistor, Switch, VSource, type AnalogElement, type AnalogParam, type Node } from './engine';
import { BJTS, DIODES, ledModel, MOSFETS, OPAMP_DEFAULT, OPAMPS, parseFarads, parseHenry, parseVolts, regulatorModel } from './parts';

/*
 * Аналоговая схема проекта для симуляции «как в EveryCircuit»: каждая цепь — узел, детали —
 * модели движка (engine.ts, elements.ts). Контроллер остаётся в логической схеме (Circuit):
 * его выводы здесь — источники с сопротивлением, режим берётся из прошивки. Движок идёт
 * вслед за контроллером: перед каждым событием (фронт вывода, чтение АЦП, нажатие) он
 * досчитывается до текущего такта. Напряжения цепей для АЦП и датчиков берутся отсюда.
 *
 * Номиналы можно крутить на ходу (params/set): модель меняется, разложения матрицы
 * пересчитываются. «В проект» — вернуть номинал в деталь.
 */

export interface AnalogReading {
  label: string;
  value: number;
  unit: string;
}

export interface AnalogPart {
  comp: Component;
  /** Что это за модель: «резистор», «ОУ MCP601»… */
  kind: string;
  params: AnalogParam[];
  elements: AnalogElement[];
  set(key: string, value: number): void;
  readings(): AnalogReading[];
  /** Номинал для записи в проект (по параметру nominal). */
  nominal?(): string;
  actions?: { key: string; label: string }[];
  act?(key: string): void;
  /** Полоска 0…1 (близость цели). */
  level?(): number;
}

/** Канал осциллографа: напряжение цепи или ток через вывод детали. */
export type ScopeProbe = { net: Id } | { comp: Id; pad: string };

const up = (s: string) => s.toUpperCase().replace(/\s+/g, '');

const PREFIX: [number, string][] = [
  [1e6, 'М'],
  [1e3, 'к'],
  [1, ''],
  [1e-3, 'м'],
  [1e-6, 'мк'],
  [1e-9, 'н'],
  [1e-12, 'п'],
];

/** 4700, 'Ом' → «4,7 кОм». */
export function fmtSi(v: number, unit: string, digits = 3): string {
  if (!isFinite(v)) return '—';
  if (v === 0) return `0 ${unit}`;
  const a = Math.abs(v);
  const [mul, pre] = PREFIX.find(([m]) => a >= m * 0.9995) ?? PREFIX[PREFIX.length - 1];
  const x = v / mul;
  const s = Number(x.toPrecision(digits)).toLocaleString('ru', { maximumFractionDigits: 3 });
  return `${s} ${pre}${unit}`;
}

const param = (key: string, label: string, value: number, unit: string, min: number, max: number, extra: Partial<AnalogParam> = {}): AnalogParam => ({ key, label, value, unit, min, max, ...extra });

/** Параметр номинала: пределы — в 10 раз в обе стороны, шкала логарифмическая. */
const nominal = (key: string, label: string, value: number, unit: string): AnalogParam => param(key, label, value, unit, value / 10, value * 10, { log: true, nominal: true });

function padsByName(fp: FootprintDef): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const q of fp.pads) {
    if (q.type === 'npth') continue;
    const k = up(q.name ?? q.number);
    const list = m.get(k) ?? [];
    list.push(q.number);
    m.set(k, list);
  }
  return m;
}

const DEFAULT_MOTOR: MotorModel = { r: 2, l: 1e-3, k: 0.01, j: 2e-6, b: 1e-6, load: 0 };

export class AnalogSim {
  readonly engine = new Engine();
  readonly nodeOf = new Map<Id, Node>();
  readonly netOfNode: (Id | null)[] = [];
  readonly parts: AnalogPart[] = [];
  readonly partOf = new Map<Id, AnalogPart>();
  /** Детали, для которых модели нет (не влияют на аналоговую часть). */
  readonly skipped: string[] = [];
  readonly coil: DdCoil | null = null;
  private pins = new Map<McuPin, McuPinEl>();
  private switches = new Map<string, Switch[]>();
  private supplies: { src: VSource; g: number }[] = [];
  private battery: { src: VSource; g: number }[] = [];
  /** Цепи с выводом контроллера, которые задают активные выходы (ОУ, 555): уровень — в логику. */
  private feeds: { g: number; node: Node; lvl: 0 | 1 }[] = [];
  private nextCoilUpdate = 0;
  /** Время движка отстаёт от контроллера не больше чем на это (с). */
  private readonly freq: number;
  private scopeRing: Float32Array[] = [];
  private scopeFns: ((x: Float64Array) => number)[] = [];
  private scopePos = 0;
  private scopeCount = 0;
  private scopeEvery = 1;
  private scopeTick = 0;
  /** Время последнего отсчёта осциллографа, с. */
  scopeT = 0;
  scopeLen = 4000;

  constructor(
    readonly project: Project,
    readonly circuit: Circuit,
    opts: { dt?: number } = {},
  ) {
    const c = circuit;
    this.freq = c.mcu.freq;
    this.engine.dt = opts.dt ?? 1e-6;
    this.build();
    // Питание, которое ничем не задано (нет стабилизатора и аккумулятора) — источник по имени цепи.
    const sourced = new Set<Node>();
    for (const e of this.engine.elements) {
      if (e instanceof VSource) sourced.add(e.p);
      if (e instanceof Regulator) sourced.add(e.out);
    }
    c.groups.forEach((gr, g) => {
      if (gr.power !== 'vcc') return;
      const nodes = gr.nets.map((n) => this.nodeOf.get(n)).filter((x): x is Node => x !== undefined && x >= 0);
      if (!nodes.length || nodes.some((n) => sourced.has(n))) return;
      for (const n of nodes) this.supplies.push({ src: this.engine.add(new VSource(`питание ${gr.name}`, n, GND, c.powerOf(g), 0.02)), g });
    });
    c.onPower(() => {
      this.sync();
      for (const s of [...this.supplies, ...this.battery]) s.src.volts = c.powerOf(s.g);
    });
    // Выводы контроллера меняют режим — движок досчитывает до фронта.
    c.onMcuPin((pin, _g, mode) => {
      const el = this.pins.get(pin);
      if (!el) return;
      this.sync();
      if (el.mode !== mode) {
        el.mode = mode;
        this.engine.kick();
      }
    });
    this.quiet();
    this.settle();
    // Выходы ОУ и таймеров на входах контроллера: опрос раз в 20 мкс.
    if (this.feeds.length) {
      const every = Math.max(1, Math.round(this.freq * 20e-6));
      const tick = () => {
        this.sync();
        c.mcu.schedule(tick, every);
      };
      c.mcu.schedule(tick, every);
    }
  }

  /** Узел цепи (земля — −1); цепь без узла создаётся. */
  private node(net: Id | undefined, label: string): Node {
    if (!net) {
      const n = this.engine.node(`${label} (не подключён)`);
      this.netOfNode[n] = null;
      return n;
    }
    const have = this.nodeOf.get(net);
    if (have !== undefined) return have;
    const g = this.circuit.netGroup.get(net);
    if (g !== undefined && this.circuit.groups[g].power === 'gnd') {
      this.nodeOf.set(net, GND);
      return GND;
    }
    const n = this.engine.node(this.project.nets[net]?.name ?? net);
    this.nodeOf.set(net, n);
    this.netOfNode[n] = net;
    return n;
  }

  private build(): void {
    const p = this.project;
    const c = this.circuit;
    const e = this.engine;
    const mcu = c.found;
    // Контроллер: выводы и потребление.
    const mcuPads = padsByName(mcu.fp);
    const vccPad = ['VCC', 'VDD', '5V', '3V3', '+5V', '3.3V'].map((k) => mcuPads.get(k)?.[0]).find((x) => x && mcu.comp.padNets[x]);
    const gndPad = ['GND', 'VSS'].map((k) => mcuPads.get(k)?.[0]).find((x) => x && mcu.comp.padNets[x]);
    const vccNode = vccPad ? this.node(mcu.comp.padNets[vccPad], 'VCC') : null;
    const mcuEls: AnalogElement[] = [];
    if (vccNode !== null && vccNode >= 0 && gndPad) {
      const vdd = c.mcu.vdd;
      mcuEls.push(e.add(new Resistor(`${mcu.comp.ref} потребление`, vccNode, this.node(mcu.comp.padNets[gndPad], 'GND'), vdd / 0.012, mcu.comp.id, [vccPad!, gndPad], false)));
    }
    this.addPart({ comp: mcu.comp, kind: `контроллер ${c.mcu.title}`, params: [], elements: mcuEls, set: () => {}, readings: () => [] });

    for (const comp of Object.values(p.components)) {
      if (comp.id === mcu.comp.id) continue;
      const fp = p.footprints[comp.footprint];
      if (!fp) continue;
      try {
        if (!this.buildPart(comp, fp)) this.skipped.push(comp.ref);
      } catch {
        this.skipped.push(comp.ref);
      }
    }
    // Выводы контроллера — только те, к чьим цепям подключено что-то аналоговое
    // (цепи ЖК и SPI без нагрузки лишь добавили бы узлы и состояния).
    for (const [padNo, pin] of mcu.pins) {
      const net = mcu.comp.padNets[padNo];
      if (!net || this.pins.has(pin)) continue;
      const g = c.netGroup.get(net);
      if (g === undefined || c.groups[g].power || !this.nodeOf.has(net)) continue;
      const el = e.add(new McuPinEl(`${mcu.comp.ref} ${pin}`, this.node(net, pin), vccNode !== null ? { node: vccNode } : c.mcu.vdd, 25, mcu.comp.id, padNo));
      el.mode = c.mcu.pinMode(pin);
      this.pins.set(pin, el);
      mcuEls.push(el);
    }

  }

  private addPart(part: AnalogPart): void {
    this.parts.push(part);
    this.partOf.set(part.comp.id, part);
  }

  /** Деталь → модель. false — модели нет. */
  private buildPart(comp: Component, fp: FootprintDef): boolean {
    const e = this.engine;
    const c = this.circuit;
    const tags = fp.tags ?? [];
    const pads = padsByName(fp);
    const text = `${tags.join(' ')} ${fp.id} ${fp.name} ${comp.value} ${comp.description ?? ''}`;
    const padNo = (...names: string[]) => names.map((n) => pads.get(up(n))?.[0]).find((x) => x !== undefined);
    const netOf = (...names: string[]) => {
      const q = padNo(...names);
      return q ? comp.padNets[q] : undefined;
    };
    const n = (...names: string[]) => this.node(netOf(...names), `${comp.ref}.${names[0]}`);
    const two = fp.pads.filter((q) => q.type !== 'npth');
    const ref = comp.ref;
    const inv = () => e.invalidate();
    const sync = () => this.sync();

    if (tags.includes('crystal') || fp.category === 'Кварцы и резонаторы' || tags.includes('hole') || fp.category === 'Крепёж') return false;

    // --- катушка металлоискателя ---
    if (tags.includes('dd-coil')) {
      const tx: [Node, Node] = [n('TX1'), n('TX2')];
      const rx: [Node, Node] = [n('RX1'), n('RX2')];
      const coil = new DdCoil(e, ref, tx, rx, { ltx: 0.8e-3, rtx: 1.5, lrx: 11.4e-3, rrx: 20, balance: 7 }, comp.id, { tx: [padNo('TX1')!, padNo('TX2')!], rx: [padNo('RX1')!, padNo('RX2')!] });
      (this as { coil: DdCoil | null }).coil = coil;
      const params = [
        param('target', 'цель', 0, '', 0, COIL_TARGETS.length - 1, { options: COIL_TARGETS.map((t) => t.name) }),
        param('depth', 'глубина', 10, 'см', 1, 40),
        param('over', 'катушка', 0, '', 0, 1, { options: ['в стороне', 'над целью'] }),
        param('balance', 'сведение (связь TX→RX)', coil.o.balance, 'ppm', -60, 60),
        param('ltx', 'L передающей', coil.o.ltx * 1e3, 'мГн', 0.2, 3, { log: true }),
        param('rtx', 'R провода TX', coil.o.rtx, 'Ом', 0.1, 10, { log: true }),
        param('lrx', 'L приёмной', coil.o.lrx * 1e3, 'мГн', 2, 50, { log: true }),
        param('rrx', 'R провода RX', coil.o.rrx, 'Ом', 1, 100, { log: true }),
      ];
      const txAmp = this.amplitude(() => coil.txCurrent);
      const txHz = this.frequency(() => coil.txCurrent);
      this.addPart({
        comp,
        kind: 'катушка DD',
        params,
        elements: [coil.coils, coil.rtx, coil.rrx, coil.rt],
        set: (k, v) => {
          sync();
          const q = params.find((x) => x.key === k);
          if (q) q.value = v;
          if (k === 'target') coil.target = Math.round(v);
          else if (k === 'depth') coil.depth = v;
          else if (k === 'over') coil.over = v >= 0.5;
          else if (k === 'balance') coil.o.balance = v;
          else if (k === 'ltx') coil.o.ltx = v * 1e-3;
          else if (k === 'rtx') coil.o.rtx = v;
          else if (k === 'lrx') coil.o.lrx = v * 1e-3;
          else if (k === 'rrx') coil.o.rrx = v;
          coil.update(e.t, true);
        },
        readings: () => [
          { label: 'ток TX (амплитуда)', value: txAmp(), unit: 'А' },
          { label: 'резонанс TX c ёмкостью', value: this.txResonance(), unit: 'Гц' },
          { label: 'частота TX', value: txHz(), unit: 'Гц' },
        ],
        actions: [{ key: 'sweep', label: 'Провести над целью' }],
        act: (k) => {
          if (k !== 'sweep') return;
          sync();
          coil.sweepStart = e.t;
        },
        level: () => coil.near(e.t),
      });
      return true;
    }

    // --- резистор ---
    if (isResistor(fp)) {
      const ohms = parseOhms(comp.value) ?? 1000;
      const [a, b] = two;
      const r = e.add(new Resistor(ref, this.node(comp.padNets[a.number], `${ref}.1`), this.node(comp.padNets[b.number], `${ref}.2`), ohms, comp.id, [a.number, b.number]));
      const params = [nominal('r', 'сопротивление', ohms, 'Ом')];
      this.addPart({
        comp,
        kind: 'резистор',
        params,
        elements: [r],
        set: (_k, v) => {
          sync();
          params[0].value = v;
          r.ohms = v;
          inv();
        },
        readings: () => {
          const i = r.currents(e.x)[0];
          const u = e.volts(r.a) - e.volts(r.b);
          return [
            { label: 'напряжение', value: u, unit: 'В' },
            { label: 'ток', value: i, unit: 'А' },
            { label: 'мощность', value: u * i, unit: 'Вт' },
          ];
        },
        nominal: () => fmtSi(r.ohms, 'Ом'),
      });
      return true;
    }

    // --- потенциометр ---
    if (/^Potentiometer_|^Module_Potentiometer$/.test(fp.id) || /potentiometer|потенциометр|trimmer|подстроеч/i.test(text)) {
      const w = netOf('W', '2', 'OUT');
      const aNet = netOf('1', 'CCW', 'GND');
      const bNet = netOf('3', 'CW', 'VCC');
      if (!w || !aNet || !bNet) return false;
      const total = parseOhms(comp.value) ?? 10_000;
      const wn = this.node(w, `${ref}.W`);
      const r1 = e.add(new Resistor(`${ref} нижнее плечо`, this.node(aNet, `${ref}.1`), wn, total / 2, comp.id, [padNo('1', 'CCW', 'GND')!, padNo('W', '2', 'OUT')!]));
      const r2 = e.add(new Resistor(`${ref} верхнее плечо`, wn, this.node(bNet, `${ref}.3`), total / 2, comp.id, [padNo('W', '2', 'OUT')!, padNo('3', 'CW', 'VCC')!]));
      const params = [param('pos', 'положение', 50, '%', 0, 100), nominal('r', 'сопротивление', total, 'Ом')];
      const apply = () => {
        const x = params[0].value / 100;
        r1.ohms = Math.max(1, params[1].value * x);
        r2.ohms = Math.max(1, params[1].value * (1 - x));
        inv();
      };
      this.addPart({
        comp,
        kind: 'потенциометр',
        params,
        elements: [r1, r2],
        set: (k, v) => {
          sync();
          params[k === 'pos' ? 0 : 1].value = v;
          apply();
        },
        readings: () => [{ label: 'на движке', value: e.volts(wn), unit: 'В' }],
        nominal: () => fmtSi(params[1].value, 'Ом'),
      });
      return true;
    }

    // --- конденсатор ---
    if ((fp.category === 'Конденсаторы' || tags.includes('capacitor')) && two.length === 2) {
      const f = parseFarads(comp.value) ?? 100e-9;
      const plus = padNo('+') ?? two[0].number;
      const minus = two.find((q) => q.number !== plus)!.number;
      const cap = e.add(new Capacitor(ref, this.node(comp.padNets[plus], `${ref}.+`), this.node(comp.padNets[minus], `${ref}.-`), f, comp.id, [plus, minus]));
      const params = [nominal('c', 'ёмкость', f, 'Ф')];
      const vmax = parseVolts(comp.value.split(/[×x]/)[1] ?? '') ?? null;
      const polar = tags.includes('polar') || tags.includes('cp');
      this.addPart({
        comp,
        kind: polar ? 'электролит' : 'конденсатор',
        params,
        elements: [cap],
        set: (_k, v) => {
          sync();
          params[0].value = v;
          cap.farads = v;
          inv();
        },
        readings: () => {
          const u = e.volts(cap.a) - e.volts(cap.b);
          const r: AnalogReading[] = [
            { label: 'напряжение', value: u, unit: 'В' },
            { label: 'ток', value: cap.i, unit: 'А' },
          ];
          if (vmax) r.push({ label: 'запас по напряжению', value: vmax - Math.abs(u), unit: 'В' });
          if (polar && u < -0.3) r.push({ label: 'ОБРАТНАЯ ПОЛЯРНОСТЬ', value: u, unit: 'В' });
          return r;
        },
        nominal: () => fmtSi(cap.farads, 'Ф'),
      });
      return true;
    }

    // --- дроссель, предохранитель, перемычка ---
    if (isWireLike(fp) && two.length === 2) {
      const [a, b] = two;
      const na = this.node(comp.padNets[a.number], `${ref}.1`);
      const nb = this.node(comp.padNets[b.number], `${ref}.2`);
      const henry = fp.category === 'Индуктивности' ? (parseHenry(comp.value) ?? 10e-6) : 0;
      if (!henry) {
        const r = e.add(new Resistor(ref, na, nb, 0.02, comp.id, [a.number, b.number], false));
        this.addPart({ comp, kind: 'перемычка', params: [], elements: [r], set: () => {}, readings: () => [{ label: 'ток', value: r.currents(e.x)[0], unit: 'А' }] });
        return true;
      }
      const mid = e.node(`${ref}:L`);
      const dcr = Math.max(0.02, henry * 1000);
      const r = e.add(new Resistor(`${ref} провод`, na, mid, dcr, comp.id, [a.number, ''], false));
      const l = e.add(new Inductor(ref, mid, nb, henry, comp.id, ['', b.number]));
      const params = [nominal('l', 'индуктивность', henry, 'Гн'), param('dcr', 'сопротивление провода', dcr, 'Ом', 0.001, 100, { log: true })];
      this.addPart({
        comp,
        kind: 'дроссель',
        params,
        elements: [r, l],
        set: (k, v) => {
          sync();
          if (k === 'l') (params[0].value = v), (l.henry = v);
          else (params[1].value = v), (r.ohms = v);
          inv();
        },
        readings: () => [{ label: 'ток', value: l.i, unit: 'А' }],
        nominal: () => fmtSi(l.henry, 'Гн'),
      });
      return true;
    }

    // --- светодиод, диод, стабилитрон ---
    if ((fp.category === 'Светодиоды' || fp.category === 'Диоды' || tags.includes('diode') || tags.includes('led')) && pads.has('A') && pads.has('K')) {
      const led = fp.category === 'Светодиоды' || tags.includes('led');
      let m: DiodeModel;
      if (led) m = ledModel(text);
      else {
        const zener = /zener|стабилитрон|BZX|BZV|1N47\d\d|KC\d/i.test(text);
        m = { ...(DIODES.find(([re]) => re.test(text))?.[1] ?? { vf: 0.7, rd: 0.1 }) };
        if (zener) {
          m.vz = parseVolts(comp.value) ?? 5.1;
          m.rz = 5;
        }
      }
      const d = e.add(new Diode(ref, n('A'), n('K'), m, comp.id, [padNo('A')!, padNo('K')!]));
      const params = led ? [param('vf', 'прямое напряжение', m.vf, 'В', 1.2, 3.6)] : [param('vf', 'прямое напряжение', m.vf, 'В', 0.2, 1.2)];
      this.addPart({
        comp,
        kind: led ? 'светодиод' : m.vz ? 'стабилитрон' : 'диод',
        params,
        elements: [d],
        set: (_k, v) => {
          sync();
          params[0].value = v;
          d.m.vf = v;
          inv();
        },
        readings: () => {
          const i = d.current(e.x);
          const r: AnalogReading[] = [
            { label: 'ток', value: i, unit: 'А' },
            { label: 'напряжение', value: e.volts(d.a) - e.volts(d.k), unit: 'В' },
          ];
          if (led) r.push({ label: 'яркость', value: Math.max(0, Math.min(1, i / 0.02)) * 100, unit: '%' });
          return r;
        },
      });
      return true;
    }

    // --- транзисторы ---
    const pol = transistorType(fp, comp);
    if (pol) {
      if (pol === 'nmos' || pol === 'pmos') {
        const m = { ...(MOSFETS.find(([re]) => re.test(comp.value))?.[1] ?? { type: pol === 'nmos' ? ('n' as const) : ('p' as const), vth: 2.5, ron: 0.1, cgs: 1e-9 }) };
        m.type = pol === 'nmos' ? 'n' : 'p';
        const ch = buildMosfet(e, ref, n('D'), n('G'), n('S'), m, comp.id, [padNo('D')!, padNo('G')!, padNo('S')!]);
        const params = [param('vth', 'порог', m.vth, 'В', 0.5, 6), param('ron', 'сопротивление открытого', m.ron, 'Ом', 0.001, 20, { log: true })];
        this.addPart({
          comp,
          kind: pol === 'nmos' ? 'MOSFET N' : 'MOSFET P',
          params,
          elements: e.elements.slice(-3),
          set: (k, v) => {
            sync();
            if (k === 'vth') (params[0].value = v), (ch.m.vth = v);
            else (params[1].value = v), (ch.m.ron = v);
            inv();
          },
          readings: () => {
            const i = ch.currents(e.x)[0];
            const vds = e.volts(ch.d) - e.volts(ch.s);
            return [
              { label: 'открыт', value: ch.on ? 1 : 0, unit: '' },
              { label: 'затвор—исток', value: e.volts(ch.g) - e.volts(ch.s), unit: 'В' },
              { label: 'ток стока', value: i, unit: 'А' },
              { label: 'мощность', value: vds * i, unit: 'Вт' },
            ];
          },
        });
      } else {
        const m = { ...(BJTS.find(([re]) => re.test(comp.value))?.[1] ?? { type: pol, beta: 150, vbe: 0.65, rbe: 50, vcesat: 0.15, rsat: 1 }) };
        m.type = pol;
        const q = e.add(new Bjt(ref, n('C'), n('B'), n('E'), m, comp.id, [padNo('C')!, padNo('B')!, padNo('E')!]));
        const params = [param('beta', 'усиление β', m.beta, '', 10, 1000, { log: true })];
        this.addPart({
          comp,
          kind: pol === 'npn' ? 'транзистор n-p-n' : 'транзистор p-n-p',
          params,
          elements: [q],
          set: (_k, v) => {
            sync();
            params[0].value = v;
            q.m.beta = v;
            inv();
          },
          readings: () => {
            const [ic, ib] = q.currents(e.x);
            return [
              { label: 'режим', value: q.st, unit: ['отсечка', 'усиление', 'насыщение'][q.st] },
              { label: 'ток базы', value: ib, unit: 'А' },
              { label: 'ток коллектора', value: ic, unit: 'А' },
              { label: 'коллектор—эмиттер', value: e.volts(q.c) - e.volts(q.e), unit: 'В' },
            ];
          },
        });
      }
      return true;
    }

    // --- TL431 ---
    if (tags.includes('tl431') || /TL431|AZ431|KA431|LM431/i.test(comp.value)) {
      const t = e.add(new Tl431(ref, n('K'), n('A'), n('REF', 'R'), 2.495, 5, comp.id, [padNo('K')!, padNo('A')!, padNo('REF', 'R')!]));
      this.addPart({ comp, kind: 'источник опорного TL431', params: [], elements: [t], set: () => {}, readings: () => [{ label: 'ток катода', value: t.currents(e.x)[0], unit: 'А' }, { label: 'катод', value: e.volts(t.k) - e.volts(t.a), unit: 'В' }] });
      return true;
    }

    // --- стабилизатор ---
    const reg = tags.includes('regulator') || /regulator|стабилизатор/i.test(text) ? regulatorModel(comp.value) : null;
    if (reg && padNo('IN', 'VI', 'VIN') && padNo('OUT', 'VO', 'VOUT')) {
      const r = e.add(new Regulator(ref, n('IN', 'VI', 'VIN'), n('GND', 'ADJ', 'COM'), n('OUT', 'VO', 'VOUT'), reg, comp.id, [padNo('IN', 'VI', 'VIN')!, padNo('GND', 'ADJ', 'COM')!, padNo('OUT', 'VO', 'VOUT')!]));
      const params = [param('vout', 'выход', reg.vout, 'В', 1.2, 24), param('vdrop', 'минимальный перепад', reg.vdrop, 'В', 0.05, 3)];
      this.addPart({
        comp,
        kind: 'стабилизатор',
        params,
        elements: [r],
        set: (k, v) => {
          sync();
          if (k === 'vout') (params[0].value = v), (r.m.vout = v);
          else (params[1].value = v), (r.m.vdrop = v);
          inv();
        },
        readings: () => {
          const i = r.load(e.x);
          const pin = e.volts(r.vin) - e.volts(r.gnd);
          const pout = e.volts(r.out) - e.volts(r.gnd);
          return [
            { label: 'режим', value: r.st, unit: ['стабилизирует', 'не хватает входа', 'выключен'][r.st] },
            { label: 'вход', value: pin, unit: 'В' },
            { label: 'выход', value: pout, unit: 'В' },
            { label: 'ток нагрузки', value: i, unit: 'А' },
            { label: 'нагрев', value: (pin - pout) * i, unit: 'Вт' },
          ];
        },
      });
      return true;
    }

    // --- таймер 555 ---
    if (/(^|[^0-9])(NE|LM|SE|NA|TLC|ICM|LMC)?7?555/i.test(comp.value) && pads.has('THR') && pads.has('TRIG')) {
      const cmos = /7555|TLC555|LMC555|ICM/i.test(comp.value);
      const names = { vcc: 'VCC', gnd: 'GND', trig: 'TRIG', thr: 'THR', ctrl: 'CTRL', reset: 'RST', out: 'OUT', dis: 'DIS' } as const;
      const nn = Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v === 'RST' ? n('RST', 'RESET', 'R') : v === 'CTRL' ? n('CTRL', 'CV') : n(v)])) as Record<keyof typeof names, Node>;
      const padMap = Object.fromEntries(Object.entries(names).map(([k, v]) => [k, padNo(v, v === 'RST' ? 'RESET' : v, v === 'CTRL' ? 'CV' : v) ?? ''])) as Record<string, string>;
      const t = build555(e, ref, nn, cmos, comp.id, padMap);
      this.feed(nn.out);
      this.addPart({
        comp,
        kind: cmos ? 'таймер 555 (КМОП)' : 'таймер 555',
        params: [],
        elements: e.elements.slice(-4),
        set: () => {},
        readings: () => [
          { label: 'выход', value: e.volts(nn.out), unit: 'В' },
          { label: 'порог THR', value: e.volts(nn.thr), unit: 'В' },
          { label: 'триггер', value: t.q ? 1 : 0, unit: t.q ? 'установлен' : 'сброшен' },
        ],
      });
      return true;
    }

    // --- ОУ и компараторы ---
    const opm = OPAMPS.find(([re]) => re.test(comp.value))?.[1] ?? (tags.includes('opamp') || /op-?amp|операцион|компаратор|comparator/i.test(text) ? OPAMP_DEFAULT : null);
    if (opm) {
      const vp = n('VCC', 'VDD', 'V+', 'VS+', 'VCC+');
      const vn = n('GND', 'VSS', 'V-', 'VS-', 'VEE', 'VCC-');
      const units: { ip: string; in: string; out: string }[] = [];
      if (pads.has('IN+') && pads.has('OUT')) units.push({ ip: 'IN+', in: 'IN-', out: 'OUT' });
      for (let k = 1; k <= 4; k++) if (pads.has(`IN${k}+`) && pads.has(`OUT${k}`)) units.push({ ip: `IN${k}+`, in: `IN${k}-`, out: `OUT${k}` });
      if (!units.length) return false;
      const ops: OpAmp[] = [];
      const els: AnalogElement[] = [];
      for (const u of units) {
        const op = buildOpAmp(e, units.length > 1 ? `${ref} ${u.out}` : ref, n(u.ip), n(u.in), n(u.out), vp, vn, { ...opm }, comp.id, [padNo(u.ip)!, padNo(u.in)!, padNo(u.out)!, padNo('VCC', 'VDD', 'V+', 'VS+', 'VCC+') ?? '', padNo('GND', 'VSS', 'V-', 'VS-', 'VEE', 'VCC-') ?? '']);
        ops.push(op);
        els.push(op, e.elements[e.elements.length - 1]);
        this.feed(op.out);
      }
      const params = [param('gbw', 'полоса (GBW)', opm.gbw, 'Гц', 1e4, 1e8, { log: true }), param('en', 'шум на входе', opm.en * 1e9, 'нВ/√Гц', 0, 100)];
      const polesOf = els.filter((x): x is Capacitor => x instanceof Capacitor);
      this.addPart({
        comp,
        kind: opm.openCollector ? 'компаратор' : 'операционный усилитель',
        params,
        elements: els,
        set: (k, v) => {
          sync();
          if (k === 'gbw') {
            params[0].value = v;
            for (const op of ops) op.m.gbw = v;
            for (const pc of polesOf) pc.farads = 1e-3 / (2 * Math.PI * v);
          } else {
            params[1].value = v;
            for (const op of ops) op.m.en = v * 1e-9;
          }
          inv();
        },
        readings: () =>
          ops.flatMap((op, i) => [
            { label: `${units.length > 1 ? units[i].out + ' ' : ''}выход`, value: e.volts(op.out), unit: 'В' },
            { label: `${units.length > 1 ? units[i].out + ' ' : ''}вход +/−`, value: e.volts(op.inP) - e.volts(op.inN), unit: 'В' },
            { label: `${units.length > 1 ? units[i].out + ' ' : ''}упор`, value: op.st, unit: ['нет', 'в плюс', 'в минус'][op.st] },
          ]),
      });
      return true;
    }

    // --- аккумулятор, батарея ---
    if (tags.includes('battery') || /^(GB|BAT|BT)\d/i.test(ref)) {
      const plusNet = netOf('+', 'BAT+', '1');
      if (!plusNet) return false;
      const g = c.netGroup.get(plusNet);
      const volts = (g !== undefined ? c.powerOf(g) : 0) || parseVolts(comp.value) || 12;
      const src = e.add(new VSource(ref, this.node(plusNet, `${ref}.+`), n('-', '−', 'BAT-', '2'), volts, 0.08, comp.id, [padNo('+', 'BAT+', '1')!, padNo('-', '−', 'BAT-', '2') ?? '']));
      if (g !== undefined) this.battery.push({ src, g });
      this.addPart({
        comp,
        kind: 'аккумулятор',
        params: [param('rint', 'внутреннее сопротивление', 0.08, 'Ом', 0.005, 5, { log: true })],
        elements: [src],
        set: (_k, v) => {
          sync();
          src.ohms = v;
          inv();
        },
        readings: () => [
          { label: 'напряжение', value: e.volts(src.p) - e.volts(src.n), unit: 'В' },
          { label: 'ток', value: -src.currents(e.x)[0], unit: 'А' },
        ],
      });
      return true;
    }

    // --- динамик, зуммер ---
    if ((tags.includes('speaker') || /^Speaker_|^Buzzer_/.test(fp.id)) && two.length === 2) {
      const ohms = parseOhms(comp.value.replace(/.*?(\d+(?:[.,]\d+)?\s*Ом).*/i, '$1')) ?? (/Buzzer/.test(fp.id) ? 40 : 8);
      const [a, b] = two;
      const mid = e.node(`${ref}:звуковая катушка`);
      const r = e.add(new Resistor(ref, this.node(comp.padNets[a.number], `${ref}.1`), mid, ohms, comp.id, [a.number, ''], false));
      const l = e.add(new Inductor(`${ref} индуктивность`, mid, this.node(comp.padNets[b.number], `${ref}.2`), 60e-6, comp.id, ['', b.number]));
      const params = [nominal('r', 'сопротивление', ohms, 'Ом')];
      this.addPart({
        comp,
        kind: 'динамик',
        params,
        elements: [r, l],
        set: (_k, v) => {
          sync();
          params[0].value = v;
          r.ohms = v;
          inv();
        },
        readings: () => [{ label: 'ток', value: l.i, unit: 'А' }],
      });
      return true;
    }

    // --- двигатель постоянного тока ---
    if ((tags.includes('motor') || /^M\d/.test(ref) || /^Motor_DC|двигател/i.test(`${fp.id} ${comp.description ?? ''}`)) && two.length === 2 && !tags.includes('module')) {
      const [a, b] = two;
      const m: MotorModel = { ...DEFAULT_MOTOR };
      const mot: DcMotor = buildMotor(e, ref, this.node(comp.padNets[a.number], `${ref}.1`), this.node(comp.padNets[b.number], `${ref}.2`), m, comp.id, [a.number, b.number]);
      const params = [
        param('r', 'сопротивление якоря', m.r, 'Ом', 0.05, 50, { log: true }),
        param('l', 'индуктивность якоря', m.l * 1e3, 'мГн', 0.01, 50, { log: true }),
        param('k', 'постоянная ЭДС', m.k * 1000, 'мВ·с/рад', 1, 500, { log: true }),
        param('j', 'инерция', m.j * 1e6, 'г·см²', 0.1, 1000, { log: true }),
        param('load', 'момент нагрузки', m.load * 1000, 'мН·м', 0, 200),
      ];
      const [rArm, lArm] = e.elements.slice(-3) as [Resistor, Inductor, DcMotor];
      this.addPart({
        comp,
        kind: 'двигатель',
        params,
        elements: e.elements.slice(-3),
        set: (k, v) => {
          sync();
          const q = params.find((x) => x.key === k);
          if (q) q.value = v;
          if (k === 'r') rArm.ohms = m.r = v;
          if (k === 'l') lArm.henry = m.l = v * 1e-3;
          if (k === 'k') m.k = v / 1000;
          if (k === 'j') m.j = v * 1e-6;
          if (k === 'load') m.load = v / 1000;
          inv();
        },
        readings: () => [
          { label: 'обороты', value: mot.rpm, unit: 'об/мин' },
          { label: 'ток', value: mot.ind.i, unit: 'А' },
          { label: 'момент', value: m.k * mot.ind.i * 1000, unit: 'мН·м' },
        ],
      });
      return true;
    }

    // --- кнопки ---
    if (fp.category === 'Кнопки и переключатели' || tags.includes('button') || tags.includes('tactile')) {
      const nets = [...new Set(fp.pads.map((q) => comp.padNets[q.number]).filter((x): x is Id => !!x))];
      if (nets.length < 2) return false;
      const a = this.node(nets[0], `${ref}.1`);
      const sws = nets.slice(1).map((net) => e.add(new Switch(ref, a, this.node(net, `${ref}.2`), false, 0.05, comp.id)));
      this.switches.set(`${comp.id}:B`, sws);
      this.addPart({ comp, kind: 'кнопка', params: [], elements: sws, set: () => {}, readings: () => [{ label: 'нажата', value: sws[0].closed ? 1 : 0, unit: '' }] });
      return true;
    }

    // --- модуль ЖК: подсветка и потребление ---
    if (tags.includes('lcd') || tags.includes('hd44780')) {
      const els: AnalogElement[] = [];
      if (netOf('A') && netOf('K')) els.push(e.add(new Diode(`${ref} подсветка`, n('A'), n('K'), { vf: 3.0, rd: 25, led: '#9fe870' }, comp.id, [padNo('A')!, padNo('K')!])));
      if (netOf('VDD') && netOf('VSS')) els.push(e.add(new Resistor(`${ref} потребление`, n('VDD'), n('VSS'), 5 / 0.0015, comp.id, [padNo('VDD')!, padNo('VSS')!], false)));
      if (!els.length) return false;
      this.addPart({ comp, kind: 'ЖК-модуль', params: [], elements: els, set: () => {}, readings: () => (els[0] instanceof Diode ? [{ label: 'ток подсветки', value: els[0].current(e.x), unit: 'А' }] : []) });
      return true;
    }

    // --- прочие микросхемы и модули: только потребление ---
    if (fp.category === 'Микросхемы' || tags.includes('module')) {
      const vcc = netOf('VDD', 'VCC', '5V', '3V3', 'V+');
      const gnd = netOf('GND', 'VSS');
      if (!vcc || !gnd) return false;
      const r = e.add(new Resistor(`${ref} потребление`, n('VDD', 'VCC', '5V', '3V3', 'V+'), n('GND', 'VSS'), 5 / 0.001, comp.id, [padNo('VDD', 'VCC', '5V', '3V3', 'V+')!, padNo('GND', 'VSS')!], false));
      this.addPart({ comp, kind: 'микросхема (потребление)', params: [param('i', 'потребление', 1, 'мА', 0.01, 200, { log: true })], elements: [r], set: (_k, v) => (sync(), (r.ohms = 5 / (v / 1000)), inv()), readings: () => [{ label: 'ток', value: r.currents(e.x)[0], unit: 'А' }] });
      return true;
    }
    return false;
  }

  /** Выход активного элемента на входе контроллера: его уровень передаётся в логическую схему. */
  private feed(node: Node): void {
    const net = this.netOfNode[node];
    if (node < 0 || !net) return;
    const g = this.circuit.netGroup.get(net);
    if (g === undefined || !this.circuit.groups[g].pins.length) return;
    if (!this.feeds.some((f) => f.g === g)) this.feeds.push({ g, node, lvl: 0 });
  }

  /** Амплитуда величины за последние ~2 мс (по отсчётам шагов). */
  private amplitude(fn: () => number): () => number {
    let peak = 0;
    let acc = 0;
    let n = 0;
    this.engine.listen(() => {
      acc = Math.max(acc, Math.abs(fn()));
      if (++n >= 2000) {
        peak = acc;
        acc = 0;
        n = 0;
      }
    });
    return () => Math.max(peak, acc);
  }

  /** Частота по переходам через ноль за последние ~20 мс (0 — нет колебаний). */
  private frequency(fn: () => number): () => number {
    let hz = 0;
    let prev = 0;
    let first = -1;
    let last = -1;
    let count = 0;
    let t0 = 0;
    const e = this.engine;
    e.listen(() => {
      const v = fn();
      if (prev <= 0 && v > 0 && Math.abs(v) > 1e-4) {
        // Переход через ноль — с долей шага.
        const t = e.t - e.dt * (v / (v - prev));
        if (first < 0) first = t;
        last = t;
        count++;
      }
      prev = v;
      if (e.t - t0 >= 0.02) {
        hz = count >= 2 ? (count - 1) / (last - first) : 0;
        first = last = -1;
        count = 0;
        t0 = e.t;
      }
    });
    return () => hz;
  }

  /** Резонанс передатчика катушки с последовательной ёмкостью (по номиналам), Гц. */
  private txResonance(): number {
    const coil = this.coil;
    if (!coil) return 0;
    const txNode = coil.rtx.a;
    const cap = this.engine.elements.find((x): x is Capacitor => x instanceof Capacitor && (x.a === txNode || x.b === txNode));
    return cap ? 1 / (2 * Math.PI * Math.sqrt(coil.o.ltx * cap.farads)) : 0;
  }

  /**
   * Тепловой шум слышен только там, где его усиливают: у входов ОУ и на приёмной катушке.
   * Остальным резисторам шум выключается — это экономит время шага.
   */
  private quiet(): void {
    const loud = new Set<Node>();
    for (const el of this.engine.elements) if (el instanceof OpAmp) loud.add(el.inP).add(el.inN);
    if (this.coil) for (const q of this.coil.rrx.pins) loud.add(q.node);
    for (const el of this.engine.elements) if (el instanceof Resistor && el.noisy && !loud.has(el.a) && !loud.has(el.b)) el.noisy = false;
  }

  /** Рабочая точка: 20 мс крупным неявным шагом, потом время — с нуля. */
  private settle(): void {
    const e = this.engine;
    const dt = e.dt;
    const noise = e.noise;
    e.noise = false;
    e.implicit = true;
    e.setDt(50e-6);
    for (let i = 0; i < 400; i++) e.step();
    e.implicit = false;
    e.noise = noise;
    e.setDt(dt);
    e.t = 0;
    e.steps = 0;
    e.kick();
  }

  /** Досчитать движок до текущего такта контроллера. */
  sync(): void {
    const t = this.circuit.mcu.cycles / this.freq;
    const e = this.engine;
    if (t <= e.t + e.dt * 0.5) return;
    const coil = this.coil;
    while (e.t < t - e.dt * 0.5) {
      if (coil && e.t >= this.nextCoilUpdate - e.dt * 0.5) {
        coil.update(e.t);
        this.nextCoilUpdate = e.t + 0.5e-3;
      }
      e.advanceTo(coil ? Math.min(t, this.nextCoilUpdate) : t);
    }
    const c = this.circuit;
    const half = c.mcu.vdd / 2;
    for (const f of this.feeds) {
      const v = e.volts(f.node);
      const lvl: 0 | 1 = f.lvl ? (v > half * 0.8 ? 1 : 0) : v > half * 1.2 ? 1 : 0;
      if (lvl !== f.lvl) {
        f.lvl = lvl;
        c.setVolts(f.g, v);
      }
    }
  }

  /** Напряжение цепи, В (undefined — цепь не в аналоговой схеме). */
  netVolts(net: Id): number | undefined {
    const n = this.nodeOf.get(net);
    if (n === undefined) return undefined;
    this.sync();
    return this.engine.volts(n);
  }

  /** Нажатие кнопки (id устройства логической симуляции: «comp:B»). */
  press(id: string, down: boolean): void {
    const sws = this.switches.get(id);
    if (!sws) return;
    this.sync();
    for (const s of sws) s.closed = down;
    this.engine.kick();
  }

  set(comp: Id, key: string, value: number): void {
    this.partOf.get(comp)?.set(key, value);
  }

  /** Ток через каждый вывод деталей, А (положительный — в деталь). */
  padCurrents(): Map<Id, Map<string, number>> {
    const x = this.engine.x;
    const out = new Map<Id, Map<string, number>>();
    for (const el of this.engine.elements) {
      if (!el.comp || !el.currents) continue;
      const cur = el.currents(x);
      el.pins.forEach((pin, i) => {
        if (!pin.pad) return;
        const m = out.get(el.comp!) ?? new Map<string, number>();
        m.set(pin.pad, (m.get(pin.pad) ?? 0) + cur[i]);
        out.set(el.comp!, m);
      });
    }
    return out;
  }

  /* ---------------- осциллограф ---------------- */

  /** Каналы осциллографа (до 4) и шаг записи (каждый every-й шаг движка). */
  setScope(probes: ScopeProbe[], every: number, len = 4000): void {
    this.scopeFns = probes.slice(0, 4).map((pr) => this.probeFn(pr));
    this.scopeLen = len;
    this.scopeRing = this.scopeFns.map(() => new Float32Array(len));
    this.scopeEvery = Math.max(1, Math.round(every));
    this.scopePos = 0;
    this.scopeCount = 0;
    if (!this.scopeHooked) {
      this.scopeHooked = true;
      this.engine.listen((e) => {
        if (!this.scopeFns.length || ++this.scopeTick < this.scopeEvery) return;
        this.scopeTick = 0;
        const x = e.x;
        for (let k = 0; k < this.scopeFns.length; k++) this.scopeRing[k][this.scopePos] = this.scopeFns[k](x);
        this.scopePos = (this.scopePos + 1) % this.scopeLen;
        if (this.scopeCount < this.scopeLen) this.scopeCount++;
        this.scopeT = e.t;
      });
    }
  }
  private scopeHooked = false;

  /** Отсчёты каналов по порядку (старые → новые) и интервал между ними, с. */
  scope(): { data: Float32Array[]; dt: number; t: number } {
    const n = this.scopeCount;
    const data = this.scopeRing.map((ring) => {
      const out = new Float32Array(n);
      const start = (this.scopePos - n + this.scopeLen) % this.scopeLen;
      for (let i = 0; i < n; i++) out[i] = ring[(start + i) % this.scopeLen];
      return out;
    });
    return { data, dt: this.engine.dt * this.scopeEvery, t: this.scopeT };
  }

  private probeFn(pr: ScopeProbe): (x: Float64Array) => number {
    if ('net' in pr) {
      const n = this.nodeOf.get(pr.net);
      return n === undefined || n < 0 ? () => 0 : (x) => x[n];
    }
    const els = this.engine.elements.filter((el) => el.comp === pr.comp && el.currents && el.pins.some((q) => q.pad === pr.pad));
    return (x) => {
      let s = 0;
      for (const el of els) {
        const cur = el.currents!(x);
        el.pins.forEach((q, i) => {
          if (q.pad === pr.pad) s += cur[i];
        });
      }
      return s;
    };
  }

  /* ---------------- АЧХ ---------------- */

  /**
   * АЧХ от цепи inp (1 В переменного) до напряжения цепи out или тока через деталь (резистор,
   * конденсатор, дроссель, обмотку катушки). Ключи — в текущем состоянии.
   */
  acSweep(inp: Id, out: ScopeProbe, f1: number, f2: number, points = 200): { f: number; mag: number; phase: number }[] {
    this.sync();
    const e = this.engine;
    const ni = this.nodeOf.get(inp) ?? GND;
    const res: { f: number; mag: number; phase: number }[] = [];
    for (let k = 0; k < points; k++) {
      const f = f1 * Math.pow(f2 / f1, k / Math.max(1, points - 1));
      const sol = e.acAt(f, ni);
      if (!sol) continue;
      const vv = (n: Node): [number, number] => (n < 0 ? [0, 0] : [sol.re[n], sol.im[n]]);
      let re = 0;
      let im = 0;
      if ('net' in out) [re, im] = vv(this.nodeOf.get(out.net) ?? GND);
      else {
        const w = 2 * Math.PI * f;
        for (const el of e.elements) {
          if (el.comp !== out.comp) continue;
          const idx = el.pins.findIndex((q) => q.pad === out.pad);
          if (idx < 0) continue;
          if (el instanceof CoupledCoils) {
            // Ток обмотки p = Σ Γpq·Vq / (jω).
            const p = idx >> 1;
            const m = el.coils.length;
            const G = el.inverseL;
            let sr = 0;
            let si = 0;
            for (let q = 0; q < m; q++) {
              const [ar, ai] = vv(el.coils[q].a);
              const [br, bi] = vv(el.coils[q].b);
              sr += G[p * m + q] * (ar - br);
              si += G[p * m + q] * (ai - bi);
            }
            const sign = idx % 2 ? -1 : 1;
            re += (sign * si) / w;
            im += (-sign * sr) / w;
            continue;
          }
          if (el.pins.length !== 2) continue;
          const [ar, ai] = vv(el.pins[0].node);
          const [br, bi] = vv(el.pins[1].node);
          const dr = ar - br;
          const di = ai - bi;
          const sign = idx === 0 ? 1 : -1;
          if (el instanceof Resistor) (re += (sign * dr) / el.ohms), (im += (sign * di) / el.ohms);
          else if (el instanceof Capacitor) (re += -sign * di * w * el.farads), (im += sign * dr * w * el.farads);
          else if (el instanceof Inductor) (re += (sign * di) / (w * el.henry)), (im += (-sign * dr) / (w * el.henry));
        }
      }
      res.push({ f, mag: Math.hypot(re, im), phase: (Math.atan2(im, re) * 180) / Math.PI });
    }
    return res;
  }

  /** Цепь, с которой удобно начинать АЧХ катушки: выход ключей передатчика. */
  defaultAcInput(): Id | null {
    const coil = this.coil;
    if (!coil) return null;
    // Катушка ← конденсатор ← резистор ← выход ключей.
    let node = coil.rtx.a;
    const seen = new Set<AnalogElement>();
    for (let hop = 0; hop < 3; hop++) {
      const el = this.engine.elements.find((x) => !seen.has(x) && (x instanceof Capacitor || (x instanceof Resistor && x.ohms <= 100 && x.comp !== coil.rtx.comp)) && x.pins.some((q) => q.node === node) && x.pins.every((q) => q.node !== GND));
      if (!el) break;
      seen.add(el);
      node = el.pins.find((q) => q.node !== node)!.node;
    }
    return this.netOfNode[node] ?? null;
  }

  /** Сколько узлов и разложений: для подсказки о скорости. */
  get stats(): { nodes: number; elements: number; steps: number; factorizations: number } {
    const e = this.engine;
    return { nodes: e.n, elements: e.elements.length, steps: e.steps, factorizations: e.factorizations };
  }
}
