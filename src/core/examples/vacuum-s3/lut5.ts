import { addComponent, addRuleArea, connectPad, ensureNet } from '../../model/edit';
import { applyPlacement, autoplace } from '../../place/autoplace';
import { placementOf, toWorld } from '../../model/placement';
import { createProject } from '../../model/project';
import type { Component, FootprintDef, Graphic, PadDef, Project } from '../../model/types';
import type { Vec2 } from '../../math/vec';
import { terminalLabels, type ModPart } from './mod';
import { DESCRIPTIONS, fpOf, PASS_L, PASS_R, routeStackBoard, STACK_PINS } from './stack';

/*
 * Пылесос S3 этажеркой под ЛУТ с масками (двусторонние платы без металлизации, прошивка 6.4):
 * четыре платы 140×90 одна за другой на стойках M3 20 мм, считая от лицевой.
 *
 *  1 — лицевая: экран 3,5″ MSP3520 на стойках 11 мм, по 3 кнопки по бокам экрана, внизу Т1, Т2,
 *      энкодер, «Выкл», светодиод и зуммер; PCA9555 в SOIC-24 под экраном.
 *  2 — контроллер: ESP32-S3-DevKitC-1 на гнёздах (антенна — к верхнему краю, USB — вниз, под угловой
 *      штекер удлинителя), ULN2003 к модулям реле и клапанов.
 *  3 — датчики и голос: ADS1115, часы DS3231 (ZS-042), плеер DFPlayer Mini, датчик разрежения
 *      MPX5100DP (трубка — к правому краю), разъём динамика.
 *  4 — разъёмы: угловые разъёмные клеммники 5,08 (KF2EDGR, ответная часть с винтами — KF2EDGK) по
 *      краям, фильтры входов; правый край — жгут к силовой плате (реле, клапаны, МР248, ZMPT101B).
 *
 * Связь этажей — шина из двух рядов по 22 штыря в столбцах выводов ESP32 (как проходные штыри прежней
 * этажерки): у лицевой — длинные штыри (25 мм) назад, у средних — гнездо от предыдущей и длинные штыри
 * к следующей через ряд (2,54 мм), у задней — гнездо. Каждый провод шины — в столбце «своего» вывода
 * ESP32; столбцы свободных выводов («двери») несут выходы ULN2003, поплавок и термисторы. Все выводы
 * паяются снизу (медь только с нижней стороны вокруг отверстий), сверху — дорожки между переходными
 * (проволочками); PCA9555 — сверху.
 */

export const LUT_BOARD = { w: 140, h: 90 };
/** Расстояние между платами, мм (стойки M3; длинные штыри 25 мм). */
export const LUT_GAP = 20;
export type LutFloor = 1 | 2 | 3 | 4;

/** Вывод 1 (3V3) ESP32 на этаже 2: ряды вертикально, антенна вверх. */
const DK = { x: 58.42, y: 8.89 };
const rowY = (c: number) => +(DK.y + 2.54 * (c - 1)).toFixed(3);
/** Ряды шины: a — сразу за рядом ESP32 (у клонов с 25,4 мм — за вторым рядом), b — ещё на 2,54 дальше. */
const BUS_X = { L: { a: +(DK.x - 5.08).toFixed(3), b: +(DK.x - 7.62).toFixed(3) }, R: { a: +(DK.x + 27.94).toFixed(3), b: +(DK.x + 30.48).toFixed(3) } };

/**
 * Провода шины: столбец → цепь. Столбцы — как выводы ESP32 (левый ряд 3V3 … GND, правый GND … GND);
 * двери (вывод ESP32 свободен и на этаже 2 с шиной не соединён): R3 (RX), R11–R13 (IO37–IO35 — память),
 * R19–R20 (IO20/IO19 — USB), L3 (RST), L12 (IO8).
 */
export const BUS: Record<'L' | 'R', Record<number, string>> = {
  L: { ...PASS_L, 3: 'NTC1', 7: 'UAC', 12: 'NTC2' },
  R: { ...PASS_R, 3: 'RL1_K', 11: 'RL2_K', 12: 'RL3_K', 13: 'VLV2_K', 19: 'VLV1_K', 20: 'FLOAT' },
};
export const BUS_DOORS = new Set(['R3', 'R11', 'R12', 'R13', 'R19', 'R20', 'L3', 'L12']);
const POWER = ['GND', '3V3', '5V'];

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
const text = (layer: Graphic['layer'], x: number, y: number, s: string, size = 1.0): Graphic => ({ kind: 'text', layer, at: { x: +x.toFixed(3), y: +y.toFixed(3) }, text: s, size, thickness: size * 0.14, align: 'center' });

/** Ряд шины 1×22 вертикально (вывод 1 сверху): гнездо PBS или длинные штыри 25 мм. */
function busRow(kind: 'socket' | 'header'): FootprintDef {
  const n = 22;
  const L = (n - 1) * 2.54;
  const socket = kind === 'socket';
  return {
    id: socket ? 'LUT_Bus_Socket_1x22' : 'LUT_Bus_LongPins_1x22',
    name: socket ? 'Шина: гнездо 1×22' : 'Шина: длинные штыри 1×22',
    description: socket
      ? 'Гнездо 1×22 (PBS, высота 8,5 мм): в него входят длинные штыри предыдущей платы'
      : `Штыри 1×22 с длинными выводами (общая длина 25 мм): пластик — сверху, штыри насквозь, ниже платы на ~17 мм — в гнездо следующей платы (между платами ${LUT_GAP} мм)`,
    category: 'Разъёмы',
    refPrefix: 'XB',
    tags: ['header', 'bus', '1x22'],
    pads: Array.from({ length: n }, (_, k) => tht(String(k + 1), '', 0, k * 2.54, { rect: k === 0 })),
    graphics: [rect('F.Fab', -1.27, -1.27, 1.27, L + 1.27, 0.1), rect('F.Silk', -1.2, -1.33, 1.2, L + 1.33)],
    courtyard: { min: { x: -1.2, y: -1.6 }, max: { x: 1.2, y: L + 1.6 } },
    source: 'Стандарт 2,54 мм',
    verified: true,
    height: socket ? 8.5 : 6,
  };
}

