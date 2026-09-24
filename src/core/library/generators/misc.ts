import type { FootprintDef, PadDef } from '../../model/types';
import { CAT } from '../categories';
import { disc, fuseHolder5x20, mountingHole, relaySrd } from './tht';
import { chip } from './smd';
import { FAB_W, SILK_W, boxFootprint, circle, fp, line, npth, rect, refText, rowX, smd, tht, twoPadSmd, twoPinTht } from './util';

/* Крепёж, технологические элементы, предохранители и защита, реле, датчики, питание. */

const GH = { holes: 'Отверстия', tp: 'Контрольные точки', wire: 'Площадки под провод', jumper: 'Паяные перемычки', fid: 'Реперные знаки' };
const GF = { smd: 'Предохранители SMD', tht: 'Предохранители выводные', var: 'Варисторы и разрядники', tvs: 'TVS' };
const GK = { relay: 'Электромеханические' };
const GS = { temp: 'Температура и влажность', motion: 'Движение и расстояние', current: 'Ток и напряжение', pressure: 'Давление и газ', other: 'Прочие' };
const GP = { acdc: 'AC-DC', dcdc: 'DC-DC' };

function testPoint(kind: 'tht_1.0' | 'tht_1.5' | 'smd_1x1' | 'smd_1.5x1.5' | 'smd_2x2' | 'loop'): FootprintDef {
  const mk = (id: string, name: string, description: string, pads: PadDef[], b: number, smdFlag: boolean) =>
    boxFootprint({ id, name, description, category: CAT.H, group: GH.tp, refPrefix: 'TP', pads, body: { x0: -b, y0: -b, x1: b, y1: b }, smd: smdFlag, noSilk: true, extraGraphics: [circle('F.Silk', { x: 0, y: 0 }, b + 0.3, SILK_W)], verified: true, height: 0, tags: ['testpoint'] });
  switch (kind) {
    case 'tht_1.0':
      return mk('TestPoint_THT_D1.0mm', 'Контрольная точка Ø1,0', 'Контрольная точка: отверстие Ø1,0 мм с площадкой Ø2,0 (под щуп или штырёк)', [tht('1', 0, 0, 2.0, 2.0, 1.0)], 1.0, false);
    case 'tht_1.5':
      return mk('TestPoint_THT_D1.5mm', 'Контрольная точка Ø1,5', 'Контрольная точка: отверстие Ø1,5 мм с площадкой Ø3,0', [tht('1', 0, 0, 3.0, 3.0, 1.5)], 1.5, false);
    case 'smd_1x1':
      return mk('TestPoint_Pad_1.0x1.0mm', 'Контрольная точка 1×1', 'Контрольная точка SMD 1×1 мм', [smd('1', 0, 0, 1.0, 1.0, 'rect')], 0.5, true);
    case 'smd_1.5x1.5':
      return mk('TestPoint_Pad_1.5x1.5mm', 'Контрольная точка 1,5×1,5', 'Контрольная точка SMD 1,5×1,5 мм', [smd('1', 0, 0, 1.5, 1.5, 'rect')], 0.75, true);
    case 'smd_2x2':
      return mk('TestPoint_Pad_2.0x2.0mm', 'Контрольная точка 2×2', 'Контрольная точка SMD 2×2 мм (под щуп-крокодил)', [smd('1', 0, 0, 2.0, 2.0, 'circle')], 1.0, true);
    case 'loop':
      return boxFootprint({ id: 'TestPoint_Loop_P2.54mm', name: 'Петля под щуп', description: 'Проволочная петля под зажим осциллографа: два отверстия Ø1,0 через 2,54 мм, одна цепь', category: CAT.H, group: GH.tp, refPrefix: 'TP', pads: [tht('1', -1.27, 0, 2.0, 2.0, 1.0), tht('1b', 1.27, 0, 2.0, 2.0, 1.0)], body: { x0: -2.3, y0: -1.0, x1: 2.3, y1: 1.0 }, verified: true, height: 4, tags: ['testpoint', 'loop'] });
  }
}

function wirePad(d: number, drill: number): FootprintDef {
  return boxFootprint({ id: `WirePad_THT_D${d}mm_Drill${drill}mm`, name: `Площадка под провод Ø${drill}`, description: `Одиночная площадка Ø${d} мм с отверстием Ø${drill} мм под провод`, category: CAT.H, group: GH.wire, refPrefix: 'W', pads: [tht('1', 0, 0, d, d, drill)], body: { x0: -d / 2, y0: -d / 2, x1: d / 2, y1: d / 2 }, noSilk: true, verified: true, height: 0, tags: ['wire', 'pad'] });
}
function wirePadSmd(s: number): FootprintDef {
  return boxFootprint({ id: `WirePad_SMD_${s}x${s}mm`, name: `Площадка SMD ${s}×${s}`, description: `Площадка ${s}×${s} мм без отверстия — под провод или лужёный контакт`, category: CAT.H, group: GH.wire, refPrefix: 'W', pads: [smd('1', 0, 0, s, s, 'rect')], body: { x0: -s / 2, y0: -s / 2, x1: s / 2, y1: s / 2 }, smd: true, noSilk: true, verified: true, height: 0, tags: ['wire', 'pad', 'smd'] });
}

