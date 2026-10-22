import { addComponent, addDrawing, connectPad, ensureNet } from '../../model/edit';
import { createProject } from '../../model/project';
import type { Component, FootprintDef, Project } from '../../model/types';
import type { EasyedaPart } from '../../io/easyeda-sch-export';
import { layoutBlocks, type SchBlock } from './build';
import { footprintOf, MOD_PINS } from './mod';
import { wired, type VacPart } from './parts';

/*
 * Стенд одной турбины: отработка ударов, перепадов, потоков, защиты от перегрева и счётчика
 * мощности — с тем же набором датчиков, что будет на каждой турбине пылесоса. Плата только
 * низковольтная (5 и 3,3 В): сеть 230 В идёт по модулям (МР248, диммер на 2 канала, ZMPT101B)
 * своими проводами, на плату не заходит.
 *
 * Выводы ESP32-S3 — как у платы на модулях (MOD_PINS), где задача та же: токи IO4/IO5, SPI экрана
 * IO15–IO18, CS экрана TX (IO43), CS касания IO0, I²C IO11/IO12, разрежение IO10, нуль сети IO48,
 * ШИМ МР248 IO39/IO38, клапаны IO40/IO41. Новое для стенда: перепад на фильтре IO6, датчики
 * DS18B20 IO7, напряжение сети IO8, датчики хода клапанов IO3/IO9, подсветка экрана IO42,
 * сброс экрана IO21, касание IO47, карта памяти экрана IO14.
 */

/** Выводы ESP32-S3 на стенде. */
export const STAND_PINS: Record<string, string> = {
  IO4: 'CT1', IO5: 'CT2', IO6: 'DPF', IO7: 'OW', IO8: 'UAC', IO10: 'VAC',
  IO3: 'HALL1', IO9: 'HALL2',
  IO15: 'SPI_SCK', IO16: 'SPI_MOSI', IO17: 'SPI_MISO', IO18: 'LCD_DC',
  IO11: 'SDA', IO12: 'SCL',
  TX: 'LCD_CS', IO0: 'T_CS', IO21: 'LCD_RST', IO47: 'T_IRQ', IO42: 'LCD_BL', IO14: 'SD_CS',
  IO40: 'VLV1', IO41: 'VLV2', IO48: 'ZC', IO39: 'T1', IO38: 'T2',
  IO1: 'SPARE1', IO2: 'SPARE2', IO13: 'SPARE3',
};

export const STAND_BOARD = { w: 120, h: 85 };

export const STAND_GROUPS = ['Питание и ESP32-S3', 'Силовые модули', 'Ток и напряжение сети', 'Давление', 'I²C', 'Температура и ход клапанов', 'Экран'] as const;
type Group = (typeof STAND_GROUPS)[number];

const DESCRIPTIONS: Record<string, string> = {
  '5V': 'Питание 5 В от блока питания (XT1): датчики давления, ZMPT101B, датчики Холла, экран',
  '5V_ESP': '5 В на DevKitC через диод VD1: USB при прошивке не питает блок питания и датчики',
  '3V3': '3,3 В со стабилизатора DevKitC: I²C, DS18B20, диммер, МР248, подсветка',
  VMID: 'Середина 1,65 В для трансформаторов тока',
  CT1: 'Ток турбины 1 (SCT-013, 1 В) → IO4',
  CT2: 'Ток турбины 2 (на стенде — запас) → IO5',
  UAC: 'Напряжение сети с ZMPT101B → IO8',
  VAC: 'Разрежение в баке MPX5100DP → IO10',
  DPF: 'Перепад на фильтре MPXV7007DP → IO6',
  OW: '1-Wire: DS18B20 на двигателях → IO7',
  HALL1: 'Датчик хода клапана 1 (A3144) → IO3',
  HALL2: 'Датчик хода клапана 2 (A3144) → IO9',
  ZC: 'Нуль сети с диммера (Z-C) → IO48',
  VLV1: 'Клапан 1: DIM1 диммера ← IO40',
  VLV2: 'Клапан 2: DIM2 диммера ← IO41',
  T1: 'ШИМ к МР248 турбины 1 ← IO39',
  T2: 'ШИМ к МР248 турбины 2 ← IO38',
  SDA: 'I²C: TCA9548A (0x70) → SDP811-500 и SDP811-125 на своих каналах, BME280 (0x76) — IO11',
  SCL: 'I²C — IO12',
  LCD_BL: 'Подсветка экрана ← IO42 («0» — горит, ШИМ — яркость)',
};

