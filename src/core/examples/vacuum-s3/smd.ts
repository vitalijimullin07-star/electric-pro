import { libraryFootprint } from '../../library';
import { addComponent, addDrawing, addRuleArea, addTrack, addVia, addZone, connectPad, ensureNet } from '../../model/edit';
import { netWidth } from '../../model/currents';
import { applyFit, fitTrackWidthsSafe } from '../../model/track-fit';
import { getWorld } from '../../model/world';
import { computeConnectivity } from '../../model/connectivity';
import { runDrc } from '../../model/drc';
import { autoroute, type RouteOptions, type RouteResult } from '../../router/autoroute';
import { autorouteWithZones } from '../../router/zone-aware';
import { createProject } from '../../model/project';
import { MAINS_CLASS, MAINS_CLEARANCE } from '../../model/rules';
import type { FootprintDef, PadDef, Project } from '../../model/types';
import { MOD_PINS } from './mod';
import { S3_FOOTPRINTS } from './parts';

/*
 * Пылесос S3 — контроллер для заводской сборки: всё на плате, без модулей (кроме самого
 * ESP32-S3-WROOM-1 — он и есть деталь для пайки). Выводы ESP32 — те же, что у платы на модулях
 * (MOD_PINS = vac_core.h прошивки 6.0), поэтому датчики, экран, пульт, часы, весы и I²C
 * работают без правок прошивки. Вместо модулей:
 *   MP1584 → AP63205 (5 В 2 А) и AMS1117-3.3;
 *   модули реле 30 А турбин → реле SLA-05VDC-SL-A на плате (ключи AO3400);
 *   МР248 → симисторы BTA24-600BW (TO-220, на радиаторе над компаундом) с MOC3023 и детектором
 *     нуля — прошивке нужен режим фазового управления вместо ШИМ 20 кГц (выводы те же, IO39/IO38);
 *   SSR G3MB клапанов → MOC3063 (включение в нуле) + BT136S-600E (DPAK) — как SSR, без правок;
 *   модуль DS3231 → DS3231SN# с батарейкой CR2032 на плате;
 *   модуль NAU7802 → NAU7802SGI на плате, тензодатчик — к разъёму;
 *   PCA9555 на платке → PCA9555DWR (SOIC-24, шаг 1,27 — проще развести).
 * Снаружи остаются: трансформатор 9 В, двигатели, магниты клапанов, реле розетки 30 А (на DIN,
 * катушка 12 В — ключ на плате), трансформаторы тока SCT-013, термисторы, SDP810/SDP811, бак,
 * экран ILI9488, пульт и по желанию плеер голоса DFPlayer (к разъёму пульта, как раньше).
 */

export interface SmdPart {
  ref: string;
  value: string;
  description: string;
  fp: string;
  pins: Record<string, string>;
  /** Раздел схемы. */
  group: SmdGroup;
  lcsc?: string;
  mpn?: string;
  /** Выводная деталь (паять руками или волной). */
  tht?: boolean;
}

export const SMD_GROUPS = ['Сеть и питание', 'ESP32-S3 и USB', 'Турбины', 'Клапаны 230 В', 'Аналоговые входы', 'I²C: расширитель, часы, весы', 'Пульт и экран'] as const;
export type SmdGroup = (typeof SMD_GROUPS)[number];

/* ---------------- свои корпуса ---------------- */

const smdPad = (number: string, name: string | undefined, x: number, y: number, w: number, h: number): PadDef => ({ number, name, type: 'smd', shape: 'rect', at: { x, y }, size: { x: w, y: h } });
const thtPad = (number: string, name: string | undefined, x: number, y: number, d: number, drill: number, square = false): PadDef => ({ number, name, type: 'tht', shape: square ? 'rect' : 'circle', at: { x, y }, size: { x: d, y: d }, drill });

function box(id: string, name: string, description: string, refPrefix: string, pads: PadDef[], w: number, h: number, tags: string[], source: string): FootprintDef {
  return {
    id,
    name,
    description,
    category: 'Проект',
    group: 'Пылесос S3 SMD',
    refPrefix,
    tags,
    pads,
    graphics: [
      { kind: 'rect', layer: 'F.Fab', a: { x: -w / 2, y: -h / 2 }, b: { x: w / 2, y: h / 2 }, width: 0.1 },
      { kind: 'rect', layer: 'F.Silk', a: { x: -w / 2 - 0.15, y: -h / 2 - 0.15 }, b: { x: w / 2 + 0.15, y: h / 2 + 0.15 }, width: 0.12 },
    ],
    // Габарит — корпус вместе с площадками и запасом 0,5 мм.
    courtyard: {
      min: { x: Math.min(-w / 2, ...pads.map((q) => q.at.x - q.size.x / 2)) - 0.5, y: Math.min(-h / 2, ...pads.map((q) => q.at.y - q.size.y / 2)) - 0.5 },
      max: { x: Math.max(w / 2, ...pads.map((q) => q.at.x + q.size.x / 2)) + 0.5, y: Math.max(h / 2, ...pads.map((q) => q.at.y + q.size.y / 2)) + 0.5 },
    },
    source,
    verified: false,
  };
}

/** Корпус из библиотеки с именами выводов: names[номер − 1]. */
function named(id: string, newId: string, names: string[]): FootprintDef {
  const f = libraryFootprint(id);
  if (!f) throw new Error(`нет корпуса ${id}`);
  return { ...f, id: newId, name: newId, pads: f.pads.map((q) => ({ ...q, name: names[Number(q.number) - 1] ?? q.name })) };
}

const MOC_NAMES = ['A', 'K', 'NC', 'MT2', 'NC', 'MT1'];

export const SMD_FOOTPRINTS: FootprintDef[] = [
  box(
    'Opto_SMD-6_P2.54mm',
    'Оптосимистор SMD-6',
    'Оптосимистор MOC30xxS в корпусе SMD-6 (DIP-6 с выводами «крыло чайки»): шаг 2,54, между рядами 10,2 мм',
    'U',
    MOC_NAMES.map((nm, i) => smdPad(String(i + 1), nm, i < 3 ? -5.1 : 5.1, i < 3 ? -2.54 + i * 2.54 : 2.54 - (i - 3) * 2.54, 2.0, 1.3)),
    7.0,
    8.9,
    ['moc3023', 'moc3063', 'opto-triac', 'smd'],
    'Lite-On MOC3023S-TA1, SMD-6P (сверить с даташитом)',
  ),
  box(
    'Sensor_MPXV5100DP',
    'MPXV5100DP',
    'Датчик давления NXP MPXV5100DP (корпус 1351, SOP-8 с двумя штуцерами): шаг 2,54, выводы 2 VS, 3 GND, 4 VOUT',
    'B',
    ['NC', 'VS', 'GND', 'VOUT', 'NC', 'NC', 'NC', 'NC'].map((nm, i) => smdPad(String(i + 1), nm, i < 4 ? -3.81 + i * 2.54 : 3.81 - (i - 4) * 2.54, i < 4 ? 5.4 : -5.4, 1.0, 2.2)),
    10.7,
    8.0,
    ['mpxv5100', 'pressure', 'smd'],
    'NXP MPXV5100 case 1351 (сверить)',
  ),
  box(
    'Relay_SLA-05VDC-SL-A',
    'Реле Songle SLA 30 А',
    'Реле Songle SLA-05VDC-SL-A (30 А 250 В ~, катушка 5 В 27 Ом) на плату: катушка 1–2, COM, NO',
    'K',
    [thtPad('1', 'COIL1', -10.2, -6.0, 2.4, 1.3, true), thtPad('2', 'COIL2', -10.2, 6.0, 2.4, 1.3), thtPad('3', 'COM', 12.1, -6.0, 3.6, 2.0), thtPad('4', 'NO', 12.1, 6.0, 3.6, 2.0)],
    32.0,
    27.6,
    ['relay', 'sla', '30a'],
    'Songle SLA, вариант PCB (сверить по даташиту)',
  ),
  box(
    'BAT_CR2032_BS-6',
    'Держатель CR2032',
    'Держатель батарейки CR2032 Q&J CR2032-BS-6-1 (SMD): «+» — две лапки, «−» — площадка на плате под батарейкой',
    'BT',
    [smdPad('1', '+', -14.7, 0, 2.5, 5.0), smdPad('1', '+', 14.7, 0, 2.5, 5.0), { number: '2', name: '-', type: 'smd', shape: 'circle', at: { x: 0, y: 0 }, size: { x: 12, y: 12 } }],
    28.0,
    21.0,
    ['cr2032', 'battery', 'smd'],
    'Q&J CR2032-BS-6-1 (сверить)',
  ),
  box(
    'Fuse_2410',
    'Предохранитель 2410',
    'Предохранитель SMD 2410 (6,1×2,5 мм), 250 В',
    'FU',
    [smdPad('1', undefined, -2.75, 0, 1.6, 2.9), smdPad('2', undefined, 2.75, 0, 1.6, 2.9)],
    6.1,
    2.6,
    ['fuse', '2410', 'smd'],
    'Корпус 2410 (сверить с выбранным предохранителем)',
  ),
  box(
    'TerminalBlock_1x02_P9.5mm',
    'Клеммник 2, 9,5 (30 А)',
    'Клеммник на плату 30 А 300 В, шаг 9,5 мм (DORABO DBT50P-9.5-2P): сеть и турбины',
    'XT',
    [thtPad('1', undefined, -4.75, 0, 3.4, 1.7, true), thtPad('2', undefined, 4.75, 0, 3.4, 1.7)],
    19.5,
    12.0,
    ['terminal', '30a', 'mains'],
    'DORABO DBT50P-9.5 (сверить)',
  ),
  named('SOIC-16W_7.5x10.3mm_P1.27mm', 'IC_DS3231_SOIC-16W', ['32K', 'VCC', 'INT', 'RST', 'NC5', 'NC6', 'NC7', 'NC8', 'NC9', 'NC10', 'NC11', 'NC12', 'GND', 'VBAT', 'SDA', 'SCL']),
  named('SOIC-16_3.9x9.9mm_P1.27mm', 'IC_NAU7802_SOP-16', ['REFP', 'VIN1N', 'VIN1P', 'VIN2N', 'VIN2P', 'VBG', 'REFN', 'AVSS', 'DRDY', 'SDIO', 'SCLK', 'XOUT', 'XIN', 'DVDD', 'VDDA', 'AVDD']),
  named('TO-252-2', 'Triac_DPAK', ['MT1', 'MT2', 'G']),
  named('TO-220-3_Vertical', 'Triac_TO-220', ['MT1', 'MT2', 'G']),
];