function solderJumper(kind: '2_open' | '2_bridged' | '3_open' | '3_bridged12'): FootprintDef {
  const n = kind.startsWith('3') ? 3 : 2;
  const pads = rowX(n, 1.3, (i, x) => smd(String(i + 1), x, 0, 1.0, 1.5, 'rect'));
  const bridged = kind.includes('bridged');
  const g = bridged ? [rect('F.Cu', -0.65 - 0.3, -0.3, -0.65 + 0.3, 0.3, 0.1, true)] : [];
  return boxFootprint({ id: `SolderJumper-${n}_P1.3mm_${kind.includes('bridged') ? 'Bridged' : 'Open'}`, name: `Паяная перемычка ${n}${bridged ? ' замкнута' : ''}`, description: `Паяная перемычка из ${n} площадок с зазором 0,3 мм${bridged ? ', замкнута медью между 1 и 2 (перерезать при необходимости)' : ''}`, category: CAT.H, group: GH.jumper, refPrefix: 'JP', pads, body: { x0: -(n * 1.3) / 2, y0: -1.0, x1: (n * 1.3) / 2, y1: 1.0 }, smd: true, extraGraphics: g, verified: true, height: 0, tags: ['jumper', 'solder'] });
}

function fiducial(d: number): FootprintDef {
  return fp({ id: `Fiducial_${d}mm_Mask${d * 2}mm`, name: `Репер Ø${d}`, description: `Реперный знак: круг меди Ø${d} мм, окно в маске Ø${d * 2} мм`, category: CAT.H, group: GH.fid, tags: ['fiducial'], refPrefix: 'FID', pads: [{ number: '', type: 'smd', shape: 'circle', at: { x: 0, y: 0 }, size: { x: d, y: d }, maskMargin: d / 2 }], graphics: [circle('F.Fab', { x: 0, y: 0 }, d, FAB_W), refText(-d - 0.7)], courtyard: { min: { x: -d - 0.2, y: -d - 0.2 }, max: { x: d + 0.2, y: d + 0.2 } }, source: 'IPC', verified: true, height: 0, excludeFromBom: true } as FootprintDef & { excludeFromBom: boolean });
}

