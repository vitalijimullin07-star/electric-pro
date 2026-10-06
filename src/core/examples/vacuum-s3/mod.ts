import { libraryFootprint } from '../../library';
import { addComponent, addDrawing, addRuleArea, addTrack, addVia, addZone, connectPad, ensureNet } from '../../model/edit';
import { createProject } from '../../model/project';
import { MAINS_CLASS, MAINS_CLEARANCE } from '../../model/rules';
import { getWorld } from '../../model/world';
import { autoroute, type RouteOptions, type RouteResult } from '../../router/autoroute';
import type { FootprintDef, PadDef, Project } from '../../model/types';
import { layoutBlocks, type SchBlock } from './build';
import { S3_DIP_FOOTPRINTS } from './dip';
import { S3_FOOTPRINTS, wired, type VacPart } from './parts';

/*
 * Пылесос S3 на готовых модулях — плата контроллера под ЛУТ (двусторонняя, без металлизации).
 * На плате: ESP32-S3-DevKitC-1 N16R8 на гребёнках, расширитель PCA9555 на своей платке (800 mil),
 * выпрямитель с накопителем и детектор нуля, ключи SS8050 к модулям, обвязка датчиков, клеммники.
 * Снаружи, на проводах: трансформатор 9 В, понижающий модуль MP1584 (5 В), модули реле 30 А
 * (турбины и розетка), регуляторы МР248 (турбины), твердотельное реле G3MB на 2 канала (клапаны
 * 230 В), трансформаторы тока SCT-013 с выходом 1 В, термисторы, датчики SDP810/SDP811, бак,
 * экран ILI9488 с касанием XPT2046 (на время отладки — прямо к контроллеру) и пульт с кнопками.
 *
 * Все выводы пропаиваются только снизу: под модулями, гребёнками и клеммниками верхнюю сторону
 * не пропаять. Медь сверху — только дорожки между переходными (переходное — проволочка, пропаянная
 * с двух сторон).
 *
 * Выводы ESP32-S3 (IO35–IO37 у N16R8 заняты памятью PSRAM; IO19/IO20 — USB; IO44 — RX загрузчика):
 *   левый ряд:  IO4–IO6 ток турбин и розетки, IO7/IO8 термисторы, IO15–IO17 SPI экрана (SCK, MOSI,
 *               MISO), IO18 DC экрана, IO3/IO9 электроды, IO46 раскачка электродов, IO10 разрежение,
 *               IO11/IO12 I²C, IO13/IO14 UART пульта;
 *   правый ряд: TX (IO43) CS экрана, IO1/IO2 реле турбин 1 и 2, IO42 реле розетки, IO41/IO40 клапаны 2 и 1,
 *               IO39/IO38 ШИМ регуляторов МР248, IO0 CS касания, IO45 зуммер, IO48 нуль сети,
 *               IO47/IO21 энкодер.
 */

/** Выводы ESP32-S3 на этой плате (сверять с vac_core.h прошивки). */
export const MOD_PINS: Record<string, string> = {
  IO4: 'CT1', IO5: 'CT2', IO6: 'CT3', IO7: 'NTC1', IO8: 'NTC2',
  IO15: 'SPI_SCK', IO16: 'SPI_MOSI', IO17: 'SPI_MISO', IO18: 'LCD_DC',
  IO3: 'WL1', IO46: 'WL_DRV', IO9: 'WL2', IO10: 'VAC',
  IO11: 'SDA', IO12: 'SCL', IO13: 'PNL_TX', IO14: 'PNL_RX',
  TX: 'LCD_CS', IO1: 'RL1', IO2: 'RL2', IO42: 'RL3', IO41: 'VLV2', IO40: 'VLV1', IO39: 'T1', IO38: 'T2',
  IO0: 'T_CS', IO45: 'BZ', IO48: 'ZC', IO47: 'ENC_B', IO21: 'ENC_A',
};

export const MOD_BOARD = { w: 170, h: 134 };

const MAINS = ['L_IN', 'N_IN', 'PE', 'L', 'N', 'L_F', 'L_QF', 'L_XS', 'L_XS2', 'M1_L', 'M2_L', 'M1_A', 'M2_A', 'M1_W', 'M2_W', 'YV1', 'YV2'];
const POWER = ['GND', '3V3', '5V', 'VIN', 'VRECT', 'AC1', 'AC2'];

const CURRENT: Record<string, number> = { AC1: 1.6, AC2: 1.6, VRECT: 1.6, VIN: 1.2, '5V': 1.2, GND: 1.6, '3V3': 0.5, L: 0.15, L_F: 0.15, N: 0.15 };

const DESCRIPTIONS: Record<string, string> = {
  L: 'Сеть, фаза после выключателя SA1: трансформатор, реле турбин, автомат розетки',
  N: 'Сеть, ноль',
  L_F: 'Фаза после предохранителя FU1: трансформатор питания',
  AC1: 'Вторичная обмотка 9 В',
  AC2: 'Вторичная обмотка 9 В',
  VRECT: 'Выпрямленное без сглаживания: детектор нуля',
  VIN: 'Постоянное после моста и накопителя, 11–14 В: вход MP1584',
  '5V': 'Питание 5 В (MP1584): DevKitC, модули реле и SSR, экран, пульт, датчик разрежения',
  '3V3': 'Питание 3,3 В со стабилизатора DevKitC: датчики, PCA9555, регуляторы МР248',
  ZC: 'Детектор нуля → IO48 (1 — около нуля сети)',
  VMID: 'Середина 1,65 В для трансформаторов тока',
  RL1: 'Реле турбины 1: IO1',
  RL2: 'Реле турбины 2: IO2',
  RL3: 'Реле розетки: IO42',
  VLV1: 'Клапан 1 (SSR CH1): IO40',
  VLV2: 'Клапан 2 (SSR CH2): IO41',
  T1: 'ШИМ регулятора МР248 турбины 1: IO39',
  T2: 'ШИМ регулятора МР248 турбины 2: IO38',
  SDA: 'I²C: SDP810 (0x25), SDP811 (0x26), PCA9555 (0x20) — IO11',
  SCL: 'I²C — IO12',
  PNL_TX: 'UART к пульту: IO13',
  PNL_RX: 'UART от пульта: IO14',
};

/* ---------------- свои корпуса ---------------- */

/** Платка PCA9555/TCA9555 с гребёнками 2×12 через 800 mil (20,32 мм), 32,5×23,5 мм. */
function pcaModule(): FootprintDef {
  const names = ['INT', 'A1', 'A2', 'P00', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'GND', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'A0', 'SCL', 'SDA', 'VDD'];
  const pads: PadDef[] = names.map((name, i) => {
    const left = i < 12;
    const k = left ? i : 23 - i;
    return { number: String(i + 1), name, type: 'tht', shape: i === 0 ? 'rect' : 'circle', at: { x: left ? -10.16 : 10.16, y: -13.97 + k * 2.54 }, size: { x: 1.8, y: 1.8 }, drill: 1.0 };
  });
  const w = 23.5 / 2;
  const h = 32.5 / 2;
  return {
    id: 'Module_PCA9555_2x12_800mil',
    name: 'PCA9555 на платке 800 mil',
    description: 'Расширитель PCA9555/TCA9555 на платке 32,5×23,5 мм с гребёнками 2×12 через 20,32 мм (800 mil): слева 1 INT … 12 GND, справа снизу вверх 13 P10 … 24 VDD — как у самой микросхемы',
    category: 'Микросхемы',
    refPrefix: 'DD',
    tags: ['pca9555', 'tca9555', 'i2c', 'expander', 'module'],
    pads,
    graphics: [
      { kind: 'rect', layer: 'F.Fab', a: { x: -w, y: -h }, b: { x: w, y: h }, width: 0.1 },
      { kind: 'rect', layer: 'F.Silk', a: { x: -w, y: -h }, b: { x: w, y: h }, width: 0.15 },
      { kind: 'text', layer: 'F.Fab', at: { x: 0, y: 0 }, text: '${REF}', size: 1.5, thickness: 0.15, align: 'center' },
    ],
    courtyard: { min: { x: -w - 0.3, y: -h - 0.3 }, max: { x: w + 0.3, y: h + 0.3 } },
    source: 'Платка с фото продавца: PCB 32,5×23,5, 800 mil между рядами',
    verified: false,
    height: 12,
  };
}

