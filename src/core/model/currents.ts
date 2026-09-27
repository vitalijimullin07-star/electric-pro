import { netClassOf } from './rules';
import { roleOf } from './net-roles';
import type { Component, DesignRules, Id, PadDef, Project } from './types';

/*
 * Токи выводов и цепей — чтобы ширину дорожек не расставлять вручную.
 *
 * Ток вывода берётся из знаний о детали: стабилизаторы и преобразователи — по названию
 * (AMS1117 — 1 А, AP63205 — 2 А…) или по току в описании, блоки питания HLK — по модели,
 * трансформатор — по ВА и напряжениям обмоток, предохранитель — по номиналу, нагрузки
 * (двигатель, ТЭН, лампа) — по мощности, розетка — по номиналу, модули ESP32 — по
 * пиковому току радио. У прочих микросхем выводы питания — десятки миллиампер.
 *
 * Ток цепи — больший из: самого сильноточного вывода (источник, предохранитель,
 * дроссель) и суммы потребителей (каждая деталь — один раз). Выносные детали (двигатель,
 * клапан, пульт) учитываются, если их ток может пройти по плате: в цепи есть источник
 * или силовой элемент на плате либо два и больше выводов разъёмов. Ток, заданный у цепи
 * вручную, главнее оценки.
 *
 * Напряжение на ширину не влияет — оно задаёт зазор (класс Mains для 230 В).
 * Ширина по току — IPC-2221 для наружного слоя: I = 0,048·ΔT^0,44·S^0,725 (S в мил²).
 */

export type PinKind = 'load' | 'source' | 'through';

export interface PinCurrent {
  /** Ток через вывод, А. */
  current: number;
  /** Потребитель (суммируется), источник или последовательный элемент. */
  kind: PinKind;
  /** Откуда оценка: «AMS1117 — 1 А», «1200 Вт / 230 В». */
  why: string;
}

export interface NetCurrent {
  net: Id;
  /** Итоговый ток по плате, А. */
  current: number;
  manual: boolean;
  /** Кто задаёт ток: самые сильноточные выводы и потребители. */
  parts: { ref: string; pin: string; current: number; kind: PinKind; why: string; offBoard: boolean }[];
  /** Сумма потребителей больше самого сильноточного вывода. */
  bySum: boolean;
  /** Учтены выносные детали (их ток может идти по плате). */
  offBoard: boolean;
}

/* ---------------- разбор чисел из названий ---------------- */

const num = (s: string) => parseFloat(s.replace(',', '.'));

/** Ток из текста: «T1A», «0,5 А», «500 мА», «2A». */
export function parseAmps(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(мА|mA|А|A)(?![a-zA-Zа-яА-Я])/.exec(text);
  if (!m) return null;
  const v = num(m[1]);
  return m[2] === 'мА' || m[2] === 'mA' ? v / 1000 : v;
}
function parseWatts(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(кВт|Вт|kW|W)(?![a-zA-Zа-яА-Я])/.exec(text);
  if (!m) return null;
  return num(m[1]) * (m[2] === 'кВт' || m[2] === 'kW' ? 1000 : 1);
}
function parseVA(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(ВА|VA)(?![a-zA-Zа-яА-Я])/.exec(text);
  return m ? num(m[1]) : null;
}
function parseVolts(text: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(В|V)(?![a-zA-Zа-яА-ЯА])/.exec(text.replace(/\d+(?:[.,]\d+)?\s*(ВА|VA)/g, ''));
  return m ? num(m[1]) : null;
}
const fmtA = (a: number) => (a < 0.1 ? `${Math.round(a * 1000)} мА` : `${+a.toFixed(2)} А`.replace('.', ','));

/* ---------------- знания о деталях ---------------- */

