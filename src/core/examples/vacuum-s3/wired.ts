import { addComponent, connectPad, ensureNet } from '../../model/edit';
import { createProject } from '../../model/project';
import type { Project } from '../../model/types';
import { MOD_PINS, footprintOf, modParts, type ModPart } from './mod';

/*
 * Пылесос S3 навесным монтажом (без платы): те же модули и та же мелочь, что на плате на модулях
 * (mod.ts), но:
 *  - питание — сетевой блок 5 В 3 А (вместо трансформатора, моста, накопителя и MP1584);
 *  - ноль и напряжение сети — модуль ZMPT101B: его выход через делитель 10 кОм / 20 кОм идёт сразу
 *    на IO7 (АЦП — напряжение) и IO48 (цифровой вход — ноль, меандр 50 Гц); детектора на плате нет;
 *  - термисторы турбин — на АЦП ADS1115 (I²C 0x48, ADDR на земле): A0 — турбина 1, A1 — турбина 2
 *    (делители 10 кОм от 3,3 В те же);
 *  - клеммников и разъёмов платы нет — провода от модуля к модулю.
 * Прошивка 6.1 узнаёт это сама: меандр на IO48 — ZMPT, переменное на IO7 — напряжение сети, ADS1115
 * на шине — термисторы с него. Проект — для симуляции и памятки по монтажу.
 */

/** Выводы ESP32-S3 навесного варианта: как на плате, кроме IO7 и IO48 (оба — с делителя ZMPT101B). */
export const WIRED_PINS: Record<string, string> = { ...MOD_PINS, IO7: 'UAC', IO48: 'UAC' };

/** Платы нет: детали питания с трансформатором, детектор нуля, клеммники, разъёмы и крепёж — не нужны. */
const DROP = new Set(['XT1', 'XT2', 'XT3', 'XT4', 'XT5', 'VDS1', 'VD1', 'C1', 'TV1', 'DA1', 'R1', 'R2', 'R3', 'VT1', 'X1', 'X2', 'X10', 'X11', 'X12', 'X13', 'X14', 'X15', 'X20', 'X21', 'X22', 'X23', 'X24', 'X25', 'H1', 'H2', 'H3', 'H4']);

const R = (ref: string, value: string, description: string, a: string, b: string): ModPart => ({ ref, value, description, fp: 'R_Axial_0.25W_L6.3mm_D2.5mm_P7.62mm_Horizontal', pins: { '1': a, '2': b } });
const C = (ref: string, value: string, description: string, a: string, b: string): ModPart => ({ ref, value, description, fp: 'C_Disc_D5mm_W2.5mm_P2.5mm', pins: { '1': a, '2': b } });