/** Модули и датчики на проводах (на схеме и в перечне). */
const STAND_FOOTPRINTS: FootprintDef[] = [
  wired('Module_Dimmer_2ch_Wires', 'Диммер на 2 канала (RobotDyn)', 'Модуль диммера переменного тока на 2 канала с детектором нуля (оптопары, симисторы BTA16): VCC 3,3–5 В, GND, Z-C — нуль сети, D1/D2 — открыть канал (держать «1» всё время удара); клеммы сети и нагрузок — 230 В', 'Питание', 'U', [['VCC', 'VCC'], ['GND', 'GND'], ['Z-C', 'Z-C'], ['D1', 'D1'], ['D2', 'D2']], ['triac-dimmer', 'dimmer'], [60, 40]),
  wired('Module_ZMPT101B_Wires', 'Датчик напряжения ZMPT101B', 'Модуль ZMPT101B: трансформатор напряжения и усилитель, выход — переменное около VCC/2; сеть — на винтовой клеммник модуля', 'Датчики', 'U', [['VCC', 'VCC'], ['OUT', 'OUT'], ['GND', 'GND']], ['zmpt101b', 'voltage'], [50, 20]),
  wired('Module_TCA9548A_Wires', 'Переключатель I²C TCA9548A', 'Модуль CJMCU-9548 (TCA9548A, 8 каналов I²C), адрес 0x70', 'Модули', 'U', [['VIN', 'VIN'], ['GND', 'GND'], ['SCL', 'SCL'], ['SDA', 'SDA'], ['SD0', 'SD0'], ['SC0', 'SC0'], ['SD1', 'SD1'], ['SC1', 'SC1']], ['tca9548a', 'i2c'], [30, 20]),
  wired('Module_BME280_Wires', 'BME280 (модуль GY)', 'Датчик температуры, влажности и давления BME280 на модуле GY (свой стабилизатор 3,3 В), I²C 0x76', 'Датчики', 'B', [['VIN', 'VIN'], ['GND', 'GND'], ['SCL', 'SCL'], ['SDA', 'SDA']], ['bme280'], [15, 12]),
  wired('Sensor_DS18B20_Wires', 'DS18B20 в гильзе', 'Цифровой датчик температуры DS18B20 в гильзе на проводе: VDD, DQ, GND', 'Датчики', 'BK', [['VDD', 'VDD'], ['DQ', 'DQ'], ['GND', 'GND']], ['ds18b20'], [6, 30]),
  wired('Sensor_A3144_Wires', 'Датчик Холла A3144', 'Датчик Холла A3144 (цифровой, открытый коллектор) на проводах: VCC 4,5–24 В, OUT, GND', 'Датчики', 'BH', [['VCC', 'VCC'], ['OUT', 'OUT'], ['GND', 'GND']], ['hall', 'a3144'], [5, 4]),
];

const fpOf = (id: string): FootprintDef => STAND_FOOTPRINTS.find((f) => f.id === id) ?? footprintOf(id);

const RES = 'R_Axial_0.25W_L6.3mm_D2.5mm_P7.62mm_Horizontal';
const CER = 'C_Disc_D5mm_W2.5mm_P2.5mm';
const CER5 = 'C_Disc_D6mm_W2.5mm_P5mm';
const EL = 'CP_Radial_D6.3mm_P2.5mm';
const HDR = (n: number) => `PinHeader_1x${String(n).padStart(2, '0')}_P2.54mm`;

interface StandPart extends VacPart {
  group: Group;
}

type At = [number, number, number?];
const R = (g: Group, ref: string, value: string, description: string, a: string, b: string, at: At): StandPart => ({ group: g, ref, value, description, fp: RES, pins: { '1': a, '2': b }, at });
const C = (g: Group, ref: string, value: string, description: string, a: string, b: string, at: At, fp = CER): StandPart => ({ group: g, ref, value, description, fp, pins: { '1': a, '2': b }, at });
/** Штыри к модулю или датчику на проводах; подписи — в описании. */
const hdr = (g: Group, ref: string, value: string, description: string, nets: string[], at: At): StandPart => ({ group: g, ref, value, description, fp: HDR(nets.length), pins: Object.fromEntries(nets.flatMap((n, i) => (n ? [[String(i + 1), n]] : []))), at });