function footprint(id: string): FootprintDef {
  const f = SMD_FOOTPRINTS.find((x) => x.id === id) ?? S3_FOOTPRINTS.find((x) => x.id === id) ?? libraryFootprint(id);
  if (!f) throw new Error(`нет корпуса ${id}`);
  return f;
}

/* ---------------- детали ---------------- */

type G = SmdGroup;
const R0603: Record<string, [string, string]> = {
  '47k': ['C25819', '0603WAF4702T5E'],
  '10k': ['C25804', '0603WAF1002T5E'],
  '1k': ['C21190', '0603WAF1001T5E'],
  '100k': ['C25803', '0603WAF1003T5E'],
  '4,7k': ['C23162', '0603WAF4701T5E'],
  '5,1k': ['C23186', '0603WAF5101T5E'],
  '6,8k': ['C23212', '0603WAF6801T5E'],
  '220': ['C22962', '0603WAF2200T5E'],
  '100': ['C22775', '0603WAF1000T5E'],
};
const C0603: Record<string, [string, string]> = {
  '100 нФ': ['C14663', 'CC0603KRX7R9BB104'],
  '1 мкФ': ['C5673', 'CL10A105KA8NNNC'],
  '10 нФ': ['C1589', 'CL10B103KB8NNNC'],
  '1 нФ': ['C1588', 'CL10B102KB8NNNC'],
};
const R = (g: G, ref: string, value: string, description: string, a: string, b: string): SmdPart => ({ group: g, ref, value, description, fp: 'R_0603_1608Metric', pins: { '1': a, '2': b }, lcsc: R0603[value]?.[0], mpn: R0603[value]?.[1] });
const C = (g: G, ref: string, value: string, description: string, a: string, b: string): SmdPart => ({ group: g, ref, value, description, fp: 'C_0603_1608Metric', pins: { '1': a, '2': b }, lcsc: C0603[value]?.[0], mpn: C0603[value]?.[1] });
const C10u = (g: G, ref: string, description: string, a: string, b: string): SmdPart => ({ group: g, ref, value: '10 мкФ 16 В', description, fp: 'C_0805_2012Metric', pins: { '1': a, '2': b }, lcsc: 'C1713', mpn: 'CL21A106KOQNNNE' });
const C22u = (g: G, ref: string, description: string, a: string, b: string): SmdPart => ({ group: g, ref, value: '22 мкФ 10 В', description, fp: 'C_1206_3216Metric', pins: { '1': a, '2': b }, lcsc: 'C5672', mpn: 'CL31A226KPHNNNE' });
const D4148 = (g: G, ref: string, description: string, a: string, k: string): SmdPart => ({ group: g, ref, value: '1N4148W', description, fp: 'D_SOD-123', pins: { '1': k, '2': a }, lcsc: 'C81598', mpn: '1N4148W' });
const NFET = (g: G, ref: string, description: string, gate: string, s: string, d: string): SmdPart => ({ group: g, ref, value: 'AO3400A', description, fp: 'Q_AO3400_SOT-23', pins: { G: gate, S: s, D: d }, lcsc: 'C20917', mpn: 'AO3400A' });
const NPN = (g: G, ref: string, description: string, b: string, e: string, c: string): SmdPart => ({ group: g, ref, value: 'MMBT3904', description, fp: 'Q_MMBT3904_SOT-23', pins: { B: b, E: e, C: c }, lcsc: 'C81464', mpn: 'MMBT3904LT1G' });
const XH = (g: G, ref: string, value: string, description: string, nets: string[]): SmdPart => ({
  group: g,
  ref,
  value,
  description,
  fp: `JST_XH_B${nets.length}B-XH-A_1x${String(nets.length).padStart(2, '0')}_P2.5mm_Vertical`,
  pins: Object.fromEntries(nets.map((n, i) => [String(i + 1), n])),
  lcsc: { 2: 'C2908600', 4: 'C2908602', 5: 'C2908603', 6: 'C2908604' }[nets.length],
  mpn: `XH-${nets.length}A`,
  tht: true,
});
/** Разъёмный клеммник 5,08 (вилка на плату + ответная часть с винтами). */
const PLUG = (g: G, ref: string, value: string, description: string, nets: string[]): SmdPart => ({
  group: g,
  ref,
  value,
  description: description + '. Разъёмный: KF2EDGR (на плату) + KF2EDGK (ответная с винтами), 15 А 300 В',
  fp: `TerminalBlock_1x${String(nets.length).padStart(2, '0')}_P5.08mm`,
  pins: Object.fromEntries(nets.map((n, i) => [String(i + 1), n])),
  lcsc: { 2: 'C441204', 3: 'C441205' }[nets.length],
  mpn: `KF2EDGR-5.08-${nets.length}P`,
  tht: true,
});

/** Ключ на AO3400: затвор через 1 кОм, 100 кОм к земле (закрыт при сбросе), диод на катушке. */
function coilKey(g: G, n: number, sig: string, what: string, supply: string): SmdPart[] {
  return [
    R(g, `R${10 + 2 * n}`, '1k', `Затвор ключа: ${what}`, sig, `${sig}_G`),
    R(g, `R${11 + 2 * n}`, '100k', `Ключ закрыт, пока ESP32 не запущен: ${what}`, `${sig}_G`, 'GND'),
    NFET(g, `VT${2 + n}`, `Ключ катушки: ${what}`, `${sig}_G`, 'GND', `${sig}_D`),
    D4148(g, `VD${10 + n}`, `Диод на катушке: ${what}`, `${sig}_D`, supply),
  ];
}

