import { libraryFootprint } from '../../library';
import type { FootprintDef } from '../../model/types';
import { S3_PARTS, type VacPart } from './parts';

/*
 * Пылесос S3 на выводных деталях — для ЛУТ и ручной расстановки. Схема та же, меняются корпуса:
 * резисторы и конденсаторы — выводные, диоды — DO-35/DO-41/DO-15/DO-201, транзисторы — TO-92,
 * ключи магнитов — IRLZ44N в TO-220, расширитель PCA9555 — на переходнике SO-24 → DIP-24.
 * Для деталей без выводного корпуса — готовые платы: ESP32-S3-DevKitC-1 вместо модуля (USB,
 * сброс, загрузка и стабилизатор 3,3 В уже на ней) и понижающий модуль MP1584 вместо AP63205.
 */

/** Выводы переходника SO-24 → DIP-24 (номера совпадают с корпусом SO-24 PCA9555). */
const PCA9555_PINS = ['INT', 'A1', 'A2', 'P00', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'GND', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'A0', 'SCL', 'SDA', 'VCC'];

function named(baseId: string, id: string, name: string, description: string, names: string[], tags: string[]): FootprintDef {
  const base = libraryFootprint(baseId);
  if (!base) throw new Error(`нет корпуса ${baseId}`);
  const f = structuredClone(base);
  f.id = id;
  f.name = name;
  f.description = description;
  f.tags = [...(f.tags ?? []), ...tags];
  for (const pad of f.pads) {
    const i = Number(pad.number) - 1;
    if (names[i]) pad.name = names[i];
  }
  return f;
}

/** Свои корпуса варианта на выводных деталях. */
export const S3_DIP_FOOTPRINTS: FootprintDef[] = [
  named('DIP-24_W15.24mm', 'IC_PCA9555_DIP-24_Adapter', 'PCA9555 на переходнике SO-24 → DIP-24', 'PCA9555D/TCA9555 в SO-24, запаянный на переходник SOIC-24 → DIP-24 (600 mil); выводы как у SO-24', PCA9555_PINS, ['pca9555', 'tca9555', 'i2c', 'expander']),
  named('TO-92_Inline_Wide', 'Q_S8050_TO-92_Wide', 'S8050 (TO-92, широкий шаг)', 'NPN S8050/2N2222/BC337 в TO-92 с выводами, разведёнными на 2,54 мм — удобно для ЛУТ: 1 — эмиттер, 2 — база, 3 — коллектор (сверить с корпусом: у BC337 и 2N2222 порядок бывает другим)', ['E', 'B', 'C'], ['transistor', 's8050', 'npn']),
  named('TO-220-3_Vertical', 'Q_IRLZ44N_TO-220', 'IRLZ44N (TO-220)', 'N-канальный MOSFET с логическим уровнем IRLZ44N (55 В, открыт от 3,3 В): 1 — затвор, 2 — сток, 3 — исток', ['G', 'D', 'S'], ['mosfet', 'irlz44n']),
];

const RES = 'R_Axial_0.25W_L6.3mm_D2.5mm_P10.16mm_Horizontal';
const CER = 'C_Disc_D5mm_W2.5mm_P2.5mm';
const ELEC = 'CP_Radial_D5mm_P2mm';

/** Детали, которые на готовой плате DevKitC-1 или в модуле MP1584 уже есть. */
const DROP = new Set(['DA2', 'C2', 'C3', 'L1', 'R4', 'C15', 'SB10', 'SB11', 'X6', 'VD5', 'R6', 'R7', 'VD6']);

/** Обозначения цепей USB, сброса и загрузки — остаются только на DevKitC-1. */
const A1_DROP = new Set(['EN', 'IO0', 'IO19', 'IO20']);

