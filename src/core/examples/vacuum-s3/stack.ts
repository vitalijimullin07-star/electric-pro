import { addComponent, addDrawing, addRuleArea, addTrack, addVia, addWire, addZone, connectPad, ensureNet } from '../../model/edit';
import { placementOf, toWorld } from '../../model/placement';
import { createProject } from '../../model/project';
import { textWidth } from '../../render/stroke-font';
import { type RouteOptions, type RouteResult } from '../../router/autoroute';
import { autorouteWithZones } from '../../router/zone-aware';
import type { Vec2 } from '../../math/vec';
import type { Component, FootprintDef, Graphic, PadDef, Project } from '../../model/types';
import { layoutBlocks, type SchBlock } from './build';
import { footprintOf, terminalLabels, type ModPart } from './mod';
import { WIRED_PINS } from './wired';

/*
 * Пылесос S3 «этажеркой» под лазер (краска + травление): две односторонние платы одна над другой
 * на стойках M3 и отдельная плата пульта. Схема — навесного варианта 6.1 и новее (wired.ts): блок
 * питания 5 В, ZMPT101B на IO7 и IO48, термисторы через ADS1115; сеть, реле 30 А, МР248, SSR и блок
 * питания — в сетевом отсеке на своих проводах, на платах только низкое напряжение.
 *
 *  - Верхняя плата: ESP32-S3-DevKitC-1 на гнёздах сверху (USB, кнопки и антенна свободны), все
 *    клеммники по краю, ULN2003, фильтры датчиков; к нижней плате — штыри с длинными выводами
 *    (PT1, PT2 вдоль рядов ESP32, J2–J4) насквозь вниз, в гнёзда нижней платы.
 *  - Нижняя плата: ADS1115, середина 1,65 В для трансформаторов тока, MPX5100DP, ШИМ к МР248,
 *    угловой IDC 2×10 к пульту; земля — заливкой.
 *  - Пульт: экран 3,5″ MSP3520 (ILI9488 + XPT2046) на гнезде 1×14 и стойках, под экраном PCA9555
 *    и плеер DFPlayer Mini, часы DS3231, 9 кнопок 12×12, энкодер EC11, зуммер, светодиод, IDC 2×10.
 *
 * Этажерка — медь только снизу (B.Cu), детали сверху, перемычка — проволокой со стороны деталей.
 * Пульт — двусторонний без металлизации: все выводы паяются снизу, сверху — дорожки между
 * переходными (проволочки). Надпись на меди читается, если смотреть на медь: так её и выжигает лазер.
 */

/** Выводы ESP32-S3 (как у навесного варианта 6.1: IO7 и IO48 — с делителя ZMPT101B). */
export const STACK_PINS: Record<string, string> = (() => {
  // IO8 не нужен: с ADS1115 прошивка берёт оба термистора с него, а с ZMPT на IO7 без ADS — не меряет вовсе.
  const m: Record<string, string> = { ...WIRED_PINS };
  delete m.IO8;
  return m;
})();

/** Платы этажерки (мм): верхняя и нижняя одного размера, стойки M3 по углам. */
export const STACK_BOARD = { w: 96, h: 82 };
export const PANEL_BOARD = { w: 160, h: 90 };
/** Левый край экрана на пульте: слева от него — полоса под часы, перемычку голоса и динамик. */
const PANEL_DX = 14;
/** DFPlayer на пульте (повёрнут, слот карты — влево): вывод VCC. */
const DF_AT: [number, number] = [34, 30];
/** Расстояние между платами этажерки (стойки M3), мм. */
export const STACK_GAP = 20;

/* ---------------- корпуса ---------------- */

const tht = (number: string, name: string, x: number, y: number, o: { d?: number; drill?: number; rect?: boolean } = {}): PadDef => ({
  number,
  name,
  type: 'tht',
  shape: o.rect ? 'rect' : 'circle',
  at: { x: +x.toFixed(3), y: +y.toFixed(3) },
  size: { x: o.d ?? 1.7, y: o.d ?? 1.7 },
  drill: o.drill ?? 1.0,
});
const rect = (layer: Graphic['layer'], x0: number, y0: number, x1: number, y1: number, width = 0.12): Graphic => ({ kind: 'rect', layer, a: { x: +x0.toFixed(3), y: +y0.toFixed(3) }, b: { x: +x1.toFixed(3), y: +y1.toFixed(3) }, width });
const text = (layer: Graphic['layer'], x: number, y: number, s: string, size = 1.0, align: 'left' | 'center' | 'right' = 'center'): Graphic => ({ kind: 'text', layer, at: { x: +x.toFixed(3), y: +y.toFixed(3) }, text: s, size, thickness: size * 0.14, align });

const DEVKIT_LEFT = ['3V3', '3V3', 'RST', 'IO4', 'IO5', 'IO6', 'IO7', 'IO15', 'IO16', 'IO17', 'IO18', 'IO8', 'IO3', 'IO46', 'IO9', 'IO10', 'IO11', 'IO12', 'IO13', 'IO14', '5V', 'GND'];
const DEVKIT_RIGHT = ['GND', 'TX', 'RX', 'IO1', 'IO2', 'IO42', 'IO41', 'IO40', 'IO39', 'IO38', 'IO37', 'IO36', 'IO35', 'IO0', 'IO45', 'IO48', 'IO47', 'IO21', 'IO20', 'IO19', 'GND', 'GND'];

/**
 * ESP32-S3-DevKitC-1 на двух гнёздах 1×22. У платы Espressif ряды через 22,86 мм (чертёж DXF
 * v1.1: выводы в 1,27 мм от краёв платы 25,4 мм), у части клонов — через 25,4 мм: правый ряд
 * повторён вторым, гнездо паяется в тот, что подходит. Начало координат — вывод 1 (3V3, у антенны).
 */
function devkitSockets(): FootprintDef {
  const pads: PadDef[] = [];
  DEVKIT_LEFT.forEach((n, i) => pads.push(tht(String(i + 1), n, 0, i * 2.54, { rect: i === 0 })));
  DEVKIT_RIGHT.forEach((n, i) => pads.push(tht(String(23 + i), n, 22.86, i * 2.54)));
  DEVKIT_RIGHT.forEach((n, i) => pads.push(tht(String(45 + i), n, 25.4, i * 2.54)));
  const top = -1.565;
  const bottom = 53.34 + 7.96;
  return {
    id: 'Module_ESP32-S3_DevKitC-1_Sockets',
    name: 'ESP32-S3-DevKitC-1 на гнёздах',
    description:
      'ESP32-S3-DevKitC-1 (N16R8/N8R8) на гнёздах 1×22. Ряды: у платы Espressif — через 22,86 мм, у клонов бывает 25,4 мм — правое гнездо паяется в подходящий ряд, второй ряд остаётся пустым. Антенна выступает за край платы модуля на 6,3 мм: под ней и над ней меди нет',
    category: 'Модули',
    refPrefix: 'A',
    tags: ['esp32', 's3', 'devkit', 'module'],
    pads,
    graphics: [
      rect('F.Fab', -1.27, top, 24.13, bottom, 0.1),
      rect('F.Fab', 2.48, top - 6.29, 20.48, top, 0.1),
      text('F.Fab', 11.43, top - 3.1, 'антенна', 1.2),
      rect('F.Fab', 0.8, bottom - 6.2, 8.6, bottom + 0.6, 0.1),
      rect('F.Fab', 14.2, bottom - 6.2, 22.0, bottom + 0.6, 0.1),
      text('F.Fab', 11.43, bottom - 3, 'USB', 1.2),
      rect('F.Silk', -1.3, -1.3, 1.3, 53.34 + 1.3),
      rect('F.Silk', 21.56, -1.3, 26.7, 53.34 + 1.3),
      text('F.Silk', 11.43, 26.67, 'ESP32-S3-DevKitC-1', 1.4),
      text('F.Silk', 22.86, 53.34 + 2.6, '22,86', 0.9),
      text('F.Silk', 25.9, 53.34 + 2.6, '25,4', 0.9, 'left'),
    ],
    courtyard: { min: { x: -1.6, y: -1.6 }, max: { x: 27.0, y: 53.34 + 1.6 } },
    source: 'Espressif DXF_ESP32-S3-DevKitC-1_V1.1_20220429: плата 25,4×62,865 мм, ряды 1,27 и 24,13 мм от левого края, выводы с шагом 2,54 мм; клоны — по замеру',
    verified: false,
    height: 16,
  };
}

/**
 * Однорядный разъём между платами 1×n, вывод 1 — в начале координат, выводы по +X. Верхняя плата —
 * штыри с длинными выводами (пластик сверху, штыри насквозь и вниз), нижняя — гнездо.
 */
function stackRow(n: number, female: boolean): FootprintDef {
  const pads: PadDef[] = [];
  for (let k = 0; k < n; k++) pads.push(tht(String(k + 1), '', k * 2.54, 0, { rect: k === 0 }));
  const L = (n - 1) * 2.54;
  return {
    id: female ? `PinSocket_1x${String(n).padStart(2, '0')}_P2.54mm_Stack` : `PinHeader_1x${String(n).padStart(2, '0')}_P2.54mm_LongPins`,
    name: female ? `Гнездо 1×${n} (этажерка)` : `Штыри 1×${n} длинные (этажерка)`,
    description: female
      ? `Гнездо 1×${n} (PBS, высота 8,5 мм) на нижней плате: в него сверху входят длинные штыри верхней платы`
      : `Штыри 1×${n} с длинными выводами (общая длина 25 мм, отломить от 1×40): пластик — на верхней стороне верхней платы, штыри проходят сквозь неё на 15–17 мм вниз, в гнездо нижней платы (между платами ${STACK_GAP} мм)`,
    category: 'Разъёмы',
    refPrefix: 'J',
    tags: ['header', 'stack', `1x${n}`],
    pads,
    graphics: [rect('F.Fab', -1.27, -1.27, L + 1.27, 1.27, 0.1), rect('F.Silk', -1.33, -1.33, L + 1.33, 1.33), { kind: 'line', layer: 'F.Silk', a: { x: -1.33, y: -1.9 }, b: { x: 1.0, y: -1.9 }, width: 0.2 }],
    courtyard: { min: { x: -1.6, y: -1.6 }, max: { x: L + 1.6, y: 1.6 } },
    source: 'Стандарт 2,54 мм',
    verified: true,
    height: female ? 8.5 : 6,
  };
}

/**
 * DFPlayer Mini: 2×8, ряды через 18,03 мм, платка 20,32×20,32 (чертёж DFRobot DFR0299). Слот карты
 * microSD — у края с выводами 8 и 9 (+Y).
 */