/** Стабилизаторы и преобразователи: название → ток, А; buck — импульсный понижающий. */
const REGULATORS: { re: RegExp; amps: number; buck?: boolean }[] = [
  { re: /AMS1117|LM1117|LD1117|AZ1117/i, amps: 1 },
  { re: /78L\d\d/i, amps: 0.1 },
  { re: /78M\d\d/i, amps: 0.5 },
  { re: /(^|[^\d])7[89]\d\d([^\d]|$)|L78\d\d|LM78\d\d|KA78\d\d/i, amps: 1 },
  { re: /LM317/i, amps: 1.5 },
  { re: /L4940/i, amps: 1.5 },
  { re: /LM2941/i, amps: 1 },
  { re: /LM2931|LP295[01]|HT7[35]\d\d|XC6206/i, amps: 0.15 },
  { re: /MCP1700|MCP1702/i, amps: 0.25 },
  { re: /AP2112|RT9013|ME6211|RT9193/i, amps: 0.5 },
  { re: /AP632\d\d/i, amps: 2, buck: true },
  { re: /AP631\d\d/i, amps: 1, buck: true },
  { re: /MP1584/i, amps: 3, buck: true },
  { re: /LM259[56]|LM257[56]|MP2307|TPS5430|MP2315/i, amps: 3, buck: true },
  { re: /XL401[56]|XL4005/i, amps: 5, buck: true },
];

/** Блоки питания на плату (AC-DC): модель → ток выхода, А, и напряжение выхода. */
const PSU: { re: RegExp; amps: number; volts: number }[] = [
  { re: /HLK[- ]?PM01|HLK[- ]?PM05/i, amps: 0.6, volts: 5 },
  { re: /HLK[- ]?PM03/i, amps: 0.9, volts: 3.3 },
  { re: /HLK[- ]?PM09/i, amps: 0.33, volts: 9 },
  { re: /HLK[- ]?PM12/i, amps: 0.25, volts: 12 },
  { re: /HLK[- ]?PM24/i, amps: 0.125, volts: 24 },
  { re: /HLK[- ]?5M05/i, amps: 1, volts: 5 },
  { re: /HLK[- ]?10M05/i, amps: 2, volts: 5 },
  { re: /HLK[- ]?20M05/i, amps: 4, volts: 5 },
];

const P_IN = /^(v?in\+?|vi|input|ip|vcc_?in)$/i;
const P_OUT = /^(v?out\+?|vo\+?|\+vo|\+?v?o|output|op|\+v|vout\d?)$/i;
const P_GND = /^(gnd\d*|agnd|pgnd|vss|ep|pad|tab|0v|-vo|vo-|-v|com|-)$/i;
const P_SW = /^(sw|lx|ph)$/i;
const P_SUPPLY = /^(vcc\d?|vdd\d?|avcc|v\+|vs|vbus|3v3|3\.3v|\+3v3|5v|\+5v|vin|\+|12v|\+12v)$/i;
const P_AC = /^(ac\d?|acl|acn|~|l|n|ac_?l|ac_?n)$/i;

type PinRule = (pad: PadDef) => PinCurrent | null;

function textOf(c: Component): string {
  return [c.value, c.description ?? '', c.footprint, ...Object.values(c.fields ?? {})].join(' ');
}

const isConnector = (c: Component) => /^(X|XT|XS|XP|J|CN|P)\d/i.test(c.ref) || /Terminal|PinHeader|PinSocket|Connector|JST|IDC|Molex|Header/i.test(c.footprint);

