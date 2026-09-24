import type { FootprintDef, Graphic, PadDef } from '../../model/types';
import { CAT } from '../categories';
import { jst, pinHeader, screwTerminal } from './tht';
import { CRT_THT, FAB_W, SILK_W, boxFootprint, circle, courtyardAround, crtGraphic, fmtP, line, npth, poly, rect, refText, rowX, smd, tht, valueText } from './util';

/* Разъёмы: штыри и гнёзда, угловые, мелкий шаг, IDC, JST, Molex, клеммники, питание, USB, аудио, сеть, батареи. */

const G = { pins: 'Штыри 2,54', sockets: 'Гнёзда 2,54', angled: 'Угловые 2,54', fine: 'Шаг 2,0 и 1,27', idc: 'IDC и коробчатые', jst: 'JST', molex: 'Molex и прочие с защёлкой', term: 'Клеммники', power: 'Питание', usb: 'USB', audio: 'Аудио и сеть', batt: 'Батареи' };

/** Угловой штыревой разъём: отверстия как у прямого, корпус лежит на плате в сторону −Y. */
function angledHeader(rows: 1 | 2, n: number, female = false): FootprintDef {
  const base = pinHeader(rows, n, 2.54, { female });
  const hw = (n * 2.54) / 2;
  const y0 = -1.27 - (rows - 1) * 2.54 - 2.54;
  const bodyTop = female ? y0 - 8.5 : y0 - 6.0;
  const g: Graphic[] = [rect('F.Fab', -hw, y0, hw, y0 - 2.54, FAB_W), rect('F.Fab', -hw, y0 - 2.54, hw, bodyTop, FAB_W), rect('F.Silk', -hw - 0.1, y0 - 0.1, hw + 0.1, bodyTop - 0.1, SILK_W), line('F.Silk', { x: -hw - 0.1, y: y0 - 2.54 }, { x: hw + 0.1, y: y0 - 2.54 })];
  for (let i = 0; i < n; i++) {
    const x = -((n - 1) * 2.54) / 2 + i * 2.54;
    g.push(line('F.Fab', { x, y: -1.27 - (rows - 1) * 2.54 + 0.3 }, { x, y: y0 }, FAB_W));
  }
  const crt = courtyardAround(base.pads, { x0: -hw, y0: bodyTop, x1: hw, y1: 1.27 }, CRT_THT);
  g.push(crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7));
  return { ...base, id: `${female ? 'PinSocket' : 'PinHeader'}_${rows}x${String(n).padStart(2, '0')}_P2.54mm_Horizontal`, name: `${female ? 'Гнездо' : 'Штыри'} ${rows}×${n} угл.`, description: `${female ? 'Гнездо' : 'Штыри'} ${rows}×${n}, шаг 2,54 мм, угловое (корпус лежит на плате)`, group: G.angled, graphics: g, courtyard: crt, tags: ['tht', 'header', 'angled'] };
}

/** Коробчатый разъём IDC 2×n с шагом 2,54 (ключ снизу). */
function idcBox(n: number, angled = false): FootprintDef {
  const pads: PadDef[] = [];
  const x0 = -((n - 1) * 2.54) / 2;
  let k = 1;
  for (let i = 0; i < n; i++) {
    pads.push(tht(String(k++), x0 + i * 2.54, 1.27, 1.7, 1.7, 1.0, k === 2 ? 'rect' : 'oval'));
    pads.push(tht(String(k++), x0 + i * 2.54, -1.27, 1.7, 1.7, 1.0, 'oval'));
  }
  const L = (n - 1) * 2.54 + 10.16;
  const W = 8.9;
  const g: Graphic[] = [poly('F.Silk', [{ x: -2.0, y: W / 2 + 0.1 }, { x: -2.0, y: W / 2 - 1.0 }, { x: 2.0, y: W / 2 - 1.0 }, { x: 2.0, y: W / 2 + 0.1 }], SILK_W, false)];
  return boxFootprint({ id: `IDC-Header_2x${String(n).padStart(2, '0')}_P2.54mm${angled ? '_Horizontal' : '_Vertical'}`, name: `IDC 2×${n}`, description: `Коробчатый разъём IDC (BH-${2 * n}) 2×${n}, шаг 2,54 мм, ключ на стороне +Y, вывод 1 слева сверху${angled ? ', угловой' : ''}`, category: CAT.J, group: G.idc, refPrefix: 'J', pads, body: { x0: -L / 2, y0: -W / 2, x1: L / 2, y1: W / 2 }, extraGraphics: g, pin1Mark: { x: x0 - 1.5, y: 1.27 }, verified: true, height: 9, tags: ['idc', 'box-header', `2x${n}`] });
}

