import type { FootprintDef, Graphic, PadDef } from '../../model/types';
import { CAT } from '../categories';
import { dualRow, msop, qfp, soic, soicWide, sot23, tssop } from './smd';
import { dip } from './tht';
import { CRT_SMD, FAB_W, boxFootprint, courtyardAround, crtGraphic, fmtP, fp, line, poly, refText, rowX, smd, tht, valueText } from './util';

/* Микросхемы: DIP всех ширин, SOIC/SOP, TSSOP/SSOP/MSOP/QSOP, QFP/LQFP, QFN/DFN, оптроны. */

const G = { dip: 'DIP', soic: 'SOIC и SOP', tssop: 'TSSOP, SSOP, MSOP', qfp: 'QFP', qfn: 'QFN и DFN', opto: 'Оптроны', other: 'Прочие' };

/** DIP с произвольным расстоянием между рядами (7,62 / 10,16 / 15,24 / 22,86). */
function dipW(pins: number, rowPitch: number): FootprintDef {
  const n = pins / 2;
  const pads: PadDef[] = [];
  const y0 = -((n - 1) * 2.54) / 2;
  for (let i = 0; i < n; i++) pads.push(tht(String(i + 1), -rowPitch / 2, y0 + i * 2.54, 1.6, 1.6, 0.8, i === 0 ? 'rect' : 'oval'));
  for (let i = 0; i < n; i++) pads.push(tht(String(n + i + 1), rowPitch / 2, y0 + (n - 1 - i) * 2.54, 1.6, 1.6, 0.8, 'oval'));
  const bw = rowPitch - 1.3;
  const bl = n * 2.54 + 0.5;
  const crt = courtyardAround(pads, { x0: -bw / 2, y0: -bl / 2, x1: bw / 2, y1: bl / 2 }, 0.5);
  const g: Graphic[] = [
    poly('F.Fab', [{ x: -bw / 2 + 1, y: -bl / 2 }, { x: bw / 2, y: -bl / 2 }, { x: bw / 2, y: bl / 2 }, { x: -bw / 2, y: bl / 2 }, { x: -bw / 2, y: -bl / 2 + 1 }], FAB_W),
    line('F.Silk', { x: -bw / 2 - 0.1, y: -bl / 2 - 0.1 }, { x: bw / 2 + 0.1, y: -bl / 2 - 0.1 }),
    line('F.Silk', { x: -bw / 2 - 0.1, y: bl / 2 + 0.1 }, { x: bw / 2 + 0.1, y: bl / 2 + 0.1 }),
    line('F.Silk', { x: -bw / 2 - 0.1, y: -bl / 2 - 0.1 }, { x: -bw / 2 - 0.1, y: bl / 2 + 0.1 }),
    line('F.Silk', { x: bw / 2 + 0.1, y: -bl / 2 - 0.1 }, { x: bw / 2 + 0.1, y: bl / 2 + 0.1 }),
    { kind: 'arc', layer: 'F.Silk', c: { x: 0, y: -bl / 2 - 0.1 }, r: 1.0, start: 180, sweep: 180, width: 0.12 },
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(0, 0, 0.9),
  ];
  const w = { 7.62: 'узкий (0,3″)', 10.16: 'средний (0,4″)', 15.24: 'широкий (0,6″)', 22.86: '0,9″' }[rowPitch] ?? '';
  return fp({ id: `DIP-${pins}_W${rowPitch}mm`, name: `DIP-${pins}${rowPitch === 7.62 ? '' : rowPitch === 15.24 ? 'W' : ' ' + fmtP(rowPitch)}`, description: `DIP-${pins}, ряды ${fmtP(rowPitch)} мм ${w}`, category: CAT.U, group: G.dip, tags: ['tht', 'dip', 'ic', `dip${pins}`], refPrefix: 'U', pads, graphics: g, courtyard: crt, source: 'JEDEC MS-001/MS-011', verified: true, height: 4.5 });
}

/** DIP-панелька (те же отверстия, корпус шире) — для документации отдельным корпусом. */
function dipSocket(pins: number, rowPitch: number): FootprintDef {
  const d = dipW(pins, rowPitch);
  return { ...d, id: `DIP-${pins}_W${rowPitch}mm_Socket`, name: `Панелька DIP-${pins}${rowPitch === 15.24 ? 'W' : ''}`, description: `Панелька под DIP-${pins}, ряды ${fmtP(rowPitch)} мм (те же отверстия, корпус шире)`, tags: ['tht', 'dip', 'socket'], height: 8 };
}