/** Правило детали: какой ток у какого вывода. null — деталь не знаем. */
function ruleFor(p: Project, c: Component): PinRule | null {
  const t = textOf(c);
  const name = (pad: PadDef) => (pad.name ?? '').trim();

  // Предохранитель: номинал — ток пути.
  if (/^(F|FU)\d/i.test(c.ref) || /fuse|предохранит/i.test(t)) {
    const a = parseAmps(`${c.value} ${c.description ?? ''}`);
    if (!a) return null;
    return () => ({ current: a, kind: 'through', why: `предохранитель ${fmtA(a)}` });
  }
  // Блок питания AC-DC.
  const psu = PSU.find((x) => x.re.test(t));
  if (psu) {
    const acA = Math.max(0.02, (psu.amps * psu.volts) / 0.7 / 230);
    return (pad) => {
      const n = name(pad);
      if (P_AC.test(n)) return { current: acA, kind: 'load', why: `вход ${c.value || 'блока питания'} ~${fmtA(acA)}` };
      return { current: psu.amps, kind: 'source', why: `выход ${c.value || 'блока питания'} ${fmtA(psu.amps)}` };
    };
  }
  // Стабилизатор или преобразователь.
  const reg = REGULATORS.find((x) => x.re.test(`${c.value} ${c.description ?? ''}`));
  const regGeneric = !reg && /^(U|DA|DD|IC|VR|A)\d/i.test(c.ref) && /стабилизатор|преобразовател|regulator|converter|\bLDO\b|\bbuck\b/i.test(t) ? parseAmps(`${c.value} ${c.description ?? ''}`) : null;
  if (reg || regGeneric) {
    const amps = reg ? reg.amps : regGeneric!;
    const buck = reg ? !!reg.buck : /преобразовател|buck|dc-dc|импульсн/i.test(t);
    const why = `${c.value} — ${fmtA(amps)}`;
    return (pad) => {
      const n = name(pad);
      if (!n) return { current: amps, kind: 'source', why };
      if (P_IN.test(n)) return { current: buck ? amps * 0.5 : amps, kind: 'load', why: buck ? `вход ${c.value} (≈половина выходного тока)` : `вход ${why}` };
      if (P_OUT.test(n) || P_GND.test(n)) return { current: amps, kind: 'source', why };
      if (P_SW.test(n)) return { current: amps, kind: 'through', why: `ключ ${why}` };
      return null;
    };
  }
  // Трансформатор: ВА и напряжения обмоток «230/9 В».
  if (/^(T|TV|TR)\d/i.test(c.ref) || /трансформатор|transformer/i.test(t)) {
    const va = parseVA(t);
    const m = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(В|V)/.exec(t);
    if (!va || !m) return null;
    const u1 = num(m[1]);
    const u2 = num(m[2]);
    return (pad) => {
      const n = name(pad) || pad.number;
      if (/^P/i.test(n)) return { current: va / u1, kind: 'load', why: `первичная обмотка ${va} ВА / ${u1} В` };
      if (/^S/i.test(n)) return { current: va / u2, kind: 'source', why: `вторичная обмотка ${va} ВА / ${u2} В` };
      return null;
    };
  }
  // Дроссель с током в названии.
  if (/^L\d/i.test(c.ref) || /дроссел|inductor/i.test(t)) {
    const a = parseAmps(`${c.value} ${c.description ?? ''}`);
    if (!a) return null;
    return () => ({ current: a, kind: 'through', why: `дроссель ${fmtA(a)}` });
  }
  // Обычные детали (резисторы, симисторы, разъёмы…) нагрузкой по словам в описании не считаются.
  const passive = /^(R|RK|RU|C|VD|VS|VT|Q|U|DA|DD|D|L|F|FU|X|XT|XP|J|S|SA|SB|SW|K|KV|B|BQ|Z)\d/i.test(c.ref);
  // Розетка: номинал — ток нагрузки.
  const socket = /^XS\d/i.test(c.ref) ? /розетк|socket|outlet/i.test(t) : !passive && /розетк|outlet|Socket_Tool|Socket_Mains/i.test(`${c.value} ${c.footprint}`);
  if (socket && !isConnectorFootprintOnly(c)) {
    const a = parseAmps(`${c.value} ${c.description ?? ''}`);
    if (!a) return null;
    return (pad) => (/^(PE|E|⏚)$/i.test(name(pad)) ? null : { current: a, kind: 'load', why: `розетка ${fmtA(a)}` });
  }
  // Нагрузки по мощности: двигатель, ТЭН, лампа, клапан.
  const loadWord = /мотор|двигат|турбин|motor|нагрев|тэн|heater|ламп|lamp|насос|pump|вентилятор|fan|клапан|valve|solenoid|соленоид|нагрузк/i;
  if (!passive && (loadWord.test(`${c.value} ${c.footprint}`) || (/^(M|YA|EK|EL|HL|Y)\d/i.test(c.ref) && (loadWord.test(t) || parseWatts(t))))) {
    const valve = /клапан|valve|solenoid|соленоид/i.test(t);
    const w = parseWatts(t) ?? (valve ? 10 : null);
    if (!w) return null;
    const hv = Object.values(c.padNets).some((n) => roleOf(p, n) === 'hv');
    const u = parseVolts(t) ?? (hv ? 230 : 12);
    const a = w / u;
    return (pad) => (/^(PE|E)$/i.test(name(pad)) ? null : { current: a, kind: 'load', why: `${w} Вт / ${u} В` });
  }
  // Разъёмы сами тока не задают (ток задают детали по обе стороны).
  if (isConnector(c)) return null;
  // Модули с радио и платы с экраном.
  if (/ESP32|ESP-?WROOM|ESP8266|ESP-?12|NodeMCU|WeMos/i.test(t)) {
    const screen = /800\s*[×x]\s*480|экран|display|дисплей|TFT|LCD/i.test(t);
    const a = screen ? 1 : 0.5;
    const why = screen ? 'плата с экраном ≈1 А' : 'ESP32: пики радио ≈0,5 А';
    return (pad) => (P_SUPPLY.test(name(pad)) || P_GND.test(name(pad)) ? { current: a, kind: 'load', why } : null);
  }
  if (/arduino|\bnano\b|\buno\b|pro ?mini/i.test(t)) return (pad) => (P_SUPPLY.test(name(pad)) || P_GND.test(name(pad)) ? { current: 0.2, kind: 'load', why: 'Arduino ≈0,2 А' } : null);
  // Зуммер.
  if (/^(BZ|BA|HA)\d/i.test(c.ref) || (!passive && /зуммер|buzzer/i.test(`${c.value} ${c.footprint}`))) return () => ({ current: 0.03, kind: 'load', why: 'зуммер ≈30 мА' });
  // Прочие микросхемы и модули: выводы питания — немного.
  if (/^(U|DA|DD|IC|A|M)\d/i.test(c.ref)) return (pad) => (P_SUPPLY.test(name(pad)) || P_GND.test(name(pad)) ? { current: 0.05, kind: 'load', why: 'питание микросхемы ≈50 мА' } : null);
  return null;
}