/** Разъёмы с шагом 1,27 мм: штыри 1×n и 2×n. */
function fineHeader(rows: 1 | 2, n: number, pitch: 1.27 | 2.0): FootprintDef {
  const padD = pitch === 2.0 ? 1.35 : 1.0;
  const drill = pitch === 2.0 ? 0.8 : 0.65;
  const pads: PadDef[] = [];
  const x0 = -((n - 1) * pitch) / 2;
  const y0 = -((rows - 1) * pitch) / 2;
  let k = 1;
  for (let i = 0; i < n; i++) for (let r = 0; r < rows; r++) pads.push(tht(String(k++), x0 + i * pitch, y0 + r * pitch, padD, padD, drill, k === 2 ? 'rect' : 'oval'));
  const hw = (n * pitch) / 2;
  const hh = (rows * pitch) / 2;
  return boxFootprint({ id: `PinHeader_${rows}x${String(n).padStart(2, '0')}_P${pitch}mm`, name: `Штыри ${rows}×${n}, ${fmtP(pitch)}`, description: `Штыревой разъём ${rows}×${n}, шаг ${fmtP(pitch)} мм`, category: CAT.J, group: G.fine, refPrefix: 'J', pads, body: { x0: -hw, y0: -hh, x1: hw, y1: hh }, pin1Mark: { x: x0, y: y0 - hh - 0.5 }, verified: true, height: 5, tags: ['header', `${pitch}mm`] });
}

/** JST SH 1,0 мм SMD (горизонтальный, как в QWIIC/STEMMA): n сигнальных площадок и две крепёжные. */
function jstSh(n: number): FootprintDef {
  const pads: PadDef[] = rowX(n, 1.0, (i, x) => smd(String(i + 1), x, -2.2, 0.6, 1.55));
  const w = (n - 1) * 1.0 + 3.0;
  pads.push(smd('MP1', -w / 2 - 0.6, 0.55, 1.2, 1.8, 'rect', { name: 'MP' }), smd('MP2', w / 2 + 0.6, 0.55, 1.2, 1.8, 'rect', { name: 'MP' }));
  return boxFootprint({ id: `JST_SH_SM${String(n).padStart(2, '0')}B-SRSS-TB_1x${String(n).padStart(2, '0')}_P1.0mm_Horizontal`, name: `JST SH ${n} SMD`, description: `Разъём JST SH ${n} конт., шаг 1,0 мм, SMD угловой (Qwiic/STEMMA QT при n=4)`, category: CAT.J, group: G.jst, refPrefix: 'J', pads, body: { x0: -w / 2 - 1.0, y0: -1.5, x1: w / 2 + 1.0, y1: 2.7 }, smd: true, pin1Mark: { x: -((n - 1) * 1.0) / 2, y: -3.6 }, verified: false, height: 4.3, tags: ['jst', 'sh', 'qwiic'] });
}

