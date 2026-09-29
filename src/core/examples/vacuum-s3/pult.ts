import { newId } from '../../ids';
import { libraryFootprint } from '../../library';
import { addComponent, addTrack, addVia, connectPad, ensureNet } from '../../model/edit';
import { createProject } from '../../model/project';
import { autoroute, type RouteResult } from '../../router/autoroute';
import type { Project, SchSymbol } from '../../model/types';
import { addPinLabels, emptySchematic, symbolDef } from '../../schematic/netlist';
import { SCH_GRID } from '../../schematic/symbols';

/*
 * Плата пульта «S3» — рамка вокруг экрана 7″: по три кнопки слева и справа от экрана — каждая
 * напротив своей подписи на экране (зоны подписей — 26 + 104·i по высоте кадра 480), внизу
 * посередине энкодер под большую ручку, по бокам от него «Турбина 1» и «Турбина 2», «Выкл» —
 * отдельно в правом углу (не нажать случайно). Разъёмы — IDC 2×10 к контроллеру (тот же порядок,
 * что у X1 на плате контроллера) и JST XH к плате экрана (5 В, земля, UART) — внизу, на обратной
 * стороне платы (со стороны лицевой крышки только кнопки, энкодер и зуммер), там же конденсаторы.
 * Двусторонняя под ЛУТ: детали сверху, дорожки с обеих сторон.
 */

/** Экран: модуль 7″ 800×480 (стекло LCD) и его рабочее поле, мм. Сверить со своим экраном. */
export const PULT_SCREEN = { w: 165, h: 100, activeW: 154.21, activeH: 85.92 };
/** Поля рамки: слева и справа — под кнопки, сверху — под разъёмы, снизу — под энкодер и кнопки. */
const SIDE = 30;
const TOP = 12;
const BOTTOM = 48;
const GAP = 0.5;

export function pultSize() {
  const winW = PULT_SCREEN.w + 2 * GAP;
  const winH = PULT_SCREEN.h + 2 * GAP;
  return { w: winW + 2 * SIDE, h: TOP + winH + BOTTOM, win: { x: SIDE, y: TOP, w: winW, h: winH } };
}

interface PultPart {
  ref: string;
  value: string;
  description: string;
  fp: string;
  pins: Record<string, string>;
  at: [number, number, number?];
  back?: boolean;
}