/**
 * Угловой разъёмный клеммник 5,08 на плату (KF2EDGR, «вилка»): выводы в ряд по +X, корпус и вход
 * ответной части с винтами (KF2EDGK) — к +Y, к краю платы. Размеры типовые — сверить с купленными.
 */
function kf2edgr(n: number): FootprintDef {
  const L = (n - 1) * 5.08;
  return {
    id: `LUT_KF2EDGR_1x${String(n).padStart(2, '0')}_P5.08mm`,
    name: `KF2EDGR ${n}, 5,08 угловой`,
    description: `Разъёмный клеммник 5,08, ${n} конт., угловой (на плате — KF2EDGR, на проводе — KF2EDGK с винтами); вход провода — к краю платы`,
    category: 'Разъёмы',
    refPrefix: 'X',
    tags: ['terminal', 'pluggable', 'kf2edg', 'angled'],
    pads: Array.from({ length: n }, (_, k) => tht(String(k + 1), '', k * 5.08, 0, { d: 2.4, drill: 1.3, rect: k === 0 })),
    graphics: [rect('F.Fab', -2.54, -2.6, L + 2.54, 8.2, 0.1), rect('F.Silk', -2.6, -2.66, L + 2.6, 8.26), text('F.Fab', L / 2, 5.5, 'вход', 1.0)],
    // Корпуса встают вплотную (5,08 на вывод): ограждение — по корпусу.
    courtyard: { min: { x: -2.5, y: -9.5 }, max: { x: L + 2.5, y: 8.3 } },
    source: 'KF2EDGR-5.08 (типовой чертёж), сверить',
    verified: false,
    height: 12.5,
  };
}

/**
 * Часы ZS-042 (DS3231 + AT24C32) лёжа на гнёздах: 1×6 (32K, SQW, SCL, SDA, VCC, GND) — у одного
 * конца, 1×4 у другого — только опора (выводы не соединены). Платка 38×22, держатель CR2032 сверху.
 */
function zs042(): FootprintDef {
  const names = ['32K', 'SQW', 'SCL', 'SDA', 'VCC', 'GND'];
  const pads = names.map((n, i) => tht(String(i + 1), n, 0, i * 2.54, { rect: i === 0 }));
  for (let i = 0; i < 4; i++) pads.push(tht(`S${i + 1}`, '', 33.5, 2.54 + i * 2.54));
  return {
    id: 'LUT_DS3231_ZS042_Sockets',
    name: 'Часы ZS-042 (DS3231) на гнёздах',
    description:
      'Модуль часов ZS-042 (DS3231 + AT24C32, CR2032) лёжа: свои штыри 1×6 — в гнездо 1×6, штыри 1×4 с другого конца — в гнездо-опору (не соединено). Модуль заряжает батарейку: для CR2032 выпаять диод зарядки (или ставить LIR2032)',
    category: 'Модули',
    refPrefix: 'DD',
    tags: ['ds3231', 'rtc', 'module', 'zs-042'],
    pads,
    graphics: [rect('F.Fab', -2.2, -4.65, 35.8, 17.35, 0.1), rect('F.Silk', -1.33, -1.33, 1.33, 14.03), rect('F.Silk', 32.17, 1.21, 34.83, 11.49), text('F.Silk', 17, 6.35, 'DS3231 ZS-042', 1.2)],
    courtyard: { min: { x: -2.5, y: -5.0 }, max: { x: 36.1, y: 17.7 } },
    source: 'ZS-042, типовые размеры 38×22 мм — сверить',
    verified: false,
    height: 15,
  };
}

/**
 * Экран и ESP32 стоят над платой (на стойках и гнёздах): их ограждение — только по самой плате у
 * разъёма, иначе под ними нельзя было бы ставить детали.
 */
function overBoard(id: string, newId: string, court: FootprintDef['courtyard']): FootprintDef {
  return { ...fpOf(id), id: newId, courtyard: court };
}

const LUT_FOOTPRINTS: FootprintDef[] = [
  busRow('socket'),
  busRow('header'),
  zs042(),
  ...[2, 3, 4, 5, 6, 7].map(kf2edgr),
  // Гнездо 1×14 экрана: x = 96, выводы 44,68 … 11,66.
  overBoard('Display_MSP3520_Landscape_Socket', 'LUT_MSP3520_Socket', { min: { x: 94.4, y: 10.0 }, max: { x: 97.6, y: 46.3 } }),
  // Гнёзда ESP32 и второй правый ряд (25,4): до ряда шины 27,94 — 1,2 мм.
  overBoard('Module_ESP32-S3_DevKitC-1_Sockets', 'LUT_DevKitC_Sockets', { min: { x: -1.3, y: -1.6 }, max: { x: 26.7, y: 53.34 + 1.6 } }),
];
const fpLut = (id: string): FootprintDef => LUT_FOOTPRINTS.find((f) => f.id === id) ?? fpOf(id);

/* ---------------- детали ---------------- */