/** JST VH 3,96 мм (силовой). */
function jstVh(n: number): FootprintDef {
  const pads = rowX(n, 3.96, (i, x) => tht(String(i + 1), x, 0, 2.6, 2.6, 1.7, i === 0 ? 'rect' : 'circle'));
  const w = (n - 1) * 3.96 + 7.0;
  return boxFootprint({ id: `JST_VH_B${n}P-VH_1x${String(n).padStart(2, '0')}_P3.96mm_Vertical`, name: `JST VH ${n}`, description: `Разъём JST VH ${n} конт., шаг 3,96 мм, вертикальный (до 10 А)`, category: CAT.J, group: G.jst, refPrefix: 'J', pads, body: { x0: -w / 2, y0: -3.6, x1: w / 2, y1: 4.7 }, pin1Mark: { x: -((n - 1) * 3.96) / 2, y: -4.3 }, verified: false, height: 12, tags: ['jst', 'vh', 'power'] });
}

/** Molex KK 254 (2,54 мм) с защёлкой — тот же ряд отверстий, что у штырей, корпус с замком. */
function molexKk(n: number): FootprintDef {
  const pads = rowX(n, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.7, 1.7, 1.0, i === 0 ? 'rect' : 'oval'));
  const w = (n - 1) * 2.54 + 5.8;
  return boxFootprint({ id: `Molex_KK-254_1x${String(n).padStart(2, '0')}_P2.54mm_Vertical`, name: `Molex KK ${n}`, description: `Разъём Molex KK 254 (2,54 мм) с защёлкой, ${n} конт., вертикальный (замок на стороне +Y)`, category: CAT.J, group: G.molex, refPrefix: 'J', pads, body: { x0: -w / 2, y0: -3.2, x1: w / 2, y1: 3.2 }, extraGraphics: [line('F.Silk', { x: -w / 2 + 1, y: 3.3 }, { x: w / 2 - 1, y: 3.3 }, 0.3)], pin1Mark: { x: -((n - 1) * 2.54) / 2, y: -3.9 }, verified: false, height: 8.5, tags: ['molex', 'kk'] });
}

/** Разъём питания DC 5,5×2,1 мм (DC-005), угловой на плату. */
function dcJack(): FootprintDef {
  const pads = [tht('1', 0, 0, 3.5, 3.5, 1.3, 'rect', { name: '+' }), tht('2', 6.0, 0, 3.5, 3.5, 1.3, 'circle', { name: 'GND' }), tht('3', 3.0, 4.7, 3.5, 3.5, 1.3, 'circle', { name: 'SW' })];
  return boxFootprint({ id: 'BarrelJack_DC-005_Horizontal', name: 'DC-005 гнездо 5,5×2,1', description: 'Гнездо питания DC-005 (5,5×2,1 мм) угловое: 1 — центральный штырь (+), 2 — корпус (GND), 3 — размыкатель. Выводы плоские: отверстия Ø1,3 под них могут потребовать пропила', category: CAT.J, group: G.power, refPrefix: 'J', pads, body: { x0: -1.5, y0: -7.5, x1: 7.5, y1: 6.8 }, extraGraphics: [line('F.Fab', { x: -1.5, y: -7.5 }, { x: 7.5, y: -7.5 }, 0.3)], verified: false, height: 11, tags: ['dc', 'barrel', 'power'] });
}

/** Выключатель/разъём IEC C14 на плату — редкость; вместо него терминал сети. */