export function smdParts(): SmdPart[] {
  const P = MOD_PINS;
  const out: SmdPart[] = [];
  const add = (...p: SmdPart[]) => out.push(...p);

  /* ---- сеть и питание ---- */
  const g1: G = 'Сеть и питание';
  add(
    { group: g1, ref: 'XT1', value: 'Сеть 230 В', description: 'Сеть после выключателя SA1: фаза (ток двух турбин, до 15 А) и ноль (трансформатор). Клеммник 30 А', fp: 'TerminalBlock_1x02_P9.5mm', pins: { '1': 'L', '2': 'N' }, lcsc: 'C496129', mpn: 'DBT50P-9.5-2P-GN-P', tht: true },
    { group: g1, ref: 'FU1', value: 'T1A 250 В', description: 'Предохранитель первичной обмотки трансформатора (SMD 2410, с задержкой)', fp: 'Fuse_2410', pins: { '1': 'L', '2': 'L_F' }, lcsc: 'C5220729', mpn: '2410 T1A/250V' },
    { group: g1, ref: 'RU1', value: '275 В ~', description: 'Варистор SMD 2220 (430 В): выбросы сети', fp: 'C_2220_5750Metric', pins: { '1': 'L_F', '2': 'N' }, lcsc: 'C2935529', mpn: 'RL2220A431K' },
    PLUG(g1, 'XT2', '~230 В на TV1', 'Первичная обмотка трансформатора TV1 (после предохранителя)', ['L_F', 'N']),
    PLUG(g1, 'XT3', '~9 В с TV1', 'Вторичная обмотка трансформатора TV1, 9 В 20 ВА', ['AC1', 'AC2']),
    ...([
      ['VD1', 'AC1', 'VRECT'],
      ['VD2', 'AC2', 'VRECT'],
      ['VD3', 'GND', 'AC1'],
      ['VD4', 'GND', 'AC2'],
    ] as const).map(([ref, a, k]): SmdPart => ({ group: g1, ref, value: 'SS310', description: 'Выпрямительный мост из диодов Шоттки 3 А 100 В', fp: 'D_SMA', pins: { '1': k, '2': a }, lcsc: 'C15874', mpn: 'SS310' })),
    { group: g1, ref: 'VD5', value: 'SS34', description: 'Развязка: до диода — пульсирующее напряжение для детектора нуля, после — накопитель', fp: 'D_SMA', pins: { '1': 'VIN', '2': 'VRECT' }, lcsc: 'C8678', mpn: 'SS34' },
    ...['C1', 'C2', 'C3'].map((ref): SmdPart => ({ group: g1, ref, value: '1000 мкФ 25 В', description: 'Накопитель после моста (SMD Ø12,5×13,5): три штуки — пульсации около 2 В при 0,6 А', fp: 'CP_Elec_12.5x13.5', pins: { '1': 'VIN', '2': 'GND' }, lcsc: 'C2904877', mpn: 'RVT1000UF25V34RV0112' })),
    { group: g1, ref: 'DA1', value: 'AP63205WU-7', description: 'Понижающий преобразователь 3,8–32 В → 5 В 2 А: реле, экран, пульт, датчик разрежения', fp: 'REG_AP63205_SOT-23-6', pins: { VIN: 'VIN', EN: 'VIN', GND: 'GND', SW: 'SW5', BST: 'BST', FB: '5V' }, lcsc: 'C2071056', mpn: 'AP63205WU-7' },
    { group: g1, ref: 'C4', value: '10 мкФ 35 В', description: 'Вход преобразователя (X5R 1206)', fp: 'C_1206_3216Metric', pins: { '1': 'VIN', '2': 'GND' }, lcsc: 'C92797', mpn: 'GMK316BJ106KL-T' },
    C(g1, 'C5', '100 нФ', 'Вольтодобавка BST–SW', 'BST', 'SW5'),
    { group: g1, ref: 'L1', value: '6,8 мкГн', description: 'Дроссель преобразователя, ток насыщения от 4 А', fp: 'L_SMD-0630_6.7x6.7mm', pins: { '1': 'SW5', '2': '5V' }, lcsc: 'C207841', mpn: 'SLO0630H6R8MTT' },
    C22u(g1, 'C6', 'Выход 5 В', '5V', 'GND'),
    C22u(g1, 'C7', 'Выход 5 В', '5V', 'GND'),
    { group: g1, ref: 'DA2', value: 'AMS1117-3.3', description: 'Стабилизатор 3,3 В 1 А: ESP32, датчики, PCA9555, часы, весы', fp: 'REG_AMS1117_SOT-223', pins: { GND: 'GND', OUT: '3V3', IN: '5V' }, lcsc: 'C6186', mpn: 'AMS1117-3.3' },
    C10u(g1, 'C8', 'Вход стабилизатора 3,3 В', '5V', 'GND'),
    C22u(g1, 'C9', 'Выход 3,3 В', '3V3', 'GND'),
    // Детектор нуля: со вторичной обмотки, до развязывающего диода.
    R(g1, 'R1', '47k', 'Детектор нуля: от выпрямителя к базе', 'VRECT', 'ZC_B'),
    R(g1, 'R2', '10k', 'Детектор нуля: база — земля (порог ≈3,7 В)', 'ZC_B', 'GND'),
    NPN(g1, 'VT1', 'Детектор нуля: у нуля сети транзистор закрыт — на входе «1» (IO48)', 'ZC_B', 'GND', 'ZC'),
    R(g1, 'R3', '10k', 'Детектор нуля: подтяжка к 3,3 В', '3V3', 'ZC'),
  );

  /* ---- ESP32-S3 и USB ---- */
  const g2: G = 'ESP32-S3 и USB';
  const a1: Record<string, string> = { '1': 'GND', '40': 'GND', '3V3': '3V3', EN: 'EN', IO19: 'USB_DN', IO20: 'USB_DP' };
  for (const [pin, net] of Object.entries(P)) a1[pin === 'TX' ? 'TXD0' : pin] = net;
  add(
    { group: g2, ref: 'A1', value: 'ESP32-S3-WROOM-1-N16R8', description: 'ESP32-S3, 16 МБ flash, 8 МБ PSRAM (IO35–IO37 заняты памятью). Выводы — как у платы на модулях (vac_core.h)', fp: 'Module_ESP32-S3-WROOM-1', pins: a1, lcsc: 'C2913202', mpn: 'ESP32-S3-WROOM-1-N16R8' },
    C10u(g2, 'C10', 'Питание ESP32-S3', '3V3', 'GND'),
    C(g2, 'C11', '100 нФ', 'Питание ESP32-S3', '3V3', 'GND'),
    R(g2, 'R4', '10k', 'EN: подтяжка', 'EN', '3V3'),
    C(g2, 'C12', '1 мкФ', 'EN: задержка сброса', 'EN', 'GND'),
    { group: g2, ref: 'SB1', value: 'Сброс', description: 'Кнопка сброса (EN)', fp: 'SW_PUSH_3x6mm_SMD', pins: { '1': 'EN', '4': 'GND' }, lcsc: 'C49234146', mpn: 'HX-3x6x3.5-CA-0.6-2.5N' },
    { group: g2, ref: 'SB2', value: 'Загрузка', description: 'Кнопка загрузчика (IO0 — он же CS касания): держать при сбросе — прошивка по USB', fp: 'SW_PUSH_3x6mm_SMD', pins: { '1': P.IO0, '4': 'GND' }, lcsc: 'C49234146', mpn: 'HX-3x6x3.5-CA-0.6-2.5N' },
    R(g2, 'R5', '10k', 'IO0 (CS касания): подтяжка — обычный запуск, касание не выбрано', P.IO0, '3V3'),
    { group: g2, ref: 'X1', value: 'micro-USB', description: 'micro-USB: прошивка и монитор порта (USB-Serial/JTAG ESP32-S3). От USB питается только логика', fp: 'USB_Micro-B_Receptacle_SMD', pins: { VBUS: 'VBUS', GND: 'GND', SHIELD: 'GND', 'D+': 'USB_DP', 'D-': 'USB_DN' }, lcsc: 'C145791', mpn: 'U-F-M5DD-Y-L1' },
    { group: g2, ref: 'VD6', value: 'USBLC6-2SC6', description: 'Защита USB от статики', fp: 'D_TVS_Array_SOT-23-6_ESD', pins: { '1': 'USB_DP', '6': 'USB_DP', '3': 'USB_DN', '4': 'USB_DN', '2': 'GND', '5': 'VBUS' }, lcsc: 'C7519', mpn: 'USBLC6-2SC6' },
    { group: g2, ref: 'VD7', value: 'SS14', description: 'Питание 5 В от USB (без сети — только прошивка); в USB не пропускает', fp: 'D_SMA', pins: { '1': '5V', '2': 'VBUS' }, lcsc: 'C2480', mpn: 'SS14' },
  );

  /* ---- турбины: реле 30 А и симисторы ---- */
  const g3: G = 'Турбины';
  for (const k of [1, 2]) {
    const sig = k === 1 ? P.IO1 : P.IO2; // RL1, RL2
    const gate = k === 1 ? P.IO39 : P.IO38; // T1, T2
    add(
      { group: g3, ref: `K${k}`, value: 'SLA-05VDC-SL-A', description: `Реле турбины ${k}: 30 А 250 В, катушка 5 В. В разрыв фазы перед симистором: отключение при аварии и пробое симистора`, fp: 'Relay_SLA-05VDC-SL-A', pins: { COIL1: '5V', COIL2: `${sig}_D`, COM: 'L', NO: `M${k}_L` }, lcsc: 'C250645', mpn: 'SLA-05VDC-SL-A', tht: true },
      ...coilKey(g3, k - 1, sig, `реле турбины ${k}`, '5V'),
      R(g3, `R${20 + k}`, '220', `Светодиод оптрона турбины ${k} (≈9 мА от вывода ESP32)`, gate, `${gate}_LED`),
      { group: g3, ref: `U${k}`, value: 'MOC3023S', description: `Оптосимистор случайной фазы: турбина ${k} (угол открытия — от детектора нуля)`, fp: 'Opto_SMD-6_P2.54mm', pins: { A: `${gate}_LED`, K: 'GND', MT1: `M${k}_R`, MT2: `G${k}` }, lcsc: 'C115469', mpn: 'MOC3023S-TA1' },
      { group: g3, ref: `R${22 + k}`, value: '360', description: `Резистор оптрона турбины ${k} (2010, 0,75 Вт, 400 В)`, fp: 'R_2010_5025Metric', pins: { '1': `M${k}_R`, '2': `M${k}_SW` }, lcsc: 'C230895', mpn: 'AC2010JK-07360RL' },
      { group: g3, ref: `VS${k}`, value: 'BTA24-600BWRG', description: `Симистор турбины ${k}: 25 А, изолированный TO-220, без снаббера. Ставится на радиатор, который выходит над компаундом`, fp: 'Triac_TO-220', pins: { MT1: `M${k}_L`, MT2: `M${k}_SW`, G: `G${k}` }, lcsc: 'C83957', mpn: 'BTA24-600BWRG', tht: true },
    );
  }
  add({ group: g3, ref: 'XT4', value: 'Турбины', description: 'К двигателям (через окна трансформаторов тока ТТ1, ТТ2): 1 — турбина 2, 2 — турбина 1; ноль двигателей — проводом мимо платы. Клеммник 30 А', fp: 'TerminalBlock_1x02_P9.5mm', pins: { '1': 'M2_SW', '2': 'M1_SW' }, lcsc: 'C496129', mpn: 'DBT50P-9.5-2P-GN-P', tht: true });
  // Реле розетки — на корпусе (30 А, катушка 12 В), на плате ключ.
  add(
    ...coilKey(g3, 2, P.IO42, 'реле розетки K3 (на корпусе, катушка 12 В)', 'VIN'),
    XH(g3, 'X2', 'Реле розетки', 'Катушка реле розетки инструмента K3 (30 А, 12 В, на корпусе): плюс 12 В и ключ', ['VIN', `${P.IO42}_D`]),
  );

  /* ---- клапаны 230 В: MOC3063 + BT136S (как SSR с включением в нуле) ---- */
  const g4: G = 'Клапаны 230 В';
  add({ group: g4, ref: 'FU2', value: 'T1A 250 В', description: 'Предохранитель магнитов клапанов', fp: 'Fuse_2410', pins: { '1': 'L', '2': 'L_V' }, lcsc: 'C5220729', mpn: '2410 T1A/250V' });
  for (const k of [1, 2]) {
    const sig = k === 1 ? P.IO40 : P.IO41; // VLV1, VLV2
    add(
      R(g4, `R${30 + k}`, '220', `Светодиод оптрона клапана ${k}`, sig, `${sig}_LED`),
      { group: g4, ref: `U${2 + k}`, value: 'MOC3063S', description: `Оптосимистор с включением в нуле: удерживающий магнит клапана ${k}`, fp: 'Opto_SMD-6_P2.54mm', pins: { A: `${sig}_LED`, K: 'GND', MT1: `V${k}_R`, MT2: `GV${k}` }, lcsc: 'C77950', mpn: 'MOC3063S-TA1' },
      { group: g4, ref: `R${32 + k}`, value: '360', description: `Резистор оптрона клапана ${k} (2010)`, fp: 'R_2010_5025Metric', pins: { '1': 'L_V', '2': `V${k}_R` }, lcsc: 'C230895', mpn: 'AC2010JK-07360RL' },
      { group: g4, ref: `R${34 + k}`, value: '1k', description: `Затвор — MT1 симистора клапана ${k}: помехи не откроют (2010 — между выводами сетевой зазор)`, fp: 'R_2010_5025Metric', pins: { '1': `GV${k}`, '2': `YV${k}` }, lcsc: 'C270963', mpn: '201007J0102T4E' },
      { group: g4, ref: `VS${2 + k}`, value: 'BT136S-600E', description: `Симистор магнита клапана ${k} (4 А, DPAK)`, fp: 'Triac_DPAK', pins: { MT2: 'L_V', MT1: `YV${k}`, G: `GV${k}` }, lcsc: 'C2980277', mpn: 'BT136S-600E' },
    );
  }
  add(PLUG(g4, 'XT5', 'Клапаны', 'Удерживающие магниты 230 В тарельчатых клапанов: 1 — клапан 2, 2 — клапан 1 (ноль магнитов — проводом мимо платы, как у двигателей)', ['YV2', 'YV1']));

  /* ---- аналоговые входы ---- */
  const g5: G = 'Аналоговые входы';
  add(
    XH(g5, 'X3', 'Ток: ТТ1 ТТ2 ТТ3', 'SCT-013 с выходом 1 В: ТТ1 и ТТ2 — турбины (020), ТТ3 — розетка (030); у каждого сигнал и середина 1,65 В', [`${P.IO4}_IN`, 'VMID', `${P.IO5}_IN`, 'VMID', `${P.IO6}_IN`, 'VMID']),
    ...[P.IO4, P.IO5, P.IO6].flatMap((s, i): SmdPart[] => [R(g5, `R${40 + i}`, '1k', `ТТ${i + 1}: фильтр АЦП`, `${s}_IN`, s), C(g5, `C${20 + i}`, '10 нФ', `ТТ${i + 1}: фильтр АЦП`, s, 'GND')]),
    R(g5, 'R43', '10k', 'Середина 1,65 В для ТТ', '3V3', 'VMID'),
    R(g5, 'R44', '10k', 'Середина 1,65 В для ТТ', 'VMID', 'GND'),
    C10u(g5, 'C23', 'Середина 1,65 В для ТТ', 'VMID', 'GND'),
    XH(g5, 'X4', 'Термисторы', 'Термисторы NTC 10 кОм B3950 на двигателях', [P.IO7, 'GND', P.IO8, 'GND']),
    R(g5, 'R45', '10k', 'Делитель термистора турбины 1', '3V3', P.IO7),
    R(g5, 'R46', '10k', 'Делитель термистора турбины 2', '3V3', P.IO8),
    C(g5, 'C24', '100 нФ', 'Фильтр термистора 1', P.IO7, 'GND'),
    C(g5, 'C25', '100 нФ', 'Фильтр термистора 2', P.IO8, 'GND'),
    XH(g5, 'X5', 'Бак', 'Бак: электроды E1 (уровень), E0 (общий), E2 (перелив), поплавок, земля', ['WL_E1', 'WL_E0', 'WL_E2', 'FLOAT', 'GND']),
    R(g5, 'R47', '1k', 'Электроды: выход раскачки (переменный ток — без электролиза)', P.IO46, 'WL_D'),
    { group: g5, ref: 'C26', value: '1 мкФ 50 В', description: 'Электроды: развязка по постоянному току (керамика)', fp: 'C_0805_2012Metric', pins: { '1': 'WL_D', '2': 'WL_E0' }, lcsc: 'C28323', mpn: 'CL21B105KBFNNNE' },
    R(g5, 'R48', '100k', 'Электрод уровня: защита входа', 'WL_E1', P.IO3),
    R(g5, 'R49', '100k', 'Электрод уровня: к земле', P.IO3, 'GND'),
    C(g5, 'C27', '1 нФ', 'Электрод уровня: фильтр', P.IO3, 'GND'),
    R(g5, 'R50', '100k', 'Электрод перелива: защита входа', 'WL_E2', P.IO9),
    R(g5, 'R51', '100k', 'Электрод перелива: к земле', P.IO9, 'GND'),
    C(g5, 'C28', '1 нФ', 'Электрод перелива: фильтр', P.IO9, 'GND'),
    { group: g5, ref: 'B1', value: 'MPXV5100DP', description: 'Датчик разрежения 0–100 кПа (SMD, два штуцера): трубка ко входу турбин; выход 0,2–4,7 В', fp: 'Sensor_MPXV5100DP', pins: { VS: '5V', GND: 'GND', VOUT: 'VAC_S' }, lcsc: 'C5202490', mpn: 'MPXV5100DP' },
    C(g5, 'C29', '1 мкФ', 'Питание датчика разрежения', '5V', 'GND'),
    R(g5, 'R52', '6,8k', 'Делитель датчика разрежения 4,7 → 2,8 В', 'VAC_S', P.IO10),
    R(g5, 'R53', '10k', 'Делитель датчика разрежения', P.IO10, 'GND'),
    C(g5, 'C30', '10 нФ', 'Фильтр датчика разрежения', P.IO10, 'GND'),
  );

  /* ---- I²C: расширитель, часы, весы, датчики ---- */
  const g6: G = 'I²C: расширитель, часы, весы';
  const sda = P.IO11;
  const scl = P.IO12;
  add(
    R(g6, 'R54', '4,7k', 'Подтяжка SDA', sda, '3V3'),
    R(g6, 'R55', '4,7k', 'Подтяжка SCL', scl, '3V3'),
    XH(g6, 'X6', 'SDP810 перепад', 'Датчик перепада на фильтре SDP810-500Pa (I²C 0x25)', ['3V3', 'GND', scl, sda]),
    XH(g6, 'X7', 'SDP811 расход', 'Расходомер SDP811-125Pa (I²C 0x26)', ['3V3', 'GND', scl, sda]),
    {
      group: g6,
      ref: 'DD1',
      value: 'PCA9555DWR',
      description: 'Расширитель I²C 0x20: кнопки пульта, кнопка энкодера, сброс экрана (P12), светодиод (P13), касание (P14), поплавок (P17). Подтяжки входов — свои 100 кОм',
      fp: 'IC_PCA9555_SOIC-24W',
      pins: { VCC: '3V3', GND: 'GND', SDA: sda, SCL: scl, A0: 'GND', A1: 'GND', A2: 'GND', P00: 'K1', P01: 'K2', P02: 'K3', P03: 'K4', P04: 'K5', P05: 'K6', P06: 'KT1', P07: 'KT2', P10: 'KOFF', P11: 'ENC_SW', P12: 'LCD_RST', P13: 'LED_K', P14: 'T_IRQ', P17: 'FLOAT' },
      lcsc: 'C2652274',
      mpn: 'PCA9555DWR',
    },
    C(g6, 'C31', '100 нФ', 'Питание PCA9555', '3V3', 'GND'),
    R(g6, 'R56', '1k', 'Светодиод состояния (горит, когда P13 — «0»)', '3V3', 'LED_A'),
    { group: g6, ref: 'HL1', value: 'зелёный', description: 'Светодиод состояния: мигает — работа, часто — неисправность', fp: 'LED_0603_1608Metric', pins: { A: 'LED_A', K: 'LED_K' }, lcsc: 'C12624', mpn: 'KT-0603G' },
    {
      group: g6,
      ref: 'DD2',
      value: 'DS3231SN#',
      description: 'Часы с термокомпенсированным кварцем (I²C 0x68): журнал, отчёт смены, «чёрный ящик». Выводы 5–12 — к земле (по даташиту)',
      fp: 'IC_DS3231_SOIC-16W',
      pins: { VCC: '3V3', GND: 'GND', SDA: sda, SCL: scl, VBAT: 'VBAT', NC5: 'GND', NC6: 'GND', NC7: 'GND', NC8: 'GND', NC9: 'GND', NC10: 'GND', NC11: 'GND', NC12: 'GND' },
      lcsc: 'C9866',
      mpn: 'DS3231SN#T&R',
    },
    C(g6, 'C32', '100 нФ', 'Питание DS3231', '3V3', 'GND'),
    { group: g6, ref: 'BT1', value: 'CR2032', description: 'Держатель батарейки часов', fp: 'BAT_CR2032_BS-6', pins: { '+': 'VBAT', '-': 'GND' }, lcsc: 'C70377', mpn: 'CR2032-BS-6-1' },
    {
      group: g6,
      ref: 'DD3',
      value: 'NAU7802SGI',
      description: 'АЦП 24 бит для тензодатчика (I²C 0x2A): масса бака. AVDD — свой стабилизатор (питание моста), выводы — сверить по даташиту',
      fp: 'IC_NAU7802_SOP-16',
      pins: { DVDD: '3V3', VDDA: '3V3', AVSS: 'GND', AVDD: 'LC_EP', REFP: 'LC_EP', REFN: 'GND', VIN1P: 'LC_AP', VIN1N: 'LC_AN', VIN2P: 'GND', VIN2N: 'GND', VBG: 'NAU_VBG', SDIO: sda, SCLK: scl },
      lcsc: 'C2614351',
      mpn: 'NAU7802SGI',
    },
    C(g6, 'C33', '100 нФ', 'Питание NAU7802 (DVDD)', '3V3', 'GND'),
    C(g6, 'C34', '1 мкФ', 'Питание NAU7802 (VDDA)', '3V3', 'GND'),
    C(g6, 'C35', '1 мкФ', 'Выход стабилизатора AVDD — питание моста', 'LC_EP', 'GND'),
    C(g6, 'C36', '100 нФ', 'Опорное напряжение VBG', 'NAU_VBG', 'GND'),
    C(g6, 'C37', '100 нФ', 'Фильтр входа тензодатчика (дифференциальный)', 'LC_AP', 'LC_AN'),
    XH(g6, 'X8', 'Тензодатчик', 'Тензодатчик-балка 50 кг под колесом бака: E+, E−, A−, A+', ['LC_EP', 'GND', 'LC_AN', 'LC_AP']),
  );

  /* ---- пульт и экран ---- */
  const g7: G = 'Пульт и экран';
  add(
    {
      group: g7,
      ref: 'X9',
      value: 'Пульт',
      description: 'Пульт — плоский кабель 2×10 (IDC): 5 В, земля, UART (голос DFPlayer или экран 7″), зуммер, энкодер, кнопки 1–6, «Турбина 1/2», «Выкл», кнопка энкодера',
      fp: 'IDC-Header_2x10_P2.54mm_Vertical',
      pins: { '1': '5V', '2': '5V', '3': 'GND', '4': 'GND', '5': P.IO13, '6': P.IO14, '7': 'GND', '8': 'BZ_K', '9': P.IO21, '10': P.IO47, '11': 'K1', '12': 'K2', '13': 'K3', '14': 'K4', '15': 'K5', '16': 'K6', '17': 'KT1', '18': 'KT2', '19': 'KOFF', '20': 'ENC_SW' },
      lcsc: 'C2977593',
      mpn: 'DC3-2.54-20PAS',
      tht: true,
    },
    R(g7, 'R57', '10k', 'Подтяжка энкодера A', P.IO21, '3V3'),
    R(g7, 'R58', '10k', 'Подтяжка энкодера B', P.IO47, '3V3'),
    C(g7, 'C38', '10 нФ', 'Фильтр энкодера A', P.IO21, 'GND'),
    C(g7, 'C39', '10 нФ', 'Фильтр энкодера B', P.IO47, 'GND'),
    R(g7, 'R59', '1k', 'База ключа зуммера', P.IO45, 'BZ_B'),
    NPN(g7, 'VT5', 'Ключ зуммера на пульте', 'BZ_B', 'GND', 'BZ_K'),
    D4148(g7, 'VD13', 'Диод на катушке зуммера', 'BZ_K', '5V'),
    {
      group: g7,
      ref: 'X10',
      value: 'Экран ILI9488',
      description: 'Экран 3,5″ 480×320 ILI9488 SPI с касанием XPT2046 (порядок выводов как у экрана): 9 SDO не подключён. Кабель не длиннее 15–20 см',
      fp: 'PinHeader_1x14_P2.54mm',
      pins: { '1': '5V', '2': 'GND', '3': P.TX, '4': 'LCD_RST', '5': P.IO18, '6': P.IO16, '7': P.IO15, '8': '3V3', '10': P.IO15, '11': P.IO0, '12': P.IO16, '13': P.IO17, '14': 'T_IRQ' },
      lcsc: 'C22465874',
      mpn: 'PZ254V-11-14P',
      tht: true,
    },
    R(g7, 'R60', '10k', 'Сброс экрана: подтяжка (сбрасывает PCA9555, P12)', 'LCD_RST', '3V3'),
  );
  return out;
}