/* ---- предохранители и защита ---- */
function fuses(): FootprintDef[] {
  const out: FootprintDef[] = [];
  out.push({ ...chip('F', { code: '1206', metric: '3216', body: [3.2, 1.6], span: 2.925, pad: [1.125, 1.75], verified: true }), category: CAT.F, group: GF.smd }, { ...chip('F', { code: '0603', metric: '1608', body: [1.6, 0.8], span: 1.65, pad: [0.8, 0.95], verified: true }), category: CAT.F, group: GF.smd });
  out.push(
    twoPadSmd({ id: 'Fuse_2410_6125Metric', name: 'Предохранитель 2410', description: 'Предохранитель SMD 2410 (6,1×2,5 мм), Littelfuse 0451/0453', category: CAT.F, group: GF.smd, refPrefix: 'F', span: 5.4, pad: [1.6, 2.8], body: [6.1, 2.5], tags: ['fuse'], verified: false, height: 2.6 }),
    twoPadSmd({ id: 'Fuse_Nano2_Littelfuse_0154', name: 'Предохранитель Nano2', description: 'Предохранитель Littelfuse Nano2 (154/157), 10,1×3,1 мм', category: CAT.F, group: GF.smd, refPrefix: 'F', span: 8.3, pad: [2.2, 3.6], body: [10.1, 3.1], tags: ['fuse', 'nano2'], verified: false, height: 3.1 }),
    twoPadSmd({ id: 'Fuse_PTC_1206', name: 'PTC 1206', description: 'Самовосстанавливающийся предохранитель PTC SMD 1206', category: CAT.F, group: GF.smd, refPrefix: 'F', span: 2.925, pad: [1.125, 1.75], body: [3.2, 1.6], tags: ['ptc', 'polyfuse'], verified: true, height: 1.0 }),
    twoPadSmd({ id: 'Fuse_PTC_1812', name: 'PTC 1812', description: 'Самовосстанавливающийся предохранитель PTC SMD 1812 (4,5×3,2 мм)', category: CAT.F, group: GF.smd, refPrefix: 'F', span: 3.9, pad: [1.2, 3.4], body: [4.5, 3.2], tags: ['ptc', 'polyfuse'], verified: false, height: 1.6 }),
    twoPadSmd({ id: 'Fuse_PTC_2920', name: 'PTC 2920', description: 'Самовосстанавливающийся предохранитель PTC SMD 2920 (7,4×5,1 мм)', category: CAT.F, group: GF.smd, refPrefix: 'F', span: 6.6, pad: [1.8, 5.4], body: [7.4, 5.1], tags: ['ptc', 'polyfuse'], verified: false, height: 3.0 }),
  );
  out.push({ ...fuseHolder5x20(), category: CAT.F, group: GF.tht });
  out.push(
    twoPinTht({ id: 'Fuseholder_Cylinder-5x20mm_Vertical_P10mm', name: 'Держатель 5×20 стоя', description: 'Вертикальный держатель предохранителя 5×20 мм (BLX-A / PTF-15), выводы через 10 мм', category: CAT.F, group: GF.tht, refPrefix: 'F', pitch: 10.0, drill: 1.3, pad: 2.6, body: { len: 7.5, wid: 7.5 }, tags: ['fuse', '5x20', 'vertical'], verified: false, height: 24 }),
    twoPinTht({ id: 'Fuseholder_Clip-6.3x32mm_P31.75mm', name: 'Держатель 6,3×32', description: 'Держатель предохранителя 6,3×32 мм на клипсах, шаг 31,75 мм', category: CAT.F, group: GF.tht, refPrefix: 'F', pitch: 31.75, drill: 1.5, pad: 3.0, body: { len: 32, wid: 7.5 }, tags: ['fuse', '6x32'], verified: false, height: 10 }),
    twoPinTht({ id: 'Fuse_Radial_PTC_P5.08mm', name: 'PTC радиальный 5,08', description: 'Самовосстанавливающийся предохранитель PTC радиальный (MF-R), шаг 5,08 мм, диск до Ø12', category: CAT.F, group: GF.tht, refPrefix: 'F', pitch: 5.08, drill: 0.9, pad: 1.8, body: { len: 9.0, wid: 3.0 }, tags: ['ptc', 'polyfuse'], verified: false, height: 12 }),
    twoPinTht({ id: 'Fuse_Axial_5x20_Leaded_P25mm', name: 'Предохранитель с выводами', description: 'Предохранитель 5×20 (или 3,6×10) с осевыми выводами, шаг 25 мм', category: CAT.F, group: GF.tht, refPrefix: 'F', pitch: 25.0, drill: 1.0, pad: 2.0, body: { len: 20, wid: 5 }, tags: ['fuse', 'axial'], verified: false, height: 5 }),
    twoPinTht({ id: 'Fuse_TR5_P5.08mm', name: 'Предохранитель TR5', description: 'Микропредохранитель TR5 (Ø8,5), радиальный, шаг 5,08 мм', category: CAT.F, group: GF.tht, refPrefix: 'F', pitch: 5.08, drill: 1.0, pad: 2.0, body: { d: 8.5, at: 0 }, tags: ['fuse', 'tr5'], verified: true, height: 8 }),
  );
  out.push({ ...disc(7, 5), category: CAT.F, group: GF.var, id: 'RV_Disc_D7mm_P5mm', name: 'Варистор Ø7', description: 'Варистор 07D Ø7 мм, шаг 5 мм' }, { ...disc(10, 7.5), category: CAT.F, group: GF.var, id: 'RV_Disc_D10mm_P7.5mm', name: 'Варистор Ø10', description: 'Варистор 10D Ø10 мм, шаг 7,5 мм' }, { ...disc(14, 7.5), category: CAT.F, group: GF.var }, { ...disc(20, 10), category: CAT.F, group: GF.var });
  out.push(
    twoPinTht({ id: 'GDT_D8mm_P5mm', name: 'Разрядник Ø8', description: 'Газовый разрядник (GDT) двухвыводной, Ø8×6 мм, шаг 5 мм', category: CAT.F, group: GF.var, refPrefix: 'SG', pitch: 5.0, drill: 1.0, pad: 2.0, body: { len: 8, wid: 6 }, tags: ['gdt', 'surge'], verified: false, height: 8 }),
    twoPadSmd({ id: 'Varistor_SMD_1210', name: 'Варистор 1210', description: 'Многослойный варистор (MLV) SMD 1210', category: CAT.F, group: GF.var, refPrefix: 'RV', span: 2.925, pad: [1.125, 2.65], body: [3.2, 2.5], tags: ['varistor', 'mlv'], verified: true, height: 1.5 }),
    twoPadSmd({ id: 'D_TVS_SMA', name: 'TVS SMA', description: 'Супрессор TVS (SMAJ/P4SMA) в корпусе SMA/DO-214AC', category: CAT.F, group: GF.tvs, refPrefix: 'D', span: 4.0, pad: [1.6, 1.8], body: [4.3, 2.6], polar: true, padNames: ['K', 'A'], tags: ['tvs', 'sma'], verified: true, height: 2.3 }),
    twoPadSmd({ id: 'D_TVS_SMB', name: 'TVS SMB', description: 'Супрессор TVS (SMBJ/P6SMB) в корпусе SMB/DO-214AA', category: CAT.F, group: GF.tvs, refPrefix: 'D', span: 4.4, pad: [2.15, 2.4], body: [4.3, 3.6], polar: true, padNames: ['K', 'A'], tags: ['tvs', 'smb'], verified: true, height: 2.4 }),
    twoPadSmd({ id: 'D_TVS_SMC', name: 'TVS SMC', description: 'Супрессор TVS (SMCJ/1.5SMC) в корпусе SMC/DO-214AB', category: CAT.F, group: GF.tvs, refPrefix: 'D', span: 6.1, pad: [2.55, 3.4], body: [6.8, 5.9], polar: true, padNames: ['K', 'A'], tags: ['tvs', 'smc'], verified: false, height: 2.4 }),
    twoPadSmd({ id: 'D_TVS_SOD-123', name: 'TVS SOD-123', description: 'Супрессор ESD в корпусе SOD-123', category: CAT.F, group: GF.tvs, refPrefix: 'D', span: 3.27, pad: [0.91, 1.22], body: [2.85, 1.8], polar: true, padNames: ['K', 'A'], tags: ['tvs', 'esd'], verified: true, height: 1.1 }),
    boxFootprint({ id: 'D_TVS_Array_SOT-23-6_ESD', name: 'ESD-сборка SOT-23-6', description: 'Сборка ESD-диодов (USBLC6, PRTR5V0U2X) в SOT-23-6', category: CAT.F, group: GF.tvs, refPrefix: 'D', pads: [smd('1', -1.1, 0.95, 1.06, 0.65), smd('2', -1.1, 0, 1.06, 0.65), smd('3', -1.1, -0.95, 1.06, 0.65), smd('4', 1.1, -0.95, 1.06, 0.65), smd('5', 1.1, 0, 1.06, 0.65), smd('6', 1.1, 0.95, 1.06, 0.65)], body: { x0: -0.8, y0: -1.45, x1: 0.8, y1: 1.45 }, smd: true, pin1Mark: { x: -1.9, y: 1.5 }, verified: true, height: 1.1, tags: ['tvs', 'esd', 'usb'] }),
    twoPinTht({ id: 'D_TVS_P600_P20.32mm', name: 'TVS 5 кВт P600', description: 'Мощный супрессор 5KP в корпусе P600, шаг 20,32 мм', category: CAT.F, group: GF.tvs, refPrefix: 'D', pitch: 20.32, drill: 1.6, pad: 3.0, body: { len: 9.1, wid: 9.1 }, polar: true, padNames: ['K', 'A'], tags: ['tvs', 'p600'], verified: false, height: 9.1 }),
  );
  return out;
}