function dfplayer(): FootprintDef {
  const left = ['VCC', 'RX', 'TX', 'DAC_R', 'DAC_L', 'SPK_1', 'GND', 'SPK_2'];
  const right = ['BUSY', 'USB-', 'USB+', 'ADKEY_2', 'ADKEY_1', 'IO_2', 'GND', 'IO_1'];
  const pads: PadDef[] = [];
  left.forEach((n, i) => pads.push(tht(String(i + 1), n, 0, i * 2.54, { rect: i === 0 })));
  right.forEach((n, i) => pads.push(tht(String(16 - i), n, 18.03, i * 2.54)));
  return {
    id: 'Module_DFPlayer_Mini_P18.03',
    name: 'DFPlayer Mini (18,03 мм)',
    description: 'MP3-плеер DFPlayer Mini на гнёздах 1×8: ряды через 18,03 мм, платка 20,32×20,32 мм; слот карты microSD — у края с выводами 8 и 9',
    category: 'Модули',
    refPrefix: 'DA',
    tags: ['dfplayer', 'mp3', 'module'],
    pads,
    graphics: [
      rect('F.Fab', -1.145, -1.27, 19.175, 17.78 + 1.25, 0.1),
      rect('F.Silk', -1.2, -1.33, 19.23, 17.78 + 1.31),
      text('F.Silk', 9.0, 8.0, 'DFPlayer', 1.3),
      text('F.Silk', 9.0, 17.0, 'карта SD', 1.1),
      { kind: 'line', layer: 'F.Silk', a: { x: 9.0, y: 18.3 }, b: { x: 9.0, y: 21.0 }, width: 0.2 },
    ],
    courtyard: { min: { x: -1.5, y: -1.6 }, max: { x: 19.5, y: 19.4 } },
    source: 'DFRobot DFR0299, чертёж размеров: 20,32×20,32, 18,03 между рядами',
    verified: true,
    height: 14,
  };
}

/** Часы DS3231 «для Raspberry Pi»: гнездо на модуле садится на 5 штырей (3V3, SDA, SCL, NC, GND). */
function ds3231Pi(): FootprintDef {
  const names = ['3V3', 'SDA', 'SCL', 'NC', 'GND'];
  return {
    id: 'Module_DS3231_RPi_1x05',
    name: 'DS3231 для Raspberry Pi',
    description: 'Мини-модуль часов DS3231 с батарейкой CR1220 «для Raspberry Pi»: своё гнездо на 5 выводов (3,3 В, SDA, SCL, NC, GND) — на плате штыри 1×5; модуль лежит над платой (~16×13 мм, сверить)',
    category: 'Модули',
    refPrefix: 'DD',
    tags: ['ds3231', 'rtc', 'module'],
    pads: names.map((n, i) => tht(String(i + 1), n, i * 2.54, 0, { rect: i === 0 })),
    graphics: [rect('F.Fab', -2.8, -1.6, 13.0, 11.6, 0.1), rect('F.Silk', -1.33, -1.33, 11.49, 1.33), text('F.Silk', 5.08, 6.0, 'DS3231', 1.2), text('F.Silk', 5.08, 8.2, '3V3 D C · G', 0.9)],
    courtyard: { min: { x: -3.0, y: -1.8 }, max: { x: 13.2, y: 11.8 } },
    source: 'Модуль RTC DS3231 для Raspberry Pi (выводы 1, 3, 5, 7, 9 разъёма Pi)',
    verified: false,
    height: 17,
  };
}

/**
 * Угловой IDC 2×n (BH-20R): нечётные выводы — внешний ряд (ближе к краю), корпус и вход кабеля — к +Y.
 * Под корпусом можно вести дорожки.
 */
function idcAngled(n: number): FootprintDef {
  const pads: PadDef[] = [];
  const x0 = -((n - 1) * 2.54) / 2;
  for (let i = 0; i < n; i++) {
    pads.push(tht(String(2 * i + 1), '', x0 + i * 2.54, 0, { rect: i === 0 }));
    pads.push(tht(String(2 * i + 2), '', x0 + i * 2.54, -2.54));
  }
  const L = (n - 1) * 2.54 + 10.16;
  return {
    id: `IDC-Header_2x${String(n).padStart(2, '0')}_P2.54mm_RightAngle`,
    name: `IDC 2×${n} угловой`,
    description: `Коробчатый разъём IDC 2×${n} угловой (BH-${2 * n}R): кабель входит сбоку, со стороны +Y; вывод 1 — красная жила шлейфа`,
    category: 'Разъёмы',
    refPrefix: 'XS',
    tags: ['idc', 'box-header', 'angled', `2x${n}`],
    pads,
    graphics: [
      rect('F.Fab', -L / 2, -3.9, L / 2, 9.0, 0.1),
      rect('F.Silk', -L / 2 - 0.06, 1.6, L / 2 + 0.06, 9.06),
      { kind: 'line', layer: 'F.Silk', a: { x: -2, y: 9.06 }, b: { x: 2, y: 9.06 }, width: 0.5 },
      text('F.Silk', x0 - 2.4, 0, '1', 1.0),
    ],
    courtyard: { min: { x: -L / 2 - 0.3, y: -4.2 }, max: { x: L / 2 + 0.3, y: 9.3 } },
    source: 'Типовой BH-20R (угловой), шаг 2,54',
    verified: false,
    height: 9,
  };
}

/**
 * Экран 3,5″ MSP3520 (ILI9488 + XPT2046) лёжа: гнездо 1×14 справа и 4 отверстия под стойки M3.
 * Начало — левый верхний угол платы экрана (98×56,34 мм), вид спереди.
 */
const MSP = { w: 98, h: 56.34, aa: { x0: 9.95, y0: 3.69, x1: 83.39, y1: 52.65 }, pinX: 96, pin1Y: 44.68 };
function mspSocket(): FootprintDef {
  const names = ['VCC', 'GND', 'CS', 'RESET', 'DC', 'SDI', 'SCK', 'LED', 'SDO', 'T_CLK', 'T_CS', 'T_DIN', 'T_DO', 'T_IRQ'];
  const pads: PadDef[] = names.map((n, i) => tht(String(i + 1), n, MSP.pinX, MSP.pin1Y - i * 2.54, { rect: i === 0 }));
  for (const [i, [x, y]] of [
    [3.0, 3.42],
    [95.0, 3.42],
    [3.0, 52.92],
    [95.0, 52.92],
  ].entries())
    pads.push({ number: `M${i + 1}`, type: 'npth', shape: 'circle', at: { x, y }, size: { x: 3.2, y: 3.2 }, drill: 3.2 });
  const a = MSP.aa;
  return {
    id: 'Display_MSP3520_Landscape_Socket',
    name: 'Экран MSP3520 (3,5″) лёжа',
    description:
      'Экран 3,5″ 480×320 MSP3520 (ILI9488, касание XPT2046) лёжа, разъём справа: гнездо 1×14 (PBS-14, 8,5 мм) и 4 стойки M3 11 мм. Плата экрана 98×56,34 мм, рабочее поле 73,44×48,96 мм',
    category: 'Дисплеи',
    refPrefix: 'HG',
    tags: ['display', 'ili9488', 'msp3520'],
    pads,
    graphics: [
      rect('F.Fab', 0, 0, MSP.w, MSP.h, 0.1),
      rect('F.Silk', 0, 0, MSP.w, MSP.h, 0.15),
      rect('F.Fab', a.x0, a.y0, a.x1, a.y1, 0.1),
      rect('F.Silk', MSP.pinX - 1.33, MSP.pin1Y - 13 * 2.54 - 1.33, MSP.pinX + 1.33, MSP.pin1Y + 1.33),
      text('F.Silk', (a.x0 + a.x1) / 2, 6.5, 'экран 3,5" MSP3520 (стойки M3 11 мм)', 1.4),
    ],
    courtyard: { min: { x: -0.3, y: -0.3 }, max: { x: MSP.w + 0.3, y: MSP.h + 0.3 } },
    source: 'LCDWIKI MSP3520_Size.pdf (V1.0, 2024-04-17)',
    verified: true,
    height: 17,
  };
}

const STACK_FOOTPRINTS: FootprintDef[] = [devkitSockets(), ...[22, 11, 2].flatMap((n) => [stackRow(n, false), stackRow(n, true)]), dfplayer(), ds3231Pi(), idcAngled(10), mspSocket()];

/** Корпус этажерки (свои: гнёзда ESP32, ряды, плеер, часы, экран) или из библиотеки. */
export function fpOf(id: string): FootprintDef {
  return STACK_FOOTPRINTS.find((f) => f.id === id) ?? footprintOf(id);
}

/* ---------------- детали ---------------- */

const RES = 'R_Axial_0.25W_L6.3mm_D2.5mm_P7.62mm_Horizontal';
const RV = 'R_Axial_0.25W_L6.3mm_D2.5mm_P2.54mm_Vertical';
const CER = 'C_Disc_D5mm_W2.5mm_P2.5mm';
const CER5 = 'C_Disc_D6mm_W2.5mm_P5mm';
const EL5 = 'CP_Radial_D5mm_P2mm';
const NPN = 'Q_S8050_TO-92_Wide';
const T35 = (n: number) => `TerminalBlock_1x0${n}_P3.5mm`;
const BTN = 'SW_PUSH_12mm';

type At = [number, number, number?];
const R = (ref: string, value: string, description: string, a: string, b: string, at: At, fp = RES): ModPart => ({ ref, value, description, fp, pins: { '1': a, '2': b }, at });
const C = (ref: string, value: string, description: string, a: string, b: string, at: At, fp = CER): ModPart => ({ ref, value, description, fp, pins: { '1': a, '2': b }, at });
const Q = (ref: string, description: string, b: string, e: string, c: string, at: At): ModPart => ({ ref, value: 'SS8050', description: `${description}. NPN SS8050 в TO-92, выводы на 2,54 мм: Э — Б — К (сверить с корпусом)`, fp: NPN, pins: { B: b, E: e, C: c }, at });
/**
 * Клеммник: цепи и подписи — по порядку на плате (слева направо, сверху вниз). Повёрнутый на 180° (верхний
 * край) или на 90° (правый) нумеруется с другого конца — порядок выводов переворачивается.
 */
const term = (ref: string, value: string, description: string, nets: string[], labels: string[], at: At): ModPart => {
  const rev = at[2] === 180 || at[2] === 90;
  const n2 = rev ? [...nets].reverse() : nets;
  const l2 = rev ? [...labels].reverse() : labels;
  return { ref, value, description, fp: T35(nets.length), pins: Object.fromEntries(n2.map((n, i) => [String(i + 1), n])), at, labels: l2 };
};
const hole = (ref: string, at: At): ModPart => ({ ref, value: '', description: 'Крепёжное отверстие M3: стойка между платами или к корпусу', fp: 'MountingHole_3.2mm_M3', pins: {}, at });

/**
 * Плата ESP32 лёжа: вывод 1 левого ряда (3V3) — в DK, USB — к правому краю верхней платы, антенна —
 * влево (под ней меди нет). Левый ряд DevKitC (3V3 … GND) — снизу, правый (GND … GND) — сверху, у
 * клонов с рядами через 25,4 мм — ещё на 2,54 выше. Снаружи рядов, в 5,08 мм, — проходные длинные
 * штыри 1×22 (PT_R над правым рядом, PT_L под левым): каждый штырь — в одном столбце с выводом ESP32,
 * на верхней плате их соединяет короткая дорожка, и сигнал сразу есть на нижней. Между рядами
 * штырей нижней платы остаётся полоса 31 мм под модули. Штырь в столбце свободного вывода ESP32
 * («дверь») с ESP32 не соединён и просто связывает платы.
 */