const RES = 'R_Axial_0.25W_L6.3mm_D2.5mm_P7.62mm_Horizontal';
const RV = 'R_Axial_0.25W_L6.3mm_D2.5mm_P2.54mm_Vertical';
const CER = 'C_Disc_D5mm_W2.5mm_P2.5mm';
const CER5 = 'C_Disc_D6mm_W2.5mm_P5mm';
const EL5 = 'CP_Radial_D5mm_P2mm';
const BTN = 'SW_PUSH_12mm';
type At = [number, number, number?];
const R = (ref: string, value: string, description: string, a: string, b: string, at: At, fp = RV): ModPart => ({ ref, value, description, fp, pins: { '1': a, '2': b }, at });
const C = (ref: string, value: string, description: string, a: string, b: string, at: At, fp = CER): ModPart => ({ ref, value, description, fp, pins: { '1': a, '2': b }, at });
const hole = (ref: string, at: At): ModPart => ({ ref, value: '', description: 'Крепёжное отверстие M3: стойка между платами (20 мм) или к корпусу', fp: 'MountingHole_3.2mm_M3', pins: {}, at });
const holes = (): ModPart[] => [hole('H1', [3.5, 3.5]), hole('H2', [136.5, 3.5]), hole('H3', [3.5, 86.5]), hole('H4', [136.5, 86.5])];

/**
 * Клеммник у края: «L» — левый край (вход влево), «R» — правый, «B» — нижний. Цепи и подписи — по
 * порядку на плате (сверху вниз, слева направо); first — где первый (верхний или левый) вывод.
 */
function term(ref: string, value: string, description: string, nets: string[], labels: string[], edge: 'L' | 'R' | 'B', first: number): ModPart {
  const n = nets.length;
  const L = (n - 1) * 5.08;
  // Вывод 1 корпуса: левый край — сверху (поворот 270, ряд вниз), правый — снизу (90, ряд вверх), нижний — слева.
  const at: At = edge === 'L' ? [8.0, first, 270] : edge === 'R' ? [132.0, first + L, 90] : [first, 82.0, 0];
  const rev = edge === 'R';
  const n2 = rev ? [...nets].reverse() : nets;
  const l2 = rev ? [...labels].reverse() : labels;
  return { ref, value, description, fp: `LUT_KF2EDGR_1x${String(n).padStart(2, '0')}_P5.08mm`, pins: Object.fromEntries(n2.map((x, i) => [String(i + 1), x])), at, labels: l2 };
}

/** Этаж 1 — лицевой: экран, кнопки, энкодер, PCA9555, зуммер, светодиод. */
export function floor1Parts(): ModPart[] {
  const key = (ref: string, value: string, net: string, x: number, y: number): ModPart => ({ ref, value, description: `Кнопка «${value}» (тактовая 12×12, толкатель 15 мм)`, fp: BTN, pins: { '1': net, '4': 'GND' }, at: [x, y] });
  const yK = 75;
  return [
    {
      ref: 'HG1',
      value: 'MSP3520 3,5″',
      description: 'Экран 3,5″ 480×320 ILI9488 с касанием XPT2046 (MSP3520) на гнезде 1×14 и 4 стойках M3 11 мм; SDO экрана не подключён; подсветка LED — от 3,3 В',
      fp: 'LUT_MSP3520_Socket',
      pins: { VCC: '5V', GND: 'GND', CS: 'LCD_CS', RESET: 'LCD_RST', DC: 'LCD_DC', SDI: 'SPI_MOSI', SCK: 'SPI_SCK', LED: '3V3', T_CLK: 'SPI_SCK', T_CS: 'T_CS', T_DIN: 'SPI_MOSI', T_DO: 'SPI_MISO', T_IRQ: 'T_IRQ' },
      at: [21, 4],
    },
    {
      ref: 'DD1',
      value: 'PCA9555D',
      description: 'Расширитель PCA9555/TCA9555 в SOIC-24 (I²C 0x20 — A0, A1, A2 на земле), паяется сверху под экраном: кнопки, кнопка энкодера, сброс экрана, касание, светодиод, поплавок',
      fp: 'IC_PCA9555_SOIC-24W',
      pins: { VCC: '3V3', GND: 'GND', SDA: 'SDA', SCL: 'SCL', A0: 'GND', A1: 'GND', A2: 'GND', P00: 'K1', P01: 'K2', P02: 'K3', P03: 'K4', P04: 'K5', P05: 'K6', P06: 'KT1', P07: 'KT2', P10: 'KOFF', P11: 'ENC_SW', P12: 'LCD_RST', P13: 'LED_K', P14: 'T_IRQ', P17: 'FLOAT' },
      // Выводы — на сетке 1,27 по вертикали (шаг выводов 1,27, середина — между ними).
      at: [101.6, 31.115],
    },
    C('C4', '100 нФ', 'Питание 3,3 В PCA9555', '3V3', 'GND', [93.98, 45.72, 90]),
    R('R4', '10k', 'Сброс экрана: подтяжка (сбрасывает PCA9555, вывод P12)', 'LCD_RST', '3V3', [95.25, 49.53, 90]),
    R('R9', '4,7k', 'Подтяжка SDA шины I²C', 'SDA', '3V3', [99.06, 49.53, 90]),
    R('R10', '4,7k', 'Подтяжка SCL', 'SCL', '3V3', [102.87, 49.53, 90]),
    C('C3', '10 мкФ', 'Питание 5 В экрана (керамика 106: под экраном выше 9 мм нельзя)', '5V', 'GND', [110.49, 53.34]),
    key('SB1', '1 Главная', 'K1', 10.5, 14),
    key('SB2', '2 Очистка', 'K2', 10.5, 33),
    key('SB3', '3 Фильтр', 'K3', 10.5, 52),
    key('SB4', '4 Пуск/Стоп', 'K4', 129.5, 14),
    key('SB5', '5 Очистка', 'K5', 129.5, 33),
    key('SB6', '6 Мощная', 'K6', 129.5, 52),
    key('SB7', 'Турбина 1', 'KT1', 36, yK),
    key('SB8', 'Турбина 2', 'KT2', 53, yK),
    { ref: 'SA1', value: 'EC11', description: 'Энкодер EC11 с кнопкой, вал 20 мм: поворот — выбор и значение, нажатие — пуск/стоп на главной, иначе — на главную', fp: 'RotaryEncoder_Alps_EC11E_Vertical_H20mm', pins: { A: 'ENC_A', B: 'ENC_B', C: 'GND', S1: 'ENC_SW', S2: 'GND' }, at: [70, yK] },
    key('SB9', 'Выкл', 'KOFF', 96, yK),
    R('R5', '10k', 'Подтяжка энкодера A', 'ENC_A', '3V3', [78.74, 68.58, 90]),
    R('R6', '10k', 'Подтяжка энкодера B', 'ENC_B', '3V3', [82.55, 68.58, 90]),
    C('C1', '10 нФ', 'Фильтр энкодера A', 'ENC_A', 'GND', [80.01, 76.2, 90]),
    C('C2', '10 нФ', 'Фильтр энкодера B', 'ENC_B', 'GND', [82.55, 76.2, 90]),
    R('R8', '1k', 'Светодиод состояния (горит, когда P13 PCA9555 — «0»)', '3V3', 'LED_A', [109.22, 68.58, 0]),
    { ref: 'HL1', value: 'зелёный', description: 'Светодиод состояния 3 мм (длинные ноги — до передней панели, световод): мигает — работа, часто — неисправность', fp: 'LED_D3.0mm', pins: { A: 'LED_A', K: 'LED_K' }, at: [109.22, yK] },
    { ref: 'VT1', value: 'SS8050', description: 'Ключ зуммера. NPN SS8050 в TO-92, выводы на 2,54 мм: Э — Б — К (сверить с корпусом)', fp: 'Q_S8050_TO-92_Wide', pins: { B: 'BZ_B', E: 'GND', C: 'BZ_K' }, at: [116.84, 64.77] },
    R('R7', '1k', 'База ключа зуммера', 'BZ', 'BZ_B', [106.68, 63.5, 0]),
    { ref: 'VD1', value: '1N4148', description: 'Диод на зуммере', fp: 'D_DO-35_P7.62mm_Horizontal', pins: { A: 'BZ_K', K: '5V' }, at: [119.38, 69.85, 0] },
    { ref: 'BA1', value: 'TMB12A05', description: 'Зуммер 12 мм на 5 В со своим генератором (TMB12A05, не 12A12!) — в прошивке «set buzz 1»', fp: 'Buzzer_12x9.5RM7.6', pins: { '1': '5V', '2': 'BZ_K' }, at: [124.0, 78.0] },
    ...holes(),
  ];
}