/* ---- реле ---- */
function relays(): FootprintDef[] {
  const out: FootprintDef[] = [{ ...relaySrd(), category: CAT.K, group: GK.relay }];
  out.push(
    boxFootprint({ id: 'Relay_HK4100F', name: 'Реле HK4100F', description: 'Миниатюрное реле HK4100F (15,5×10,5×11,5 мм), 6 выводов. Раскладка типовая — сверить с даташитом', category: CAT.K, group: GK.relay, refPrefix: 'K', pads: [tht('1', -6.0, 3.5, 1.8, 1.8, 1.0, 'rect', { name: 'COIL' }), tht('2', 6.0, 3.5, 1.8, 1.8, 1.0, 'circle', { name: 'COIL' }), tht('3', -6.0, -3.5, 1.8, 1.8, 1.0, 'circle', { name: 'NO' }), tht('4', -2.0, -3.5, 1.8, 1.8, 1.0, 'circle', { name: 'COM' }), tht('5', 2.0, -3.5, 1.8, 1.8, 1.0, 'circle', { name: 'NC' }), tht('6', 6.0, -3.5, 1.8, 1.8, 1.0, 'circle', { name: 'NC2' })], body: { x0: -7.75, y0: -5.25, x1: 7.75, y1: 5.25 }, verified: false, height: 11.5, tags: ['relay', 'hk4100f'] }),
    boxFootprint({ id: 'Relay_G5LE_SPDT', name: 'Реле Omron G5LE', description: 'Реле Omron G5LE-1 (22,5×16,5×19 мм), 5 выводов: катушка 1–2 через 12,2 мм, контакты COM/NO/NC. Раскладка типовая — сверить', category: CAT.K, group: GK.relay, refPrefix: 'K', pads: [tht('1', -6.1, 7.6, 2.4, 2.4, 1.3, 'rect', { name: 'COIL' }), tht('2', 6.1, 7.6, 2.4, 2.4, 1.3, 'circle', { name: 'COIL' }), tht('3', -6.1, -4.6, 2.4, 2.4, 1.3, 'circle', { name: 'NO' }), tht('4', 0, -4.6, 2.4, 2.4, 1.3, 'circle', { name: 'COM' }), tht('5', 6.1, -4.6, 2.4, 2.4, 1.3, 'circle', { name: 'NC' })], body: { x0: -11.25, y0: -8.25, x1: 11.25, y1: 8.25 }, verified: false, height: 19, tags: ['relay', 'g5le'] }),
    boxFootprint({ id: 'Relay_G5V-1_SPDT', name: 'Реле Omron G5V-1', description: 'Сигнальное реле G5V-1 (12,5×7,5×10 мм), 6 выводов с шагом 2,54 мм в два ряда через 7,62 мм', category: CAT.K, group: GK.relay, refPrefix: 'K', pads: [tht('1', -3.81, -3.81, 1.6, 1.6, 0.8, 'rect'), tht('2', -3.81, -1.27, 1.6, 1.6, 0.8), tht('3', -3.81, 3.81, 1.6, 1.6, 0.8), tht('4', 3.81, 3.81, 1.6, 1.6, 0.8), tht('5', 3.81, -1.27, 1.6, 1.6, 0.8), tht('6', 3.81, -3.81, 1.6, 1.6, 0.8)], body: { x0: -6.25, y0: -3.75, x1: 6.25, y1: 3.75 }, verified: false, height: 10, tags: ['relay', 'g5v', 'signal'] }),
    boxFootprint({ id: 'Relay_G5V-2_DPDT', name: 'Реле Omron G5V-2', description: 'Сигнальное реле G5V-2 (DPDT, 20,5×10×11,5 мм), 8 выводов в два ряда через 7,62 мм', category: CAT.K, group: GK.relay, refPrefix: 'K', pads: [...[0, 1, 2, 3].map((i) => tht(String(i + 1), -3.81, -7.62 + i * 5.08, 1.6, 1.6, 0.8, i === 0 ? 'rect' : 'circle')), ...[0, 1, 2, 3].map((i) => tht(String(8 - i), 3.81, -7.62 + i * 5.08, 1.6, 1.6, 0.8))], body: { x0: -5.0, y0: -10.25, x1: 5.0, y1: 10.25 }, verified: false, height: 11.5, tags: ['relay', 'g5v', 'dpdt'] }),
    boxFootprint({ id: 'Relay_SSR_PCB_Fotek_SSR-25DA', name: 'ТТР панельный (провода)', description: 'Твердотельное реле панельного монтажа (SSR-25DA): на плате только 4 площадки под провода управления и нагрузки', category: CAT.K, group: GK.relay, refPrefix: 'K', pads: rowX(4, 5.08, (i, x) => tht(String(i + 1), x, 0, 3.0, 3.0, 1.5, i === 0 ? 'rect' : 'circle', { name: ['IN+', 'IN-', 'L1', 'L2'][i] })), body: { x0: -10, y0: -3, x1: 10, y1: 3 }, verified: true, height: 0, tags: ['ssr'] }),
    boxFootprint({ id: 'Relay_G3MB-202P_SSR', name: 'ТТР G3MB-202P', description: 'Твердотельное реле Omron G3MB-202P на плату (24,5×4,5×20 мм), 4 вывода: вход 1–2 через 5,08, выход 3–4 через 7,62 мм; ряды через 20,3 мм', category: CAT.K, group: GK.relay, refPrefix: 'K', pads: [tht('1', -2.54, 10.15, 1.8, 1.8, 1.0, 'rect', { name: 'IN+' }), tht('2', 2.54, 10.15, 1.8, 1.8, 1.0, 'circle', { name: 'IN-' }), tht('3', -3.81, -10.15, 2.2, 2.2, 1.2, 'circle', { name: 'OUT' }), tht('4', 3.81, -10.15, 2.2, 2.2, 1.2, 'circle', { name: 'OUT' })], body: { x0: -12.25, y0: -11.5, x1: 12.25, y1: 11.5 }, verified: false, height: 20, tags: ['ssr', 'g3mb'] }),
  );
  return out;
}

