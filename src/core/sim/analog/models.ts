import type { Component, FootprintDef, Id } from '../../model/types';
import { parseOhms, powerVoltsOf } from '../circuit';
import type { DeviceView } from '../devices';
import { COIL_TARGETS, DdCoil } from './coil';
import { Bjt, build555, buildMosfet, buildMotor, buildOpAmp, Diode, OpAmp, Regulator, Tl431, type BjtModel, type DcMotor, type DiodeModel, type MotorModel, type OpAmpModel } from './elements';
import { CondSwitch, DcDc, DrivenOut, Fuse, LabSupply, LogicChip, OptoTransistor, Thyristor, type LogicLevel, type LogicOut } from './elements-ext';
import { Capacitor, CoupledCoils, Inductor, Resistor, Switch, VSource, volt as v, type AnalogElement, type AnalogParam, type Engine, type Node } from './engine';
import { KIND_INFO, padsByName, up, type SimKind } from './kinds';
import { BJTS, DIODES, findOhms, ledModel, MOSFETS, OPAMP_DEFAULT, OPAMPS, parseAmps, parseFarads, parseHenry, parseVolts, parseWatts, regulatorModel, transformerVolts } from './parts';

/*
 * Построение модели детали по её виду (kinds.ts): элементы движка, ползунки параметров,
 * показания, а для деталей, которые видно и трогают, — вид на плате и в панели (светодиод
 * светится, динамик звучит, реле щёлкает, тумблер переключается касанием).
 */

export interface AnalogReading {
  label: string;
  value: number;
  unit: string;
}

/** Как деталь выглядит в панели и на плате. */
export interface PartUi {
  kind: DeviceView['kind'];
  on?(): boolean;
  /** 0…1. */
  brightness?(): number;
  color?: string;
  hz?(): number;
  pressed?(): boolean;
  /** Нажатие касанием (кнопка — пока держат, тумблер — переключается). */
  press?(down: boolean): void;
  toggle?: boolean;
  channels?(): boolean[];
  /** Ползунки на карточке (ключи параметров). */
  knobs?: string[];
  title?(): string;
}

export interface AnalogPart {
  comp: Component;
  /** Что это за модель: «резистор», «ОУ MCP601»… */
  kind: string;
  sim: SimKind | 'mcu' | 'supply' | 'mains' | 'source';
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
  ui?: PartUi;
  /** Не деталь проекта: питание по имени цепи, сеть, источник или генератор (id настройки). */
  virtual?: string;
  /** Параметры модели по названию детали (до ручных) — чтобы видеть, что изменено. */
  defaults?: Record<string, number>;
}

/** Что построителю нужно от симуляции. */
export interface BuildCtx {
  e: Engine;
  node(net: Id | undefined, label: string): Node;
  netName(net: Id | undefined): string;
  sync(): void;
  kick(): void;
  /** Выход активного элемента: если на цепи вход контроллера — уровень передаётся в логику. */
  feed(node: Node): void;
  amplitude(fn: () => number): () => number;
  frequency(fn: () => number): () => number;
  /** Среднее с прошлого чтения. */
  average(fn: () => number): () => number;
  setCoil(c: DdCoil): void;
  txResonance(): number;
}

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
export function fmtSi(x: number, unit: string, digits = 3): string {
  if (!isFinite(x)) return '—';
  if (x === 0) return `0 ${unit}`;
  const a = Math.abs(x);
  const [mul, pre] = PREFIX.find(([m]) => a >= m * 0.9995) ?? PREFIX[PREFIX.length - 1];
  const s = Number((x / mul).toPrecision(digits)).toLocaleString('ru', { maximumFractionDigits: 3 });
  return `${s} ${pre}${unit}`;
}

type Knob = AnalogParam & { apply(v: number): void };

const knob = (key: string, label: string, value: number, unit: string, min: number, max: number, apply: (v: number) => void, extra: Partial<AnalogParam> = {}): Knob => ({ key, label, value, unit, min, max, apply, ...extra });
/** Номинал: пределы — в 10 раз в обе стороны, шкала логарифмическая. */
const nomKnob = (key: string, label: string, value: number, unit: string, apply: (v: number) => void): Knob => knob(key, label, value, unit, value / 10, value * 10, apply, { log: true, nominal: true });

// Коллекторный двигатель 12 В (RS-385): ток холостого хода ≈ 0,1 А, выбег ≈ 0,5 с.
const MOTOR_DEFAULT: MotorModel = { r: 2, l: 1e-3, k: 0.01, j: 5e-7, b: 1e-6, load: 0 };