/** USB-разъёмы. */
function usbA(): FootprintDef {
  const pads: PadDef[] = [tht('1', -3.5, 0, 1.8, 1.8, 0.9, 'rect', { name: 'VBUS' }), tht('2', -1.0, 0, 1.8, 1.8, 0.9, 'circle', { name: 'D-' }), tht('3', 1.0, 0, 1.8, 1.8, 0.9, 'circle', { name: 'D+' }), tht('4', 3.5, 0, 1.8, 1.8, 0.9, 'circle', { name: 'GND' }), tht('S1', -6.57, 2.7, 3.5, 3.5, 2.3, 'circle', { name: 'SHIELD' }), tht('S2', 6.57, 2.7, 3.5, 3.5, 2.3, 'circle', { name: 'SHIELD' })];
  return boxFootprint({ id: 'USB_A_Receptacle_Horizontal', name: 'USB-A гнездо', description: 'Гнездо USB-A угловое на плату: 4 сигнальных вывода (2,5/2,0/2,5 мм) и два вывода корпуса Ø2,3', category: CAT.J, group: G.usb, refPrefix: 'J', pads, body: { x0: -6.7, y0: -10.0, x1: 6.7, y1: 4.5 }, verified: false, height: 7, tags: ['usb', 'usb-a'] });
}
function usbMicroB(): FootprintDef {
  const pads: PadDef[] = rowX(5, 0.65, (i, x) => smd(String(i + 1), x, -1.35, 0.4, 1.35, 'roundrect', { name: ['VBUS', 'D-', 'D+', 'ID', 'GND'][i] }));
  pads.push(smd('S1', -3.55, -1.6, 1.4, 1.8, 'rect', { name: 'SHIELD' }), smd('S2', 3.55, -1.6, 1.4, 1.8, 'rect', { name: 'SHIELD' }), smd('S3', -3.5, 1.5, 1.6, 1.8, 'rect', { name: 'SHIELD' }), smd('S4', 3.5, 1.5, 1.6, 1.8, 'rect', { name: 'SHIELD' }));
  pads.push(npth(-2.5, 0, 0.9), npth(2.5, 0, 0.9));
  return boxFootprint({ id: 'USB_Micro-B_Receptacle_SMD', name: 'USB Micro-B', description: 'Гнездо USB Micro-B SMD (типовое 5-контактное с 4 лапками экрана и двумя направляющими Ø0,9). У разных партий геометрия различается — сверить с даташитом', category: CAT.J, group: G.usb, refPrefix: 'J', pads, body: { x0: -3.75, y0: -2.9, x1: 3.75, y1: 2.9 }, smd: true, verified: false, height: 2.6, tags: ['usb', 'micro-usb'] });
}
function usbC16(): FootprintDef {
  // Упрощённый 16-контактный USB-C (только питание, CC и USB 2.0): один ряд SMD выводов и четыре лапки экрана.
  const pads: PadDef[] = [];
  const p16: [string, number, string, number][] = [
    ['A1B12', -3.2, 'GND', 0.6],
    ['A4B9', -2.4, 'VBUS', 0.6],
    ['B8', -1.75, 'SBU2', 0.3],
    ['A5', -1.25, 'CC1', 0.3],
    ['B7', -0.75, 'D-', 0.3],
    ['A6', -0.25, 'D+', 0.3],
    ['A7', 0.25, 'D-', 0.3],
    ['B6', 0.75, 'D+', 0.3],
    ['A8', 1.25, 'SBU1', 0.3],
    ['B5', 1.75, 'CC2', 0.3],
    ['B4A9', 2.4, 'VBUS', 0.6],
    ['B1A12', 3.2, 'GND', 0.6],
  ];
  for (const [num, x, nm, w] of p16) pads.push(smd(num, x, -3.5, w, 1.1, 'roundrect', { name: nm }));
  pads.push(smd('S1', -4.32, -3.2, 1.0, 2.1, 'rect', { name: 'SHIELD' }), smd('S2', 4.32, -3.2, 1.0, 2.1, 'rect', { name: 'SHIELD' }), smd('S3', -4.32, 1.0, 1.0, 1.8, 'rect', { name: 'SHIELD' }), smd('S4', 4.32, 1.0, 1.0, 1.8, 'rect', { name: 'SHIELD' }));
  pads.push(npth(-2.89, -2.6, 0.65), npth(2.89, -2.6, 0.65));
  return boxFootprint({ id: 'USB_C_Receptacle_16P_SMD', name: 'USB-C 16 конт.', description: 'Гнездо USB Type-C 16-контактное (питание + USB 2.0), горизонтальное SMD. Это обобщённая раскладка: перед заказом сверить с даташитом конкретного разъёма', category: CAT.J, group: G.usb, refPrefix: 'J', pads, body: { x0: -4.5, y0: -4.0, x1: 4.5, y1: 3.2 }, smd: true, verified: false, height: 3.3, tags: ['usb', 'usb-c', 'type-c'] });
}

