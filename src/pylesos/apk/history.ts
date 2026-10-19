/*
 * Данные для анализа в телефоне: выборки состояния раз в секунду (графики), серии ударов (сопротивление
 * фильтра до и после), осциллограммы ударов (строка «O» контроллера — та же, что рисует его экран).
 */
import type { VacStatus } from '../protocol';

/** Поля выборки — те же, что пишет служба Android в CSV (Recorder.FIELDS). */
export const FIELDS = [
  'state', 'running', 'purging', 'power', 'p1', 'p2', 'i1', 'i2', 'itotal', 'mains', 'vacuum', 'flow', 'speed',
  'filter', 'r', 't1', 't2', 'intake', 'pulses', 'water', 'load', 'w1', 'w2', 'kg', 'faults',
] as const;
export type Field = (typeof FIELDS)[number];

export interface Sample {
  /** Время, с (Unix). */
  t: number;
  v: Float32Array;
}

export const FIELD_INDEX: Record<Field, number> = Object.fromEntries(FIELDS.map((f, i) => [f, i])) as Record<Field, number>;

/** Что можно вывести на график: поле, подпись, единицы, цвет, знаков после запятой. */
export interface Series {
  key: string;
  label: string;
  unit: string;
  color: string;
  dec: number;
  get: (v: Float32Array) => number;
}

const f = (k: Field) => (v: Float32Array) => v[FIELD_INDEX[k]];

export const SERIES: Series[] = [
  { key: 'vacuum', label: 'Разрежение', unit: 'кПа', color: '#3CC8B4', dec: 1, get: f('vacuum') },
  { key: 'flow', label: 'Расход', unit: 'л/с', color: '#5AA2F0', dec: 1, get: f('flow') },
  { key: 'r', label: 'Фильтр R', unit: '', color: '#E9EEF2', dec: 2, get: f('r') },
  { key: 'filter', label: 'Перепад на фильтре', unit: 'Па', color: '#F2A93B', dec: 0, get: f('filter') },
  { key: 'power', label: 'Мощность турбин', unit: '%', color: '#C08CF0', dec: 0, get: f('power') },
  { key: 'itotal', label: 'Ток всего', unit: 'А', color: '#F26B5B', dec: 1, get: f('itotal') },
  { key: 't1', label: 'Температура Т1', unit: '°C', color: '#F0C25A', dec: 0, get: f('t1') },
  { key: 't2', label: 'Температура Т2', unit: '°C', color: '#D8A0C8', dec: 0, get: f('t2') },
  { key: 'mains', label: 'Сеть', unit: 'В', color: '#9AA8B4', dec: 0, get: f('mains') },
  { key: 'speed', label: 'Скорость в шланге', unit: 'м/с', color: '#7BD389', dec: 0, get: f('speed') },
];

export function sampleOf(s: VacStatus, t = Date.now() / 1000): Sample {
  const v = new Float32Array(FIELDS.length);
  const o = s as unknown as Record<string, number>;
  FIELDS.forEach((k, i) => (v[i] = Number(o[k]) || 0));
  return { t, v };
}

/** Кольцо выборок (до 6 ч). */
export class SampleRing {
  readonly max: number;
  private a: Sample[] = [];
  private lastT = 0;
  constructor(max = 6 * 3600) {
    this.max = max;
  }
  push(s: Sample): boolean {
    if (s.t - this.lastT < 0.95) return false;
    this.lastT = s.t;
    this.a.push(s);
    if (this.a.length > this.max) this.a.splice(0, this.a.length - this.max);
    return true;
  }
  /** Выборки за последние sec секунд. */
  since(sec: number): Sample[] {
    if (!this.a.length) return [];
    const from = this.a[this.a.length - 1].t - sec;
    let i = this.a.length - 1;
    while (i > 0 && this.a[i - 1].t >= from) i--;
    return this.a.slice(i);
  }
  all(): Sample[] {
    return this.a;
  }
  get size(): number {
    return this.a.length;
  }
  /** Подмешать записанное службой (CSV с заголовком), не дублируя. */
  loadCsv(csv: string): void {
    const lines = csv.split('\n').filter(Boolean);
    if (lines.length < 2) return;
    const head = lines[0].split(',');
    const idx = FIELDS.map((k) => head.indexOf(k));
    const ti = head.indexOf('t');
    const first = this.a.length ? this.a[0].t : Infinity;
    const out: Sample[] = [];
    for (const l of lines.slice(1)) {
      const c = l.split(',');
      const t = Number(c[ti]);
      if (!(t > 0) || t >= first) continue;
      const v = new Float32Array(FIELDS.length);
      idx.forEach((j, i) => (v[i] = j >= 0 ? Number(c[j]) || 0 : 0));
      out.push({ t, v });
    }
    this.a = [...out, ...this.a].slice(-this.max);
    if (this.a.length) this.lastT = this.a[this.a.length - 1].t;
  }
  toCsv(): string {
    const rows = [['t', ...FIELDS].join(',')];
    for (const s of this.a) rows.push([Math.round(s.t), ...Array.from(s.v, (x) => +x.toFixed(3))].join(','));
    return rows.join('\n') + '\n';
  }
}