/** Этаж 2 — контроллер: ESP32 на гнёздах, ULN2003. */
export function floor2Parts(): ModPart[] {
  // Выводы ESP32: по имени (STACK_PINS), питание — по номерам: 1–22 левый ряд, 23–44 правый, 45–66 правый второй (25,4 мм).
  const pins: Record<string, string> = { ...STACK_PINS, '1': '3V3', '2': '3V3', '21': '5V', '22': 'GND', '23': 'GND', '45': 'GND', '43': 'GND', '44': 'GND', '65': 'GND', '66': 'GND' };
  return [
    {
      ref: 'A1',
      value: 'ESP32-S3-DevKitC-1 N16R8',
      description:
        'ESP32-S3-DevKitC-1 (N16R8 или N8R8) на гнёздах 1×22: антенна — к верхнему краю (под ней и над ней меди нет), USB — вниз, под угловой штекер удлинителя. Ряды через 22,86 или 25,4 мм — правое гнездо в подходящий ряд. IO35–IO37 заняты памятью, IO8 не используется',
      fp: 'LUT_DevKitC_Sockets',
      pins,
      at: [DK.x, DK.y],
    },
    {
      ref: 'DD2',
      value: 'ULN2003AN',
      description: 'Семь ключей Дарлингтона (DIP-16, в панельке): 1–3 — реле K1–K3, 4–5 — клапаны (замыкают вход модуля на землю), 6–7 — без нагрузки (стягивают ШИМ МР248 к земле при старте)',
      fp: 'IC_ULN2003_DIP-16',
      pins: { IN1: 'RL1', IN2: 'RL2', IN3: 'RL3', IN4: 'VLV2', IN5: 'VLV1', IN6: 'T1', IN7: 'T2', GND: 'GND', OUT1: 'RL1_K', OUT2: 'RL2_K', OUT3: 'RL3_K', OUT4: 'VLV2_K', OUT5: 'VLV1_K' },
      // Начало корпуса — его середина: входы 1–7 (x − 3,81) — в строках R4–R10 шины.
      at: [100.33, rowY(4) + 8.89],
    },
    C('C5', '100 мкФ 10 В', 'Питание 5 В у ESP32', '5V', 'GND', [45.72, 63.5], EL5),
    R('R73', '4,7k', 'Подтяжка SCL второй шины (IO14)', 'PNL_RX', '3V3', [40.64, 50.8, 90]),
    R('R72', '4,7k', 'Подтяжка SDA второй шины (IO13)', 'PNL_TX', '3V3', [44.45, 50.8, 90]),
    ...holes(),
  ];
}