export function standParts(): StandPart[] {
  const out: StandPart[] = [];
  const add = (...p: StandPart[]) => out.push(...p);

  // --- питание и ESP32-S3 ---
  const P: Group = 'Питание и ESP32-S3';
  add(
    { group: P, ref: 'XT1', value: '5 В', description: 'Клеммник питания 5 В 2–3 А (блок питания 5 В или HLK-PM05 в отдельной коробке): 1 — +5 В, 2 — земля', fp: 'TerminalBlock_1x02_P5mm', pins: { '1': '5V', '2': 'GND' }, at: [8, 78, 180] },
    C(P, 'C1', '470 мкФ 10 В', 'Питание 5 В на входе', '5V', 'GND', [20, 78], EL),
    C(P, 'C2', '100 нФ', 'Питание 5 В на входе', '5V', 'GND', [27, 78]),
    { group: P, ref: 'VD1', value: '1N5819', description: 'Диод Шоттки 1 А: 5 В на DevKitC. Пока к компьютеру подключён USB, он не питает блок питания и датчики (и наоборот — можно прошивать, не отключая 5 В)', fp: 'D_DO-41_P10.16mm_Horizontal', pins: { A: '5V', K: '5V_ESP' }, at: [36, 78] },
    C(P, 'C3', '10 мкФ', 'Питание 3,3 В у DevKitC', '3V3', 'GND', [35, 10], EL),
    C(P, 'C4', '100 нФ', 'Питание 3,3 В у DevKitC', '3V3', 'GND', [35, 16]),
    {
      group: P,
      ref: 'A1',
      value: 'ESP32-S3-DevKitC-1 N16R8',
      description: 'Плата ESP32-S3 N16R8 на гнёздах 1×22 (ряды через 25,4 мм). IO35–IO37 заняты памятью PSRAM, IO19/IO20 — USB. 5 В — через VD1, 3,3 В для датчиков — с её вывода 3V3',
      fp: 'Module_ESP32-S3_DevKitC-1',
      pins: { GND: 'GND', '3V3': '3V3', '5V': '5V_ESP', ...STAND_PINS },
      at: [52, 42],
    },
    hdr(P, 'X9', 'Запас', 'Свободные выводы на будущее: 1 — IO1 (АЦП), 2 — IO2 (АЦП), 3 — IO13, 4 — 3,3 В, 5 — земля', ['SPARE1', 'SPARE2', 'SPARE3', '3V3', 'GND'], [76, 80, 90]),
  );

  // --- силовые модули: МР248 и диммер на 2 канала (клапаны) ---
  const S: Group = 'Силовые модули';
  add(
    hdr(S, 'X10', 'МР248 турбины 1', 'К регулятору МР248 турбины 1 (вход управления, развязанный от сети, — проверить по инструкции): 1 — +VCC 3,3 В, 2 — земля, 3 — «управление» (ШИМ 0–3,3 В → 0–100 %)', ['3V3', 'GND', 'PWM1'], [114, 10, 90]),
    R(S, 'R1', '100', 'ШИМ МР248 турбины 1: защита вывода', 'T1', 'PWM1', [96, 8]),
    R(S, 'R2', '10k', 'Вход МР248 турбины 1 к земле: 0 %, пока ESP32 не запущен', 'PWM1', 'GND', [96, 12]),
    hdr(S, 'X11', 'МР248 турбины 2', 'К регулятору МР248 турбины 2 (на стенде — запас): 1 — +VCC 3,3 В, 2 — земля, 3 — «управление»', ['3V3', 'GND', 'PWM2'], [114, 22, 90]),
    R(S, 'R3', '100', 'ШИМ МР248 турбины 2: защита вывода', 'T2', 'PWM2', [96, 20]),
    R(S, 'R4', '10k', 'Вход МР248 турбины 2 к земле', 'PWM2', 'GND', [96, 24]),
    hdr(S, 'X12', 'Диммер 2 канала', 'К модулю диммера на 2 канала (RobotDyn): 1 — VCC 3,3 В, 2 — земля, 3 — Z-C (нуль сети), 4 — DIM1 (клапан 1), 5 — DIM2 (клапан 2). Порядок сверить с подписями на модуле. Соленоиды — к выходам каналов, на каждом RC-гаситель 100 Ом + 0,1 мкФ X2 (и варистор 275 В)', ['3V3', 'GND', 'ZC', 'DIM1', 'DIM2'], [114, 36, 90]),
    R(S, 'R5', '100', 'Клапан 1: к DIM1 (на модуле — свой резистор оптопары)', 'VLV1', 'DIM1', [96, 32]),
    R(S, 'R6', '10k', 'Клапан 1 закрыт, пока ESP32 не запущен', 'DIM1', 'GND', [96, 36]),
    R(S, 'R7', '100', 'Клапан 2: к DIM2', 'VLV2', 'DIM2', [96, 40]),
    R(S, 'R8', '10k', 'Клапан 2 закрыт, пока ESP32 не запущен', 'DIM2', 'GND', [96, 44]),
    C(S, 'C5', '1 нФ', 'Фильтр сигнала нуля сети (длинный провод рядом с 230 В)', 'ZC', 'GND', [104, 46]),
  );

  // --- ток турбин и напряжение сети ---
  const I: Group = 'Ток и напряжение сети';
  add(
    { group: I, ref: 'XT2', value: 'ТТ1, ТТ2', description: 'Трансформаторы тока SCT-013-020 (1 В на 20 А; штекер 3,5 мм отрезать, провода облудить): 1–2 — ТТ1 (турбина 1), 3–4 — ТТ2 (турбина 2, на стенде — запас). Через окно — только фазный провод турбины', fp: 'TerminalBlock_1x04_P5mm', pins: { '1': 'CT1_IN', '2': 'VMID', '3': 'CT2_IN', '4': 'VMID' }, at: [6, 18, 270] },
    R(I, 'R10', '1k', 'ТТ1: фильтр АЦП (с C10)', 'CT1_IN', 'CT1', [17, 8]),
    C(I, 'C10', '10 нФ', 'ТТ1: фильтр АЦП', 'CT1', 'GND', [26, 8]),
    R(I, 'R11', '1k', 'ТТ2: фильтр АЦП', 'CT2_IN', 'CT2', [17, 13]),
    C(I, 'C11', '10 нФ', 'ТТ2: фильтр АЦП', 'CT2', 'GND', [26, 13]),
    R(I, 'R12', '10k', 'Середина 1,65 В для ТТ: верхнее плечо', '3V3', 'VMID', [17, 18]),
    R(I, 'R13', '10k', 'Середина 1,65 В для ТТ: нижнее плечо', 'VMID', 'GND', [17, 22]),
    C(I, 'C12', '10 мкФ', 'Середина 1,65 В для ТТ', 'VMID', 'GND', [27, 21], EL),
    hdr(I, 'X13', 'ZMPT101B', 'К модулю напряжения сети ZMPT101B: 1 — VCC 5 В, 2 — OUT, 3 — земля. Сеть 230 В — на его винтовой клеммник, на плату не заходит. Подстроечником модуля выставить размах выхода около 2 В', ['5V', 'UAC_IN', 'GND'], [4, 33, 90]),
    R(I, 'R14', '10k', 'Делитель ZMPT101B 5 → 3,3 В: верхнее плечо', 'UAC_IN', 'UAC', [17, 31]),
    R(I, 'R15', '20k', 'Делитель ZMPT101B: нижнее плечо', 'UAC', 'GND', [17, 35]),
    C(I, 'C13', '1 нФ', 'Фильтр АЦП напряжения сети', 'UAC', 'GND', [26, 33]),
  );

  // --- давление: разрежение MPX5100DP (на плате), перепад MPXV7007DP (на переходнике SOP8 → DIP8) ---
  const D: Group = 'Давление';
  add(
    { group: D, ref: 'B1', value: 'MPX5100DP', description: 'Разрежение в баке 0–100 кПа: датчик меряет P1 − P2 (P1 > P2), поэтому P2 (штуцер на стороне без надписи) — трубка к баку, P1 (сторона с надписью) — открыт в атмосферу (через ватку от пыли). Выход 0,2–4,7 В', fp: 'Sensor_MPX5100DP', pins: { VOUT: 'VAC_S', GND: 'GND', VS: '5V' }, at: [14, 47] },
    C(D, 'C14', '1 мкФ', 'Питание датчика разрежения', '5V', 'GND', [27, 43], CER5),
    R(D, 'R16', '6,8k', 'Делитель датчика разрежения 4,7 → 2,8 В', 'VAC_S', 'VAC', [17, 56]),
    R(D, 'R17', '10k', 'Делитель датчика разрежения', 'VAC', 'GND', [17, 60]),
    C(D, 'C15', '10 нФ', 'Фильтр датчика разрежения', 'VAC', 'GND', [27, 58]),
    { group: D, ref: 'B2', value: 'MPXV7007DP', description: 'Перепад на фильтре ±7 кПа на переходнике SOP8 → DIP8 (300 mil, в панельку): 2 — VS 5 В, 3 — земля, 4 — VOUT (0,5–4,5 В, 2,5 В при нуле). P1 — до фильтра (грязная сторона), P2 — после', fp: 'DIP-8_W7.62mm_Socket', pins: { '2': '5V', '3': 'GND', '4': 'DPF_S' }, at: [10, 68, 90] },
    C(D, 'C16', '1 мкФ', 'Питание датчика перепада', '5V', 'GND', [22, 65], CER5),
    R(D, 'R18', '6,8k', 'Делитель датчика перепада 4,5 → 2,7 В', 'DPF_S', 'DPF', [17, 72]),
    R(D, 'R19', '10k', 'Делитель датчика перепада', 'DPF', 'GND', [27, 70]),
    C(D, 'C17', '10 нФ', 'Фильтр датчика перепада', 'DPF', 'GND', [30, 65]),
  );

  // --- I²C: TCA9548A и BME280 на проводах ---
  const B: Group = 'I²C';
  add(
    hdr(B, 'X14', 'TCA9548A', 'К модулю переключателя I²C TCA9548A (CJMCU-9548, адрес 0x70 — A0–A2 на земле): 1 — VIN 3,3 В, 2 — земля, 3 — SCL, 4 — SDA. К его каналам: SD0/SC0 — SDP811-500Pa (горло сопла), SD1/SC1 — SDP811-125Pa (Ø65); каналы 2–3 — вторая турбина. Если на модуле нет подтяжек каналов — 4,7 кОм к 3,3 В на каждом', ['3V3', 'GND', 'SCL', 'SDA'], [114, 52, 90]),
    hdr(B, 'X15', 'BME280', 'К модулю BME280 (GY, 0x76): 1 — VIN 3,3 В, 2 — земля, 3 — SCL, 4 — SDA. Ставить снаружи коробки, в воздухе, который забирает турбина', ['3V3', 'GND', 'SCL', 'SDA'], [114, 64, 90]),
    R(B, 'R20', '4,7k', 'Подтяжка SDA', 'SDA', '3V3', [96, 52]),
    R(B, 'R21', '4,7k', 'Подтяжка SCL', 'SCL', '3V3', [96, 56]),
  );

  // --- температура (DS18B20) и ход клапанов (A3144) ---
  const T: Group = 'Температура и ход клапанов';
  add(
    hdr(T, 'X16', 'DS18B20 №1', 'Датчик температуры двигателя турбины 1: 1 — VDD 3,3 В, 2 — DQ, 3 — земля (красный, жёлтый, чёрный)', ['3V3', 'OW', 'GND'], [38, 84]),
    hdr(T, 'X17', 'DS18B20 №2', 'Датчик температуры двигателя турбины 2 (или второй точки) — та же линия 1-Wire', ['3V3', 'OW', 'GND'], [50, 84]),
    R(T, 'R22', '4,7k', 'Подтяжка линии 1-Wire', 'OW', '3V3', [44, 71]),
    hdr(T, 'X18', 'Холл 1', 'Датчик хода клапана 1 A3144 (магнит на подвижной части): 1 — VCC 5 В, 2 — OUT, 3 — земля', ['5V', 'HALL1', 'GND'], [86, 84]),
    hdr(T, 'X19', 'Холл 2', 'Датчик хода клапана 2 A3144: 1 — VCC 5 В, 2 — OUT, 3 — земля', ['5V', 'HALL2', 'GND'], [98, 84]),
    R(T, 'R23', '10k', 'Подтяжка выхода A3144 №1 к 3,3 В (выход — открытый коллектор)', 'HALL1', '3V3', [88, 74]),
    C(T, 'C18', '1 нФ', 'Фильтр датчика хода 1', 'HALL1', 'GND', [96, 70]),
    R(T, 'R24', '10k', 'Подтяжка выхода A3144 №2 к 3,3 В', 'HALL2', '3V3', [100, 74]),
    C(T, 'C19', '1 нФ', 'Фильтр датчика хода 2', 'HALL2', 'GND', [108, 70]),
  );

  // --- экран ILI9488 + XPT2046, подсветка через ключ, карта памяти ---
  const E: Group = 'Экран';
  add(
    hdr(E, 'X20', 'Экран ILI9488', 'Штыри 1×14 к экрану 3,5″ ILI9488/ST7796 SPI с касанием XPT2046 (порядок как у экрана): 1 VCC 5 В, 2 GND, 3 CS, 4 RESET, 5 DC, 6 SDI, 7 SCK, 8 LED (через ключ VT1), 9 SDO — не подключён (мешает касанию на общей шине), 10 T_CLK, 11 T_CS, 12 T_DIN, 13 T_DO, 14 T_IRQ. Кабель — не длиннее 15–20 см', ['5V', 'GND', 'LCD_CS', 'LCD_RST', 'LCD_DC', 'SPI_MOSI', 'SPI_SCK', 'LCD_LED', '', 'SPI_SCK', 'T_CS', 'SPI_MOSI', 'SPI_MISO', 'T_IRQ'], [76, 4]),
    hdr(E, 'X21', 'Карта экрана', 'К гнезду карты microSD на экране (4 вывода с другой стороны модуля): 1 — SD_CS, 2 — MOSI, 3 — MISO, 4 — SCK. Карта 4–32 ГБ, FAT32. По желанию', ['SD_CS', 'SPI_MOSI', 'SPI_MISO', 'SPI_SCK'], [76, 12]),
    R(E, 'R25', '10k', 'Сброс экрана: подтяжка', 'LCD_RST', '3V3', [68, 70]),
    R(E, 'R26', '10k', 'Подтяжка CS карты: карта молчит, пока ESP32 не запущен', 'SD_CS', '3V3', [68, 74]),
    { group: E, ref: 'VT1', value: 'S8550', description: 'Ключ подсветки экрана, PNP S8550 (TO-92): эмиттер — 3,3 В, коллектор — LED экрана; «0» на IO42 — горит, ШИМ — яркость', fp: 'Q_S8050_TO-92_Wide', pins: { E: '3V3', B: 'BL_B', C: 'LCD_LED' }, at: [84, 64] },
    R(E, 'R27', '1k', 'База ключа подсветки', 'LCD_BL', 'BL_B', [84, 58]),
    R(E, 'R28', '10k', 'База — эмиттер: подсветка выключена, пока ESP32 не запущен', 'BL_B', '3V3', [84, 54]),
  );

  // --- крепёж ---
  for (const [i, [x, y]] of [
    [3.5, 3.5],
    [116.5, 3.5],
    [3.5, 81.5],
    [116.5, 81.5],
  ].entries())
    add({ group: P, ref: `H${i + 1}`, value: '', description: 'Крепёжное отверстие M3', fp: 'MountingHole_3.2mm_M3', pins: {}, at: [x, y] });

  // --- выносные (на схеме и в перечне; на плате их нет) ---
  const off = (p: StandPart): StandPart => ({ ...p, offBoard: true });
  add(
    off({ group: S, ref: 'U1', value: 'МР248', description: 'Регулятор мощности турбины 1 (Мастер Кит, 8 кВт): управление — X10; сеть и турбина — к его клеммам. В разрыв фазы турбины — термовыключатель KSD301 (НЗ) на корпусе двигателя', fp: 'Module_MP248_Wires', pins: { VCC: '3V3', GND: 'GND', CTRL: 'PWM1' } }),
    off({ group: S, ref: 'U2', value: 'Диммер 2 канала', description: 'Модуль диммера RobotDyn на 2 канала (симисторы с детектором нуля): управление — X12, выходы — соленоиды клапанов 230 В (~0,8 А), на каждом RC-гаситель', fp: 'Module_Dimmer_2ch_Wires', pins: { VCC: '3V3', GND: 'GND', 'Z-C': 'ZC', D1: 'DIM1', D2: 'DIM2' } }),
    off({ group: I, ref: 'TA1', value: 'SCT-013-020', description: 'Ток турбины 1: фазный провод — через окно', fp: 'CT_SCT013_1V_Wires', pins: { S1: 'CT1_IN', S2: 'VMID' } }),
    off({ group: I, ref: 'U3', value: 'ZMPT101B', description: 'Модуль напряжения сети: 230 В — на его клеммник, выход — X13', fp: 'Module_ZMPT101B_Wires', pins: { VCC: '5V', OUT: 'UAC_IN', GND: 'GND' } }),
    off({ group: B, ref: 'U4', value: 'TCA9548A', description: 'Переключатель I²C на 8 каналов (CJMCU-9548), 0x70', fp: 'Module_TCA9548A_Wires', pins: { VIN: '3V3', GND: 'GND', SCL: 'SCL', SDA: 'SDA', SD0: 'SDA0', SC0: 'SCL0', SD1: 'SDA1', SC1: 'SCL1' } }),
    off({ group: B, ref: 'B3', value: 'SDP811-500Pa', description: 'Поток, полный диапазон: отборы — вход сопла Ø140 и горло Ø45–50; канал 0 TCA9548A', fp: 'Sensor_SDP810_Wires', pins: { VDD: '3V3', GND: 'GND', SCL: 'SCL0', SDA: 'SDA0' }, fields: { 'Где стоит': 'сопло, горло' } }),
    off({ group: B, ref: 'B4', value: 'SDP811-125Pa', description: 'Поток, малый расход: отборы — вход сопла Ø140 и Ø65; канал 1 TCA9548A', fp: 'Sensor_SDP810_Wires', pins: { VDD: '3V3', GND: 'GND', SCL: 'SCL1', SDA: 'SDA1' }, fields: { 'Где стоит': 'сопло, Ø65' } }),
    off({ group: B, ref: 'B5', value: 'BME280', description: 'Температура, влажность, давление воздуха (плотность для расхода; экран «Погода» в ожидании)', fp: 'Module_BME280_Wires', pins: { VIN: '3V3', GND: 'GND', SCL: 'SCL', SDA: 'SDA' } }),
    off({ group: T, ref: 'BK1', value: 'DS18B20', description: 'Температура двигателя турбины 1 (гильза под хомут на корпусе)', fp: 'Sensor_DS18B20_Wires', pins: { VDD: '3V3', DQ: 'OW', GND: 'GND' } }),
    off({ group: T, ref: 'BK2', value: 'DS18B20', description: 'Температура двигателя турбины 2', fp: 'Sensor_DS18B20_Wires', pins: { VDD: '3V3', DQ: 'OW', GND: 'GND' } }),
    off({ group: T, ref: 'BH1', value: 'A3144', description: 'Ход клапана 1 (магнит 5×2 мм на подвижной части)', fp: 'Sensor_A3144_Wires', pins: { VCC: '5V', OUT: 'HALL1', GND: 'GND' } }),
    off({ group: T, ref: 'BH2', value: 'A3144', description: 'Ход клапана 2', fp: 'Sensor_A3144_Wires', pins: { VCC: '5V', OUT: 'HALL2', GND: 'GND' } }),
    off({ group: E, ref: 'HG1', value: 'ILI9488 3,5″', description: 'Экран 3,5″ 480×320 SPI с касанием XPT2046 — к X20 кабелем 14 проводов', fp: 'Display_ILI9488_SPI_Wires', pins: { VCC: '5V', GND: 'GND', CS: 'LCD_CS', RESET: 'LCD_RST', DC: 'LCD_DC', SDI: 'SPI_MOSI', SCK: 'SPI_SCK', LED: 'LCD_LED', T_CLK: 'SPI_SCK', T_CS: 'T_CS', T_DIN: 'SPI_MOSI', T_DO: 'SPI_MISO', T_IRQ: 'T_IRQ' } }),
  );
  return out;
}

