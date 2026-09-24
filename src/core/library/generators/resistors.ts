import type { FootprintDef, Graphic, PadDef } from '../../model/types';
import { CAT } from '../categories';
import { CHIP_SPECS, chip } from './smd';
import { axialResistor } from './tht';
import { CRT_SMD, CRT_THT, FAB_W, SILK_W, boxFootprint, circle, courtyardAround, crtGraphic, fmtP, fp, line, rect, refText, rowX, smd, tht, twoPadSmd, twoPinTht, valueText } from './util';

/* Резисторы: SMD, сборки, выводные (горизонтально и стоя), мощные, SIP, подстроечные, переменные, термо- и фоторезисторы. */

const G = {
  smd: 'SMD чип',
  arr: 'Сборки SMD',
  axial: 'Выводные горизонтально',
  vert: 'Выводные вертикально',
  power: 'Мощные и цементные',
  sip: 'Сборки SIP',
  trim: 'Подстроечные',
  pot: 'Переменные',
  ntc: 'Терморезисторы и фоторезисторы',
};

/** Резисторная сборка 4×0603 или 4×0402 (выпуклые выводы), 8 площадок. */
function resistorArray(kind: '4x0603' | '4x0402' | '4x0402_2x'): FootprintDef {
  const S = kind === '4x0603' ? { pitch: 0.8, span: 2.5, pad: [0.5, 1.0] as [number, number], body: [3.2, 1.6] as [number, number] } : { pitch: 0.5, span: 1.5, pad: [0.3, 0.6] as [number, number], body: [2.0, 1.0] as [number, number] };
  const pads: PadDef[] = [];
  const x0 = -(3 * S.pitch) / 2;
  for (let i = 0; i < 4; i++) pads.push(smd(String(i + 1), x0 + i * S.pitch, S.span / 2, S.pad[0], S.pad[1]));
  for (let i = 0; i < 4; i++) pads.push(smd(String(8 - i), x0 + i * S.pitch, -S.span / 2, S.pad[0], S.pad[1]));
  const [L, W] = S.body;
  const crt = courtyardAround(pads, { x0: -L / 2, y0: -W / 2, x1: L / 2, y1: W / 2 }, CRT_SMD);
  return fp({
    id: `R_Array_Convex_${kind}`,
    name: `Сборка ${kind.replace('x', '×')}`,
    description: `Резисторная сборка ${kind.replace('x', '×')}, 8 выводов, выпуклые. Вывод 1 слева снизу, обход против часовой`,
    category: CAT.R,
    group: G.arr,
    tags: ['smd', 'array', 'network'],
    refPrefix: 'RN',
    pads,
    graphics: [rect('F.Fab', -L / 2, -W / 2, L / 2, W / 2, FAB_W), line('F.Silk', { x: -L / 2 - 0.1, y: W / 2 + 0.6 }, { x: -L / 2 + 0.6, y: W / 2 + 0.6 }, 0.15), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)],
    courtyard: crt,
    source: 'Типовые размеры (Yageo YC164/YC124)',
    verified: false,
    height: 0.6,
  });
}

/** Резистор с осевыми выводами, стоя: один вывод согнут вниз рядом с корпусом. */
function axialVertical(o: { power: string; body: [number, number]; pitch: number; drill?: number; pad?: number }): FootprintDef {
  const drill = o.drill ?? (o.body[1] > 3 ? 1.0 : 0.8);
  const pad = o.pad ?? (o.body[1] > 3 ? 2.0 : 1.6);
  const [L, D] = o.body;
  const pads = [tht('1', 0, 0, pad, pad, drill), tht('2', o.pitch, 0, pad, pad, drill)];
  const r = D / 2;
  const crt = courtyardAround(pads, { x0: -r, y0: -r, x1: r, y1: r }, CRT_THT);
  const g: Graphic[] = [circle('F.Fab', { x: 0, y: 0 }, r, FAB_W), circle('F.Silk', { x: 0, y: 0 }, r + 0.1, SILK_W), line('F.Silk', { x: r + 0.1, y: 0 }, { x: o.pitch - pad / 2 - 0.25, y: 0 }), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)];
  return fp({
    id: `R_Axial_${o.power}_L${L}mm_D${D}mm_P${o.pitch}mm_Vertical`,
    name: `Резистор ${o.power} стоя, ${fmtP(o.pitch)} мм`,
    description: `Резистор ${o.power} с осевыми выводами, установлен вертикально, шаг ${fmtP(o.pitch)} мм, корпус ${L}×${D} мм`,
    category: CAT.R,
    group: G.vert,
    tags: ['tht', 'axial', 'vertical', 'resistor'],
    refPrefix: 'R',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Типовые размеры',
    verified: true,
    height: L + 1,
  });
}