/** Этаж 3 — датчики и голос: ADS1115, часы, плеер, датчик разрежения, разъём динамика. */
export function floor3Parts(): ModPart[] {
  return [
    { ref: 'DD4', value: 'DS3231 (ZS-042)', description: 'Часы DS3231 (I²C 0x68) — модуль ZS-042 лёжа на гнёздах. Батарейка CR2032 — только если выпаян диод зарядки модуля (или LIR2032)', fp: 'LUT_DS3231_ZS042_Sockets', pins: { SCL: 'SCL', SDA: 'SDA', VCC: '3V3', GND: 'GND' }, at: [10.16, 12.7] },
    {
      ref: 'DD3',
      value: 'ADS1115 (модуль)',
      description: 'АЦП ADS1115 (I²C 0x48, ADDR на земле) на гнезде 1×10, платкой вверх (опора — стойка в его отверстие): A0 — термистор турбины 1, A1 — турбины 2',
      fp: 'Module_ADS1115',
      pins: { VDD: '3V3', GND: 'GND', SCL: 'SCL', SDA: 'SDA', ADDR: 'GND', A0: 'NTC1', A1: 'NTC2' },
      at: [24.13, 52.07],
    },
    C('C82', '10 мкФ', 'Питание 3,3 В АЦП (керамика 106)', '3V3', 'GND', [12.7, 58.42]),
    // Делители термисторов — у АЦП (термисторы приходят с клеммника X2 этажа 4 по шине).
    R('R25', '10k', 'Делитель термистора турбины 1: 3,3 В → A0 ADS1115', 'NTC1', '3V3', [30.48, 62.23, 90]),
    R('R26', '10k', 'Делитель термистора турбины 2: 3,3 В → A1 ADS1115', 'NTC2', '3V3', [34.29, 62.23, 90]),
    C('C24', '100 нФ', 'Фильтр термистора 1', 'NTC1', 'GND', [38.1, 62.23, 90]),
    C('C25', '100 нФ', 'Фильтр термистора 2', 'NTC2', 'GND', [41.91, 62.23, 90]),
    {
      ref: 'DA1',
      value: 'DFPlayer Mini',
      description: 'MP3-плеер голоса на гнёздах 1×8 (9600 бод с IO13 через перемычку JP1 и 1 кОм): карта microSD с папкой mp3 из прошивки; динамик 8 Ом 1–3 Вт — на XA1',
      fp: 'Module_DFPlayer_Mini_P18.03',
      pins: { VCC: '5V', RX: 'DF_RX', GND: 'GND', SPK_1: 'SPK1', SPK_2: 'SPK2' },
      at: [60.96, 15.24],
    },
    C('C81', '100 нФ', 'Питание плеера у вывода VCC', '5V', 'GND', [63.5, 39.37]),
    C('C80', '100 мкФ 10 В', 'Питание плеера: накопитель (усилитель динамика до 0,5 А)', '5V', 'GND', [72.39, 40.64], EL5),
    R('R80', '1k', 'RX плеера: последовательно (3,3 В на вход 5-вольтового плеера)', 'DF_J', 'DF_RX', [60.96, 44.45, 0], RES),
    { ref: 'JP1', value: 'Голос', description: 'Перемычка «голос»: IO13 → плеер. Снять, если IO13 занят второй шиной I²C (расходомер SDP810-125 на X4 этажа 4)', fp: 'PinHeader_1x02_P2.54mm', pins: { '1': 'PNL_TX', '2': 'DF_J' }, at: [58.42, 49.53, 270] },
    term('XA1', 'Динамик', 'Динамик 8 Ом 1–3 Вт (Ø28–40 мм) на корпусе: два провода, полярность не важна', ['SPK1', 'SPK2'], ['ДИН', 'ДИН'], 'R', 15.24),
    { ref: 'B1', value: 'MPX5100DP', description: 'Датчик разрежения 0–100 кПа (NXP): трубка ко входу турбин (на P2, вакуумный) — к правому краю; выход 0,2–4,7 В', fp: 'Sensor_MPX5100DP', pins: { VOUT: 'VAC_S', GND: 'GND', VS: '5V' }, at: [124.46, 55.88, 90], fields: { 'Где стоит': 'вход турбин' } },
    C('C13', '1 мкФ', 'Питание датчика разрежения', '5V', 'GND', [110.49, 73.66], CER5),
    R('R27', '6,8k', 'Делитель датчика разрежения 4,7 → 2,8 В: верхнее плечо', 'VAC', 'VAC_S', [96.52, 63.5, 0], RES),
    R('R28', '10k', 'Делитель датчика разрежения: нижнее плечо', 'VAC', 'GND', [96.52, 68.58, 0], RES),
    C('C14', '10 нФ', 'Фильтр датчика разрежения', 'VAC', 'GND', [93.98, 73.66]),
    ...holes(),
  ];
}