const DK = { x: 34.29, y: 48.26 };
const ROW_L = DK.y;
const ROW_R = +(DK.y - 22.86).toFixed(2);
export const PT_L_Y = +(ROW_L + 5.08).toFixed(2);
export const PT_R_Y = +(ROW_R - 5.08).toFixed(2);
/** Столбец c (1–22) выводов ESP32 и проходных штырей. */
const col = (c: number) => +(DK.x + 2.54 * (c - 1)).toFixed(2);

/**
 * Проходные штыри: столбец → цепь (одна и та же на обеих платах). Двери: PT_R 11 — земля ключей
 * ULN2003, PT_L 7 — земля к разъёму пульта (на верхней плате ни с чем не соединена), PT_L 3 (под RST) —
 * середина 1,65 В с делителя нижней платы к клеммнику ТТ. Остальные пустые столбцы не заняты.
 */
export const PASS_R: Record<number, string> = {
  1: 'GND', 2: 'LCD_CS', 4: 'RL1', 5: 'RL2', 6: 'RL3', 7: 'VLV2', 8: 'VLV1', 9: 'T1', 10: 'T2', 11: 'GND',
  14: 'T_CS', 15: 'BZ', 16: 'UAC', 17: 'ENC_B', 18: 'ENC_A', 21: 'GND', 22: 'GND',
};
export const PASS_L: Record<number, string> = {
  1: '3V3', 2: '3V3', 3: 'VMID', 4: 'CT1', 5: 'CT2', 6: 'CT3', 7: 'GND', 8: 'SPI_SCK', 9: 'SPI_MOSI', 10: 'SPI_MISO', 11: 'LCD_DC',
  13: 'WL1', 14: 'WL_DRV', 15: 'WL2', 16: 'VAC', 17: 'SDA', 18: 'SCL', 19: 'PNL_TX', 20: 'PNL_RX', 21: '5V', 22: 'GND',
};
const DOORS_R = new Set([11]);
const DOORS_L = new Set([7]);
const pinsOf = (m: Record<number, string>) => Object.fromEntries(Object.entries(m).map(([c, n]) => [String(c), n]));
/** Проходные штыри: номер вывода → цепь (логическая). */
export const PT_L_PINS = pinsOf(PASS_L);
export const PT_R_PINS = pinsOf(PASS_R);

/**
 * Малые разъёмы между платами (верхняя: штыри, нижняя: гнездо), слева направо или сверху вниз.
 * J2 — левый край: термисторы и шины I²C к клеммникам левого края; J3 — поплавок и земля бака;
 * J4 — ШИМ МР248.
 *
 * J2 на верхней плате: 3,3 В — от ESP32 по самой верхней плате (на нижней эти выводы свободны), SCL и
 * SDA двух клеммников соединены здесь же, а с ESP32 — через нижнюю плату (шина приходит в 7–8, АЦП
 * берёт её из 9–10).
 */
const J2_UPPER = ['NTC1', 'NTC2', '3V3~DK', 'PNL_RX~P', 'PNL_TX~P', '3V3~DK', 'SCL~P', 'SDA~P', 'SDA~P', 'SCL~P', '3V3~DK'];
/** J2 на нижней плате: шина — в 7–8 справа, ADS1115 — в 9–10 слева (связь 7↔10 и 8↔9 — на верхней). */
const J2_LOWER = ['NTC1', 'NTC2', '3V3~J3', 'PNL_RX', 'PNL_TX', '3V3~J6', 'SCL', 'SDA', 'SDA~A', 'SCL~A', '3V3~J11'];
export const J4_NETS = ['PWM2', 'PWM1'];
const J2_AT: At = [19.05, 21.59, 270];
const J3_AT: At = [73.66, 60.96];
const J4_AT: At = [67.31, 15.24];
/** ADS1115 на нижней плате: выводы столбцом x = 13,97 (A3 сверху … VDD снизу), платка — к левому краю. */
const ADS_AT: At = [13.97, 38.1, 90];

/**
 * Имена цепей верхней платы: что соединяется только через нижнюю плату, на верхней — отдельные
 * «островки» с суффиксом ~ (трассировщик верхней платы их не соединяет; логическое имя — до ~).
 */
export const logicalNet = (name: string) => name.split('~')[0];
const iso = (net: string, island: string) => `${net}~${island}`;

/**
 * Кабель к пульту (IDC 2×10, вывод 1 — красная жила). Разъём нижней платы стоит под выводами
 * PT_L 3–12: SPI идёт прямо вниз в чётные 12–18, земля — через дверь PT_L 7 в 10 и по чётным 4–10,
 * сигналы с правого ряда ESP32 приходят каналом по правому краю в нечётные 3–11, справа же — 5 В,
 * голос (IO13), поплавок, SCL и SDA. Через жилу — земля или питание.
 */
/** Жилы шлейфа словами — для описаний разъёмов и памятки. */
const CABLE_TEXT = '1, 4, 6, 8, 10 — земля, 2 — 3,3 В, 13 — 5 В, 3 и 5 — энкодер A и B, 7 — зуммер, 9 — CS касания, 11 — CS экрана, 12 SCK, 14 MOSI, 16 MISO, 18 DC, 15 — голос (IO13), 17 — поплавок, 19 SCL, 20 SDA';

export const PANEL_CABLE: Record<string, string> = {
  '1': 'GND', '2': '3V3', '3': 'ENC_A', '4': 'GND', '5': 'ENC_B', '6': 'GND', '7': 'BZ', '8': 'GND', '9': 'T_CS', '10': 'GND',
  '11': 'LCD_CS', '12': 'SPI_SCK', '13': '5V', '14': 'SPI_MOSI', '15': 'PNL_TX', '16': 'SPI_MISO', '17': 'FLOAT', '18': 'LCD_DC', '19': 'SCL', '20': 'SDA',
};

export const DESCRIPTIONS: Record<string, string> = {
  '5V': 'Питание 5 В от блока питания (клеммник XP1 верхней платы): ESP32, плеер, экран, MPX5100DP',
  '3V3': '3,3 В со стабилизатора DevKitC: датчики, ADS1115, DS3231, PCA9555, МР248',
  UAC: 'ZMPT101B через делитель 10к/20к → IO7 (напряжение сети) и IO48 (ноль сети)',
  UAC_IN: 'Выход ZMPT101B (клеммник X9) → делитель на нижней плате',
  VMID: 'Середина 1,65 В для трансформаторов тока (делитель на нижней плате)',
  NTC1: 'Термистор турбины 1 → A0 ADS1115',
  NTC2: 'Термистор турбины 2 → A1 ADS1115',
  SDA: 'I²C: PCA9555 0x20, SDP810 0x25, SDP811 0x26, NAU7802 0x2A, ADS1115 0x48, DS3231 0x68, BME280 0x76 — IO11',
  SCL: 'I²C — IO12',
  PNL_TX: 'IO13: голос DFPlayer (9600) через перемычку JP1, или SDA второй шины I²C (расходомер SDP810-125)',
  PNL_RX: 'IO14: SCL второй шины I²C',
  FLOAT: 'Поплавок бака → P17 PCA9555 на пульте',
  RL1: 'Реле турбины 1: IO1 → ULN2003 вход 1',
  RL2: 'Реле турбины 2: IO2 → ULN2003 вход 2',
  RL3: 'Реле розетки: IO42 → ULN2003 вход 3',
  VLV2: 'Клапан 2: IO41 → ULN2003 вход 4 и 100 Ом на H2',
  VLV1: 'Клапан 1: IO40 → ULN2003 вход 5 и 100 Ом на H1',
  T1: 'ШИМ МР248 турбины 1: IO39',
  T2: 'ШИМ МР248 турбины 2: IO38',
};

