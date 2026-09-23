import type { Project } from '../model/types';

/* Перечень элементов и файл расстановки (pick-and-place) в CSV для Excel: разделитель «;», UTF-8 с BOM. */

const BOM = '﻿';
const cell = (s: string | number) => {
  const t = String(s ?? '');
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export interface BomRow {
  refs: string[];
  qty: number;
  value: string;
  footprint: string;
  footprintName: string;
  description: string;
  fields: Record<string, string>;
}

/** Строки перечня: одинаковые номинал + корпус объединяются. */
export function bomRows(p: Project): BomRow[] {
  const groups = new Map<string, BomRow>();
  for (const c of Object.values(p.components)) {
    if (c.excludeFromBom) continue;
    const fp = p.footprints[c.footprint];
    const key = `${c.value}|${c.footprint}`;
    let g = groups.get(key);
    if (!g) {
      g = { refs: [], qty: 0, value: c.value, footprint: c.footprint, footprintName: fp?.name ?? c.footprint, description: c.description ?? fp?.description ?? '', fields: c.fields ?? {} };
      groups.set(key, g);
    } else if (g.description !== (c.description ?? '')) g.description = fp?.description ?? '';
    g.refs.push(c.ref);
    g.qty++;
  }
  const rows = [...groups.values()];
  const num = (r: string) => parseInt(r.replace(/^\D+/, ''), 10) || 0;
  const pre = (r: string) => r.replace(/\d+$/, '');
  for (const r of rows) r.refs.sort((a, b) => pre(a).localeCompare(pre(b)) || num(a) - num(b));
  rows.sort((a, b) => pre(a.refs[0]).localeCompare(pre(b.refs[0])) || num(a.refs[0]) - num(b.refs[0]));
  return rows;
}

export function exportBomCsv(p: Project): string {
  const rows = bomRows(p);
  const extra = [...new Set(rows.flatMap((r) => Object.keys(r.fields)))];
  const lines = [['№', 'Позиции', 'Кол-во', 'Номинал', 'Корпус', 'Описание', ...extra].map(cell).join(';')];
  rows.forEach((r, i) => lines.push([i + 1, r.refs.join(', '), r.qty, r.value, r.footprintName, r.description, ...extra.map((k) => r.fields[k] ?? '')].map(cell).join(';')));
  return BOM + lines.join('\n') + '\n';
}

/** Расстановка: центр компонента в мм от левого нижнего угла платы, поворот, сторона. */
export function exportPickPlaceCsv(p: Project): string {
  const ys = p.board.outline.map((q) => q.y);
  const xs = p.board.outline.map((q) => q.x);
  const x0 = Math.min(...xs);
  const y1 = Math.max(...ys);
  const lines = [['Designator', 'Val', 'Package', 'Mid X', 'Mid Y', 'Rotation', 'Layer'].join(';')];
  for (const c of Object.values(p.components)) {
    if (c.excludeFromBom) continue;
    const fp = p.footprints[c.footprint];
    lines.push([c.ref, c.value, fp?.name ?? c.footprint, (c.at.x - x0).toFixed(3) + 'mm', (y1 - c.at.y).toFixed(3) + 'mm', c.rotation.toFixed(0), c.side === 'top' ? 'T' : 'B'].map(cell).join(';'));
  }
  return BOM + lines.join('\n') + '\n';
}

/** Список соединений текстом — как в первой версии Plata. */
export function exportNetlistText(p: Project): string {
  const lines: string[] = [`${p.meta.name} — список соединений`, ''];
  lines.push('Компоненты');
  const comps = Object.values(p.components).sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }));
  for (const c of comps) {
    const fp = p.footprints[c.footprint];
    lines.push(`${c.ref}\t${c.value}${c.description ? ' — ' + c.description : ''}${fp ? ', ' + fp.name : ''}`);
  }
  lines.push('', 'Цепи');
  const nets = Object.values(p.nets).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  for (const n of nets) {
    const members: string[] = [];
    for (const c of comps) for (const [pad, net] of Object.entries(c.padNets)) if (net === n.id) {
      const pd = p.footprints[c.footprint]?.pads.find((x) => x.number === pad);
      members.push(`${c.ref}.${pd?.name && pd.name !== pd.number ? pd.name : pad}`);
    }
    lines.push(`${n.name}${n.netClass !== 'Default' ? ` [${n.netClass}]` : ''}${n.description ? ` (${n.description})` : ''}: ${members.join(', ')}`);
  }
  const unconnected: string[] = [];
  for (const c of comps) {
    const fp = p.footprints[c.footprint];
    if (!fp) continue;
    for (const pd of fp.pads) if (pd.type !== 'npth' && !c.padNets[pd.number]) unconnected.push(`${c.ref}.${pd.name && pd.name !== pd.number ? pd.name : pd.number}`);
  }
  if (unconnected.length) lines.push('', 'Не подключены', unconnected.join(', '));
  const wires = Object.keys(p.wires).length;
  if (wires) lines.push('', `Перемычки проводом со стороны деталей: ${wires} шт.`);
  return lines.join('\n') + '\n';
}
