import { factor, solveComplex, type LuFactor } from './solver';

/*
 * Аналоговый расчёт схемы во времени (как PSIM и LTspice для силовой электроники):
 * узловой метод, в каждом узле — напряжение относительно земли. Конденсаторы и катушки —
 * θ-метод (θ = 0,55: почти трапеции, резонансы не «тонут», а звон после переключения
 * гаснет), шаг сразу после фронта — неявный Эйлер. Полупроводники — кусочно-линейные
 * («идеальные условия»): ключ открыт/закрыт, диод — порог и сопротивление, транзистор —
 * отсечка/усиление/насыщение. Поэтому на каждом шаге система линейная: её разложение
 * запоминается по набору состояний ключей, и шаг — это только подстановка.
 *
 * Земля — узел −1 (в матрицу не входит). Ток «в узел» — положительный.
 */

export type Node = number;
export const GND: Node = -1;

export interface StepCtx {
  /** Шаг, с. */
  dt: number;
  /** θ-метод: 0,55 обычно, 1 — неявный Эйлер (после фронтов и для жёстких узлов). */
  theta: number;
  /** Время конца шага, с. */
  t: number;
  /** Шум включён (тепловой шум резисторов, шум ОУ). */
  noise: boolean;
  /** Нормальное случайное число (для шума). */
  gauss(): number;
}

export interface Stamper {
  /** G[i][j] += v (земля пропускается). */
  g(i: Node, j: Node, v: number): void;
  /** Проводимость между a и b. */
  cond(a: Node, b: Node, g: number): void;
  /** Ток из узла p в узел n = gm·(v(cp) − v(cn)) (источник тока, управляемый напряжением). */
  vccs(p: Node, n: Node, cp: Node, cn: Node, gm: number): void;
}

/** Комплексные проводимости для частотного анализа (АЧХ). */
export interface AcStamper {
  cond(a: Node, b: Node, re: number, im: number): void;
  vccs(p: Node, n: Node, cp: Node, cn: Node, re: number, im: number): void;
}

export interface RhsStamper {
  /** Ток i втекает в узел. */
  inject(node: Node, i: number): void;
  /** Источник тока из узла a в узел b (через элемент), А. */
  source(a: Node, b: Node, i: number): void;
}

/** Параметр детали, который можно крутить на ходу. */
export interface AnalogParam {
  key: string;
  label: string;
  value: number;
  unit: string;
  /** Пределы ползунка (логарифмический, если log). */
  min: number;
  max: number;
  log?: boolean;
  /** Выбор из списка: значение — номер. */
  options?: string[];
  /** Номинал детали (по нему — «в проект»). */
  nominal?: boolean;
}

export interface AnalogElement {
  /** «R3», «Q1A канал», «L3 TX». */
  name: string;
  /** Деталь проекта. */
  comp?: string;
  /** Выводы: узел и номер вывода детали (для тока на плате и схеме). */
  pins: { node: Node; pad?: string }[];
  stamp(s: Stamper, ctx: StepCtx): void;
  rhs?(r: RhsStamper, ctx: StepCtx, x: Float64Array): void;
  /** Проверить кусочно-линейное состояние по решению; true — поменялось, пересчитать шаг. */
  check?(x: Float64Array, ctx: StepCtx): boolean;
  /** Принять шаг: запомнить токи и напряжения для следующего. */
  commit?(x: Float64Array, ctx: StepCtx): void;
  /** Код состояния (для запоминания разложения). */
  state?(): number;
  /** Ток в деталь через каждый вывод, А (сумма — 0). */
  currents?(x: Float64Array): number[];
  /** Малосигнальная проводимость на частоте ω (у реактивных); без неё — проводимость текущего состояния. */
  ac?(s: AcStamper, w: number): void;
}

const v = (x: Float64Array, n: Node) => (n < 0 ? 0 : x[n]);
export { v as volt };

