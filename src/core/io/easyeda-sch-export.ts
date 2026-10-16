import type { Component, FootprintDef, PadDef, Project } from '../model/types';

/*
 * Схема в формате EasyEDA Standard (редактор 6.x, «Файл → Открыть → EasyEDA…»): проект с одним
 * листом. Каждая деталь — прямоугольник с выводами слева и справа, у каждого подключённого вывода —
 * метка цепи (флаг «Bar»): в EasyEDA одинаковые имена флагов — одна цепь, проводов не нужно.
 * Корпус в поле package — имя корпуса Plata; в EasyEDA его назначают в «Менеджере посадочных мест».
 * Единицы листа: 10 = 0,1″, ось Y вниз.
 */

export interface EasyedaSchOptions {
  /** Выгружать выносные детали (на схеме они полезны: видно, что куда подключается). */
  offBoard?: boolean;
  /** Раздел детали; по умолчанию поле «Раздел» или «Схема». */
  groupOf?: (c: Component) => string;
  /** Порядок разделов. */
  groups?: readonly string[];
  /** Ширина листа в единицах EasyEDA (по ней переносятся ряды деталей). */
  width?: number;
}

function uniquePads(fp: FootprintDef): PadDef[] {
  const seen = new Set<string>();
  const out: PadDef[] = [];
  for (const p of fp.pads) {
    if (p.type === 'npth' || !p.number || seen.has(p.number)) continue;
    seen.add(p.number);
    out.push(p);
  }
  return out;
}