/** SOP (EIAJ) с корпусом 5,3 мм, шаг 1,27. */
function sopEiaj(pins: 8 | 14 | 16 | 20 | 24 | 28): FootprintDef {
  const len = { 8: 5.3, 14: 10.3, 16: 10.3, 20: 12.8, 24: 15.4, 28: 18.0 }[pins];
  return { ...dualRow({ id: `SOP-${pins}_5.3x${len}mm_P1.27mm`, name: `SOP-${pins} (5,3)`, description: `SOP-${pins} EIAJ, корпус 5,3×${len} мм, шаг 1,27 мм (шире SOIC)`, pins, pitch: 1.27, body: [5.3, len], padSpan: 7.2, pad: [1.7, 0.6], verified: false, height: 2.0, tags: ['sop', 'eiaj'] }), group: G.soic, category: CAT.U };
}

function ssop(pins: 8 | 16 | 20 | 24 | 28): FootprintDef {
  const len = { 8: 3.0, 16: 6.2, 20: 7.2, 24: 8.2, 28: 10.2 }[pins];
  return { ...dualRow({ id: `SSOP-${pins}_5.3x${len}mm_P0.65mm`, name: `SSOP-${pins}`, description: `SSOP-${pins}, корпус 5,3×${len} мм, шаг 0,65 мм`, pins, pitch: 0.65, body: [5.3, len], padSpan: 7.2, pad: [1.75, 0.45], verified: false, height: 2.0, tags: ['ssop'] }), group: G.tssop, category: CAT.U };
}

function qsop(pins: 16 | 20 | 24 | 28): FootprintDef {
  const len = { 16: 4.9, 20: 8.65, 24: 8.65, 28: 9.9 }[pins];
  return { ...dualRow({ id: `QSOP-${pins}_3.9x${len}mm_P0.635mm`, name: `QSOP-${pins}`, description: `QSOP-${pins}, корпус 3,9×${len} мм, шаг 0,635 мм`, pins, pitch: 0.635, body: [3.9, len], padSpan: 5.4, pad: [1.55, 0.4], verified: false, height: 1.75, tags: ['qsop'] }), group: G.tssop, category: CAT.U };
}

function tssopWide(pins: 32 | 38 | 48): FootprintDef {
  const S = { 32: { body: 6.1, len: 11.0, pitch: 0.65 }, 38: { body: 4.4, len: 9.7, pitch: 0.5 }, 48: { body: 6.1, len: 12.5, pitch: 0.5 } }[pins];
  return { ...dualRow({ id: `TSSOP-${pins}_${S.body}x${S.len}mm_P${S.pitch}mm`, name: `TSSOP-${pins}`, description: `TSSOP-${pins}, корпус ${S.body}×${S.len} мм, шаг ${fmtP(S.pitch)} мм`, pins, pitch: S.pitch, body: [S.body, S.len], padSpan: S.body + 1.45, pad: [1.4, S.pitch === 0.5 ? 0.3 : 0.4], verified: false, height: 1.2, tags: ['tssop'] }), group: G.tssop, category: CAT.U };
}

