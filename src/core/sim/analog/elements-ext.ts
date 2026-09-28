import type { Diode } from './elements';
import { type AnalogElement, type Node, type RhsStamper, type StepCtx, type Stamper, volt as v } from './engine';

/*
 * Ещё модели для схем без контроллера и силовой части: блок питания с ограничением тока,
 * ключ по условию (контакты реле, выход датчика Холла, 6N137), оптрон с транзистором,
 * тиристор и симистор, логика (74HC, CD40), DC-DC, предохранитель, выход «по формуле»
 * (датчики тока и температуры). Как и остальные — кусочно-линейные: состояние выбирается
 * в check, в каждом состоянии элемент линейный.
 */

const GOFF = 1e-9;

/* ---------------- блок питания: стабилизация напряжения или тока ---------------- */

/** Лабораторный блок питания: напряжение с ограничением тока (CV/CC), как у настоящего. */
export class LabSupply implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  /** 0 — стабилизирует напряжение, 1 — упёрся в ограничение тока. */
  st = 0;
  constructor(
    public name: string,
    public p: Node,
    public n: Node,
    public volts: number | ((t: number) => number),
    public ilim = 3,
    public ohms = 0.01,
    public comp?: string,
    pads?: [string, string],
  ) {
    this.pins = [
      { node: p, pad: pads?.[0] },
      { node: n, pad: pads?.[1] },
    ];
  }
  private u(t: number): number {
    return typeof this.volts === 'number' ? this.volts : this.volts(t);
  }
  state(): number {
    return this.st;
  }
  stamp(s: Stamper): void {
    s.cond(this.p, this.n, this.st === 0 ? 1 / this.ohms : GOFF);
  }
  rhs(r: RhsStamper, ctx: StepCtx): void {
    if (this.st === 0) r.source(this.n, this.p, this.u(ctx.t) / this.ohms);
    else r.source(this.n, this.p, Math.sign(this.u(ctx.t)) * this.ilim);
  }
  /** Ток, который источник отдаёт в «плюс», А. */
  out(x: Float64Array, t: number): number {
    if (this.st === 1) return Math.sign(this.u(t)) * this.ilim;
    return (this.u(t) - (v(x, this.p) - v(x, this.n))) / this.ohms;
  }
  check(x: Float64Array, ctx: StepCtx): boolean {
    const old = this.st;
    const u = this.u(ctx.t);
    if (this.st === 0 && Math.abs(this.out(x, ctx.t)) > this.ilim) this.st = 1;
    else if (this.st === 1 && Math.abs(v(x, this.p) - v(x, this.n)) > Math.abs(u)) this.st = 0;
    return this.st !== old;
  }
  lastT = 0;
  commit(_x: Float64Array, ctx: StepCtx): void {
    this.lastT = ctx.t;
  }
  currents(x: Float64Array): number[] {
    const i = this.out(x, this.lastT);
    return [-i, i];
  }
}

/* ---------------- ключ по условию ---------------- */

/**
 * Ключ, который замкнут, пока выполняется условие (want). Условие читает решение шага или
 * состояние других элементов (ток катушки реле с прошлого шага) — с гистерезисом внутри.
 */
export class CondSwitch implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  closed = false;
  constructor(
    public name: string,
    public a: Node,
    public b: Node,
    public want: (x: Float64Array, closed: boolean) => boolean,
    public ron = 0.02,
    public comp?: string,
    pads?: [string, string],
  ) {
    this.pins = [
      { node: a, pad: pads?.[0] },
      { node: b, pad: pads?.[1] },
    ];
  }
  state(): number {
    return this.closed ? 1 : 0;
  }
  stamp(s: Stamper): void {
    s.cond(this.a, this.b, this.closed ? 1 / this.ron : GOFF);
  }
  check(x: Float64Array): boolean {
    const w = this.want(x, this.closed);
    if (w === this.closed) return false;
    this.closed = w;
    return true;
  }
  currents(x: Float64Array): number[] {
    const i = (v(x, this.a) - v(x, this.b)) * (this.closed ? 1 / this.ron : GOFF);
    return [i, -i];
  }
}

/* ---------------- оптрон с транзистором ---------------- */