/** Розетка, которая на самом деле разъём на плате (PinSocket, панелька) — не нагрузка. */
function isConnectorFootprintOnly(c: Component): boolean {
  return /PinSocket|Socket_Strip|DIP_Socket|IC_Socket/i.test(c.footprint) && !c.offBoard;
}

/** Силовые элементы пути (через них ток выносных деталей идёт по плате). */
const isPowerPath = (c: Component, t: string) => /^(F|FU|K|KV|VS|Q|VT)\d/i.test(c.ref) && !/MOC\d|оптосимистор|оптрон/i.test(t) && /предохранит|fuse|реле|relay|симистор|triac|BT1\d\d|BTA|BTB|тиристор|mosfet|IRF|IRL/i.test(t);

/* ---------------- токи выводов и цепей ---------------- */

/** Токи выводов детали (номер вывода → оценка). */
export function componentPinCurrents(p: Project, c: Component): Map<string, PinCurrent> {
  const out = new Map<string, PinCurrent>();
  const fp = p.footprints[c.footprint];
  if (!fp) return out;
  const rule = ruleFor(p, c);
  if (!rule) return out;
  for (const pad of fp.pads) {
    if (!c.padNets[pad.number]) continue;
    const e = rule(pad);
    if (e && e.current > 0) out.set(pad.number, e);
  }
  return out;
}

const cache = new WeakMap<Project, Map<Id, NetCurrent>>();