/** Этаж 4 — разъёмы: клеммники по краям, фильтры входов. */
export function floor4Parts(): ModPart[] {
  return [
    // --- левый край: термисторы и шины I²C ---
    term('X2', 'Термисторы', 'Термисторы NTC 10 кОм B3950 на двигателях: турбина 1 — NTC1 и соседний GND, турбина 2 — NTC2 и соседний GND (меряет ADS1115 этажа 3)', ['GND', 'NTC1', 'GND', 'NTC2', 'GND'], ['GND', 'NTC1', 'GND', 'NTC2', 'GND'], 'L', 10.16),
    term('X3', 'I²C-A', 'Датчики I²C (3,3 В): SDP810-500 перепад на фильтре (0x25), NAU7802 весы (0x2A) — по два провода в гнездо', ['3V3', 'SCL', 'SDA', 'GND'], ['3,3В', 'SCL', 'SDA', 'GND'], 'L', 36.83),
    term('X4', 'I²C-2', 'Вторая шина I²C (3,3 В): расходомер SDP810-125Pa (0x25) — если нет SDP811 на 0x26. Тогда снимите перемычку JP1 «голос» на этаже 3', ['3V3', 'PNL_RX', 'PNL_TX', 'GND'], ['3,3В', 'SCL2', 'SDA2', 'GND'], 'L', 58.42),
    // --- нижний край: I²C-B, трансформаторы тока, бак, питание ---
    term('X10', 'I²C-B', 'Датчики I²C (3,3 В): SDP811 расходомер (0x26), BME280 воздух (0x76)', ['GND', 'SDA', 'SCL', '3V3'], ['GND', 'SDA', 'SCL', '3,3В'], 'B', 20.32),
    term('X1', 'Ток: ТТ1 ТТ2 ТТ3', 'Трансформаторы тока SCT-013 с выходом 1 В: S1 — на ТТ1/ТТ2/ТТ3 (турбины — 020, розетка — 030), S2 — на любой «ср» (середина 1,65 В)', ['VMID', 'VMID', 'VMID', 'CT1_IN', 'CT2_IN', 'CT3_IN'], ['ср', 'ср', 'ср', 'ТТ1', 'ТТ2', 'ТТ3'], 'B', 41.91),
    R('R20', '1k', 'ТТ1: фильтр АЦП', 'CT1', 'CT1_IN', [48.26, 71.12, 90]),
    R('R21', '1k', 'ТТ2: фильтр АЦП', 'CT2', 'CT2_IN', [53.34, 71.12, 90]),
    R('R22', '1k', 'ТТ3: фильтр АЦП', 'CT3', 'CT3_IN', [58.42, 71.12, 90]),
    C('C20', '10 нФ', 'ТТ1: фильтр АЦП', 'CT1', 'GND', [45.72, 66.04]),
    C('C21', '10 нФ', 'ТТ2: фильтр АЦП', 'CT2', 'GND', [50.8, 66.04]),
    C('C22', '10 нФ', 'ТТ3: фильтр АЦП', 'CT3', 'GND', [55.88, 66.04]),
    R('R23', '10k', 'Середина 1,65 В для ТТ: верхнее плечо', '3V3', 'VMID', [33.02, 71.12, 90]),
    R('R24', '10k', 'Середина 1,65 В для ТТ: нижнее плечо', 'VMID', 'GND', [35.56, 71.12, 90]),
    C('C23', '10 мкФ', 'Середина 1,65 В для ТТ (керамика 106)', 'VMID', 'GND', [38.1, 66.04, 90]),
    term('X5', 'Бак', 'Бак: E1 — электрод уровня (турбины стоп), E0 — общий (внизу), E2 — перелив (авария), поплавок (контакт и земля)', ['WL_E1', 'WL_E0', 'WL_E2', 'FLOAT', 'GND'], ['E1', 'E0', 'E2', 'ПОПЛ', 'GND'], 'B', 73.66),
    R('R41', '100k', 'Электрод уровня: защита входа', 'WL1', 'WL_E1', [63.5, 71.12, 90]),
    R('R42', '100k', 'Электрод уровня: к земле', 'WL1', 'GND', [66.04, 66.04, 90]),
    C('C41', '1 нФ', 'Электрод уровня: фильтр', 'WL1', 'GND', [63.5, 63.5, 90]),
    R('R40', '1k', 'Электроды: выход раскачки (переменный ток — без электролиза)', 'WL_DRV', 'WL_D', [68.58, 71.12, 90]),
    C('C40', '1 мкФ', 'Электроды: развязка по постоянному току — керамика 105', 'WL_D', 'WL_E0', [71.12, 71.12, 90]),
    R('R43', '100k', 'Электрод перелива: защита входа', 'WL2', 'WL_E2', [73.66, 71.12, 90]),
    R('R44', '100k', 'Электрод перелива: к земле', 'WL2', 'GND', [76.2, 66.04, 90]),
    C('C42', '1 нФ', 'Электрод перелива: фильтр', 'WL2', 'GND', [73.66, 63.5, 90]),
    term('XP1', 'Питание 5 В', 'Вход 5 В от блока питания 5 В 3 А (силовая плата). Соблюдайте полярность', ['5V', 'GND'], ['+5В', 'GND'], 'B', 101.6),
    C('C6', '220 мкФ 10 В', 'Питание 5 В: накопитель у входа', '5V', 'GND', [104.14, 72.39], EL5),
    // --- правый край: жгут к силовой плате ---
    term('X6', 'Реле K1 K2 K3', 'К входам IN модулей реле 30 А (перемычка — L: включение низким уровнем): K1 — турбина 1, K2 — турбина 2, K3 — розетка', ['RL1_K', 'RL2_K', 'RL3_K'], ['K1', 'K2', 'K3'], 'R', 10.16),
    term('X8', 'Клапаны', 'Клапаны: L1/L2 — ключ на землю (SSR с управлением низким уровнем), H1/H2 — «1» 3,3 В через 100 Ом (модули AOD4184, вход PWM)', ['VLV1_K', 'VLV2_K', 'VLV1_H', 'VLV2_H'], ['L1', 'L2', 'H1', 'H2'], 'R', 26.67),
    R('R58', '100', 'Клапан 1: прямой выход «1» на H1', 'VLV1', 'VLV1_H', [119.38, 34.29, 0], RES),
    R('R61', '100', 'Клапан 2: прямой выход «1» на H2', 'VLV2', 'VLV2_H', [119.38, 38.1, 0], RES),
    term('X7', 'МР248', 'К входам «управление» регуляторов МР248: УПР1 — турбина 1, УПР2 — турбина 2 (ШИМ 0–3,3 В → 0–100 %)', ['PWM1', 'PWM2'], ['УПР1', 'УПР2'], 'R', 48.26),
    R('R62', '100', 'ШИМ регулятора турбины 1: защита вывода', 'T1', 'PWM1', [119.38, 45.72, 0], RES),
    R('R64', '100', 'ШИМ регулятора турбины 2: защита вывода', 'T2', 'PWM2', [119.38, 49.53, 0], RES),
    term('X11', '3,3 В для МР248', 'Питание входов МР248: +VCC и GND обоих регуляторов', ['3V3', 'GND'], ['+3,3В', 'GND'], 'R', 59.69),
    term('X9', 'ZMPT101B', 'Выход модуля ZMPT101B (OUT) и его земля; питание модуля 5 В — от блока питания', ['UAC_IN', 'GND'], ['OUT', 'GND'], 'R', 71.12),
    R('R70', '10k', 'Делитель ZMPT101B 5 → 3,3 В: верхнее плечо (OUT → IO7 и IO48)', 'UAC_IN', 'UAC', [119.38, 66.04, 0], RES),
    R('R71', '20k', 'Делитель ZMPT101B: нижнее плечо', 'UAC', 'GND', [119.38, 69.85, 0], RES),
    C('C26', '1 нФ', 'Фильтр помех на IO7/IO48 (больше не ставить: сдвинет ноль)', 'UAC', 'GND', [114.3, 73.66]),
    ...holes(),
  ];
}