const BLOCKS: SchBlock[] = [
  { title: 'Питание и ESP32-S3', at: [10, 10], width: 150, parts: ['XT1', ['C1', 90], ['C2', 90], 'VD1', ['C3', 90], ['C4', 90], 'A1', 'X9'] },
  { title: 'Силовые модули (230 В — только на модулях)', at: [170, 10], width: 150, parts: ['X10', 'R1', ['R2', 90], 'U1', 'X11', 'R3', ['R4', 90], 'X12', 'R5', ['R6', 90], 'R7', ['R8', 90], ['C5', 90], 'U2'] },
  { title: 'Ток и напряжение сети', at: [330, 10], width: 150, parts: ['XT2', 'R10', ['C10', 90], 'R11', ['C11', 90], ['R12', 90], ['R13', 90], ['C12', 90], 'TA1', 'X13', 'R14', ['R15', 90], ['C13', 90], 'U3'] },
  { title: 'Давление', at: [10, 130], width: 150, parts: ['B1', ['C14', 90], 'R16', ['R17', 90], ['C15', 90], 'B2', ['C16', 90], 'R18', ['R19', 90], ['C17', 90]] },
  { title: 'I²C: сопло, воздух', at: [170, 130], width: 150, parts: ['X14', 'X15', ['R20', 90], ['R21', 90], 'U4', 'B3', 'B4', 'B5'] },
  { title: 'Температура и ход клапанов', at: [330, 130], width: 150, parts: ['X16', 'X17', ['R22', 90], 'BK1', 'BK2', 'X18', 'X19', ['R23', 90], ['C18', 90], ['R24', 90], ['C19', 90], 'BH1', 'BH2'] },
  { title: 'Экран', at: [10, 220], width: 300, parts: ['X20', 'X21', ['R25', 90], ['R26', 90], 'VT1', 'R27', ['R28', 90], 'HG1'] },
];