/* ---- датчики (выводные и SMD; модули — в разделе «Модули») ---- */
function sensors(): FootprintDef[] {
  const out: FootprintDef[] = [];
  out.push(
    boxFootprint({ id: 'Sensor_DS18B20_TO-92', name: 'DS18B20 (TO-92)', description: 'Датчик температуры DS18B20 в TO-92: GND, DQ, VDD в линию с шагом 1,27 мм', category: CAT.SENS, group: GS.temp, refPrefix: 'U', pads: rowX(3, 1.27, (i, x) => tht(String(i + 1), x, 0, 1.05, 1.5, 0.75, 'oval', { name: ['GND', 'DQ', 'VDD'][i] })), body: { x0: -2.3, y0: -1.4, x1: 2.3, y1: 2.3 }, verified: true, height: 5, tags: ['ds18b20', 'temperature', 'to-92'] }),
    boxFootprint({ id: 'Sensor_LM35_TO-92', name: 'LM35 (TO-92)', description: 'Датчик температуры LM35/LM335 в TO-92: +Vs, OUT, GND с шагом 1,27 мм', category: CAT.SENS, group: GS.temp, refPrefix: 'U', pads: rowX(3, 1.27, (i, x) => tht(String(i + 1), x, 0, 1.05, 1.5, 0.75, 'oval', { name: ['VS', 'OUT', 'GND'][i] })), body: { x0: -2.3, y0: -1.4, x1: 2.3, y1: 2.3 }, verified: true, height: 5, tags: ['lm35', 'temperature'] }),
    boxFootprint({ id: 'Sensor_DHT11', name: 'DHT11', description: 'Датчик DHT11 (15,5×12×5,5 мм), 4 вывода с шагом 2,54 мм (VCC, DATA, NC, GND)', category: CAT.SENS, group: GS.temp, refPrefix: 'U', pads: rowX(4, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.6, 1.6, 0.9, i === 0 ? 'rect' : 'circle', { name: ['VCC', 'DATA', 'NC', 'GND'][i] })), body: { x0: -7.75, y0: -15.5, x1: 7.75, y1: -3.5 }, verified: false, height: 5.5, tags: ['dht11', 'humidity'] }),
    boxFootprint({ id: 'Sensor_SHT3x_DFN-8', name: 'SHT30/31 (DFN-8)', description: 'Датчик влажности Sensirion SHT3x, DFN-8 2,5×2,5 мм, шаг 1,0 мм', category: CAT.SENS, group: GS.temp, refPrefix: 'U', pads: [...rowX(4, 1.0, (i, x) => smd(String(i + 1), x, 1.25, 0.6, 0.9)), ...rowX(4, 1.0, (i, x) => smd(String(8 - i), x, -1.25, 0.6, 0.9))], body: { x0: -1.25, y0: -1.25, x1: 1.25, y1: 1.25 }, smd: true, pin1Mark: { x: -2.2, y: 1.25 }, verified: false, height: 0.9, tags: ['sht31', 'humidity'] }),
    boxFootprint({ id: 'Sensor_BME280_LGA-8', name: 'BME280 (LGA-8)', description: 'Датчик давления/влажности Bosch BME280, LGA-8 2,5×2,5 мм', category: CAT.SENS, group: GS.pressure, refPrefix: 'U', pads: [...rowX(4, 0.65, (i, x) => smd(String(i + 1), x, 1.0, 0.45, 0.65)), ...rowX(4, 0.65, (i, x) => smd(String(8 - i), x, -1.0, 0.45, 0.65))], body: { x0: -1.25, y0: -1.25, x1: 1.25, y1: 1.25 }, smd: true, pin1Mark: { x: -1.8, y: 1.0 }, verified: false, height: 0.95, tags: ['bme280', 'pressure'] }),
    boxFootprint({ id: 'Sensor_MPX5100DP', name: 'MPX5100DP', description: 'Датчик давления Freescale MPX5100DP/MPX5010DP (корпус 867C, два порта), 6 выводов с шагом 2,54 мм (1 — VOUT, 2 — GND, 3 — VS)', category: CAT.SENS, group: GS.pressure, refPrefix: 'U', pads: rowX(6, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.6, 1.6, 0.9, i === 0 ? 'rect' : 'circle', { name: ['VOUT', 'GND', 'VS', 'V1', 'V2', 'VEX'][i] })), body: { x0: -8.9, y0: -8.0, x1: 8.9, y1: 5.0 }, verified: false, height: 17, tags: ['mpx5100', 'pressure'] }),
    boxFootprint({ id: 'Sensor_Gas_MQ-x', name: 'Датчик газа MQ-x', description: 'Датчик газа серии MQ (MQ-2…MQ-135) Ø20 мм, 6 выводов: две группы по 3 в линию с шагом 3,0 мм на расстоянии 14 мм (сверить с даташитом)', category: CAT.SENS, group: GS.pressure, refPrefix: 'U', pads: [...rowX(3, 3.0, (i, x) => tht(String(i + 1), x, 7.0, 2.0, 2.0, 1.2, i === 0 ? 'rect' : 'circle')), ...rowX(3, 3.0, (i, x) => tht(String(i + 4), x, -7.0, 2.0, 2.0, 1.2))], body: { x0: -10, y0: -10, x1: 10, y1: 10 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 10, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 10.2, SILK_W)], noSilk: true, verified: false, height: 22, tags: ['mq', 'gas'] }),
    boxFootprint({ id: 'Sensor_ACS712_SOIC-8', name: 'ACS712 (SOIC-8)', description: 'Датчик тока Allegro ACS712 в SOIC-8: 1–2 IP+, 3–4 IP−, 5 GND, 6 FILTER, 7 VIOUT, 8 VCC', category: CAT.SENS, group: GS.current, refPrefix: 'U', pads: [...[0, 1, 2, 3].map((i) => smd(String(i + 1), -2.7, -1.905 + i * 1.27, 1.55, 0.6)), ...[0, 1, 2, 3].map((i) => smd(String(8 - i), 2.7, -1.905 + i * 1.27, 1.55, 0.6))], body: { x0: -1.95, y0: -2.45, x1: 1.95, y1: 2.45 }, smd: true, pin1Mark: { x: -3.9, y: -1.9 }, verified: true, height: 1.75, tags: ['acs712', 'current'] }),
    boxFootprint({ id: 'Sensor_CT_ZMCT103C', name: 'Трансформатор тока ZMCT103C', description: 'Трансформатор тока ZMCT103C Ø5 мм отверстие, 2 вывода с шагом 5,08 мм, корпус 12,5×10 мм', category: CAT.SENS, group: GS.current, refPrefix: 'T', pads: rowX(2, 5.08, (i, x) => tht(String(i + 1), x, 4.0, 1.8, 1.8, 1.0, i === 0 ? 'rect' : 'circle')), body: { x0: -6.25, y0: -6.0, x1: 6.25, y1: 6.0 }, extraGraphics: [circle('F.Fab', { x: 0, y: -1.0 }, 2.5, FAB_W)], verified: false, height: 9, tags: ['current-transformer', 'zmct103'] }),
    boxFootprint({ id: 'Sensor_ZMPT101B', name: 'Трансформатор напряжения ZMPT101B', description: 'Измерительный трансформатор ZMPT101B, 4 вывода (2+2) с шагом 5,08 мм, ряды через 7,6 мм, корпус 19×15 мм', category: CAT.SENS, group: GS.current, refPrefix: 'T', pads: [tht('1', -2.54, 3.8, 1.8, 1.8, 1.0, 'rect'), tht('2', 2.54, 3.8, 1.8, 1.8, 1.0), tht('3', -2.54, -3.8, 1.8, 1.8, 1.0), tht('4', 2.54, -3.8, 1.8, 1.8, 1.0)], body: { x0: -9.5, y0: -7.5, x1: 9.5, y1: 7.5 }, verified: false, height: 13, tags: ['zmpt101b', 'voltage'] }),
    boxFootprint({ id: 'Sensor_Hall_TO-92', name: 'Датчик Холла (TO-92)', description: 'Датчик Холла A3144/49E/SS49E в TO-92 (или SIP-3): VCC, GND, OUT с шагом 1,27 мм', category: CAT.SENS, group: GS.motion, refPrefix: 'U', pads: rowX(3, 1.27, (i, x) => tht(String(i + 1), x, 0, 1.05, 1.5, 0.75, 'oval', { name: ['VCC', 'GND', 'OUT'][i] })), body: { x0: -2.3, y0: -1.4, x1: 2.3, y1: 2.3 }, verified: true, height: 5, tags: ['hall', 'to-92'] }),
    twoPinTht({ id: 'Sensor_Reed_Switch_L14mm_P19mm', name: 'Геркон 14 мм', description: 'Геркон стеклянный 14×2,2 мм, горизонтально, шаг 19 мм', category: CAT.SENS, group: GS.motion, refPrefix: 'SW', pitch: 19.0, drill: 0.8, pad: 1.6, body: { len: 14, wid: 2.2 }, tags: ['reed'], verified: true, height: 2.2 }),
    twoPinTht({ id: 'Sensor_Tilt_SW-520D_Vertical', name: 'Датчик наклона SW-520D', description: 'Шариковый датчик наклона SW-520D Ø4,5×12 мм, выводы через 2,54 мм, стоя', category: CAT.SENS, group: GS.motion, refPrefix: 'SW', pitch: 2.54, drill: 0.8, pad: 1.6, body: { d: 4.6, at: 1.27 }, tags: ['tilt'], verified: false, height: 12 }),
    twoPinTht({ id: 'Sensor_Vibration_SW-18010P', name: 'Датчик вибрации SW-18010P', description: 'Пружинный датчик вибрации SW-18010P, выводы через 2,54 мм (или 5 мм), стоя', category: CAT.SENS, group: GS.motion, refPrefix: 'SW', pitch: 2.54, drill: 0.8, pad: 1.6, body: { d: 3.5, at: 1.27 }, tags: ['vibration'], verified: false, height: 11 }),
    boxFootprint({ id: 'Sensor_IR_Receiver_TSOP_VS1838B', name: 'ИК-приёмник VS1838B', description: 'ИК-приёмник VS1838B/TSOP38238, 3 вывода с шагом 2,54 мм (OUT, GND, VCC — сверить), окно к −Y', category: CAT.SENS, group: GS.other, refPrefix: 'U', pads: rowX(3, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.6, 1.6, 0.9, i === 0 ? 'rect' : 'circle', { name: ['OUT', 'GND', 'VCC'][i] })), body: { x0: -3.5, y0: -3.0, x1: 3.5, y1: 1.5 }, verified: false, height: 7, tags: ['ir', 'receiver'] }),
    twoPinTht({ id: 'Sensor_IR_LED_D5mm_P2.54mm', name: 'ИК-светодиод / фотодиод 5 мм', description: 'ИК-светодиод или фотодиод Ø5 мм (TSAL6200/PD333), шаг 2,54 мм, катод — вывод 1', category: CAT.SENS, group: GS.other, refPrefix: 'D', pitch: 2.54, drill: 0.9, pad: 1.8, body: { d: 5.6 }, polar: true, padNames: ['K', 'A'], tags: ['ir', 'photodiode'], verified: true, height: 8.6 }),
    boxFootprint({ id: 'Sensor_HC-SR04_Pads', name: 'HC-SR04 (площадки)', description: 'Ультразвуковой дальномер HC-SR04: 4 площадки под угловой разъём с шагом 2,54 мм (VCC, TRIG, ECHO, GND); сам модуль 45×20 мм', category: CAT.SENS, group: GS.motion, refPrefix: 'U', pads: rowX(4, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.7, 1.7, 1.0, i === 0 ? 'rect' : 'oval', { name: ['VCC', 'TRIG', 'ECHO', 'GND'][i] })), body: { x0: -22.5, y0: -12.0, x1: 22.5, y1: 8.0 }, extraGraphics: [circle('F.Fab', { x: -13, y: -2 }, 8, FAB_W), circle('F.Fab', { x: 13, y: -2 }, 8, FAB_W)], verified: false, height: 15, tags: ['hc-sr04', 'ultrasonic'] }),
  );
  return out;
}

