import type { FootprintDef, Graphic, PadDef } from '../../model/types';
import { CRT_SMD, FAB_W, SILK_W, courtyardAround, crtGraphic, fp, line, poly, r2, rect, refText, smd, valueText } from './util';

/*
 * Планарные корпуса. Размеры площадок — номинальные по IPC-7351 (уровень B),
 * такие же, как в библиотеке KiCad. Там, где размеры взяты по памяти,
 * стоит verified: false — сверить с даташитом перед заказом.
 */

interface ChipSpec {
  /** Имперский код: 0402, 0603… */
  code: string;
  metric: string;
  /** Длина и ширина корпуса. */
  body: [number, number];
  /** Расстояние между центрами площадок. */
  span: number;
  /** Размер площадки (вдоль оси корпуса × поперёк). */
  pad: [number, number];
  verified: boolean;
}

export const CHIP_SPECS: ChipSpec[] = [
  { code: '0402', metric: '1005', body: [1.0, 0.5], span: 1.02, pad: [0.54, 0.64], verified: true },
  { code: '0603', metric: '1608', body: [1.6, 0.8], span: 1.65, pad: [0.8, 0.95], verified: true },
  { code: '0805', metric: '2012', body: [2.0, 1.25], span: 1.825, pad: [1.025, 1.4], verified: true },
  { code: '1206', metric: '3216', body: [3.2, 1.6], span: 2.925, pad: [1.125, 1.75], verified: true },
  { code: '1210', metric: '3225', body: [3.2, 2.5], span: 2.925, pad: [1.125, 2.65], verified: true },
  { code: '2010', metric: '5025', body: [5.0, 2.5], span: 4.6, pad: [1.1, 2.7], verified: false },
  { code: '2512', metric: '6332', body: [6.3, 3.2], span: 5.9, pad: [1.35, 3.35], verified: false },
];

function chipGraphics(body: [number, number], pads: PadDef[], polar: boolean): Graphic[] {
  const [L, W] = body;
  const g: Graphic[] = [rect('F.Fab', -L / 2, -W / 2, L / 2, W / 2, FAB_W)];
  // Шелкография: две линии вдоль длинных сторон, если корпус шире площадок; иначе ничего.
  const padEdge = pads[0].size.y / 2 + SILK_W / 2 + 0.1;
  if (W / 2 + 0.05 > padEdge || L > 3) {
    const y = Math.max(W / 2 + SILK_W / 2 + 0.05, padEdge);
    const x0 = -pads[0].at.x - pads[0].size.x / 2 - 0.2;
    if (x0 > -L / 2 + 0.2) {
      g.push(line('F.Silk', { x: r2(-x0), y: r2(-y) }, { x: r2(x0), y: r2(-y) }));
      g.push(line('F.Silk', { x: r2(-x0), y: r2(y) }, { x: r2(x0), y: r2(y) }));
    }
  }
  if (polar) {
    // Полоска катода (вывод 1) на шелкографии и сборочном слое.
    const x = pads[0].at.x - pads[0].size.x / 2 - 0.25;
    g.push(line('F.Silk', { x: r2(x), y: r2(-W / 2 - 0.2) }, { x: r2(x), y: r2(W / 2 + 0.2) }, 0.2));
    g.push(line('F.Fab', { x: r2(-L / 2 + L * 0.2), y: -W / 2 }, { x: r2(-L / 2 + L * 0.2), y: W / 2 }, FAB_W));
  }
  return g;
}

export type ChipKind = 'R' | 'C' | 'L' | 'D' | 'LED' | 'F';

const CHIP_INFO: Record<ChipKind, { prefix: string; name: string; category: string; polar: boolean }> = {
  R: { prefix: 'R', name: 'Резистор', category: 'Резисторы', polar: false },
  C: { prefix: 'C', name: 'Конденсатор', category: 'Конденсаторы', polar: false },
  L: { prefix: 'L', name: 'Индуктивность', category: 'Индуктивности', polar: false },
  D: { prefix: 'D', name: 'Диод', category: 'Диоды', polar: true },
  LED: { prefix: 'LED', name: 'Светодиод', category: 'Светодиоды', polar: true },
  F: { prefix: 'F', name: 'Предохранитель', category: 'Предохранители', polar: false },
};