function parts(): PultPart[] {
  const { w, h, win } = pultSize();
  const activeTop = win.y + GAP + (PULT_SCREEN.h - PULT_SCREEN.activeH) / 2;
  const keyY = (i: number) => +(activeTop + (PULT_SCREEN.activeH * (78 + 104 * i)) / 480).toFixed(2);
  const bottomY = +(win.y + win.h + 19).toFixed(2);
  const connY = +(h - 10).toFixed(2);
  const cx = w / 2;
  const key = (ref: string, value: string, net: string, x: number, y: number, what: string): PultPart => ({
    ref,
    value,
    description: `${what}. Тактовая кнопка 12×12 с колпачком (выводы 1–2 и 3–4 соединены внутри); колпачок — через отверстие в крышке`,
    fp: 'SW_PUSH_12mm',
    pins: { '1': net, '2': net, '3': 'GND', '4': 'GND' },
    at: [x, y],
  });
  const side = ['верхняя', 'средняя', 'нижняя'];
  return [
    {
      ref: 'X1',
      value: 'К контроллеру',
      description: 'Разъём IDC 2×10 — плоский кабель к X1 контроллера (порядок выводов тот же): 1–2 — 5 В, 3–4, 7 — земля, 5 — TX контроллера, 6 — RX контроллера, 8 — зуммер, 9–10 — энкодер, 11–16 — кнопки 1–6, 17–18 — «Турбина 1/2», 19 — «Выкл», 20 — кнопка энкодера',
      fp: 'IDC-Header_2x10_P2.54mm_Vertical',
      pins: { '1': '5V', '2': '5V', '3': 'GND', '4': 'GND', '5': 'PNL_TX', '6': 'PNL_RX', '7': 'GND', '8': 'BZ_K', '9': 'ENC_A', '10': 'ENC_B', '11': 'K1', '12': 'K2', '13': 'K3', '14': 'K4', '15': 'K5', '16': 'K6', '17': 'KT1', '18': 'KT2', '19': 'KOFF', '20': 'ENC_SW' },
      at: [cx - 30, connY],
      back: true,
    },
    {
      ref: 'X2',
      value: 'Экран: 5V GND RX TX',
      description: 'JST XH 4 к плате экрана: 1 — 5 В, 2 — земля, 3 — RX экрана (IO18, от TX контроллера), 4 — TX экрана (IO17, к RX контроллера)',
      fp: 'JST_XH_B4B-XH-A_1x04_P2.5mm_Vertical',
      pins: { '1': '5V', '2': 'GND', '3': 'PNL_TX', '4': 'PNL_RX' },
      at: [cx + 30, connY],
      back: true,
    },
    { ref: 'C1', value: '100 мкФ 10 В', description: 'Питание экрана: запас на броски тока подсветки (длинный кабель)', fp: 'CP_Radial_D6.3mm_P2.5mm', pins: { '1': '5V', '2': 'GND' }, at: [cx + 12, connY], back: true },
    { ref: 'C2', value: '100 нФ', description: 'Питание экрана', fp: 'C_Disc_D5mm_W2.5mm_P2.5mm', pins: { '1': '5V', '2': 'GND' }, at: [cx + 19, connY], back: true },
    ...[0, 1, 2].map((i) => key(`SB${i + 1}`, `Кнопка ${i + 1}`, `K${i + 1}`, SIDE / 2, keyY(i), `Кнопка ${i + 1} у экрана слева, ${side[i]}: напротив своей подписи на экране`)),
    ...[0, 1, 2].map((i) => key(`SB${i + 4}`, `Кнопка ${i + 4}`, `K${i + 4}`, w - SIDE / 2, keyY(i), `Кнопка ${i + 4} у экрана справа, ${side[i]}: напротив своей подписи на экране`)),
    key('SB7', 'Турбина 1', 'KT1', cx - 42, bottomY, 'Кнопка «Турбина 1»: слева от энкодера'),
    key('SB8', 'Турбина 2', 'KT2', cx + 42, bottomY, 'Кнопка «Турбина 2»: справа от энкодера'),
    key('SB9', 'Выкл', 'KOFF', w - 20, bottomY, 'Кнопка «Выкл»: отдельно, в правом углу — не нажать случайно (красный колпачок)'),
    {
      ref: 'SA1',
      value: 'EC11 с кнопкой',
      description: 'Энкодер EC11 с кнопкой, вал 20 мм, под большую ручку (в перчатке): внизу посередине. Лапки крепления — на землю',
      fp: 'RotaryEncoder_Alps_EC11E_Vertical_H20mm',
      pins: { A: 'ENC_A', B: 'ENC_B', C: 'GND', S1: 'ENC_SW', S2: 'GND', MP1: 'GND', MP2: 'GND' },
      at: [cx, bottomY],
    },
    { ref: 'BA1', value: 'Зуммер 5 В', description: 'Зуммер электромагнитный без генератора 5 В, Ø12: ключ и диод — на плате контроллера', fp: 'Buzzer_12x8.5mm_P6mm', pins: { '1': '5V', '2': 'BZ_K' }, at: [20, bottomY] },
    ...[
      [5, 5],
      [w - 5, 5],
      [5, h - 5],
      [w - 5, h - 5],
    ].map(([x, y], i): PultPart => ({ ref: `H${i + 1}`, value: '', description: 'Крепёжное отверстие M3', fp: 'MountingHole_3.2mm_M3', pins: {}, at: [x, y] })),
  ];
}