export class Engine {
  readonly names: string[] = [];
  readonly elements: AnalogElement[] = [];
  dt = 1e-6;
  t = 0;
  x = new Float64Array(0);
  noise = true;
  /** Всегда неявный Эйлер (поиск рабочей точки крупным шагом). */
  implicit = false;
  /** Неявных шагов впереди (после фронта). */
  private beLeft = 1;
  private cache = new Map<number, LuFactor>();
  private stateful: AnalogElement[] = [];
  /** По видам: конденсаторы и катушки считаются в общем цикле (быстрее вызовов по элементам). */
  private caps: Capacitor[] = [];
  private inds: Inductor[] = [];
  private rhsEls: AnalogElement[] = [];
  private commitEls: AnalogElement[] = [];
  private G = new Float64Array(0);
  private rhsBuf = new Float64Array(0);
  private xNew = new Float64Array(0);
  private seed = 0x9e3779b9;
  private spare: number | null = null;
  /** Счётчики для оценки скорости. */
  steps = 0;
  factorizations = 0;
  /** Слушатели шага (осциллограф, двигатели). */
  private onStep: ((e: Engine) => void)[] = [];
  private ready = false;

  node(name: string): Node {
    this.names.push(name);
    this.ready = false;
    return this.names.length - 1;
  }

  get n(): number {
    return this.names.length;
  }

  add<T extends AnalogElement>(e: T): T {
    this.elements.push(e);
    this.ready = false;
    return e;
  }

  listen(fn: (e: Engine) => void): void {
    this.onStep.push(fn);
  }

  /** Параметры поменялись (номинал, связь катушек): разложения — заново. */
  invalidate(): void {
    this.cache.clear();
    this.keyDirty = true;
    this.beLeft = Math.max(this.beLeft, 1);
  }

  /** Сменить шаг (разложения зависят от него). */
  setDt(dt: number): void {
    if (dt === this.dt) return;
    this.dt = dt;
    this.invalidate();
  }

  /**
   * Внешнее событие (фронт вывода контроллера, нажатие): следующий шаг — неявный. Состояние,
   * поменянное снаружи (Switch.closed, McuPinEl.mode), без kick() движок не заметит.
   */
  kick(): void {
    this.keyDirty = true;
    this.beLeft = Math.max(this.beLeft, 1);
  }

  private prepare(): void {
    if (this.ready) return;
    const n = this.n;
    if (this.x.length !== n) {
      const old = this.x;
      this.x = new Float64Array(n);
      this.x.set(old.subarray(0, Math.min(old.length, n)));
    }
    this.G = new Float64Array(n * n);
    this.rhsBuf = new Float64Array(n);
    this.xNew = new Float64Array(n);
    this.stateful = this.elements.filter((e) => e.state);
    this.caps = this.elements.filter((e): e is Capacitor => e instanceof Capacitor);
    this.inds = this.elements.filter((e): e is Inductor => e instanceof Inductor);
    this.rhsEls = this.elements.filter((e) => e.rhs && !(e instanceof Capacitor) && !(e instanceof Inductor) && !(e instanceof Resistor && !e.noisy));
    this.commitEls = this.elements.filter((e) => e.commit && !(e instanceof Capacitor) && !(e instanceof Inductor));
    this.cache.clear();
    this.keyDirty = true;
    this.ready = true;
  }