/** Гнездо 3,5 мм PJ-320A (4 вывода, стерео с выключателем). */
function audioJack(): FootprintDef {
  const pads = [tht('1', -3.5, 0, 2.0, 1.6, 1.0, 'oval', { name: 'S' }), tht('2', 3.5, 0, 2.0, 1.6, 1.0, 'oval', { name: 'T' }), tht('3', -1.0, -4.0, 2.0, 1.6, 1.0, 'oval', { name: 'R' }), tht('4', 2.0, 4.0, 2.0, 1.6, 1.0, 'oval', { name: 'SW' })];
  return boxFootprint({ id: 'Jack_3.5mm_PJ320A', name: 'Гнездо 3,5 мм PJ-320A', description: 'Аудиогнездо 3,5 мм PJ-320A угловое, 4 вывода (типовая раскладка, сверить)', category: CAT.J, group: G.audio, refPrefix: 'J', pads, body: { x0: -6.0, y0: -6.0, x1: 6.0, y1: 6.0 }, verified: false, height: 5, tags: ['audio', 'jack', '3.5mm'] });
}
function rj45(): FootprintDef {
  const pads: PadDef[] = [];
  for (let i = 0; i < 8; i++) pads.push(tht(String(i + 1), -4.445 + i * 1.27, i % 2 ? -2.54 : 0, 1.5, 1.5, 0.9, i === 0 ? 'rect' : 'circle'));
  pads.push(npth(-5.715, 6.0, 3.2), npth(5.715, 6.0, 3.2));
  return boxFootprint({ id: 'RJ45_8P8C_Horizontal', name: 'RJ45 (8P8C)', description: 'Гнездо RJ45 угловое: 8 выводов в два ряда с шагом 1,27 мм, две пластиковые ножки Ø3,2 через 11,43 мм', category: CAT.J, group: G.audio, refPrefix: 'J', pads, body: { x0: -8.0, y0: -6.0, x1: 8.0, y1: 15.5 }, verified: false, height: 13.5, tags: ['rj45', 'ethernet'] });
}
function rj11(): FootprintDef {
  const pads: PadDef[] = [];
  for (let i = 0; i < 6; i++) pads.push(tht(String(i + 1), -3.175 + i * 1.27, i % 2 ? -2.54 : 0, 1.5, 1.5, 0.9, i === 0 ? 'rect' : 'circle'));
  pads.push(npth(-5.0, 6.0, 3.2), npth(5.0, 6.0, 3.2));
  return boxFootprint({ id: 'RJ11_6P6C_Horizontal', name: 'RJ11/RJ12 (6P6C)', description: 'Гнездо RJ11/RJ12 угловое: 6 выводов в два ряда с шагом 1,27 мм, две ножки Ø3,2', category: CAT.J, group: G.audio, refPrefix: 'J', pads, body: { x0: -6.5, y0: -6.0, x1: 6.5, y1: 14.0 }, verified: false, height: 13, tags: ['rj11', 'phone'] });
}