/** Верхняя плата: ESP32 на гнёздах, ULN2003, клеммники по краю, проходные штыри к нижней плате. */
export function upperParts(): ModPart[] {
  const out: ModPart[] = [];
  const add = (...p: ModPart[]) => out.push(...p);
  const { w, h } = STACK_BOARD;
  const yT = 4.6;
  const yB = h - 4.6;
  const xL = 4.6;
  // Островки верхней платы (соединяются через нижнюю): у каждого куска земли и питания — свой.
  const GND_TL = iso('GND', 'TL'); // левый GND правого ряда ESP32: фильтры ТТ
  const GND_TR = iso('GND', 'TR'); // правые GND правого ряда: ZMPT101B
  const GND_U = iso('GND', 'U'); // дверь PT_R 11: ключи ULN2003
  const GND_BR = iso('GND', 'BR'); // GND левого ряда: фильтры электродов и датчика разрежения
  const V3 = iso('3V3', 'DK');
  const V5 = iso('5V', 'DK');
  // Выводы питания DevKitC — по номерам: 1–22 левый ряд, 23–44 правый, 45–66 правый второй (25,4 мм).
  const pins: Record<string, string> = { ...STACK_PINS, '1': V3, '2': V3, '21': V5, '22': GND_BR, '23': GND_TL, '45': GND_TL, '43': GND_TR, '44': GND_TR, '65': GND_TR, '66': GND_TR };
  add({
    ref: 'A1',
    value: 'ESP32-S3-DevKitC-1 N16R8',
    description:
      'ESP32-S3-DevKitC-1 (N16R8 или N8R8) на гнёздах 1×22 сверху верхней платы, USB — к правому краю. Ряды через 22,86 мм (Espressif) или 25,4 мм (часть клонов): верхнее гнездо — в подходящий ряд. IO35–IO37 заняты памятью, IO8 не используется',
    fp: 'Module_ESP32-S3_DevKitC-1_Sockets',
    pins,
    at: [DK.x, DK.y, 90],
  });
  const upperPass = (m: Record<number, string>, doors: Set<number>, row: 'L' | 'R') =>
    Object.fromEntries(
      Object.entries(m).map(([c, n]) => {
        const k = Number(c);
        if (doors.has(k)) return [c, n === 'GND' ? (row === 'R' ? GND_U : iso('GND', 'F')) : n];
        if (n === 'GND') return [c, row === 'R' ? (k === 1 ? GND_TL : GND_TR) : GND_BR];
        if (n === '3V3') return [c, V3];
        if (n === '5V') return [c, V5];
        return [c, n];
      }),
    );
  add(
    { ref: 'PT1', value: 'Штыри 1×22 длинные', description: 'Проходные штыри над верхним рядом ESP32 (25 мм): насквозь вниз, в гнездо PT1 нижней платы', fp: 'PinHeader_1x22_P2.54mm_LongPins', pins: upperPass(PASS_R, DOORS_R, 'R'), at: [DK.x, PT_R_Y] },
    { ref: 'PT2', value: 'Штыри 1×22 длинные', description: 'Проходные штыри под нижним рядом ESP32 (25 мм): насквозь вниз, в гнездо PT2 нижней платы', fp: 'PinHeader_1x22_P2.54mm_LongPins', pins: upperPass(PASS_L, DOORS_L, 'L'), at: [DK.x, PT_L_Y] },
    { ref: 'J2', value: 'Штыри 1×11 длинные', description: 'К нижней плате (25 мм): термисторы и шины I²C клеммников левого края (3, 6, 11 — 3,3 В с ESP32, на нижней плате свободны)', fp: 'PinHeader_1x11_P2.54mm_LongPins', pins: Object.fromEntries(J2_UPPER.map((n, i) => [String(i + 1), n])), at: J2_AT },
    { ref: 'J3', value: 'Штыри 1×2 длинные', description: 'К нижней плате (25 мм): поплавок и земля бака', fp: 'PinHeader_1x02_P2.54mm_LongPins', pins: { '1': 'FLOAT', '2': GND_BR }, at: J3_AT },
    { ref: 'J4', value: 'Штыри 1×2 длинные', description: 'К нижней плате (25 мм): ШИМ МР248 (после 100 Ом)', fp: 'PinHeader_1x02_P2.54mm_LongPins', pins: Object.fromEntries(J4_NETS.map((n, i) => [String(i + 1), n])), at: J4_AT },
  );

  // --- ULN2003 над выводами IO1…IO38: входы 1–7 — в столбцах выводов ESP32 и проходных штырей ---
  add(
    { ref: 'DD1', value: 'ULN2003A', description: 'Семь ключей Дарлингтона с резисторами на входах (DIP-16): 1–3 — реле K1–K3, 4–5 — клапаны L2, L1 (замыкают вход модуля на землю), 6–7 — без нагрузки. Пока ESP32 стартует, входы стянуты внутри — выходы выключены', fp: 'DIP-16_W7.62mm', pins: { '1': 'RL1', '2': 'RL2', '3': 'RL3', '4': 'VLV2', '5': 'VLV1', '6': 'T1', '7': 'T2', '8': GND_U, '16': 'RL1_K', '15': 'RL2_K', '14': 'RL3_K', '13': 'VLV2_K', '12': 'VLV1_K' }, at: [50.8, 13.97, 90] },
    R('R61', '100', 'Клапан 2: прямой выход «1» (High Level, AOD4184) на H2', 'VLV2', 'VLV2_H', [62.23, 12.7, 90], RV),
    R('R58', '100', 'Клапан 1: прямой выход «1» на H1', 'VLV1', 'VLV1_H', [64.77, 15.24, 90], RV),
    term('X6', 'Реле K1 K2 K3', 'К входам IN модулей реле 30 А (перемычка — L: включение низким уровнем): K1 — турбина 1, K2 — турбина 2, K3 — розетка. Питание модулей +5 В и земля — от блока питания', ['RL1_K', 'RL2_K', 'RL3_K'], ['K1', 'K2', 'K3'], [44.45, yT, 180]),
    term('X8', 'Клапаны', 'Клапаны: L2/L1 — ключ на землю (SSR G3MB с управлением низким уровнем, CH2/CH1), H2/H1 — «1» 3,3 В через 100 Ом (SSR High Level, модуль AOD4184 на вход PWM)', ['VLV2_K', 'VLV1_K', 'VLV2_H', 'VLV1_H'], ['L2', 'L1', 'H2', 'H1'], [57.25, yT, 180]),
    term('X7', 'МР248', 'К входам «управление» регуляторов МР248: УПР1 — турбина 1, УПР2 — турбина 2 (ШИМ 0–3,3 В → 0–100 %). +VCC 3,3 В и земля МР248 — с клеммника XP1', ['PWM2', 'PWM1'], ['УПР2', 'УПР1'], [70.25, yT, 180]),
    term('X9', 'ZMPT101B', 'Выход модуля ZMPT101B (OUT) и его земля; питание модуля 5 В — от блока питания. Сеть — на винтовой клеммник самого модуля в сетевом отсеке', ['UAC_IN', GND_TR], ['OUT', 'GND'], [78.5, yT, 180]),
    R('R70', '10k', 'Делитель ZMPT101B 5 → 3,3 В: верхнее плечо (OUT → IO7 и IO48)', 'UAC', 'UAC_IN', [col(16), 17.78, 90], RV),
    R('R71', '20k', 'Делитель ZMPT101B: нижнее плечо (→ земля)', 'UAC', GND_TR, [col(17), 17.78, 90], RV),
    C('C26', '1 нФ', 'Фильтр помех на IO7/IO48 (больше не ставить: сдвинет ноль)', 'UAC', GND_TR, [col(18), 16.51, 90]),
  );

  // --- под ESP32, между её рядами: фильтры (детали не выше 9 мм) и мост IO48 → IO7 (ноль и напряжение сети) ---
  add(
    C('C20', '10 нФ', 'ТТ1: фильтр АЦП (с R20)', 'CT1', GND_TL, [col(4), 44.45, 90]),
    C('C21', '10 нФ', 'ТТ2: фильтр АЦП', 'CT2', GND_TL, [col(5), 44.45, 90]),
    C('C22', '10 нФ', 'ТТ3: фильтр АЦП', 'CT3', GND_TL, [col(6), 44.45, 90]),
    R('R42', '100k', 'Электрод уровня: к земле', 'WL1', GND_BR, [col(12), 45.72, 90], RV),
    C('C41', '1 нФ', 'Электрод уровня: фильтр', 'WL1', GND_BR, [col(13), 44.45, 90]),
    R('R44', '100k', 'Электрод перелива: к земле', 'WL2', GND_BR, [col(14), 45.72, 90], RV),
    C('C42', '1 нФ', 'Электрод перелива: фильтр', 'WL2', GND_BR, [col(15), 44.45, 90]),
    R('R28', '10k', 'Делитель датчика разрежения: нижнее плечо', 'VAC', GND_BR, [col(16), 45.72, 90], RV),
  );

  // --- снизу: трансформаторы тока и бак, детали — в столбцах своих выводов (середина 1,65 В — через PT_L 3) ---
  add(
    R('R20', '1k', 'ТТ1: фильтр АЦП (конденсатор — под ESP32)', 'CT1', 'CT1_IN', [col(4), 55.88, 270], RV),
    R('R21', '1k', 'ТТ2: фильтр АЦП', 'CT2', 'CT2_IN', [col(5), 55.88, 270], RV),
    R('R22', '1k', 'ТТ3: фильтр АЦП', 'CT3', 'CT3_IN', [col(6), 55.88, 270], RV),
    term('X1', 'Ток: ТТ1 ТТ2 ТТ3', 'Трансформаторы тока SCT-013 с выходом 1 В: S1 — на ТТ1/ТТ2/ТТ3 (турбина 1 и 2 — 020: 20 А/1 В, розетка — 030: 30 А/1 В), S2 — на любой «ср» (середина 1,65 В)', ['VMID', 'VMID', 'VMID', 'CT1_IN', 'CT2_IN', 'CT3_IN'], ['ср', 'ср', 'ср', 'ТТ1', 'ТТ2', 'ТТ3'], [44.45, yB, 0]),
    R('R41', '100k', 'Электрод уровня: защита входа (к земле и фильтр — под ESP32)', 'WL1', 'WL_E1', [col(13), 55.88, 270], RV),
    R('R40', '1k', 'Электроды: выход раскачки (переменный ток — без электролиза)', 'WL_DRV', 'WL_D', [col(14), 55.88, 270], RV),
    C('C40', '1 мкФ', 'Электроды: развязка по постоянному току — керамика 105 (не электролит)', 'WL_D', 'WL_E0', [col(14), 62.23, 270]),
    R('R43', '100k', 'Электрод перелива: защита входа', 'WL2', 'WL_E2', [col(15), 55.88, 270], RV),
    term('X5', 'Бак', 'Бак: E1 — электрод уровня (турбины стоп), E0 — общий (внизу), E2 — перелив (авария), поплавок (контакт и земля)', ['WL_E1', 'WL_E0', 'WL_E2', 'FLOAT', GND_BR], ['E1', 'E0', 'E2', 'ПОПЛ', 'GND'], [72.5, yB, 0]),
  );

  // --- клеммники датчиков слева: порядок выводов = порядок J2, земли — по краю платы ---
  add(
    term('XP1', 'Питание 5 В', 'Вход 5 В от блока питания 5 В 3 А — под выводом 5V ESP32. Модули реле, SSR и ZMPT101B питаются от того же блока 5 В своими проводами (общая земля). Соблюдайте полярность', [V5, GND_BR], ['+5В', 'GND'], [80.01, 66.04, 90]),
    C('C1', '220 мкФ 10 В', 'Питание 5 В: накопитель у входа (Ø5, шаг 2)', V5, GND_BR, [87.63, 66.04], EL5),
    term('X2', 'Термисторы', 'Термисторы NTC 10 кОм B3950 на двигателях: турбина 1 — NTC1 и соседний GND, турбина 2 — NTC2 и соседний GND (меряет ADS1115 на нижней плате)', [GND_TL, 'NTC1', GND_TL, 'NTC2', GND_TL], ['GND', 'NTC1', 'GND', 'NTC2', 'GND'], [xL, 15.5, 270]),
    C('C24', '100 нФ', 'Фильтр термистора 1 у клеммника', GND_TL, 'NTC1', [7.62, 13.25, 90]),
    C('C25', '100 нФ', 'Фильтр термистора 2 у клеммника', GND_TL, 'NTC2', [7.62, 20.25, 90]),
    R('R25', '10k', 'Делитель термистора турбины 1: 3,3 В → A0 ADS1115', 'NTC1', V3, [21.59, 21.59, 0], RV),
    R('R26', '10k', 'Делитель термистора турбины 2: 3,3 В → A1 ADS1115', 'NTC2', V3, [21.59, 24.13, 0], RV),
    term('X11', '3,3 В для МР248', 'Выход +3,3 В (с ESP32) на +VCC регуляторов МР248 и земля к их GND', [V3, GND_TL], ['+3,3В', 'GND'], [xL, 29.5, 270]),
    term('X4', 'I²C-2', 'Вторая шина I²C (3,3 В): расходомер SDP810-125Pa (0x25) — если нет SDP811 на 0x26. Тогда снимите перемычку JP1 «голос» на пульте', [V3, J2_UPPER[3], J2_UPPER[4], GND_TL], ['3,3В', 'SCL2', 'SDA2', 'GND'], [xL, 40.25, 270]),
    term('X3', 'I²C-A', 'Датчики I²C (3,3 В): SDP810-500 перепад на фильтре (0x25), NAU7802 весы (0x2A) — по два провода в винт', [V3, J2_UPPER[6], J2_UPPER[7], GND_TL], ['3,3В', 'SCL', 'SDA', 'GND'], [xL, 54.75, 270]),
    term('X10', 'I²C-B', 'Датчики I²C (3,3 В): SDP811 расходомер (0x26), BME280 воздух (0x76) — по два провода в винт', [GND_TL, J2_UPPER[8], J2_UPPER[9], V3], ['GND', 'SDA', 'SCL', '3,3В'], [15, yB, 0]),
    R('R73', '4,7k', 'Подтяжка SCL второй шины (IO14)', J2_UPPER[3], V3, [21.59, 29.21, 0], RV),
    R('R72', '4,7k', 'Подтяжка SDA второй шины (IO13)', J2_UPPER[4], V3, [21.59, 31.75, 0], RV),
  );
  add(hole('H1', [3.5, 3.5]), hole('H2', [w - 3.5, 3.5]), hole('H3', [3.5, h - 3.5]), hole('H4', [w - 3.5, h - 3.5]));
  return out;
}

