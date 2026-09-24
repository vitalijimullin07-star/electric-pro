import type { FootprintDef, Graphic, PadDef } from '../../model/types';
import { CAT } from '../categories';
import { chip, smaDiode, sodDiode } from './smd';
import { axialDiode, dip, ledRound } from './tht';
import { CRT_SMD, FAB_W, SILK_W, boxFootprint, circle, courtyardAround, crtGraphic, fp, line, rect, refText, rowX, smd, tht, twoPadSmd, twoPinTht, valueText } from './util';

/* Диоды и светодиоды: SMD (SOD, DO-214, MELF), выводные, диодные мосты, светодиоды SMD и выводные. */

const GD = { smd: 'SMD', tht: 'Выводные', bridge: 'Диодные мосты' };
const GL = { smd: 'SMD', tht: 'Выводные', special: 'Специальные' };

/** Диодный мост в линию (KBP/KBL/GBU): 4 вывода с шагом 5,08 мм, стоит вертикально. */
function bridgeInline(kind: 'KBP' | 'KBU' | 'GBU' | 'KBL'): FootprintDef {
  const S = { KBP: { body: [21.5, 4.5] as [number, number], h: 14.5, pitch: 5.08, drill: 1.1, pad: 2.2 }, KBL: { body: [20.5, 4.0] as [number, number], h: 15, pitch: 5.08, drill: 1.1, pad: 2.2 }, KBU: { body: [22.5, 6.5] as [number, number], h: 19, pitch: 5.08, drill: 1.4, pad: 2.6 }, GBU: { body: [22.5, 4.0] as [number, number], h: 18, pitch: 5.08, drill: 1.4, pad: 2.6 } }[kind];
  const names = ['~', '+', '~', '-'];
  const pads = rowX(4, S.pitch, (i, x) => tht(String(i + 1), x, 0, S.pad, S.pad, S.drill, i === 0 ? 'rect' : 'circle', { name: names[i] }));
  return boxFootprint({
    id: `D_Bridge_${kind}_P5.08mm`,
    name: `Мост ${kind}`,
    description: `Диодный мост ${kind}, 4 вывода в линию с шагом 5,08 мм, стоит вертикально. Порядок выводов (~, +, ~, −) сверить с даташитом`,
    category: CAT.D,
    group: GD.bridge,
    refPrefix: 'D',
    pads,
    body: { x0: -S.body[0] / 2, y0: -S.body[1] / 2, x1: S.body[0] / 2, y1: S.body[1] / 2 },
    verified: false,
    height: S.h,
    tags: ['bridge', 'rectifier', kind.toLowerCase()],
  });
}

/** Круглый диодный мост KBPC (35 A): 4 вывода квадратом 18,8 мм, крепление в центре. */
function bridgeRound(): FootprintDef {
  const k = 9.4;
  const pads: PadDef[] = [tht('1', -k, -k, 4.0, 4.0, 2.0, 'rect', { name: '~' }), tht('2', k, -k, 4.0, 4.0, 2.0, 'circle', { name: '+' }), tht('3', k, k, 4.0, 4.0, 2.0, 'circle', { name: '~' }), tht('4', -k, k, 4.0, 4.0, 2.0, 'circle', { name: '-' })];
  pads.push({ number: '', type: 'npth', shape: 'circle', at: { x: 0, y: 0 }, size: { x: 4.5, y: 4.5 }, drill: 4.5 });
  return boxFootprint({
    id: 'D_Bridge_KBPC_Round_28mm',
    name: 'Мост KBPC круглый',
    description: 'Диодный мост KBPC (35 A) Ø28,5 мм, 4 плоских вывода квадратом 18,8 мм, отверстие M4 в центре. Раскладку выводов сверить с корпусом',
    category: CAT.D,
    group: GD.bridge,
    refPrefix: 'D',
    pads,
    body: { x0: -14.3, y0: -14.3, x1: 14.3, y1: 14.3 },
    extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 14.25, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 14.4, SILK_W)],
    noSilk: true,
    verified: false,
    height: 11,
    tags: ['bridge', 'rectifier', 'kbpc'],
  });
}