export function wiredParts(): ModPart[] {
  const out: ModPart[] = [];
  for (const p0 of modParts()) {
    if (DROP.has(p0.ref)) continue;
    // «Выносные» — как на плате на модулях (модули, датчики, сеть); мелочь и ESP32 — нет: симуляция
    // ищет контроллер и обвязку электродов среди деталей не выносных.
    const p: ModPart = { ...p0, pins: { ...p0.pins }, labels: undefined };
    delete p.at;
    if (p.ref === 'A1') {
      p.pins = { GND: 'GND', '3V3': '3V3', '5V': '5V', ...WIRED_PINS };
      p.description = 'Плата ESP32-S3-DevKitC-1 (N8R8 или N16R8): питание 5 В на вывод 5V от блока питания, 3,3 В для датчиков — с её вывода 3V3. IO35–IO37 у плат с PSRAM 8 МБ заняты, не используются';
    }
    if (p.ref === 'FU1') p.description = 'Предохранитель 0,5–1 А с задержкой в держателе: вход блока питания 5 В';
    out.push(p);
  }
  out.push(
    { ref: 'U4', value: '5 В 3 А', description: 'Сетевой блок питания 230 → 5 В 3 А: L — после предохранителя FU1, N; выход +V — на 5V платы ESP32 и модулей, −V — на землю', fp: 'Module_PSU_230V_5V_Wires', pins: { L: 'L_F', N: 'N', '+V': '5V', '-V': 'GND' }, offBoard: true },
    { ref: 'U5', value: 'ZMPT101B', description: 'Модуль напряжения сети ZMPT101B: сеть L, N — на его винтовой клеммник (после выключателя SA1); VCC — 5 В, OUT — через делитель на IO7 и IO48. Подстроечником — 0,3…0,45 В действующего на IO7 (команда «mains»), синус не должен упираться', fp: 'Module_ZMPT101B_Wires', pins: { VCC: '5V', OUT: 'UAC_IN', GND: 'GND' }, offBoard: true },
    R('R70', '10k', 'Делитель ZMPT101B 5 → 3,3 В: верхнее плечо (OUT модуля → IO7 и IO48)', 'UAC_IN', 'UAC'),
    R('R71', '20k', 'Делитель ZMPT101B: нижнее плечо (IO7 и IO48 → земля)', 'UAC', 'GND'),
    C('C26', '1 нФ', 'Фильтр помех на IO7/IO48 (больше не ставить: сдвинет ноль)', 'UAC', 'GND'),
    { ref: 'DD4', value: 'ADS1115 (модуль)', description: 'АЦП ADS1115 (I²C 0x48): VDD — 3,3 В, GND, SCL, SDA — к шине датчиков, ADDR — на GND, ALRT — не подключать; A0 — термистор турбины 1, A1 — турбины 2, A2 и A3 — запас', fp: 'Module_ADS1115_Wires', pins: { VDD: '3V3', GND: 'GND', SCL: 'SCL', SDA: 'SDA', ADDR: 'GND', A0: 'NTC1', A1: 'NTC2' }, offBoard: true },
  );
  for (const p of out) if (/^R2[56]$/.test(p.ref)) p.description = `Делитель термистора турбины ${p.ref === 'R25' ? 1 : 2}: 3,3 В → вход ${p.ref === 'R25' ? 'A0' : 'A1'} ADS1115`;
  return out;
}

/**
 * Навесной вариант: детали и цепи без платы и дорожек. firmware — ядро прошивки в
 * WebAssembly (firmware/vacuum-s3), panel — интерфейс экрана (firmware/vacuum-panel).
 */
export function buildVacuumS3Wired(firmware?: { name: string; wasm: string }, panel?: { name: string; wasm: string }): Project {
  const p = createProject({ name: 'Пылесос S3 навесным монтажом', width: 100, height: 60, copperLayers: 2 });
  p.meta.author = 'Plata';
  p.meta.description =
    'Контроллер пылесоса S3 без платы, навесным монтажом: ESP32-S3-DevKitC-1, блок питания 5 В 3 А, ZMPT101B (ноль и напряжение сети на IO48 и IO7), ADS1115 (термисторы), PCA9555, модули реле 30 А, МР248, SSR G3MB, SCT-013 (1 В), датчики и экран ILI9488.';
  let x = 0;
  for (const part of wiredParts()) {
    const c = addComponent(p, footprintOf(part.fp), { x, y: -30 }, { ref: part.ref, value: part.value, description: part.description });
    x += 12;
    if (part.offBoard) c.offBoard = true;
    if (part.fields) c.fields = { ...part.fields };
    if (!part.value) c.hideValue = true;
    const f = p.footprints[c.footprint];
    for (const [pin, net] of Object.entries(part.pins)) {
      const byName = f.pads.filter((q) => q.type !== 'npth' && q.name === pin);
      const pads = byName.length ? byName : f.pads.filter((q) => q.number === pin);
      if (!pads.length) throw new Error(`${part.ref}: нет вывода ${pin}`);
      const n = ensureNet(p, net);
      for (const q of pads) connectPad(p, c.id, q.number, n.id);
    }
  }
  if (firmware) {
    p.firmware = { name: firmware.name, hex: '', mcu: 'esp32', wasm: firmware.wasm };
    if (panel) p.firmware.modules = { HG1: { name: panel.name, wasm: panel.wasm } };
  }
  return structuredClone(p);
}