/** Плата стенда без дорожек: детали на местах, цепи, схема по разделам (поле «Раздел»). */
export function buildVacuumStand(): Project {
  const { w, h } = STAND_BOARD;
  const p = createProject({ name: 'Стенд турбины и ударов', width: w, height: h, copperLayers: 2, cornerRadius: 2 });
  p.meta.author = 'Plata';
  p.meta.description =
    'Стенд одной турбины пылесоса S3: ESP32-S3-DevKitC-1 N16R8, ШИМ к МР248, клапаны через диммер на 2 канала с нулём сети, ток SCT-013 (1 В), напряжение ZMPT101B, разрежение MPX5100DP, перепад MPXV7007DP, поток SDP811-500/125 через TCA9548A, BME280, DS18B20, датчики хода A3144, экран ILI9488 с касанием, подсветкой через ключ и картой памяти. Только 5 и 3,3 В: сеть — на модулях.';
  p.netClasses.Default = { ...p.netClasses.Default, trackWidth: 0.4, clearance: 0.3 };
  p.netClasses.Power = { ...p.netClasses.Power, trackWidth: 0.8, clearance: 0.3 };
  const parts = standParts();
  for (const name of ['GND', '5V', '5V_ESP', '3V3']) ensureNet(p, name, { netClass: 'Power', description: DESCRIPTIONS[name] });
  for (const part of parts) {
    const f0 = fpOf(part.fp);
    const at = part.at ?? [0, 0, 0];
    const c = addComponent(p, f0, { x: at[0], y: at[1] }, { ref: part.ref, value: part.value, description: part.description, rotation: at[2] ?? 0 });
    if (part.offBoard) c.offBoard = true;
    c.fields = { ...(part.fields ?? {}), Раздел: part.group };
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
  let x = 0;
  for (const c of Object.values(p.components))
    if (c.offBoard) {
      c.at = { x, y: -30 };
      x += 14;
    }
  addDrawing(p, { kind: 'text', layer: 'F.Silk', at: { x: 52, y: 80 }, text: 'Стенд S3 - турбина и удары', size: 1.4, thickness: 0.18, align: 'center' });
  layoutBlocks(p, BLOCKS);
  return structuredClone(p);
}

/** Таблица выводов ESP32-S3 для памятки и прошивки стенда. */
export function standPinTable(): string[] {
  return Object.entries(STAND_PINS).map(([pin, net]) => {
    const same = MOD_PINS[pin] === net ? '' : MOD_PINS[pin] ? ` (на плате пылесоса — ${MOD_PINS[pin]})` : '';
    return `${(pin === 'TX' ? 'IO43' : pin).padEnd(5)} ${net.padEnd(9)} ${DESCRIPTIONS[net] ?? ''}${same}`.trimEnd();
  });
}

const num = (n: number): [string, string][] => Array.from({ length: n }, (_, i) => [String(i + 1), String(i + 1)]);

/** Детали из библиотеки EasyEDA (LCSC) для выгрузки схемы: корпус подставится сам. */
const LCSC: Record<string, EasyedaPart> = {
  RES: { lcsc: 'C5618323', package: 'RES-TH_BD2.4-L6.3-P10.30-D0.6', puuid: '2915f1f0a54941d7b912decfe617b47f', pins: num(2) },
  CER: { lcsc: 'C154503', package: 'CAP-TH_L3.0-W2.0-P2.54-D0.7', puuid: '7d441db52cb04c809670ae39aac6b010', pins: num(2) },
  CER5: { lcsc: 'C94708', package: 'CAP-TH_L8.5-W5.0-P5.00-D1.2', puuid: '22b246ec12564337ab8a39d4c651a291', pins: num(2) },
  EL470: { lcsc: 'C49304896', package: 'CAP-TH_BD6.3-P2.50-D0.5-FD', puuid: '64a7f92837bb4510988b60872b0cfbf5', pins: num(2) },
  EL10: { lcsc: 'C49304949', package: 'CAP-TH_BD5.0-P2.00-D0.6-FD', puuid: 'd174dc03399042dd9fe60a9cfe46ef2e', pins: num(2) },
  DIODE: { lcsc: 'C145202', package: 'DO-41_BD2.4-L4.7-P8.70-D0.9-RD', puuid: 'c2803222ad4b48fb94db0de548a6280a', pins: [["1", "K"], ["2", "A"]] },
  PNP: { lcsc: 'C438620', package: 'TO-92-3_L4.9-W3.7-P1.27-L', puuid: '6924b36489de4921bb29ca14bf27c33f', pins: [["1", "E"], ["2", "B"], ["3", "C"]] },
  HDR3: { lcsc: 'C492402', package: 'HDR-TH_3P-P2.54-V-M', puuid: '5c0be672313e4206a41dd5398a02f108', pins: num(3) },
  HDR4: { lcsc: 'C492403', package: 'HDR-TH_4P-P2.54-V-M', puuid: '89f5280378144b629de4998ef974b6b8', pins: num(4) },
  HDR5: { lcsc: 'C492404', package: 'HDR-TH_5P-P2.54-V-M', puuid: '97560a62b45c46d5b6e85aaea1cd55a1', pins: num(5) },
  HDR14: { lcsc: 'C22465874', package: 'CONN-TH_PZ254V-11-14P', puuid: '6e9d594e09a640d99d6ec9996f01e352', pins: num(14) },
  KF2: { lcsc: 'C474881', package: 'CONN-TH_P5.00_KF301-5.0-2P', puuid: 'c444d117946441c3ab8b7492a6a9cd72', pins: num(2) },
  KF4: { lcsc: 'C3037697', package: 'CONN-TH_DEGSON_DG301-5.0-04P', puuid: 'ec06fee773004fe8baadf94fc9abbbe0', pins: num(4) },
  MPX: { lcsc: 'C459977', package: 'SENSOR-TH_MPX5100DP', puuid: '07b4ea30468a4bc5bdc882df749e9552', pins: [["1", "VOUT"], ["2", "GND"], ["3", "VS"], ["4", "DNC"], ["5", "DNC"], ["6", "DNC"]] },
  DIP8: { lcsc: 'C72124', package: 'DIP-8_L10.2-W10.2-P2.54-LS7.6-BL', puuid: '3f6ef94e1963401e9ceec09213ee59e4', pins: num(8) },
  DEVKIT: { lcsc: 'C9900309792', package: 'COMM-TH_ESP32-S3-DEVKITC-N16R8', puuid: '653b34eb7957444788845183be34a84f', pins: [["1", "3V3"], ["2", "3V3"], ["3", "RST"], ["4", "GPIO4"], ["5", "GPIO5"], ["6", "GPIO6"], ["7", "GPIO7"], ["8", "GPIO15"], ["9", "GPIO16"], ["10", "GPIO17"], ["11", "GPIO18"], ["12", "GPIO8"], ["13", "GPIO3"], ["14", "GPIO46"], ["15", "GPIO9"], ["16", "GPIO10"], ["17", "GPIO11"], ["18", "GPIO12"], ["19", "GPIO13"], ["20", "GPIO14"], ["21", "5V"], ["22", "GND"], ["23", "GND"], ["24", "GND"], ["25", "GPIO19"], ["26", "GPIO20"], ["27", "GPIO21"], ["28", "GPIO47"], ["29", "GPIO48"], ["30", "GPIO45"], ["31", "GPIO0"], ["32", "GPIO35"], ["33", "GPIO36"], ["34", "GPIO37"], ["35", "GPIO38"], ["36", "GPIO39"], ["37", "GPIO40"], ["38", "GPIO41"], ["39", "GPIO42"], ["40", "GPIO2"], ["41", "GPIO1"], ["42", "RXD"], ["43", "TXD"], ["44", "GND"]] },
};

/** Деталь EasyEDA для детали стенда (выносные — без корпуса: на плате их нет). */
export function standEasyedaPart(c: Component, p: Project): EasyedaPart | undefined {
  if (c.offBoard) return undefined;
  const id = p.footprints[c.footprint]?.id ?? '';
  if (id === RES) return LCSC.RES;
  if (id === CER) return LCSC.CER;
  if (id === CER5) return LCSC.CER5;
  if (id === EL) return /470/.test(c.value) ? LCSC.EL470 : LCSC.EL10;
  if (id.startsWith('D_DO-41')) return LCSC.DIODE;
  if (id.startsWith('Q_S8050')) return LCSC.PNP;
  if (id === 'TerminalBlock_1x02_P5mm') return LCSC.KF2;
  if (id === 'TerminalBlock_1x04_P5mm') return LCSC.KF4;
  if (id === 'Sensor_MPX5100DP') return LCSC.MPX;
  if (id.startsWith('DIP-8')) return LCSC.DIP8;
  if (id === 'Module_ESP32-S3_DevKitC-1') return LCSC.DEVKIT;
  const h = /^PinHeader_1x(\d+)_P2\.54mm$/.exec(id);
  if (h) return LCSC[`HDR${Number(h[1])}`];
  return undefined;
}