/** Светодиод PLCC-2 (3528 / 5050 одноцветные) и PLCC-4/6 (RGB). */
function ledPlcc(kind: 'PLCC-2_3528' | 'PLCC-2_5050' | 'PLCC-4_5050' | 'PLCC-6_5050' | 'PLCC-4_3528'): FootprintDef {
  const body: [number, number] = kind.includes('3528') ? [3.5, 2.8] : [5.0, 5.0];
  const pads: PadDef[] = [];
  if (kind.startsWith('PLCC-2')) {
    const span = kind.includes('3528') ? 3.4 : 5.4;
    const pw = kind.includes('3528') ? 1.4 : 2.0;
    const ph = kind.includes('3528') ? 2.4 : 3.2;
    pads.push(smd('1', -span / 2, 0, pw, ph, 'roundrect', { name: 'K' }), smd('2', span / 2, 0, pw, ph, 'roundrect', { name: 'A' }));
  } else if (kind === 'PLCC-4_5050' || kind === 'PLCC-4_3528') {
    const span = kind.includes('3528') ? 3.4 : 5.4;
    const pw = kind.includes('3528') ? 1.4 : 1.6;
    const ph = kind.includes('3528') ? 1.0 : 1.6;
    const dy = kind.includes('3528') ? 0.95 : 1.6;
    pads.push(smd('1', -span / 2, dy, pw, ph), smd('2', -span / 2, -dy, pw, ph), smd('3', span / 2, -dy, pw, ph), smd('4', span / 2, dy, pw, ph));
  } else {
    const span = 5.4;
    for (let i = 0; i < 3; i++) pads.push(smd(String(i + 1), -span / 2, 1.6 - i * 1.6, 1.6, 1.0));
    for (let i = 0; i < 3; i++) pads.push(smd(String(i + 4), span / 2, -1.6 + i * 1.6, 1.6, 1.0));
  }
  const [L, W] = body;
  const crt = courtyardAround(pads, { x0: -L / 2, y0: -W / 2, x1: L / 2, y1: W / 2 }, CRT_SMD);
  const g: Graphic[] = [rect('F.Fab', -L / 2, -W / 2, L / 2, W / 2, FAB_W), circle('F.Fab', { x: 0, y: 0 }, Math.min(L, W) * 0.35, FAB_W), line('F.Silk', { x: -L / 2 - 0.1, y: W / 2 + 0.1 }, { x: -L / 2 + 0.8, y: W / 2 + 0.1 }, 0.15), line('F.Silk', { x: -L / 2 - 0.1, y: W / 2 + 0.1 }, { x: -L / 2 - 0.1, y: W / 2 - 0.7 }, 0.15), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)];
  const rgb = kind.startsWith('PLCC-6') || kind === 'PLCC-4_5050';
  return fp({
    id: `LED_${kind}`,
    name: kind.replace('_', ' '),
    description: `${rgb ? 'RGB-светодиод' : 'Светодиод'} ${kind.replace('_', ' ')}, корпус ${L}×${W} мм, вывод 1 у скошенного угла (слева снизу)`,
    category: CAT.LED,
    group: GL.smd,
    tags: ['smd', 'led', 'plcc', ...(rgb ? ['rgb'] : [])],
    refPrefix: 'LED',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Типовые размеры',
    verified: false,
    height: 1.6,
  });
}

/** Адресуемый светодиод WS2812B 5050 (4 вывода) и WS2812B-2020. */
function ws2812(kind: '5050' | '2020'): FootprintDef {
  const pads = kind === '5050' ? [smd('1', -2.45, 1.6, 1.5, 1.0, 'roundrect', { name: 'VDD' }), smd('2', -2.45, -1.6, 1.5, 1.0, 'roundrect', { name: 'DOUT' }), smd('3', 2.45, -1.6, 1.5, 1.0, 'roundrect', { name: 'GND' }), smd('4', 2.45, 1.6, 1.5, 1.0, 'roundrect', { name: 'DIN' })] : [smd('1', -0.9, 0.55, 0.65, 0.5, 'roundrect', { name: 'DOUT' }), smd('2', -0.9, -0.55, 0.65, 0.5, 'roundrect', { name: 'GND' }), smd('3', 0.9, -0.55, 0.65, 0.5, 'roundrect', { name: 'DIN' }), smd('4', 0.9, 0.55, 0.65, 0.5, 'roundrect', { name: 'VDD' })];
  const b = kind === '5050' ? 2.5 : 1.0;
  return boxFootprint({
    id: `LED_WS2812B_${kind}`,
    name: `WS2812B ${kind}`,
    description: `Адресуемый RGB-светодиод WS2812B в корпусе ${kind}, вывод 1 у скошенного угла. Назначение выводов сверить с даташитом партии`,
    category: CAT.LED,
    group: GL.special,
    refPrefix: 'LED',
    pads,
    body: { x0: -b, y0: -b, x1: b, y1: b },
    smd: true,
    extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, b * 0.7, FAB_W)],
    verified: false,
    height: kind === '5050' ? 1.6 : 0.9,
    tags: ['led', 'rgb', 'ws2812', 'neopixel'],
  });
}