/** Нижняя плата: гнёзда проходных штырей, модули, делители, разъём к пульту. */
export function lowerParts(): ModPart[] {
  const { w, h } = STACK_BOARD;
  return [
    // Вывод 1 (GND ESP32) — здесь не нужен: земля нижней платы приходит через 11, 21 и 22.
    { ref: 'PT1', value: 'Гнездо 1×22', description: 'Гнездо 1×22 (PBS-22): сюда входят проходные штыри PT1 верхней платы (над верхним рядом ESP32)', fp: 'PinSocket_1x22_P2.54mm_Stack', pins: { ...PT_R_PINS, '1': iso('GND', 'P1') }, at: [DK.x, PT_R_Y] },
    // Вывод 22 (GND ESP32) — в кармане между 5 В и каналом к пульту; с остальной землёй он соединён в самой ESP32.
    { ref: 'PT2', value: 'Гнездо 1×22', description: 'Гнездо 1×22 (PBS-22): проходные штыри PT2 верхней платы (под нижним рядом ESP32)', fp: 'PinSocket_1x22_P2.54mm_Stack', pins: { ...PT_L_PINS, '22': iso('GND', 'DK') }, at: [DK.x, PT_L_Y] },
    { ref: 'J2', value: 'Гнездо 1×11', description: 'Гнездо к J2 верхней платы (3, 6 и 11 здесь свободны)', fp: 'PinSocket_1x11_P2.54mm_Stack', pins: Object.fromEntries(J2_LOWER.map((n, i) => [String(i + 1), n])), at: J2_AT },
    // J3 2 — земля бака: на верхней плате соединена с землёй у входа питания, здесь не нужна.
    { ref: 'J3', value: 'Гнездо 1×2', description: 'Гнездо к J3 верхней платы', fp: 'PinSocket_1x02_P2.54mm_Stack', pins: { '1': 'FLOAT', '2': iso('GND', 'J3') }, at: J3_AT },
    { ref: 'J4', value: 'Гнездо 1×2', description: 'Гнездо к J4 верхней платы', fp: 'PinSocket_1x02_P2.54mm_Stack', pins: Object.fromEntries(J4_NETS.map((n, i) => [String(i + 1), n])), at: J4_AT },
    {
      ref: 'XS1',
      value: 'К пульту',
      description: `Шлейф к пульту 20 жил (IDC 2×10, красная жила — вывод 1), не длиннее 30–40 см: ${CABLE_TEXT}`,
      fp: 'IDC-Header_2x10_P2.54mm_RightAngle',
      pins: PANEL_CABLE,
      at: [col(3) + 11.43, PT_L_Y + 8.89],
    },
    // --- ШИМ МР248: 100 Ом от выводов (к J4); к земле IO39/IO38 стягивают входы 6–7 ULN2003 на верхней плате ---
    R('R62', '100', 'ШИМ регулятора турбины 1: защита вывода', 'T1', 'PWM1', [col(9), 17.78, 90], RV),
    R('R64', '100', 'ШИМ регулятора турбины 2: защита вывода', 'T2', 'PWM2', [col(10), 17.78, 90], RV),
    // --- АЦП термисторов: у левого края, выводами вдоль гнезда J2 (термисторы — из J2 1–2, I²C — из J2 9–10) ---
    {
      ref: 'DD2',
      value: 'ADS1115 (модуль)',
      description: 'АЦП ADS1115 (I²C 0x48, ADDR на земле): A0 — термистор турбины 1, A1 — турбины 2. Модуль — платкой к левому краю, на своих штырях (под ним только дорожки)',
      fp: 'Module_ADS1115',
      pins: { VDD: '3V3', GND: 'GND', SCL: 'SCL~A', SDA: 'SDA~A', ADDR: 'GND', A0: 'NTC1', A1: 'NTC2' },
      at: [ADS_AT[0], ADS_AT[1], ADS_AT[2]],
    },
    C('C82', '10 мкФ', 'Питание 3,3 В АЦП (керамика 106)', '3V3', 'GND', [16.51, 49.53, 90]),
    // --- середина 1,65 В для трансформаторов тока: над PT2 1–4, на верхнюю плату — через PT2 3 ---
    R('R23', '10k', 'Середина 1,65 В для ТТ: верхнее плечо', '3V3', 'VMID', [col(2), 50.8, 90], RV),
    R('R24', '10k', 'Середина 1,65 В для ТТ: нижнее плечо', 'VMID', 'GND', [col(3), 50.8, 90], RV),
    C('C23', '10 мкФ', 'Середина 1,65 В для ТТ (керамика 106)', 'VMID', 'GND', [col(4), 48.26, 90]),
    // --- датчик разрежения: между рядами штырей, выход — справа, прямо под PT2 16 (IO10) ---
    { ref: 'B1', value: 'MPX5100DP', description: 'Датчик разрежения 0–100 кПа (NXP) между платами: штуцеры — поперёк ряда выводов, трубка ко входу турбин (на P2, вакуумный) идёт между платами к краю; выход 0,2–4,7 В', fp: 'Sensor_MPX5100DP', pins: { VOUT: 'VAC_S', GND: 'GND', VS: '5V' }, at: [60.96, 38.1, 180], fields: { 'Где стоит': 'вход турбин' } },
    C('C13', '1 мкФ', 'Питание датчика разрежения (5 В — перемычкой от PT2 21)', '5V', 'GND', [64.77, 48.26], CER5),
    R('R27', '6,8k', 'Делитель датчика разрежения 4,7 → 2,8 В (нижнее плечо — на верхней плате)', 'VAC', 'VAC_S', [col(16), 38.1, 180], RV),
    C('C14', '10 нФ', 'Фильтр датчика разрежения', 'VAC', 'GND', [col(16) - 1.25, 48.26, 180]),
    hole('H1', [3.5, 3.5]),
    hole('H2', [w - 3.5, 3.5]),
    hole('H3', [3.5, h - 3.5]),
    hole('H4', [w - 3.5, h - 3.5]),
  ];
}

/**
 * Пульт: экран, PCA9555 и плеер под экраном, часы и разъём динамика в левой полосе, кнопки, энкодер,
 * зуммер, светодиод.
 */
export function panelParts(): ModPart[] {
  const { w, h } = PANEL_BOARD;
  const dx = PANEL_DX;
  const dy = 6;
  const aa = MSP.aa;
  // Правая часть пульта задана от прежнего края экрана (4 мм): сдвиг на ширину левой полосы.
  const sx = dx - 4;
  // Кнопки 1–3 — под вкладками экрана «Главная», «Очистка», «Фильтр» (вкладки по 96 точек из 480 внизу).
  const tab = (i: number) => dx + aa.x0 + ((48 + 96 * i) / 480) * (aa.x1 - aa.x0);
  const yKeys = dy + MSP.h + 9;
  // Только выводы по диагонали (1 и 4): внутри кнопки соединены пары по одной стороне — какая бы ни была
  // у вашей кнопки, диагональ замыкается только нажатием. Кнопки 1–3 повёрнуты: вкладки через 14,7 мм.
  const key = (ref: string, value: string, net: string, x: number, y: number, rot = 0): ModPart => ({ ref, value, description: `Кнопка «${value}» (тактовая 12×12, высота по передней панели)`, fp: BTN, pins: { '1': net, '4': 'GND' }, at: [x, y, rot] });
  return [
    {
      ref: 'HG1',
      value: 'MSP3520 3,5″',
      description: 'Экран 3,5″ 480×320 ILI9488 с касанием XPT2046 (MSP3520) на гнезде 1×14 и 4 стойках M3 11 мм; SDO экрана не подключён (мешает касанию на общей шине); подсветка LED — от 3,3 В',
      fp: 'Display_MSP3520_Landscape_Socket',
      pins: { VCC: '5V', GND: 'GND', CS: 'LCD_CS', RESET: 'LCD_RST', DC: 'LCD_DC', SDI: 'SPI_MOSI', SCK: 'SPI_SCK', LED: '3V3', T_CLK: 'SPI_SCK', T_CS: 'T_CS', T_DIN: 'SPI_MOSI', T_DO: 'SPI_MISO', T_IRQ: 'T_IRQ' },
      at: [dx, dy],
    },
    {
      ref: 'DD1',
      value: 'PCA9555 (платка)',
      description: 'Расширитель PCA9555/TCA9555 на платке 800 mil (I²C 0x20 — A0, A1, A2 на земле): кнопки, кнопка энкодера, сброс экрана, касание, светодиод, поплавок. Под экраном — паять прямо штырями, лишнее над платкой откусить (до экрана 8 мм)',
      fp: 'Module_PCA9555_2x12_800mil',
      pins: { VDD: '3V3', GND: 'GND', SDA: 'SDA', SCL: 'SCL', A0: 'GND', A1: 'GND', A2: 'GND', P00: 'K1', P01: 'K2', P02: 'K3', P03: 'K4', P04: 'K5', P05: 'K6', P06: 'KT1', P07: 'KT2', P10: 'KOFF', P11: 'ENC_SW', P12: 'LCD_RST', P13: 'LED_K', P14: 'T_IRQ', P17: 'FLOAT' },
      at: [50 + sx, 33, 90],
    },
    R('R4', '10k', 'Сброс экрана: подтяжка (сбрасывает PCA9555, вывод P12)', 'LCD_RST', '3V3', [74.93 + sx, 20.32]),
    R('R9', '4,7k', 'Подтяжка SDA шины I²C (на верхней плате её нет)', 'SDA', '3V3', [74.93 + sx, 45.72]),
    R('R10', '4,7k', 'Подтяжка SCL', 'SCL', '3V3', [74.93 + sx, 48.26]),
    R('R5', '10k', 'Подтяжка энкодера A', 'ENC_A', '3V3', [116.84 + sx, 44.45]),
    R('R6', '10k', 'Подтяжка энкодера B', 'ENC_B', '3V3', [116.84 + sx, 46.99]),
    C('C1', '10 нФ', 'Фильтр энкодера A', 'ENC_A', 'GND', [130.81 + sx, 44.45]),
    C('C2', '10 нФ', 'Фильтр энкодера B', 'ENC_B', 'GND', [130.81 + sx, 46.99]),
    C('C3', '10 мкФ', 'Питание 5 В экрана', '5V', 'GND', [93.98 + sx, 52.07], EL5),
    C('C4', '100 нФ', 'Питание 3,3 В PCA9555', '3V3', 'GND', [74.93 + sx, 25.4]),
    { ref: 'SA1', value: 'EC11', description: 'Энкодер EC11 с кнопкой, вал 20 мм: поворот — выбор и значение, нажатие — пуск/стоп на главной, иначе — на главную', fp: 'RotaryEncoder_Alps_EC11E_Vertical_H20mm', pins: { A: 'ENC_A', B: 'ENC_B', C: 'GND', S1: 'ENC_SW', S2: 'GND' }, at: [127 + sx, 33] },
    key('SB1', '1 Главная', 'K1', tab(0), yKeys, 90),
    key('SB2', '2 Очистка', 'K2', tab(1), yKeys, 90),
    key('SB3', '3 Фильтр', 'K3', tab(2), yKeys, 90),
    key('SB4', '4 Пуск/Стоп', 'K4', 116 + sx, 55),
    key('SB5', '5 Очистка', 'K5', 116 + sx, 68.5),
    key('SB6', '6 Мощная', 'K6', 116 + sx, 82),
    key('SB7', 'Турбина 1', 'KT1', 135 + sx, 55),
    key('SB8', 'Турбина 2', 'KT2', 135 + sx, 68.5),
    key('SB9', 'Выкл', 'KOFF', 135 + sx, 82),
    Q('VT1', 'Ключ зуммера', 'BZ_B', 'GND', 'BZ_K', [82.55 + sx, 74.93]),
    R('R7', '1k', 'База ключа зуммера', 'BZ', 'BZ_B', [72.39 + sx, 68.58]),
    { ref: 'VD1', value: '1N4148', description: 'Диод на катушке зуммера', fp: 'D_DO-35_P7.62mm_Horizontal', pins: { A: 'BZ_K', K: '5V' }, at: [72.39 + sx, 78.74] },
    { ref: 'BA1', value: 'Зуммер 5 В', description: 'Зуммер 12 мм на 5 В (без генератора — «set buzz 0», со своим генератором — «set buzz 1»)', fp: 'Buzzer_12x9.5RM7.6', pins: { '1': '5V', '2': 'BZ_K' }, at: [92 + sx, 72] },
    R('R8', '1k', 'Светодиод состояния (горит, когда P13 PCA9555 — «0»)', '3V3', 'LED_A', [64 + sx, yKeys + 5.08, 0], RV),
    { ref: 'HL1', value: 'зелёный', description: 'Светодиод состояния 3 мм (длинные ноги — до передней панели): мигает — работа, часто — неисправность', fp: 'LED_D3.0mm', pins: { A: 'LED_A', K: 'LED_K' }, at: [64 + sx, yKeys] },
    // --- голос: DFPlayer под экраном (паять прямо штырями), слот карты — к левому краю экрана ---
    {
      ref: 'DA1',
      value: 'DFPlayer Mini',
      description: 'MP3-плеер голоса (9600 бод с IO13 через перемычку JP1 и 1 кОм): карта microSD с папкой mp3 из прошивки — до установки экрана; динамик 8 Ом 1–3 Вт — на XA1. Паять прямо штырями (до экрана 8 мм)',
      fp: 'Module_DFPlayer_Mini_P18.03',
      pins: { VCC: '5V', RX: 'DF_RX', GND: 'GND', SPK_1: 'SPK1', SPK_2: 'SPK2' },
      at: [DF_AT[0], DF_AT[1], 270],
    },
    C('C81', '100 нФ', 'Питание плеера у вывода VCC', '5V', 'GND', [DF_AT[0] + 3.75, DF_AT[1] + 2.5, 90]),
    R('R80', '1k', 'RX плеера: последовательно (3,3 В на вход 5-вольтового плеера)', 'DF_J', 'DF_RX', [8.89, 54.61, 90], RV),
    { ref: 'JP1', value: 'Голос', description: 'Перемычка «голос»: IO13 → плеер. Снять, если IO13 занят второй шиной I²C (расходомер SDP810-125 на клеммнике X4 верхней платы)', fp: 'PinHeader_1x02_P2.54mm', pins: { '1': 'PNL_TX', '2': 'DF_J' }, at: [5.08, 52.07, 90] },
    { ref: 'XA1', value: 'Динамик', description: 'Динамик 8 Ом 1–3 Вт (Ø28–40 мм) на корпусе пульта: два провода (полярность не важна)', fp: 'PinHeader_1x02_P2.54mm', pins: { '1': 'SPK1', '2': 'SPK2' }, at: [5.08, 64.77, 90] },
    C('C80', '100 мкФ 10 В', 'Питание плеера: накопитель (усилитель динамика до 0,5 А)', '5V', 'GND', [7.62, 72.39, 0], EL5),
    // --- часы: модуль DS3231 «для Raspberry Pi» в левой полосе, платкой к краю ---
    { ref: 'DD2', value: 'DS3231 (для Pi)', description: 'Часы DS3231 с батарейкой CR1220 (I²C 0x68): модуль «для Raspberry Pi» садится своим гнездом на штыри 1×5 (3,3 В, SDA, SCL, —, GND), платкой к левому краю', fp: 'Module_DS3231_RPi_1x05', pins: { '3V3': '3V3', SDA: 'SDA', SCL: 'SCL', GND: 'GND' }, at: [11.8, 14, 270] },
    {
      ref: 'XS1',
      value: 'К плате',
      description: `Шлейф к нижней плате этажерки (IDC 2×10, красная жила — вывод 1), жилы те же: ${CABLE_TEXT}`,
      fp: 'IDC-Header_2x10_P2.54mm_RightAngle',
      pins: PANEL_CABLE,
      at: [127 + sx, 14, 180],
    },
    hole('H1', [3.5, 3.5]),
    hole('H2', [w - 3.5, 3.5]),
    hole('H3', [3.5, h - 3.5]),
    hole('H4', [w - 3.5, h - 3.5]),
  ];
}