/** Фототранзистор оптрона: ток коллектора = CTR × ток светодиода, с насыщением. */
export class OptoTransistor implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  /** 0 — закрыт, 1 — усиление, 2 — насыщение. */
  st = 0;
  constructor(
    public name: string,
    public led: Diode,
    public c: Node,
    public e: Node,
    /** Коэффициент передачи по току (1 = 100 %). */
    public ctr = 1,
    public vcesat = 0.2,
    public rsat = 20,
    public comp?: string,
    pads?: [string, string],
  ) {
    this.pins = [
      { node: c, pad: pads?.[0] },
      { node: e, pad: pads?.[1] },
    ];
  }
  state(): number {
    return this.st;
  }
  stamp(s: Stamper): void {
    const d = this.led;
    if (this.st === 1 && d.st === 1) s.vccs(this.c, this.e, d.a, d.k, this.ctr / d.m.rd);
    else if (this.st === 2) s.cond(this.c, this.e, 1 / this.rsat);
    else s.cond(this.c, this.e, GOFF);
  }
  rhs(r: RhsStamper): void {
    const d = this.led;
    if (this.st === 1 && d.st === 1) r.source(this.e, this.c, (this.ctr * d.m.vf) / d.m.rd);
    else if (this.st === 2) r.source(this.e, this.c, this.vcesat / this.rsat);
  }
  private ic(x: Float64Array): number {
    if (this.st === 1) return this.ctr * Math.max(0, this.led.current(x));
    if (this.st === 2) return (v(x, this.c) - v(x, this.e) - this.vcesat) / this.rsat;
    return 0;
  }
  check(x: Float64Array): boolean {
    const old = this.st;
    const iled = this.led.st === 1 ? this.led.current(x) : 0;
    const vce = v(x, this.c) - v(x, this.e);
    if (iled <= 1e-6) this.st = 0;
    else if (this.st === 0) this.st = vce > this.vcesat ? 1 : 2;
    else if (this.st === 1 && vce < this.vcesat) this.st = 2;
    else if (this.st === 2 && this.ic(x) > this.ctr * iled) this.st = 1;
    return this.st !== old;
  }
  currents(x: Float64Array): number[] {
    const i = this.ic(x);
    return [i, -i];
  }
}

/* ---------------- тиристор и симистор ---------------- */

/**
 * Тиристор (A→K) или симистор (в обе стороны): включается током управляющего электрода
 * (или внешним условием — оптосимистор), держится, пока ток больше тока удержания.
 */
export class Thyristor implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  on = false;
  constructor(
    public name: string,
    /** Анод (у симистора — T2/MT2). */
    public a: Node,
    /** Катод (у симистора — T1/MT1). */
    public k: Node,
    /** Управляющий электрод (null — только внешнее условие). */
    public g: Node | null,
    public bidirectional: boolean,
    public igt = 0.01,
    public ih = 0.02,
    public trigger: ((x: Float64Array) => boolean) | null = null,
    public ron = 0.05,
    public rg = 100,
    public comp?: string,
    pads?: string[],
  ) {
    this.pins = [a, k, ...(g !== null ? [g] : [])].map((node, i) => ({ node, pad: pads?.[i] }));
  }
  state(): number {
    return this.on ? 1 : 0;
  }
  stamp(s: Stamper): void {
    if (this.g !== null) s.cond(this.g, this.k, 1 / this.rg);
    s.cond(this.a, this.k, this.on ? 1 / this.ron : GOFF);
  }
  private i(x: Float64Array): number {
    return (v(x, this.a) - v(x, this.k)) * (this.on ? 1 / this.ron : GOFF);
  }
  private ig(x: Float64Array): number {
    return this.g === null ? 0 : (v(x, this.g) - v(x, this.k)) / this.rg;
  }
  check(x: Float64Array): boolean {
    const old = this.on;
    const ig = this.ig(x);
    const trig = (this.bidirectional ? Math.abs(ig) : ig) > this.igt || !!this.trigger?.(x);
    const vak = v(x, this.a) - v(x, this.k);
    if (!this.on) {
      if (trig && (this.bidirectional ? Math.abs(vak) > 0.8 : vak > 0.8)) this.on = true;
    } else if (!trig) {
      const i = this.i(x);
      if (this.bidirectional ? Math.abs(i) < this.ih : i < this.ih) this.on = false;
    }
    return this.on !== old;
  }
  currents(x: Float64Array): number[] {
    const i = this.i(x);
    const ig = this.ig(x);
    return this.g !== null ? [i, -i - ig, ig] : [i, -i];
  }
}

/* ---------------- логика ---------------- */

export interface LogicOut {
  node: Node;
  /** К какому питанию тянет «1» и «0» (у драйверов — питание моторов). */
  hi: Node;
  lo: Node;
  rout: number;
  /** Падение на ключе «1» и «0», В (L293D: 1,4 и 1,2). */
  dropHi?: number;
  dropLo?: number;
}

/** 0 — «0», 1 — «1», 2 — отключён (Z). */
export type LogicLevel = 0 | 1 | 2;

/**
 * Логическая микросхема: входы читаются по порогам от питания (с гистерезисом — как
 * у КМОП, у 74HC14 — триггер Шмитта), выходы — источники с сопротивлением. Комбинационная
 * часть считается в том же шаге (check), тактируемая — по фронтам в commit.
 * railCurrent: ток «1» берётся из вывода питания (для драйверов двигателей); иначе
 * «0» и «1» — одна матрица, а ток потребления учитывается нагрузкой питания.
 */