/** QFN/DFN с открытой площадкой. Вывод 1 слева сверху, обход против часовой. */
function qfn(o: { pins: number; body: number; pitch: number; ep: number; name?: string; bodyY?: number }): FootprintDef {
  const perSide = o.pins / 4;
  const padLen = 0.8;
  const padW = Math.min(0.3, o.pitch * 0.55);
  const c = o.body / 2 + 0.1;
  const s0 = -((perSide - 1) * o.pitch) / 2;
  const pads: PadDef[] = [];
  let n = 1;
  for (let i = 0; i < perSide; i++) pads.push(smd(String(n++), -c, s0 + i * o.pitch, padLen, padW));
  for (let i = 0; i < perSide; i++) pads.push(smd(String(n++), s0 + i * o.pitch, c, padW, padLen));
  for (let i = 0; i < perSide; i++) pads.push(smd(String(n++), c, s0 + (perSide - 1 - i) * o.pitch, padLen, padW));
  for (let i = 0; i < perSide; i++) pads.push(smd(String(n++), s0 + (perSide - 1 - i) * o.pitch, -c, padW, padLen));
  if (o.ep > 0) pads.push(smd(String(n), 0, 0, o.ep, o.ep, 'rect', { name: 'EP' }));
  const b = o.body / 2;
  const crt = courtyardAround(pads, { x0: -b, y0: -b, x1: b, y1: b }, CRT_SMD);
  const k = Math.abs(s0) + o.pitch / 2 + 0.2;
  const g: Graphic[] = [poly('F.Fab', [{ x: -b + 0.5, y: -b }, { x: b, y: -b }, { x: b, y: b }, { x: -b, y: b }, { x: -b, y: -b + 0.5 }], FAB_W)];
  for (const [sx, sy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])
    g.push(line('F.Silk', { x: sx * (b + 0.15), y: sy * (b + 0.15) }, { x: sx * (b + 0.15), y: sy * k }), line('F.Silk', { x: sx * (b + 0.15), y: sy * (b + 0.15) }, { x: sx * k, y: sy * (b + 0.15) }));
  g.push(line('F.Silk', { x: -(b + 0.15), y: -k }, { x: -(b + 0.15) - 0.5, y: -k }, 0.2), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(0, 0, Math.min(0.9, o.body * 0.18)));
  const name = o.name ?? `QFN-${o.pins}`;
  return fp({ id: `${name}_${o.body}x${o.body}mm_P${o.pitch}mm${o.ep ? '_EP' : ''}`, name, description: `${name}, корпус ${o.body}×${o.body} мм, шаг ${fmtP(o.pitch)} мм${o.ep ? `, открытая площадка ${o.ep}×${o.ep} мм (вывод ${o.pins + 1})` : ''}`, category: CAT.U, group: G.qfn, tags: ['smd', 'qfn', 'ic'], refPrefix: 'U', pads, graphics: g, courtyard: crt, source: 'Типовые размеры JEDEC MO-220', verified: false, height: 0.9 });
}

/** DFN двухрядный с открытой площадкой. */
function dfn(o: { pins: number; body: [number, number]; pitch: number; ep: [number, number] }): FootprintDef {
  const n = o.pins / 2;
  const s0 = -((n - 1) * o.pitch) / 2;
  const c = o.body[0] / 2 + 0.1;
  const padW = Math.min(0.35, o.pitch * 0.55);
  const pads: PadDef[] = [];
  for (let i = 0; i < n; i++) pads.push(smd(String(i + 1), -c, s0 + i * o.pitch, 0.8, padW));
  for (let i = 0; i < n; i++) pads.push(smd(String(n + i + 1), c, s0 + (n - 1 - i) * o.pitch, 0.8, padW));
  pads.push(smd(String(o.pins + 1), 0, 0, o.ep[0], o.ep[1], 'rect', { name: 'EP' }));
  return boxFootprint({ id: `DFN-${o.pins}_${o.body[0]}x${o.body[1]}mm_P${o.pitch}mm_EP`, name: `DFN-${o.pins} ${o.body[0]}×${o.body[1]}`, description: `DFN-${o.pins}, корпус ${o.body[0]}×${o.body[1]} мм, шаг ${fmtP(o.pitch)} мм, открытая площадка`, category: CAT.U, group: G.qfn, refPrefix: 'U', pads, body: { x0: -o.body[0] / 2, y0: -o.body[1] / 2, x1: o.body[0] / 2, y1: o.body[1] / 2 }, smd: true, pin1Mark: { x: -o.body[0] / 2 - 0.9, y: s0 }, verified: false, height: 0.8, tags: ['dfn', 'ic'] });
}

/** Оптроны: DIP-4/6/8 и планарный «мини-флэт» SOP-4 (PC817 SMD) с шагом 2,54. */
function optoSop4(): FootprintDef {
  const pads = [smd('1', -3.3, 1.27, 2.0, 1.2), smd('2', -3.3, -1.27, 2.0, 1.2), smd('3', 3.3, -1.27, 2.0, 1.2), smd('4', 3.3, 1.27, 2.0, 1.2)];
  return boxFootprint({ id: 'Opto_SOP-4_P2.54mm_PC817S', name: 'Оптрон SOP-4 (PC817 SMD)', description: 'Оптрон в планарном корпусе SOP-4 (PC817S, EL817S), выводы с шагом 2,54 мм, размах 7 мм', category: CAT.U, group: G.opto, refPrefix: 'U', pads, body: { x0: -2.25, y0: -1.9, x1: 2.25, y1: 1.9 }, smd: true, pin1Mark: { x: -2.25, y: 2.4 }, verified: false, height: 2.5, tags: ['optocoupler', 'pc817'] });
}