export const FLOOR_PARTS: Record<LutFloor, () => ModPart[]> = { 1: floor1Parts, 2: floor2Parts, 3: floor3Parts, 4: floor4Parts };
const FLOOR_NAME: Record<LutFloor, string> = { 1: 'лицевой', 2: 'контроллер', 3: 'датчики и голос', 4: 'разъёмы' };

/* ---------------- шина ---------------- */

/** Какие ряды шины у этажа: гнездо (от предыдущего) и длинные штыри (к следующему). */
const BUS_ROWS: Record<LutFloor, { socket?: 'a' | 'b'; header?: 'a' | 'b' }> = { 1: { header: 'a' }, 2: { socket: 'a', header: 'b' }, 3: { socket: 'b', header: 'a' }, 4: { socket: 'a' } };

/** Цепи деталей этажа (без шины). */
function floorNets(f: LutFloor): Set<string> {
  const s = new Set<string>();
  for (const part of FLOOR_PARTS[f]()) for (const n of Object.values(part.pins)) s.add(n);
  return s;
}

/**
 * Какие этажи берут провод шины: этаж 2 — по выводу ESP32 (кроме дверей); остальные — если цепь есть у
 * их деталей. Питание — все провода; сигнал на двух проводах (UAC: IO7 и IO48) — только первый.
 */
export function busTaps(): Map<string, Set<LutFloor>> {
  const taps = new Map<string, Set<LutFloor>>();
  const nets: Record<LutFloor, Set<string>> = { 1: floorNets(1), 2: floorNets(2), 3: floorNets(3), 4: floorNets(4) };
  const first = new Map<string, string>();
  for (const side of ['L', 'R'] as const)
    for (let c = 1; c <= 22; c++) {
      const net = BUS[side][c];
      if (net && !first.has(net)) first.set(net, `${side}${c}`);
    }
  for (const side of ['L', 'R'] as const)
    for (let c = 1; c <= 22; c++) {
      const id = `${side}${c}`;
      const net = BUS[side][c];
      const t = new Set<LutFloor>();
      if (!net) continue;
      if (!BUS_DOORS.has(id)) t.add(2);
      for (const f of [1, 2, 3, 4] as LutFloor[]) if (nets[f].has(net) && (POWER.includes(net) || first.get(net) === id)) t.add(f);
      taps.set(id, t);
    }
  return taps;
}

/** Цепь вывода шины на этаже: отвод — сама цепь, проход — свой островок, вне пролёта — ничья. */
function busNetOn(f: LutFloor, id: string, net: string, taps: Set<LutFloor>): string | null {
  if (taps.has(f)) return net;
  if (taps.size < 2) return null;
  const lo = Math.min(...taps);
  const hi = Math.max(...taps);
  if (f > lo && f < hi) return `${net}~${id}`;
  return null;
}

/* ---------------- сборка ---------------- */

const box = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const circlePoly = (cx: number, cy: number, r: number) => Array.from({ length: 16 }, (_, i) => ({ x: +(cx + r * Math.cos((i * Math.PI) / 8)).toFixed(3), y: +(cy + r * Math.sin((i * Math.PI) / 8)).toFixed(3) }));

/** Габарит корпуса по месту ограждения (courtyard) с запасом m. */
export function courtBox(c: Component, fp: FootprintDef, m: number): [Vec2, Vec2] {
  if (!fp.courtyard) throw new Error(`${c.ref}: нет ограждения`);
  const { min: a, max: b } = fp.courtyard;
  const pl = placementOf(c);
  const pts = [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }].map((q) => toWorld(pl, q));
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return [
    { x: Math.min(...xs) - m, y: Math.min(...ys) - m },
    { x: Math.max(...xs) + m, y: Math.max(...ys) + m },
  ];
}

/** Корпус по рисунку на F.Fab (первый прямоугольник), иначе — по ограждению. */
function fabBox(c: Component, fp: FootprintDef, m: number): [Vec2, Vec2] {
  const r = fp.graphics.find((g): g is Extract<Graphic, { kind: 'rect' }> => g.kind === 'rect' && g.layer === 'F.Fab');
  return r ? courtBox(c, { ...fp, courtyard: { min: r.a, max: r.b } }, m) : courtBox(c, fp, m);
}

