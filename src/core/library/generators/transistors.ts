import type { FootprintDef, Graphic, PadDef } from '../../model/types';
import { CAT } from '../categories';
import { sot23, sot223 } from './smd';
import { to220, to92 } from './tht';
import { CRT_SMD, CRT_THT, FAB_W, SILK_W, boxFootprint, circle, courtyardAround, crtGraphic, fp, line, npth, rect, refText, rowX, smd, tht, valueText } from './util';

/* Транзисторы, стабилизаторы и другие силовые корпуса: SOT, DPAK/D2PAK, TO-92/126/220/247/18 и др. */

const G = { smdSmall: 'SMD малые', smdPower: 'SMD силовые', thtSmall: 'Выводные малые', thtPower: 'Выводные силовые' };

/** SOT-89-3: три вывода снизу с шагом 1,5 мм, средний вывод продолжается теплоотводящей площадкой. */
function sot89(): FootprintDef {
  const pads = [smd('1', -1.5, 1.5, 1.0, 1.4), smd('2', 0, 1.5, 1.0, 1.4), smd('3', 1.5, 1.5, 1.0, 1.4), smd('2', 0, -1.15, 1.7, 2.3, 'roundrect')];
  // Две площадки с одним номером недопустимы в модели: делаем теплоотвод частью вывода 2 одной площадкой-полосой.
  const merged: PadDef[] = [pads[0], smd('2', 0, 0.35, 1.7, 3.7, 'roundrect'), pads[2]];
  const crt = courtyardAround(merged, { x0: -2.25, y0: -1.25, x1: 2.25, y1: 1.25 }, CRT_SMD);
  const g: Graphic[] = [rect('F.Fab', -2.25, -1.25, 2.25, 1.25, FAB_W), line('F.Silk', { x: -2.35, y: -1.35 }, { x: 2.35, y: -1.35 }), line('F.Silk', { x: -2.35, y: 1.35 }, { x: -2.35, y: -1.35 }), line('F.Silk', { x: 2.35, y: 1.35 }, { x: 2.35, y: -1.35 }), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)];
  return fp({ id: 'SOT-89-3', name: 'SOT-89', description: 'SOT-89-3 (стабилизаторы 78L/AMS1117-подобные малые), 4,5×2,5 мм; вывод 2 — с теплоотводом', category: CAT.Q, group: G.smdSmall, tags: ['smd', 'sot-89'], refPrefix: 'Q', pads: merged, graphics: g, courtyard: crt, source: 'IPC-7351B, номинал', verified: false, height: 1.6 });
}