/** Построить модель детали вида kind. null — не получилось (нет нужных выводов). */
export function buildPart(ctx: BuildCtx, kind: SimKind, comp: Component, fp: FootprintDef): AnalogPart | null {
  const e = ctx.e;
  const ref = comp.ref;
  const pads = padsByName(fp);
  const numbered = fp.pads.filter((q) => q.type !== 'npth');
  const padNo = (...names: string[]) => names.map((x) => pads.get(up(x))?.[0]).find((x) => x !== undefined);
  const netOf = (...names: string[]) => {
    const q = padNo(...names);
    return q ? comp.padNets[q] : undefined;
  };
  const n = (...names: string[]) => ctx.node(netOf(...names), `${ref}.${names[0]}`);
  /** Вывод по имени, иначе по порядку (для корпусов без имён выводов). */
  const pin = (i: number, ...names: string[]): { node: Node; pad: string } => {
    const q = padNo(...names) ?? numbered[i]?.number ?? '';
    return { node: ctx.node(comp.padNets[q], `${ref}.${names[0] ?? i + 1}`), pad: q };
  };
  const text = `${(fp.tags ?? []).join(' ')} ${fp.id} ${fp.name} ${comp.value} ${comp.description ?? ''}`;
  const has = (t: string) => (fp.tags ?? []).includes(t);
  const label = KIND_INFO[kind].label;
  const sync = ctx.sync;
  const inv = () => e.invalidate();

  /** Деталь с ползунками: set ищет ползунок, применяет и пересобирает матрицу. */
  const part = (p: Omit<AnalogPart, 'set' | 'params' | 'sim' | 'comp'> & { knobs: Knob[] }): AnalogPart => {
    const { knobs, ...rest } = p;
    return {
      comp,
      sim: kind,
      ...rest,
      params: knobs,
      defaults: Object.fromEntries(knobs.map((q) => [q.key, q.value])),
      set: (key, val) => {
        const q = knobs.find((x) => x.key === key);
        if (!q) return;
        sync();
        q.value = val;
        q.apply(val);
        inv();
      },
    };
  };
  const two = (): [{ node: Node; pad: string }, { node: Node; pad: string }] | null => (numbered.length >= 2 ? [pin(0), pin(1)] : null);

  switch (kind) {
    case 'dd-coil': {
      const tx: [Node, Node] = [n('TX1'), n('TX2')];
      const rx: [Node, Node] = [n('RX1'), n('RX2')];
      const coil = new DdCoil(e, ref, tx, rx, { ltx: 0.8e-3, rtx: 1.5, lrx: 11.4e-3, rrx: 20, balance: 7 }, comp.id, { tx: [padNo('TX1')!, padNo('TX2')!], rx: [padNo('RX1')!, padNo('RX2')!] });
      ctx.setCoil(coil);
      const upd = () => coil.update(e.t, true);
      const knobs = [
        knob('target', 'цель', 0, '', 0, COIL_TARGETS.length - 1, (x) => ((coil.target = Math.round(x)), upd()), { options: COIL_TARGETS.map((t) => t.name) }),
        knob('depth', 'глубина', 10, 'см', 1, 40, (x) => ((coil.depth = x), upd())),
        knob('over', 'катушка', 0, '', 0, 1, (x) => ((coil.over = x >= 0.5), upd()), { options: ['в стороне', 'над целью'] }),
        knob('balance', 'сведение (связь TX→RX)', coil.o.balance, 'ppm', -60, 60, (x) => ((coil.o.balance = x), upd())),
        knob('ltx', 'L передающей', coil.o.ltx * 1e3, 'мГн', 0.2, 3, (x) => ((coil.o.ltx = x * 1e-3), upd()), { log: true }),
        knob('rtx', 'R провода TX', coil.o.rtx, 'Ом', 0.1, 10, (x) => ((coil.o.rtx = x), upd()), { log: true }),
        knob('lrx', 'L приёмной', coil.o.lrx * 1e3, 'мГн', 2, 50, (x) => ((coil.o.lrx = x * 1e-3), upd()), { log: true }),
        knob('rrx', 'R провода RX', coil.o.rrx, 'Ом', 1, 100, (x) => ((coil.o.rrx = x), upd()), { log: true }),
      ];
      const txAmp = ctx.amplitude(() => coil.txCurrent);
      const txHz = ctx.frequency(() => coil.txCurrent);
      return part({
        kind: 'катушка DD',
        knobs,
        elements: [coil.coils, coil.rtx, coil.rrx, coil.rt],
        readings: () => [
          { label: 'ток TX (амплитуда)', value: txAmp(), unit: 'А' },
          { label: 'резонанс TX c ёмкостью', value: ctx.txResonance(), unit: 'Гц' },
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
    }

    case 'resistor':
    case 'load': {
      const t = two();
      if (!t) return null;
      const ohms = parseOhms(comp.value) ?? findOhms(comp.value) ?? (kind === 'load' ? 10 : 1000);
      const r = e.add(new Resistor(ref, t[0].node, t[1].node, ohms, comp.id, [t[0].pad, t[1].pad]));
      return part({
        kind: label,
        knobs: [nomKnob('r', 'сопротивление', ohms, 'Ом', (x) => (r.ohms = x))],
        elements: [r],
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
    }

    case 'lamp': {
      const t = two();
      if (!t) return null;
      const watts = parseWatts(comp.value) ?? 5;
      const volts = parseVolts(comp.value) ?? 12;
      const r = e.add(new Resistor(ref, t[0].node, t[1].node, (volts * volts) / watts, comp.id, [t[0].pad, t[1].pad], false));
      const knobs = [knob('watts', 'мощность', watts, 'Вт', 0.1, 200, (x) => (r.ohms = (knobs[1].value * knobs[1].value) / x), { log: true }), knob('volts', 'напряжение', volts, 'В', 1, 240, (x) => (r.ohms = (x * x) / knobs[0].value), { log: true })];
      const pw = ctx.average(() => {
        const u = e.volts(r.a) - e.volts(r.b);
        return (u * u) / r.ohms;
      });
      return part({
        kind: label,
        knobs,
        elements: [r],
        readings: () => [{ label: 'мощность', value: pw(), unit: 'Вт' }],
        ui: { kind: 'led', color: '#ffcf6b', brightness: () => Math.min(1, pw() / knobs[0].value), on: () => pw() > knobs[0].value * 0.05 },
      });
    }

    case 'ntc': {
      const t = two();
      if (!t) return null;
      const r25 = parseOhms(comp.value) ?? findOhms(comp.value) ?? 10_000;
      const r = e.add(new Resistor(ref, t[0].node, t[1].node, r25, comp.id, [t[0].pad, t[1].pad]));
      const calc = () => {
        const T = knobs[2].value + 273.15;
        r.ohms = knobs[0].value * Math.exp(knobs[1].value * (1 / T - 1 / 298.15));
      };
      const knobs = [nomKnob('r25', 'сопротивление при 25 °C', r25, 'Ом', calc), knob('beta', 'B', 3950, 'К', 2000, 5000, calc), knob('temp', 'температура', 25, '°C', -40, 150, calc)];
      calc();
      return part({
        kind: label,
        knobs,
        elements: [r],
        readings: () => [
          { label: 'сопротивление', value: r.ohms, unit: 'Ом' },
          { label: 'напряжение', value: e.volts(r.a) - e.volts(r.b), unit: 'В' },
        ],
        nominal: () => fmtSi(knobs[0].value, 'Ом'),
        ui: { kind: 'sensor', knobs: ['temp'], title: () => `${ref} терморезистор: ${Math.round(knobs[2].value)} °C, ${fmtSi(r.ohms, 'Ом')}` },
      });
    }

    case 'ldr': {
      const t = two();
      if (!t) return null;
      const gl = /GL?55(06|16|28|37|39|49)/i.exec(comp.value);
      const table: Record<string, number> = { '06': 3e3, '16': 7e3, '28': 15e3, '37': 25e3, '39': 50e3, '49': 90e3 };
      const r10 = findOhms(comp.value) ?? (gl ? table[gl[1]] : 15e3);
      const r = e.add(new Resistor(ref, t[0].node, t[1].node, r10, comp.id, [t[0].pad, t[1].pad]));
      const calc = () => (r.ohms = Math.min(5e6, Math.max(50, knobs[0].value * Math.pow(Math.max(0.01, knobs[1].value) / 10, -0.7))));
      const knobs = [nomKnob('r10', 'сопротивление при 10 лк', r10, 'Ом', calc), knob('lux', 'освещённость', 100, 'лк', 0.1, 100_000, calc, { log: true })];
      calc();
      return part({
        kind: label,
        knobs,
        elements: [r],
        readings: () => [{ label: 'сопротивление', value: r.ohms, unit: 'Ом' }],
        ui: { kind: 'sensor', knobs: ['lux'], title: () => `${ref} фоторезистор: ${fmtSi(knobs[1].value, 'лк', 2)}, ${fmtSi(r.ohms, 'Ом')}` },
      });
    }

    case 'pot': {
      const w = pin(1, 'W', '2', 'OUT', 'WIPER');
      const a = pin(0, '1', 'CCW', 'GND');
      const b = pin(2, '3', 'CW', 'VCC');
      if (!comp.padNets[w.pad]) return null;
      const total = parseOhms(comp.value) ?? findOhms(comp.value) ?? 10_000;
      const r1 = e.add(new Resistor(`${ref} нижнее плечо`, a.node, w.node, total / 2, comp.id, [a.pad, w.pad]));
      const r2 = e.add(new Resistor(`${ref} верхнее плечо`, w.node, b.node, total / 2, comp.id, [w.pad, b.pad]));
      const apply = () => {
        const x = knobs[0].value / 100;
        r1.ohms = Math.max(1, knobs[1].value * x);
        r2.ohms = Math.max(1, knobs[1].value * (1 - x));
      };
      const knobs = [knob('pos', 'положение', 50, '%', 0, 100, apply), nomKnob('r', 'сопротивление', total, 'Ом', apply)];
      return part({
        kind: label,
        knobs,
        elements: [r1, r2],
        readings: () => [{ label: 'на движке', value: e.volts(w.node), unit: 'В' }],
        nominal: () => fmtSi(knobs[1].value, 'Ом'),
        ui: { kind: 'pot', knobs: ['pos'], title: () => `${ref} потенциометр ${fmtSi(knobs[1].value, 'Ом')}: ${Math.round(knobs[0].value)} %` },
      });
    }

    case 'capacitor': {
      const t = two();
      if (!t) return null;
      const f = parseFarads(comp.value) ?? 100e-9;
      const plus = padNo('+') ? { node: n('+'), pad: padNo('+')! } : t[0];
      const minus = padNo('-') ? { node: n('-'), pad: padNo('-')! } : plus === t[0] ? t[1] : t[0];
      const esr = comp.sim?.params?.esr;
      let top = plus.node;
      const els: AnalogElement[] = [];
      let rEsr: Resistor | null = null;
      if (esr && esr > 0) {
        top = e.node(`${ref}:ESR`);
        rEsr = e.add(new Resistor(`${ref} ESR`, plus.node, top, esr, comp.id, [plus.pad, ''], false));
        els.push(rEsr);
      }
      const cap = e.add(new Capacitor(ref, top, minus.node, f, comp.id, [rEsr ? '' : plus.pad, minus.pad]));
      els.push(cap);
      const vmax = parseVolts(comp.value.split(/[×x]/)[1] ?? '') ?? null;
      const polar = has('polar') || has('cp') || has('electrolytic') || !!padNo('+');
      const knobs = [nomKnob('c', 'ёмкость', f, 'Ф', (x) => (cap.farads = x))];
      if (rEsr) knobs.push(knob('esr', 'ESR', esr!, 'Ом', 0.001, 100, (x) => (rEsr!.ohms = x), { log: true }));
      return part({
        kind: polar ? 'электролит' : 'конденсатор',
        knobs,
        elements: els,
        readings: () => {
          const u = e.volts(plus.node) - e.volts(minus.node);
          const r: AnalogReading[] = [
            { label: 'напряжение', value: u, unit: 'В' },
            { label: 'ток', value: cap.i, unit: 'А' },
          ];
          if (vmax) r.push({ label: 'запас по напряжению', value: vmax - Math.abs(u), unit: 'В' });
          if (polar && u < -0.3) r.push({ label: 'ОБРАТНАЯ ПОЛЯРНОСТЬ', value: u, unit: 'В' });
          if (vmax && Math.abs(u) > vmax) r.push({ label: 'ПРЕВЫШЕНО НАПРЯЖЕНИЕ', value: u, unit: 'В' });
          return r;
        },
        nominal: () => fmtSi(cap.farads, 'Ф'),
      });
    }

    case 'inductor':
    case 'wire': {
      const t = two();
      if (!t) return null;
      const henry = kind === 'inductor' ? (parseHenry(comp.value) ?? 10e-6) : 0;
      if (!henry) {
        const r = e.add(new Resistor(ref, t[0].node, t[1].node, 0.02, comp.id, [t[0].pad, t[1].pad], false));
        return part({ kind: 'перемычка', knobs: [], elements: [r], readings: () => [{ label: 'ток', value: r.currents(e.x)[0], unit: 'А' }] });
      }
      const mid = e.node(`${ref}:L`);
      const dcr = Math.max(0.02, henry * 1000);
      const r = e.add(new Resistor(`${ref} провод`, t[0].node, mid, dcr, comp.id, [t[0].pad, ''], false));
      const l = e.add(new Inductor(ref, mid, t[1].node, henry, comp.id, ['', t[1].pad]));
      return part({
        kind: label,
        knobs: [nomKnob('l', 'индуктивность', henry, 'Гн', (x) => (l.henry = x)), knob('dcr', 'сопротивление провода', dcr, 'Ом', 0.001, 100, (x) => (r.ohms = x), { log: true })],
        elements: [r, l],
        readings: () => [{ label: 'ток', value: l.i, unit: 'А' }],
        nominal: () => fmtSi(l.henry, 'Гн'),
      });
    }

    case 'fuse': {
      const t = two();
      if (!t) return null;
      const amps = parseAmps(comp.value) ?? 1;
      const f = e.add(new Fuse(ref, t[0].node, t[1].node, amps, 0.05, comp.id, [t[0].pad, t[1].pad]));
      f.onBlow = () => ctx.kick();
      return part({
        kind: label,
        knobs: [knob('amps', 'ток срабатывания', amps, 'А', 0.05, 30, (x) => (f.amps = x), { log: true })],
        elements: [f],
        readings: () => [
          { label: 'ток', value: f.current(e.x), unit: 'А' },
          { label: 'состояние', value: f.blown ? 1 : 0, unit: f.blown ? 'СГОРЕЛ' : 'цел' },
        ],
        actions: [{ key: 'replace', label: 'Заменить предохранитель' }],
        act: (k) => {
          if (k !== 'replace') return;
          sync();
          f.blown = false;
          f.heat = 0;
          ctx.kick();
        },
      });
    }

    case 'diode':
    case 'zener':
    case 'led': {
      if (!padNo('A') && numbered.length < 2) return null;
      // Без имён: у диодов библиотеки катод — вывод 1.
      const a = pin(1, 'A');
      const k = pin(0, 'K');
      let m: DiodeModel;
      if (kind === 'led') m = ledModel(text);
      else {
        m = { ...(DIODES.find(([re]) => re.test(text))?.[1] ?? { vf: 0.7, rd: 0.1 }) };
        if (kind === 'zener') {
          m.vz = parseVolts(comp.value) ?? 5.1;
          m.rz = 5;
        }
      }
      const d = e.add(new Diode(ref, a.node, k.node, m, comp.id, [a.pad, k.pad]));
      const knobs: Knob[] = [knob('vf', 'прямое напряжение', m.vf, 'В', kind === 'led' ? 1.2 : 0.15, kind === 'led' ? 3.8 : 1.3, (x) => (d.m.vf = x))];
      if (kind === 'zener') knobs.push(knob('vz', 'напряжение стабилизации', m.vz!, 'В', 1, 60, (x) => (d.m.vz = x)));
      if (kind === 'diode') knobs.push(knob('rd', 'сопротивление открытого', m.rd, 'Ом', 0.001, 100, (x) => (d.m.rd = x), { log: true }));
      let imax = 0.02;
      if (kind === 'led') knobs.push(knob('imax', 'ток полной яркости', imax, 'А', 0.001, 1, (x) => (imax = x), { log: true }));
      const avg = ctx.average(() => Math.max(0, d.current(e.x)));
      return part({
        kind: kind === 'led' ? 'светодиод' : kind === 'zener' ? 'стабилитрон' : 'диод',
        knobs,
        elements: [d],
        readings: () => {
          const i = d.current(e.x);
          const r: AnalogReading[] = [
            { label: 'ток', value: i, unit: 'А' },
            { label: 'напряжение', value: e.volts(d.a) - e.volts(d.k), unit: 'В' },
          ];
          if (kind === 'led') {
            r.push({ label: 'яркость', value: Math.min(1, avg() / imax) * 100, unit: '%' });
            if (i > imax * 2.5) r.push({ label: 'ПЕРЕГРУЗКА по току', value: i, unit: 'А' });
          }
          return r;
        },
        ui: kind === 'led' ? { kind: 'led', color: m.led, brightness: () => Math.min(1, avg() / imax), on: () => avg() > imax * 0.02 } : undefined,
      });
    }

    case 'bridge': {
      const ac = pads.get('~') ?? [];
      const plus = padNo('+');
      const minus = padNo('-');
      if (ac.length < 2 || !plus || !minus) return null;
      const m: DiodeModel = { vf: 0.85, rd: 0.03 };
      const ac1 = ctx.node(comp.padNets[ac[0]], `${ref}.~1`);
      const ac2 = ctx.node(comp.padNets[ac[1]], `${ref}.~2`);
      const pn = n('+');
      const mn = n('-');
      const ds = [e.add(new Diode(`${ref} ~1→+`, ac1, pn, { ...m }, comp.id, [ac[0], plus])), e.add(new Diode(`${ref} ~2→+`, ac2, pn, { ...m }, comp.id, [ac[1], plus])), e.add(new Diode(`${ref} −→~1`, mn, ac1, { ...m }, comp.id, [minus, ac[0]])), e.add(new Diode(`${ref} −→~2`, mn, ac2, { ...m }, comp.id, [minus, ac[1]]))];
      return part({
        kind: label,
        knobs: [knob('vf', 'прямое напряжение диода', m.vf, 'В', 0.3, 1.5, (x) => ds.forEach((d) => (d.m.vf = x)))],
        elements: ds,
        readings: () => [
          { label: 'ток на выходе', value: Math.max(0, ds[0].current(e.x)) + Math.max(0, ds[1].current(e.x)), unit: 'А' },
          { label: 'выход', value: e.volts(pn) - e.volts(mn), unit: 'В' },
        ],
      });
    }

    case 'nmos':
    case 'pmos': {
      const m = { ...(MOSFETS.find(([re]) => re.test(comp.value))?.[1] ?? { type: 'n' as const, vth: 2.5, ron: 0.1, cgs: 1e-9 }) };
      m.type = kind === 'nmos' ? 'n' : 'p';
      const g = pin(0, 'G');
      const d = pin(1, 'D');
      const s = pin(2, 'S');
      const ch = buildMosfet(e, ref, d.node, g.node, s.node, m, comp.id, [d.pad, g.pad, s.pad]);
      const els = e.elements.slice(-3);
      const cgs = els.find((x): x is Capacitor => x instanceof Capacitor);
      const knobs = [knob('vth', 'порог', m.vth, 'В', 0.5, 6, (x) => (ch.m.vth = x)), knob('ron', 'сопротивление открытого', m.ron, 'Ом', 0.001, 20, (x) => (ch.m.ron = x), { log: true })];
      if (cgs) knobs.push(knob('cgs', 'ёмкость затвора', m.cgs, 'Ф', 10e-12, 20e-9, (x) => (cgs.farads = x), { log: true }));
      const heat = ctx.average(() => (e.volts(ch.d) - e.volts(ch.s)) * ch.currents(e.x)[0]);
      return part({
        kind: kind === 'nmos' ? 'MOSFET N' : 'MOSFET P',
        knobs,
        elements: els,
        readings: () => [
          { label: 'открыт', value: ch.on ? 1 : 0, unit: ch.on ? 'открыт' : 'закрыт' },
          { label: 'затвор—исток', value: e.volts(ch.g) - e.volts(ch.s), unit: 'В' },
          { label: 'ток стока', value: ch.currents(e.x)[0], unit: 'А' },
          { label: 'нагрев (средний)', value: Math.abs(heat()), unit: 'Вт' },
        ],
      });
    }

    case 'npn':
    case 'pnp': {
      const m: BjtModel = { ...(BJTS.find(([re]) => re.test(comp.value))?.[1] ?? { type: kind, beta: 150, vbe: 0.65, rbe: 50, vcesat: 0.15, rsat: 1 }) };
      m.type = kind;
      const b = pin(0, 'B');
      const c = pin(1, 'C');
      const em = pin(2, 'E');
      const q = e.add(new Bjt(ref, c.node, b.node, em.node, m, comp.id, [c.pad, b.pad, em.pad]));
      // Пробой коллектор—эмиттер: выброс катушки без диода ограничивается лавиной, как в жизни.
      const brk = kind === 'npn' ? e.add(new Diode(`${ref} пробой К—Э`, em.node, c.node, { vf: 0.7, rd: 1, vz: m.vceo ?? 45, rz: 2 }, comp.id, [em.pad, c.pad])) : e.add(new Diode(`${ref} пробой К—Э`, c.node, em.node, { vf: 0.7, rd: 1, vz: m.vceo ?? 45, rz: 2 }, comp.id, [c.pad, em.pad]));
      return part({
        kind: kind === 'npn' ? 'транзистор n-p-n' : 'транзистор p-n-p',
        knobs: [knob('beta', 'усиление β', m.beta, '', 10, 3000, (x) => (q.m.beta = x), { log: true }), knob('vbe', 'напряжение база—эмиттер', m.vbe, 'В', 0.4, 1.6, (x) => (q.m.vbe = x))],
        elements: [q, brk],
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

    case 'triac':
    case 'scr': {
      const tri = kind === 'triac';
      const a = pin(1, tri ? 'T2' : 'A', 'MT2');
      const k = pin(0, tri ? 'T1' : 'K', 'MT1');
      const g = pin(2, 'G');
      const th = e.add(new Thyristor(ref, a.node, k.node, g.node, tri, tri ? 0.025 : 0.005, tri ? 0.025 : 0.01, null, 0.05, 100, comp.id, [a.pad, k.pad, g.pad]));
      return part({
        kind: label,
        knobs: [knob('igt', 'ток включения', th.igt, 'А', 0.0005, 0.1, (x) => (th.igt = x), { log: true }), knob('ih', 'ток удержания', th.ih, 'А', 0.0005, 0.1, (x) => (th.ih = x), { log: true })],
        elements: [th],
        readings: () => [
          { label: 'открыт', value: th.on ? 1 : 0, unit: th.on ? 'открыт' : 'закрыт' },
          { label: 'ток', value: th.currents(e.x)[0], unit: 'А' },
        ],
      });
    }

    case 'opamp':
    case 'comparator': {
      const found = OPAMPS.find(([re]) => re.test(comp.value))?.[1];
      const opm: OpAmpModel = { ...(found ?? (kind === 'comparator' ? OPAMPS.find(([re]) => re.test('LM393'))![1] : OPAMP_DEFAULT)) };
      const vp = n('VCC', 'VDD', 'V+', 'VS+', 'VCC+', 'VS');
      const vn = n('GND', 'VSS', 'V-', 'VS-', 'VEE', 'VCC-');
      const units: { ip: string; in: string; out: string }[] = [];
      if (pads.has('IN+') && pads.has('OUT')) units.push({ ip: 'IN+', in: 'IN-', out: 'OUT' });
      for (let k = 1; k <= 4; k++) if (pads.has(`IN${k}+`) && pads.has(`OUT${k}`)) units.push({ ip: `IN${k}+`, in: `IN${k}-`, out: `OUT${k}` });
      if (!units.length) return null;
      const ops: OpAmp[] = [];
      const els: AnalogElement[] = [];
      for (const u of units) {
        // Неподключённый блок сдвоенного ОУ не считается (его выход никуда не идёт).
        if (units.length > 1 && !netOf(u.out) && !netOf(u.ip)) continue;
        const op = buildOpAmp(e, units.length > 1 ? `${ref} ${u.out}` : ref, n(u.ip), n(u.in), n(u.out), vp, vn, { ...opm }, comp.id, [padNo(u.ip)!, padNo(u.in)!, padNo(u.out)!, padNo('VCC', 'VDD', 'V+', 'VS+', 'VCC+', 'VS') ?? '', padNo('GND', 'VSS', 'V-', 'VS-', 'VEE', 'VCC-') ?? '']);
        ops.push(op);
        els.push(op, e.elements[e.elements.length - 1]);
        ctx.feed(op.out);
      }
      const poles = els.filter((x): x is Capacitor => x instanceof Capacitor);
      return part({
        kind: opm.openCollector ? 'компаратор' : 'операционный усилитель',
        knobs: [
          knob('gbw', 'полоса (GBW)', opm.gbw, 'Гц', 1e4, 1e8, (x) => (ops.forEach((o) => (o.m.gbw = x)), poles.forEach((pc) => (pc.farads = 1e-3 / (2 * Math.PI * x)))), { log: true }),
          knob('en', 'шум на входе', opm.en * 1e9, 'нВ/√Гц', 0, 100, (x) => ops.forEach((o) => (o.m.en = x * 1e-9))),
        ],
        elements: els,
        readings: () =>
          ops.flatMap((op, i) => {
            const pre = ops.length > 1 ? `${op.name.split(' ').pop()} ` : '';
            void i;
            return [
              { label: `${pre}выход`, value: e.volts(op.out), unit: 'В' },
              { label: `${pre}вход +/−`, value: e.volts(op.inP) - e.volts(op.inN), unit: 'В' },
              { label: `${pre}упор`, value: op.st, unit: ['нет', 'в плюс', 'в минус'][op.st] },
            ];
          }),
      });
    }

    case 'tl431': {
      const t = e.add(new Tl431(ref, n('K'), n('A'), n('REF', 'R'), 2.495, 5, comp.id, [padNo('K')!, padNo('A')!, padNo('REF', 'R')!]));
      return part({
        kind: 'источник опорного TL431',
        knobs: [knob('vref', 'опорное', 2.495, 'В', 1.2, 2.6, (x) => (t.vref = x))],
        elements: [t],
        readings: () => [
          { label: 'ток катода', value: t.currents(e.x)[0], unit: 'А' },
          { label: 'катод', value: e.volts(t.k) - e.volts(t.a), unit: 'В' },
        ],
      });
    }

    case 'regulator': {
      const reg = regulatorModel(comp.value) ?? { vout: parseVolts(comp.value) ?? 5, vdrop: 2, rout: 0.05, iq: 5e-3 };
      if (!padNo('IN', 'VI', 'VIN') || !padNo('OUT', 'VO', 'VOUT')) return null;
      const r = e.add(new Regulator(ref, n('IN', 'VI', 'VIN'), n('GND', 'ADJ', 'COM'), n('OUT', 'VO', 'VOUT'), reg, comp.id, [padNo('IN', 'VI', 'VIN')!, padNo('GND', 'ADJ', 'COM') ?? '', padNo('OUT', 'VO', 'VOUT')!]));
      const heat = ctx.average(() => (e.volts(r.vin) - e.volts(r.out)) * r.load(e.x));
      return part({
        kind: 'стабилизатор',
        knobs: [knob('vout', 'выход', reg.vout, 'В', 1.2, 24, (x) => (r.m.vout = x)), knob('vdrop', 'минимальный перепад', reg.vdrop, 'В', 0.05, 3, (x) => (r.m.vdrop = x))],
        elements: [r],
        readings: () => {
          const i = r.load(e.x);
          const vin = e.volts(r.vin) - e.volts(r.gnd);
          const vo = e.volts(r.out) - e.volts(r.gnd);
          return [
            { label: 'режим', value: r.st, unit: ['стабилизирует', 'не хватает входа', 'выключен'][r.st] },
            { label: 'вход', value: vin, unit: 'В' },
            { label: 'выход', value: vo, unit: 'В' },
            { label: 'ток нагрузки', value: i, unit: 'А' },
            { label: 'нагрев (средний)', value: heat(), unit: 'Вт' },
          ];
        },
      });
    }

    case 'dcdc': {
      const boost = has('boost') || /MT3608|XL6009|boost|повыш/i.test(text);
      const vin = n('IN+', 'VIN+', 'VIN', 'IN');
      const gin = n('IN-', 'VIN-', 'GND');
      const out = n('OUT+', 'VOUT+', 'OUT', 'SW', 'VOUT');
      const gout = padNo('OUT-', 'VOUT-') ? n('OUT-', 'VOUT-') : gin;
      const byName = /AP63203|K7833|3V3|3\.3/i.test(comp.value) ? 3.3 : /K7812/i.test(comp.value) ? 12 : null;
      const vout = parseVolts(comp.value) ?? byName ?? (boost ? 12 : 5);
      const d = e.add(new DcDc(ref, vin, gin, out, gout, { vout, eff: 0.88, rout: 0.03, boost, uvlo: boost ? 2 : Math.min(3, vout) }, comp.id, [padNo('IN+', 'VIN+', 'VIN', 'IN') ?? '', padNo('IN-', 'VIN-', 'GND') ?? '', padNo('OUT+', 'VOUT+', 'OUT', 'SW', 'VOUT') ?? '', padNo('OUT-', 'VOUT-') ?? '']));
      return part({
        kind: boost ? 'повышающий DC-DC' : 'понижающий DC-DC',
        knobs: [knob('vout', 'выход', vout, 'В', 1, 48, (x) => (d.m.vout = x)), knob('eff', 'КПД', 88, '%', 50, 98, (x) => (d.m.eff = x / 100))],
        elements: [d],
        readings: () => [
          { label: 'режим', value: d.st, unit: ['стабилизирует', boost ? 'вход выше выхода' : 'не хватает входа', 'выключен'][d.st] },
          { label: 'выход', value: e.volts(d.out) - e.volts(d.gout), unit: 'В' },
          { label: 'ток нагрузки', value: d.load(e.x), unit: 'А' },
          { label: 'ток со входа', value: d.currents(e.x)[0], unit: 'А' },
        ],
      });
    }

    case 'timer555': {
      const cmos = /7555|TLC555|LMC555|ICM/i.test(comp.value);
      const nn = { vcc: n('VCC'), gnd: n('GND'), trig: n('TRIG', 'TR'), thr: n('THR', 'TH'), ctrl: n('CTRL', 'CV', 'CONT'), reset: n('RST', 'RESET', 'R'), out: n('OUT', 'Q'), dis: n('DIS', 'DISCH') };
      const padMap: Record<string, string> = { vcc: padNo('VCC') ?? '', gnd: padNo('GND') ?? '', trig: padNo('TRIG', 'TR') ?? '', thr: padNo('THR', 'TH') ?? '', ctrl: padNo('CTRL', 'CV', 'CONT') ?? '', reset: padNo('RST', 'RESET', 'R') ?? '', out: padNo('OUT', 'Q') ?? '', dis: padNo('DIS', 'DISCH') ?? '' };
      // Неподключённый сброс у 555 внутри не подтянут — считаем, что он на питании (как на практике).
      if (!netOf('RST', 'RESET', 'R')) nn.reset = nn.vcc;
      const t = build555(e, ref, nn, cmos, comp.id, padMap);
      ctx.feed(nn.out);
      const hz = ctx.frequency(() => e.volts(nn.out) - (e.volts(nn.vcc) + e.volts(nn.gnd)) / 2);
      return part({
        kind: cmos ? 'таймер 555 (КМОП)' : 'таймер 555',
        knobs: [],
        elements: e.elements.slice(-4),
        readings: () => [
          { label: 'выход', value: e.volts(nn.out), unit: 'В' },
          { label: 'порог THR', value: e.volts(nn.thr), unit: 'В' },
          { label: 'частота', value: hz(), unit: 'Гц' },
          { label: 'триггер', value: t.q ? 1 : 0, unit: t.q ? 'установлен' : 'сброшен' },
        ],
      });
    }

    case 'logic':
      return buildLogic(ctx, comp, fp, part);

    case 'l293': {
      const vs = n('VS', 'VCC2', 'VMOT');
      const vss = n('VSS', 'VCC1', 'VCC');
      const gnd = n('GND');
      const chans = [1, 2, 3, 4].filter((k) => netOf(`OUT${k}`));
      if (!chans.length) return null;
      const ins: Node[] = [n('EN12', 'EN1', '1,2EN'), n('EN34', 'EN2', '3,4EN'), ...chans.map((k) => n(`IN${k}`))];
      const outs: LogicOut[] = chans.map((k) => ({ node: n(`OUT${k}`), hi: vs, lo: gnd, rout: 0.8, dropHi: 1.4, dropLo: 1.2 }));
      const chip = e.add(
        new LogicChip(
          ref,
          ins,
          outs,
          vss,
          gnd,
          (inp) => chans.map((k, i) => ((k <= 2 ? inp[0] : inp[1]) ? (inp[2 + i] ? 1 : 0) : 2) as LogicLevel),
          null,
          0.3,
          0.5,
          true,
          comp.id,
          { ins: [padNo('EN12', 'EN1') ?? '', padNo('EN34', 'EN2') ?? '', ...chans.map((k) => padNo(`IN${k}`) ?? '')], outs: chans.map((k) => padNo(`OUT${k}`) ?? '') },
        ),
      );
      // Встроенные диоды (у L293D) — от выхода к питанию моторов и от земли к выходу.
      const els: AnalogElement[] = [chip];
      for (const o of outs) {
        els.push(e.add(new Diode(`${ref} диод вверх`, o.node, vs, { vf: 1.2, rd: 0.2 }, comp.id)));
        els.push(e.add(new Diode(`${ref} диод вниз`, gnd, o.node, { vf: 1.2, rd: 0.2 }, comp.id)));
      }
      els.push(e.add(new Resistor(`${ref} потребление`, vss, gnd, 5 / 0.016, comp.id, [padNo('VSS', 'VCC1') ?? '', padNo('GND') ?? ''], false)));
      return part({
        kind: 'мостовой драйвер L293D',
        knobs: [],
        elements: els,
        readings: () => chans.map((k, i) => ({ label: `OUT${k}`, value: e.volts(outs[i].node), unit: 'В' })),
      });
    }

    case 'uln': {
      const gnd = n('GND', 'E');
      const com = netOf('COM') ? n('COM') : null;
      const els: AnalogElement[] = [];
      const m: BjtModel = { type: 'npn', beta: 1000, vbe: 1.3, rbe: 300, vcesat: 0.9, rsat: 1 };
      for (let k = 1; k <= 8; k++) {
        if (!pads.has(`IN${k}`) || !netOf(`OUT${k}`)) continue;
        const b = e.node(`${ref}:B${k}`);
        els.push(e.add(new Resistor(`${ref} вход ${k}`, n(`IN${k}`), b, 2700, comp.id, [padNo(`IN${k}`)!, ''], false)));
        els.push(e.add(new Bjt(`${ref} ключ ${k}`, n(`OUT${k}`), b, gnd, { ...m }, comp.id, [padNo(`OUT${k}`)!, '', padNo('GND', 'E') ?? ''])));
        if (com !== null) els.push(e.add(new Diode(`${ref} диод ${k}`, n(`OUT${k}`), com, { vf: 1.0, rd: 0.3 }, comp.id)));
      }
      if (!els.length) return null;
      return part({ kind: 'ключи Дарлингтона', knobs: [], elements: els, readings: () => [] });
    }

    case 'opto':
    case 'opto-triac':
    case 'opto-logic': {
      const led = e.add(new Diode(`${ref} светодиод`, n('A'), n('K'), { vf: kind === 'opto-logic' ? 1.4 : 1.2, rd: 5 }, comp.id, [padNo('A')!, padNo('K')!]));
      const iled = () => Math.max(0, led.current(e.x));
      if (kind === 'opto') {
        const ctr = /4N2[56]|4N3[3]/i.test(comp.value) ? 0.2 : /4N3[5-7]/i.test(comp.value) ? 0.5 : 1;
        const q = e.add(new OptoTransistor(`${ref} транзистор`, led, n('C'), n('E'), ctr, 0.2, 20, comp.id, [padNo('C')!, padNo('E')!]));
        ctx.feed(q.c);
        return part({
          kind: 'оптрон',
          knobs: [knob('ctr', 'коэффициент передачи', ctr * 100, '%', 5, 600, (x) => (q.ctr = x / 100), { log: true })],
          elements: [led, q],
          readings: () => [
            { label: 'ток светодиода', value: iled(), unit: 'А' },
            { label: 'ток коллектора', value: q.currents(e.x)[0], unit: 'А' },
            { label: 'режим', value: q.st, unit: ['закрыт', 'усиление', 'насыщение'][q.st] },
          ],
        });
      }
      if (kind === 'opto-triac') {
        const zc = /MOC30[4-8]\d/i.test(comp.value);
        // Ток включения — типовой (по даташиту наибольший вдвое выше): x0 — 15 мА, x1 — 10, x2 — 6, x3 — 3 мА.
        const grade = /MOC30[2-8](\d)/i.exec(comp.value)?.[1];
        let ift = grade === '0' ? 0.015 : grade === '2' ? 0.006 : grade === '3' ? 0.003 : 0.01;
        const a = n('MT2');
        const k = n('MT1');
        const th = e.add(new Thyristor(`${ref} симистор`, a, k, null, true, 1, 1e-4, (x) => Math.max(0, led.current(x)) > ift && (!zc || Math.abs(v(x, a) - v(x, k)) < 20), 1, 100, comp.id, [padNo('MT2')!, padNo('MT1')!]));
        return part({
          kind: zc ? 'оптосимистор (переход через ноль)' : 'оптосимистор',
          knobs: [knob('ift', 'ток включения светодиода', ift, 'А', 0.001, 0.05, (x) => (ift = x), { log: true })],
          elements: [led, th],
          readings: () => [
            { label: 'ток светодиода', value: iled(), unit: 'А' },
            { label: 'симистор', value: th.on ? 1 : 0, unit: th.on ? 'открыт' : 'закрыт' },
          ],
        });
      }
      const vo = n('VO');
      const sw = e.add(new CondSwitch(`${ref} выход`, vo, n('GND'), (x, closed) => Math.max(0, led.current(x)) > (closed ? 0.003 : 0.005), 20, comp.id, [padNo('VO')!, padNo('GND') ?? '']));
      ctx.feed(vo);
      const load = e.add(new Resistor(`${ref} потребление`, n('VCC'), n('GND'), 5 / 0.01, comp.id, [padNo('VCC')!, padNo('GND') ?? ''], false));
      return part({
        kind: 'быстрый оптрон',
        knobs: [],
        elements: [led, sw, load],
        readings: () => [
          { label: 'ток светодиода', value: iled(), unit: 'А' },
          { label: 'выход', value: sw.closed ? 0 : 1, unit: sw.closed ? '«0»' : 'отпущен' },
        ],
      });
    }

    case 'relay': {
      const coilPads = numbered.filter((q) => /^COIL|^A[12]$|^\+$|^-$/i.test(q.name ?? '')).map((q) => q.number);
      if (coilPads.length < 2 || !pads.has('COM')) return null;
      const vcoil = parseVolts(comp.value) ?? (/(\d{2})V?DC/i.exec(comp.value) ? +/(\d{2})V?DC/i.exec(comp.value)![1] : 5);
      let rcoil = (vcoil * vcoil) / 0.36;
      const c1 = ctx.node(comp.padNets[coilPads[0]], `${ref}.катушка`);
      const c2 = ctx.node(comp.padNets[coilPads[1]], `${ref}.катушка`);
      const mid = e.node(`${ref}:катушка`);
      const rc = e.add(new Resistor(`${ref} катушка`, c1, mid, rcoil, comp.id, [coilPads[0], ''], false));
      const lc = e.add(new Inductor(`${ref} индуктивность катушки`, mid, c2, rcoil * 0.004, comp.id, ['', coilPads[1]]));
      // Ёмкость витков: выброс при размыкании — затухающий звон, а не скачок за один шаг.
      const cc = e.add(new Capacitor(`${ref} ёмкость катушки`, c1, c2, 100e-12, comp.id));
      const inom = () => vcoil / rc.ohms;
      // Срабатывает при 75 % номинального тока катушки, отпускает при 30 %.
      const on = (closed: boolean) => Math.abs(lc.i) > (closed ? 0.3 : 0.75) * inom();
      const com = n('COM');
      const els: AnalogElement[] = [rc, lc, cc];
      let no: CondSwitch | null = null;
      if (netOf('NO')) els.push((no = e.add(new CondSwitch(`${ref} COM–NO`, com, n('NO'), (_x, closed) => on(closed), 0.03, comp.id, [padNo('COM')!, padNo('NO')!]))));
      if (netOf('NC')) {
        const nc = e.add(new CondSwitch(`${ref} COM–NC`, com, n('NC'), (_x, closed) => !on(!closed), 0.03, comp.id, [padNo('COM')!, padNo('NC')!]));
        nc.closed = true;
        els.push(nc);
      }
      const engaged = () => Math.abs(lc.i) > 0.5 * inom();
      return part({
        kind: 'реле',
        knobs: [knob('vcoil', 'напряжение катушки', vcoil, 'В', 3, 48, (x) => (rc.ohms = rcoil = (x * x) / 0.36)), knob('rcoil', 'сопротивление катушки', rcoil, 'Ом', 10, 5000, (x) => ((rc.ohms = rcoil = x), (lc.henry = x * 0.004)), { log: true })],
        elements: els,
        readings: () => [
          { label: 'ток катушки', value: lc.i, unit: 'А' },
          { label: 'контакты', value: engaged() ? 1 : 0, unit: engaged() ? 'COM—NO замкнуты' : 'COM—NC замкнуты' },
        ],
        ui: { kind: 'relay', channels: () => [no ? no.closed : engaged()] },
      });
    }

    case 'transformer': {
      const { vp, vs } = transformerVolts(`${comp.value} ${comp.description ?? ''}`);
      const va = parseWatts(comp.value) ?? 2;
      const p1 = n('P1');
      const p2 = n('P2');
      const s1 = n('S1');
      const s2 = n('S2');
      // Холостой ход у маленьких трансформаторов выше номинала (≈ 15 %): так и витки.
      const vsOpen = vs * 1.15;
      const lp = (vp * vp) / (2 * Math.PI * 50 * 0.2 * va);
      const ls = lp * (vsOpen / vp) ** 2;
      const mp = e.node(`${ref}:первичная`);
      const ms = e.node(`${ref}:вторичная`);
      const rp = e.add(new Resistor(`${ref} первичная`, p1, mp, (0.07 * vp * vp) / va, comp.id, [padNo('P1')!, ''], false));
      const rs = e.add(new Resistor(`${ref} вторичная`, s1, ms, (0.07 * vs * vs) / va, comp.id, [padNo('S1')!, ''], false));
      const tr = e.add(
        new CoupledCoils(
          ref,
          [
            { a: mp, b: p2, henry: lp, name: 'первичная' },
            { a: ms, b: s2, henry: ls, name: 'вторичная' },
          ],
          [[1, 0.998]],
          comp.id,
        ),
      );
      tr.pins[1].pad = padNo('P2');
      tr.pins[3].pad = padNo('S2');
      return part({
        kind: `трансформатор ${vp}/${vs} В`,
        knobs: [],
        elements: [rp, rs, tr],
        readings: () => [
          { label: 'первичная', value: e.volts(p1) - e.volts(p2), unit: 'В' },
          { label: 'вторичная', value: e.volts(s1) - e.volts(s2), unit: 'В' },
          { label: 'ток вторичной', value: tr.i[1], unit: 'А' },
        ],
      });
    }

    case 'battery':
    case 'source': {
      const plus = pin(0, '+', 'BAT+', 'VIN', 'V+', 'VCC', '+V', 'IN+');
      const minus = pin(1, '-', '−', 'BAT-', 'GND', 'V-', '-V', 'IN-');
      if (!comp.padNets[plus.pad]) return null;
      const netName = ctx.netName(comp.padNets[plus.pad]);
      const volts = parseVolts(comp.value) ?? (netName && /\d/.test(netName) ? powerVoltsOf(netName) : 12);
      if (kind === 'battery') {
        const src = e.add(new VSource(ref, plus.node, minus.node, volts, 0.08, comp.id, [plus.pad, minus.pad]));
        return part({
          kind: 'аккумулятор',
          knobs: [knob('volts', 'напряжение', volts, 'В', 0.5, 60, (x) => (src.volts = x)), knob('rint', 'внутреннее сопротивление', 0.08, 'Ом', 0.005, 5, (x) => (src.ohms = x), { log: true })],
          elements: [src],
          readings: () => [
            { label: 'напряжение', value: e.volts(src.p) - e.volts(src.n), unit: 'В' },
            { label: 'ток', value: -src.currents(e.x)[0], unit: 'А' },
          ],
        });
      }
      const s = e.add(new LabSupply(ref, plus.node, minus.node, volts, 3, 0.01, comp.id, [plus.pad, minus.pad]));
      return part({
        kind: 'источник питания',
        knobs: [knob('volts', 'напряжение', volts, 'В', 0, 60, (x) => (s.volts = x)), knob('ilim', 'ограничение тока', 3, 'А', 0.01, 30, (x) => (s.ilim = x), { log: true })],
        elements: [s],
        readings: () => [
          { label: 'напряжение', value: e.volts(s.p) - e.volts(s.n), unit: 'В' },
          { label: 'ток', value: s.out(e.x, e.t), unit: 'А' },
          { label: 'режим', value: s.st, unit: s.st ? 'ОГРАНИЧЕНИЕ ТОКА' : 'стабилизирует напряжение' },
        ],
      });
    }

    case 'speaker':
    case 'buzzer': {
      const t = two();
      if (!t) return null;
      const active = kind === 'buzzer' && (/актив|active|TMB|12x9\.5/i.test(text) || has('active'));
      const ohms = parseOhms(comp.value.replace(/.*?(\d+(?:[.,]\d+)?\s*Ом).*/i, '$1')) ?? (kind === 'speaker' ? 8 : active ? 170 : 40);
      const mid = e.node(`${ref}:катушка`);
      const r = e.add(new Resistor(ref, t[0].node, mid, ohms, comp.id, [t[0].pad, ''], false));
      const l = e.add(new Inductor(`${ref} индуктивность`, mid, t[1].node, kind === 'speaker' ? 60e-6 : 1e-3, comp.id, ['', t[1].pad]));
      const rms = { mean: 0 };
      const hz = ctx.frequency(() => l.i - rms.mean);
      const pow = ctx.average(() => {
        rms.mean += (l.i - rms.mean) * 0.001;
        return l.i * l.i;
      });
      return part({
        kind: active ? 'зуммер активный' : kind === 'speaker' ? 'динамик' : 'зуммер',
        knobs: [nomKnob('r', 'сопротивление', ohms, 'Ом', (x) => (r.ohms = x))],
        elements: [r, l],
        readings: () => [{ label: 'ток', value: l.i, unit: 'А' }],
        ui: {
          kind: 'buzzer',
          on: () => (active ? Math.sqrt(pow()) > 0.005 : Math.sqrt(Math.max(0, pow() - rms.mean * rms.mean)) > 0.002),
          hz: () => (active ? 2300 : Math.round(hz())),
        },
      });
    }

    case 'motor': {
      const t = two();
      if (!t) return null;
      const m: MotorModel = { ...MOTOR_DEFAULT };
      const volts = parseVolts(comp.value);
      if (volts && volts > 20) {
        m.r = 4;
        m.k = 0.03;
      }
      const mot: DcMotor = buildMotor(e, ref, t[0].node, t[1].node, m, comp.id, [t[0].pad, t[1].pad]);
      const [rArm, lArm] = e.elements.slice(-3) as [Resistor, Inductor, DcMotor];
      return part({
        kind: 'двигатель',
        knobs: [
          knob('r', 'сопротивление якоря', m.r, 'Ом', 0.05, 50, (x) => (rArm.ohms = m.r = x), { log: true }),
          knob('l', 'индуктивность якоря', m.l * 1e3, 'мГн', 0.01, 50, (x) => (lArm.henry = m.l = x * 1e-3), { log: true }),
          knob('k', 'постоянная ЭДС', m.k * 1000, 'мВ·с/рад', 1, 500, (x) => (m.k = x / 1000), { log: true }),
          knob('j', 'инерция', m.j * 1e7, 'г·см²', 0.1, 10000, (x) => (m.j = x * 1e-7), { log: true }),
          knob('load', 'момент нагрузки', m.load * 1000, 'мН·м', 0, 200, (x) => (m.load = x / 1000)),
        ],
        elements: e.elements.slice(-3),
        readings: () => [
          { label: 'обороты', value: mot.rpm, unit: 'об/мин' },
          { label: 'ток', value: mot.ind.i, unit: 'А' },
          { label: 'момент', value: m.k * mot.ind.i * 1000, unit: 'мН·м' },
        ],
        ui: { kind: 'motor', knobs: ['load'], title: () => `${ref} двигатель: ${Math.round(mot.rpm)} об/мин, ${fmtSi(mot.ind.i, 'А')}` },
      });
    }

    case 'button':
    case 'microswitch':
    case 'switch':
    case 'switch-spdt':
    case 'dipswitch':
      return buildSwitch(ctx, kind, comp, fp, part);

    case 'current-sensor': {
      // ACS712 в SOIC-8: 1–2 IP+, 3–4 IP−, 5 GND, 6 FILTER, 7 VIOUT, 8 VCC.
      const net = (no: string) => comp.padNets[no];
      if (!net('1') || !net('3') || !net('7')) return null;
      const ip = ctx.node(net('1'), `${ref}.IP+`);
      const im = ctx.node(net('3'), `${ref}.IP-`);
      const gnd = ctx.node(net('5'), `${ref}.GND`);
      const vcc = ctx.node(net('8'), `${ref}.VCC`);
      const rs = e.add(new Resistor(`${ref} шунт`, ip, im, 0.0012, comp.id, ['1', '3'], false));
      let sens = /30\s*A|30B/i.test(comp.value) ? 0.066 : /20\s*A|20A/i.test(comp.value) ? 0.1 : 0.185;
      const out = e.add(new DrivenOut(`${ref} выход`, ctx.node(net('7'), `${ref}.VIOUT`), (x) => (v(x, vcc) + v(x, gnd)) / 2 + (sens * (v(x, ip) - v(x, im))) / 0.0012, 10, comp.id, '7'));
      const load = e.add(new Resistor(`${ref} потребление`, vcc, gnd, 5 / 0.01, comp.id, ['8', '5'], false));
      return part({
        kind: 'датчик тока ACS712',
        knobs: [knob('sens', 'чувствительность', sens * 1000, 'мВ/А', 10, 400, (x) => (sens = x / 1000))],
        elements: [rs, out, load],
        readings: () => [
          { label: 'ток', value: rs.currents(e.x)[0], unit: 'А' },
          { label: 'выход', value: e.volts(out.node), unit: 'В' },
        ],
      });
    }

    case 'hall': {
      const outNode = n('OUT', 'VOUT');
      const vcc = n('VCC', 'VDD', 'VS');
      const gnd = n('GND');
      // Сначала номинал, потом id корпуса (теги корпуса упоминают оба вида — по ним не решаем).
      const analogRe = /49E|SS49|A1302|A1324|DRV5053|линейн/i;
      const digital = /3144|A314[1-3]|US1881|OH137|SS44[13]|DRV5023|цифров/i.test(comp.value) || (!analogRe.test(comp.value) && !analogRe.test(fp.id));
      const knobs = [knob('field', 'поле', 0, 'мТл', -100, 100, () => {})];
      const els: AnalogElement[] = [];
      if (digital) els.push(e.add(new CondSwitch(`${ref} выход`, outNode, gnd, (_x, closed) => knobs[0].value > (closed ? 5 : 15), 20, comp.id, [padNo('OUT', 'VOUT')!, padNo('GND') ?? ''])));
      else els.push(e.add(new DrivenOut(`${ref} выход`, outNode, (x) => (v(x, vcc) + v(x, gnd)) / 2 + 0.014 * knobs[0].value, 30, comp.id, padNo('OUT', 'VOUT'))));
      if (netOf('VCC', 'VDD', 'VS')) els.push(e.add(new Resistor(`${ref} потребление`, vcc, gnd, 5 / 0.005, comp.id, [padNo('VCC', 'VDD', 'VS')!, padNo('GND') ?? ''], false)));
      ctx.feed(outNode);
      return part({
        kind: digital ? 'датчик Холла (цифровой)' : 'датчик Холла (аналоговый)',
        knobs,
        elements: els,
        readings: () => [{ label: 'выход', value: e.volts(outNode), unit: 'В' }],
        ui: { kind: 'sensor', knobs: ['field'], title: () => `${ref} датчик Холла: ${Math.round(knobs[0].value)} мТл` },
      });
    }

    case 'temp-sensor': {
      const outNode = n('OUT', 'VOUT');
      const gnd = n('GND');
      const tmp36 = /TMP36/i.test(comp.value);
      const knobs = [knob('temp', 'температура', 25, '°C', -40, 150, () => {})];
      const out = e.add(new DrivenOut(`${ref} выход`, outNode, (x) => v(x, gnd) + (tmp36 ? 0.5 : 0) + 0.01 * knobs[0].value, 1, comp.id, padNo('OUT', 'VOUT')));
      return part({
        kind: tmp36 ? 'датчик температуры TMP36' : 'датчик температуры LM35',
        knobs,
        elements: [out],
        readings: () => [{ label: 'выход', value: e.volts(outNode), unit: 'В' }],
        ui: { kind: 'sensor', knobs: ['temp'], title: () => `${ref} датчик температуры: ${Math.round(knobs[0].value)} °C` },
      });
    }

    case 'lcd': {
      const els: AnalogElement[] = [];
      if (netOf('A') && netOf('K')) els.push(e.add(new Diode(`${ref} подсветка`, n('A'), n('K'), { vf: 3.0, rd: 25, led: '#9fe870' }, comp.id, [padNo('A')!, padNo('K')!])));
      if (netOf('VDD') && netOf('VSS')) els.push(e.add(new Resistor(`${ref} потребление`, n('VDD'), n('VSS'), 5 / 0.0015, comp.id, [padNo('VDD')!, padNo('VSS')!], false)));
      if (!els.length) return null;
      return part({ kind: 'ЖК-модуль', knobs: [], elements: els, readings: () => (els[0] instanceof Diode ? [{ label: 'ток подсветки', value: els[0].current(e.x), unit: 'А' }] : []) });
    }

    case 'ic-load': {
      const vcc = netOf('VDD', 'VCC', '5V', '3V3', 'V+', 'VIN', '+5V');
      const gnd = netOf('GND', 'VSS');
      if (!vcc || !gnd) return null;
      const ma = comp.sim?.params?.ma ?? 1;
      const r = e.add(new Resistor(`${ref} потребление`, n('VDD', 'VCC', '5V', '3V3', 'V+', 'VIN', '+5V'), n('GND', 'VSS'), 5 / (ma / 1000), comp.id, [padNo('VDD', 'VCC', '5V', '3V3', 'V+', 'VIN', '+5V')!, padNo('GND', 'VSS')!], false));
      return part({ kind: 'микросхема (потребление)', knobs: [knob('ma', 'потребление', ma, 'мА', 0.01, 500, (x) => (r.ohms = 5 / (x / 1000)), { log: true })], elements: [r], readings: () => [{ label: 'ток', value: r.currents(e.x)[0], unit: 'А' }] });
    }

    case 'none':
      return null;
  }
  return null;
}

type PartFn = (p: Omit<AnalogPart, 'set' | 'params' | 'sim' | 'comp'> & { knobs: Knob[] }) => AnalogPart;

/* ---------------- кнопки и переключатели ---------------- */

function buildSwitch(ctx: BuildCtx, kind: SimKind, comp: Component, fp: FootprintDef, part: PartFn): AnalogPart | null {
  const e = ctx.e;
  const ref = comp.ref;
  const numbered = fp.pads.filter((q) => q.type !== 'npth' && !/^MP/i.test(q.name ?? q.number));
  const pads = padsByName(fp);
  const nodeOf = (pad: string | undefined) => ctx.node(pad ? comp.padNets[pad] : undefined, `${ref}.${pad ?? '?'}`);
  const els: AnalogElement[] = [];
  const toggle = kind !== 'button' && kind !== 'microswitch';

  if (kind === 'dipswitch') {
    const k = Math.floor(numbered.length / 2);
    const sws: Switch[] = [];
    const knobs: Knob[] = [];
    for (let i = 0; i < k; i++) {
      const a = numbered[i].number;
      const b = numbered[numbered.length - 1 - i].number;
      if (!comp.padNets[a] && !comp.padNets[b]) continue;
      const sw = e.add(new Switch(`${ref} ${i + 1}`, nodeOf(a), nodeOf(b), false, 0.05, comp.id, [a, b]));
      sws.push(sw);
      knobs.push({ key: `sw${i + 1}`, label: `переключатель ${i + 1}`, value: 0, unit: '', min: 0, max: 1, options: ['выкл', 'вкл'], apply: (x) => ((sw.closed = x >= 0.5), ctx.kick()) });
    }
    if (!sws.length) return null;
    return part({ kind: 'DIP-переключатель', knobs, elements: sws, readings: () => sws.map((s, i) => ({ label: `${i + 1}`, value: s.closed ? 1 : 0, unit: s.closed ? 'вкл' : 'выкл' })), ui: { kind: 'sensor', knobs: knobs.map((q) => q.key) } });
  }

  if (kind === 'microswitch' && pads.has('COM')) {
    const com = nodeOf(pads.get('COM')![0]);
    const no = pads.has('NO') ? e.add(new Switch(`${ref} COM–NO`, com, nodeOf(pads.get('NO')![0]), false, 0.03, comp.id, [pads.get('COM')![0], pads.get('NO')![0]])) : null;
    const nc = pads.has('NC') ? e.add(new Switch(`${ref} COM–NC`, com, nodeOf(pads.get('NC')![0]), true, 0.03, comp.id, [pads.get('COM')![0], pads.get('NC')![0]])) : null;
    let down = false;
    const press = (d: boolean) => {
      ctx.sync();
      down = d;
      if (no) no.closed = d;
      if (nc) nc.closed = !d;
      ctx.kick();
    };
    return part({ kind: 'микропереключатель', knobs: [], elements: [no, nc].filter((x): x is Switch => !!x), readings: () => [{ label: 'нажат', value: down ? 1 : 0, unit: down ? 'нажат' : 'отпущен' }], ui: { kind: 'button', pressed: () => down, press } });
  }

  if (kind === 'switch-spdt' && numbered.length >= 3) {
    // Общий — средний вывод каждой тройки (SS12D00, MTS-102, SS22D07 — две тройки).
    const groups: string[][] = [];
    for (let i = 0; i + 2 < numbered.length; i += 3) groups.push(numbered.slice(i, i + 3).map((q) => q.number));
    const pairs: [Switch, Switch][] = [];
    for (const [a, c, b] of groups) {
      if (!comp.padNets[c]) continue;
      const s1 = e.add(new Switch(`${ref} ${c}–${a}`, nodeOf(c), nodeOf(a), true, 0.03, comp.id, [c, a]));
      const s2 = e.add(new Switch(`${ref} ${c}–${b}`, nodeOf(c), nodeOf(b), false, 0.03, comp.id, [c, b]));
      pairs.push([s1, s2]);
      els.push(s1, s2);
    }
    if (!pairs.length) return null;
    const knobs: Knob[] = [];
    const apply = (x: number) => {
      for (const [s1, s2] of pairs) {
        s1.closed = x < 0.5;
        s2.closed = x >= 0.5;
      }
      ctx.kick();
    };
    knobs.push({ key: 'pos', label: 'положение', value: 0, unit: '', min: 0, max: 1, options: [`${groups[0][1]}–${groups[0][0]}`, `${groups[0][1]}–${groups[0][2]}`], apply });
    const p = part({ kind: 'переключатель', knobs, elements: els, readings: () => [{ label: 'положение', value: knobs[0].value, unit: knobs[0].options![Math.round(knobs[0].value)] }] });
    p.ui = { kind: 'button', toggle: true, pressed: () => knobs[0].value >= 0.5, press: (d) => d && p.set('pos', knobs[0].value >= 0.5 ? 0 : 1) };
    return p;
  }

  // Кнопка или выключатель: замыкает стороны. У 4-выводной тактовой пары 1–2 и 3–4 соединены внутри.
  const nets = numbered.map((q) => q.number).filter((no) => comp.padNets[no]);
  if (nets.length < 2) return null;
  let sideA = [numbered[0]?.number];
  let sideB = numbered.slice(1).map((q) => q.number);
  if (numbered.length === 4) {
    sideA = [numbered[0].number, numbered[1].number];
    sideB = [numbered[2].number, numbered[3].number];
    for (const side of [sideA, sideB])
      if (comp.padNets[side[0]] && comp.padNets[side[1]] && comp.padNets[side[0]] !== comp.padNets[side[1]]) els.push(e.add(new Resistor(`${ref} внутри`, nodeOf(side[0]), nodeOf(side[1]), 0.005, comp.id, [side[0], side[1]], false)));
  }
  const a = sideA.find((x) => x && comp.padNets[x]) ?? sideA[0];
  const bs = sideB.filter((x) => comp.padNets[x] && comp.padNets[x] !== comp.padNets[a!]);
  if (!a || !bs.length) return null;
  const sws = [...new Set(bs.map((b) => comp.padNets[b]))].map((net) => {
    const b = bs.find((x) => comp.padNets[x] === net)!;
    return e.add(new Switch(ref, nodeOf(a), nodeOf(b), false, 0.05, comp.id, [a, b]));
  });
  els.push(...sws);
  const press = (d: boolean) => {
    ctx.sync();
    const next = toggle ? (d ? !sws[0].closed : sws[0].closed) : d;
    for (const s of sws) s.closed = next;
    ctx.kick();
    if (toggle && knobs[0]) knobs[0].value = next ? 1 : 0;
  };
  const knobs: Knob[] = toggle ? [{ key: 'on', label: 'включён', value: 0, unit: '', min: 0, max: 1, options: ['выкл', 'вкл'], apply: (x) => ((sws.forEach((s) => (s.closed = x >= 0.5)), ctx.kick())) }] : [];
  return part({
    kind: toggle ? 'выключатель' : 'кнопка',
    knobs,
    elements: els,
    readings: () => [{ label: 'контакты', value: sws[0].closed ? 1 : 0, unit: sws[0].closed ? 'замкнуты' : 'разомкнуты' }],
    ui: { kind: 'button', toggle, pressed: () => sws[0].closed, press },
  });
}

/* ---------------- логика ---------------- */

function buildLogic(ctx: BuildCtx, comp: Component, fp: FootprintDef, part: PartFn): AnalogPart | null {
  const e = ctx.e;
  const ref = comp.ref;
  const pads = padsByName(fp);
  const padNo = (x: string) => pads.get(up(x))?.[0];
  const n = (x: string) => ctx.node(padNo(x) ? comp.padNets[padNo(x)!] : undefined, `${ref}.${x}`);
  // Тип — по номеру микросхемы в номинале или id корпуса (не по тегам: «DIP-14» — не 74HC14).
  const id = `${comp.value} ${fp.id.replace(/_/g, ' ')}`.toUpperCase();
  const vcc = n(pads.has('VCC') ? 'VCC' : 'VDD');
  const gnd = n(pads.has('GND') ? 'GND' : 'VSS');
  const cmos40 = /CD40|40106|4017|К561|К176/.test(id);
  const rout = cmos40 ? 300 : 50;
  const out = (x: string): LogicOut => ({ node: n(x), hi: vcc, lo: gnd, rout });
  const connected = (x: string) => !!(padNo(x) && comp.padNets[padNo(x)!]);
  let chip: LogicChip | null = null;
  let what = '';

  if (pads.has('Q0') && pads.has('CLK')) {
    // CD4017: десятичный счётчик, по фронту CLK при CE = 0; RST = 1 — в ноль.
    const qs = Array.from({ length: 10 }, (_, i) => `Q${i}`).filter((x) => pads.has(x));
    const outsN = [...qs, ...(pads.has('CO') ? ['CO'] : [])];
    chip = new LogicChip(
      ref,
      [n('CLK'), n('CE'), n('RST')],
      outsN.map(out),
      vcc,
      gnd,
      (_inp, mem) => outsN.map((x) => (x === 'CO' ? (mem[0] < 5 ? 1 : 0) : +x.slice(1) === mem[0] ? 1 : 0) as LogicLevel),
      (prev, now, mem) => {
        if (now[2]) mem[0] = 0;
        else if (!prev[0] && now[0] && !now[1]) mem[0] = (mem[0] + 1) % 10;
      },
      0.3,
      0.7,
      false,
      comp.id,
      { ins: [padNo('CLK')!, padNo('CE') ?? '', padNo('RST') ?? ''], outs: outsN.map((x) => padNo(x) ?? '') },
    );
    what = 'счётчик CD4017';
  } else if (pads.has('DS') && pads.has('SHCP')) {
    // 74HC595: сдвиг по фронту SHCP, защёлка по фронту STCP, OE = 1 — выходы отключены, MR = 0 — сброс.
    const qn = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'];
    const outsN = [...qn, "QH'"].filter((x) => pads.has(x));
    chip = new LogicChip(
      ref,
      [n('DS'), n('SHCP'), n('STCP'), n('OE'), n('MR')],
      outsN.map(out),
      vcc,
      gnd,
      (inp, mem) => outsN.map((x) => (x === "QH'" ? ((mem[0] >> 7) & 1) : inp[3] ? 2 : (mem[1] >> qn.indexOf(x)) & 1) as LogicLevel),
      (prev, now, mem) => {
        if (!now[4] && pads.has('MR') && connected('MR')) mem[0] = 0;
        else if (!prev[1] && now[1]) mem[0] = ((mem[0] << 1) | (now[0] ? 1 : 0)) & 0xff;
        if (!prev[2] && now[2]) mem[1] = mem[0];
      },
      0.3,
      0.7,
      false,
      comp.id,
      { ins: ['DS', 'SHCP', 'STCP', 'OE', 'MR'].map((x) => padNo(x) ?? ''), outs: outsN.map((x) => padNo(x) ?? '') },
    );
    what = 'сдвиговый регистр 74HC595';
  } else {
    // Вентили: nA, nB → nY. Функция — по номиналу.
    const inv = pads.has('1A') && !pads.has('1B');
    const schmitt = /74[A-Z]*(14|132)\b|40106|4093|ЛН2|ТЛ2/.test(id);
    const op: (a: boolean, b: boolean) => boolean = inv
      ? (a) => !a
      : /74[A-Z]*02\b|4001|ЛЕ5/.test(id)
        ? (a, b) => !(a || b)
        : /74[A-Z]*08\b|4081|ЛИ1/.test(id)
          ? (a, b) => a && b
          : /74[A-Z]*32\b|4071|ЛЛ1/.test(id)
            ? (a, b) => a || b
            : /74[A-Z]*86\b|4070|ЛП5/.test(id)
              ? (a, b) => a !== b
              : (a, b) => !(a && b);
    const gates: { a: string; b?: string; y: string }[] = [];
    for (let k = 1; k <= 6; k++) {
      if (!pads.has(`${k}Y`)) continue;
      if (!connected(`${k}Y`) && !connected(`${k}A`)) continue;
      gates.push({ a: `${k}A`, b: inv ? undefined : `${k}B`, y: `${k}Y` });
    }
    if (!gates.length) return null;
    const insN = gates.flatMap((g) => (g.b ? [g.a, g.b] : [g.a]));
    chip = new LogicChip(
      ref,
      insN.map(n),
      gates.map((g) => out(g.y)),
      vcc,
      gnd,
      (inp) => gates.map((_g, i) => (inv ? (op(inp[i], false) ? 1 : 0) : op(inp[2 * i], inp[2 * i + 1]) ? 1 : 0) as LogicLevel),
      null,
      schmitt ? 0.36 : 0.45,
      schmitt ? 0.62 : 0.55,
      false,
      comp.id,
      { ins: insN.map((x) => padNo(x) ?? ''), outs: gates.map((g) => padNo(g.y) ?? '') },
    );
    what = inv ? (schmitt ? 'инверторы с триггером Шмитта' : 'инверторы') : 'логические вентили';
  }
  e.add(chip);
  for (const o of chip.outs) ctx.feed(o.node);
  const c = chip;
  return part({
    kind: what,
    knobs: [],
    elements: [c],
    readings: () => c.outs.map((o, i) => ({ label: c.pins[c.ins.length + i].pad ? `выход ${fp.pads.find((q) => q.number === c.pins[c.ins.length + i].pad)?.name ?? ''}` : `выход ${i + 1}`, value: e.volts(o.node), unit: 'В' })),
  });
}