const MOD_FOOTPRINTS: FootprintDef[] = [
  pcaModule(),
  wired('Module_MP1584_Wires', 'Модуль MP1584 на проводах', 'Понижающий модуль MP1584 с винтовыми клеммами (вход 9–24 В, выход 5 В): провода к клеммникам XT4 и XT5', 'Питание', 'DA', [['IN+', 'IN+'], ['IN-', 'IN-'], ['OUT+', 'OUT+'], ['OUT-', 'OUT-']], ['buck', 'dc-dc', 'mp1584'], [40, 20]),
  wired('Module_Relay_30A_Wires', 'Модуль реле 30 А', 'Модуль реле 30 А с катушкой 5 В и оптроном (SLA-05VDC-SL-C): управление DC+, DC−, IN (перемычка — на L: включается замыканием IN на землю), контакты COM/NO/NC — 230 В', 'Реле', 'K', [['DC+', 'DC+'], ['DC-', 'DC-'], ['IN', 'IN'], ['COM', 'COM'], ['NO', 'NO'], ['NC', 'NC']], ['relay', 'relay-module'], [50, 26]),
  wired('Module_MP248_Wires', 'Регулятор мощности МР248', 'Симисторный регулятор мощности МР248 (Мастер Кит), 230 В до 8 кВт: питание +VCC/GND 3,3–5 В от контроллера, вход «управление» 0…VCC (ШИМ) → мощность 0–100 %; клеммы «~220 В» и «нагрузка»', 'Питание', 'U', [['VCC', 'VCC'], ['GND', 'GND'], ['CTRL', 'CTRL'], ['L', 'L'], ['N', 'N'], ['OUT', 'OUT']], ['triac-dimmer', 'mp248'], [65, 35]),
  wired('Module_SSR_G3MB_2ch_Wires', 'Твердотельное реле G3MB, 2 канала', 'Модуль твердотельных реле Omron G3MB-202P на 2 канала (переход через ноль, до 2 А; у модуля «10 А» — свои SSR): DC+, DC− 5 В, CH1, CH2 — включение низким уровнем; выходы — 230 В на соленоиды', 'Реле', 'U', [['DC+', 'DC+'], ['DC-', 'DC-'], ['CH1', 'CH1'], ['CH2', 'CH2'], ['SW1A', 'SW1A'], ['SW1B', 'SW1B'], ['SW2A', 'SW2A'], ['SW2B', 'SW2B']], ['ssr', 'ssr-module'], [55, 33]),
  wired('Valve_Solenoid_230V_Wires', 'Соленоидный клапан 230 В', 'Клапан продувки фильтра с соленоидом 230 В ~ (нормально закрытый): открыт, пока на катушке напряжение', 'Разное', 'YV', [['1', '1'], ['2', '2']], ['solenoid-valve'], [20, 30]),
  wired('RV_Wires', 'Варистор на проводах', 'Варистор S10K275 на выводах катушки соленоида (гасит выброс при отключении)', 'Защита', 'RU', [['1', '1'], ['2', '2']], ['varistor'], [12, 10]),
  wired('CT_SCT013_1V_Wires', 'Трансформатор тока SCT-013 (выход 1 В)', 'Разъёмный трансформатор тока SCT-013-020/030 со встроенной нагрузкой: 1 В действующего на 20 или 30 А; провод нагрузки — через окно, один', 'Датчики', 'TA', [['P1', 'P1'], ['P2', 'P2'], ['S1', 'S1'], ['S2', 'S2']], ['current-transformer', 'sct013-v']),
  wired('Display_ILI9488_SPI_Wires', 'Экран 3,5″ ILI9488 SPI с касанием', 'Экран 3,5″ 480×320 ILI9488 по SPI с касанием XPT2046 (MSP3520 или аналог): 14 выводов VCC … T_IRQ', 'Дисплеи', 'HG', [['VCC', 'VCC'], ['GND', 'GND'], ['CS', 'CS'], ['RESET', 'RESET'], ['DC', 'DC'], ['SDI', 'SDI'], ['SCK', 'SCK'], ['LED', 'LED'], ['SDO', 'SDO'], ['T_CLK', 'T_CLK'], ['T_CS', 'T_CS'], ['T_DIN', 'T_DIN'], ['T_DO', 'T_DO'], ['T_IRQ', 'T_IRQ']], ['display', 'ili9488'], [60, 40]),
];

function footprintOf(id: string): FootprintDef {
  const f = MOD_FOOTPRINTS.find((x) => x.id === id) ?? S3_FOOTPRINTS.find((x) => x.id === id) ?? S3_DIP_FOOTPRINTS.find((x) => x.id === id) ?? libraryFootprint(id);
  if (!f) throw new Error(`нет корпуса ${id}`);
  return f;
}

/* ---------------- детали ---------------- */

const RES7 = 'R_Axial_0.25W_L6.3mm_D2.5mm_P7.62mm_Horizontal';
const CER = 'C_Disc_D5mm_W2.5mm_P2.5mm';
const CER5 = 'C_Disc_D6mm_W2.5mm_P5mm';
const EL5 = 'CP_Radial_D5mm_P2mm';
const EL6 = 'CP_Radial_D6.3mm_P2.5mm';
const NPN = 'Q_S8050_TO-92_Wide';
const T35 = (n: number) => `TerminalBlock_1x0${n}_P3.5mm`;
const T5 = 'TerminalBlock_1x02_P5mm';

type At = [number, number, number?];
interface ModPart extends VacPart {
  /** Подписи контактов клеммника на шёлке (по порядку выводов). */
  labels?: string[];
}

const R = (ref: string, value: string, description: string, a: string, b: string, at: At, fp = RES7): ModPart => ({ ref, value, description, fp, pins: { '1': a, '2': b }, at });
const C = (ref: string, value: string, description: string, a: string, b: string, at: At, fp = CER): ModPart => ({ ref, value, description, fp, pins: { '1': a, '2': b }, at });
const Q = (ref: string, description: string, b: string, e: string, c: string, at: At): ModPart => ({ ref, value: 'SS8050', description: `${description}. NPN SS8050 в TO-92, выводы разведены на 2,54 мм: Э — Б — К (сверить с корпусом)`, fp: NPN, pins: { B: b, E: e, C: c }, at });
const term = (ref: string, value: string, description: string, nets: string[], labels: string[], at: At, fp = T35(nets.length)): ModPart => ({ ref, value, description, fp, pins: Object.fromEntries(nets.map((n, i) => [String(i + 1), n])), at, labels });

/** Ключ к модулю: GPIO → 1 кОм → база SS8050, 100 кОм к земле (закрыт при сбросе), коллектор — на вход модуля. */
function driver(n: number, gpio: string, what: string, y: number): ModPart[] {
  return [
    R(`R${50 + 2 * n}`, '1k', `База ключа: ${what}`, gpio, `${gpio}_B`, [138, y]),
    R(`R${51 + 2 * n}`, '100k', `Ключ закрыт, пока ESP32 не запущен: ${what}`, gpio, 'GND', [138, y + 3.8]),
    Q(`VT${2 + n}`, `Ключ: ${what} (замыкает вход модуля на землю)`, `${gpio}_B`, 'GND', `${gpio}_K`, [151, y + 1.9]),
  ];
}

/** Клеммники выходов у правого края: [центр по высоте]. */
const OUT_Y = { X10: 40, X11: 53, X12: 66, X13: 81, X14: 97, X15: 111 };