const MAINS_NETS = ['L', 'N', 'L_F', 'L_V', 'M1_L', 'M2_L', 'M1_SW', 'M2_SW', 'M1_R', 'M2_R', 'G1', 'G2', 'V1_R', 'V2_R', 'GV1', 'GV2', 'YV1', 'YV2'];
const POWER_NETS = ['GND', '3V3', '5V', 'VIN', 'VRECT', 'AC1', 'AC2', 'SW5', 'VBUS'];

/** Проект без дорожек: детали по разделам, цепи, артикулы LCSC в полях. */
export function buildVacuumS3Smd(): Project {
  const parts = smdParts();
  const p = createProject({ name: 'Пылесос S3 SMD (заводская сборка)', width: 160, height: 110, copperLayers: 2, cornerRadius: 2 });
  p.meta.author = 'Plata';
  p.meta.description =
    'Контроллер пылесоса S3 для заводской сборки без модулей: ESP32-S3-WROOM-1-N16R8, AP63205 + AMS1117, реле SLA 30 А, симисторы BTA24 (TO-220 на радиаторе) с MOC3023, клапаны 230 В через MOC3063 + BT136S, DS3231, NAU7802, PCA9555, MPXV5100DP. Выводы ESP32 — как у платы на модулях (прошивка 6.0).';
  p.netClasses.Mains = { ...MAINS_CLASS, trackWidth: 1.0, clearance: 1.3 };
  p.rules.classClearances = [{ a: 'Mains', b: '*', clearance: MAINS_CLEARANCE }];
  for (const name of MAINS_NETS) ensureNet(p, name, { netClass: 'Mains' });
  for (const name of POWER_NETS) ensureNet(p, name, { netClass: 'Power' });
  // Детали — рядами по разделам (расставлять будут в EasyEDA).
  let y = 5;
  for (const g of SMD_GROUPS) {
    let x = 5;
    let rowH = 0;
    for (const part of parts.filter((q) => q.group === g)) {
      const fp = footprint(part.fp);
      const cy = fp.courtyard ?? { min: { x: -2, y: -2 }, max: { x: 2, y: 2 } };
      const w = cy.max.x - cy.min.x + 1.5;
      const h = cy.max.y - cy.min.y + 1.5;
      if (x + w > 155) {
        x = 5;
        y += rowH;
        rowH = 0;
      }
      const c = addComponent(p, fp, { x: +(x - cy.min.x).toFixed(2), y: +(y - cy.min.y).toFixed(2) }, { ref: part.ref, value: part.value, description: part.description });
      c.fields = { ...(part.lcsc ? { LCSC: part.lcsc } : {}), ...(part.mpn ? { 'Manufacturer Part': part.mpn } : {}), Раздел: part.group };
      x += w;
      rowH = Math.max(rowH, h);
      const f = p.footprints[c.footprint];
      for (const [pin, net] of Object.entries(part.pins)) {
        const byName = f.pads.filter((q) => q.type !== 'npth' && q.name === pin);
        const pads = byName.length ? byName : f.pads.filter((q) => q.number === pin);
        if (!pads.length) throw new Error(`${part.ref}: нет вывода ${pin}`);
        const n = ensureNet(p, net);
        for (const q of pads) connectPad(p, c.id, q.number, n.id);
      }
    }
    y += rowH + 4;
  }
  p.board.outline = [
    { x: 0, y: 0 },
    { x: 160, y: 0 },
    { x: 160, y: Math.max(110, y + 2) },
    { x: 0, y: Math.max(110, y + 2) },
  ];
  return structuredClone(p);
}