  gauss(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    let w = 0;
    do {
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      u = this.seed / 4294967296;
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      w = this.seed / 4294967296;
    } while (u <= 1e-12);
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * w);
    return r * Math.cos(2 * Math.PI * w);
  }

  /** Код набора состояний; пересчитывается, только когда состояние могло поменяться. */
  private stateKey = 0;
  private keyDirty = true;
  private key(theta: number): number {
    if (this.keyDirty) {
      // FNV-1a по кодам состояний (коллизии практически исключены: состояний — десятки).
      let h = 0x811c9dc5;
      for (const e of this.stateful) {
        h ^= e.state!() + 1;
        h = Math.imul(h, 16777619) >>> 0;
      }
      this.stateKey = h;
      this.keyDirty = false;
    }
    return theta === 1 ? this.stateKey ^ 0x5bd1e995 : this.stateKey;
  }

  private lu(theta: number, ctx: StepCtx): LuFactor {
    const k = this.key(theta);
    const hit = this.cache.get(k);
    if (hit) return hit;
    const n = this.n;
    const G = this.G;
    G.fill(0);
    const st: Stamper = {
      g: (i, j, val) => {
        if (i >= 0 && j >= 0) G[i * n + j] += val;
      },
      cond: (a, b, g) => {
        if (a >= 0) G[a * n + a] += g;
        if (b >= 0) G[b * n + b] += g;
        if (a >= 0 && b >= 0) {
          G[a * n + b] -= g;
          G[b * n + a] -= g;
        }
      },
      vccs: (p, q, cp, cn, gm) => {
        if (p >= 0) {
          if (cp >= 0) G[p * n + cp] += gm;
          if (cn >= 0) G[p * n + cn] -= gm;
        }
        if (q >= 0) {
          if (cp >= 0) G[q * n + cp] -= gm;
          if (cn >= 0) G[q * n + cn] += gm;
        }
      },
    };
    for (const e of this.elements) e.stamp(st, ctx);
    for (let i = 0; i < n; i++) G[i * n + i] += 1e-9; // gmin: каждый узел хоть как-то связан с землёй
    const f = factor(G, n);
    if (!f) throw new Error('Аналоговый расчёт: схема вырождена');
    this.factorizations++;
    if (this.cache.size > 256) this.cache.clear();
    this.cache.set(k, f);
    return f;
  }

  private ctx: StepCtx = { dt: 1e-6, theta: 1, t: 0, noise: true, gauss: () => this.gauss() };
  private rs: RhsStamper = {
    inject: (node, i) => {
      if (node >= 0) this.rhsBuf[node] += i;
    },
    source: (a, b, i) => {
      if (a >= 0) this.rhsBuf[a] -= i;
      if (b >= 0) this.rhsBuf[b] += i;
    },
  };

  /** Один шаг dt. */
  step(): void {
    this.prepare();
    const theta = this.implicit || this.beLeft > 0 ? 1 : 0.55;
    const ctx = this.ctx;
    ctx.dt = this.dt;
    ctx.theta = theta;
    ctx.t = this.t + this.dt;
    ctx.noise = this.noise;
    const rhs = this.rhsBuf;
    const xn = this.xNew;
    const x = this.x;
    const rhsEls = this.rhsEls;
    const commitEls = this.commitEls;
    const stateful = this.stateful;
    let flipped = false;
    for (let iter = 0; iter < 16; iter++) {
      const f = this.lu(theta, ctx);
      rhs.fill(0);
      this.rhsLinear(theta);
      for (let q = 0; q < rhsEls.length; q++) rhsEls[q].rhs!(this.rs, ctx, x);
      f.solve(rhs, xn);
      let changed = false;
      for (let q = 0; q < stateful.length; q++) if (stateful[q].check?.(xn, ctx)) changed = true;
      if (!changed) break;
      flipped = true;
      this.keyDirty = true;
    }
    this.commitLinear(xn, theta);
    for (let q = 0; q < commitEls.length; q++) commitEls[q].commit!(xn, ctx);
    x.set(xn);
    this.t = ctx.t;
    this.steps++;
    if (this.beLeft > 0) this.beLeft--;
    if (flipped) this.beLeft = 1;
    for (const fn of this.onStep) fn(this);
  }

  private rhsLinear(theta: number): void {
    const rhs = this.rhsBuf;
    const dt = this.dt;
    for (let q = 0; q < this.caps.length; q++) {
      const c = this.caps[q];
      const th = c.stiff ? 1 : theta;
      const J = (c.farads / (th * dt)) * c.vPrev + ((1 - th) / th) * c.i;
      if (c.b >= 0) rhs[c.b] -= J;
      if (c.a >= 0) rhs[c.a] += J;
    }
    for (let q = 0; q < this.inds.length; q++) {
      const l = this.inds[q];
      const K = l.i + ((1 - theta) * dt * l.vPrev) / l.henry;
      if (l.a >= 0) rhs[l.a] -= K;
      if (l.b >= 0) rhs[l.b] += K;
    }
  }

  private commitLinear(x: Float64Array, theta: number): void {
    const dt = this.dt;
    for (let q = 0; q < this.caps.length; q++) {
      const c = this.caps[q];
      const th = c.stiff ? 1 : theta;
      const vn = (c.a >= 0 ? x[c.a] : 0) - (c.b >= 0 ? x[c.b] : 0);
      c.i = (c.farads / (th * dt)) * (vn - c.vPrev) - ((1 - th) / th) * c.i;
      c.vPrev = vn;
    }
    for (let q = 0; q < this.inds.length; q++) {
      const l = this.inds[q];
      const vn = (l.a >= 0 ? x[l.a] : 0) - (l.b >= 0 ? x[l.b] : 0);
      l.i += (dt / l.henry) * (theta * vn + (1 - theta) * l.vPrev);
      l.vPrev = vn;
    }
  }

  /** Считать до момента t (с). */
  advanceTo(t: number): void {
    const lim = t - this.dt * 0.5;
    while (this.t < lim) this.step();
  }

  volts(node: Node): number {
    return v(this.x, node);
  }

  /**
   * АЧХ: на узел inp подаётся 1 В переменного (источник 1 мСм·10⁶), схема — в текущем
   * состоянии ключей, возвращаются комплексные напряжения всех узлов на частоте f.
   */
  acAt(f: number, inp: Node): { re: Float64Array; im: Float64Array } | null {
    this.prepare();
    const n = this.n;
    const w = 2 * Math.PI * f;
    const ar = new Float64Array(n * n);
    const ai = new Float64Array(n * n);
    const put = (i: Node, j: Node, re: number, im: number) => {
      if (i < 0 || j < 0) return;
      ar[i * n + j] += re;
      ai[i * n + j] += im;
    };
    const acs: AcStamper = {
      cond: (a, b, re, im) => {
        put(a, a, re, im);
        put(b, b, re, im);
        put(a, b, -re, -im);
        put(b, a, -re, -im);
      },
      vccs: (p, q, cp, cn, re, im) => {
        put(p, cp, re, im);
        put(p, cn, -re, -im);
        put(q, cp, -re, -im);
        put(q, cn, re, im);
      },
    };
    const real: Stamper = {
      g: (i, j, val) => put(i, j, val, 0),
      cond: (a, b, g) => acs.cond(a, b, g, 0),
      vccs: (p, q, cp, cn, gm) => acs.vccs(p, q, cp, cn, gm, 0),
    };
    const ctx: StepCtx = { dt: this.dt, theta: 1, t: this.t, noise: false, gauss: () => 0 };
    for (const e of this.elements) {
      if (e.ac) e.ac(acs, w);
      else e.stamp(real, ctx);
    }
    for (let i = 0; i < n; i++) ar[i * n + i] += 1e-9;
    const br = new Float64Array(n);
    const bi = new Float64Array(n);
    if (inp >= 0) {
      ar[inp * n + inp] += 1e6;
      br[inp] = 1e6;
    }
    return solveComplex(ar, ai, br, bi, n);
  }
}