export function allIcs(): FootprintDef[] {
  const out: FootprintDef[] = [];
  for (const n of [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28]) out.push(dipW(n, 7.62));
  for (const n of [22, 24, 28, 32]) out.push(dipW(n, 10.16));
  for (const n of [24, 28, 32, 40, 42, 48, 64]) out.push(dipW(n, 15.24));
  out.push(dipW(64, 22.86));
  for (const n of [8, 14, 16, 18, 20, 28]) out.push(dipSocket(n, 7.62));
  out.push(dipSocket(40, 15.24));
  for (const n of [8, 14, 16, 20] as const) out.push({ ...soic(n), group: G.soic });
  out.push({ ...dualRow({ id: 'SOIC-18_7.5x11.6mm_P1.27mm', name: 'SOIC-18W', description: 'SOIC-18 широкий, корпус 7,5×11,6 мм', pins: 18, pitch: 1.27, body: [7.5, 11.6], padSpan: 9.3, pad: [1.6, 0.6], verified: false, height: 2.65 }), group: G.soic }, { ...dualRow({ id: 'SOIC-24_3.9x15.4mm_P1.27mm', name: 'SOIC-24', description: 'SOIC-24 узкий, корпус 3,9×15,4 мм', pins: 24, pitch: 1.27, body: [3.9, 15.4], padSpan: 5.4, pad: [1.55, 0.6], verified: false }), group: G.soic });
  for (const n of [16, 20, 24, 28] as const) out.push({ ...soicWide(n), group: G.soic });
  for (const n of [8, 14, 16, 20, 24, 28] as const) out.push(sopEiaj(n));
  out.push({ ...dualRow({ id: 'SOIC-8_5.23x5.23mm_P1.27mm_EIAJ', name: 'SOP-8 (5,23)', description: 'SOP-8 EIAJ 5,23 мм — память SPI-flash и т. п.', pins: 8, pitch: 1.27, body: [5.23, 5.23], padSpan: 7.2, pad: [1.75, 0.6], verified: false, height: 2.0, tags: ['sop', 'flash'] }), group: G.soic });
  for (const n of [8, 14, 16, 20, 24, 28] as const) out.push({ ...tssop(n), group: G.tssop });
  out.push(tssopWide(32), tssopWide(38), tssopWide(48));
  for (const n of [8, 16, 20, 24, 28] as const) out.push(ssop(n));
  for (const n of [16, 20, 24, 28] as const) out.push(qsop(n));
  out.push({ ...msop(8), group: G.tssop }, { ...msop(10), group: G.tssop });
  // SOT-23-5 и SOT-23-6: стабилизаторы, преобразователи, мелкая логика.
  out.push({ ...sot23('SOT-23-5'), category: CAT.U, group: G.tssop }, { ...sot23('SOT-23-6'), category: CAT.U, group: G.tssop });
  out.push({ ...dualRow({ id: 'SOT-23-8', name: 'SOT-23-8', description: 'SOT-23-8 (TSOT-8), корпус 2,9×1,6 мм, шаг 0,65 мм', pins: 8, pitch: 0.65, body: [1.6, 2.9], padSpan: 2.6, pad: [1.0, 0.4], verified: false, height: 1.0, tags: ['sot-23-8'] }), group: G.tssop });
  out.push(
    { ...qfp({ pins: 32, body: 7, pitch: 0.8, leadSpan: 9, verified: true }), group: G.qfp },
    { ...qfp({ pins: 44, body: 10, pitch: 0.8, leadSpan: 12, verified: true }), group: G.qfp },
    { ...qfp({ pins: 48, body: 7, pitch: 0.5, leadSpan: 9, verified: true }), group: G.qfp },
    { ...qfp({ pins: 64, body: 10, pitch: 0.5, leadSpan: 12, verified: true }), group: G.qfp },
    { ...qfp({ pins: 64, body: 14, pitch: 0.8, leadSpan: 16, name: 'LQFP-64' }), group: G.qfp },
    { ...qfp({ pins: 80, body: 12, pitch: 0.5, leadSpan: 14, name: 'LQFP-80' }), group: G.qfp },
    { ...qfp({ pins: 100, body: 14, pitch: 0.5, leadSpan: 16, name: 'LQFP-100' }), group: G.qfp },
    { ...qfp({ pins: 144, body: 20, pitch: 0.5, leadSpan: 22, name: 'LQFP-144' }), group: G.qfp },
    { ...qfp({ pins: 44, body: 10, pitch: 0.8, leadSpan: 12, name: 'PQFP-44' }), group: G.qfp },
  );
  out.push(
    qfn({ pins: 16, body: 3, pitch: 0.5, ep: 1.7 }),
    qfn({ pins: 16, body: 4, pitch: 0.65, ep: 2.1 }),
    qfn({ pins: 20, body: 4, pitch: 0.5, ep: 2.6 }),
    qfn({ pins: 24, body: 4, pitch: 0.5, ep: 2.6 }),
    qfn({ pins: 28, body: 5, pitch: 0.5, ep: 3.2 }),
    qfn({ pins: 32, body: 5, pitch: 0.5, ep: 3.6 }),
    qfn({ pins: 40, body: 6, pitch: 0.5, ep: 4.4 }),
    qfn({ pins: 48, body: 7, pitch: 0.5, ep: 5.4 }),
    qfn({ pins: 56, body: 8, pitch: 0.5, ep: 6.2 }),
    qfn({ pins: 64, body: 9, pitch: 0.5, ep: 7.2 }),
    dfn({ pins: 6, body: [2, 2], pitch: 0.65, ep: [1.0, 1.4] }),
    dfn({ pins: 8, body: [2, 2], pitch: 0.5, ep: [0.9, 1.5] }),
    dfn({ pins: 8, body: [3, 3], pitch: 0.65, ep: [1.6, 2.4] }),
    dfn({ pins: 10, body: [3, 3], pitch: 0.5, ep: [1.6, 2.4] }),
    dfn({ pins: 12, body: [3, 3], pitch: 0.5, ep: [1.6, 2.4] }),
    dfn({ pins: 16, body: [3, 4], pitch: 0.5, ep: [1.6, 3.4] }),
  );
  // Оптроны.
  for (const n of [4, 6, 8]) out.push({ ...dip(n), id: `Opto_DIP-${n}_W7.62mm`, name: `Оптрон DIP-${n}`, description: `Оптрон в корпусе DIP-${n} (PC817, MOC3021, 6N137…), ряды 7,62 мм`, category: CAT.U, group: G.opto, tags: ['tht', 'dip', 'optocoupler'] });
  out.push(optoSop4(), { ...soic(8), id: 'Opto_SOIC-8', name: 'Оптрон SOIC-8', description: 'Оптрон в корпусе SOIC-8 (6N137S, HCPL-…)', category: CAT.U, group: G.opto, tags: ['smd', 'optocoupler'] });
  // Прочие.
  out.push(
    boxFootprint({ id: 'TO-92_Regulator_78L05', name: 'TO-92 стабилизатор', description: 'Стабилизатор 78L05 / 79L05 в TO-92 (выводы OUT, GND, IN в линию, шаг 1,27 мм)', category: CAT.U, group: G.other, refPrefix: 'U', pads: rowX(3, 1.27, (i, x) => tht(String(i + 1), x, 0, 1.05, 1.5, 0.75, 'oval', { name: ['OUT', 'GND', 'IN'][i] })), body: { x0: -2.3, y0: -1.4, x1: 2.3, y1: 2.3 }, verified: true, height: 5, tags: ['to-92', 'regulator'] }),
    boxFootprint({ id: 'TO-220_Regulator_7805', name: 'TO-220 стабилизатор', description: 'Стабилизатор 7805 / LM317 в TO-220 (IN, GND, OUT для 78xx), шаг 2,54 мм, вертикально', category: CAT.U, group: G.other, refPrefix: 'U', pads: rowX(3, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.8, 2.6, 1.0, i === 0 ? 'rect' : 'oval', { name: ['IN', 'GND', 'OUT'][i] })), body: { x0: -5.2, y0: -4.0, x1: 5.2, y1: 0.4 }, verified: true, height: 16, tags: ['to-220', 'regulator'] }),
    boxFootprint({ id: 'TO-3_Metal', name: 'TO-3', description: 'TO-3 металлический (2N3055, LM338K): два вывода через 10,9 мм и два крепёжных отверстия Ø4 через 30,1 мм', category: CAT.U, group: G.other, refPrefix: 'Q', pads: [tht('1', -5.45, 4.9, 2.6, 2.6, 1.3, 'rect', { name: 'B' }), tht('2', 5.45, 4.9, 2.6, 2.6, 1.3, 'circle', { name: 'E' }), { number: 'C', name: 'C', type: 'tht', shape: 'circle', at: { x: -15.05, y: 0 }, size: { x: 6.5, y: 6.5 }, drill: 4.2 }, { number: 'C2', name: 'C', type: 'tht', shape: 'circle', at: { x: 15.05, y: 0 }, size: { x: 6.5, y: 6.5 }, drill: 4.2 }], body: { x0: -19.5, y0: -12.7, x1: 19.5, y1: 12.7 }, verified: false, height: 12, tags: ['to-3'] }),
  );
  return out;
}