/** DPAK (TO-252-2/3) и D2PAK (TO-263-2/3): выводы снизу, теплоотвод сверху. */
function dpak(kind: 'TO-252-2' | 'TO-252-3' | 'TO-263-2' | 'TO-263-3' | 'TO-263-5'): FootprintDef {
  const big = kind.startsWith('TO-263');
  const pitch = kind === 'TO-263-5' ? 1.7 : big ? 5.08 : 4.56;
  const n = kind.endsWith('-3') ? 3 : kind.endsWith('-5') ? 5 : 2;
  const pinY = big ? 7.0 : 4.6;
  const padW = kind === 'TO-263-5' ? 1.0 : big ? 1.6 : 1.3;
  const padH = big ? 3.4 : 2.4;
  const tab = big ? { w: 10.4, h: 8.6, y: -2.2 } : { w: 5.4, h: 6.2, y: -1.2 };
  const pads: PadDef[] = [];
  if (n === 2) pads.push(smd('1', -pitch / 2, pinY, padW, padH), smd('3', pitch / 2, pinY, padW, padH));
  else if (n === 3) pads.push(smd('1', -pitch / 2, pinY, padW, padH), smd('2', 0, pinY, padW, padH), smd('3', pitch / 2, pinY, padW, padH));
  else pads.push(...rowX(5, pitch, (i, x) => smd(String(i + 1), x, pinY, padW, padH)));
  pads.push(smd(n === 5 ? '6' : n === 3 ? '4' : '2', 0, tab.y, tab.w, tab.h, 'rect', { name: 'TAB' }));
  const body = big ? { x0: -5.1, y0: -4.7, x1: 5.1, y1: 4.7 } : { x0: -3.3, y0: -3.1, x1: 3.3, y1: 3.1 };
  const crt = courtyardAround(pads, body, CRT_SMD);
  const g: Graphic[] = [rect('F.Fab', body.x0, body.y0, body.x1, body.y1, FAB_W), line('F.Silk', { x: body.x0 - 0.1, y: body.y1 + 0.1 }, { x: body.x0 - 0.1, y: body.y1 - 1.5 }), line('F.Silk', { x: body.x1 + 0.1, y: body.y1 + 0.1 }, { x: body.x1 + 0.1, y: body.y1 - 1.5 }), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(0, 0, 0.9)];
  const nm = big ? (kind === 'TO-263-5' ? 'D2PAK-5' : `D2PAK${n === 3 ? '-3' : ''}`) : `DPAK${n === 3 ? '-3' : ''}`;
  return fp({ id: kind, name: nm, description: `${kind} (${nm}): ${n} вывода снизу, теплоотводящая площадка сверху (номер ${pads[pads.length - 1].number})`, category: CAT.Q, group: G.smdPower, tags: ['smd', 'dpak', kind.toLowerCase()], refPrefix: 'Q', pads, graphics: g, courtyard: crt, source: 'IPC-7351B / JEDEC, номинал', verified: false, height: big ? 4.6 : 2.4 });
}

/** Выводной корпус с выводами в линию (TO-126, TO-220, TO-247, TO-3P), вертикальный. */
function toInline(o: { id: string; name: string; description: string; n: number; pitch: number; drill: number; pad: [number, number]; body: [number, number]; bodyY: number; height: number; verified?: boolean; tags?: string[]; group?: string }): FootprintDef {
  const pads = rowX(o.n, o.pitch, (i, x) => tht(String(i + 1), x, 0, o.pad[0], o.pad[1], o.drill, i === 0 ? 'rect' : 'oval'));
  const [W, T] = o.body;
  const y0 = o.bodyY - T / 2;
  const y1 = o.bodyY + T / 2;
  const crt = courtyardAround(pads, { x0: -W / 2, y0, x1: W / 2, y1 }, CRT_THT);
  const g: Graphic[] = [rect('F.Fab', -W / 2, y0, W / 2, y1, FAB_W), line('F.Fab', { x: -W / 2, y: y0 + T * 0.3 }, { x: W / 2, y: y0 + T * 0.3 }, FAB_W), rect('F.Silk', -W / 2 - 0.1, y0 - 0.1, W / 2 + 0.1, y1 + 0.1, SILK_W), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)];
  return fp({ id: o.id, name: o.name, description: o.description, category: CAT.Q, group: o.group ?? G.thtPower, tags: ['tht', ...(o.tags ?? [])], refPrefix: 'Q', pads, graphics: g, courtyard: crt, source: 'JEDEC / типовые', verified: o.verified ?? true, height: o.height });
}

/** TO-220 горизонтально (лежа на плате, теплоотвод прикручен): выводы согнуты, отверстие под винт. */
function to220Horizontal(): FootprintDef {
  const pads: PadDef[] = rowX(3, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.8, 2.6, 1.0, i === 0 ? 'rect' : 'oval'));
  pads.push(npth(0, -15.3, 3.2));
  return boxFootprint({
    id: 'TO-220-3_Horizontal_TabDown',
    name: 'TO-220 лежа',
    description: 'TO-220 положен на плату теплоотводом вниз, выводы согнуты; отверстие Ø3,2 под винт на 15,3 мм от выводов',
    category: CAT.Q,
    group: G.thtPower,
    refPrefix: 'Q',
    pads,
    body: { x0: -5.2, y0: -19.3, x1: 5.2, y1: -3.3 },
    extraGraphics: [line('F.Fab', { x: -5.2, y: -12.5 }, { x: 5.2, y: -12.5 }, FAB_W)],
    verified: true,
    height: 4.5,
    tags: ['to-220', 'horizontal'],
  });
}