/* ---------------- плата: компактная расстановка, разводка, подписи ---------------- */

export const SMD_BOARD = { w: 146, h: 100 };

/**
 * Места сетевой части и крупных деталей: [x, y, поворот]. Сеть — полосой у верхнего края
 * (реле контактами вверх, симисторы турбин — тыльной стороной к краю, под общий радиатор над
 * компаундом), оптроны — поперёк границы, логика ниже; ESP32 — антенной за нижний край.
 */
export const SMD_PLACE: Record<string, [number, number, number]> = {
  // Левая колонка: сеть, трансформатор, клапаны.
  XT1: [11, 7.5, 0],
  FU1: [5.5, 17.5, 0],
  RU1: [15.5, 17.5, 0],
  XT5: [11, 26, 0],
  XT2: [11, 36.5, 0],
  FU2: [25, 9, 90],
  VS3: [25, 20, 0],
  VS4: [35, 20, 0],
  R35: [25, 29, 180],
  R36: [35, 29, 180],
  R33: [19.5, 30.5, 270],
  R34: [30, 30.5, 270],
  U3: [23.5, 42, 90],
  U4: [34, 42, 90],
  // Реле контактами вверх, обмотками вниз, к логике.
  K1: [53.5, 17.5, 90],
  K2: [82.4, 17.5, 90],
  // Симисторы турбин — тыльной стороной к краю (общий радиатор над компаундом).
  VS1: [102.5, 7.5, 0],
  VS2: [115, 7.5, 0],
  R23: [100, 15, 90],
  R24: [112.5, 15, 90],
  U1: [102.5, 26, 90],
  U2: [115, 26, 90],
  XT4: [135.5, 8, 0],
  A1: [70, 87.5, 180],
  // Разъёмы и крупное в логике: USB-C у нижнего края рядом с выводами USB модуля, пульт и экран — к краям.
  X1: [104, 96.5, 0],
  // Блок питания: накопители столбиком у левого края, клеммник 9 В над ними.
  C1: [8.5, 54, 0],
  C2: [8.5, 68, 0],
  C3: [8.5, 82, 0],
  XT3: [24, 54, 0],
  BT1: [129.5, 88, 0],
  X9: [20, 94.5, 0],
  X10: [143, 52, 90],
};