/** Убрать символы, которые в EasyEDA разделяют поля. */
const clean = (s: string) => s.replace(/[~^`#@$]/g, ' ').trim();
const r1 = (v: number) => +v.toFixed(2);
const up10 = (v: number) => Math.ceil(v / 10) * 10;
/** Примерная ширина текста 9pt в единицах листа. */
const textW = (s: string) => s.length * 5.6;

export function exportEasyedaSch(p: Project, o: EasyedaSchOptions = {}): string {
  let gid = 0;
  const id = () => `gge${(++gid).toString(36)}`;
  const comps = Object.values(p.components)
    .filter((c) => (o.offBoard || !c.offBoard) && p.footprints[c.footprint] && uniquePads(p.footprints[c.footprint]).length > 0)
    .sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }));
  const groupOf = o.groupOf ?? ((c: Component) => c.fields?.['Раздел'] ?? 'Схема');
  const order = [...(o.groups ?? []), ...new Set(comps.map(groupOf))].filter((g, i, a) => a.indexOf(g) === i);
  const sheetW = o.width ?? 2200;
  const shapes: string[] = [];
  const netName = (c: Component, pad: PadDef) => {
    const n = c.padNets[pad.number];
    return n ? clean(p.nets[n]?.name ?? '') : '';
  };

  /** Флаг цепи у конца вывода: слева (текст левее) или справа. */
  const flag = (x: number, y: number, name: string, left: boolean) => {
    const f = id();
    const tx = left ? x - 13 - textW(name) : x + 16.8;
    const bar = left ? `M ${x - 10} ${y} h 10` : `M ${x + 10} ${y} h -10`;
    const ex = left ? x - 13 : x + 13;
    return `F~part_netLabel_Bar~${x}~${y}~${left ? 90 : 270}~${f}~~0^^${x}~${y}^^${name}~#000000~${r1(tx)}~${y}~0~start~1~Times New Roman~9pt~flag_${f}^^PT~${bar}~#000000~1~0~none~${id()}~0~^^E~${ex}~${y}~3~3~#000000~1~0~none~${id()}~0`;
  };

  /** Деталь: левый верхний угол клетки (x, y) → высота занятого места. */
  const symbol = (c: Component, x0: number, y0: number, boxW: number, left: PadDef[], right: PadDef[]) => {
    const fp = p.footprints[c.footprint];
    const rows = Math.max(left.length, right.length, 1);
    const boxH = rows * 10 + 10;
    const bx = x0;
    const by = y0 + 20;
    const parts: string[] = [];
    const prefix = clean(fp.refPrefix ?? c.ref.replace(/\d+$/, '')) || 'U';
    parts.push(`LIB~${bx}~${by}~package\`${clean(fp.id)}\`spicePre\`${prefix}\`~~0~${id()}~~~0~~yes~yes~~~`);
    parts.push(`T~P~${bx}~${by - 11}~0~#000080~Arial~~~~~comment~${clean(c.ref)}~1~start~${id()}~0~pinpart`);
    parts.push(`T~N~${bx}~${by - 3}~0~#000080~Arial~~~~~comment~${clean(c.value || fp.name)}~1~start~${id()}~0~pinpart`);
    parts.push(`R~${bx}~${by}~2~2~${boxW}~${boxH}~#880000~1~0~none~${id()}~0~`);
    left.forEach((q, i) => {
      const x = bx - 10;
      const y = by + 10 + i * 10;
      const name = clean(q.name ?? q.number);
      parts.push(
        `P~show~0~${clean(q.number)}~${x}~${y}~180~${id()}~0^^${x}~${y}^^M ${x} ${y} h 10~#880000^^1~${r1(x + 13.7)}~${y + 4}~0~${name}~start~~~#0000FF^^1~${r1(x + 9.5)}~${y - 1}~0~${clean(q.number)}~end~~~#0000FF^^0~${x + 7}~${y}^^0~M ${x + 10} ${y + 3} L ${x + 13} ${y} L ${x + 10} ${y - 3}`,
      );
      const n = netName(c, q);
      if (n) shapes.push(flag(x, y, n, true));
    });
    right.forEach((q, i) => {
      const x = bx + boxW + 10;
      const y = by + 10 + i * 10;
      const name = clean(q.name ?? q.number);
      parts.push(
        `P~show~0~${clean(q.number)}~${x}~${y}~0~${id()}~0^^${x}~${y}^^M ${x} ${y} h -10~#880000^^1~${r1(x - 13.7)}~${y + 4}~0~${name}~end~~~#0000FF^^1~${r1(x - 9.5)}~${y - 1}~0~${clean(q.number)}~start~~~#0000FF^^0~${x - 7}~${y}^^0~M ${x - 10} ${y - 3} L ${x - 13} ${y} L ${x - 10} ${y + 3}`,
      );
      const n = netName(c, q);
      if (n) shapes.push(flag(x, y, n, false));
    });
    shapes.push(parts.join('#@$'));
    return boxH + 20;
  };

  let y = 0;
  let maxX = 0;
  for (const g of order) {
    const list = comps.filter((c) => groupOf(c) === g);
    if (!list.length) continue;
    shapes.push(`T~L~0~${y}~0~#0000FF~Arial~14pt~~~~comment~${clean(g)}~1~start~${id()}~0~`);
    y += 20;
    let x = 0;
    let rowH = 0;
    for (const c of list) {
      const pads = uniquePads(p.footprints[c.footprint]);
      const half = Math.ceil(pads.length / 2);
      const left = pads.slice(0, half);
      const right = pads.slice(half);
      const nameW = (l: PadDef[]) => Math.max(0, ...l.map((q) => textW(clean(q.name ?? q.number))));
      const flagW = (l: PadDef[]) => Math.max(0, ...l.map((q) => textW(netName(c, q)))) + 30;
      const boxW = Math.max(40, up10(nameW(left) + nameW(right) + 20));
      const padL = up10(flagW(left));
      const cellW = padL + boxW + up10(flagW(right)) + 20;
      if (x > 0 && x + cellW > sheetW) {
        x = 0;
        y += rowH + 10;
        rowH = 0;
      }
      rowH = Math.max(rowH, symbol(c, x + padL, y, boxW, left, right));
      x += cellW;
      maxX = Math.max(maxX, x);
    }
    y += rowH + 30;
  }

  const sheet = {
    docType: '1',
    title: clean(p.meta?.name ?? 'Схема') || 'Схема',
    description: '',
    dataStr: {
      head: { docType: '1', editorVersion: '6.5.60', newgId: true, c_para: { 'Prefix Start': '1' }, c_spiceCmd: 'null', hasIdFlag: true, x: '0', y: '0', portOfADImportHack: '', importFlag: 0, transformList: '' },
      canvas: 'CA~1000~1000~#FFFFFF~yes~#CCCCCC~5~1000~1000~line~5~pixel~5~0~0',
      shape: shapes,
      BBox: { x: -10, y: -10, width: maxX + 20, height: y + 20 },
      colors: {},
    },
  };
  return JSON.stringify({ editorVersion: '6.5.60', docType: '5', title: sheet.title, description: clean(p.meta?.description ?? ''), colors: {}, schematics: [sheet] }, null, 1);
}