/** Плата пульта без дорожек. */
export function buildPult(): Project {
  const { w, h, win } = pultSize();
  const p = createProject({ name: 'Пылесос S3: плата пульта', width: +w.toFixed(2), height: +h.toFixed(2), copperLayers: 2, cornerRadius: 3, homemade: true });
  p.meta.author = 'Plata';
  p.meta.description =
    'Плата пульта пылесоса S3 — рамка вокруг экрана 7″ 800×480: шесть кнопок у экрана напротив подписей, энкодер внизу посередине, «Турбина 1» и «Турбина 2» по бокам от него, «Выкл» в правом углу, зуммер, разъём IDC 2×10 к контроллеру и JST XH к плате экрана. Двусторонняя под ЛУТ. Окно — под стекло экрана 165×100 мм: сверьте со своим экраном.';
  p.board.cutouts = [
    [
      { x: win.x, y: win.y },
      { x: win.x + win.w, y: win.y },
      { x: win.x + win.w, y: win.y + win.h },
      { x: win.x, y: win.y + win.h },
    ],
  ];
  for (const name of ['5V', 'GND']) ensureNet(p, name, { netClass: 'Power' });
  for (const part of parts()) {
    const fp = libraryFootprint(part.fp);
    if (!fp) throw new Error(`нет корпуса ${part.fp}`);
    // Центры — на сетке 1,27: выводы разъёмов с шагом 2,54 ложатся на сетку трассировки.
    const g = (v: number) => +(Math.round(v / 1.27) * 1.27).toFixed(3);
    const c = addComponent(p, fp, { x: g(part.at[0]), y: g(part.at[1]) }, { ref: part.ref, value: part.value, description: part.description, rotation: part.at[2] ?? 0, side: part.back ? 'bottom' : 'top' });
    if (!part.value) c.hideValue = true;
    const f = p.footprints[c.footprint];
    for (const [pin, net] of Object.entries(part.pins)) {
      const pads = f.pads.filter((q) => q.type !== 'npth' && (q.name === pin || q.number === pin));
      if (!pads.length) throw new Error(`${part.ref}: нет вывода ${pin}`);
      const n = ensureNet(p, net);
      for (const q of pads) connectPad(p, c.id, q.number, n.id);
    }
  }
  layoutSchematic(p);
  return structuredClone(p);
}

function layoutSchematic(p: Project): void {
  p.schematic = emptySchematic();
  const snap = (v: number) => Math.round(v / SCH_GRID) * SCH_GRID;
  let x = 10;
  let y = 10;
  let rowH = 0;
  for (const c of Object.values(p.components)) {
    const def = symbolDef(p.footprints[c.footprint]);
    if (!def || !Object.keys(c.padNets).length) continue;
    const bw = def.box.max.x - def.box.min.x + 30;
    const bh = def.box.max.y - def.box.min.y + 14;
    if (x + bw > 250 && x > 10) {
      x = 10;
      y += rowH;
      rowH = 0;
    }
    const sym: SchSymbol = { id: newId('sy'), component: c.id, at: { x: snap(x + 15 - def.box.min.x), y: snap(y + 6 - def.box.min.y) }, rotation: 0 };
    p.schematic.symbols[sym.id] = sym;
    addPinLabels(p, sym);
    x += bw;
    rowH = Math.max(rowH, bh);
  }
}

/**
 * Разводка на две стороны дорожками 0,5 мм на сетке 0,8467 (2,54/3: шаг не меньше ширины и
 * зазора), без диагоналей — на этой плате с ними поиск медленнее и хуже.
 */
export async function routePult(p0: Project, iterations = 80): Promise<{ project: Project; result: RouteResult }> {
  const p = structuredClone(p0);
  for (const k of Object.keys(p.netClasses)) p.netClasses[k] = { ...p.netClasses[k], trackWidth: 0.5 };
  const r = await autoroute(p, { iterations, yieldEvery: 1e9, grid: 0.8467, diagonal: false, hopCost: 8 });
  for (const t of r.tracks) addTrack(p, t);
  for (const v of r.vias) addVia(p, v);
  return { project: structuredClone(p), result: r };
}