/* ---------------- сборка ---------------- */

export type StackBoard = 'upper' | 'lower' | 'panel';

const BOARD_INFO: Record<StackBoard, { name: string; title: string; size: { w: number; h: number } }> = {
  upper: { name: 'Пылесос S3 — этажерка, верхняя плата', title: 'ПЫЛЕСОС S3 · ВЕРХ', size: STACK_BOARD },
  lower: { name: 'Пылесос S3 — этажерка, нижняя плата', title: 'ПЫЛЕСОС S3 · НИЗ', size: STACK_BOARD },
  panel: { name: 'Пылесос S3 — пульт 3,5″', title: 'ПЫЛЕСОС S3 · ПУЛЬТ', size: PANEL_BOARD },
};

const POWER = ['GND', '3V3', '5V'];
/** Надпись на верхней меди пульта — под экраном, где сверху дорожек нет. */
const PANEL_TOP_TITLE: [number, number] = [30, 12];
/** Где надпись на меди (центр первой строки). */
const TITLE_AT: Record<StackBoard, [number, number]> = { upper: [79, 30.5], lower: [70, 3.5], panel: [97, 10.5] };

/** Плата этажерки или пульта без дорожек: детали, цепи, правила под лазер. */
export function buildStackBoard(which: StackBoard): Project {
  const info = BOARD_INFO[which];
  const { w, h } = info.size;
  // Этажерка — односторонние платы (перемычки проводом), пульт — двусторонний без металлизации, как
  // прежние самодельные платы: все выводы паяются снизу, сверху только дорожки между переходными
  // (проволочки). Разъём экрана и шлейф идут в разном порядке — на одной стороне не обойтись без
  // десятков перемычек.
  const two = which === 'panel';
  const p = createProject({ name: info.name, width: w, height: h, copperLayers: two ? 2 : 1, cornerRadius: 2, homemade: true });
  p.meta.author = 'Plata';
  p.meta.description = {
    upper: 'Верхняя плата этажерки пылесоса S3 (прошивка 6.4): ESP32-S3-DevKitC-1 на гнёздах, ULN2003 к модулям реле и клапанов, клеммники датчиков, трансформаторов тока, бака, ZMPT101B, МР248 и питания 5 В, фильтры входов. Односторонняя, под лазер, без перемычек.',
    lower: 'Нижняя плата этажерки пылесоса S3: АЦП ADS1115 (термисторы), датчик разрежения MPX5100DP, середина 1,65 В для трансформаторов тока, ШИМ к МР248, разъём шлейфа к пульту. Односторонняя, под лазер, одна перемычка.',
    panel: 'Пульт пылесоса S3: экран 3,5″ MSP3520, PCA9555, 9 кнопок, энкодер EC11, зуммер, светодиод, плеер голоса DFPlayer Mini с динамиком, часы DS3231. Двусторонняя без металлизации (все выводы паяются снизу, сверху — дорожки между переходными), под лазер.',
  }[which];
  // Лазер даёт чёткий край — дорожки 0,6 мм, зазор 0,4 (как под ЛУТ, с запасом на травление); питание 0,8.
  p.netClasses.Default = { ...p.netClasses.Default, trackWidth: 0.6, clearance: 0.4, viaDiameter: 2.0, viaDrill: 0.8 };
  p.netClasses.Power = { ...p.netClasses.Power, trackWidth: 0.8, clearance: 0.4, viaDiameter: 2.2, viaDrill: 0.9 };
  p.rules.minClearance = 0.4;
  p.rules.edgeClearance = 1.0;
  const parts = which === 'upper' ? upperParts() : which === 'lower' ? lowerParts() : panelParts();
  for (const name of POWER) ensureNet(p, name, { netClass: 'Power', description: DESCRIPTIONS[name] });
  for (const part of parts) {
    const fp0 = fpOf(part.fp);
    const fp = two ? { ...fp0, pads: fp0.pads.map((q) => (q.type === 'tht' ? { ...q, layer: 'B.Cu' as const } : q)) } : fp0;
    const at = part.at ?? [0, 0, 0];
    const c = addComponent(p, fp, { x: at[0], y: at[1] }, { ref: part.ref, value: part.value, description: part.description, rotation: at[2] ?? 0 });
    if (part.fields) c.fields = { ...part.fields };
    if (!part.value) c.hideValue = true;
    const f = p.footprints[c.footprint];
    for (const [pin, net] of Object.entries(part.pins)) {
      const byName = f.pads.filter((q) => q.type !== 'npth' && q.name === pin);
      const pads = byName.length ? byName : f.pads.filter((q) => q.number === pin);
      if (!pads.length) throw new Error(`${part.ref}: нет вывода ${pin}`);
      const logical = logicalNet(net);
      const n = ensureNet(p, net, { netClass: POWER.includes(logical) ? 'Power' : undefined, description: DESCRIPTIONS[logical] });
      for (const q of pads) connectPad(p, c.id, q.number, n.id);
    }
  }
  for (const part of parts) if (part.labels) terminalLabels(p, part.ref, part.labels);
  if (two) {
    // Под плоскими корпусами (кнопки, энкодер, зуммер, угловой разъём шлейфа) проволочек-переходных нет:
    // корпус не сел бы на плату. Запрет — корпус с запасом на площадку переходного (центр переходного
    // вне области). Запреты — до остальных областей: где они пересекаются, действует последняя.
    for (const c of Object.values(p.components)) {
      if (!/^(SB\d+|SA1|BA1|XS1)$/.test(c.ref)) continue;
      const [a, b] = bodyBox(c, p.footprints[c.footprint], 1.1);
      addRuleArea(p, { name: `Под ${c.ref}`, outline: box(Math.max(0, a.x), Math.max(0, a.y), Math.min(w, b.x), Math.min(h, b.y)), keepoutVias: true, showLabel: false });
    }
  }
  // Надпись на меди: читается со стороны меди (так её и видит лазер) — проверка, что слой не перевёрнут.
  const [tx, ty] = TITLE_AT[which];
  const lines = info.title.split(' · ');
  const tw = Math.max(...lines.map((l) => textWidth(l, 1.5)));
  lines.forEach((l, i) => addDrawing(p, { kind: 'text', layer: 'B.Cu', at: { x: tx, y: ty + i * 2.6 }, text: l, size: 1.5, thickness: 0.3, align: 'center', mirror: true }));
  addRuleArea(p, { name: 'Надпись на меди', outline: box(tx - tw / 2 - 0.8, ty - 1.6, tx + tw / 2 + 0.8, ty + (lines.length - 1) * 2.6 + 1.6), keepoutTracks: true, keepoutVias: true, showLabel: false, ...(two ? { layers: ['B.Cu' as const] } : {}) });
  if (two) {
    // Вторая сторона пульта — та же надпись без зеркала: читается, если верх выжжен правильно.
    const [fx, fy] = PANEL_TOP_TITLE;
    const top = ['ПУЛЬТ S3', 'ВЕРХНЯЯ СТОРОНА'];
    const fw = Math.max(...top.map((l) => textWidth(l, 1.5)));
    top.forEach((l, i) => addDrawing(p, { kind: 'text', layer: 'F.Cu', at: { x: fx, y: fy + i * 2.6 }, text: l, size: 1.5, thickness: 0.3, align: 'center' }));
    addRuleArea(p, { name: 'Надпись на верхней меди', outline: box(fx - fw / 2 - 0.8, fy - 1.6, fx + fw / 2 + 0.8, fy + 2.6 + 1.6), keepoutTracks: true, keepoutVias: true, showLabel: false, layers: ['F.Cu'] });
  }
  if (which === 'upper') {
    // Антенна ESP32 (выступает за плату модуля на 6,3 мм, к левому краю): под ней меди нет.
    addRuleArea(p, { name: 'Антенна ESP32-S3', outline: box(DK.x - 8.9, ROW_R + 1.1, DK.x - 0.9, ROW_L - 1.0), keepoutTracks: true, keepoutVias: true, showLabel: false });
    addDrawing(p, { kind: 'text', layer: 'F.Silk', at: { x: DK.x - 4.9, y: (ROW_L + ROW_R) / 2 }, text: 'антенна - без меди', size: 1.1, thickness: 0.15, align: 'center', rotation: 90 });
  }
  // Под гайку и стойку M3 у отверстий — без меди (Ø6,6).
  for (const part of parts) if (part.fp === 'MountingHole_3.2mm_M3') addRuleArea(p, { name: `Стойка ${part.ref}`, outline: circlePoly(part.at![0], part.at![1], 3.3), keepoutTracks: true, keepoutVias: true, showLabel: false });
  layoutBlocks(p, blocksFor(which));
  for (const t of PREROUTES[which]) addTrack(p, { layer: 'B.Cu', width: t.width, points: t.points.map(([x, y]) => ({ x, y })), locked: true });
  for (const wr of PREWIRES[which]) {
    for (const [x, y] of [wr.a, wr.b]) addVia(p, { at: { x, y }, diameter: 2.2, drill: 0.9, locked: true });
    addWire(p, { x: wr.a[0], y: wr.a[1] }, { x: wr.b[0], y: wr.b[1] });
  }
  if (which === 'lower') {
    // Земля нижней платы — заливкой: меньше выжигать и меньше перемычек (земли много у модулей и разъёма пульта).
    const gnd = ensureNet(p, 'GND', { netClass: 'Power' }).id;
    addZone(p, { name: 'Земля', layer: 'B.Cu', net: gnd, outline: box(0.5, 0.5, w - 0.5, h - 0.5), clearance: 0.5, minWidth: 0.5, priority: 0 });
  }
  return structuredClone(p);
}