export function modParts(): ModPart[] {
  const out: ModPart[] = [];
  const add = (...p: ModPart[]) => out.push(...p);

  // --- сеть: клеммник, предохранитель, варистор, X2, к трансформатору ---
  add(
    term('XT1', 'Сеть 230 В', 'Клеммник сети 230 В (после выключателя SA1): фаза и ноль — только на трансформатор питания; турбины, розетка и клапаны подключены к сети своими проводами', ['L', 'N'], ['L', 'N'], [162, 6, 180], T5),
    { ref: 'FU1', value: 'T0,25A', description: 'Предохранитель 5×20 0,25 А с задержкой в держателях на плату: первичная обмотка трансформатора', fp: 'Fuseholder_Clip-5x20mm_P22.6mm_Horizontal', pins: { '1': 'L_F', '2': 'L' }, at: [140, 6] },
    { ref: 'RU1', value: 'S10K275', description: 'Варистор 275 В, Ø10 (10D431K): выбросы сети', fp: 'RV_Disc_D10mm_P7.5mm', pins: { '1': 'L_F', '2': 'N' }, at: [158, 17] },
    { ref: 'CX1', value: '0,1 мкФ X2', description: 'Конденсатор X2 275 В ~, шаг 15 мм: помехи двигателей и реле', fp: 'C_Film_L18mm_W8.5mm_P15mm_X2', pins: { '1': 'L_F', '2': 'N' }, at: [138, 17] },
    term('XT2', '~230 В на TV1', 'Клеммник первичной обмотки трансформатора TV1 (после предохранителя)', ['L_F', 'N'], ['L', 'N'], [121, 6, 180], T5),
  );

  // --- питание: вторичная 9 В, мост, накопитель, MP1584 на проводах ---
  add(
    term('XT3', '~9 В с TV1', 'Клеммник вторичной обмотки трансформатора TV1 (9 В)', ['AC1', 'AC2'], ['~9В', '~9В'], [104, 6, 180], T5),
    { ref: 'VDS1', value: 'KBP310', description: 'Диодный мост KBP310 (3 А 1000 В): выводы + ~ ~ −, шаг 3,8 мм', fp: 'D_Bridge_KBP_P3.81mm', pins: { '1': 'VRECT', '2': 'AC1', '3': 'AC2', '4': 'GND' }, at: [97, 17, 180] },
    { ref: 'VD1', value: '1N5822', description: 'Диод Шоттки 3 А 40 В: после него накопитель, до него — пульсирующее напряжение для детектора нуля', fp: 'D_DO-201_P12.7mm_Horizontal', pins: { A: 'VRECT', K: 'VIN' }, at: [97, 28, 180] },
    C('C1', '4700 мкФ 25 В', 'Накопитель после моста, Ø16, шаг 7,5', 'VIN', 'GND', [80, 15, 180], 'CP_Radial_D16mm_P7.5mm'),
    term('XT4', 'MP1584: вход', 'К входу модуля MP1584 (IN+, IN−): 11–14 В с накопителя', ['VIN', 'GND'], ['IN+', 'IN−'], [64, 6, 180], T5),
    term('XT5', 'MP1584: выход 5 В', 'С выхода модуля MP1584 (OUT+, OUT−): 5,0 В — выставить подстроечником до подключения', ['5V', 'GND'], ['+5В', 'GND'], [50, 6, 180], T5),
    C('C2', '100 мкФ 25 В', 'Питание 5 В после MP1584', '5V', 'GND', [67.5, 19], EL6),
    C('C3', '100 нФ', 'Питание 5 В после MP1584', '5V', 'GND', [67.5, 25]),
    C('C4', '10 мкФ 25 В', 'Питание 3,3 В у DevKitC', '3V3', 'GND', [57, 55], EL5),
    C('C5', '100 нФ', 'Питание 3,3 В у DevKitC', '3V3', 'GND', [57, 61]),
    C('C6', '100 мкФ 25 В', 'Питание 5 В модулей реле и SSR', '5V', 'GND', [102, 57], EL6),
  );

  // --- детектор нуля (с выпрямленного до накопителя) ---
  add(
    R('R1', '47k', 'Детектор нуля: от выпрямителя к базе', 'VRECT', 'ZC_B', [104, 34]),
    R('R2', '10k', 'Детектор нуля: база — земля (порог ≈3,7 В)', 'ZC_B', 'GND', [104, 38]),
    Q('VT1', 'Детектор нуля: у нуля сети транзистор закрыт — на входе «1»', 'ZC_B', 'GND', 'ZC', [115, 37]),
    R('R3', '10k', 'Детектор нуля: подтяжка к 3,3 В', '3V3', 'ZC', [104, 42]),
  );

  // --- ESP32-S3: DevKitC-1 N16R8 на гребёнках, USB — к нижнему краю ---
  const a1: Record<string, string> = { GND: 'GND', '3V3': '3V3', '5V': '5V', ...MOD_PINS };
  add({
    ref: 'A1',
    value: 'ESP32-S3-DevKitC-1 N16R8',
    description:
      'Плата ESP32-S3 N16R8 (16 МБ flash, 8 МБ PSRAM) с двумя USB-C, ряды через 25,4 мм — на гнёздах 1×22; ниже её разъёмов USB — место под штекер. IO35–IO37 заняты памятью, не используются. Питание — 5 В на вывод 5V, 3,3 В для датчиков — с её вывода 3V3. Цветной светодиод платы на IO48 (v1.0) или IO38 (v1.1) мигает от детектора нуля или ШИМ турбины — это нормально',
    fp: 'Module_ESP32-S3_DevKitC-1',
    pins: a1,
    at: [78, 80],
  });

  // --- выходы к модулям: реле турбин и розетки, SSR клапанов, регуляторы МР248 ---
  const y = OUT_Y;
  add(
    term('X10', 'Реле турбины 1', 'К модулю реле 30 А турбины 1 (K1): DC+, DC−, IN. Перемычка модуля — L (включается замыканием IN на землю)', ['5V', 'GND', 'RL1_K'], ['+5В', 'GND', 'IN'], [164, y.X10, 90]),
    ...driver(0, 'RL1', 'реле турбины 1', y.X10 - 5.4),
    term('X11', 'Реле турбины 2', 'К модулю реле 30 А турбины 2 (K2): DC+, DC−, IN; перемычка — L', ['5V', 'GND', 'RL2_K'], ['+5В', 'GND', 'IN'], [164, y.X11, 90]),
    ...driver(1, 'RL2', 'реле турбины 2', y.X11 - 5.4),
    term('X12', 'Реле розетки', 'К модулю реле 30 А розетки инструмента (K3): DC+, DC−, IN; перемычка — L', ['5V', 'GND', 'RL3_K'], ['+5В', 'GND', 'IN'], [164, y.X12, 90]),
    ...driver(2, 'RL3', 'реле розетки', y.X12 - 5.4),
    term('X13', 'SSR клапанов', 'К модулю твердотельных реле G3MB на 2 канала: DC+, DC−, CH1 (клапан 1), CH2 (клапан 2) — включение низким уровнем', ['5V', 'GND', 'VLV1_K', 'VLV2_K'], ['+5В', 'GND', 'CH1', 'CH2'], [164, y.X13, 90]),
    ...driver(3, 'VLV1', 'клапан 1', y.X13 - 3.2),
    ...driver(4, 'VLV2', 'клапан 2', y.X13 - 10.8),
    term('X14', 'МР248 турбины 1', 'К регулятору МР248 турбины 1: +VCC 3,3 В, GND, «управление» (ШИМ 0–3,3 В → 0–100 %)', ['3V3', 'GND', 'PWM1'], ['+3,3В', 'GND', 'УПР'], [164, y.X14, 90]),
    R('R60', '100', 'ШИМ регулятора турбины 1: защита вывода', 'T1', 'PWM1', [138, y.X14 - 3.5]),
    R('R61', '10k', 'Вход регулятора турбины 1 к земле: 0 % мощности, пока ESP32 не запущен', 'PWM1', 'GND', [138, y.X14 + 0.3]),
    term('X15', 'МР248 турбины 2', 'К регулятору МР248 турбины 2: +VCC 3,3 В, GND, «управление»', ['3V3', 'GND', 'PWM2'], ['+3,3В', 'GND', 'УПР'], [164, y.X15, 90]),
    R('R62', '100', 'ШИМ регулятора турбины 2: защита вывода', 'T2', 'PWM2', [138, y.X15 - 3.5]),
    R('R63', '10k', 'Вход регулятора турбины 2 к земле', 'PWM2', 'GND', [138, y.X15 + 0.3]),
  );

  // --- трансформаторы тока (выход 1 В) и термисторы ---
  add(
    term('X20', 'Ток: ТТ1 ТТ2 ТТ3', 'Трансформаторы тока SCT-013 (провода обрезаны, облужены): ТТ1 — турбина 1 (020: 20 А/1 В), ТТ2 — турбина 2 (020), ТТ3 — розетка (030: 30 А/1 В); у каждого — сигнал и середина 1,65 В', ['CT1_IN', 'VMID', 'CT2_IN', 'VMID', 'CT3_IN', 'VMID'], ['ТТ1', 'ТТ1', 'ТТ2', 'ТТ2', 'ТТ3', 'ТТ3'], [6, 42, 270]),
    R('R20', '1k', 'ТТ1: фильтр АЦП (с C20)', 'CT1_IN', 'CT1', [19, 33.25]),
    R('R21', '1k', 'ТТ2: фильтр АЦП', 'CT2_IN', 'CT2', [19, 40.25]),
    R('R22', '1k', 'ТТ3: фильтр АЦП', 'CT3_IN', 'CT3', [19, 47.25]),
    C('C20', '10 нФ', 'ТТ1: фильтр АЦП', 'CT1', 'GND', [29.5, 33.25]),
    C('C21', '10 нФ', 'ТТ2: фильтр АЦП', 'CT2', 'GND', [29.5, 40.25]),
    C('C22', '10 нФ', 'ТТ3: фильтр АЦП', 'CT3', 'GND', [29.5, 47.25]),
    R('R23', '10k', 'Середина 1,65 В для ТТ: верхнее плечо', '3V3', 'VMID', [40, 34]),
    R('R24', '10k', 'Середина 1,65 В для ТТ: нижнее плечо', 'VMID', 'GND', [40, 38]),
    C('C23', '10 мкФ 25 В', 'Середина 1,65 В для ТТ', 'VMID', 'GND', [48.5, 36], EL5),
    term('X21', 'Термисторы', 'Термисторы NTC 10 кОм B3950 на двигателях: NTC1 и земля, NTC2 и земля', ['NTC1', 'GND', 'NTC2', 'GND'], ['NTC1', 'GND', 'NTC2', 'GND'], [6, 62, 270]),
    R('R25', '10k', 'Делитель термистора турбины 1', '3V3', 'NTC1', [19, 56.75]),
    R('R26', '10k', 'Делитель термистора турбины 2', '3V3', 'NTC2', [19, 63.75]),
    C('C24', '100 нФ', 'Фильтр термистора 1', 'NTC1', 'GND', [29.5, 56.75]),
    C('C25', '100 нФ', 'Фильтр термистора 2', 'NTC2', 'GND', [29.5, 63.75]),
  );

  // --- бак: электроды переменным током, поплавок ---
  add(
    term('X22', 'Бак: E1 E0 E2', 'Электроды бака: E1 — уровень (турбины стоп), E0 — общий (внизу), E2 — перелив (авария)', ['WL_E1', 'WL_E0', 'WL_E2'], ['E1', 'E0', 'E2'], [6, 78, 270]),
    term('X23', 'Поплавок', 'Поплавковый выключатель бака (резерв к электродам): контакт и земля', ['FLOAT', 'GND'], ['ПОПЛ', 'GND'], [6, 90, 270]),
    R('R40', '1k', 'Электроды: выход раскачки (переменный ток — без электролиза)', 'WL_DRV', 'WL_D', [27, 78]),
    C('C40', '1 мкФ', 'Электроды: развязка по постоянному току — керамика 105, шаг 5 мм (не электролит)', 'WL_D', 'WL_E0', [16.6, 78], CER5),
    R('R41', '100k', 'Электрод уровня: защита входа', 'WL_E1', 'WL1', [19, 74]),
    R('R42', '100k', 'Электрод уровня: к земле', 'WL1', 'GND', [31, 74]),
    C('C41', '1 нФ', 'Электрод уровня: фильтр', 'WL1', 'GND', [40.5, 74]),
    R('R43', '100k', 'Электрод перелива: защита входа', 'WL_E2', 'WL2', [19, 82]),
    R('R44', '100k', 'Электрод перелива: к земле', 'WL2', 'GND', [31, 82]),
    C('C42', '1 нФ', 'Электрод перелива: фильтр', 'WL2', 'GND', [40.5, 82]),
  );

  // --- разрежение MPX5100DP и I²C к SDP810/SDP811 ---
  add(
    { ref: 'B1', value: 'MPX5100DP', description: 'Датчик разрежения 0–100 кПа (NXP), трубка ко входу турбин; выход 0,2–4,7 В', fp: 'Sensor_MPX5100DP', pins: { VOUT: 'VAC_S', GND: 'GND', VS: '5V' }, at: [50, 118], fields: { 'Где стоит': 'вход турбин' } },
    C('C13', '1 мкФ', 'Питание датчика разрежения', '5V', 'GND', [48, 103], CER5),
    R('R27', '6,8k', 'Делитель датчика разрежения 4,7 → 2,8 В', 'VAC_S', 'VAC', [48, 106.5]),
    R('R28', '10k', 'Делитель датчика разрежения', 'VAC', 'GND', [57, 103, 90]),
    C('C14', '10 нФ', 'Фильтр датчика разрежения', 'VAC', 'GND', [61, 103, 90]),
    term('X24', 'SDP810 перепад', 'Датчик перепада на фильтре SDP810-500Pa (I²C 0x25): 3,3 В, земля, SCL, SDA', ['3V3', 'GND', 'SCL', 'SDA'], ['3,3В', 'GND', 'SCL', 'SDA'], [16, 128, 0]),
    term('X25', 'SDP811 расход', 'Расходомер SDP811-125Pa (I²C 0x26, та же шина): 3,3 В, земля, SCL, SDA', ['3V3', 'GND', 'SCL', 'SDA'], ['3,3В', 'GND', 'SCL', 'SDA'], [33, 128, 0]),
    R('R29', '4,7k', 'Подтяжка SDA', 'SDA', '3V3', [27, 116, 90]),
    R('R30', '4,7k', 'Подтяжка SCL', 'SCL', '3V3', [31, 116, 90]),
  );

  // --- пульт: IDC к плате кнопок, PCA9555, энкодер, зуммер, светодиод ---
  add(
    {
      ref: 'X1',
      value: 'Пульт',
      description: 'Пульт — плоский кабель 2×10 (IDC), порядок как у платы пульта: 1–2 — 5 В, 3–4, 7 — земля, 5 — TX контроллера, 6 — RX, 8 — зуммер, 9–10 — энкодер, 11–16 — кнопки 1–6, 17–18 — «Турбина 1/2», 19 — «Выкл», 20 — кнопка энкодера',
      fp: 'IDC-Header_2x10_P2.54mm_Vertical',
      pins: { '1': '5V', '2': '5V', '3': 'GND', '4': 'GND', '5': 'PNL_TX', '6': 'PNL_RX', '7': 'GND', '8': 'BZ_K', '9': 'ENC_A', '10': 'ENC_B', '11': 'K1', '12': 'K2', '13': 'K3', '14': 'K4', '15': 'K5', '16': 'K6', '17': 'KT1', '18': 'KT2', '19': 'KOFF', '20': 'ENC_SW' },
      at: [113, 92, 180],
    },
    {
      ref: 'DD1',
      value: 'PCA9555 (платка)',
      description: 'Расширитель PCA9555/TCA9555 на платке 800 mil (I²C 0x20): кнопки пульта, кнопка энкодера, поплавок, сброс экрана, касание, светодиод. Питание 3,3 В. Перемычки адреса на платке A0–A2 — в L (или не запаяны: на плате они подтянуты к земле)',
      fp: 'Module_PCA9555_2x12_800mil',
      pins: { VDD: '3V3', GND: 'GND', SDA: 'SDA', SCL: 'SCL', A0: 'PCA_A0', A1: 'PCA_A1', A2: 'PCA_A2', P00: 'K1', P01: 'K2', P02: 'K3', P03: 'K4', P04: 'K5', P05: 'K6', P06: 'KT1', P07: 'KT2', P10: 'KOFF', P11: 'ENC_SW', P12: 'LCD_RST', P13: 'LED_K', P14: 'T_IRQ', P17: 'FLOAT' },
      at: [115.5, 118, 270],
    },
    R('R31', '10k', 'Адрес PCA9555: A0 к земле', 'PCA_A0', 'GND', [70, 118]),
    R('R32', '10k', 'Адрес PCA9555: A1 к земле', 'PCA_A1', 'GND', [70, 122]),
    R('R33', '10k', 'Адрес PCA9555: A2 к земле', 'PCA_A2', 'GND', [70, 126]),
    R('R34', '10k', 'Подтяжка энкодера A', 'ENC_A', '3V3', [102, 46]),
    R('R35', '10k', 'Подтяжка энкодера B', 'ENC_B', '3V3', [102, 50.5]),
    C('C17', '10 нФ', 'Фильтр энкодера A (длинный кабель)', 'ENC_A', 'GND', [113, 46]),
    C('C18', '10 нФ', 'Фильтр энкодера B', 'ENC_B', 'GND', [113, 50.5]),
    Q('VT7', 'Ключ зуммера на пульте', 'BZ_B', 'GND', 'BZ_K', [124.5, 51]),
    R('R36', '1k', 'База ключа зуммера', 'BZ', 'BZ_B', [124.5, 46]),
    { ref: 'VD2', value: '1N4148', description: 'Диод на катушке зуммера', fp: 'D_DO-35_P7.62mm_Horizontal', pins: { A: 'BZ_K', K: '5V' }, at: [124.5, 56] },
    R('R37', '1k', 'Светодиод состояния (горит, когда P13 PCA9555 — «0»)', '3V3', 'LED_A', [150, 129]),
    { ref: 'HL1', value: 'зелёный', description: 'Светодиод состояния 3 мм: мигает — работа, часто — неисправность', fp: 'LED_D3.0mm', pins: { A: 'LED_A', K: 'LED_K' }, at: [140, 129] },
  );

  // --- экран ILI9488 + XPT2046 (на время отладки) ---
  add(
    {
      ref: 'X2',
      value: 'Экран ILI9488',
      description:
        'Штыри 1×14 к экрану 3,5″ ILI9488 SPI с касанием (порядок как у экрана): 1 VCC 5 В, 2 GND, 3 CS, 4 RESET, 5 DC, 6 SDI, 7 SCK, 8 LED (3,3 В), 9 SDO — не подключён (мешает касанию на общей шине), 10 T_CLK, 11 T_CS, 12 T_DIN, 13 T_DO, 14 T_IRQ. Кабель — не длиннее 15–20 см',
      fp: 'PinHeader_1x14_P2.54mm',
      pins: { '1': '5V', '2': 'GND', '3': 'LCD_CS', '4': 'LCD_RST', '5': 'LCD_DC', '6': 'SPI_MOSI', '7': 'SPI_SCK', '8': '3V3', '10': 'SPI_SCK', '11': 'T_CS', '12': 'SPI_MOSI', '13': 'SPI_MISO', '14': 'T_IRQ' },
      at: [78, 40],
      labels: ['VCC', 'GND', 'CS', 'RST', 'DC', 'SDI', 'SCK', 'LED', 'SDO', 'TCK', 'TCS', 'TDI', 'TDO', 'IRQ'],
    },
    R('R38', '10k', 'Сброс экрана: подтяжка (сбрасывает PCA9555, вывод P12)', 'LCD_RST', '3V3', [84, 118]),
  );

  // --- крепёж ---
  for (const [i, [x, yy]] of [
    [4.5, 4.5],
    [4.5, 129.5],
    [165, 28],
    [165, 129.5],
  ].entries())
    add({ ref: `H${i + 1}`, value: '', description: 'Крепёжное отверстие M3', fp: 'MountingHole_3.2mm_M3', pins: {}, at: [x, yy] });

  // --- выносные: сеть, трансформатор, модули, двигатели, клапаны ---
  const off = (p: ModPart): ModPart => ({ ...p, offBoard: true });
  add(
    off({ ref: 'XP1', value: 'КГ 3×4 мм²', description: 'Сетевой кабель КГ 3×4 мм² с силовой вилкой — к розетке с автоматом 25 А', fp: 'Mains_Plug_Cord', pins: { L: 'L_IN', N: 'N_IN', PE: 'PE' } }),
    off({ ref: 'SA1', value: '2P 25 А', description: 'Выключатель «Сеть» на корпусе: полное отключение фазы и нуля', fp: 'SW_Mains_2P_16A', pins: { L1: 'L_IN', L2: 'L', N1: 'N_IN', N2: 'N' } }),
    off({ ref: 'TV1', value: '230/9 В 15–20 ВА', description: 'Трансформатор 230 → 9 В, 15–20 ВА, на шасси: первичная — к XT2, вторичная — к XT3', fp: 'Transformer_Chassis_Wires', pins: { P1: 'L_F', P2: 'N', S1: 'AC1', S2: 'AC2' } }),
    off({ ref: 'DA1', value: 'MP1584 (модуль)', description: 'Понижающий модуль MP1584 с клеммами: вход — XT4, выход — XT5, выставить 5,0 В до подключения', fp: 'Module_MP1584_Wires', pins: { 'IN+': 'VIN', 'IN-': 'GND', 'OUT+': '5V', 'OUT-': 'GND' } }),
    off({ ref: 'K1', value: 'SLA-05VDC 30 А', description: 'Модуль реле турбины 1: управление — X10, контакты — в разрыв фазы перед МР248 (отключение при аварии и пробое симистора)', fp: 'Module_Relay_30A_Wires', pins: { 'DC+': '5V', 'DC-': 'GND', IN: 'RL1_K', COM: 'L', NO: 'M1_L' } }),
    off({ ref: 'K2', value: 'SLA-05VDC 30 А', description: 'Модуль реле турбины 2: управление — X11', fp: 'Module_Relay_30A_Wires', pins: { 'DC+': '5V', 'DC-': 'GND', IN: 'RL2_K', COM: 'L', NO: 'M2_L' } }),
    off({ ref: 'K3', value: 'SLA-05VDC 30 А', description: 'Модуль реле розетки инструмента: управление — X12, контакты — в разрыв фазы розетки после автомата QF1', fp: 'Module_Relay_30A_Wires', pins: { 'DC+': '5V', 'DC-': 'GND', IN: 'RL3_K', COM: 'L_QF', NO: 'L_XS' } }),
    off({ ref: 'U1', value: 'МР248', description: 'Регулятор мощности турбины 1 (симистор на радиаторе): управление — X14', fp: 'Module_MP248_Wires', pins: { VCC: '3V3', GND: 'GND', CTRL: 'PWM1', L: 'M1_L', N: 'N', OUT: 'M1_A' } }),
    off({ ref: 'U2', value: 'МР248', description: 'Регулятор мощности турбины 2: управление — X15', fp: 'Module_MP248_Wires', pins: { VCC: '3V3', GND: 'GND', CTRL: 'PWM2', L: 'M2_L', N: 'N', OUT: 'M2_A' } }),
    off({ ref: 'TA1', value: 'SCT-013-020', description: 'Ток турбины 1: провод от МР248 к двигателю — через окно', fp: 'CT_SCT013_1V_Wires', pins: { P1: 'M1_A', P2: 'M1_W', S1: 'CT1_IN', S2: 'VMID' } }),
    off({ ref: 'TA2', value: 'SCT-013-020', description: 'Ток турбины 2', fp: 'CT_SCT013_1V_Wires', pins: { P1: 'M2_A', P2: 'M2_W', S1: 'CT2_IN', S2: 'VMID' } }),
    off({ ref: 'M1', value: 'Domel 1600 Вт', description: 'Турбина 1, 230 В', fp: 'Motor_Universal_Wires', pins: { '1': 'M1_W', '2': 'N' } }),
    off({ ref: 'M2', value: 'Domel 1600 Вт', description: 'Турбина 2, 230 В', fp: 'Motor_Universal_Wires', pins: { '1': 'M2_W', '2': 'N' } }),
    off({ ref: 'QF1', value: 'C16', description: 'Автомат 1P C16: линия розетки инструмента', fp: 'Fuse_Breaker_1P_C16_Wires', pins: { '1': 'L', '2': 'L_QF' } }),
    off({ ref: 'TA3', value: 'SCT-013-030', description: 'Ток инструмента: фазный провод розетки — через окно', fp: 'CT_SCT013_1V_Wires', pins: { P1: 'L_XS', P2: 'L_XS2', S1: 'CT3_IN', S2: 'VMID' } }),
    off({ ref: 'XS1', value: '16 А', description: 'Розетка инструмента на корпусе', fp: 'Socket_Power_16A_Wires', pins: { L: 'L_XS2', N: 'N', PE: 'PE' } }),
    off({ ref: 'U3', value: 'G3MB-202P ×2', description: 'Модуль твердотельных реле на 2 канала: управление — X13, выходы — фаза на соленоиды клапанов', fp: 'Module_SSR_G3MB_2ch_Wires', pins: { 'DC+': '5V', 'DC-': 'GND', CH1: 'VLV1_K', CH2: 'VLV2_K', SW1A: 'L', SW1B: 'YV1', SW2A: 'L', SW2B: 'YV2' } }),
    off({ ref: 'YV1', value: '230 В', description: 'Клапан продувки 1: соленоид 230 В', fp: 'Valve_Solenoid_230V_Wires', pins: { '1': 'YV1', '2': 'N' } }),
    off({ ref: 'YV2', value: '230 В', description: 'Клапан продувки 2: соленоид 230 В', fp: 'Valve_Solenoid_230V_Wires', pins: { '1': 'YV2', '2': 'N' } }),
    off({ ref: 'RU2', value: 'S10K275', description: 'Варистор на катушке клапана 1', fp: 'RV_Wires', pins: { '1': 'YV1', '2': 'N' } }),
    off({ ref: 'RU3', value: 'S10K275', description: 'Варистор на катушке клапана 2', fp: 'RV_Wires', pins: { '1': 'YV2', '2': 'N' } }),
    off({ ref: 'RK1', value: '10k B3950', description: 'Термистор на корпусе турбины 1', fp: 'R_NTC_Probe_Wires', pins: { '1': 'NTC1', '2': 'GND' }, fields: { 'Где стоит': 'M1' } }),
    off({ ref: 'RK2', value: '10k B3950', description: 'Термистор на корпусе турбины 2', fp: 'R_NTC_Probe_Wires', pins: { '1': 'NTC2', '2': 'GND' }, fields: { 'Где стоит': 'M2' } }),
    off({ ref: 'B2', value: 'SDP810-500Pa', description: 'Перепад давления на фильтре, I²C 0x25', fp: 'Sensor_SDP810_Wires', pins: { VDD: '3V3', GND: 'GND', SCL: 'SCL', SDA: 'SDA' }, fields: { 'Где стоит': 'фильтр', Камера: '2,2 л' } }),
    off({ ref: 'B3', value: 'SDP811-125Pa', description: 'Расходомер (сопло Вентури на входе шланга), I²C 0x26', fp: 'Sensor_SDP810_Wires', pins: { VDD: '3V3', GND: 'GND', SCL: 'SCL', SDA: 'SDA' }, fields: { 'Где стоит': 'расходомер' } }),
    off({ ref: 'E0', value: 'Электрод общий', description: 'Электрод на дне бака: общий', fp: 'Electrode_Water_Probe', pins: { '1': 'WL_E0' }, fields: { 'Где стоит': 'бак, дно', Объём: '28 л' } }),
    off({ ref: 'E1', value: 'Электрод уровня', description: 'Электрод уровня: вода дошла — турбины стоп', fp: 'Electrode_Water_Probe', pins: { '1': 'WL_E1' }, fields: { 'Где стоит': 'бак, уровень' } }),
    off({ ref: 'E2', value: 'Электрод перелива', description: 'Электрод перелива: авария', fp: 'Electrode_Water_Probe', pins: { '1': 'WL_E2' }, fields: { 'Где стоит': 'бак, перелив' } }),
    off({ ref: 'SL1', value: 'Поплавок', description: 'Поплавковый выключатель в баке', fp: 'Float_Switch_Wires', pins: { '1': 'FLOAT', '2': 'GND' } }),
    off({ ref: 'HG1', value: 'ILI9488 3,5″', description: 'Экран 3,5″ 480×320 ILI9488 с касанием XPT2046 — к X2 кабелем 14 проводов', fp: 'Display_ILI9488_SPI_Wires', pins: { VCC: '5V', GND: 'GND', CS: 'LCD_CS', RESET: 'LCD_RST', DC: 'LCD_DC', SDI: 'SPI_MOSI', SCK: 'SPI_SCK', LED: '3V3', T_CLK: 'SPI_SCK', T_CS: 'T_CS', T_DIN: 'SPI_MOSI', T_DO: 'SPI_MISO', T_IRQ: 'T_IRQ' } }),
    ...[1, 2, 3, 4, 5, 6].map((i): ModPart => off({ ref: `SB${i}`, value: `Кнопка ${i}`, description: `Кнопка ${i} у экрана`, fp: 'SW_PUSH_Panel_19mm', pins: { '1': `K${i}`, '2': 'GND' } })),
    off({ ref: 'SB7', value: 'Турбина 1', description: 'Кнопка «Турбина 1»', fp: 'SW_PUSH_Panel_19mm', pins: { '1': 'KT1', '2': 'GND' } }),
    off({ ref: 'SB8', value: 'Турбина 2', description: 'Кнопка «Турбина 2»', fp: 'SW_PUSH_Panel_19mm', pins: { '1': 'KT2', '2': 'GND' } }),
    off({ ref: 'SB9', value: 'Выкл', description: 'Кнопка «Выкл»', fp: 'SW_PUSH_Panel_19mm', pins: { '1': 'KOFF', '2': 'GND' } }),
    off({ ref: 'SA2', value: 'EC11', description: 'Энкодер с кнопкой на пульте', fp: 'RotaryEncoder_Alps_EC11E_Vertical_H20mm', pins: { A: 'ENC_A', B: 'ENC_B', C: 'GND', S1: 'ENC_SW', S2: 'GND' } }),
    off({ ref: 'BA1', value: 'Зуммер 5 В', description: 'Зуммер без генератора 5 В на пульте', fp: 'Buzzer_12x8.5mm_P6mm', pins: { '1': '5V', '2': 'BZ_K' } }),
    // По желанию: Bluetooth (с платой проводами не соединены; прошивка принимает до 4 устройств).
    off({ ref: 'HG2', value: 'Пульт Bluetooth', description: 'По желанию: ручной пульт на ESP32-C3 (firmware/vacuum-remote) — привязка «remote pair»', fp: 'Remote_BLE_Handheld', pins: {} }),
    off({ ref: 'HG3', value: 'Метка на инструмент', description: 'По желанию: метка на аккумуляторный инструмент (ESP32-C3 + LIS3DH, firmware/vacuum-tag) — привязка «ble pair»', fp: 'Tag_BLE_Tool', pins: {} }),
  );
  return out;
}