export function allDiodes(): FootprintDef[] {
  const out: FootprintDef[] = [];
  // SMD диоды.
  for (const k of ['SMA', 'SMB', 'SMC'] as const) out.push({ ...smaDiode(k), group: GD.smd });
  for (const k of ['SOD-123', 'SOD-123F', 'SOD-323'] as const) out.push({ ...sodDiode(k), group: GD.smd });
  out.push(
    twoPadSmd({ id: 'D_SOD-523', name: 'SOD-523', description: 'Диод SOD-523 (0603-подобный), 1,2×0,8 мм, катод — вывод 1', category: CAT.D, group: GD.smd, refPrefix: 'D', span: 1.5, pad: [0.6, 0.6], body: [1.2, 0.8], polar: true, padNames: ['K', 'A'], tags: ['diode', 'sod-523'], verified: false, height: 0.7 }),
    twoPadSmd({ id: 'D_SOD-80_MELF', name: 'MELF SOD-80', description: 'Диод в цилиндрическом корпусе MELF/SOD-80 (LL34), Ø1,6×3,5 мм, катод — вывод 1', category: CAT.D, group: GD.smd, refPrefix: 'D', span: 3.4, pad: [1.4, 1.8], body: [3.5, 1.6], polar: true, padNames: ['K', 'A'], tags: ['diode', 'melf', 'll34'], verified: false, height: 1.6 }),
    twoPadSmd({ id: 'D_MiniMELF_LL41', name: 'MiniMELF LL41', description: 'Диод MiniMELF (LL41), Ø2,7×5 мм, катод — вывод 1', category: CAT.D, group: GD.smd, refPrefix: 'D', span: 4.6, pad: [1.6, 2.6], body: [5.0, 2.7], polar: true, padNames: ['K', 'A'], tags: ['diode', 'melf', 'll41'], verified: false, height: 2.7 }),
    twoPadSmd({ id: 'D_SMAF', name: 'SMAF', description: 'Диод SMAF (тонкий SMA), 3,5×2,7 мм, катод — вывод 1', category: CAT.D, group: GD.smd, refPrefix: 'D', span: 3.5, pad: [1.4, 1.6], body: [3.5, 2.7], polar: true, padNames: ['K', 'A'], tags: ['diode', 'smaf'], verified: false, height: 1.1 }),
    twoPadSmd({ id: 'D_SMBF', name: 'SMBF', description: 'Диод SMBF (тонкий SMB), 4,3×3,6 мм, катод — вывод 1', category: CAT.D, group: GD.smd, refPrefix: 'D', span: 4.2, pad: [1.6, 2.4], body: [4.3, 3.6], polar: true, padNames: ['K', 'A'], tags: ['diode', 'smbf'], verified: false, height: 1.1 }),
    twoPadSmd({ id: 'D_PowerDI-123', name: 'PowerDI-123', description: 'Диод PowerDI-123 (Diodes Inc.), 3,0×1,8 мм, катод — вывод 1', category: CAT.D, group: GD.smd, refPrefix: 'D', span: 2.6, pad: [1.4, 1.5], body: [3.0, 1.8], polar: true, padNames: ['K', 'A'], tags: ['diode', 'powerdi'], verified: false, height: 1.0 }),
    { ...chip('D', { code: '0603', metric: '1608', body: [1.6, 0.8], span: 1.65, pad: [0.8, 0.95], verified: true }), group: GD.smd },
    { ...chip('D', { code: '0805', metric: '2012', body: [2.0, 1.25], span: 1.825, pad: [1.025, 1.4], verified: true }), group: GD.smd },
    { ...chip('D', { code: '1206', metric: '3216', body: [3.2, 1.6], span: 2.925, pad: [1.125, 1.75], verified: true }), group: GD.smd },
  );
  // Выводные диоды.
  for (const k of ['DO-35', 'DO-41', 'DO-15', 'DO-201'] as const) out.push({ ...axialDiode(k), group: GD.tht });
  out.push(
    twoPinTht({ id: 'D_DO-27_P15.24mm_Horizontal', name: 'DO-27', description: 'Диод DO-27 (1N5400 и т. п.), корпус 9,5×5,3 мм, шаг 15,24 мм, катод — вывод 1', category: CAT.D, group: GD.tht, refPrefix: 'D', pitch: 15.24, drill: 1.4, pad: 2.6, body: { len: 9.5, wid: 5.3 }, polar: true, padNames: ['K', 'A'], tags: ['diode', 'do-27'], verified: true, height: 5.3 }),
    twoPinTht({ id: 'D_DO-41_P5.08mm_Vertical', name: 'DO-41 стоя', description: 'Диод DO-41 вертикально, шаг 5,08 мм, катод — вывод 1', category: CAT.D, group: GD.tht, refPrefix: 'D', pitch: 5.08, drill: 1.1, pad: 2.2, body: { d: 2.7, at: 0 }, polar: true, padNames: ['K', 'A'], tags: ['diode', 'do-41', 'vertical'], verified: true, height: 6 }),
    twoPinTht({ id: 'D_DO-35_P2.54mm_Vertical', name: 'DO-35 стоя', description: 'Диод DO-35 вертикально, шаг 2,54 мм, катод — вывод 1', category: CAT.D, group: GD.tht, refPrefix: 'D', pitch: 2.54, drill: 0.8, pad: 1.6, body: { d: 1.9, at: 0 }, polar: true, padNames: ['K', 'A'], tags: ['diode', 'do-35', 'vertical'], verified: true, height: 5 }),
    twoPinTht({ id: 'D_P600_P20.32mm_Horizontal', name: 'P600 (6 А)', description: 'Мощный диод P600 (6A10), корпус Ø9,1×9,1 мм, шаг 20,32 мм, катод — вывод 1', category: CAT.D, group: GD.tht, refPrefix: 'D', pitch: 20.32, drill: 1.6, pad: 3.0, body: { len: 9.1, wid: 9.1 }, polar: true, padNames: ['K', 'A'], tags: ['diode', 'p600'], verified: false, height: 9.1 }),
    twoPinTht({ id: 'D_R-6_P20mm_Horizontal', name: 'R-6 (10 А)', description: 'Диод R-6 (10A10), корпус Ø9,5×9,5 мм, шаг 20 мм, катод — вывод 1', category: CAT.D, group: GD.tht, refPrefix: 'D', pitch: 20.0, drill: 1.6, pad: 3.0, body: { len: 9.5, wid: 9.5 }, polar: true, padNames: ['K', 'A'], tags: ['diode', 'r-6'], verified: false, height: 9.5 }),
  );
  // Мосты.
  out.push(bridgeInline('KBP'), bridgeInline('KBL'), bridgeInline('KBU'), bridgeInline('GBU'), bridgeRound());
  out.push({ ...dip(4), id: 'D_Bridge_DIP-4_DB107', name: 'Мост DB107 (DIP-4)', description: 'Диодный мост DB107/DF10 в корпусе DIP-4, ряды 7,62 мм', category: CAT.D, group: GD.bridge, refPrefix: 'D', tags: ['bridge', 'db107', 'dip'] });
  out.push(
    boxFootprint({
      id: 'D_Bridge_MBS_SOP-4',
      name: 'Мост MBS (SOP-4)',
      description: 'Диодный мост MB2S–MB10S в корпусе MBS/TO-269AA, 4 вывода, шаг 2,3 мм',
      category: CAT.D,
      group: GD.bridge,
      refPrefix: 'D',
      pads: [smd('1', -1.15, 2.0, 1.0, 1.4, 'roundrect', { name: '~' }), smd('2', 1.15, 2.0, 1.0, 1.4, 'roundrect', { name: '-' }), smd('3', 1.15, -2.0, 1.0, 1.4, 'roundrect', { name: '~' }), smd('4', -1.15, -2.0, 1.0, 1.4, 'roundrect', { name: '+' })],
      body: { x0: -1.85, y0: -1.5, x1: 1.85, y1: 1.5 },
      smd: true,
      verified: false,
      height: 1.1,
      tags: ['bridge', 'mbs'],
    }),
  );
  return out;
}