/**
 * Дорожки, проложенные заранее (трассировщик их не трогает): земля верхней платы — одной шиной вдоль
 * левого края, под клеммниками, от входа питания до всех клеммников датчиков; иначе она обходит выводы
 * справа и запирает сигналы.
 */
const PREROUTES: Record<StackBoard, { width: number; points: [number, number][] }[]> = {
  upper: [
    // Земля левого края: от вывода GND ESP32 (правый ряд, 1) через PT1 1 над гнездом J2 к клеммнику X2 и вдоль края.
    { width: 0.8, points: [[34.29, 25.4], [34.29, 6.35], [6.35, 6.35], [4.6, 8.1], [4.6, 8.5]] },
    { width: 0.8, points: [[4.6, 8.5], [2.54, 10.56], [2.54, 72.04], [7.9, 77.4], [9.75, 77.4]] },
    { width: 0.8, points: [[2.54, 15.5], [4.6, 15.5]] },
    { width: 0.8, points: [[2.54, 22.5], [4.6, 22.5]] },
    { width: 0.8, points: [[2.54, 31.25], [4.6, 31.25]] },
    { width: 0.8, points: [[2.54, 45.5], [4.6, 45.5]] },
    { width: 0.8, points: [[2.54, 60.0], [4.6, 60.0]] },
    { width: 0.6, points: [[7.62, 14.5], [6.62, 15.5], [4.6, 15.5]] },
    { width: 0.6, points: [[7.62, 21.5], [6.62, 22.5], [4.6, 22.5]] },
    // Земля фильтров ТТ под ESP32 — к тому же выводу GND.
    { width: 0.8, points: [[46.99, 43.2], [41.91, 43.2], [40.64, 41.93], [34.29, 35.58], [34.29, 25.4]] },
    // Клеммники левого края → J2: каждый своей полосой.
    { width: 0.6, points: [[4.6, 12.0], [9.46, 12.0], [19.05, 21.59]] },
    { width: 0.6, points: [[4.6, 19.0], [11.38, 19.0], [16.51, 24.13], [19.05, 24.13]] },
    { width: 0.8, points: [[4.6, 27.75], [17.97, 27.75], [19.05, 26.67]] },
    { width: 0.8, points: [[4.6, 35.0], [11.85, 27.75]] },
    { width: 0.6, points: [[4.6, 38.5], [13.89, 29.21], [19.05, 29.21]] },
    { width: 0.6, points: [[4.6, 42.0], [14.85, 31.75], [19.05, 31.75]] },
    { width: 0.8, points: [[4.6, 49.5], [19.05, 34.29]] },
    { width: 0.6, points: [[4.6, 53.0], [19.05, 36.83]] },
    { width: 0.6, points: [[4.6, 56.5], [19.05, 39.37]] },
    { width: 0.6, points: [[13.25, 77.4], [13.25, 48.3], [19.05, 41.91]] },
    { width: 0.6, points: [[16.75, 77.4], [16.75, 46.75], [19.05, 44.45]] },
    { width: 0.8, points: [[20.25, 77.4], [20.25, 48.19], [19.05, 46.99]] },
    // Справа от J2: 3,3 В одной полосой (делители термисторов, подтяжки, J2 3/6/11) — к выводу 3V3 ESP32.
    { width: 0.8, points: [[24.13, 21.59], [24.13, 48.26]] },
    { width: 0.8, points: [[19.05, 26.67], [24.13, 26.67]] },
    { width: 0.8, points: [[19.05, 34.29], [24.13, 34.29]] },
    { width: 0.8, points: [[20.25, 48.26], [34.29, 48.26]] },
    { width: 0.6, points: [[19.05, 21.59], [21.59, 21.59]] },
    { width: 0.6, points: [[19.05, 24.13], [21.59, 24.13]] },
    { width: 0.6, points: [[19.05, 29.21], [21.59, 29.21]] },
    { width: 0.6, points: [[19.05, 31.75], [21.59, 31.75]] },
    // SCL и SDA двух клеммников: J2 7 ↔ 10 справа, 8 ↔ 9 напрямую.
    { width: 0.6, points: [[19.05, 36.83], [21.59, 36.83], [21.59, 44.45], [19.05, 44.45]] },
    { width: 0.6, points: [[19.05, 39.37], [19.05, 41.91]] },
    // Середина 1,65 В с нижней платы (PT2 3) — на «ср» клеммника X1.
    { width: 0.6, points: [[39.37, 53.34], [39.37, 77.4]] },
    { width: 0.6, points: [[35.7, 77.4], [42.7, 77.4]] },
    // Электроды бака: R41, C40, R43 → E1, E0, E2 клеммника X5.
    { width: 0.6, points: [[67.31, 58.42], [67.31, 60.98]] },
    { width: 0.6, points: [[64.77, 58.42], [64.77, 76.67], [65.5, 77.4]] },
    { width: 0.6, points: [[67.31, 63.48], [67.31, 75.71], [69.0, 77.4]] },
    { width: 0.6, points: [[69.85, 58.42], [69.85, 74.75], [72.5, 77.4]] },
    // Вход 5 В: XP1 под выводами 5V и GND ESP32, накопитель C1, земля бака и J3.
    { width: 0.8, points: [[85.09, 53.34], [85.09, 59.21], [80.01, 64.29]] },
    { width: 0.8, points: [[85.09, 59.21], [86.63, 60.75], [86.63, 66.04]] },
    { width: 0.8, points: [[87.63, 53.34], [88.9, 54.61], [88.9, 65.77], [88.63, 66.04]] },
    { width: 0.8, points: [[88.63, 66.04], [88.63, 67.81], [88.13, 68.31], [80.53, 68.31], [80.01, 67.79]] },
    { width: 0.8, points: [[76.2, 60.96], [76.2, 67.79], [80.01, 67.79]] },
    { width: 0.8, points: [[79.5, 77.4], [80.01, 76.89], [80.01, 67.79]] },
    { width: 0.6, points: [[76.0, 77.4], [73.66, 75.06], [73.66, 60.96]] },
  ],
  lower: [
    // Сигналы правого ряда ESP32 к разъёму пульта: под гнездом PT1 — вправо, каналом по правому краю
    // вниз и под корпусом разъёма — к нечётным выводам 3–11 снизу.
    { width: 0.6, points: [[77.47, 20.32], [77.47, 22.86], [94.615, 22.86], [94.615, 73.66], [41.91, 73.66], [41.91, 62.23]] },
    { width: 0.6, points: [[74.93, 20.32], [74.93, 24.13], [93.345, 24.13], [93.345, 72.39], [44.45, 72.39], [44.45, 62.23]] },
    { width: 0.6, points: [[69.85, 20.32], [69.85, 25.4], [92.075, 25.4], [92.075, 71.12], [46.99, 71.12], [46.99, 62.23]] },
    { width: 0.6, points: [[67.31, 20.32], [67.31, 26.67], [90.805, 26.67], [90.805, 69.85], [49.53, 69.85], [49.53, 62.23]] },
    { width: 0.6, points: [[36.83, 20.32], [36.83, 27.94], [89.535, 27.94], [89.535, 68.58], [52.07, 68.58], [52.07, 62.23]] },
    // Справа к разъёму пульта: 5 В, голос (IO13), поплавок (J3), SCL и SDA.
    { width: 0.8, points: [[85.09, 53.34], [85.09, 67.31], [54.61, 67.31], [54.61, 62.23]] },
    { width: 0.6, points: [[80.01, 53.34], [80.01, 66.04], [57.15, 66.04], [57.15, 62.23]] },
    { width: 0.6, points: [[73.66, 60.96], [73.66, 64.77], [59.69, 64.77], [59.69, 62.23]] },
    { width: 0.6, points: [[77.47, 53.34], [77.47, 57.15], [64.77, 57.15], [64.77, 62.23], [62.23, 62.23]] },
    { width: 0.6, points: [[74.93, 53.34], [74.93, 55.88], [62.23, 55.88], [62.23, 59.69]] },
    // SPI и DC экрана — прямо вниз в чётные 12–18.
    { width: 0.6, points: [[52.07, 53.34], [52.07, 59.69]] },
    { width: 0.6, points: [[54.61, 53.34], [54.61, 59.69]] },
    { width: 0.6, points: [[57.15, 53.34], [57.15, 59.69]] },
    { width: 0.6, points: [[59.69, 53.34], [59.69, 59.69]] },
    // Земля разъёма пульта: дверь PT2 7 → чётные 10–4, нечётный 1.
    { width: 0.6, points: [[49.53, 53.34], [49.53, 59.69], [41.91, 59.69]] },
    { width: 0.6, points: [[39.37, 62.23], [41.91, 59.69]] },
    // 3,3 В: выводы 1–2 нижнего ряда — в разъём пульта, на делитель 1,65 В и к АЦП.
    { width: 0.8, points: [[34.29, 53.34], [36.83, 53.34]] },
    { width: 0.8, points: [[36.83, 53.34], [39.37, 55.88], [39.37, 59.69]] },
    { width: 0.8, points: [[34.29, 53.34], [31.75, 50.8], [15.24, 50.8], [13.97, 49.53]] },
    { width: 0.8, points: [[36.83, 53.34], [36.83, 50.8]] },
    // Середина 1,65 В: R23–R24–C23 → PT2 3 (на верхней плате — к клеммнику ТТ).
    { width: 0.6, points: [[39.37, 53.34], [39.37, 50.8]] },
    { width: 0.6, points: [[36.83, 48.26], [39.37, 50.8], [40.64, 49.53], [41.91, 49.53]] },
    // Термисторы: J2 1–2 → A0, A1 АЦП (A0 — в обход столбца выводов слева, под платкой модуля).
    { width: 0.6, points: [[19.05, 21.59], [11.43, 21.59], [11.43, 34.29], [13.97, 34.29]] },
    { width: 0.6, points: [[19.05, 24.13], [16.51, 24.13], [16.51, 31.75], [13.97, 31.75]] },
    // I²C АЦП — в J2 9–10 (на верхней плате они соединены с 8 и 7).
    { width: 0.6, points: [[13.97, 41.91], [19.05, 41.91]] },
    { width: 0.6, points: [[13.97, 44.45], [19.05, 44.45]] },
    // ШИМ МР248: IO39/IO38 → 100 Ом → J4 (PWM1 — поверху, чтобы земля под ним не оказалась взаперти).
    { width: 0.6, points: [[54.61, 20.32], [54.61, 17.78]] },
    { width: 0.6, points: [[57.15, 20.32], [57.15, 17.78]] },
    { width: 0.6, points: [[57.15, 15.24], [67.31, 15.24]] },
    { width: 0.6, points: [[54.61, 15.24], [54.61, 12.7], [55.88, 11.43], [68.58, 11.43], [69.85, 12.7], [69.85, 15.24]] },
    // Датчик разрежения: IO10 (PT2 16) прямо вверх к R27 и C14, VOUT → R27; 5 В — к C13 и переходному под перемычку.
    { width: 0.6, points: [[72.39, 53.34], [72.39, 38.1]] },
    { width: 0.6, points: [[67.31, 38.1], [69.85, 38.1]] },
    { width: 0.8, points: [[62.23, 38.1], [62.23, 50.8]] },
    { width: 0.8, points: [[85.09, 53.34], [85.09, 50.8]] },
    // Шина I²C и IO13/IO14: от нижнего ряда штырей вверх, под верхним рядом — к гнезду J2 справа.
    { width: 0.6, points: [[74.93, 53.34], [74.93, 33.02], [24.13, 33.02], [24.13, 39.37], [19.05, 39.37]] },
    { width: 0.6, points: [[77.47, 53.34], [77.47, 31.75], [22.86, 31.75], [22.86, 36.83], [19.05, 36.83]] },
    { width: 0.6, points: [[80.01, 53.34], [80.01, 30.48], [21.59, 30.48], [21.59, 31.75], [19.05, 31.75]] },
    { width: 0.6, points: [[82.55, 53.34], [82.55, 29.21], [19.05, 29.21]] },
  ],
  panel: [],
};



