import type { FootprintDef, Graphic, PadDef } from '../../model/types';
import { CRT_THT, FAB_W, SILK_W, circle, courtyardAround, crtGraphic, fp, line, npth, poly, r2, rect, refText, silkOutline, tht, valueText } from './util';

/*
 * Выводные корпуса. Отверстие берётся на 0,2–0,3 мм больше вывода, площадка —
 * не меньше отверстия + 2 × 0,3 мм (кольцо, которое переживает ЛУТ).
 */

/** Однорядный или двухрядный штыревой разъём с шагом 2,54 мм (или другим). Вывод 1 — слева сверху. */
export function pinHeader(rows: 1 | 2, n: number, pitch = 2.54, o: { rowPitch?: number; female?: boolean; rightAngle?: boolean } = {}): FootprintDef {
  const rowPitch = o.rowPitch ?? pitch;
  const padD = pitch >= 2.5 ? 1.7 : pitch >= 2 ? 1.35 : 1.0;
  const drill = pitch >= 2.5 ? 1.0 : pitch >= 2 ? 0.8 : 0.65;
  const pads: PadDef[] = [];
  // Столбики идут по X (шаг pitch), ряды — по Y, вывод 1 в левом верхнем углу.
  const x0 = -((n - 1) * pitch) / 2;
  const y0 = -((rows - 1) * rowPitch) / 2;
  let k = 1;
  for (let i = 0; i < n; i++)
    for (let r = 0; r < rows; r++) {
      pads.push(tht(String(k), x0 + i * pitch, y0 + r * rowPitch, padD, padD, drill, k === 1 ? 'rect' : 'oval'));
      k++;
    }
  const hw = (n * pitch) / 2;
  const hh = (rows * pitch) / 2;
  const crt = courtyardAround(pads, { x0: -hw, y0: -hh, x1: hw, y1: hh }, CRT_THT);
  const g: Graphic[] = [rect('F.Fab', -hw, -hh, hw, hh, FAB_W)];
  // Шелкография: рамка и уголок у первого вывода.
  g.push(rect('F.Silk', -hw - 0.06, -hh - 0.06, hw + 0.06, hh + 0.06, SILK_W));
  g.push(line('F.Silk', { x: -hw - 0.06, y: r2(y0 + pitch / 2) }, { x: r2(x0 - pitch / 2 - 0.06), y: r2(y0 + pitch / 2) }));
  g.push(line('F.Silk', { x: -hw - 0.5, y: -hh - 0.06 }, { x: -hw - 0.5, y: r2(-hh + pitch / 2) }, 0.15));
  for (let i = 1; i < n; i++) g.push(line('F.Fab', { x: r2(x0 + i * pitch - pitch / 2), y: -hh }, { x: r2(x0 + i * pitch - pitch / 2), y: hh }, FAB_W));
  g.push(crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7));
  const kind = o.female ? 'Гнездо' : 'Штыри';
  const p = String(pitch).replace('.', ',');
  return fp({
    id: `${o.female ? 'PinSocket' : 'PinHeader'}_${rows}x${String(n).padStart(2, '0')}_P${pitch}mm${o.rightAngle ? '_Horizontal' : ''}`,
    name: `${o.female ? 'Гнездо' : 'Штыри'} ${rows}×${n}`,
    description: `${kind} ${rows}×${n}, шаг ${p} мм${o.rightAngle ? ', угловой' : ''}`,
    category: 'Разъёмы',
    tags: ['tht', 'header', 'connector', `${rows}x${n}`],
    refPrefix: 'J',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Стандарт 2,54 мм',
    verified: true,
    height: o.female ? 8.5 : 6.0 + 2.5,
  });
}