export class LogicChip implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  /** Уровни входов на прошлом шаге. */
  level: boolean[];
  out: LogicLevel[];
  mem: number[] = [0, 0, 0];
  constructor(
    public name: string,
    public ins: Node[],
    public outs: LogicOut[],
    public vcc: Node,
    public gnd: Node,
    public logic: (inp: boolean[], mem: number[]) => LogicLevel[],
    public clocked: ((prev: boolean[], now: boolean[], mem: number[]) => void) | null = null,
    /** Пороги входа как доля питания: ниже lo — «0», выше hi — «1», между — как было. */
    public lo = 0.45,
    public hi = 0.55,
    public railCurrent = false,
    public comp?: string,
    pads?: { ins?: string[]; outs?: string[] },
  ) {
    this.pins = [...ins.map((node, i) => ({ node, pad: pads?.ins?.[i] })), ...outs.map((o, i) => ({ node: o.node, pad: pads?.outs?.[i] }))];
    this.level = ins.map(() => false);
    this.out = outs.map(() => 2 as LogicLevel);
  }
  state(): number {
    // Отключённые выходы меняют матрицу; у railCurrent — и «0»/«1».
    let s = 0;
    for (let i = 0; i < this.out.length; i++) s = s * 3 + (this.railCurrent ? this.out[i] : this.out[i] === 2 ? 2 : 0);
    return s;
  }
  private read(x: Float64Array, base: boolean[]): boolean[] {
    const g0 = v(x, this.gnd);
    const span = Math.max(0.5, v(x, this.vcc) - g0);
    return this.ins.map((n, i) => {
      const rel = (v(x, n) - g0) / span;
      return rel > this.hi ? true : rel < this.lo ? false : base[i];
    });
  }
  stamp(s: Stamper): void {
    for (let i = 0; i < this.outs.length; i++) {
      const o = this.outs[i];
      const st = this.out[i];
      if (st === 2) {
        s.g(o.node, o.node, GOFF);
        continue;
      }
      if (this.railCurrent) s.cond(o.node, st === 1 ? o.hi : o.lo, 1 / o.rout);
      else s.g(o.node, o.node, 1 / o.rout);
    }
  }
  rhs(r: RhsStamper, _ctx: StepCtx, x: Float64Array): void {
    for (let i = 0; i < this.outs.length; i++) {
      const o = this.outs[i];
      const st = this.out[i];
      if (st === 2) continue;
      const g = 1 / o.rout;
      if (this.railCurrent) {
        // Падение на ключе: «1» ниже питания, «0» выше земли.
        if (st === 1) r.source(o.hi, o.node, -g * (o.dropHi ?? 0));
        else r.source(o.node, o.lo, -g * (o.dropLo ?? 0));
      } else r.inject(o.node, g * (st === 1 ? v(x, o.hi) - (o.dropHi ?? 0) : v(x, o.lo) + (o.dropLo ?? 0)));
    }
  }
  check(x: Float64Array): boolean {
    const want = this.logic(this.read(x, this.level), this.mem);
    let ch = false;
    for (let i = 0; i < want.length; i++)
      if (want[i] !== this.out[i]) {
        this.out[i] = want[i];
        ch = true;
      }
    return ch;
  }
  commit(x: Float64Array): void {
    const now = this.read(x, this.level);
    if (this.clocked) this.clocked(this.level, now, this.mem);
    this.level = now;
  }
  currents(x: Float64Array): number[] {
    const outI = this.outs.map((o, i) => {
      const st = this.out[i];
      if (st === 2) return 0;
      const target = st === 1 ? v(x, o.hi) - (o.dropHi ?? 0) : v(x, o.lo) + (o.dropLo ?? 0);
      return (v(x, o.node) - target) / o.rout;
    });
    return [...this.ins.map(() => 0), ...outI];
  }
}

/* ---------------- DC-DC ---------------- */

export interface DcDcModel {
  vout: number;
  /** КПД, 0…1. */
  eff: number;
  rout: number;
  /** Повышающий (MT3608): при входе выше выхода — выход ≈ вход − 0,4 В. */
  boost?: boolean;
  /** Минимальный вход, В. */
  uvlo: number;
}

/**
 * Импульсный преобразователь «в среднем»: выход стабилизирован, со входа берётся мощность
 * выхода / КПД (без пульсаций на частоте переключения). 0 — стабилизирует, 1 — входа мало
 * (понижающий) или много (повышающий): выход идёт за входом, 2 — выключен.
 */