/** Токи цепей по плате (кеш по объекту проекта). Цепи без выводов на плате — не считаются. */
export function netCurrents(p: Project): Map<Id, NetCurrent> {
  const hit = cache.get(p);
  if (hit) return hit;
  type Acc = { onMax: number; onLoads: Map<Id, number>; offMax: number; offLoads: Map<Id, number>; parts: NetCurrent['parts']; path: boolean; connPins: number; otherPins: number; onBoard: boolean };
  const acc = new Map<Id, Acc>();
  const get = (n: Id) => acc.get(n) ?? acc.set(n, { onMax: 0, onLoads: new Map(), offMax: 0, offLoads: new Map(), parts: [], path: false, connPins: 0, otherPins: 0, onBoard: false }).get(n)!;
  for (const c of Object.values(p.components)) {
    const off = !!c.offBoard;
    const t = textOf(c);
    const conn = isConnector(c);
    const path = !off && isPowerPath(c, t);
    for (const n of Object.values(c.padNets)) {
      if (!p.nets[n]) continue;
      const a = get(n);
      if (!off) {
        a.onBoard = true;
        if (conn) a.connPins++;
        else a.otherPins++;
        if (path) a.path = true;
      }
    }
    const pins = componentPinCurrents(p, c);
    for (const [pin, e] of pins) {
      const n = c.padNets[pin];
      const a = get(n);
      if (!off && e.kind !== 'load') a.path = true;
      if (e.kind === 'load') {
        const m = off ? a.offLoads : a.onLoads;
        m.set(c.id, Math.max(m.get(c.id) ?? 0, e.current));
      } else if (off) a.offMax = Math.max(a.offMax, e.current);
      else a.onMax = Math.max(a.onMax, e.current);
      a.parts.push({ ref: c.ref, pin, current: e.current, kind: e.kind, why: e.why, offBoard: off });
    }
  }
  const out = new Map<Id, NetCurrent>();
  for (const [n, a] of acc) {
    if (!a.onBoard) continue;
    // Выносной потребитель: его ток идёт по плате, если на плате есть источник или силовой
    // элемент этой цепи либо ток проходит от разъёма к разъёму. Выносной источник (обмотка
    // трансформатора) — если через разъём он питает детали на плате.
    const useOff = a.path || a.connPins >= 2;
    const useOffSrc = useOff || (a.connPins >= 1 && a.otherPins >= 1);
    const sum = (m: Map<Id, number>) => [...m.values()].reduce((x, y) => x + y, 0);
    const maxPin = Math.max(a.onMax, ...a.onLoads.values(), ...(useOffSrc ? [a.offMax] : []), ...(useOff ? a.offLoads.values() : []), 0);
    const loads = sum(a.onLoads) + (useOff ? sum(a.offLoads) : 0);
    const manual = p.nets[n].current;
    const est = Math.max(maxPin, loads);
    const parts = a.parts.filter((x) => !x.offBoard || (x.kind === 'load' ? useOff : useOffSrc)).sort((x, y) => y.current - x.current);
    out.set(n, { net: n, current: manual ?? est, manual: manual !== undefined, parts, bySum: loads > maxPin + 1e-9, offBoard: parts.some((x) => x.offBoard) });
  }
  cache.set(p, out);
  return out;
}

/* ---------------- ширина по току ---------------- */

export const DEFAULT_COPPER_UM = 35;
export const DEFAULT_TEMP_RISE = 10;
export const DEFAULT_MAX_AUTO_WIDTH = 3;

/** Ширина дорожки наружного слоя под ток, мм (IPC-2221), с округлением вверх до 0,05 мм. */
export function widthForCurrent(amps: number, rules: Pick<DesignRules, 'copperThickness' | 'tempRise'> = {}): number {
  if (!(amps > 0)) return 0;
  const dT = rules.tempRise ?? DEFAULT_TEMP_RISE;
  const tMil = (rules.copperThickness ?? DEFAULT_COPPER_UM) / 25.4;
  const area = Math.pow(amps / (0.048 * Math.pow(dT, 0.44)), 1 / 0.725);
  const mm = (area / tMil) * 0.0254;
  return +(Math.ceil(mm / 0.05 - 1e-9) * 0.05).toFixed(2);
}

export interface NetWidth {
  /** Ширина для дорожек цепи, мм: по классу и по току, не больше предела. */
  width: number;
  /** Нужно по току (без предела), мм; 0 — ток неизвестен. */
  need: number;
  /** Ширина класса (не меньше минимума правил). */
  classWidth: number;
  current: number;
  /** По току нужно шире предела — дорожкой не провести, лучше провод или шина. */
  capped: boolean;
}

export function netWidth(p: Project, netId: Id | null | undefined): NetWidth {
  const classWidth = Math.max(netClassOf(p, netId).trackWidth, p.rules.minTrackWidth);
  const nc = netId ? netCurrents(p).get(netId) : undefined;
  const current = nc?.current ?? 0;
  const need = widthForCurrent(current, p.rules);
  const cap = p.rules.maxAutoWidth ?? DEFAULT_MAX_AUTO_WIDTH;
  const width = +Math.max(classWidth, Math.min(need, cap)).toFixed(3);
  return { width, need, classWidth, current, capped: need > cap + 1e-9 };
}

/** Кратко для подписи: «~2 А → 0,8 мм». */
export function currentLabel(w: NetWidth): string {
  const mm = (x: number) => String(+x.toFixed(2)).replace('.', ',');
  if (!w.current) return '';
  return `~${fmtA(w.current)} → ${w.capped ? `нужно ${mm(w.need)} мм` : `${mm(Math.max(w.need, 0))} мм`}`;
}

export { fmtA as formatAmps };