/** Мощный резистор в керамическом (цементном) корпусе SQP, стоит горизонтально на выводах. */
function cementResistor(power: string, body: [number, number, number], pitch: number): FootprintDef {
  const [L, W] = body;
  return twoPinTht({
    id: `R_Cement_${power}_L${L}mm_W${W}mm_P${pitch}mm`,
    name: `Цементный ${power}`,
    description: `Мощный резистор ${power} в керамическом корпусе ${L}×${W}×${body[2]} мм, шаг ${fmtP(pitch)} мм`,
    category: CAT.R,
    group: G.power,
    refPrefix: 'R',
    pitch,
    drill: 1.2,
    pad: 2.4,
    body: { len: L, wid: W },
    tags: ['power', 'cement', 'sqp'],
    verified: false,
    height: body[2],
  });
}

/** Резисторная сборка SIP: n выводов в ряд с шагом 2,54 мм. */
function sipArray(n: number): FootprintDef {
  const pads = rowX(n, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.6, 1.6, 0.8, i === 0 ? 'rect' : 'circle'));
  const hw = (n * 2.54) / 2;
  return boxFootprint({
    id: `R_Array_SIP${n}`,
    name: `SIP-${n}`,
    description: `Резисторная сборка SIP-${n}, шаг 2,54 мм, вывод 1 слева (общий)`,
    category: CAT.R,
    group: G.sip,
    refPrefix: 'RN',
    pads,
    body: { x0: -hw, y0: -1.3, x1: hw, y1: 1.3 },
    pin1Mark: { x: -hw + 0.6, y: -1.9 },
    verified: true,
    height: 5,
    tags: ['sip', 'array', 'network'],
  });
}

/** Подстроечные резисторы Bourns 3362P / 3386P / 3296W (выводы в линию, шаг 2,54). */
function trimmer(kind: '3362P' | '3386P' | '3296W' | '3323P'): FootprintDef {
  const S = {
    '3362P': { body: [6.6, 7.0] as [number, number], h: 4.9, pitch: 2.54, offY: 1.3, drill: 0.8, pad: 1.5, verified: true },
    '3323P': { body: [6.6, 6.6] as [number, number], h: 4.9, pitch: 2.54, offY: 1.0, drill: 0.8, pad: 1.5, verified: false },
    '3386P': { body: [9.53, 9.53] as [number, number], h: 4.83, pitch: 2.54, offY: 2.5, drill: 0.8, pad: 1.5, verified: false },
    '3296W': { body: [9.53, 4.83] as [number, number], h: 10.0, pitch: 2.54, offY: 0, drill: 0.8, pad: 1.5, verified: true },
  }[kind];
  const pads = rowX(3, S.pitch, (i, x) => tht(String(i + 1), x, S.offY, S.pad, S.pad, S.drill, i === 0 ? 'rect' : 'circle', { name: ['1', 'W', '3'][i] }));
  const [W, Hh] = S.body;
  return boxFootprint({
    id: `Potentiometer_Bourns_${kind}`,
    name: `Подстроечный ${kind}`,
    description: `Подстроечный резистор ${kind}, ${W}×${Hh} мм, 3 вывода в линию с шагом 2,54 мм (2 — движок)`,
    category: CAT.R,
    group: G.trim,
    refPrefix: 'RV',
    pads,
    body: { x0: -W / 2, y0: -Hh / 2, x1: W / 2, y1: Hh / 2 },
    extraGraphics: [circle('F.Fab', { x: 0, y: kind === '3296W' ? 0 : -S.offY }, Math.min(W, Hh) * 0.22, FAB_W)],
    verified: S.verified,
    height: S.h,
    tags: ['trimmer', 'bourns', kind.toLowerCase()],
    source: 'Bourns, даташит',
  });
}