/** Плата этажа без дорожек: детали, шина, цепи, правила под ЛУТ. */
export function buildLutFloor(f: LutFloor): Project {
  const { w, h } = LUT_BOARD;
  const p = createProject({ name: `Пылесос S3 — этаж ${f} (${FLOOR_NAME[f]})`, width: w, height: h, copperLayers: 2, cornerRadius: 2, homemade: true });
  p.meta.author = 'Plata';
  p.meta.description = `Этажерка пылесоса S3 под ЛУТ с масками, этаж ${f} из 4 (${FLOOR_NAME[f]}): двусторонняя без металлизации, все выводы паяются снизу, сверху — дорожки между переходными (проволочками). Прошивка 6.4.`;
  p.netClasses.Default = { ...p.netClasses.Default, trackWidth: 0.6, clearance: 0.4, viaDiameter: 2.0, viaDrill: 0.8 };
  p.netClasses.Power = { ...p.netClasses.Power, trackWidth: 0.8, clearance: 0.4, viaDiameter: 2.2, viaDrill: 0.9 };
  p.rules.minClearance = 0.4;
  p.rules.edgeClearance = 1.0;
  for (const name of POWER) ensureNet(p, name, { netClass: 'Power', description: DESCRIPTIONS[name] });
  const parts = [...FLOOR_PARTS[f]()];
  // Шина: ряды гнезда и штырей этого этажа.
  const taps = busTaps();
  const rows = BUS_ROWS[f];
  for (const side of ['L', 'R'] as const)
    for (const [kind, row] of [
      ['socket', rows.socket],
      ['header', rows.header],
    ] as const) {
      if (!row) continue;
      const pins: Record<string, string> = {};
      for (let c = 1; c <= 22; c++) {
        const id = `${side}${c}`;
        const net = BUS[side][c];
        const n = net ? busNetOn(f, id, net, taps.get(id) ?? new Set()) : null;
        if (n) pins[String(c)] = n;
      }
      const ref = `XB${side === 'L' ? 1 : 2}${kind === 'socket' ? 'S' : 'P'}`;
      parts.push({
        ref,
        value: kind === 'socket' ? 'Гнездо 1×22' : 'Штыри 1×22 длинные',
        description: `Шина, ${side === 'L' ? 'левый' : 'правый'} ряд: ${kind === 'socket' ? 'гнездо от предыдущего этажа' : 'длинные штыри к следующему этажу'}`,
        fp: kind === 'socket' ? 'LUT_Bus_Socket_1x22' : 'LUT_Bus_LongPins_1x22',
        pins,
        at: [BUS_X[side][row], DK.y],
      });
    }
  for (const part of parts) {
    const fp0 = fpLut(part.fp);
    // Без металлизации: у сквозных выводов медь только снизу (паяются снизу).
    const fp = { ...fp0, pads: fp0.pads.map((q) => (q.type === 'tht' ? { ...q, layer: 'B.Cu' as const } : q)) };
    const at = part.at ?? [0, 0, 0];
    const c = addComponent(p, fp, { x: at[0], y: at[1] }, { ref: part.ref, value: part.value, description: part.description, rotation: at[2] ?? 0 });
    if (part.fields) c.fields = { ...part.fields };
    // Мелочь (резисторы, конденсаторы, ключ зуммера, перемычка) расставит autoplace, остальное — на своих местах.
    if (!/^(R\d+|C\d+|VT\d+|VD\d+|JP\d+)$/.test(part.ref)) c.locked = true;
    if (!part.value) c.hideValue = true;
    const fpc = p.footprints[c.footprint];
    for (const [pin, net] of Object.entries(part.pins)) {
      const byName = fpc.pads.filter((q) => q.type !== 'npth' && q.name === pin);
      const pads = byName.length ? byName : fpc.pads.filter((q) => q.number === pin);
      if (!pads.length) throw new Error(`${part.ref}: нет вывода ${pin}`);
      const logical = net.split('~')[0];
      const n = ensureNet(p, net, { netClass: POWER.includes(logical) ? 'Power' : undefined, description: DESCRIPTIONS[logical] });
      for (const q of pads) connectPad(p, c.id, q.number, n.id);
    }
  }
  for (const part of parts) if (part.labels) terminalLabels(p, part.ref, part.labels);
  // Под плоскими корпусами (кнопки, энкодер, зуммер, клеммники, PCA9555) проволочек-переходных нет.
  for (const c of Object.values(p.components)) {
    if (!/^(SB\d+|SA1|BA1|X\d+|XP1|XA1|DD1)$/.test(c.ref)) continue;
    const [a, b] = fabBox(c, p.footprints[c.footprint], 0.8);
    addRuleArea(p, { name: `Под ${c.ref}`, outline: box(Math.max(0, a.x), Math.max(0, a.y), Math.min(w, b.x), Math.min(h, b.y)), keepoutVias: true, showLabel: false });
  }
  // Антенна ESP32 у верхнего края — на всех этажах без меди (этажи стоят друг над другом).
  addRuleArea(p, { name: 'Антенна ESP32-S3', outline: box(DK.x - 0.5, 0, DK.x + 23.4, DK.y - 1.4), keepoutTracks: true, keepoutVias: true, showLabel: false });
  for (const part of parts) if (part.fp === 'MountingHole_3.2mm_M3') addRuleArea(p, { name: `Стойка ${part.ref}`, outline: circlePoly(part.at![0], part.at![1], 3.3), keepoutTracks: true, keepoutVias: true, showLabel: false });
  return structuredClone(p);
}

/** Мелочь этажа — по местам (отжиг: короткие связи, без перекрытий); крупное закреплено. */
export async function placeLutFloor(p0: Project, seed = 1): Promise<Project> {
  const p = structuredClone(p0);
  const r = await autoplace(p, { seed, effort: 2, start: 'current', yieldEvery: 1e9 });
  applyPlacement(p, r.moves);
  return structuredClone(p);
}

/**
 * Расстановка мелочи и разводка: перебор семян расстановки, пока всё не разведётся (иначе — лучший
 * вариант: меньше неразведённых, потом меньше переходных).
 */
export async function routeLutFloor(f: LutFloor, seeds = [1, 2, 3, 4, 5, 6]): Promise<{ project: Project; failed: number; seed: number; report: string[] }> {
  let best: { project: Project; failed: number; seed: number; report: string[] } | null = null;
  for (const seed of seeds) {
    const r = await routeStackBoard(await placeLutFloor(buildLutFloor(f), seed));
    const vias = (q: Project) => Object.keys(q.vias).length;
    if (!best || r.failed < best.failed || (r.failed === best.failed && vias(r.project) < vias(best.project))) best = { project: r.project, failed: r.failed, seed, report: r.report };
    if (r.failed === 0) break;
  }
  return best!;
}