/** Держатели батарей. */
function cr2032Smd(): FootprintDef {
  const pads = [smd('1', -11.0, 0, 3.5, 4.5, 'rect', { name: '+' }), smd('2', 11.0, 0, 3.5, 4.5, 'rect', { name: '+' }), smd('3', 0, 0, 3.0, 3.0, 'rect', { name: '-' })];
  return boxFootprint({ id: 'BatteryHolder_CR2032_SMD_BS-7', name: 'Держатель CR2032 SMD', description: 'Держатель батареи CR2032 SMD (BS-7 / Keystone 3034): две боковые площадки «+» и центральная «−»', category: CAT.J, group: G.batt, refPrefix: 'BT', pads, body: { x0: -10.5, y0: -10.5, x1: 10.5, y1: 10.5 }, smd: true, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 10.0, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 10.6, SILK_W)], noSilk: true, verified: false, height: 5.4, tags: ['battery', 'cr2032'] });
}
function cr2032Tht(): FootprintDef {
  const pads = [tht('1', -10.0, 0, 2.6, 2.6, 1.3, 'rect', { name: '+' }), tht('2', 10.0, 0, 2.6, 2.6, 1.3, 'circle', { name: '-' })];
  return boxFootprint({ id: 'BatteryHolder_CR2032_THT_BH-2032', name: 'Держатель CR2032 THT', description: 'Держатель батареи CR2032 выводной (BH-2032 / CH291), два вывода через 20 мм (типовая раскладка)', category: CAT.J, group: G.batt, refPrefix: 'BT', pads, body: { x0: -12.0, y0: -12.0, x1: 12.0, y1: 12.0 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 10.5, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 11.6, SILK_W)], noSilk: true, verified: false, height: 6, tags: ['battery', 'cr2032'] });
}
function battery18650(): FootprintDef {
  const pads = [tht('1', -37.5, 0, 3.0, 3.0, 1.5, 'rect', { name: '+' }), tht('2', 37.5, 0, 3.0, 3.0, 1.5, 'circle', { name: '-' })];
  return boxFootprint({ id: 'BatteryHolder_18650_1x', name: 'Держатель 18650', description: 'Держатель одного аккумулятора 18650 на плату, выводы через 75 мм (типовой пластиковый холдер 77×21 мм)', category: CAT.J, group: G.batt, refPrefix: 'BT', pads, body: { x0: -38.5, y0: -10.5, x1: 38.5, y1: 10.5 }, verified: false, height: 20, tags: ['battery', '18650'] });
}
function batteryAA(kind: 'AA' | 'AAA'): FootprintDef {
  const L = kind === 'AA' ? 57.5 : 48.0;
  const W = kind === 'AA' ? 15.5 : 12.0;
  const pads = [tht('1', -L / 2, 0, 3.0, 3.0, 1.5, 'rect', { name: '+' }), tht('2', L / 2, 0, 3.0, 3.0, 1.5, 'circle', { name: '-' })];
  return boxFootprint({ id: `BatteryHolder_${kind}_1x`, name: `Держатель ${kind}`, description: `Держатель одной батареи ${kind} на плату, выводы через ${L} мм (типовой)`, category: CAT.J, group: G.batt, refPrefix: 'BT', pads, body: { x0: -L / 2 - 1.5, y0: -W / 2, x1: L / 2 + 1.5, y1: W / 2 }, verified: false, height: 15, tags: ['battery', kind.toLowerCase()] });
}
function jstPhBattery(): FootprintDef {
  return { ...jst('PH', 2), id: 'JST_PH_2_LiPo', name: 'JST PH 2 (Li-Po)', description: 'Разъём JST PH 2,0 мм на 2 контакта — стандартный разъём Li-Po аккумуляторов', group: G.batt, tags: ['jst', 'lipo', 'battery'] };
}