/* ---------------- сборка ---------------- */

const BLOCKS: SchBlock[] = [
  { title: 'Сеть и питание', at: [10, 10], width: 240, parts: ['XP1', 'SA1', 'XT1', ['FU1', 90], ['RU1', 90], ['CX1', 90], 'XT2', 'TV1', 'XT3', 'VDS1', 'VD1', ['C1', 90], 'XT4', 'DA1', 'XT5', ['C2', 90], ['C3', 90], ['C6', 90], ['C4', 90], ['C5', 90]] },
  { title: 'Детектор нуля', at: [260, 10], width: 110, parts: ['R1', ['R2', 90], 'VT1', ['R3', 90]] },
  { title: 'ESP32-S3', at: [260, 70], width: 110, parts: ['A1'] },
  { title: 'Турбины и розетка (модули)', at: [10, 120], width: 240, parts: ['X10', 'R50', ['R51', 90], 'VT2', 'K1', 'X11', 'R52', ['R53', 90], 'VT3', 'K2', 'X12', 'R54', ['R55', 90], 'VT4', 'K3', 'X14', 'R60', ['R61', 90], 'U1', 'X15', 'R62', ['R63', 90], 'U2', 'TA1', 'TA2', 'M1', 'M2', 'QF1', 'TA3', 'XS1'] },
  { title: 'Клапаны (SSR, 230 В)', at: [10, 250], width: 240, parts: ['X13', 'R56', ['R57', 90], 'VT5', 'R58', ['R59', 90], 'VT6', 'U3', 'YV1', 'YV2', 'RU2', 'RU3'] },
  { title: 'Датчики', at: [460, 10], width: 210, parts: ['X20', 'R20', 'R21', 'R22', ['C20', 90], ['C21', 90], ['C22', 90], ['R23', 90], ['R24', 90], ['C23', 90], 'X21', ['R25', 90], ['R26', 90], ['C24', 90], ['C25', 90], 'RK1', 'RK2', 'B1', ['C13', 90], 'R27', ['R28', 90], ['C14', 90], 'X24', 'X25', ['R29', 90], ['R30', 90], 'B2', 'B3'] },
  { title: 'Вода в баке', at: [460, 200], width: 210, parts: ['X22', 'X23', 'R40', ['C40', 90], 'R41', ['R42', 90], ['C41', 90], 'R43', ['R44', 90], ['C42', 90], 'E0', 'E1', 'E2', 'SL1'] },
  { title: 'Пульт, кнопки, экран', at: [380, 70], width: 300, parts: ['X1', 'DD1', ['R31', 90], ['R32', 90], ['R33', 90], ['R34', 90], ['R35', 90], ['C17', 90], ['C18', 90], 'VT7', 'R36', ['VD2', 90], 'R37', 'HL1', 'X2', ['R38', 90], 'HG1', 'SB1', 'SB2', 'SB3', 'SB4', 'SB5', 'SB6', 'SB7', 'SB8', 'SB9', 'SA2', 'BA1'] },
];