/* ---------------- базовые элементы ---------------- */

export class Resistor implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  constructor(
    public name: string,
    public a: Node,
    public b: Node,
    public ohms: number,
    public comp?: string,
    pads?: [string, string],
    /** Тепловой шум (для резисторов на входе усилителя он и слышен). */
    public noisy = true,
    public tempK = 300,
  ) {
    this.pins = [
      { node: a, pad: pads?.[0] },
      { node: b, pad: pads?.[1] },
    ];
  }
  stamp(s: Stamper): void {
    s.cond(this.a, this.b, 1 / Math.max(1e-6, this.ohms));
  }
  rhs(r: RhsStamper, ctx: StepCtx): void {
    if (!ctx.noise || !this.noisy) return;
    // Тепловой шум: ток √(4kT/R·B), полоса B = 1/(2·dt).
    const i = Math.sqrt((4 * 1.380649e-23 * this.tempK) / Math.max(1e-6, this.ohms) / (2 * ctx.dt)) * ctx.gauss();
    r.source(this.a, this.b, i);
  }
  currents(x: Float64Array): number[] {
    const i = (v(x, this.a) - v(x, this.b)) / Math.max(1e-6, this.ohms);
    return [i, -i];
  }
}

export class Capacitor implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  /** Ток через конденсатор (из a в b) и напряжение на нём на прошлом шаге. */
  i = 0;
  vPrev = 0;
  constructor(
    public name: string,
    public a: Node,
    public b: Node,
    public farads: number,
    public comp?: string,
    pads?: [string, string],
    /** Всегда неявно (жёсткие узлы: внутренние ёмкости моделей). */
    public stiff = false,
  ) {
    this.pins = [
      { node: a, pad: pads?.[0] },
      { node: b, pad: pads?.[1] },
    ];
  }
  private th(ctx: StepCtx): number {
    return this.stiff ? 1 : ctx.theta;
  }
  stamp(s: Stamper, ctx: StepCtx): void {
    s.cond(this.a, this.b, this.farads / (this.th(ctx) * ctx.dt));
  }
  rhs(r: RhsStamper, ctx: StepCtx): void {
    const th = this.th(ctx);
    const geq = this.farads / (th * ctx.dt);
    const J = geq * this.vPrev + ((1 - th) / th) * this.i;
    r.source(this.b, this.a, J);
  }
  commit(x: Float64Array, ctx: StepCtx): void {
    const th = this.th(ctx);
    const vn = v(x, this.a) - v(x, this.b);
    const geq = this.farads / (th * ctx.dt);
    this.i = geq * (vn - this.vPrev) - ((1 - th) / th) * this.i;
    this.vPrev = vn;
  }
  currents(): number[] {
    return [this.i, -this.i];
  }
  ac(s: AcStamper, w: number): void {
    s.cond(this.a, this.b, 0, w * this.farads);
  }
}

