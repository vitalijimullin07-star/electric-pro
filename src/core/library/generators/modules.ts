import type { FootprintDef, Graphic, PadDef } from '../../model/types';
import { CRT_THT, FAB_W, SILK_W, circle, courtyardAround, crtGraphic, fp, npth, r2, rect, refText, smd, tht, valueText } from './util';
import { CAT } from '../categories';
import { EXTRA_MODULES } from './modules-extra';

/*
 * Готовые модули на штырях: платки с Aliexpress, отладочные платы, блоки питания.
 * Габариты платки и расстояние между рядами взяты из документации или измерены;
 * там, где сомнения, стоит verified: false — сверить с реальной деталью.
 */

export interface HeaderRow {
  /** Точка первого вывода ряда в координатах модуля. */
  at: [number, number];
  /** Направление ряда: 'x' — выводы идут вправо, 'y' — вниз. */
  dir: 'x' | 'y';
  pitch?: number;
  /** Имена выводов по порядку. Пустая строка — вывод без имени. */
  names: string[];
  /** Номера выводов (если не заданы, идут подряд от следующего свободного). */
  numbers?: string[];
  /** Прямоугольная площадка для первого вывода ряда. */
  markFirst?: boolean;
}

export interface ModuleSpec {
  id: string;
  name: string;
  description: string;
  /** Габариты платки: [ширина, высота]; центр — начало координат, если не задан offset. */
  board: [number, number];
  /** Сдвиг центра платки относительно начала координат. */
  offset?: [number, number];
  rows: HeaderRow[];
  /** Крепёжные отверстия (без металлизации). */
  holes?: { at: [number, number]; d: number }[];
  /** Дополнительная графика на сборочном слое: прямоугольники [x0,y0,x1,y1] (антенна, USB, чипы). */
  fab?: [number, number, number, number][];
  verified: boolean;
  height?: number;
  tags?: string[];
  refPrefix?: string;
  category?: string;
  group?: string;
  source?: string;
  padDiameter?: number;
  drill?: number;
  /** Планарные площадки по краю (модули без штырей, например ESP-12F): пары [x, y, w, h]. */
  smdPads?: { name: string; at: [number, number]; size: [number, number] }[];
}

export function moduleFootprint(s: ModuleSpec): FootprintDef {
  const pads: PadDef[] = [];
  let n = 1;
  const padD = s.padDiameter ?? 1.7;
  const drill = s.drill ?? 1.0;
  for (const row of s.rows) {
    const pitch = row.pitch ?? 2.54;
    row.names.forEach((nm, i) => {
      const x = row.at[0] + (row.dir === 'x' ? i * pitch : 0);
      const y = row.at[1] + (row.dir === 'y' ? i * pitch : 0);
      const num = row.numbers?.[i] ?? String(n);
      n++;
      pads.push(tht(num, x, y, padD, padD, drill, row.markFirst && i === 0 ? 'rect' : 'oval', nm ? { name: nm } : {}));
    });
  }
  if (s.smdPads) for (const sp of s.smdPads) pads.push(smd(String(n++), sp.at[0], sp.at[1], sp.size[0], sp.size[1], 'roundrect', sp.name ? { name: sp.name } : {}));
  if (s.holes) for (const h of s.holes) pads.push(npth(h.at[0], h.at[1], h.d));
  const [bw, bh] = s.board;
  const [ox, oy] = s.offset ?? [0, 0];
  const x0 = ox - bw / 2;
  const y0 = oy - bh / 2;
  const x1 = ox + bw / 2;
  const y1 = oy + bh / 2;
  const crt = courtyardAround(pads, { x0, y0, x1, y1 }, CRT_THT);
  const g: Graphic[] = [rect('F.Fab', x0, y0, x1, y1, FAB_W), rect('F.Silk', x0 - 0.06, y0 - 0.06, x1 + 0.06, y1 + 0.06, SILK_W)];
  for (const f of s.fab ?? []) g.push(rect('F.Fab', f[0], f[1], f[2], f[3], FAB_W));
  // Метка первого вывода каждого ряда.
  for (const row of s.rows) {
    if (!row.markFirst) continue;
    const [px, py] = row.at;
    const off = row.dir === 'x' ? [-1.6, 0] : [0, -1.6];
    g.push(circle('F.Silk', { x: r2(px + off[0]), y: r2(py + off[1]) }, 0.3, SILK_W, true));
  }
  // Подписи выводов на сборочном слое.
  for (const row of s.rows) {
    const pitch = row.pitch ?? 2.54;
    row.names.forEach((nm, i) => {
      if (!nm) return;
      const x = row.at[0] + (row.dir === 'x' ? i * pitch : 0);
      const y = row.at[1] + (row.dir === 'y' ? i * pitch : 0);
      // Подпись внутрь платки от вывода.
      const inward = row.dir === 'y' ? (x < ox ? 1 : -1) : 0;
      const inwardY = row.dir === 'x' ? (y < oy ? 1 : -1) : 0;
      g.push({
        kind: 'text',
        layer: 'F.Fab',
        at: { x: r2(x + inward * (padD / 2 + 0.4)), y: r2(y + inwardY * (padD / 2 + 0.4)) },
        text: nm,
        size: 0.6,
        thickness: 0.1,
        rotation: row.dir === 'x' ? 90 : 0,
        align: row.dir === 'y' ? (inward > 0 ? 'left' : 'right') : inwardY > 0 ? 'right' : 'left',
      });
    });
  }
  g.push(crtGraphic(crt), refText(crt.min.y - 0.7), valueText(oy, ox, 1.0));
  return fp({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category ?? CAT.M,
    group: s.group ?? 'Прочее',
    tags: ['module', s.smdPads ? 'smd' : 'tht', ...(s.tags ?? [])],
    refPrefix: s.refPrefix ?? 'M',
    pads,
    graphics: g,
    courtyard: crt,
    source: s.source ?? 'Габариты модуля и шаг штырей',
    verified: s.verified,
    height: s.height ?? 12,
  });
}