/* ---- питание: готовые AC-DC и DC-DC блоки на плату ---- */
function power(): FootprintDef[] {
  const out: FootprintDef[] = [];
  out.push(
    boxFootprint({ id: 'PS_HLK-5M05_AC-DC', name: 'HLK-5M05 (5 Вт)', description: 'Hi-Link HLK-5M05/5M12 (5 Вт) 38×23×18 мм: вход AC два вывода через 20,4 мм, выход два через 10,4 мм (типовые размеры — сверить)', category: CAT.PS, group: GP.acdc, refPrefix: 'PS', pads: [tht('1', -5.2, -16.0, 2.4, 2.4, 1.3, 'rect', { name: '+Vo' }), tht('2', 5.2, -16.0, 2.4, 2.4, 1.3, 'circle', { name: '-Vo' }), tht('3', -10.2, 16.0, 2.4, 2.4, 1.3, 'circle', { name: 'AC' }), tht('4', 10.2, 16.0, 2.4, 2.4, 1.3, 'circle', { name: 'AC' })], body: { x0: -11.5, y0: -19.0, x1: 11.5, y1: 19.0 }, verified: false, height: 18, tags: ['hi-link', 'ac-dc', '230v'] }),
    boxFootprint({ id: 'PS_IRM-05_AC-DC', name: 'Mean Well IRM-05', description: 'Mean Well IRM-05 (5 Вт) 45,7×25,4×21,5 мм: вход AC через 20,32 мм, выход через 10,16 мм, ряды через 38,1 мм (сверить с даташитом)', category: CAT.PS, group: GP.acdc, refPrefix: 'PS', pads: [tht('1', -5.08, -19.05, 2.4, 2.4, 1.3, 'rect', { name: '+V' }), tht('2', 5.08, -19.05, 2.4, 2.4, 1.3, 'circle', { name: '-V' }), tht('3', -10.16, 19.05, 2.4, 2.4, 1.3, 'circle', { name: 'AC/L' }), tht('4', 10.16, 19.05, 2.4, 2.4, 1.3, 'circle', { name: 'AC/N' })], body: { x0: -12.7, y0: -22.85, x1: 12.7, y1: 22.85 }, verified: false, height: 21.5, tags: ['mean well', 'ac-dc'] }),
    boxFootprint({ id: 'PS_SIP-DCDC_B0505S', name: 'DC-DC SIP-4 (B0505S)', description: 'Изолированный DC-DC B0505S/B1205S в корпусе SIP-4, 4 вывода с шагом 2,54 мм (VIN, GND, 0V, +VO)', category: CAT.PS, group: GP.dcdc, refPrefix: 'PS', pads: rowX(4, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.6, 1.6, 0.9, i === 0 ? 'rect' : 'circle', { name: ['VIN', 'GND', '0V', '+VO'][i] })), body: { x0: -5.9, y0: -3.5, x1: 5.9, y1: 1.5 }, verified: true, height: 10, tags: ['dc-dc', 'sip', 'isolated'] }),
    boxFootprint({ id: 'PS_SIP-DCDC_7pin_B0505S-2W', name: 'DC-DC SIP-7 (2 Вт)', description: 'Изолированный DC-DC 2 Вт в корпусе SIP-7 (19,5×6×10 мм), 7 выводов с шагом 2,54 мм (часть не установлена)', category: CAT.PS, group: GP.dcdc, refPrefix: 'PS', pads: rowX(7, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.6, 1.6, 0.9, i === 0 ? 'rect' : 'circle')), body: { x0: -9.75, y0: -4.0, x1: 9.75, y1: 2.0 }, verified: false, height: 10, tags: ['dc-dc', 'sip', 'isolated'] }),
    boxFootprint({ id: 'PS_DCDC_TO-220_Module_K7805', name: 'K7805 (TO-220)', description: 'Понижающий DC-DC модуль K7805-1000 / OKI-78SR в форм-факторе TO-220 (IN, GND, OUT), шаг 2,54 мм', category: CAT.PS, group: GP.dcdc, refPrefix: 'PS', pads: rowX(3, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.8, 2.6, 1.0, i === 0 ? 'rect' : 'oval', { name: ['IN', 'GND', 'OUT'][i] })), body: { x0: -5.8, y0: -4.5, x1: 5.8, y1: 0.4 }, verified: true, height: 10, tags: ['dc-dc', 'k7805', 'to-220'] }),
  );
  return out;
}