/** Серия ударов: когда, какая, сколько ударов, сопротивление фильтра до и после. */
export interface PurgeSeries {
  t: number;
  kind: number;
  pulses: number;
  rBefore: number;
  rAfter: number;
  /** Пик разрежения в камере до серии, кПа. */
  vac: number;
}

/** Следит за состоянием и выделяет серии (purging > 0). */
export class SeriesTracker {
  list: PurgeSeries[] = [];
  private cur: PurgeSeries | null = null;
  private p0 = 0;
  private lastR = 0;
  private lastVac = 0;
  private endAt = 0;

  /** Возвращает true, если список поменялся. */
  push(s: VacStatus, now = Date.now() / 1000): boolean {
    let changed = false;
    if (s.purging && !this.cur) {
      this.cur = { t: now, kind: s.purging, pulses: 0, rBefore: this.lastR || s.r, rAfter: 0, vac: this.lastVac };
      this.p0 = s.pulses;
      this.endAt = 0;
    }
    if (this.cur) {
      this.cur.pulses = Math.max(this.cur.pulses, s.pulses - this.p0);
      if (s.purging) {
        this.cur.kind = Math.max(this.cur.kind, s.purging);
        this.endAt = 0;
      } else {
        // Сопротивление после серии — через 3 с, когда поток установился.
        if (!this.endAt) this.endAt = now + 3;
        if (now >= this.endAt) {
          this.cur.rAfter = s.r;
          this.list = [this.cur, ...this.list].slice(0, 300);
          this.cur = null;
          changed = true;
        }
      }
    } else {
      this.lastR = s.r;
      this.lastVac = s.vacuum;
    }
    return changed;
  }
}

/** Осциллограмма удара: строка «O» контроллера (vac_ext.c, send_osc). */
export interface Osc {
  /** Номер удара у контроллера. */
  k: number;
  /** Время прихода, с. */
  t: number;
  /** Шаг, мс. */
  dt: number;
  /** Какие клапаны: биты К1, К2. */
  mask: number;
  /** Длина импульса, мс. */
  imp: number;
  /** Глубина провала разрежения, %. */
  depth: number;
  /** Обратный перепад на фильтре (пик), Па. */
  rev: number;
  /** Время фронта, мс. */
  front: number;
  /** Разрежение камеры, кПа. */
  a: number[];
  /** Перепад на фильтре, Па (обратный — отрицательный или положительный, как прислал контроллер). */
  b: number[];
}

export function parseOsc(line: string, t = Date.now() / 1000): Osc | null {
  if (!line.startsWith('O ')) return null;
  const kv: Record<string, string> = {};
  for (const part of line.slice(2).split(' ')) {
    const i = part.indexOf('=');
    if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1);
  }
  const nums = (s: string | undefined) => (s ? s.split('/').map(Number) : []);
  const a = nums(kv.a).map((x) => x / 10);
  const b = nums(kv.b);
  if (!a.length) return null;
  return {
    k: Number(kv.k) || 0,
    t,
    dt: Number(kv.dt) || 2,
    mask: Number(kv.m) || 0,
    imp: Number(kv.i) || 0,
    depth: Number(kv.d) || 0,
    rev: Number(kv.rv) || 0,
    front: Number(kv.tf) || 0,
    a,
    b,
  };
}

export function fmt(v: number, dec = 0): string {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('ru', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function clock(t: number, sec = false): string {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}${sec ? ':' + p(d.getSeconds()) : ''}`;
}