/** Подписи контактов клеммника на шёлке: со стороны винтов, поперёк ряда выводов. */
function terminalLabels(p: Project, ref: string, labels: string[]): void {
  const c = Object.values(p.components).find((x) => x.ref === ref)!;
  const w = getWorld(p);
  const pads = w.pads.filter((q) => q.component.id === c.id).sort((a, b) => Number(a.pad.number) - Number(b.pad.number));
  const rot = ((c.rotation % 360) + 360) % 360;
  const fp = p.footprints[c.footprint];
  // Сторона без проводов: у клеммника провода входят снизу корпуса (+y), подписи — сверху (−y);
  // у штырей — с той стороны, где свободнее (ниже ряда).
  const isTerm = fp.tags?.includes('terminal');
  const depth = isTerm ? 6.3 : 2.6;
  const dir = isTerm ? -1 : -1;
  for (const [i, q] of pads.entries()) {
    const text = labels[i];
    if (!text) continue;
    const off = { x: 0, y: dir * depth };
    const r = (rot * Math.PI) / 180;
    const d = { x: off.x * Math.cos(r) + off.y * Math.sin(r), y: -off.x * Math.sin(r) + off.y * Math.cos(r) };
    const along = rot === 90 || rot === 270;
    const align = along ? (d.x < 0 ? 'right' : 'left') : 'left';
    addDrawing(p, { kind: 'text', layer: 'F.Silk', at: { x: +(q.center.x + d.x).toFixed(2), y: +(q.center.y + d.y).toFixed(2) }, text, size: 1.1, thickness: 0.15, rotation: along ? 0 : d.y < 0 ? 90 : 270, align });
  }
}