/** Открытый подстроечник RM-065 / WH06-2: три вывода треугольником, шаг 2,5 мм. */
function trimmerRm065(): FootprintDef {
  const pads = [tht('1', -2.5, 1.25, 1.6, 1.6, 0.8, 'rect'), tht('2', 0, -1.25, 1.6, 1.6, 0.8, 'circle', { name: 'W' }), tht('3', 2.5, 1.25, 1.6, 1.6, 0.8)];
  return boxFootprint({
    id: 'Potentiometer_RM065_WH06-2',
    name: 'Подстроечный RM-065',
    description: 'Открытый подстроечный резистор RM-065 (WH06-2), Ø6,5 мм, выводы треугольником 2,5 мм',
    category: CAT.R,
    group: G.trim,
    refPrefix: 'RV',
    pads,
    body: { x0: -3.4, y0: -3.4, x1: 3.4, y1: 3.4 },
    extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 3.25, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 3.4, SILK_W)],
    noSilk: true,
    verified: false,
    height: 5,
    tags: ['trimmer', 'rm065', 'wh06'],
  });
}

/** Переменный резистор с валом (WH148 / RK09-type), 3 вывода шаг 2,5 мм, стоит на плате. */
function potentiometer(kind: 'WH148' | 'RK09' | 'RV16'): FootprintDef {
  const S = {
    WH148: { body: [17, 12] as [number, number], pitch: 2.5, pinY: 6.5, mount: 15.5, h: 15, note: 'WH148 (B-типа, вал 15 мм), корпус 17×12 мм, выводы 2,5 мм, лапки крепления 15,5 мм' },
    RK09: { body: [9.5, 11] as [number, number], pitch: 2.5, pinY: 5.5, mount: 0, h: 12, note: 'Alps RK09 9 мм, вертикальный, выводы 2,5 мм' },
    RV16: { body: [17, 16] as [number, number], pitch: 5.0, pinY: 8.0, mount: 0, h: 20, note: 'Переменный 16 мм (RV16/R16), выводы 5,0 мм' },
  }[kind];
  const pads = rowX(3, S.pitch, (i, x) => tht(String(i + 1), x, S.pinY, 1.8, 1.8, 1.0, i === 0 ? 'rect' : 'circle', { name: ['1', 'W', '3'][i] }));
  if (S.mount) pads.push(tht('MP1', -S.mount / 2, -S.body[1] / 2 + 3, 3.0, 2.0, 1.4, 'oval'), tht('MP2', S.mount / 2, -S.body[1] / 2 + 3, 3.0, 2.0, 1.4, 'oval'));
  const [W, Hh] = S.body;
  return boxFootprint({
    id: `Potentiometer_${kind}_Vertical`,
    name: `Переменный ${kind}`,
    description: `Переменный резистор ${S.note}`,
    category: CAT.R,
    group: G.pot,
    refPrefix: 'RV',
    pads,
    body: { x0: -W / 2, y0: -Hh / 2, x1: W / 2, y1: Hh / 2 },
    extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, Math.min(W, Hh) * 0.3, FAB_W)],
    verified: false,
    height: S.h,
    tags: ['potentiometer', kind.toLowerCase()],
  });
}