export class DcDc implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  st = 0;
  private iinPrev = 0;
  constructor(
    public name: string,
    public vin: Node,
    public gin: Node,
    public out: Node,
    public gout: Node,
    public m: DcDcModel,
    public comp?: string,
    pads?: string[],
  ) {
    this.pins = [vin, gin, out, gout].map((node, i) => ({ node, pad: pads?.[i] }));
  }
  state(): number {
    return this.st;
  }
  stamp(s: Stamper): void {
    const g = 1 / this.m.rout;
    if (this.st === 0) s.cond(this.out, this.gout, g);
    else if (this.st === 1) s.cond(this.out, this.vin, g);
    else s.cond(this.out, this.gout, GOFF);
  }
  rhs(r: RhsStamper, _ctx: StepCtx, x: Float64Array): void {
    const g = 1 / this.m.rout;
    if (this.st === 0) {
      r.source(this.gout, this.out, g * this.m.vout);
      // Со входа — мощность выхода / КПД (по прошлому шагу).
      const iout = g * (this.m.vout - (v(x, this.out) - v(x, this.gout)));
      const pout = Math.max(0, (v(x, this.out) - v(x, this.gout)) * iout);
      const uin = Math.max(1, v(x, this.vin) - v(x, this.gin));
      this.iinPrev = pout / Math.max(0.3, this.m.eff) / uin;
      r.source(this.vin, this.gin, this.iinPrev);
    } else if (this.st === 1) r.source(this.out, this.vin, g * 0.4);
  }
  private headroom(x: Float64Array): number {
    return v(x, this.vin) - v(x, this.gin);
  }
  check(x: Float64Array): boolean {
    const old = this.st;
    const uin = this.headroom(x);
    if (uin < this.m.uvlo) this.st = 2;
    else if (this.m.boost) this.st = uin - 0.4 > this.m.vout ? 1 : 0;
    else this.st = uin - 0.4 < this.m.vout ? 1 : 0;
    return this.st !== old;
  }
  /** Ток нагрузки на выходе, А. */
  load(x: Float64Array): number {
    const g = 1 / this.m.rout;
    if (this.st === 0) return g * (this.m.vout - (v(x, this.out) - v(x, this.gout)));
    if (this.st === 1) return g * (v(x, this.vin) - 0.4 - v(x, this.out));
    return 0;
  }
  currents(x: Float64Array): number[] {
    const il = this.load(x);
    const iin = this.st === 0 ? this.iinPrev : this.st === 1 ? il : 0;
    return [iin, -iin, -il, il];
  }
}

/* ---------------- предохранитель ---------------- */

/** Плавкий предохранитель: сгорает, когда нагрев (∫(I² − Iном²)dt) превышает запас. */
export class Fuse implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  blown = false;
  heat = 0;
  constructor(
    public name: string,
    public a: Node,
    public b: Node,
    public amps: number,
    public ohms = 0.05,
    public comp?: string,
    pads?: [string, string],
  ) {
    this.pins = [
      { node: a, pad: pads?.[0] },
      { node: b, pad: pads?.[1] },
    ];
  }
  state(): number {
    return this.blown ? 1 : 0;
  }
  stamp(s: Stamper): void {
    s.cond(this.a, this.b, this.blown ? GOFF : 1 / this.ohms);
  }
  current(x: Float64Array): number {
    return (v(x, this.a) - v(x, this.b)) * (this.blown ? GOFF : 1 / this.ohms);
  }
  /** Сгорел — движок должен пересобрать матрицу (вызывающий делает kick). */
  onBlow: (() => void) | null = null;
  commit(x: Float64Array, ctx: StepCtx): void {
    if (this.blown) return;
    const i = this.current(x);
    this.heat = Math.max(0, this.heat + (i * i - this.amps * this.amps) * ctx.dt);
    // Двукратный ток — около 0,1 с, десятикратный — миллисекунды.
    if (this.heat > this.amps * this.amps * 0.3) {
      this.blown = true;
      this.onBlow?.();
    }
  }
  currents(x: Float64Array): number[] {
    const i = this.current(x);
    return [i, -i];
  }
}

/* ---------------- выход «по формуле» ---------------- */

/**
 * Выход датчика: источник с сопротивлением, напряжение — функция решения прошлого шага
 * и времени (датчик тока ACS712, LM35, датчик Холла SS49E).
 */
export class DrivenOut implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  constructor(
    public name: string,
    public node: Node,
    public fn: (x: Float64Array, t: number) => number,
    public rout = 10,
    public comp?: string,
    pad?: string,
  ) {
    this.pins = [{ node, pad }];
  }
  stamp(s: Stamper): void {
    s.g(this.node, this.node, 1 / this.rout);
  }
  private last = 0;
  rhs(r: RhsStamper, ctx: StepCtx, x: Float64Array): void {
    this.last = this.fn(x, ctx.t);
    r.inject(this.node, this.last / this.rout);
  }
  currents(x: Float64Array): number[] {
    return [(v(x, this.node) - this.last) / this.rout];
  }
}