/**
 * Плата без дорожек: детали на местах, цепи, правила под ЛУТ, схема. firmware — ядро прошивки
 * в WebAssembly (firmware/vacuum-s3), panel — интерфейс экрана (firmware/vacuum-panel): в
 * симуляции экран HG1 показывает его кадр 800×480 (на самом экране — уменьшенный).
 */
export function buildVacuumS3Mod(firmware?: { name: string; wasm: string }, panel?: { name: string; wasm: string }): Project {
  const { w, h } = MOD_BOARD;
  const p = createProject({ name: 'Пылесос S3 на модулях (ЛУТ)', width: w, height: h, copperLayers: 2, cornerRadius: 2, homemade: true });
  p.meta.author = 'Plata';
  p.meta.description =
    'Контроллер пылесоса S3 на готовых модулях, двусторонняя плата под ЛУТ без металлизации: ESP32-S3-DevKitC-1 N16R8, PCA9555 на платке, выпрямитель KBP310 с накопителем 4700 мкФ, детектор нуля, ключи SS8050 к модулям реле 30 А (турбины, розетка) и к твердотельному реле G3MB (клапаны 230 В), ШИМ к регуляторам МР248, входы SCT-013 (1 В), термисторов, электродов, поплавка, MPX5100DP, I²C к SDP810/SDP811, пульт (IDC 2×10) и экран ILI9488 по SPI. Все выводы паяются снизу; дорожки сверху — между переходными (проволочки).';
  // Дорожки под ЛУТ: 0,6 мм, зазор 0,4; питание 0,7 мм (1,2 А при нагреве на 10 °C — с запасом);
  // переходные — 2 мм, сверло 0,8.
  p.netClasses.Default = { ...p.netClasses.Default, trackWidth: 0.6, clearance: 0.4, viaDiameter: 2.0, viaDrill: 0.8 };
  p.netClasses.Power = { ...p.netClasses.Power, trackWidth: 0.7, clearance: 0.4, viaDiameter: 2.2, viaDrill: 0.9 };
  // Сеть: 1,2 мм, между своими цепями 1,3 мм (IPC-2221 B2 для 250 В — 1,25), до остального 6 мм.
  p.netClasses.Mains = { ...MAINS_CLASS, trackWidth: 1.2, clearance: 1.3, viaDiameter: 2.4, viaDrill: 1.0 };
  p.rules.classClearances = [{ a: 'Mains', b: '*', clearance: MAINS_CLEARANCE }];
  p.rules.minClearance = 0.4;
  p.rules.edgeClearance = 1.0;

  const parts = modParts();
  for (const name of MAINS) ensureNet(p, name, { netClass: 'Mains', description: DESCRIPTIONS[name] });
  for (const name of POWER) ensureNet(p, name, { netClass: 'Power', description: DESCRIPTIONS[name] });
  for (const part of parts) {
    const fp0 = footprintOf(part.fp);
    // Без металлизации: у выводов медь только снизу.
    const fp = part.offBoard ? fp0 : { ...fp0, pads: fp0.pads.map((q) => (q.type === 'tht' ? { ...q, layer: 'B.Cu' as const } : q)) };
    const at = part.at ?? [0, 0, 0];
    // Центры — на сетке 1,27: выводы с шагом 2,54 ложатся на сетку трассировки.
    const g = (v: number) => +(Math.round(v / 1.27) * 1.27).toFixed(3);
    const c = addComponent(p, fp, { x: g(at[0]), y: g(at[1]) }, { ref: part.ref, value: part.value, description: part.description, rotation: at[2] ?? 0 });
    if (part.offBoard) c.offBoard = true;
    if (part.fields) c.fields = { ...part.fields };
    if (!part.value) c.hideValue = true;
    const f = p.footprints[c.footprint];
    for (const [pin, net] of Object.entries(part.pins)) {
      const byName = f.pads.filter((q) => q.type !== 'npth' && q.name === pin);
      const pads = byName.length ? byName : f.pads.filter((q) => q.number === pin);
      if (!pads.length) throw new Error(`${part.ref}: нет вывода ${pin}`);
      const n = ensureNet(p, net, { description: DESCRIPTIONS[net] });
      for (const q of pads) connectPad(p, c.id, q.number, n.id);
    }
  }
  for (const [name, amps] of Object.entries(CURRENT)) {
    const n = Object.values(p.nets).find((x) => x.name === name);
    if (n) n.current = amps;
  }
  let x = 0;
  for (const c of Object.values(p.components))
    if (c.offBoard) {
      c.at = { x, y: -30 };
      x += 12;
    }
  for (const part of parts) if (part.labels) terminalLabels(p, part.ref, part.labels);
  addDrawing(p, { kind: 'text', layer: 'F.Silk', at: { x: 24, y: 22 }, text: 'Пылесос S3 - контроллер на модулях', size: 1.6, thickness: 0.2, align: 'center' });

  // Сеть — в своём углу, до логики 6 мм (правило классов); туда не заходит ничего другое.
  const rect = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  addRuleArea(p, { name: 'Сеть 230 В', outline: rect(113, 0, w, 25), onlyClasses: ['Mains'], showLabel: true });
  // Антенна DevKitC: под ней меди нет.
  addRuleArea(p, { name: 'Антенна ESP32-S3', outline: rect(62, 44, 94, 51.5), keepoutTracks: true, keepoutVias: true, showLabel: false });
  layoutBlocks(p, BLOCKS);
  if (firmware) {
    p.firmware = { name: firmware.name, hex: '', mcu: 'esp32', wasm: firmware.wasm };
    if (panel) p.firmware.modules = { HG1: { name: panel.name, wasm: panel.wasm } };
  }
  return structuredClone(p);
}