export function allResistors(): FootprintDef[] {
  const out: FootprintDef[] = [];
  // SMD чипы (0201 добавлен, остальные из общего списка).
  out.push({ ...chip('R', { code: '0201', metric: '0603', body: [0.6, 0.3], span: 0.66, pad: [0.4, 0.42], verified: false }), group: G.smd });
  for (const s of CHIP_SPECS) out.push({ ...chip('R', s), group: G.smd });
  out.push({ ...chip('R', { code: '1218', metric: '3246', body: [3.2, 4.6], span: 2.9, pad: [1.1, 4.7], verified: false }), group: G.smd });
  out.push(resistorArray('4x0603'), resistorArray('4x0402'));
  // Осевые горизонтально.
  const axial: Parameters<typeof axialResistor>[0][] = [
    { pitch: 5.08, body: [3.3, 1.8], power: '0.125W' },
    { pitch: 7.62, body: [6.3, 2.5], power: '0.25W' },
    { pitch: 10.16, body: [6.3, 2.5], power: '0.25W' },
    { pitch: 12.7, body: [6.3, 2.5], power: '0.25W' },
    { pitch: 10.16, body: [9.0, 3.2], power: '0.5W' },
    { pitch: 12.7, body: [9.0, 3.2], power: '0.5W' },
    { pitch: 15.24, body: [11.0, 4.0], power: '1W' },
    { pitch: 20.32, body: [15.5, 5.0], power: '2W', drill: 1.2, pad: 2.4 },
    { pitch: 25.4, body: [17.5, 6.0], power: '3W', drill: 1.2, pad: 2.4 },
    { pitch: 30.48, body: [24.0, 8.0], power: '5W', drill: 1.4, pad: 2.8 },
  ];
  for (const a of axial) out.push({ ...axialResistor(a), group: G.axial });
  out.push(axialVertical({ power: '0.25W', body: [6.3, 2.5], pitch: 2.54 }), axialVertical({ power: '0.25W', body: [6.3, 2.5], pitch: 5.08 }), axialVertical({ power: '0.5W', body: [9.0, 3.2], pitch: 2.54 }), axialVertical({ power: '1W', body: [11.0, 4.0], pitch: 5.08 }));
  out.push(cementResistor('5W', [22, 10, 10], 27.0), cementResistor('10W', [48, 10, 10], 53.0), cementResistor('2W', [14, 6, 6], 18.0), cementResistor('3W', [16, 8, 8], 20.0));
  for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 12]) out.push(sipArray(n));
  out.push(trimmer('3362P'), trimmer('3323P'), trimmer('3386P'), trimmer('3296W'), trimmerRm065());
  out.push(potentiometer('WH148'), potentiometer('RK09'), potentiometer('RV16'));
  // Термо- и фоторезисторы.
  out.push(
    twoPinTht({ id: 'R_NTC_D5mm_P2.5mm', name: 'NTC Ø5', description: 'Терморезистор NTC (MF52/MF58) в капле Ø5 мм, шаг 2,5 мм', category: CAT.R, group: G.ntc, refPrefix: 'TH', pitch: 2.5, drill: 0.8, pad: 1.6, body: { d: 5.0 }, tags: ['ntc', 'thermistor'], verified: true, height: 6 }),
    twoPinTht({ id: 'R_NTC_D10mm_P5mm', name: 'NTC Ø10', description: 'Терморезистор NTC дисковый Ø10 мм (MF72 5D-9 и т. п.), шаг 5 мм', category: CAT.R, group: G.ntc, refPrefix: 'TH', pitch: 5.0, drill: 1.0, pad: 2.0, body: { len: 10, wid: 3 }, tags: ['ntc', 'thermistor', 'inrush'], verified: false, height: 12 }),
    twoPinTht({ id: 'R_NTC_D15mm_P7.5mm', name: 'NTC Ø15', description: 'Терморезистор NTC дисковый Ø15 мм (MF72 10D-15), шаг 7,5 мм', category: CAT.R, group: G.ntc, refPrefix: 'TH', pitch: 7.5, drill: 1.0, pad: 2.0, body: { len: 15, wid: 4 }, tags: ['ntc', 'thermistor', 'inrush'], verified: false, height: 17 }),
    twoPinTht({ id: 'R_LDR_D5mm_P3.4mm', name: 'Фоторезистор Ø5', description: 'Фоторезистор GL5516/GL5528 Ø5 мм, шаг 3,4 мм', category: CAT.R, group: G.ntc, refPrefix: 'R', pitch: 3.4, drill: 0.8, pad: 1.6, body: { d: 5.1 }, tags: ['ldr', 'photoresistor'], verified: true, height: 2.5 }),
    twoPinTht({ id: 'R_LDR_D7mm_P4.5mm', name: 'Фоторезистор Ø7', description: 'Фоторезистор GL7528 Ø7 мм, шаг 4,5 мм', category: CAT.R, group: G.ntc, refPrefix: 'R', pitch: 4.5, drill: 0.8, pad: 1.6, body: { d: 7.0 }, tags: ['ldr', 'photoresistor'], verified: false, height: 2.5 }),
    twoPadSmd({ id: 'R_NTC_0603', name: 'NTC 0603', description: 'Терморезистор NTC SMD 0603', category: CAT.R, group: G.ntc, refPrefix: 'TH', span: 1.65, pad: [0.8, 0.95], body: [1.6, 0.8], tags: ['ntc'], verified: true, height: 0.5 }),
  );
  return out;
}