export function chip(kind: ChipKind, spec: ChipSpec): FootprintDef {
  const info = CHIP_INFO[kind];
  const pads = [smd('1', -spec.span / 2, 0, spec.pad[0], spec.pad[1]), smd('2', spec.span / 2, 0, spec.pad[0], spec.pad[1])];
  if (info.polar) {
    pads[0].name = 'K';
    pads[1].name = 'A';
  }
  const crt = courtyardAround(pads, { x0: -spec.body[0] / 2, y0: -spec.body[1] / 2, x1: spec.body[0] / 2, y1: spec.body[1] / 2 }, CRT_SMD);
  return fp({
    id: `${kind}_${spec.code}_${spec.metric}Metric`,
    name: `${spec.code}`,
    description: `${info.name} SMD ${spec.code} (${spec.metric} метрич.), ${spec.body[0]}×${spec.body[1]} мм`,
    category: info.category,
    tags: ['smd', spec.code, spec.metric, kind.toLowerCase()],
    refPrefix: info.prefix,
    pads,
    graphics: [...chipGraphics(spec.body, pads, info.polar), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)],
    courtyard: crt,
    source: 'IPC-7351B, номинал',
    verified: spec.verified,
    height: kind === 'C' ? spec.body[1] : 0.6,
  });
}

/** Диоды в корпусах DO-214: SMA, SMB, SMC. */
export function smaDiode(code: 'SMA' | 'SMB' | 'SMC'): FootprintDef {
  const S = {
    SMA: { do: 'DO-214AC', body: [4.3, 2.6] as [number, number], span: 4.0, pad: [1.6, 1.8] as [number, number], h: 2.3 },
    SMB: { do: 'DO-214AA', body: [4.3, 3.6] as [number, number], span: 4.4, pad: [2.15, 2.4] as [number, number], h: 2.4 },
    SMC: { do: 'DO-214AB', body: [6.8, 5.9] as [number, number], span: 6.1, pad: [2.55, 3.4] as [number, number], h: 2.4 },
  }[code];
  const pads = [smd('1', -S.span / 2, 0, S.pad[0], S.pad[1], 'roundrect', { name: 'K' }), smd('2', S.span / 2, 0, S.pad[0], S.pad[1], 'roundrect', { name: 'A' })];
  const crt = courtyardAround(pads, { x0: -S.body[0] / 2, y0: -S.body[1] / 2, x1: S.body[0] / 2, y1: S.body[1] / 2 }, CRT_SMD);
  return fp({
    id: `D_${code}`,
    name: code,
    description: `Диод ${code} (${S.do}), ${S.body[0]}×${S.body[1]} мм`,
    category: 'Диоды',
    tags: ['smd', code, S.do, 'diode'],
    refPrefix: 'D',
    pads,
    graphics: [...chipGraphics(S.body, pads, true), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)],
    courtyard: crt,
    source: 'IPC-7351B / KiCad',
    verified: code !== 'SMC',
    height: S.h,
  });
}

/** SOD-123, SOD-323, SOD-523: маленькие диоды. */
export function sodDiode(code: 'SOD-123' | 'SOD-323' | 'SOD-123F'): FootprintDef {
  const S = {
    'SOD-123': { body: [2.85, 1.8] as [number, number], span: 3.27, pad: [0.91, 1.22] as [number, number], v: true },
    'SOD-123F': { body: [2.8, 1.8] as [number, number], span: 3.2, pad: [1.0, 1.3] as [number, number], v: false },
    'SOD-323': { body: [1.7, 1.25] as [number, number], span: 2.1, pad: [0.6, 0.5] as [number, number], v: false },
  }[code];
  const pads = [smd('1', -S.span / 2, 0, S.pad[0], S.pad[1], 'roundrect', { name: 'K' }), smd('2', S.span / 2, 0, S.pad[0], S.pad[1], 'roundrect', { name: 'A' })];
  const crt = courtyardAround(pads, { x0: -S.body[0] / 2, y0: -S.body[1] / 2, x1: S.body[0] / 2, y1: S.body[1] / 2 }, CRT_SMD);
  return fp({
    id: `D_${code}`,
    name: code,
    description: `Диод ${code}, ${S.body[0]}×${S.body[1]} мм`,
    category: 'Диоды',
    tags: ['smd', code, 'diode'],
    refPrefix: 'D',
    pads,
    graphics: [...chipGraphics(S.body, pads, true), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)],
    courtyard: crt,
    source: 'IPC-7351B / KiCad',
    verified: S.v,
    height: 1.1,
  });
}