/**
 * Разводка под ЛУТ: выводы — только снизу, сверху — перемычки между переходными. Сначала сеть
 * (дорожки 1,2 мм), потом всё остальное на сетке 1,27 мм (шаг не меньше ширины и зазора, между
 * отверстиями выводов сверху проходит одна дорожка); земля снизу — заливкой по остаткам.
 */
export async function routeVacuumS3Mod(p0: Project, o: { iterations?: number } = {}): Promise<{ project: Project; report: string[]; failed: number }> {
  const it = o.iterations ?? 80;
  const ids = (q: Project, f: (cls: string) => boolean) => Object.values(q.nets).filter((n) => f(n.netClass)).map((n) => n.id);
  const run = async (q: Project, nets: string[], grid: number, hopCost: number, x: Partial<RouteOptions> = {}) => {
    const r = await autoroute(q, { iterations: it, yieldEvery: 1e9, grid, nets, keepExisting: true, hopCost, layerCost: [1.6, 1], diagonal: false, greed: 1, ...x });
    for (const t of r.tracks) addTrack(q, t);
    for (const v of r.vias) addVia(q, v);
    return { r, q: structuredClone(q) };
  };
  // Шаг сетки не меньше ширины и зазора: сеть 1,2 + 1,3 — на 2,54; остальное (0,6–0,7 + 0,4) —
  // одним согласованием на 1,27: сверху дорожка проходит между отверстиями выводов с шагом 2,54.
  const m = await run(structuredClone(p0), ids(p0, (c) => c === 'Mains'), 2.54, 40);
  const report = [`сеть: дорожек ${m.r.tracks.length}, переходных ${m.r.vias.length}, не проведено ${m.r.failed}`];
  // Несколько порядков цепей и цен переходного — первый вариант, где всё разведено (или с наименьшим
  // остатком). Переходное дома — проволочка: цена повыше, чтобы их было меньше.
  let best: { q: Project; r: RouteResult; label: string } | null = null;
  for (const [label, hop, x] of [
    ['случайный порядок 2', 20, { order: 'random', seed: 2 }],
    ['короткие первыми', 12, {}],
    ['случайный порядок 2, дешевле переходные', 12, { order: 'random', seed: 2 }],
    ['короткие первыми, дороже переходные', 20, {}],
    ['случайный порядок 5', 12, { order: 'random', seed: 5 }],
  ] as [string, number, Partial<RouteOptions>][]) {
    const t = await run(structuredClone(m.q), ids(m.q, (c) => c !== 'Mains'), 1.27, hop, x);
    if (!best || t.r.failed < best.r.failed || (t.r.failed === best.r.failed && t.r.vias.length < best.r.vias.length)) best = { q: t.q, r: t.r, label };
    if (!t.r.failed) break;
  }
  report.push(`питание и сигналы (${best!.label}): дорожек ${best!.r.tracks.length}, переходных ${best!.r.vias.length}, не проведено ${best!.r.failed}`);
  const p = best!.q;
  const failed = m.r.failed + best!.r.failed;
  const gnd = ensureNet(p, 'GND').id;
  const { w, h } = MOD_BOARD;
  const outline = [
    { x: 1, y: 1 },
    { x: 106, y: 1 },
    { x: 106, y: 32 },
    { x: w - 1, y: 32 },
    { x: w - 1, y: h - 1 },
    { x: 1, y: h - 1 },
  ];
  addZone(p, { name: 'Земля снизу', layer: 'B.Cu', net: gnd, outline, clearance: 0.6, minWidth: 0.6, priority: 0 });
  return { project: structuredClone(p), report, failed };
}