export class Inductor implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  i = 0;
  vPrev = 0;
  constructor(
    public name: string,
    public a: Node,
    public b: Node,
    public henry: number,
    public comp?: string,
    pads?: [string, string],
  ) {
    this.pins = [
      { node: a, pad: pads?.[0] },
      { node: b, pad: pads?.[1] },
    ];
  }
  stamp(s: Stamper, ctx: StepCtx): void {
    s.cond(this.a, this.b, (ctx.theta * ctx.dt) / this.henry);
  }
  rhs(r: RhsStamper, ctx: StepCtx): void {
    const K = this.i + ((1 - ctx.theta) * ctx.dt * this.vPrev) / this.henry;
    r.source(this.a, this.b, K);
  }
  commit(x: Float64Array, ctx: StepCtx): void {
    const vn = v(x, this.a) - v(x, this.b);
    this.i += (ctx.dt / this.henry) * (ctx.theta * vn + (1 - ctx.theta) * this.vPrev);
    this.vPrev = vn;
  }
  currents(): number[] {
    return [this.i, -this.i];
  }
  ac(s: AcStamper, w: number): void {
    s.cond(this.a, this.b, 0, -1 / (w * this.henry));
  }
}

/**
 * Связанные катушки (катушка DD, трансформатор, цель под катушкой): матрица индуктивностей
 * L[i][j] = k[i][j]·√(Li·Lj). i = i₀ + dt·Γ·(θ·v + (1−θ)·v₀), Γ = L⁻¹.
 */
export class CoupledCoils implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  i: Float64Array;
  vPrev: Float64Array;
  private gamma: Float64Array;
  constructor(
    public name: string,
    public coils: { a: Node; b: Node; henry: number; name: string }[],
    /** Связь между катушками (симметричная, по верхнему треугольнику). */
    public k: number[][],
    public comp?: string,
  ) {
    this.pins = coils.flatMap((c) => [{ node: c.a }, { node: c.b }]);
    this.i = new Float64Array(coils.length);
    this.vPrev = new Float64Array(coils.length);
    this.gamma = this.inverse();
  }
  /** Пересчитать после смены связей или индуктивностей (движок — invalidate). */
  update(): void {
    this.gamma = this.inverse();
  }
  private inverse(): Float64Array {
    const m = this.coils.length;
    const L = new Float64Array(m * m);
    for (let p = 0; p < m; p++)
      for (let q = 0; q < m; q++) {
        const kk = p === q ? 1 : (this.k[Math.min(p, q)]?.[Math.max(p, q)] ?? 0);
        L[p * m + q] = kk * Math.sqrt(this.coils[p].henry * this.coils[q].henry);
      }
    // Обращение Гауссом—Жорданом (m — 2–4).
    const a = L.slice();
    const inv = new Float64Array(m * m);
    for (let p = 0; p < m; p++) inv[p * m + p] = 1;
    for (let c = 0; c < m; c++) {
      let piv = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(a[r * m + c]) > Math.abs(a[piv * m + c])) piv = r;
      for (let j = 0; j < m; j++) {
        [a[c * m + j], a[piv * m + j]] = [a[piv * m + j], a[c * m + j]];
        [inv[c * m + j], inv[piv * m + j]] = [inv[piv * m + j], inv[c * m + j]];
      }
      const d = a[c * m + c];
      for (let j = 0; j < m; j++) {
        a[c * m + j] /= d;
        inv[c * m + j] /= d;
      }
      for (let r = 0; r < m; r++) {
        if (r === c) continue;
        const f = a[r * m + c];
        if (!f) continue;
        for (let j = 0; j < m; j++) {
          a[r * m + j] -= f * a[c * m + j];
          inv[r * m + j] -= f * inv[c * m + j];
        }
      }
    }
    return inv;
  }
  stamp(s: Stamper, ctx: StepCtx): void {
    const m = this.coils.length;
    for (let p = 0; p < m; p++)
      for (let q = 0; q < m; q++) {
        const g = ctx.theta * ctx.dt * this.gamma[p * m + q];
        const cp = this.coils[p];
        const cq = this.coils[q];
        // Ток катушки p (из a в b) зависит от напряжения катушки q.
        s.vccs(cp.a, cp.b, cq.a, cq.b, g);
      }
  }
  rhs(r: RhsStamper, ctx: StepCtx): void {
    const m = this.coils.length;
    for (let p = 0; p < m; p++) {
      let K = this.i[p];
      for (let q = 0; q < m; q++) K += (1 - ctx.theta) * ctx.dt * this.gamma[p * m + q] * this.vPrev[q];
      r.source(this.coils[p].a, this.coils[p].b, K);
    }
  }
  private vn = new Float64Array(0);
  commit(x: Float64Array, ctx: StepCtx): void {
    const m = this.coils.length;
    if (this.vn.length !== m) this.vn = new Float64Array(m);
    const vn = this.vn;
    for (let q = 0; q < m; q++) vn[q] = v(x, this.coils[q].a) - v(x, this.coils[q].b);
    for (let p = 0; p < m; p++) {
      let di = 0;
      for (let q = 0; q < m; q++) di += this.gamma[p * m + q] * (ctx.theta * vn[q] + (1 - ctx.theta) * this.vPrev[q]);
      this.i[p] += ctx.dt * di;
    }
    for (let q = 0; q < m; q++) this.vPrev[q] = vn[q];
  }
  currents(): number[] {
    return [...this.i].flatMap((i) => [i, -i]);
  }
  /** Γ = L⁻¹ (для тока обмоток в АЧХ). */
  get inverseL(): Float64Array {
    return this.gamma;
  }
  ac(s: AcStamper, w: number): void {
    const m = this.coils.length;
    for (let p = 0; p < m; p++)
      for (let q = 0; q < m; q++) {
        const cp = this.coils[p];
        const cq = this.coils[q];
        s.vccs(cp.a, cp.b, cq.a, cq.b, 0, -this.gamma[p * m + q] / w);
      }
  }
}