/** Танталовые конденсаторы (EIA): A 3216, B 3528, C 6032, D 7343. */
export function tantalum(code: 'A' | 'B' | 'C' | 'D'): FootprintDef {
  const S = {
    A: { metric: '3216-18', body: [3.2, 1.6] as [number, number], span: 2.8, pad: [1.4, 1.4] as [number, number] },
    B: { metric: '3528-21', body: [3.5, 2.8] as [number, number], span: 3.05, pad: [1.4, 2.4] as [number, number] },
    C: { metric: '6032-28', body: [6.0, 3.2] as [number, number], span: 5.3, pad: [2.2, 2.4] as [number, number] },
    D: { metric: '7343-31', body: [7.3, 4.3] as [number, number], span: 6.4, pad: [2.4, 2.6] as [number, number] },
  }[code];
  const pads = [smd('1', -S.span / 2, 0, S.pad[0], S.pad[1], 'roundrect', { name: '+' }), smd('2', S.span / 2, 0, S.pad[0], S.pad[1], 'roundrect', { name: '-' })];
  const crt = courtyardAround(pads, { x0: -S.body[0] / 2, y0: -S.body[1] / 2, x1: S.body[0] / 2, y1: S.body[1] / 2 }, CRT_SMD);
  return fp({
    id: `CP_EIA-${S.metric}_Kemet-${code}`,
    name: `Тантал ${code}`,
    description: `Танталовый конденсатор, типоразмер ${code} (EIA ${S.metric}), плюс — вывод 1`,
    category: 'Конденсаторы',
    tags: ['smd', 'tantalum', code, S.metric],
    refPrefix: 'C',
    pads,
    graphics: [...chipGraphics(S.body, pads, true), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)],
    courtyard: crt,
    source: 'IPC-7351B, номинал',
    verified: false,
    height: 2.0,
  });
}