/**
 * Два ряда по n выводов вдоль оси Y на расстоянии rowPitch. Имена перечисляются сверху вниз
 * для обоих рядов; номера идут против часовой стрелки: левый ряд 1…n сверху вниз,
 * правый n+1…2n снизу вверх (как у DIP и у большинства модулей).
 */
export function twoRows(n: number, rowPitch: number, left: string[], right: string[]): HeaderRow[] {
  const y0 = -((n - 1) * 2.54) / 2;
  return [
    { at: [-rowPitch / 2, y0], dir: 'y', names: left, markFirst: true },
    { at: [rowPitch / 2, y0], dir: 'y', names: right, numbers: Array.from({ length: n }, (_, i) => String(2 * n - i)) },
  ];
}

export const MODULE_SPECS: ModuleSpec[] = [
  {
    id: 'Module_ESP32_DevKit_30pin',
    name: 'ESP32 DevKit 30',
    description: 'ESP32 DevKit V1 (DOIT), 30 выводов, 2×15, ряды через 25,4 мм, платка 51,5×28,3 мм. USB и антенна по короткой стороне',
    board: [28.3, 51.5],
    offset: [0, -2.8],
    rows: twoRows(
      15,
      25.4,
      ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'],
      ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3'],
    ),
    fab: [
      [-9, -28.5, 9, -20.5],
      [-4, 22.5, 4, 25],
    ],
    group: 'Wi-Fi и Bluetooth',
    verified: false,
    height: 13,
    tags: ['esp32', 'devkit', 'wifi'],
    source: 'Типовые размеры DOIT DevKit V1',
  },
  {
    id: 'Module_ESP32_DevKitC_38pin',
    name: 'ESP32 DevKitC 38',
    description: 'ESP32-DevKitC V4, 38 выводов, 2×19, ряды через 25,4 мм, платка 55×28 мм',
    board: [28, 55],
    offset: [0, -2.0],
    rows: twoRows(
      19,
      25.4,
      ['3V3', 'EN', 'VP', 'VN', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'GND', 'IO13', 'D2', 'D3', 'CMD', '5V'],
      ['GND', 'IO23', 'IO22', 'TXD0', 'RXD0', 'IO21', 'GND', 'IO19', 'IO18', 'IO5', 'IO17', 'IO16', 'IO4', 'IO0', 'IO2', 'IO15', 'D1', 'D0', 'CLK'],
    ),
    fab: [
      [-9, -29, 9, -21],
      [-4, 26.5, 4, 29],
    ],
    group: 'Wi-Fi и Bluetooth',
    verified: false,
    height: 13,
    tags: ['esp32', 'devkitc', 'wifi'],
    source: 'Espressif ESP32-DevKitC V4',
  },
  {
    id: 'Module_NodeMCU_v2_Amica',
    name: 'NodeMCU v2',
    description: 'NodeMCU ESP8266 v2 (Amica), 30 выводов, 2×15, ряды через 22,86 мм, платка 48,5×25,6 мм',
    board: [25.6, 48.5],
    offset: [0, -2.5],
    rows: twoRows(
      15,
      22.86,
      ['A0', 'RSV', 'RSV', 'SD3', 'SD2', 'SD1', 'CMD', 'SD0', 'CLK', 'GND', '3V3', 'EN', 'RST', 'GND', 'VIN'],
      ['D0', 'D1', 'D2', 'D3', 'D4', '3V3', 'GND', 'D5', 'D6', 'D7', 'D8', 'RX', 'TX', 'GND', '3V3'],
    ),
    group: 'Wi-Fi и Bluetooth',
    verified: false,
    height: 13,
    tags: ['esp8266', 'nodemcu', 'wifi'],
  },
  {
    id: 'Module_Wemos_D1_mini',
    name: 'D1 mini',
    description: 'Wemos D1 mini (ESP8266), 2×8 выводов, ряды через 22,86 мм, платка 34,2×25,6 мм',
    board: [25.6, 34.2],
    offset: [0, -1.5],
    rows: twoRows(8, 22.86, ['RST', 'A0', 'D0', 'D5', 'D6', 'D7', 'D8', '3V3'], ['TX', 'RX', 'D1', 'D2', 'D3', 'D4', 'GND', '5V']),
    group: 'Wi-Fi и Bluetooth',
    verified: true,
    height: 10,
    tags: ['esp8266', 'd1 mini', 'wifi'],
    source: 'Wemos D1 mini, чертёж',
  },
  {
    id: 'Module_Arduino_Nano',
    name: 'Arduino Nano',
    description: 'Arduino Nano (и клоны), 2×15 выводов, ряды через 15,24 мм, платка 43,2×17,8 мм',
    board: [17.8, 43.2],
    offset: [0, 0],
    rows: twoRows(
      15,
      15.24,
      ['D13', '3V3', 'REF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'],
      ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', 'RX0', 'TX1'],
    ),
    holes: [
      { at: [-7.62, -20.3], d: 1.8 },
      { at: [7.62, -20.3], d: 1.8 },
      { at: [-7.62, 20.3], d: 1.8 },
      { at: [7.62, 20.3], d: 1.8 },
    ],
    fab: [[-3.8, -22.2, 3.8, -17.5]],
    group: 'Микроконтроллеры',
    verified: true,
    height: 8,
    tags: ['arduino', 'nano', 'atmega328'],
    source: 'Arduino Nano, чертёж 1,70″×0,70″',
    refPrefix: 'A',
  },
  {
    id: 'Module_Arduino_Pro_Mini',
    name: 'Arduino Pro Mini',
    description: 'Arduino Pro Mini, 2×12 выводов вдоль длинных сторон (ряды через 15,24 мм), платка 33×18 мм. Программатор и A4–A7 не показаны',
    board: [18, 33],
    rows: twoRows(12, 15.24, ['TX0', 'RX1', 'RST', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'], ['RAW', 'GND', 'RST', 'VCC', 'A3', 'A2', 'A1', 'A0', 'D13', 'D12', 'D11', 'D10']),
    group: 'Микроконтроллеры',
    verified: false,
    height: 6,
    tags: ['arduino', 'pro mini'],
    refPrefix: 'A',
  },
  {
    id: 'Module_Raspberry_Pi_Pico',
    name: 'Pi Pico',
    description: 'Raspberry Pi Pico / Pico W, 2×20 выводов, ряды через 17,78 мм, платка 51×21 мм, отверстия M2',
    board: [21, 51],
    rows: twoRows(
      20,
      17.78,
      ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'],
      ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 'GP28', 'GND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'],
    ),
    holes: [
      { at: [-5.7, -23.5], d: 2.1 },
      { at: [5.7, -23.5], d: 2.1 },
      { at: [-5.7, 23.5], d: 2.1 },
      { at: [5.7, 23.5], d: 2.1 },
    ],
    fab: [[-4, -26.5, 4, -21.5]],
    group: 'Микроконтроллеры',
    verified: true,
    height: 4,
    tags: ['raspberry', 'pico', 'rp2040'],
    source: 'Raspberry Pi Pico datasheet',
    refPrefix: 'A',
    padDiameter: 1.7,
    drill: 1.0,
  },
  {
    id: 'Module_STM32_Blue_Pill',
    name: 'Blue Pill',
    description: 'STM32F103C8T6 «Blue Pill», 2×20 выводов, ряды через 15,24 мм, платка 53×22,5 мм. Разъём SWD не показан',
    board: [22.5, 53],
    offset: [0, -1.0],
    rows: twoRows(
      20,
      15.24,
      ['VBAT', 'C13', 'C14', 'C15', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'B0', 'B1', 'B10', 'B11', 'RST', '3V3', 'GND', 'GND'],
      ['3V3', 'GND', '5V', 'B9', 'B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'A15', 'A12', 'A11', 'A10', 'A9', 'A8', 'B15', 'B14', 'B13', 'B12'],
    ),
    group: 'Микроконтроллеры',
    verified: false,
    height: 8,
    tags: ['stm32', 'blue pill'],
    refPrefix: 'A',
  },
  {
    id: 'Module_HLK-PM01',
    name: 'HLK-PM01',
    description: 'Блок питания Hi-Link HLK-PM01/PM03/PM12 (230 В → 5/3,3/12 В, 3 Вт), 34×20,2×15 мм. Выходные выводы сверху (−Vo, +Vo), сетевые снизу (AC). Расстояния типовые — проверить',
    board: [20.2, 34],
    offset: [0, 0],
    rows: [
      { at: [-5.1, -14.6], dir: 'x', pitch: 10.2, names: ['+Vo', '-Vo'], markFirst: true },
      { at: [-5.1, 14.6], dir: 'x', pitch: 10.2, names: ['AC', 'AC'] },
    ],
    group: 'AC-DC',
    verified: false,
    height: 15,
    tags: ['power', 'ac-dc', 'hi-link', '230v'],
    category: CAT.PS,
    refPrefix: 'PS',
    source: 'Hi-Link HLK-PM01, типовые размеры',
    padDiameter: 2.4,
    drill: 1.3,
  },
  {
    id: 'Module_ADS1115',
    name: 'ADS1115',
    description: 'Модуль АЦП ADS1115 (CJMCU), 1×10 выводов, платка 27,5×15 мм',
    board: [27.5, 15],
    offset: [0, -5.0],
    rows: [{ at: [-11.43, 0], dir: 'x', names: ['VDD', 'GND', 'SCL', 'SDA', 'ADDR', 'ALRT', 'A0', 'A1', 'A2', 'A3'], markFirst: true }],
    group: 'Прочее',
    verified: false,
    height: 5,
    tags: ['adc', 'i2c', 'ads1115'],
  },
  {
    id: 'Module_DS3231',
    name: 'DS3231',
    description: 'Модуль часов DS3231 (ZS-042), 1×6 выводов, платка 38×22 мм с держателем батареи',
    board: [38, 22],
    offset: [0, -8.0],
    rows: [{ at: [-6.35, 0], dir: 'x', names: ['32K', 'SQW', 'SCL', 'SDA', 'VCC', 'GND'], markFirst: true }],
    group: 'Прочее',
    verified: false,
    height: 14,
    tags: ['rtc', 'i2c', 'ds3231'],
  },
  {
    id: 'Module_MAX31855',
    name: 'MAX31855',
    description: 'Модуль термопары MAX31855 (клон Adafruit), 1×5 выводов, платка 25,4×20 мм с клеммником термопары',
    board: [25.4, 20],
    offset: [0, -7.0],
    rows: [{ at: [-5.08, 0], dir: 'x', names: ['GND', 'VCC', 'SCK', 'CS', 'SO'], markFirst: true }],
    group: 'Прочее',
    verified: false,
    height: 10,
    tags: ['thermocouple', 'spi', 'max31855'],
  },
  {
    id: 'Module_LM2596_Buck',
    name: 'LM2596 понижающий',
    description: 'Понижающий преобразователь на LM2596 с подстроечником, платка 43×21 мм, 4 вывода по углам (IN+, IN−, OUT+, OUT−)',
    board: [43, 21],
    rows: [
      { at: [-19.0, -8.0], dir: 'y', pitch: 16.0, names: ['IN+', 'IN-'], markFirst: true },
      { at: [19.0, -8.0], dir: 'y', pitch: 16.0, names: ['OUT+', 'OUT-'] },
    ],
    group: 'DC-DC',
    verified: false,
    height: 14,
    tags: ['power', 'dc-dc', 'buck', 'lm2596'],
    category: CAT.PS,
    refPrefix: 'PS',
    padDiameter: 2.2,
    drill: 1.2,
  },
  {
    id: 'Module_Relay_1ch',
    name: 'Реле модуль 1 канал',
    description: 'Модуль реле 1 канал 5 В (SRD + оптрон), 3 вывода управления (VCC, GND, IN), платка 43×17 мм; клеммник нагрузки на другой стороне',
    board: [43, 17],
    offset: [0, -5.0],
    rows: [{ at: [-2.54, 0], dir: 'x', names: ['VCC', 'GND', 'IN'], markFirst: true }],
    group: 'Модули',
    verified: false,
    height: 18,
    tags: ['relay', 'module'],
    category: CAT.K,
    refPrefix: 'K',
  },
  {
    id: 'Module_OLED_0.96_I2C',
    name: 'OLED 0,96″',
    description: 'Дисплей OLED 0,96″ 128×64 I2C, 1×4 вывода (GND, VCC, SCL, SDA), платка 27,3×27,8 мм, отверстия Ø2 мм',
    board: [27.3, 27.8],
    offset: [0, 12.0],
    rows: [{ at: [-3.81, 0], dir: 'x', names: ['GND', 'VCC', 'SCL', 'SDA'], markFirst: true }],
    holes: [
      { at: [-11.6, 0.2], d: 2.0 },
      { at: [11.6, 0.2], d: 2.0 },
      { at: [-11.6, 23.8], d: 2.0 },
      { at: [11.6, 23.8], d: 2.0 },
    ],
    fab: [[-12.5, 4.5, 12.5, 24.0]],
    group: 'ЖК и OLED модули',
    verified: false,
    height: 4,
    tags: ['display', 'oled', 'i2c'],
    category: CAT.DS,
    refPrefix: 'DS',
  },
  {
    id: 'Module_DHT22',
    name: 'DHT22',
    description: 'Датчик DHT22/AM2302, 4 вывода с шагом 2,54 мм (VCC, DATA, NC, GND), корпус 15,1×25,1 мм',
    board: [15.1, 25.1],
    offset: [0, -13.5],
    rows: [{ at: [-3.81, 0], dir: 'x', names: ['VCC', 'DATA', 'NC', 'GND'], markFirst: true }],
    group: 'Температура и влажность',
    verified: false,
    height: 7.7,
    tags: ['sensor', 'humidity', 'dht22'],
    category: CAT.SENS,
    refPrefix: 'U',
    padDiameter: 1.6,
    drill: 0.9,
  },
];

/** Пользовательский модуль: платка W×H и один ряд из n выводов по нижнему краю. */
export function genericModule(w: number, h: number, pins: number, names?: string[]): FootprintDef {
  const nm = names ?? Array.from({ length: pins }, () => '');
  return moduleFootprint({
    id: `Module_Generic_${w}x${h}_1x${pins}`,
    name: `Модуль ${w}×${h}, ${pins}`,
    description: `Модуль на штырях ${w}×${h} мм, ${pins} выводов в ряд по краю`,
    board: [w, h],
    offset: [0, -h / 2 + 1.5],
    rows: [{ at: [-((pins - 1) * 2.54) / 2, 0], dir: 'x', names: nm, markFirst: true }],
    group: 'Прочее',
    verified: true,
  });
}

export function allModules(): FootprintDef[] {
  const out = [...MODULE_SPECS, ...EXTRA_MODULES].map(moduleFootprint);
  for (const p of [3, 4, 5, 6, 8]) out.push(genericModule(20, 15, p));
  return out;
}