/** Металлические корпуса TO-18 / TO-39: 3 вывода на окружности с шагом 2,54 (под 90°), ключ-язычок у вывода 1. */
function toCan(kind: 'TO-18' | 'TO-39' | 'TO-5'): FootprintDef {
  const S = { 'TO-18': { d: 5.3, r: 1.27 }, 'TO-39': { d: 8.5, r: 2.54 }, 'TO-5': { d: 8.5, r: 2.54 } }[kind];
  const k = S.r / Math.SQRT2;
  const pads = [tht('1', -S.r, 0, 1.4, 1.4, 0.7, 'rect'), tht('2', 0, S.r, 1.4, 1.4, 0.7), tht('3', S.r, 0, 1.4, 1.4, 0.7)];
  void k;
  return boxFootprint({
    id: `${kind}-3`,
    name: kind,
    description: `${kind}, металлический корпус Ø${S.d} мм, 3 вывода (1 — слева, 2 — снизу, 3 — справа), язычок у вывода 1`,
    category: CAT.Q,
    group: G.thtSmall,
    refPrefix: 'Q',
    pads,
    body: { x0: -S.d / 2, y0: -S.d / 2, x1: S.d / 2, y1: S.d / 2 },
    extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, S.d / 2, FAB_W), circle('F.Silk', { x: 0, y: 0 }, S.d / 2 + 0.1, SILK_W), line('F.Silk', { x: -S.d / 2 - 0.1, y: 0.6 }, { x: -S.d / 2 - 1.1, y: 0.6 }, SILK_W), line('F.Silk', { x: -S.d / 2 - 1.1, y: 0.6 }, { x: -S.d / 2 - 1.1, y: -0.6 }, SILK_W), line('F.Silk', { x: -S.d / 2 - 1.1, y: -0.6 }, { x: -S.d / 2 - 0.1, y: -0.6 }, SILK_W)],
    noSilk: true,
    verified: false,
    height: kind === 'TO-18' ? 5.3 : 8,
    tags: ['metal-can', kind.toLowerCase()],
  });
}