/** Граница сети: всё, что внутри, — только цепи 230 В (до логики ещё 6 мм правила классов). */
const MAINS_ZONE = [
  { x: 0, y: 0 },
  { x: 146, y: 0 },
  { x: 146, y: 16 },
  { x: 121.5, y: 16 },
  { x: 121.5, y: 23.5 },
  { x: 97, y: 23.5 },
  { x: 97, y: 13 },
  { x: 41, y: 13 },
  { x: 41, y: 40.5 },
  { x: 0, y: 40.5 },
];

/** Короткая подпись номинала для шелкографии: без корпуса и напряжения. */
export function silkLabel(value: string): string {
  if (/^~?\d+ В/.test(value)) return value.replace(/^(~?\d+) В.*$/, '$1В');
  if (value === 'зелёный') return 'LED';
  let v = value.replace(/\s*\d+\s*В$/, '').replace(/\s+(?=[мнкпμ]{0,2}[ФГ]|Ом)/g, '');
  v = v.replace(/^(\d+),(\d)k$/, '$1k$2');
  if (/^ESP32-S3/.test(v)) return 'ESP32-S3';
  return v.replace(/-7$|DWR$|SN#$|SGI$|-TA1$|WRG$|LT1G$/, '').replace(/^SLA-05VDC-SL-A$/, 'SLA 5V').replace(/^(\d+)\s*мкФ$/, '$1мкФ');
}

/** Ставит сеть и крупные детали, контур, правила, зоны, землю; остальное расставит autoplace. */
export function layoutVacuumS3Smd(p0: Project): Project {
  const p = structuredClone(p0);
  const { w, h } = SMD_BOARD;
  p.board.outline = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  p.board.cornerRadius = 2;
  // Ток турбин (до 7,5 А каждая) идёт по плате: медь 70 мкм, нагрев 20 °C, ширина по IPC-2221.
  p.rules.copperThickness = 70;
  p.rules.tempRise = 20;
  p.rules.maxAutoWidth = 4;
  p.rules.edgeClearance = 0.4;
  p.netClasses.Mains = { ...p.netClasses.Mains, clearance: 0.7, trackWidth: 0.5, viaDiameter: 1.6, viaDrill: 0.8 };
  p.netClasses.Power = { ...p.netClasses.Power, trackWidth: 0.4 };
  const cur: Record<string, number> = { L_F: 0.2, L: 15, M1_L: 7.5, M2_L: 7.5, M1_SW: 7.5, M2_SW: 7.5, L_V: 0.5, YV1: 0.3, YV2: 0.3, N: 0.5, AC1: 1.2, AC2: 1.2, VRECT: 1.2, VIN: 0.9, SW5: 1.2, '5V': 1.2, '3V3': 0.5, GND: 1.2 };
  for (const n of Object.values(p.nets)) if (cur[n.name]) n.current = cur[n.name];
  for (const c of Object.values(p.components)) {
    const at = SMD_PLACE[c.ref];
    if (at) {
      c.at = { x: at[0], y: at[1] };
      c.rotation = at[2];
      c.locked = true;
    }
    c.hideRef = true;
    c.hideValue = true;
  }
  addRuleArea(p, { name: 'Сеть 230 В', outline: MAINS_ZONE, onlyClasses: ['Mains'], showLabel: false });
  // Антенна ESP32 за нижним краем: под модулем у края меди нет.
  addRuleArea(p, { name: 'Антенна ESP32-S3', outline: [{ x: 60, y: 93 }, { x: 80, y: 93 }, { x: 80, y: h }, { x: 60, y: h }], keepoutTracks: true, keepoutVias: true, showLabel: false });
  return structuredClone(p);
}

/** Земля заливкой с двух сторон в низковольтной части. */
export function addGroundZones(p0: Project): Project {
  const p = structuredClone(p0);
  const gnd = ensureNet(p, 'GND').id;
  const { w, h } = SMD_BOARD;
  // Граница сети, отодвинутая на 6 мм вниз, — дальше начинается земля.
  const outline = [
    { x: 0.5, y: 46.5 },
    { x: 47.5, y: 46.5 },
    { x: 47.5, y: 19.5 },
    { x: 91, y: 19.5 },
    { x: 91, y: 30 },
    { x: 127.5, y: 30 },
    { x: 127.5, y: 22.5 },
    { x: w - 0.5, y: 22.5 },
    { x: w - 0.5, y: h - 0.5 },
    { x: 0.5, y: h - 0.5 },
  ];
  addZone(p, { name: 'Земля снизу', layer: 'B.Cu', net: gnd, outline, clearance: 0.3, minWidth: 0.25, priority: 0 });
  addZone(p, { name: 'Земля сверху', layer: 'F.Cu', net: gnd, outline, clearance: 0.3, minWidth: 0.25, priority: 0 });
  return structuredClone(p);
}

/**
 * Подписи номиналов на шелкографии: у каждой детали — номинал (у микросхем, диодов и
 * транзисторов — название, у разъёмов — назначение), без корпуса и напряжения. Место — сверху,
 * снизу, слева или справа от габарита, где подпись не задевает площадки, габариты и другие подписи.
 */
export function addValueLabels(p0: Project): Project {
  const p = structuredClone(p0);
  for (const [id, d] of Object.entries(p.drawings)) if (d.kind === 'text' && d.layer === 'F.Silk') delete p.drawings[id];
  const world = getWorld(p);
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const pads: Box[] = world.pads.map((q) => {
    const b = q.shape.box;
    return { x0: b.minX - 0.2, y0: b.minY - 0.2, x1: b.maxX + 0.2, y1: b.maxY + 0.2 };
  });
  const bodies: Box[] = world.components.map((wc) => {
    const xs = wc.outline.map((v) => v.x);
    const ys = wc.outline.map((v) => v.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  });
  const used: Box[] = [];
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const H = 0.9;
  const big = 1.4;
  const { w, h } = SMD_BOARD;
  for (const wc of world.components) {
    const c = wc.component;
    const text = silkLabel(c.value);
    if (!text) continue;
    const b = bodies[world.components.indexOf(wc)];
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const size = Math.min(bw, bh) > 8 ? big : H;
    const len = text.length * size * 0.75;
    // Крупные детали — надпись на корпусе (по центру, если там нет площадок), мелкие — рядом.
    const cand: { x: number; y: number; rot: number }[] = [
      { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, rot: bw >= bh ? 0 : 90 },
      { x: (b.x0 + b.x1) / 2, y: b.y0 - size * 0.8, rot: 0 },
      { x: (b.x0 + b.x1) / 2, y: b.y1 + size * 0.8, rot: 0 },
      { x: b.x0 - len / 2 - 0.4, y: (b.y0 + b.y1) / 2, rot: 0 },
      { x: b.x1 + len / 2 + 0.4, y: (b.y0 + b.y1) / 2, rot: 0 },
      { x: b.x0 - size * 0.8, y: (b.y0 + b.y1) / 2, rot: 90 },
      { x: b.x1 + size * 0.8, y: (b.y0 + b.y1) / 2, rot: 90 },
    ];
    let placed = false;
    for (const [k, q] of cand.entries()) {
      const hw = (q.rot ? size : len) / 2 + 0.1;
      const hh = (q.rot ? len : size) / 2 + 0.1;
      const box = { x0: q.x - hw, y0: q.y - hh, x1: q.x + hw, y1: q.y + hh };
      if (box.x0 < 0.3 || box.y0 < 0.3 || box.x1 > w - 0.3 || box.y1 > h - 0.3) continue;
      if (k === 0 && (bw < len + 1 || bh < size + 1) && !(q.rot && bh >= len + 1 && bw >= size + 1)) continue;
      if (pads.some((x) => hit(box, x)) || used.some((x) => hit(box, x))) continue;
      if (k > 0 && bodies.some((x, i) => i !== world.components.indexOf(wc) && hit(box, x))) continue;
      used.push(box);
      addDrawing(p, { kind: 'text', layer: 'F.Silk', at: { x: +q.x.toFixed(2), y: +q.y.toFixed(2) }, text, size, thickness: 0.15, rotation: q.rot || undefined, align: 'center' });
      placed = true;
      break;
    }
    if (!placed) addDrawing(p, { kind: 'text', layer: 'F.Fab', at: { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }, text: `${c.ref} ${text}`, size: 0.6, thickness: 0.1, align: 'center' });
  }
  return structuredClone(p);
}

/**
 * Сужение у выводов с шагом 2,54 (TO-220): последний отрезок дорожки длиной len у площадки этих
 * деталей — шириной width, иначе широкая дорожка подходит к соседнему выводу ближе зазора.
 */
function neckAtPads(p: Project, r: Pick<RouteResult, 'tracks' | 'vias'>, refs: string[], width: number, len: number): Pick<RouteResult, 'tracks' | 'vias'> {
  const pads = getWorld(p).pads.filter((q) => refs.includes(q.component.ref)).map((q) => q.center);
  const near = (v: { x: number; y: number }) => pads.some((c) => Math.hypot(c.x - v.x, c.y - v.y) < 0.05);
  const tracks: RouteResult['tracks'] = [];
  for (const t of r.tracks) {
    let pts = [...t.points];
    const cut = (from: 'start' | 'end') => {
      const a = from === 'start' ? pts[0] : pts[pts.length - 1];
      if (!near(a)) return;
      const b = from === 'start' ? pts[1] : pts[pts.length - 2];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const k = Math.min(1, len / d);
      const m = { x: +(a.x + (b.x - a.x) * k).toFixed(4), y: +(a.y + (b.y - a.y) * k).toFixed(4) };
      tracks.push({ ...t, width: Math.min(t.width, width), points: [a, m] });
      if (k >= 1) pts = from === 'start' ? pts.slice(1) : pts.slice(0, -1);
      else if (from === 'start') pts[0] = m;
      else pts[pts.length - 1] = m;
    };
    cut('start');
    if (pts.length >= 2) cut('end');
    if (pts.length >= 2) tracks.push({ ...t, points: pts });
  }
  return { tracks, vias: r.vias };
}

/** Переходное 0,6/0,3 рядом с каждой планарной площадкой земли, где оно встаёт с зазором 0,25. */
export function groundVias(p0: Project): { project: Project; vias: number } {
  const p = structuredClone(p0);
  const gnd = Object.values(p.nets).find((n) => n.name === 'GND');
  if (!gnd) return { project: p, vias: 0 };
  const world = getWorld(p);
  const conn = computeConnectivity(p);
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const obst: Box[] = [];
  for (const q of world.pads) if (q.net !== gnd.id) obst.push({ x0: q.shape.box.minX, y0: q.shape.box.minY, x1: q.shape.box.maxX, y1: q.shape.box.maxY });
  for (const [id, t] of Object.entries(p.tracks))
    if (conn.itemNet.get(id) !== gnd.id)
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1];
        const b = t.points[i];
        const m = t.width / 2;
        obst.push({ x0: Math.min(a.x, b.x) - m, y0: Math.min(a.y, b.y) - m, x1: Math.max(a.x, b.x) + m, y1: Math.max(a.y, b.y) + m });
      }
  for (const v of Object.values(p.vias)) obst.push({ x0: v.at.x - v.diameter / 2, y0: v.at.y - v.diameter / 2, x1: v.at.x + v.diameter / 2, y1: v.at.y + v.diameter / 2 });
  for (const a of Object.values(p.ruleAreas))
    if (a.keepoutVias || (a.onlyClasses && !a.onlyClasses.includes(gnd.netClass))) {
      const xs = a.outline.map((v) => v.x);
      const ys = a.outline.map((v) => v.y);
      obst.push({ x0: Math.min(...xs) - 6, y0: Math.min(...ys) - 6, x1: Math.max(...xs) + 6, y1: Math.max(...ys) + 6 });
    }
  const bodies = world.pads.filter((q) => q.net === gnd.id);
  const xs = p.board.outline.map((v) => v.x);
  const ys = p.board.outline.map((v) => v.y);
  const clear = (c: { x: number; y: number }, r: number, gap: number) =>
    c.x - r > Math.min(...xs) + 0.6 && c.x + r < Math.max(...xs) - 0.6 && c.y - r > Math.min(...ys) + 0.6 && c.y + r < Math.max(...ys) - 0.6 &&
    obst.every((b) => {
      const dx = Math.max(b.x0 - c.x, 0, c.x - b.x1);
      const dy = Math.max(b.y0 - c.y, 0, c.y - b.y1);
      return Math.hypot(dx, dy) >= r + gap;
    });
  let n = 0;
  for (const q of bodies) {
    if (q.drill) continue;
    const b = q.shape.box;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    let done = false;
    for (const r of [0.9, 1.2, 1.6, 2.1]) {
      for (let k = 0; k < 8 && !done; k++) {
        const a = (k * Math.PI) / 4;
        const at = { x: +(cx + Math.cos(a) * (r + (b.maxX - b.minX) / 2 * Math.abs(Math.cos(a)))).toFixed(3), y: +(cy + Math.sin(a) * (r + (b.maxY - b.minY) / 2 * Math.abs(Math.sin(a)))).toFixed(3) };
        if (!clear(at, 0.3, 0.3)) continue;
        // Отвод от площадки до переходного не должен задевать чужое.
        const mid = { x: (at.x + cx) / 2, y: (at.y + cy) / 2 };
        if (!clear(mid, 0.15, 0.25)) continue;
        addTrack(p, { layer: q.layers.includes('F.Cu') ? 'F.Cu' : 'B.Cu', width: 0.3, points: [{ x: cx, y: cy }, at] });
        addVia(p, { at, diameter: 0.6, drill: 0.3 });
        obst.push({ x0: at.x - 0.3, y0: at.y - 0.3, x1: at.x + 0.3, y1: at.y + 0.3 });
        n++;
        done = true;
      }
      if (done) break;
    }
  }
  return { project: structuredClone(p), vias: n };
}