export function allConnectors(): FootprintDef[] {
  const out: FootprintDef[] = [];
  for (let n = 1; n <= 40; n++) out.push({ ...pinHeader(1, n), group: G.pins });
  for (let n = 1; n <= 40; n++) out.push({ ...pinHeader(2, n), group: G.pins });
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 16, 20, 40]) out.push({ ...pinHeader(1, n, 2.54, { female: true }), group: G.sockets });
  for (const n of [2, 3, 4, 5, 6, 8, 10, 15, 20]) out.push({ ...pinHeader(2, n, 2.54, { female: true }), group: G.sockets });
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 16, 20]) out.push(angledHeader(1, n), angledHeader(1, n, true));
  for (const n of [3, 4, 5, 6, 8, 10, 13, 20]) out.push(angledHeader(2, n));
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 16, 20]) out.push(fineHeader(1, n, 2.0));
  for (const n of [2, 3, 4, 5, 6, 8, 10]) out.push(fineHeader(2, n, 2.0));
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 20]) out.push(fineHeader(1, n, 1.27));
  for (const n of [3, 5, 8, 10, 20]) out.push(fineHeader(2, n, 1.27));
  for (const n of [3, 5, 7, 8, 10, 13, 17, 20, 25, 32]) out.push(idcBox(n));
  out.push(idcBox(5, true), idcBox(8, true), idcBox(10, true));
  for (let n = 2; n <= 12; n++) out.push({ ...jst('XH', n), group: G.jst }, { ...jst('PH', n), group: G.jst });
  for (let n = 2; n <= 8; n++) out.push(jstSh(n));
  for (let n = 2; n <= 6; n++) out.push(jstVh(n));
  for (let n = 2; n <= 12; n++) out.push(molexKk(n));
  for (let n = 2; n <= 12; n++) out.push({ ...screwTerminal(n, 5.08), group: G.term }, { ...screwTerminal(n, 5.0), group: G.term }, { ...screwTerminal(n, 3.5), group: G.term });
  for (let n = 2; n <= 8; n++) out.push({ ...screwTerminal(n, 3.81), group: G.term });
  for (let n = 2; n <= 4; n++) {
    const t = screwTerminal(n, 5.08);
    out.push({ ...t, id: `TerminalBlock_Pluggable_1x${String(n).padStart(2, '0')}_P5.08mm`, name: `Разъёмный клеммник ${n}, 5,08`, description: `Разъёмный клеммник KF2EDG/2EDG ${n} конт., шаг 5,08 мм (ответная часть — со винтами)`, group: G.term, height: 13, tags: ['terminal', 'pluggable', 'kf2edg'] });
    out.push({ ...screwTerminal(n, 7.5), group: G.term, description: `Винтовой клеммник ${n} конт., шаг 7,5 мм (KF7.5, до 15 А)` });
    out.push({ ...screwTerminal(n, 10.16), group: G.term, description: `Винтовой клеммник ${n} конт., шаг 10,16 мм (KF10.16, до 30 А)` });
  }
  out.push(dcJack(), usbA(), usbMicroB(), usbC16(), audioJack(), rj45(), rj11(), cr2032Smd(), cr2032Tht(), battery18650(), batteryAA('AA'), batteryAA('AAA'), jstPhBattery());
  out.push(
    boxFootprint({ id: 'Terminal_Faston_6.3mm_Vertical', name: 'Ножевой 6,3 мм', description: 'Ножевой контакт (Faston) 6,3 мм вертикальный на плату, две ножки через 5,08 мм', category: CAT.J, group: G.power, refPrefix: 'J', pads: [tht('1', -2.54, 0, 3.0, 2.0, 1.3, 'oval'), tht('1b', 2.54, 0, 3.0, 2.0, 1.3, 'oval')], body: { x0: -4.0, y0: -1.0, x1: 4.0, y1: 1.0 }, verified: false, height: 12, tags: ['faston', 'blade'] }),
    boxFootprint({ id: 'Fuse_Blade_Mini_Holder', name: 'Держатель мини-предохранителя', description: 'Держатель автомобильного мини-предохранителя (ATM) на плату, выводы через 10 мм', category: CAT.J, group: G.power, refPrefix: 'F', pads: [tht('1', -5.0, 0, 3.0, 3.0, 1.5, 'rect'), tht('2', 5.0, 0, 3.0, 3.0, 1.5)], body: { x0: -8.0, y0: -4.5, x1: 8.0, y1: 4.5 }, verified: false, height: 16, tags: ['fuse', 'blade', 'automotive'] }),
  );
  return out;
}