export function allMisc(): FootprintDef[] {
  const out: FootprintDef[] = [];
  for (const m of [2, 2.5, 3, 4] as const) {
    if (m === 2) out.push(boxFootprint({ id: 'MountingHole_2.2mm_M2', name: 'Отверстие M2', description: 'Крепёжное отверстие Ø2,2 мм под винт M2', category: CAT.H, group: GH.holes, refPrefix: 'H', pads: [npth(0, 0, 2.2)], body: { x0: -2.2, y0: -2.2, x1: 2.2, y1: 2.2 }, noSilk: true, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 2.2, FAB_W)], verified: true, height: 0, tags: ['hole', 'm2'] }), boxFootprint({ id: 'MountingHole_2.2mm_M2_Pad', name: 'Отверстие M2 + кольцо', description: 'Крепёжное отверстие Ø2,2 мм с медным кольцом Ø4,4', category: CAT.H, group: GH.holes, refPrefix: 'H', pads: [tht('1', 0, 0, 4.4, 4.4, 2.2)], body: { x0: -2.2, y0: -2.2, x1: 2.2, y1: 2.2 }, noSilk: true, verified: true, height: 0, tags: ['hole', 'm2'] }));
    else out.push({ ...mountingHole(m), group: GH.holes, category: CAT.H }, { ...mountingHole(m, true), group: GH.holes, category: CAT.H });
  }
  out.push(boxFootprint({ id: 'MountingHole_5.3mm_M5', name: 'Отверстие M5', description: 'Крепёжное отверстие Ø5,3 мм под винт M5', category: CAT.H, group: GH.holes, refPrefix: 'H', pads: [npth(0, 0, 5.3)], body: { x0: -5.3, y0: -5.3, x1: 5.3, y1: 5.3 }, noSilk: true, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 5.3, FAB_W)], verified: true, height: 0, tags: ['hole', 'm5'] }));
  out.push(boxFootprint({ id: 'Slot_3.2x6mm', name: 'Паз 3,2×6', description: 'Продольный паз 3,2×6 мм под винт M3 (регулировка положения). Фрезеруется по контуру', category: CAT.H, group: GH.holes, refPrefix: 'H', pads: [npth(-1.4, 0, 3.2), npth(0, 0, 3.2), npth(1.4, 0, 3.2)], body: { x0: -3.0, y0: -1.6, x1: 3.0, y1: 1.6 }, noSilk: true, extraGraphics: [rect('F.Fab', -3.0, -1.6, 3.0, 1.6, FAB_W)], verified: true, height: 0, tags: ['slot'] }));
  out.push(testPoint('tht_1.0'), testPoint('tht_1.5'), testPoint('smd_1x1'), testPoint('smd_1.5x1.5'), testPoint('smd_2x2'), testPoint('loop'));
  out.push(wirePad(2.0, 1.0), wirePad(2.5, 1.3), wirePad(3.0, 1.5), wirePad(4.0, 2.0), wirePad(5.0, 2.5), wirePadSmd(2), wirePadSmd(3), wirePadSmd(5));
  out.push(solderJumper('2_open'), solderJumper('2_bridged'), solderJumper('3_open'), solderJumper('3_bridged12'), fiducial(1), fiducial(1.5));
  out.push(...fuses(), ...relays(), ...sensors(), ...power());
  void line;
  return out;
}