/** Двухрядный планарный корпус: SOIC, TSSOP, MSOP, SSOP. Выводы против часовой стрелки, вывод 1 слева сверху. */
export function dualRow(o: {
  id: string;
  name: string;
  description: string;
  pins: number;
  pitch: number;
  /** Ширина и длина корпуса. */
  body: [number, number];
  /** Расстояние между центрами площадок противоположных рядов. */
  padSpan: number;
  pad: [number, number];
  verified?: boolean;
  height?: number;
  tags?: string[];
}): FootprintDef {
  const n = o.pins / 2;
  const pads: PadDef[] = [];
  const y0 = -((n - 1) * o.pitch) / 2;
  for (let i = 0; i < n; i++) pads.push(smd(String(i + 1), -o.padSpan / 2, y0 + i * o.pitch, o.pad[0], o.pad[1]));
  for (let i = 0; i < n; i++) pads.push(smd(String(n + i + 1), o.padSpan / 2, y0 + (n - 1 - i) * o.pitch, o.pad[0], o.pad[1]));
  const [bw, bl] = o.body;
  const crt = courtyardAround(pads, { x0: -bw / 2, y0: -bl / 2, x1: bw / 2, y1: bl / 2 }, CRT_SMD);
  const ch = Math.min(1, bw * 0.2);
  const g: Graphic[] = [
    poly(
      'F.Fab',
      [
        { x: -bw / 2 + ch, y: -bl / 2 },
        { x: bw / 2, y: -bl / 2 },
        { x: bw / 2, y: bl / 2 },
        { x: -bw / 2, y: bl / 2 },
        { x: -bw / 2, y: -bl / 2 + ch },
      ],
      FAB_W,
    ),
    // Шелкография: короткие штрихи по торцам и метка первого вывода.
    line('F.Silk', { x: -bw / 2 - 0.1, y: -bl / 2 - 0.1 }, { x: bw / 2 + 0.1, y: -bl / 2 - 0.1 }),
    line('F.Silk', { x: -bw / 2 - 0.1, y: bl / 2 + 0.1 }, { x: bw / 2 + 0.1, y: bl / 2 + 0.1 }),
    line('F.Silk', { x: -bw / 2 - 0.1, y: -bl / 2 - 0.1 }, { x: r2(-o.padSpan / 2 - o.pad[0] / 2 - 0.15), y: -bl / 2 - 0.1 }, 0.15),
    line('F.Silk', { x: r2(-o.padSpan / 2 - o.pad[0] / 2 - 0.15), y: -bl / 2 - 0.1 }, { x: r2(-o.padSpan / 2 - o.pad[0] / 2 - 0.15), y: r2(y0 - o.pad[1] / 2) }, 0.15),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  return fp({
    id: o.id,
    name: o.name,
    description: o.description,
    category: 'Микросхемы',
    tags: ['smd', 'ic', ...(o.tags ?? [])],
    refPrefix: 'U',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'IPC-7351B / KiCad',
    verified: o.verified ?? true,
    height: o.height ?? 1.75,
  });
}

export function soic(pins: 8 | 14 | 16 | 20): FootprintDef {
  const len = { 8: 4.9, 14: 8.65, 16: 9.9, 20: 12.8 }[pins];
  return dualRow({
    id: `SOIC-${pins}_3.9x${len}mm_P1.27mm`,
    name: `SOIC-${pins}`,
    description: `SOIC-${pins}, корпус 3,9×${len} мм, шаг 1,27 мм`,
    pins,
    pitch: 1.27,
    body: [3.9, len],
    padSpan: 5.4,
    pad: [1.55, 0.6],
    tags: ['soic', 'so'],
  });
}

export function soicWide(pins: 16 | 20 | 24 | 28): FootprintDef {
  const len = { 16: 10.3, 20: 12.8, 24: 15.4, 28: 17.9 }[pins];
  return dualRow({
    id: `SOIC-${pins}W_7.5x${len}mm_P1.27mm`,
    name: `SOIC-${pins}W`,
    description: `SOIC-${pins} широкий, корпус 7,5×${len} мм, шаг 1,27 мм`,
    pins,
    pitch: 1.27,
    body: [7.5, len],
    padSpan: 9.3,
    pad: [1.6, 0.6],
    tags: ['soic', 'so', 'wide'],
    verified: false,
    height: 2.65,
  });
}

export function tssop(pins: 8 | 14 | 16 | 20 | 24 | 28): FootprintDef {
  const len = { 8: 3.0, 14: 5.0, 16: 5.0, 20: 6.5, 24: 7.8, 28: 9.7 }[pins];
  return dualRow({
    id: `TSSOP-${pins}_4.4x${len}mm_P0.65mm`,
    name: `TSSOP-${pins}`,
    description: `TSSOP-${pins}, корпус 4,4×${len} мм, шаг 0,65 мм`,
    pins,
    pitch: 0.65,
    body: [4.4, len],
    padSpan: 5.75,
    pad: [1.35, 0.45],
    tags: ['tssop'],
    height: 1.2,
  });
}

export function msop(pins: 8 | 10): FootprintDef {
  return dualRow({
    id: `MSOP-${pins}_3x3mm_P${pins === 8 ? '0.65' : '0.5'}mm`,
    name: `MSOP-${pins}`,
    description: `MSOP-${pins}, корпус 3×3 мм, шаг ${pins === 8 ? '0,65' : '0,5'} мм`,
    pins,
    pitch: pins === 8 ? 0.65 : 0.5,
    body: [3.0, 3.0],
    padSpan: 4.4,
    pad: [1.45, pins === 8 ? 0.45 : 0.3],
    tags: ['msop'],
    height: 1.1,
  });
}

/** SOT-23 и родня. */
export function sot23(variant: 'SOT-23' | 'SOT-23-5' | 'SOT-23-6' | 'SOT-323'): FootprintDef {
  let pads: PadDef[];
  let body: [number, number];
  let h = 1.1;
  if (variant === 'SOT-23') {
    pads = [smd('1', -1.0, 0.95, 0.9, 0.8), smd('2', -1.0, -0.95, 0.9, 0.8), smd('3', 1.0, 0, 0.9, 0.8)];
    body = [1.3, 2.9];
  } else if (variant === 'SOT-323') {
    pads = [smd('1', -0.95, 0.65, 0.65, 0.5), smd('2', -0.95, -0.65, 0.65, 0.5), smd('3', 0.95, 0, 0.65, 0.5)];
    body = [1.25, 2.0];
    h = 0.9;
  } else {
    pads = [smd('1', -1.1, 0.95, 1.06, 0.65), smd('2', -1.1, 0, 1.06, 0.65), smd('3', -1.1, -0.95, 1.06, 0.65), smd('4', 1.1, -0.95, 1.06, 0.65)];
    if (variant === 'SOT-23-6') pads.push(smd('5', 1.1, 0, 1.06, 0.65), smd('6', 1.1, 0.95, 1.06, 0.65));
    else pads.push(smd('5', 1.1, 0.95, 1.06, 0.65));
    body = [1.6, 2.9];
  }
  // В IPC вывод 1 внизу слева при повёрнутом корпусе; здесь корпус стоит вертикально, вывод 1 внизу слева (y > 0).
  const crt = courtyardAround(pads, { x0: -body[0] / 2, y0: -body[1] / 2, x1: body[0] / 2, y1: body[1] / 2 }, CRT_SMD);
  const g: Graphic[] = [
    rect('F.Fab', -body[0] / 2, -body[1] / 2, body[0] / 2, body[1] / 2, FAB_W),
    line('F.Silk', { x: -body[0] / 2 - 0.1, y: -body[1] / 2 - 0.1 }, { x: body[0] / 2 + 0.1, y: -body[1] / 2 - 0.1 }),
    line('F.Silk', { x: -body[0] / 2 - 0.1, y: body[1] / 2 + 0.1 }, { x: body[0] / 2 + 0.1, y: body[1] / 2 + 0.1 }),
    line('F.Silk', { x: -body[0] / 2 - 0.1, y: body[1] / 2 + 0.1 }, { x: r2(pads[0].at.x - pads[0].size.x / 2 - 0.2), y: body[1] / 2 + 0.1 }, 0.15),
    crtGraphic(crt),
    refText(crt.min.y - 0.7),
    valueText(crt.max.y + 0.7),
  ];
  return fp({
    id: variant,
    name: variant,
    description: `${variant}, ${pads.length} вывода`,
    category: 'Транзисторы и мелкие корпуса',
    tags: ['smd', 'sot', variant.toLowerCase()],
    refPrefix: variant === 'SOT-23' || variant === 'SOT-323' ? 'Q' : 'U',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'IPC-7351B / KiCad',
    verified: variant !== 'SOT-323',
    height: h,
  });
}

export function sot223(): FootprintDef {
  const pads = [smd('1', -2.3, 3.15, 1.2, 2.2), smd('2', 0, 3.15, 1.2, 2.2), smd('3', 2.3, 3.15, 1.2, 2.2), smd('4', 0, -3.15, 3.6, 2.2)];
  const body: [number, number] = [6.5, 3.5];
  const crt = courtyardAround(pads, { x0: -body[0] / 2, y0: -body[1] / 2, x1: body[0] / 2, y1: body[1] / 2 }, CRT_SMD);
  return fp({
    id: 'SOT-223',
    name: 'SOT-223',
    description: 'SOT-223, 3 вывода и теплоотводящая площадка (вывод 4)',
    category: 'Транзисторы и мелкие корпуса',
    tags: ['smd', 'sot', 'sot-223', 'regulator'],
    refPrefix: 'U',
    pads,
    graphics: [
      rect('F.Fab', -body[0] / 2, -body[1] / 2, body[0] / 2, body[1] / 2, FAB_W),
      line('F.Silk', { x: -body[0] / 2 - 0.1, y: -body[1] / 2 - 0.1 }, { x: -2.0, y: -body[1] / 2 - 0.1 }),
      line('F.Silk', { x: 2.0, y: -body[1] / 2 - 0.1 }, { x: body[0] / 2 + 0.1, y: -body[1] / 2 - 0.1 }),
      line('F.Silk', { x: -body[0] / 2 - 0.1, y: body[1] / 2 + 0.1 }, { x: -3.1, y: body[1] / 2 + 0.1 }, 0.15),
      line('F.Silk', { x: 3.1, y: body[1] / 2 + 0.1 }, { x: body[0] / 2 + 0.1, y: body[1] / 2 + 0.1 }),
      crtGraphic(crt),
      refText(crt.min.y - 0.7),
      valueText(0, 0, 0.8),
    ],
    courtyard: crt,
    source: 'IPC-7351B / KiCad',
    verified: true,
    height: 1.8,
  });
}

/** Четырёхсторонний корпус QFP/TQFP/LQFP. Вывод 1 слева сверху, обход против часовой стрелки. */
export function qfp(o: { pins: number; body: number; pitch: number; leadSpan: number; name?: string; verified?: boolean }): FootprintDef {
  const perSide = o.pins / 4;
  const padLen = 1.5;
  const padW = o.pitch <= 0.5 ? 0.3 : o.pitch <= 0.65 ? 0.4 : 0.55;
  const c = o.leadSpan / 2 - 0.25;
  const pads: PadDef[] = [];
  const s0 = -((perSide - 1) * o.pitch) / 2;
  let n = 1;
  for (let i = 0; i < perSide; i++) pads.push(smd(String(n++), -c, s0 + i * o.pitch, padLen, padW));
  for (let i = 0; i < perSide; i++) pads.push(smd(String(n++), s0 + i * o.pitch, c, padW, padLen));
  for (let i = 0; i < perSide; i++) pads.push(smd(String(n++), c, s0 + (perSide - 1 - i) * o.pitch, padLen, padW));
  for (let i = 0; i < perSide; i++) pads.push(smd(String(n++), s0 + (perSide - 1 - i) * o.pitch, -c, padW, padLen));
  const b = o.body / 2;
  const crt = courtyardAround(pads, { x0: -b, y0: -b, x1: b, y1: b }, CRT_SMD);
  const k = Math.abs(s0) + o.pitch / 2 + 0.3;
  const corner = (sx: number, sy: number): Graphic[] => [
    line('F.Silk', { x: sx * (b + 0.1), y: sy * (b + 0.1) }, { x: sx * (b + 0.1), y: sy * k }),
    line('F.Silk', { x: sx * (b + 0.1), y: sy * (b + 0.1) }, { x: sx * k, y: sy * (b + 0.1) }),
  ];
  const name = o.name ?? `TQFP-${o.pins}`;
  return fp({
    id: `${name}_${o.body}x${o.body}mm_P${o.pitch}mm`,
    name,
    description: `${name}, корпус ${o.body}×${o.body} мм, шаг ${String(o.pitch).replace('.', ',')} мм`,
    category: 'Микросхемы',
    tags: ['smd', 'ic', 'qfp'],
    refPrefix: 'U',
    pads,
    graphics: [
      poly('F.Fab', [{ x: -b + 1, y: -b }, { x: b, y: -b }, { x: b, y: b }, { x: -b, y: b }, { x: -b, y: -b + 1 }], FAB_W),
      ...corner(1, 1),
      ...corner(1, -1),
      ...corner(-1, 1),
      line('F.Silk', { x: -(b + 0.1), y: -(b + 0.1) }, { x: -(b + 0.1), y: -k }),
      line('F.Silk', { x: -(b + 0.1), y: -(b + 0.1) }, { x: -k, y: -(b + 0.1) }),
      line('F.Silk', { x: -(b + 0.1), y: -k }, { x: r2(-c - padLen / 2 - 0.2), y: -k }, 0.15),
      crtGraphic(crt),
      refText(crt.min.y - 0.7),
      valueText(0, 0, 0.9),
    ],
    courtyard: crt,
    source: 'IPC-7351B, номинал',
    verified: o.verified ?? false,
    height: 1.2,
  });
}

export function allSmd(): FootprintDef[] {
  const out: FootprintDef[] = [];
  for (const s of CHIP_SPECS) {
    out.push(chip('R', s), chip('C', s));
    if (s.code !== '0402' && s.code !== '2010' && s.code !== '2512') out.push(chip('L', s));
    if (s.code === '0603' || s.code === '0805' || s.code === '1206') out.push(chip('LED', s), chip('D', s));
    if (s.code === '1206' || s.code === '2512') out.push(chip('F', s));
  }
  out.push(smaDiode('SMA'), smaDiode('SMB'), smaDiode('SMC'), sodDiode('SOD-123'), sodDiode('SOD-123F'), sodDiode('SOD-323'));
  out.push(tantalum('A'), tantalum('B'), tantalum('C'), tantalum('D'));
  out.push(soic(8), soic(14), soic(16), soic(20), soicWide(16), soicWide(20), soicWide(28));
  out.push(tssop(8), tssop(14), tssop(16), tssop(20), tssop(28), msop(8), msop(10));
  out.push(sot23('SOT-23'), sot23('SOT-23-5'), sot23('SOT-23-6'), sot23('SOT-323'), sot223());
  out.push(
    qfp({ pins: 32, body: 7, pitch: 0.8, leadSpan: 9, verified: true }),
    qfp({ pins: 44, body: 10, pitch: 0.8, leadSpan: 12, verified: true }),
    qfp({ pins: 48, body: 7, pitch: 0.5, leadSpan: 9, verified: true }),
    qfp({ pins: 64, body: 10, pitch: 0.5, leadSpan: 12, verified: true }),
    qfp({ pins: 100, body: 14, pitch: 0.5, leadSpan: 16, name: 'LQFP-100' }),
  );
  return out;
}