/**
 * Отрезанные площадки земли (в тесноте заливка до них не дотекает) — переходным рядом с площадкой
 * на заливку другого слоя: перебор мест вокруг площадки, место годится, если DRC не хуже и
 * островков земли стало меньше.
 */
export function stitchGround(p0: Project): { project: Project; vias: number; left: number } {
  let p = structuredClone(p0);
  const gnd = Object.values(p.nets).find((n) => n.name === 'GND');
  if (!gnd) return { project: p, vias: 0, left: 0 };
  const errs = (q: Project) => runDrc(q).markers.filter((m) => m.severity === 'error' && m.code !== 'unrouted').length;
  const islandsOf = (q: Project) => computeConnectivity(q).nets.get(gnd.id)?.islands ?? [];
  let vias = 0;
  let base = errs(p);
  for (let guard = 0; guard < 20; guard++) {
    const isl = [...islandsOf(p)].sort((a, b) => b.pads.length - a.pads.length);
    if (isl.length <= 1) break;
    const world = getWorld(p);
    const byKey = new Map(world.pads.map((q) => [q.key, q]));
    let fixed = false;
    for (const island of isl.slice(1)) {
      for (const key of island.pads) {
        const wp = byKey.get(key);
        if (!wp) continue;
        const layer = wp.layers.includes('F.Cu') ? 'F.Cu' : 'B.Cu';
        for (const r of [0.8, 1.1, 1.5, 2.0, 2.6, 3.3, 4.2, 5.2]) {
          for (let k = 0; k < 24 && !fixed; k++) {
            const a = (k * Math.PI) / 12;
            const at = { x: +(wp.center.x + r * Math.cos(a)).toFixed(3), y: +(wp.center.y + r * Math.sin(a)).toFixed(3) };
            const q = structuredClone(p);
            addTrack(q, { layer, width: 0.25, points: [wp.center, at] });
            addVia(q, { at, diameter: 0.6, drill: 0.3 });
            const q2 = structuredClone(q);
            if (islandsOf(q2).length >= isl.length) continue;
            if (errs(q2) > base) continue;
            p = q2;
            base = errs(p);
            vias++;
            fixed = true;
          }
          if (fixed) break;
        }
        if (fixed) break;
      }
      if (fixed) break;
    }
    // Второй способ: одиночное переходное там, где кусок заливки островка на одном слое лежит над
    // основной землёй на другом (точки сетки 0,8 мм в 8 мм от площадок островка).
    if (!fixed)
      for (const island of isl.slice(1)) {
        const centers = island.pads.map((k) => byKey.get(k)?.center).filter((c): c is { x: number; y: number } => !!c);
        const seen = new Set<string>();
        for (const c of centers)
          for (let dy = -8; dy <= 8 && !fixed; dy += 0.8)
            for (let dx = -8; dx <= 8 && !fixed; dx += 0.8) {
              const at = { x: +(Math.round((c.x + dx) / 0.4) * 0.4).toFixed(2), y: +(Math.round((c.y + dy) / 0.4) * 0.4).toFixed(2) };
              const key = `${at.x},${at.y}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const q = structuredClone(p);
              addVia(q, { at, diameter: 0.6, drill: 0.3 });
              const q2 = structuredClone(q);
              if (islandsOf(q2).length >= isl.length) continue;
              if (errs(q2) > base) continue;
              p = q2;
              base = errs(p);
              vias++;
              fixed = true;
            }
        if (fixed) break;
      }
    if (!fixed) break;
  }
  return { project: p, vias, left: Math.max(0, islandsOf(p).length - 1) };
}

function applyRoute(p: Project, r: Pick<RouteResult, 'tracks' | 'vias'>): Project {
  for (const t of r.tracks) addTrack(p, t);
  for (const v of r.vias) addVia(p, v);
  return structuredClone(p);
}

function withMains(q: Project, width: number, clearance: number, others?: number): Project {
  const c = structuredClone(q);
  // Запрет под антенной — для трассировщика на 0,3 мм шире: он проверяет центры клеток, а у дорожки есть ширина.
  for (const a of Object.values(c.ruleAreas))
    if (a.keepoutTracks) {
      const xs = a.outline.map((v) => v.x);
      const ys = a.outline.map((v) => v.y);
      const [x0, x1, y0, y1] = [Math.min(...xs) - 0.3, Math.max(...xs) + 0.3, Math.min(...ys) - 0.3, Math.max(...ys) + 0.3];
      a.outline = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    }
  c.netClasses.Mains = { ...c.netClasses.Mains, trackWidth: width, clearance };
  if (others) for (const k of Object.keys(c.netClasses)) if (k !== 'Mains') c.netClasses[k] = { ...c.netClasses[k], trackWidth: others };
  return c;
}

/**
 * Разводка по этапам: ток турбин — 2 мм; остальная сеть — 0,5 мм с запасом 1,3; выпрямитель —
 * 0,4 мм на сетке 0,635; USB — на сетке 0,25; логика — 0,2 мм на сетке 0,4233 (земля — заливкой),
 * потом расширение по току.
 */
export async function routeVacuumS3Smd(p0: Project, o: { iterations?: number; extra?: RouteOptions; onStage?: (name: string, p: Project) => void } = {}): Promise<{ project: Project; report: string[]; failed: number }> {
  let p = structuredClone(p0);
  const report: string[] = [];
  const it = o.iterations ?? 60;
  const x: RouteOptions = o.extra ?? { greed: 1, diagonal: false };
  const byName = (names: string[]) => Object.values(p.nets).filter((n) => names.includes(n.name)).map((n) => n.id);
  const ids = (f: (cls: string, name: string) => boolean) => Object.values(p.nets).filter((n) => f(n.netClass, n.name)).map((n) => n.id);
  const heavy = ['L', 'M1_L', 'M2_L', 'M1_SW', 'M2_SW'];
  let failed = 0;
  // Земля micro-USB — коротким отводом к ближнему выводу корпуса разъёма: заливка между соседними
  // площадками (шаг 0,65) к ней не подходит.
  const wd = getWorld(p);
  const padsOf = (ref: string, name: string) => wd.pads.filter((q) => q.component.ref === ref && (q.pad.name || q.pad.number) === name);
  const shields = padsOf('X1', 'SHIELD').map((q) => q.center);
  for (const g of padsOf('X1', 'GND')) {
    const s0 = shields.reduce((a, b) => (Math.hypot(b.x - g.center.x, b.y - g.center.y) < Math.hypot(a.x - g.center.x, a.y - g.center.y) ? b : a));
    addTrack(p, { layer: 'F.Cu', width: 0.3, points: [g.center, s0] });
  }
  p = structuredClone(p);
  const r0 = await autoroute(withMains(p, 2.0, 1.3), { iterations: it, hopCost: 40, yieldEvery: 1e9, grid: 1.27, nets: byName(heavy), ...x });
  report.push(`ток турбин: дорожек ${r0.tracks.length}, не проведено ${r0.failed}`);
  failed += r0.failed;
  const heavyIds: string[] = [];
  {
    const nr = neckAtPads(p, r0, ['VS1', 'VS2'], 1.0, 2.2);
    for (const t of nr.tracks) if (t.width > 1.5) heavyIds.push(addTrack(p, t).id);
      else addTrack(p, t);
    for (const v of nr.vias) addVia(p, v);
    p = structuredClone(p);
  }
  // Трансформатор (L_F, N) — отдельно: у левого края им тесно рядом с клапанами.
  const rt = await autoroute(withMains(p, 0.5, 1.3), { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 0.635, keepExisting: true, nets: byName(['L_F', 'N']), ...x });
  p = applyRoute(p, rt);
  const r1 = await autoroute(withMains(p, 0.5, 1.3), { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 0.635, keepExisting: true, nets: ids((c, n) => c === 'Mains' && !heavy.includes(n) && n !== 'L_F' && n !== 'N'), ...x });
  p = applyRoute(p, r1);
  // Добор с зазором 0,8 мм (правило платы — 0,7; плата под компаундом) на мелкой сетке.
  const r1b = await autoroute(withMains(p, 0.5, 0.8), { iterations: it, hopCost: 10, yieldEvery: 1e9, grid: 0.3175, keepExisting: true, nets: ids((c, n) => c === 'Mains' && !heavy.includes(n)), ...x });
  p = applyRoute(p, r1b);
  report.push(`230 В: дорожек ${rt.tracks.length + r1.tracks.length + r1b.tracks.length}, не проведено ${r1b.failed}`);
  failed += r1b.failed;
  const power = byName(['VIN', 'VRECT', 'AC1', 'AC2']);
  const r2 = await autoroute(withMains(p, 0.5, 0.7, 0.4), { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 0.635, keepExisting: true, nets: power, ...x });
  report.push(`выпрямитель: дорожек ${r2.tracks.length}, переходных ${r2.vias.length}, не проведено ${r2.failed}`);
  failed += r2.failed;
  p = applyRoute(p, r2);
  const usb = byName(['USB_DN', 'USB_DP', 'VBUS']);
  // USB (шаг 0,65): сначала сетка 0,3175 — на 0,25 соседние дорожки ложатся ближе зазора, — остаток на 0,25.
  const ru0 = await autoroute(withMains(p, 0.5, 0.7, 0.2), { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 0.3175, keepExisting: true, nets: usb, ...x });
  p = applyRoute(p, ru0);
  const ru = await autoroute(withMains(p, 0.5, 0.7, 0.2), { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 0.25, keepExisting: true, nets: usb, ...x });
  report.push(`USB: дорожек ${ru0.tracks.length + ru.tracks.length}, переходных ${ru0.vias.length + ru.vias.length}, не проведено ${ru.failed}`);
  failed += ru.failed;
  for (const v of ru.vias) addVia(p, v);
  const done = new Set([...power, ...usb]);
  const thinIds: string[] = [];
  for (const t of ru.tracks) addTrack(p, t);
  p = structuredClone(p);
  // У каждой площадки земли — своё переходное на нижнюю сплошную землю (до разводки логики, пока
  // рядом свободно): заливку сверху дорожки режут, а снизу земля почти сплошная.
  const gv = groundVias(p);
  p = gv.project;
  report.push(`земля: переходных у площадок ${gv.vias}`);
  o.onStage?.('логика', p);
  const r3 = await autorouteWithZones(withMains(p, 0.5, 0.7, 0.2), {
    iterations: it,
    hopCost: 12,
    congestionGrowth: 1.3,
    yieldEvery: 1e9,
    grid: 1.27 / 3,
    keepExisting: true,
    nets: ids((c, n) => c !== 'Mains' && !done.has(Object.values(p.nets).find((q) => q.name === n)!.id)),
    // Логика — в основном сверху: снизу остаётся почти сплошная земля.
    layerCost: [1, 2.2],
    ...x,
  });
  report.push(`логика: дорожек ${r3.tracks.length}, переходных ${r3.vias.length}, сшивок ${r3.stitches}, не проведено ${r3.failed}`);
  failed += r3.failed;
  for (const t of r3.tracks) thinIds.push(addTrack(p, t).id);
  for (const v of r3.vias) addVia(p, v);
  p = structuredClone(p);
  const want = new Map<string, number>();
  for (const id of Object.keys(p.nets)) want.set(id, netWidth(p, id).width);
  const f = fitTrackWidthsSafe(structuredClone(p), { tracks: [...thinIds, ...heavyIds], widths: want });
  if (f.nets.length) applyFit(p, f);
  p = structuredClone(p);
  report.push(`ширина: расширено цепей ${f.nets.length}, не везде хватило места: ${f.short.map((n) => p.nets[n.net]?.name ?? n.net).join(', ') || 'нет'}`);
  // Добор: недоведённые цепи логики — на мелких сетках (переходные 0,6/0,3).
  for (const g of [0.3175, 1.27 / 6]) {
    const conn = computeConnectivity(p);
    const open = Object.values(p.nets)
      .filter((n) => n.netClass !== 'Mains' && n.name !== 'GND' && conn.nets.get(n.id) && !conn.nets.get(n.id)!.complete)
      .map((n) => n.id);
    if (!open.length) break;
    const q = withMains(p, 0.5, 0.7, 0.2);
    for (const k of Object.keys(q.netClasses)) if (k !== 'Mains') q.netClasses[k] = { ...q.netClasses[k], viaDiameter: 0.6, viaDrill: 0.3 };
    const rr = await autoroute(q, { iterations: 20, hopCost: 8, yieldEvery: 1e9, grid: g, keepExisting: true, nets: open, ...x });
    p = applyRoute(p, rr);
    report.push(`добор на сетке ${g.toFixed(3)}: цепей ${open.length}, дорожек ${rr.tracks.length}, не проведено ${rr.failed}`);
  }
  // Земля, до которой не дотекла заливка, — сначала дорожками на мелкой сетке, остальное — переходными.
  const gIds = byName(['GND']);
  const rgq = withMains(p, 0.5, 0.7, 0.2);
  for (const k of Object.keys(rgq.netClasses)) if (k !== 'Mains') rgq.netClasses[k] = { ...rgq.netClasses[k], viaDiameter: 0.6, viaDrill: 0.3 };
  const rg = await autoroute(rgq, { iterations: 10, hopCost: 5, yieldEvery: 1e9, grid: 1.27 / 6, keepExisting: true, nets: gIds, ...x });
  p = applyRoute(p, rg);
  // Дорожки земли, задевшие запрет под антенной, — убрать: землю соединят заливка и сшивка.
  {
    const gid = gIds[0];
    const conn = computeConnectivity(p);
    const boxes = Object.values(p.ruleAreas).filter((a) => a.keepoutTracks).map((a) => {
      const xs = a.outline.map((v) => v.x);
      const ys = a.outline.map((v) => v.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    for (const [id, t] of Object.entries(p.tracks)) {
      if (conn.itemNet.get(id) !== gid) continue;
      const m = t.width / 2;
      if (t.points.some((v, i) => i > 0 && boxes.some((b) => Math.max(v.x, t.points[i - 1].x) + m > b.x0 && Math.min(v.x, t.points[i - 1].x) - m < b.x1 && Math.max(v.y, t.points[i - 1].y) + m > b.y0 && Math.min(v.y, t.points[i - 1].y) - m < b.y1)))
        delete p.tracks[id];
    }
    p = structuredClone(p);
  }
  const st = stitchGround(p);
  p = st.project;
  report.push(`земля: переходных к заливке ${st.vias}, отрезанных площадок осталось ${st.left}`);
  return { project: p, report, failed };
}