export function allLeds(): FootprintDef[] {
  const out: FootprintDef[] = [];
  for (const [code, metric, body, span, pad] of [
    ['0603', '1608', [1.6, 0.8], 1.65, [0.8, 0.95]],
    ['0805', '2012', [2.0, 1.25], 1.825, [1.025, 1.4]],
    ['1206', '3216', [3.2, 1.6], 2.925, [1.125, 1.75]],
  ] as [string, string, [number, number], number, [number, number]][])
    out.push({ ...chip('LED', { code, metric, body, span, pad, verified: true }), group: GL.smd });
  out.push(ledPlcc('PLCC-2_3528'), ledPlcc('PLCC-2_5050'), ledPlcc('PLCC-4_3528'), ledPlcc('PLCC-4_5050'), ledPlcc('PLCC-6_5050'), ws2812('5050'), ws2812('2020'));
  out.push({ ...ledRound(3), group: GL.tht }, { ...ledRound(5), group: GL.tht });
  out.push(
    twoPinTht({ id: 'LED_D10.0mm', name: 'LED 10 мм', description: 'Светодиод Ø10 мм, шаг 2,54 мм, катод — вывод 1', category: CAT.LED, group: GL.tht, refPrefix: 'LED', pitch: 2.54, drill: 0.9, pad: 1.8, body: { d: 10.5 }, polar: true, padNames: ['K', 'A'], tags: ['led', '10mm'], verified: true, height: 13 }),
    twoPinTht({ id: 'LED_D8.0mm', name: 'LED 8 мм', description: 'Светодиод Ø8 мм, шаг 2,54 мм, катод — вывод 1', category: CAT.LED, group: GL.tht, refPrefix: 'LED', pitch: 2.54, drill: 0.9, pad: 1.8, body: { d: 8.3 }, polar: true, padNames: ['K', 'A'], tags: ['led', '8mm'], verified: false, height: 11 }),
    twoPinTht({ id: 'LED_Rectangular_W5.0mm_H2.0mm', name: 'LED 2×5 прямоугольный', description: 'Прямоугольный светодиод 2×5×7 мм, шаг 2,54 мм, катод — вывод 1', category: CAT.LED, group: GL.tht, refPrefix: 'LED', pitch: 2.54, drill: 0.9, pad: 1.8, body: { len: 5.0, wid: 2.0 }, polar: true, padNames: ['K', 'A'], tags: ['led', 'rectangular'], verified: true, height: 7 }),
    twoPinTht({ id: 'LED_D3.0mm_Horizontal', name: 'LED 3 мм лежа', description: 'Светодиод Ø3 мм, установлен горизонтально к краю платы (выводы согнуты), шаг 2,54 мм', category: CAT.LED, group: GL.tht, refPrefix: 'LED', pitch: 2.54, drill: 0.9, pad: 1.8, body: { len: 3.4, wid: 3.0 }, polar: true, padNames: ['K', 'A'], tags: ['led', '3mm', 'horizontal'], verified: false, height: 3 }),
    twoPinTht({ id: 'LED_D5.0mm_Horizontal', name: 'LED 5 мм лежа', description: 'Светодиод Ø5 мм горизонтально к краю платы, шаг 2,54 мм', category: CAT.LED, group: GL.tht, refPrefix: 'LED', pitch: 2.54, drill: 0.9, pad: 1.8, body: { len: 5.5, wid: 5.0 }, polar: true, padNames: ['K', 'A'], tags: ['led', '5mm', 'horizontal'], verified: false, height: 5 }),
  );
  // Специальные выводные: RGB 4 вывода, двухцветный 3 вывода, ИК пара.
  out.push(
    boxFootprint({
      id: 'LED_D5.0mm-4_RGB',
      name: 'LED 5 мм RGB',
      description: 'RGB-светодиод Ø5 мм с общим выводом, 4 вывода в линию с шагом 1,27 мм (R, общий, G, B — сверить)',
      category: CAT.LED,
      group: GL.special,
      refPrefix: 'LED',
      pads: rowX(4, 1.27, (i, x) => tht(String(i + 1), x, 0, 1.0, 1.5, 0.7, 'oval', { name: ['R', 'COM', 'G', 'B'][i] })),
      body: { x0: -2.9, y0: -2.9, x1: 2.9, y1: 2.9 },
      extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 2.9, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 3.0, SILK_W)],
      noSilk: true,
      verified: false,
      height: 8.6,
      tags: ['led', 'rgb', '5mm'],
    }),
    boxFootprint({
      id: 'LED_D5.0mm-3_Bicolor',
      name: 'LED 5 мм двухцветный',
      description: 'Двухцветный светодиод Ø5 мм, 3 вывода в линию с шагом 2,54 мм, средний — общий',
      category: CAT.LED,
      group: GL.special,
      refPrefix: 'LED',
      pads: rowX(3, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.8, 1.8, 0.9, i === 1 ? 'rect' : 'circle', { name: ['A1', 'COM', 'A2'][i] })),
      body: { x0: -2.9, y0: -2.9, x1: 2.9, y1: 2.9 },
      extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 2.9, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 3.0, SILK_W)],
      noSilk: true,
      verified: true,
      height: 8.6,
      tags: ['led', 'bicolor', '5mm'],
    }),
  );
  return out;
}