/** Разъём JST XH (2,5 мм) или PH (2,0 мм), вертикальный. Вывод 1 слева. */
export function jst(series: 'XH' | 'PH', n: number): FootprintDef {
  const S =
    series === 'XH'
      ? { pitch: 2.5, drill: 0.95, pad: 1.7, extra: 4.9, depth: 5.75, back: 2.35, verified: true, hgt: 7.0 }
      : { pitch: 2.0, drill: 0.75, pad: 1.2, extra: 3.9, depth: 4.5, back: 1.7, verified: true, hgt: 6.0 };
  const pads: PadDef[] = [];
  const x0 = -((n - 1) * S.pitch) / 2;
  for (let i = 0; i < n; i++) pads.push(tht(String(i + 1), x0 + i * S.pitch, 0, series === 'XH' ? S.pad : 1.2, series === 'XH' ? S.pad : 1.75, S.drill, i === 0 ? 'rect' : 'oval'));
  const hw = ((n - 1) * S.pitch + S.extra) / 2;
  const y0 = -S.back;
  const y1 = S.depth - S.back;
  const crt = courtyardAround(pads, { x0: -hw, y0, x1: hw, y1 }, CRT_THT);
  const g: Graphic[] = [
    rect('F.Fab', -hw, y0, hw, y1, FAB_W),
    rect('F.Silk', -hw - 0.06, y0 - 0.06, hw + 0.06, y1 + 0.06, SILK_W),
    // Прорезь под защёлку сзади и метка первого вывода.
    line('F.Silk', { x: -hw + 1.0, y: y1 + 0.06 }, { x: -hw + 1.0, y: y1 - 0.8 }),
    line('F.Silk', { x: hw - 1.0, y: y1 + 0.06 }, { x: hw - 1.0, y: y1 - 0.8 }),
    line('F.Silk', { x: -hw + 1.0, y: y1 - 0.8 }, { x: hw - 1.0, y: y1 - 0.8 }),
    poly('F.Silk', [{ x: r2(x0 - 0.6), y: y0 - 0.5 }, { x: r2(x0 + 0.6), y: y0 - 0.5 }, { x: r2(x0), y: y0 - 0.06 }], SILK_W, true, true),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  return fp({
    id: `JST_${series}_B${n}B-${series}-A_1x${String(n).padStart(2, '0')}_P${S.pitch}mm_Vertical`,
    name: `JST ${series} ${n}`,
    description: `Разъём JST ${series}, ${n} конт., шаг ${String(S.pitch).replace('.', ',')} мм, вертикальный`,
    category: 'Разъёмы',
    tags: ['tht', 'connector', 'jst', series.toLowerCase()],
    refPrefix: 'J',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Даташит JST',
    verified: S.verified,
    height: S.hgt,
  });
}

/** Винтовой клеммник на плату (KF301/KF128/MKDS), шаг 5,08 / 5,0 / 3,5 мм. */
export function screwTerminal(n: number, pitch: 5.08 | 5.0 | 3.5 | 3.81 = 5.08): FootprintDef {
  const big = pitch >= 5;
  const drill = big ? 1.3 : 1.2;
  const pad = big ? 2.6 : 2.2;
  const depth = big ? 7.6 : 7.0;
  const height = big ? 10 : 8.5;
  const pads: PadDef[] = [];
  const x0 = -((n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) pads.push(tht(String(i + 1), x0 + i * pitch, 0, pad, pad, drill, i === 0 ? 'rect' : 'circle'));
  const hw = (n * pitch) / 2;
  const y0 = -depth / 2 - 0.5;
  const y1 = depth / 2 + 0.5;
  const crt = courtyardAround(pads, { x0: -hw, y0, x1: hw, y1 }, CRT_THT);
  const g: Graphic[] = [rect('F.Fab', -hw, y0, hw, y1, FAB_W), rect('F.Silk', -hw - 0.06, y0 - 0.06, hw + 0.06, y1 + 0.06, SILK_W)];
  for (let i = 0; i < n; i++) {
    const x = x0 + i * pitch;
    g.push(circle('F.Fab', { x: r2(x), y: r2(y0 + depth * 0.4) }, pitch * 0.32, FAB_W));
    g.push(rect('F.Silk', r2(x - pitch * 0.3), r2(y1 - depth * 0.35), r2(x + pitch * 0.3), r2(y1 - 0.3), SILK_W));
  }
  g.push(line('F.Silk', { x: -hw - 0.5, y: y0 - 0.06 }, { x: -hw - 0.5, y: r2(y0 + 1.5) }, 0.15));
  g.push(crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7));
  return fp({
    id: `TerminalBlock_1x${String(n).padStart(2, '0')}_P${pitch}mm`,
    name: `Клеммник ${n}, ${String(pitch).replace('.', ',')}`,
    description: `Винтовой клеммник ${n} конт., шаг ${String(pitch).replace('.', ',')} мм (KF301/MKDS)`,
    category: 'Разъёмы',
    tags: ['tht', 'connector', 'terminal', 'screw'],
    refPrefix: 'J',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Типовой KF301-5.0/5.08, KF128-3.5',
    verified: false,
    height,
  });
}

/** DIP-N, расстояние между рядами 7,62 (узкий) или 15,24 мм (широкий). Обход против часовой стрелки. */
export function dip(pins: number, wide = false): FootprintDef {
  const rowPitch = wide ? 15.24 : 7.62;
  const n = pins / 2;
  const pads: PadDef[] = [];
  const y0 = -((n - 1) * 2.54) / 2;
  for (let i = 0; i < n; i++) pads.push(tht(String(i + 1), -rowPitch / 2, y0 + i * 2.54, 1.6, 1.6, 0.8, i === 0 ? 'rect' : 'oval'));
  for (let i = 0; i < n; i++) pads.push(tht(String(n + i + 1), rowPitch / 2, y0 + (n - 1 - i) * 2.54, 1.6, 1.6, 0.8, 'oval'));
  const bw = wide ? 14.0 : 6.35;
  const bl = n * 2.54 + 0.5;
  const crt = courtyardAround(pads, { x0: -bw / 2, y0: -bl / 2, x1: bw / 2, y1: bl / 2 }, CRT_THT);
  const g: Graphic[] = [
    rect('F.Fab', -bw / 2, -bl / 2, bw / 2, bl / 2, FAB_W),
    ...silkOutline(-bw / 2 - 0.06, -bl / 2 - 0.06, bw / 2 + 0.06, bl / 2 + 0.06, pads),
    { kind: 'arc', layer: 'F.Silk', c: { x: 0, y: -bl / 2 - 0.06 }, r: 1.0, start: 180, sweep: 180, width: SILK_W },
    { kind: 'arc', layer: 'F.Fab', c: { x: 0, y: -bl / 2 }, r: 1.0, start: 180, sweep: 180, width: FAB_W },
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(0, 0, 0.9),
  ];
  return fp({
    id: `DIP-${pins}_W${rowPitch}mm`,
    name: `DIP-${pins}${wide ? 'W' : ''}`,
    description: `DIP-${pins}, ряды ${String(rowPitch).replace('.', ',')} мм`,
    category: 'Микросхемы выводные',
    tags: ['tht', 'dip', 'ic'],
    refPrefix: 'U',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'JEDEC MS-001',
    verified: true,
    height: 4.5,
  });
}

/** Резистор с осевыми выводами, горизонтально. Шаг 7,62/10,16/12,7/15,24 мм. */
export function axialResistor(o: { pitch: number; body: [number, number]; power: string; drill?: number; pad?: number }): FootprintDef {
  const drill = o.drill ?? (o.body[1] > 3 ? 1.0 : 0.8);
  const pad = o.pad ?? (o.body[1] > 3 ? 2.0 : 1.6);
  const pads = [tht('1', -o.pitch / 2, 0, pad, pad, drill), tht('2', o.pitch / 2, 0, pad, pad, drill)];
  const [L, D] = o.body;
  const crt = courtyardAround(pads, { x0: -L / 2, y0: -D / 2, x1: L / 2, y1: D / 2 }, CRT_THT);
  const g: Graphic[] = [
    rect('F.Fab', -L / 2, -D / 2, L / 2, D / 2, FAB_W),
    line('F.Fab', { x: -o.pitch / 2, y: 0 }, { x: -L / 2, y: 0 }, FAB_W),
    line('F.Fab', { x: L / 2, y: 0 }, { x: o.pitch / 2, y: 0 }, FAB_W),
    rect('F.Silk', -L / 2 - 0.06, -D / 2 - 0.06, L / 2 + 0.06, D / 2 + 0.06, SILK_W),
    line('F.Silk', { x: r2(-o.pitch / 2 + pad / 2 + 0.25), y: 0 }, { x: -L / 2 - 0.06, y: 0 }),
    line('F.Silk', { x: L / 2 + 0.06, y: 0 }, { x: r2(o.pitch / 2 - pad / 2 - 0.25), y: 0 }),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(0, 0, Math.min(0.9, D * 0.35)),
  ];
  return fp({
    id: `R_Axial_${o.power}_L${L}mm_D${D}mm_P${o.pitch}mm_Horizontal`,
    name: `Резистор ${o.power}, ${String(o.pitch).replace('.', ',')} мм`,
    description: `Резистор ${o.power} с осевыми выводами, корпус ${L}×${D} мм, шаг ${String(o.pitch).replace('.', ',')} мм`,
    category: 'Резисторы',
    tags: ['tht', 'axial', 'resistor', o.power],
    refPrefix: 'R',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Типовые размеры',
    verified: true,
    height: D,
  });
}

/** Диод с осевыми выводами: DO-35, DO-41, DO-201 (пластмасса, 1N540x). Катод — вывод 1. */
export function axialDiode(pkg: 'DO-35' | 'DO-41' | 'DO-201' | 'DO-15'): FootprintDef {
  const S = {
    'DO-35': { pitch: 7.62, body: [3.8, 1.8] as [number, number], drill: 0.8, pad: 1.6 },
    'DO-15': { pitch: 10.16, body: [7.6, 3.6] as [number, number], drill: 1.0, pad: 2.0 },
    'DO-41': { pitch: 10.16, body: [5.2, 2.7] as [number, number], drill: 1.1, pad: 2.2 },
    'DO-201': { pitch: 12.7, body: [9.5, 5.3] as [number, number], drill: 1.4, pad: 2.6 },
  }[pkg];
  const pads = [tht('1', -S.pitch / 2, 0, S.pad, S.pad, S.drill, 'circle', { name: 'K' }), tht('2', S.pitch / 2, 0, S.pad, S.pad, S.drill, 'circle', { name: 'A' })];
  const [L, D] = S.body;
  const crt = courtyardAround(pads, { x0: -L / 2, y0: -D / 2, x1: L / 2, y1: D / 2 }, CRT_THT);
  const kx = -L / 2 + L * 0.22;
  const g: Graphic[] = [
    rect('F.Fab', -L / 2, -D / 2, L / 2, D / 2, FAB_W),
    line('F.Fab', { x: r2(kx), y: -D / 2 }, { x: r2(kx), y: D / 2 }, FAB_W),
    rect('F.Silk', -L / 2 - 0.06, -D / 2 - 0.06, L / 2 + 0.06, D / 2 + 0.06, SILK_W),
    line('F.Silk', { x: r2(kx - 0.15), y: -D / 2 - 0.06 }, { x: r2(kx - 0.15), y: D / 2 + 0.06 }, 0.3),
    line('F.Silk', { x: r2(-S.pitch / 2 + S.pad / 2 + 0.25), y: 0 }, { x: -L / 2 - 0.06, y: 0 }),
    line('F.Silk', { x: L / 2 + 0.06, y: 0 }, { x: r2(S.pitch / 2 - S.pad / 2 - 0.25), y: 0 }),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  return fp({
    id: `D_${pkg}_P${S.pitch}mm_Horizontal`,
    name: `${pkg}`,
    description: `Диод ${pkg}, корпус ${L}×${D} мм, шаг ${String(S.pitch).replace('.', ',')} мм, катод — вывод 1`,
    category: 'Диоды',
    tags: ['tht', 'axial', 'diode', pkg.toLowerCase()],
    refPrefix: 'D',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'JEDEC / типовые',
    verified: pkg === 'DO-41' || pkg === 'DO-35',
    height: D,
  });
}

/** Электролитический конденсатор радиальный: диаметр D и шаг P. Плюс — вывод 1. */
export function radialCap(D: number, P: number): FootprintDef {
  const drill = D >= 10 ? 1.0 : 0.8;
  const pad = D >= 10 ? 2.0 : 1.6;
  const pads = [tht('1', -P / 2, 0, pad, pad, drill, 'rect', { name: '+' }), tht('2', P / 2, 0, pad, pad, drill, 'circle', { name: '-' })];
  const r = D / 2;
  const crt = courtyardAround(pads, { x0: -r, y0: -r, x1: r, y1: r }, CRT_THT);
  const g: Graphic[] = [
    circle('F.Fab', { x: 0, y: 0 }, r, FAB_W),
    circle('F.Silk', { x: 0, y: 0 }, r + 0.06, SILK_W),
    // Метка плюса рядом с первым выводом и полоса минуса на корпусе.
    line('F.Silk', { x: r2(-r - 1.2), y: r2(-r * 0.5) }, { x: r2(-r - 0.4), y: r2(-r * 0.5) }, 0.15),
    line('F.Silk', { x: r2(-r - 0.8), y: r2(-r * 0.5 - 0.4) }, { x: r2(-r - 0.8), y: r2(-r * 0.5 + 0.4) }, 0.15),
    poly('F.Fab', [{ x: r2(r * 0.55), y: r2(-r * 0.8) }, { x: r2(r * 0.55), y: r2(r * 0.8) }], FAB_W, false),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  return fp({
    id: `CP_Radial_D${D}mm_P${P}mm`,
    name: `Электролит Ø${D}`,
    description: `Электролитический конденсатор Ø${D} мм, шаг ${String(P).replace('.', ',')} мм, плюс — вывод 1`,
    category: 'Конденсаторы',
    tags: ['tht', 'radial', 'electrolytic', 'capacitor'],
    refPrefix: 'C',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Типовые размеры',
    verified: true,
    height: D >= 10 ? 20 : D >= 8 ? 12 : 11,
  });
}

/** Керамический или плёночный конденсатор с радиальными выводами. */
export function radialBoxCap(P: number, body: [number, number]): FootprintDef {
  const pads = [tht('1', -P / 2, 0, 1.6, 1.6, 0.8), tht('2', P / 2, 0, 1.6, 1.6, 0.8)];
  const [L, W] = body;
  const crt = courtyardAround(pads, { x0: -L / 2, y0: -W / 2, x1: L / 2, y1: W / 2 }, CRT_THT);
  const g: Graphic[] = [
    rect('F.Fab', -L / 2, -W / 2, L / 2, W / 2, FAB_W),
    ...silkOutline(-L / 2 - 0.06, -W / 2 - 0.06, L / 2 + 0.06, W / 2 + 0.06, pads),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  return fp({
    id: `C_Rect_L${L}mm_W${W}mm_P${P}mm`,
    name: `Конденсатор ${String(P).replace('.', ',')} мм`,
    description: `Конденсатор с радиальными выводами, корпус ${L}×${W} мм, шаг ${String(P).replace('.', ',')} мм`,
    category: 'Конденсаторы',
    tags: ['tht', 'radial', 'capacitor', 'film', 'ceramic'],
    refPrefix: 'C',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Типовые размеры',
    verified: true,
    height: W * 2,
  });
}

/** TO-92 с выводами в линию: шаг 1,27 мм (как у корпуса) или 2,54 мм (разогнутые). */
export function to92(pitch: 1.27 | 2.54 = 1.27): FootprintDef {
  const pads =
    pitch === 1.27
      ? [tht('1', -1.27, 0, 1.05, 1.5, 0.75, 'oval'), tht('2', 0, 0, 1.05, 1.5, 0.75, 'oval'), tht('3', 1.27, 0, 1.05, 1.5, 0.75, 'oval')]
      : [tht('1', -2.54, 0, 1.6, 1.6, 0.8), tht('2', 0, 0, 1.6, 1.6, 0.8), tht('3', 2.54, 0, 1.6, 1.6, 0.8)];
  const r = 2.3;
  const flatY = -1.4; // плоская грань со стороны отрицательных Y
  const crt = courtyardAround(pads, { x0: -r, y0: flatY, x1: r, y1: r }, CRT_THT);
  const g: Graphic[] = [
    { kind: 'arc', layer: 'F.Fab', c: { x: 0, y: 0 }, r, start: 37.6, sweep: 284.8, width: FAB_W },
    line('F.Fab', { x: r2(-Math.sqrt(r * r - flatY * flatY)), y: flatY }, { x: r2(Math.sqrt(r * r - flatY * flatY)), y: flatY }, FAB_W),
    { kind: 'arc', layer: 'F.Silk', c: { x: 0, y: 0 }, r: r + 0.06, start: 38, sweep: 284, width: SILK_W },
    line('F.Silk', { x: r2(-Math.sqrt(r * r - flatY * flatY)), y: flatY - 0.06 }, { x: r2(Math.sqrt(r * r - flatY * flatY)), y: flatY - 0.06 }, SILK_W),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  return fp({
    id: `TO-92_Inline${pitch === 2.54 ? '_Wide' : ''}`,
    name: `TO-92${pitch === 2.54 ? ' (2,54)' : ''}`,
    description: `TO-92, выводы в линию, шаг ${String(pitch).replace('.', ',')} мм. Плоская грань сверху (−Y), вывод 1 слева`,
    category: 'Транзисторы и мелкие корпуса',
    tags: ['tht', 'to-92', 'transistor'],
    refPrefix: 'Q',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'JEDEC TO-92',
    verified: true,
    height: 5.0,
  });
}

/** TO-220 вертикально, 3 вывода, шаг 2,54 мм. Теплоотвод сзади (−Y). */
export function to220(): FootprintDef {
  const pads = [tht('1', -2.54, 0, 1.8, 2.6, 1.0, 'rect'), tht('2', 0, 0, 1.8, 2.6, 1.0, 'oval'), tht('3', 2.54, 0, 1.8, 2.6, 1.0, 'oval')];
  const bw = 10.4;
  const y0 = -2.5 - 1.5;
  const y1 = -2.5 + 2.9;
  const crt = courtyardAround(pads, { x0: -bw / 2, y0, x1: bw / 2, y1 }, CRT_THT);
  const g: Graphic[] = [
    rect('F.Fab', -bw / 2, y0, bw / 2, y1, FAB_W),
    line('F.Fab', { x: -bw / 2, y: r2(y0 + 1.3) }, { x: bw / 2, y: r2(y0 + 1.3) }, FAB_W),
    rect('F.Silk', -bw / 2 - 0.06, y0 - 0.06, bw / 2 + 0.06, y1 + 0.06, SILK_W),
    line('F.Silk', { x: -bw / 2 - 0.06, y: r2(y0 + 1.3) }, { x: bw / 2 + 0.06, y: r2(y0 + 1.3) }, SILK_W),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  return fp({
    id: 'TO-220-3_Vertical',
    name: 'TO-220',
    description: 'TO-220, 3 вывода, шаг 2,54 мм, вертикально; теплоотвод со стороны −Y',
    category: 'Транзисторы и мелкие корпуса',
    tags: ['tht', 'to-220', 'transistor', 'regulator'],
    refPrefix: 'Q',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'JEDEC TO-220',
    verified: true,
    height: 16,
  });
}

/** Светодиод 3 или 5 мм, шаг 2,54 мм. Катод (плоская грань) — вывод 1, слева. */
export function ledRound(D: 3 | 5): FootprintDef {
  const pads = [tht('1', -1.27, 0, 1.8, 1.8, 0.9, 'rect', { name: 'K' }), tht('2', 1.27, 0, 1.8, 1.8, 0.9, 'circle', { name: 'A' })];
  const r = D / 2 + (D === 5 ? 0.35 : 0.3);
  const flatX = -(D === 5 ? 2.25 : 1.5);
  const crt = courtyardAround(pads, { x0: flatX, y0: -r, x1: r, y1: r }, CRT_THT);
  const halfChord = Math.sqrt(Math.max(0, r * r - flatX * flatX));
  const a = (Math.atan2(halfChord, -flatX) * 180) / Math.PI;
  const g: Graphic[] = [
    { kind: 'arc', layer: 'F.Fab', c: { x: 0, y: 0 }, r, start: 180 - a, sweep: -(360 - 2 * a), width: FAB_W },
    line('F.Fab', { x: flatX, y: r2(-halfChord) }, { x: flatX, y: r2(halfChord) }, FAB_W),
    { kind: 'arc', layer: 'F.Silk', c: { x: 0, y: 0 }, r: r + 0.06, start: 180 - a, sweep: -(360 - 2 * a), width: SILK_W },
    line('F.Silk', { x: flatX - 0.06, y: r2(-halfChord) }, { x: flatX - 0.06, y: r2(halfChord) }, SILK_W),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  return fp({
    id: `LED_D${D}.0mm`,
    name: `LED ${D} мм`,
    description: `Светодиод Ø${D} мм, шаг 2,54 мм, катод (плоская грань) — вывод 1`,
    category: 'Светодиоды',
    tags: ['tht', 'led', `${D}mm`],
    refPrefix: 'LED',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Типовые размеры',
    verified: true,
    height: D === 5 ? 8.6 : 5.3,
  });
}

/** Держатель предохранителя 5×20 мм (две клипсы), шаг 22,6 мм. */
export function fuseHolder5x20(): FootprintDef {
  const P = 22.6;
  const pads = [tht('1', -P / 2, 0, 2.6, 2.6, 1.3), tht('2', P / 2, 0, 2.6, 2.6, 1.3)];
  const crt = courtyardAround(pads, { x0: -12.7, y0: -3.3, x1: 12.7, y1: 3.3 }, CRT_THT);
  const g: Graphic[] = [
    rect('F.Fab', -10.5, -2.6, 10.5, 2.6, FAB_W),
    rect('F.Fab', -P / 2 - 1.6, -3.3, -P / 2 + 1.6, 3.3, FAB_W),
    rect('F.Fab', P / 2 - 1.6, -3.3, P / 2 + 1.6, 3.3, FAB_W),
    rect('F.Silk', -10.5 - 0.06, -2.6 - 0.06, 10.5 + 0.06, 2.6 + 0.06, SILK_W),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(0, 0, 1.0),
  ];
  return fp({
    id: 'Fuseholder_Clip-5x20mm_P22.6mm_Horizontal',
    name: 'Держатель 5×20',
    description: 'Держатель предохранителя 5×20 мм на клипсах, шаг 22,6 мм',
    category: 'Предохранители',
    tags: ['tht', 'fuse', '5x20'],
    refPrefix: 'F',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Типовые клипсы 5×20',
    verified: false,
    height: 8,
  });
}

/** Дисковый варистор или конденсатор Ø D с шагом P. */
export function disc(D: number, P: number, kind: 'RV' | 'C' = 'RV'): FootprintDef {
  const pads = [tht('1', -P / 2, 0, 2.0, 2.0, 1.0), tht('2', P / 2, 0, 2.0, 2.0, 1.0)];
  const r = D / 2;
  const th = 2.5;
  const crt = courtyardAround(pads, { x0: -r, y0: -th, x1: r, y1: th }, CRT_THT);
  const g: Graphic[] = [
    rect('F.Fab', -r, -th, r, th, FAB_W),
    rect('F.Silk', -r - 0.06, -th - 0.06, r + 0.06, th + 0.06, SILK_W),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  const isV = kind === 'RV';
  return fp({
    id: `${isV ? 'RV' : 'C'}_Disc_D${D}mm_P${P}mm`,
    name: `${isV ? 'Варистор' : 'Диск'} Ø${D}`,
    description: `${isV ? 'Варистор' : 'Дисковый конденсатор'} Ø${D} мм, шаг ${String(P).replace('.', ',')} мм, стоит вертикально`,
    category: isV ? 'Защита' : 'Конденсаторы',
    tags: ['tht', isV ? 'varistor' : 'capacitor', 'disc'],
    refPrefix: isV ? 'RV' : 'C',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Типовые размеры (14D471K и т. п.)',
    verified: false,
    height: D + 2,
  });
}

/** Активный зуммер Ø12 мм, шаг 7,6 мм; плюс — вывод 1. */
export function buzzer12(): FootprintDef {
  const P = 7.6;
  const pads = [tht('1', -P / 2, 0, 1.8, 1.8, 0.9, 'rect', { name: '+' }), tht('2', P / 2, 0, 1.8, 1.8, 0.9, 'circle', { name: '-' })];
  const r = 6.0;
  const crt = courtyardAround(pads, { x0: -r, y0: -r, x1: r, y1: r }, CRT_THT);
  const g: Graphic[] = [
    circle('F.Fab', { x: 0, y: 0 }, r, FAB_W),
    circle('F.Silk', { x: 0, y: 0 }, r + 0.06, SILK_W),
    line('F.Silk', { x: -r - 1.4, y: -1.5 }, { x: -r - 0.6, y: -1.5 }, 0.15),
    line('F.Silk', { x: -r - 1.0, y: -1.9 }, { x: -r - 1.0, y: -1.1 }, 0.15),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  return fp({
    id: 'Buzzer_12x9.5RM7.6',
    name: 'Зуммер Ø12',
    description: 'Активный зуммер Ø12 мм, шаг 7,6 мм, плюс — вывод 1',
    category: 'Разное',
    tags: ['tht', 'buzzer'],
    refPrefix: 'BZ',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'KiCad Buzzer_12x9.5RM7.6',
    verified: true,
    height: 9.5,
  });
}

/** Крепёжное отверстие под винт M2,5 / M3 / M4, с медным кольцом или без. */
export function mountingHole(m: 2.5 | 3 | 4, withPad = false): FootprintDef {
  const S = { 2.5: { d: 2.7, pad: 5.4 }, 3: { d: 3.2, pad: 6.4 }, 4: { d: 4.3, pad: 8.0 } }[m];
  const pads = withPad ? [tht('1', 0, 0, S.pad, S.pad, S.d)] : [npth(0, 0, S.d)];
  const r = S.pad / 2;
  const crt = { min: { x: -r - 0.25, y: -r - 0.25 }, max: { x: r + 0.25, y: r + 0.25 } };
  return fp({
    id: `MountingHole_${S.d}mm_M${m}${withPad ? '_Pad' : ''}`,
    name: `Отверстие M${m}${withPad ? ' + кольцо' : ''}`,
    description: `Крепёжное отверстие Ø${S.d} мм под винт M${m}${withPad ? ', с медным кольцом' : ''}`,
    category: 'Крепёж',
    tags: ['hole', 'mounting', `m${m}`],
    refPrefix: 'H',
    pads,
    graphics: [circle('F.Fab', { x: 0, y: 0 }, r, FAB_W), circle('F.Courtyard', { x: 0, y: 0 }, r + 0.25, 0.05), refText(-r - 0.9)],
    courtyard: crt,
    source: 'ISO 273, средний ряд',
    verified: true,
    height: 0,
  });
}

/** Кнопка тактовая 6×6 мм, 4 вывода (6,5 × 4,5 мм между выводами). */
export function tactile6x6(): FootprintDef {
  const pads = [tht('1', -3.25, -2.25, 1.8, 1.8, 1.0), tht('2', 3.25, -2.25, 1.8, 1.8, 1.0), tht('3', -3.25, 2.25, 1.8, 1.8, 1.0), tht('4', 3.25, 2.25, 1.8, 1.8, 1.0)];
  const crt = courtyardAround(pads, { x0: -3, y0: -3, x1: 3, y1: 3 }, CRT_THT);
  return fp({
    id: 'SW_PUSH_6mm',
    name: 'Кнопка 6×6',
    description: 'Тактовая кнопка 6×6 мм, 4 вывода; выводы 1–2 и 3–4 соединены внутри',
    category: 'Кнопки и переключатели',
    tags: ['tht', 'switch', 'button', 'tactile'],
    refPrefix: 'SW',
    pads,
    graphics: [rect('F.Fab', -3, -3, 3, 3, FAB_W), circle('F.Fab', { x: 0, y: 0 }, 1.75, FAB_W), ...silkOutline(-3.06, -3.06, 3.06, 3.06, pads), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)],
    courtyard: crt,
    source: 'Типовая кнопка 6×6',
    verified: true,
    height: 5.0,
  });
}

/** Реле Songle SRD (5 выводов, форма C). Размеры типовые, сверить с даташитом. */
export function relaySrd(): FootprintDef {
  const pads = [
    tht('1', -6.0, 6.0, 2.4, 2.4, 1.3, 'circle', { name: 'COIL1' }),
    tht('2', 6.0, 6.0, 2.4, 2.4, 1.3, 'circle', { name: 'COIL2' }),
    tht('3', 6.0, -6.0, 2.4, 2.4, 1.3, 'circle', { name: 'NO' }),
    tht('4', 0, -6.0, 2.4, 2.4, 1.3, 'circle', { name: 'COM' }),
    tht('5', -6.0, -6.0, 2.4, 2.4, 1.3, 'circle', { name: 'NC' }),
  ];
  const crt = courtyardAround(pads, { x0: -9.7, y0: -7.75, x1: 9.7, y1: 7.75 }, CRT_THT);
  return fp({
    id: 'Relay_SRD_SPDT',
    name: 'Реле SRD',
    description: 'Реле Songle SRD-xxVDC-SL-C, 19,4×15,5 мм, 5 выводов. Расположение выводов типовое — проверить по даташиту',
    category: 'Реле',
    tags: ['tht', 'relay', 'srd'],
    refPrefix: 'K',
    pads,
    graphics: [rect('F.Fab', -9.7, -7.75, 9.7, 7.75, FAB_W), rect('F.Silk', -9.76, -7.81, 9.76, 7.81, SILK_W), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(0, 0, 1.0)],
    courtyard: crt,
    source: 'Типовые размеры',
    verified: false,
    height: 15.3,
  });
}

export function allTht(): FootprintDef[] {
  const out: FootprintDef[] = [];
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 16, 20]) out.push(pinHeader(1, n));
  for (const n of [2, 3, 4, 5, 6, 8, 10, 15, 20]) out.push(pinHeader(2, n));
  for (const n of [2, 3, 4, 5, 6, 8]) out.push(pinHeader(1, n, 2.54, { female: true }));
  for (const n of [2, 3, 4, 5, 6, 8]) out.push(pinHeader(1, n, 2.0));
  for (const n of [2, 3, 4, 5, 6, 8]) out.push(jst('XH', n), jst('PH', n));
  for (const n of [2, 3, 4, 5, 6, 8]) out.push(screwTerminal(n, 5.08));
  for (const n of [2, 3, 4]) out.push(screwTerminal(n, 5.0), screwTerminal(n, 3.5));
  for (const n of [4, 6, 8, 14, 16, 18, 20, 24, 28]) out.push(dip(n));
  out.push(dip(28, true), dip(40, true));
  out.push(
    axialResistor({ pitch: 7.62, body: [6.3, 2.5], power: '0.25W' }),
    axialResistor({ pitch: 10.16, body: [6.3, 2.5], power: '0.25W' }),
    axialResistor({ pitch: 12.7, body: [9.0, 3.2], power: '0.5W' }),
    axialResistor({ pitch: 15.24, body: [11.0, 4.0], power: '1W' }),
    axialResistor({ pitch: 20.32, body: [15.5, 5.0], power: '2W', drill: 1.2, pad: 2.4 }),
  );
  out.push(axialDiode('DO-35'), axialDiode('DO-41'), axialDiode('DO-15'), axialDiode('DO-201'));
  for (const [d, p] of [
    [5, 2.0],
    [6.3, 2.5],
    [8, 3.5],
    [10, 5.0],
    [13, 5.0],
    [16, 7.5],
    [18, 7.5],
  ] as [number, number][])
    out.push(radialCap(d, p));
  out.push(radialBoxCap(2.5, [3.5, 2.0]), radialBoxCap(5.0, [5.5, 2.5]), radialBoxCap(5.08, [7.2, 2.5]), radialBoxCap(7.5, [10.0, 4.0]), radialBoxCap(10.0, [13.0, 5.0]), radialBoxCap(15.0, [18.0, 7.0]));
  out.push(to92(1.27), to92(2.54), to220(), ledRound(3), ledRound(5), fuseHolder5x20(), disc(14, 7.5), disc(20, 10), disc(7, 5, 'C'), buzzer12(), tactile6x6(), relaySrd());
  out.push(mountingHole(2.5), mountingHole(3), mountingHole(4), mountingHole(3, true), mountingHole(4, true));
  return out;
}