function dipOf(part: VacPart): VacPart | null {
  if (part.offBoard || DROP.has(part.ref)) return part.offBoard ? part : null;
  const p: VacPart = { ...part, pins: { ...part.pins } };
  const note = (s: string) => (p.description = `${part.description}. ${s}`);
  switch (part.ref) {
    case 'A1':
      p.value = 'ESP32-S3-DevKitC-1-N8';
      p.fp = 'Module_ESP32-S3_DevKitC-1';
      p.description =
        'Плата ESP32-S3-DevKitC-1-N8 или N16 (без PSRAM R8: IO35–IO37 — реле) на штырях 2×22: USB для прошивки, кнопки сброса и загрузки и стабилизатор 3,3 В — на ней. Питание — 5 В с платы на вывод 5V; 3,3 В для датчиков и расширителя берётся с её вывода 3V3';
      p.pins = { GND: 'GND', '3V3': '3V3', '5V': '5V' };
      for (const [pin, net] of Object.entries(part.pins)) if (/^IO\d+$/.test(pin) && !A1_DROP.has(pin)) p.pins[pin] = net;
      return p;
    case 'DA1':
      p.value = 'MP1584 (модуль)';
      p.fp = 'Module_MP1584_Mini_Buck';
      p.description = 'Понижающий модуль MP1584 (или LM2596): вход — после выпрямителя, выход — 5 В 2 А. Перед установкой выставить подстроечником 5,0 В';
      p.pins = { 'IN+': 'VIN', 'IN-': 'GND', 'OUT+': '5V', 'OUT-': 'GND' };
      return p;
    case 'DD1':
      p.fp = 'IC_PCA9555_DIP-24_Adapter';
      note('Корпус SO-24 — на переходнике SOIC-24 → DIP-24 (600 mil), в панельку');
      return p;
    case 'VT5':
    case 'VT6':
      p.value = 'IRLZ44N';
      p.fp = 'Q_IRLZ44N_TO-220';
      p.description = part.description.replace(/SI2308[^:]*: N-канальный 60 В 2 А \(SOT-23\)/, 'IRLZ44N (TO-220, 55 В, логический уровень)');
      return p;
    case 'VD7':
    case 'VD8':
      p.value = 'P6KE33A';
      p.fp = 'D_DO-15_P10.16mm_Horizontal';
      p.description = part.description.replace('TVS 30 В', 'TVS P6KE33A (DO-15)').replace('~33 В', '~45 В');
      return p;
    case 'VD1':
      p.value = '1N5822';
      p.fp = 'D_DO-201_P12.7mm_Horizontal';
      note('Шоттки 3 А 40 В в DO-201AD');
      return p;
    case 'F2':
      p.value = 'MF-R075';
      p.fp = 'Fuse_Radial_PTC_P5.08mm';
      note('Выводной самовосстанавливающийся MF-R075 (0,75 А)');
      return p;
    case 'R65':
      p.fp = 'R_Axial_1W_L11mm_D4mm_P15.24mm_Horizontal';
      note('Выводной 1 Вт');
      return p;
    case 'R14':
    case 'R15':
      p.fp = 'R_Axial_0.5W_L9mm_D3.2mm_P12.7mm_Horizontal';
      note('Выводной 0,5 Вт (на 400 В)');
      return p;
    case 'HL1':
      p.fp = 'LED_D3.0mm';
      return p;
  }
  if (part.fp === 'Q_AO3400_SOT-23' || part.fp === 'Q_MMBT3904_SOT-23') {
    // Ключи реле и детектор нуля — NPN в TO-92 (затвор → база: резистор 1 кОм в базе, 2,6 мА).
    p.value = 'S8050';
    p.fp = 'Q_S8050_TO-92_Wide';
    const pin = part.pins;
    p.pins = pin.G ? { B: pin.G, E: pin.S, C: pin.D } : { B: pin.B, E: pin.E, C: pin.C };
    if (pin.G) p.description = `${part.description} — NPN S8050 (до 0,5 А), резистор в затворе стал резистором в базе`;
    return p;
  }
  const jst = /^JST_PH_B(\d)B-PH-A_1x0\d_P2mm_Vertical$/.exec(part.fp);
  if (jst) {
    // Шаг 2 мм для ЛУТ мелковат — разъёмы XH (2,5 мм); кабели датчиков — с такими же разъёмами.
    p.fp = `JST_XH_B${jst[1]}B-XH-A_1x0${jst[1]}_P2.5mm_Vertical`;
    note('Разъём JST XH (шаг 2,5 мм) вместо PH');
    return p;
  }
  if (part.fp === 'D_SOD-123') {
    p.value = '1N4148';
    p.fp = 'D_DO-35_P7.62mm_Horizontal';
    return p;
  }
  if (/^R_\d{4}_/.test(part.fp)) {
    p.fp = RES;
    return p;
  }
  if (/^C_\d{4}_/.test(part.fp)) {
    const uf = /(\d+(?:[.,]\d+)?)\s*мкФ/.exec(part.value);
    p.fp = uf && parseFloat(uf[1].replace(',', '.')) >= 10 ? ELEC : CER;
    return p;
  }
  return p;
}

/** Детали варианта на выводных корпусах (выносные — как есть). */
export function s3DipParts(): VacPart[] {
  return S3_PARTS.map(dipOf).filter((p): p is VacPart => !!p);
}