export function allTransistors(): FootprintDef[] {
  const out: FootprintDef[] = [];
  for (const k of ['SOT-23', 'SOT-323'] as const) out.push({ ...sot23(k), group: G.smdSmall, category: CAT.Q });
  out.push(sot89(), { ...sot223(), category: CAT.Q, group: G.smdSmall });
  out.push(
    boxFootprint({ id: 'SOT-523', name: 'SOT-523', description: 'SOT-523 (SC-79 / SC-89), 1,6×0,8 мм, 3 вывода, шаг 0,5 мм', category: CAT.Q, group: G.smdSmall, refPrefix: 'Q', pads: [smd('1', -0.5, 0.55, 0.4, 0.5), smd('2', 0.5, 0.55, 0.4, 0.5), smd('3', 0, -0.55, 0.4, 0.5)], body: { x0: -0.8, y0: -0.4, x1: 0.8, y1: 0.4 }, smd: true, verified: false, height: 0.6, tags: ['sot-523'] }),
    boxFootprint({ id: 'SOT-563', name: 'SOT-563', description: 'SOT-563, 1,6×1,2 мм, 6 выводов, шаг 0,5 мм (сдвоенные транзисторы)', category: CAT.Q, group: G.smdSmall, refPrefix: 'Q', pads: [...rowX(3, 0.5, (i, x) => smd(String(i + 1), x, 0.75, 0.3, 0.55)), ...rowX(3, 0.5, (i, x) => smd(String(6 - i), x, -0.75, 0.3, 0.55))], body: { x0: -0.8, y0: -0.6, x1: 0.8, y1: 0.6 }, smd: true, verified: false, height: 0.6, tags: ['sot-563'] }),
    boxFootprint({ id: 'SOT-363_SC-70-6', name: 'SOT-363', description: 'SOT-363 (SC-70-6), 2,0×1,25 мм, 6 выводов, шаг 0,65 мм', category: CAT.Q, group: G.smdSmall, refPrefix: 'Q', pads: [...rowX(3, 0.65, (i, x) => smd(String(i + 1), x, 0.95, 0.4, 0.7)), ...rowX(3, 0.65, (i, x) => smd(String(6 - i), x, -0.95, 0.4, 0.7))], body: { x0: -1.0, y0: -0.625, x1: 1.0, y1: 0.625 }, smd: true, verified: false, height: 1.0, tags: ['sot-363', 'sc-70'] }),
    boxFootprint({ id: 'SOT-23-3_PowerPAK-like_TSOT', name: 'TSOT-23', description: 'TSOT-23 (тонкий SOT-23), те же площадки, что у SOT-23', category: CAT.Q, group: G.smdSmall, refPrefix: 'Q', pads: [smd('1', -1.0, 0.95, 0.9, 0.8), smd('2', -1.0, -0.95, 0.9, 0.8), smd('3', 1.0, 0, 0.9, 0.8)], body: { x0: -0.65, y0: -1.45, x1: 0.65, y1: 1.45 }, smd: true, verified: true, height: 0.9, tags: ['tsot'] }),
  );
  out.push(dpak('TO-252-2'), dpak('TO-252-3'), dpak('TO-263-2'), dpak('TO-263-3'), dpak('TO-263-5'));
  out.push(
    boxFootprint({ id: 'PowerPAK_SO-8', name: 'PowerPAK SO-8', description: 'PowerPAK SO-8 (MOSFET): 4 вывода снизу с шагом 1,27 мм и большая площадка стока', category: CAT.Q, group: G.smdPower, refPrefix: 'Q', pads: [...rowX(4, 1.27, (i, x) => smd(String(i + 1), x, 2.75, 0.7, 1.2)), smd('5', 0, -0.6, 4.0, 3.9, 'rect', { name: 'D' })], body: { x0: -2.55, y0: -2.55, x1: 2.55, y1: 2.55 }, smd: true, verified: false, height: 1.0, tags: ['powerpak', 'mosfet'] }),
    boxFootprint({ id: 'DFN-8_3x3_MOSFET', name: 'DFN 3×3 (MOSFET)', description: 'DFN-8 3×3 мм с открытой площадкой, шаг 0,65 мм (двойные MOSFET и т. п.)', category: CAT.Q, group: G.smdPower, refPrefix: 'Q', pads: [...rowX(4, 0.65, (i, x) => smd(String(i + 1), x, 1.45, 0.35, 0.8)), ...rowX(4, 0.65, (i, x) => smd(String(8 - i), x, -1.45, 0.35, 0.8)), smd('9', 0, 0, 1.7, 1.8, 'rect', { name: 'EP' })], body: { x0: -1.5, y0: -1.5, x1: 1.5, y1: 1.5 }, smd: true, verified: false, height: 0.8, tags: ['dfn', 'mosfet'] }),
  );
  // Выводные малые.
  out.push({ ...to92(1.27), category: CAT.Q, group: G.thtSmall }, { ...to92(2.54), category: CAT.Q, group: G.thtSmall });
  out.push(
    boxFootprint({ id: 'TO-92_Triangle', name: 'TO-92 треугольник', description: 'TO-92 с выводами треугольником (1 и 3 на 2,54 мм, 2 сдвинут на 1,27 мм назад)', category: CAT.Q, group: G.thtSmall, refPrefix: 'Q', pads: [tht('1', -1.27, 0, 1.4, 1.4, 0.75, 'rect'), tht('2', 0, -1.27, 1.4, 1.4, 0.75), tht('3', 1.27, 0, 1.4, 1.4, 0.75)], body: { x0: -2.3, y0: -2.3, x1: 2.3, y1: 1.4 }, extraGraphics: [circle('F.Fab', { x: 0, y: -0.4 }, 2.3, FAB_W), circle('F.Silk', { x: 0, y: -0.4 }, 2.4, SILK_W)], noSilk: true, verified: true, height: 5, tags: ['to-92'] }),
    toCan('TO-18'),
    toCan('TO-39'),
    toInline({ id: 'TO-126-3_Vertical', name: 'TO-126', description: 'TO-126 (SOT-32), 3 вывода с шагом 2,28 мм, вертикально', n: 3, pitch: 2.28, drill: 1.0, pad: [1.5, 2.4], body: [8.0, 3.2], bodyY: -2.4, height: 11, tags: ['to-126'], group: G.thtSmall }),
    toInline({ id: 'TO-251-3_IPAK_Vertical', name: 'IPAK (TO-251)', description: 'IPAK / TO-251, 3 вывода с шагом 2,28 мм, вертикально', n: 3, pitch: 2.28, drill: 1.0, pad: [1.5, 2.4], body: [6.7, 2.3], bodyY: -2.0, height: 8, tags: ['to-251', 'ipak'], group: G.thtSmall, verified: false }),
  );
  // Выводные силовые.
  out.push({ ...to220(), category: CAT.Q, group: G.thtPower }, to220Horizontal());
  out.push(
    toInline({ id: 'TO-220-2_Vertical', name: 'TO-220-2', description: 'TO-220 с двумя выводами (диоды, тиристоры), шаг 5,08 мм, вертикально', n: 2, pitch: 5.08, drill: 1.0, pad: [1.8, 2.6], body: [10.4, 4.5], bodyY: -2.5, height: 16, tags: ['to-220'] }),
    toInline({ id: 'TO-220-5_Vertical', name: 'TO-220-5', description: 'TO-220 с пятью выводами (Pentawatt в линию), шаг 1,7 мм, вертикально', n: 5, pitch: 1.7, drill: 0.9, pad: [1.3, 2.4], body: [10.4, 4.5], bodyY: -2.5, height: 16, tags: ['to-220', 'pentawatt'], verified: false }),
    toInline({ id: 'TO-247-3_Vertical', name: 'TO-247', description: 'TO-247 (TO-3P), 3 вывода с шагом 5,45 мм, вертикально', n: 3, pitch: 5.45, drill: 1.6, pad: [2.6, 3.6], body: [16.0, 5.2], bodyY: -3.5, height: 21, tags: ['to-247', 'to-3p'] }),
    toInline({ id: 'TO-247-2_Vertical', name: 'TO-247-2', description: 'TO-247 с двумя выводами (крайние), шаг 10,9 мм, вертикально', n: 2, pitch: 10.9, drill: 1.6, pad: [2.6, 3.6], body: [16.0, 5.2], bodyY: -3.5, height: 21, tags: ['to-247'] }),
    toInline({ id: 'TO-264-3_Vertical', name: 'TO-264', description: 'TO-264 (TO-3PL), 3 вывода с шагом 5,45 мм, вертикально', n: 3, pitch: 5.45, drill: 1.6, pad: [2.6, 3.6], body: [20.0, 5.5], bodyY: -3.8, height: 26, tags: ['to-264'], verified: false }),
    toInline({ id: 'TO-218-3_Vertical', name: 'TO-218', description: 'TO-218 (SOT-93), 3 вывода с шагом 5,45 мм, вертикально', n: 3, pitch: 5.45, drill: 1.5, pad: [2.5, 3.5], body: [15.5, 5.0], bodyY: -3.3, height: 20, tags: ['to-218'], verified: false }),
  );
  return out;
}