/** Перемычки проводом, проложенные заранее (на концах — переходные под провод). */
const PREWIRES: Record<StackBoard, { a: [number, number]; b: [number, number] }[]> = {
  upper: [],
  // 5 В к датчику разрежения: через шину I²C и IO13/IO14 поверху.
  lower: [{ a: [62.23, 50.8], b: [85.09, 50.8] }],
  panel: [],
};

const circlePoly = (cx: number, cy: number, r: number) => Array.from({ length: 16 }, (_, i) => ({ x: +(cx + r * Math.cos((i * Math.PI) / 8)).toFixed(3), y: +(cy + r * Math.sin((i * Math.PI) / 8)).toFixed(3) }));
const box = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function blocksFor(which: StackBoard): SchBlock[] {
  if (which === 'upper')
    return [
      { title: 'ESP32-S3, питание, разъёмы между платами', at: [10, 10], width: 200, parts: ['A1', 'PT1', 'PT2', 'J2', 'J3', 'J4', 'XP1', ['C1', 90], 'X11'] },
      { title: 'Выходы к модулям сетевого отсека', at: [220, 10], width: 160, parts: ['DD1', ['R61', 90], ['R58', 90], 'X6', 'X8', 'X7', 'X9', ['R70', 90], ['R71', 90], ['C26', 90]] },
      { title: 'Датчики', at: [10, 130], width: 370, parts: ['X1', ['R20', 90], ['R21', 90], ['R22', 90], ['C20', 90], ['C21', 90], ['C22', 90], 'X5', ['R41', 90], ['C40', 90], ['R40', 90], ['R43', 90], ['R42', 90], ['C41', 90], ['R44', 90], ['C42', 90], ['R28', 90], 'X2', ['C24', 90], ['C25', 90], ['R25', 90], ['R26', 90], 'X4', 'X3', 'X10', ['R72', 90], ['R73', 90]] },
    ];
  if (which === 'lower')
    return [
      { title: 'Разъёмы', at: [10, 10], width: 200, parts: ['PT1', 'PT2', 'J2', 'J3', 'J4', 'XS1'] },
      { title: 'Датчик разрежения', at: [220, 10], width: 220, parts: ['B1', ['C13', 90], ['R27', 90], ['C14', 90]] },
      { title: 'ШИМ МР248', at: [10, 140], width: 200, parts: [['R62', 90], ['R64', 90]] },
      { title: 'АЦП термисторов, середина 1,65 В', at: [220, 140], width: 220, parts: ['DD2', ['C82', 90], ['R23', 90], ['R24', 90], ['C23', 90]] },
    ];
  return [
    { title: 'Пульт', at: [10, 10], width: 320, parts: ['XS1', 'HG1', 'DD1', ['R4', 90], ['C4', 90], ['R9', 90], ['R10', 90], 'SA1', ['R5', 90], ['R6', 90], ['C1', 90], ['C2', 90], ['C3', 90], 'SB1', 'SB2', 'SB3', 'SB4', 'SB5', 'SB6', 'SB7', 'SB8', 'SB9', 'VT1', 'R7', 'VD1', 'BA1', 'R8', 'HL1'] },
    { title: 'Голос и часы', at: [340, 10], width: 200, parts: ['DA1', ['C81', 90], ['C80', 90], 'JP1', ['R80', 90], 'XA1', 'DD2'] },
  ];
}

/**
 * Корпус детали в координатах платы (углы min, max) с запасом m: прямоугольник шелкографии (у углового
 * разъёма это корпус без выводов), иначе прямоугольник или круг сборочного слоя.
 */
export function bodyBox(c: Component, fp: FootprintDef, m: number): [Vec2, Vec2] {
  const silk = fp.graphics.find((g): g is Extract<Graphic, { kind: 'rect' }> => g.kind === 'rect' && g.layer === 'F.Silk');
  const fab = fp.graphics.find((g): g is Extract<Graphic, { kind: 'rect' | 'circle' }> => (g.kind === 'rect' || g.kind === 'circle') && g.layer === 'F.Fab');
  const r = silk ?? fab;
  if (!r) throw new Error(`${c.ref}: корпус не нарисован`);
  const [a, b] = r.kind === 'circle' ? [{ x: r.c.x - r.r, y: r.c.y - r.r }, { x: r.c.x + r.r, y: r.c.y + r.r }] : [r.a, r.b];
  const pl = placementOf(c);
  const pts = [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }].map((q) => toWorld(pl, q));
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return [
    { x: Math.min(...xs) - m, y: Math.min(...ys) - m },
    { x: Math.max(...xs) + m, y: Math.max(...ys) + m },
  ];
}

/* ---------------- разводка ---------------- */

export interface StackRouteVariant {
  label: string;
  hopCost: number;
  options?: Partial<RouteOptions>;
}

const VARIANTS: StackRouteVariant[] = [
  { label: 'короткие первыми', hopCost: 14 },
  { label: 'случайный порядок 3', hopCost: 14, options: { order: 'random', seed: 3 } },
  { label: 'случайный порядок 7, дешевле перемычки', hopCost: 9, options: { order: 'random', seed: 7 } },
  { label: 'длинные первыми', hopCost: 14, options: { order: 'long' } },
];
/**
 * Двусторонний пульт: без диагоналей (как прежние самодельные платы). Порядки — из перебора: под
 * кнопками, энкодером, зуммером и корпусом разъёма шлейфа переходных нет, и разводится не каждый.
 */
const VARIANTS_TWO: StackRouteVariant[] = [
  { label: 'случайный порядок 7', hopCost: 16, options: { order: 'random', seed: 7 } },
  { label: 'случайный порядок 9, переходные дороже', hopCost: 28, options: { order: 'random', seed: 9 } },
];

/**
 * Разводка односторонней платы с перемычками: питание и сигналы одним согласованием на сетке 1,27
 * (между выводами с шагом 2,54 дорожка не проходит — обходит или прыгает перемычкой). Из нескольких
 * порядков берётся вариант без неразведённых связей с наименьшим числом перемычек.
 */
export async function routeStackBoard(p0: Project, o: { iterations?: number; variants?: StackRouteVariant[]; diagonal?: boolean } = {}): Promise<{ project: Project; report: string[]; failed: number; wires: number }> {
  let best: { q: Project; r: RouteResult; label: string } | null = null;
  const report: string[] = [];
  // Двусторонний пульт: переходные вместо перемычек, верх дороже (там только проволочки к низу).
  const two = p0.board.copperLayers === 2;
  for (const v of o.variants ?? (two ? VARIANTS_TWO : VARIANTS)) {
    const q = structuredClone(p0);
    const r = await autorouteWithZones(q, { iterations: o.iterations ?? (two ? 300 : 60), yieldEvery: 1e9, grid: 1.27, allowWires: !two, keepExisting: true, hopCost: v.hopCost, diagonal: o.diagonal ?? !two, greed: 1, wireMin: 3.8, wireMax: 25.4, stitch: false, ...(two ? { layerCost: [1.6, 1] } : {}), ...v.options });
    for (const t of r.tracks) addTrack(q, t);
    for (const via of r.vias) addVia(q, via);
    for (const wr of r.wires) addWire(q, wr.a, wr.b);
    report.push(`${v.label}: дорожек ${r.tracks.length}, перемычек ${r.wires.length}, не проведено ${r.failed}`);
    const better = !best || r.failed < best.r.failed || (r.failed === best.r.failed && r.wires.length < best.r.wires.length);
    if (better) best = { q: structuredClone(q), r, label: v.label };
  }
  return { project: best!.q, report, failed: best!.r.failed, wires: best!.r.wires.length };
}