/**
 * Разводка из уже разведённого файла той же платы (дорожки, переходные, заливки — цепи по имени):
 * выносные детали, прошивку и описания можно поменять, не трогая медь, которую уже напечатали.
 */
export function withRoutingOf(p0: Project, routed: Project): Project {
  const p = structuredClone(p0);
  const byName = new Map(Object.values(p.nets).map((n) => [n.name, n.id]));
  const strip = <T extends { id: string }>(x: T): Omit<T, 'id'> => {
    const y: Partial<T> = structuredClone(x);
    delete y.id;
    return y as Omit<T, 'id'>;
  };
  for (const t of Object.values(routed.tracks)) addTrack(p, strip(t));
  for (const v of Object.values(routed.vias)) addVia(p, strip(v));
  for (const z of Object.values(routed.zones)) {
    const name = z.net ? routed.nets[z.net]?.name : undefined;
    addZone(p, { ...strip(z), net: name ? (byName.get(name) ?? null) : null });
  }
  return structuredClone(p);
}

/* ---------------- памятка ---------------- */

/** Памятка к плате на модулях: что куда подключить, перемычки модулей, выводы ESP32, изготовление. */
export function vacuumS3ModNotes(p: Project): string {
  const comps = Object.values(p.components);
  const netName = (id: string | undefined) => (id ? (p.nets[id]?.name ?? '?') : '—');
  const byRef = (a: { ref: string }, b: { ref: string }) => a.ref.localeCompare(b.ref, 'ru', { numeric: true });
  const wires: string[] = [];
  for (const c of comps.filter((x) => !x.offBoard && /^X[T]?\d/.test(x.ref)).sort(byRef)) {
    wires.push(`  ${c.ref} «${c.value}»: ${c.description ?? ''}`);
    const fp = p.footprints[c.footprint];
    for (const pad of [...fp.pads].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }))) {
      const net = c.padNets[pad.number];
      if (!net) continue;
      const name = netName(net);
      const ends: string[] = [];
      if (!/^(GND|3V3|5V)$/.test(name))
        for (const o of comps.filter((x) => x.offBoard)) {
          const ofp = p.footprints[o.footprint];
          for (const q of ofp.pads) if (o.padNets[q.number] === net) ends.push(`${o.ref}.${q.name && q.name !== q.number ? q.name : q.number}`);
        }
      wires.push(`    ${pad.number.padStart(2)} ${name}${ends.length ? ` → ${ends.join(', ')}` : ''}`);
    }
  }
  const pins = Object.entries(MOD_PINS).map(([pin, net]) => `  ${(pin === 'TX' ? 'IO43' : pin).padEnd(5)} ${net.padEnd(9)} ${DESCRIPTIONS[net] ?? ''}`.trimEnd());
  const off = comps
    .filter((c) => c.offBoard)
    .sort(byRef)
    .map((c) => `  ${c.ref.padEnd(4)} ${c.value.padEnd(22)} ${c.description ?? ''}`.trimEnd());
  const vias = Object.keys(p.vias).length;
  const top = Object.values(p.tracks).filter((t) => t.layer === 'F.Cu').length;
  return [
    'Пылесос S3 на модулях — плата контроллера под ЛУТ',
    '================================================',
    '',
    `Плата ${MOD_BOARD.w}×${MOD_BOARD.h} мм, двусторонняя, без металлизации. Переходных: ${vias}, отрезков дорожек сверху: ${top}.`,
    '',
    'Изготовление',
    '------------',
    '- Нижняя сторона (B.Cu) — основная: все выводы паяются только снизу. Сверху у выводов меди нет:',
    '  под модулями, гребёнками и клеммниками верх не пропаять.',
    '- Верхняя сторона (F.Cu) — только перемычки между переходными. Переходное: отверстие 0,8 мм,',
    '  в него — кусок медной проволоки (жила 0,5–0,6 мм), пропаять с двух сторон, лишнее откусить.',
    '- Печать для ЛУТ: низ — как есть, верх — зеркально (в редакторе: «Файл → Печать для ЛУТ»).',
    '  Совмещение сторон — по отверстиям крепежа H1–H4 и по контуру.',
    '- Сверление: выводы 0,8–1,0 мм, мост и клеммники 5 мм — 1,2–1,3 мм, крепёж — 3,2 мм.',
    '- Земля снизу — заливкой. Сетевой угол (XT1, FU1, RU1, CX1, XT2) отделён от остального на 6 мм;',
    '  после пайки покройте его лаком.',
    '',
    'Модули и перемычки',
    '------------------',
    '- ESP32-S3-DevKitC-1 N16R8 — на гнёздах 1×22, разъёмами USB вниз: под ними место под штекер.',
    '  Ряды через 25,4 мм — проверить штангенциркулем на своей плате. IO35–IO37 у N16R8 заняты',
    '  памятью, на плате не используются.',
    '- MP1584: до подключения к плате выставить подстроечником 5,0 В на выходе (вход — 12 В от',
    '  любого блока или с XT4 без нагрузки).',
    '- Модули реле 30 А (K1, K2, K3): перемычку режима — в положение L (включение низким уровнем):',
    '  на плате ключ SS8050 замыкает IN на землю. Проверка: IN на GND — реле щёлкает.',
    '- Твердотельное реле G3MB на 2 канала: управление низким уровнем (CH на GND — включено).',
    '  На катушках соленоидов — варисторы S10K275 (RU2, RU3).',
    '- МР248: питание +VCC — 3,3 В с платы (тогда ШИМ 0–3,3 В даёт 0–100 %). Ток двигателя — через',
    '  его клеммы, по плате не идёт.',
    '- PCA9555: платка 800 mil (20,32 мм между рядами). Перемычки адреса A0–A2 — в L или не запаяны',
    '  (на плате они подтянуты к земле через 10 кОм), адрес 0x20. Питание — 3,3 В.',
    '- Экран ILI9488: к X2 кабелем 14 проводов (порядок как на экране: VCC, GND, CS, RESET, DC, SDI,',
    '  SCK, LED, SDO, T_CLK, T_CS, T_DIN, T_DO, T_IRQ); SDO экрана не подключён — на общей шине он',
    '  мешает касанию. Кабель — не длиннее 15–20 см.',
    '- SS8050: на плате выводы Э — Б — К (слева направо, срезом к себе). Сверить с корпусом.',
    '- Мост KBP310: + ~ ~ − (шаг 3,8 мм), «+» — со стороны скошенного угла.',
    '- SCT-013: провода обрезаны и облужены (или НШВИ 0,5); в окно — один провод (фаза).',
    '',
    'Провода к клеммникам',
    '--------------------',
    ...wires,
    '',
    'Выводы ESP32-S3',
    '---------------',
    ...pins,
    '  PCA9555: P00–P05 кнопки 1–6, P06/P07 «Турбина 1/2», P10 «Выкл», P11 кнопка энкодера,',
    '           P12 сброс экрана, P13 светодиод (0 — горит), P14 касание (T_IRQ), P17 поплавок.',
    '',
    'Прошивка',
    '--------',
    'Готовая прошивка (версия 5.0, исходники — firmware/vacuum-s3): vacuum-s3-proshivka.bin — целиком,',
    'с адреса 0x0, первая прошивка через USB DevKitC (esptool или Flash Download Tool); vacuum-s3-app.bin —',
    'обновление с телефона по Wi-Fi («Телефон» на экране). Arduino IDE: «ESP32S3 Dev Module», Flash',
    '16 МБ, Partition Scheme «16M Flash (3MB APP/9.9MB FATFS)», PSRAM «OPI PSRAM», USB CDC On Boot — Enabled.',
    'Экран ILI9488 работает прямо от контроллера: интерфейс тот же, что у пульта 7″, уменьшенный до',
    '480×288 (сверху и снизу — чёрные полосы). Касание: при первом включении — «lcd cal» в мониторе',
    'порта или палец 8 с на экране, дальше три крестика. Экран вверх ногами — «lcd flip», красный и',
    'синий перепутаны — «lcd rgb», экрана нет — «lcd off». Плата с экраном 7″ по X1 работает одновременно.',
    'Клапаны: удар — целое число полупериодов сети (SSR включается и выключается в нуле).',
    'Когда бить: «Фильтр · ещё → Очистка при перепаде» — порог в Па при расходе уставки (команда «set dp 150»),',
    'рядом показан перепад чистого фильтра (по замеру «новый фильтр»); «авто» — по росту сопротивления.',
    'Шланг шире 38 мм ослабляет удар (в баке мало разрежения) — на экране «Удар слабый»: закройте шланг',
    'ладонью на 2 с, пылесос сделает мощную очистку.',
    '',
    'Выносные детали',
    '---------------',
    ...off,
    '',
  ].join('\n');
}