/** Источник напряжения с внутренним сопротивлением (Нортон): аккумулятор, питание, генератор. */
export class VSource implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  constructor(
    public name: string,
    public p: Node,
    public n: Node,
    public volts: number | ((t: number) => number),
    public ohms = 0.01,
    public comp?: string,
    pads?: [string, string],
  ) {
    this.pins = [
      { node: p, pad: pads?.[0] },
      { node: n, pad: pads?.[1] },
    ];
  }
  value(t: number): number {
    return typeof this.volts === 'number' ? this.volts : this.volts(t);
  }
  stamp(s: Stamper): void {
    s.cond(this.p, this.n, 1 / this.ohms);
  }
  rhs(r: RhsStamper, ctx: StepCtx): void {
    r.source(this.n, this.p, this.value(ctx.t) / this.ohms);
  }
  currents(x: Float64Array): number[] {
    // Ток «в источник» через плюс (отдаёт — отрицательный).
    const i = (v(x, this.p) - v(x, this.n) - (typeof this.volts === 'number' ? this.volts : 0)) / this.ohms;
    return [i, -i];
  }
}

export class ISource implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  constructor(
    public name: string,
    /** Ток течёт из a через источник в b. */
    public a: Node,
    public b: Node,
    public amps: number | ((t: number) => number),
    public comp?: string,
  ) {
    this.pins = [{ node: a }, { node: b }];
  }
  stamp(): void {}
  rhs(r: RhsStamper, ctx: StepCtx): void {
    r.source(this.a, this.b, typeof this.amps === 'number' ? this.amps : this.amps(ctx.t));
  }
  currents(): number[] {
    const i = typeof this.amps === 'number' ? this.amps : 0;
    return [i, -i];
  }
}

/** Ключ: кнопка, контакт реле. */
export class Switch implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  constructor(
    public name: string,
    public a: Node,
    public b: Node,
    public closed = false,
    public ron = 0.05,
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
    s.cond(this.a, this.b, this.closed ? 1 / this.ron : 1e-9);
  }
  currents(x: Float64Array): number[] {
    const i = (v(x, this.a) - v(x, this.b)) * (this.closed ? 1 / this.ron : 1e-9);
    return [i, -i];
  }
}
