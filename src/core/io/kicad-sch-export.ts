import type { Component, FootprintDef, PadDef, Project } from '../model/types';

/*
 * Схема в формате KiCad 6 (.kicad_sch) — по деталям и цепям проекта, без рисования проводов:
 * у каждого вывода — короткий провод и метка цепи (одинаковые метки на листе соединены).
 * Символы строятся из корпусов: двухвыводные — маленький прямоугольник, остальные — прямоугольник
 * с выводами слева и справа (имена выводов — из площадок). Детали раскладываются колонками по
 * разделам (поле «Раздел» у детали). Этот файл вместе с платой (.kicad_pcb) открывает KiCad 6–9
 * и EasyEDA Pro («Импорт → KiCad»): свойство Footprint указывает на корпус платы, остальные поля
 * детали (LCSC, Manufacturer Part…) переносятся свойствами.
 * Координаты KiCad: мм, сетка 1,27; в библиотеке символа ось Y вверх, на листе — вниз.
 */

const G = 2.54;
const PIN_LEN = 2.54;
const STUB = 2.54;

const q = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
const n = (v: number): string => String(Math.round(v * 1e4) / 1e4 + 0);
const snap = (v: number): number => Math.round(v / 1.27) * 1.27;

/** Детерминированный UUID из строки (FNV-1a, четыре прохода). */
export function uuidOf(s: string): string {
  let hex = '';
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ k;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    hex += h.toString(16).padStart(8, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

interface SymPin {
  number: string;
  name: string;
  /** Конец вывода в координатах символа (Y вверх) и направление наружу. */
  x: number;
  y: number;
  side: 'L' | 'R';
}

interface Sym {
  name: string;
  w: number;
  h: number;
  pins: SymPin[];
  two: boolean;
}

/** Выводы корпуса без повторов номеров (у держателя батарейки «+» — две лапки с одним номером). */
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

const symName = (fp: FootprintDef): string => fp.id.replace(/[^A-Za-z0-9_.-]/g, '_');

function buildSym(fp: FootprintDef): Sym {
  const pads = uniquePads(fp);
  const name = symName(fp);
  if (pads.length === 2) {
    // Двухвыводная: выводы влево и вправо, тело 5,08 × 2,54.
    return {
      name,
      w: 5.08,
      h: 2.54,
      two: true,
      pins: [
        { number: pads[0].number, name: pads[0].name ?? '', x: -2.54 - PIN_LEN, y: 0, side: 'L' },
        { number: pads[1].number, name: pads[1].name ?? '', x: 2.54 + PIN_LEN, y: 0, side: 'R' },
      ],
    };
  }
  const left = pads.slice(0, Math.ceil(pads.length / 2));
  const right = pads.slice(left.length);
  const rows = Math.max(left.length, right.length, 1);
  const longest = Math.max(4, ...pads.map((p) => (p.name ?? p.number).length));
  const w = Math.max(10.16, Math.ceil((longest * 1.27 * 2 + 2.54) / G) * G);
  const h = (rows + 1) * G;
  const top = Math.floor(rows / 2) * G;
  const pins: SymPin[] = [
    ...left.map((p, i): SymPin => ({ number: p.number, name: p.name ?? '', x: -w / 2 - PIN_LEN, y: top - i * G, side: 'L' })),
    ...right.map((p, i): SymPin => ({ number: p.number, name: p.name ?? '', x: w / 2 + PIN_LEN, y: top - i * G, side: 'R' })),
  ];
  return { name, w, h, pins, two: false };
}

const font = (size = 1.27) => `(effects (font (size ${n(size)} ${n(size)})))`;
const fontHide = (size = 1.27) => `(effects (font (size ${n(size)} ${n(size)})) hide)`;

function libSymbol(s: Sym): string[] {
  const out: string[] = [];
  const top = s.two ? 1.27 : Math.max(...s.pins.map((p) => p.y)) + G;
  const bottom = s.two ? -1.27 : Math.min(...s.pins.map((p) => p.y)) - G;
  out.push(`    (symbol ${q('Plata:' + s.name)} (pin_names (offset 0.254)${s.two ? ' hide' : ''}) (in_bom yes) (on_board yes)`);
  out.push(`      (property "Reference" "U" (id 0) (at 0 ${n(top + 1.27)} 0) ${font()})`);
  out.push(`      (property "Value" ${q(s.name)} (id 1) (at 0 ${n(bottom - 1.27)} 0) ${font()})`);
  out.push(`      (property "Footprint" "" (id 2) (at 0 0 0) ${fontHide()})`);
  out.push(`      (property "Datasheet" "" (id 3) (at 0 0 0) ${fontHide()})`);
  out.push(`      (symbol ${q(s.name + '_0_1')}`);
  out.push(`        (rectangle (start ${n(-s.w / 2)} ${n(top)}) (end ${n(s.w / 2)} ${n(bottom)}) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type background)))`);
  out.push('      )');
  out.push(`      (symbol ${q(s.name + '_1_1')}`);
  for (const p of s.pins) {
    const ang = p.side === 'L' ? 0 : 180;
    out.push(`        (pin passive line (at ${n(p.x)} ${n(p.y)} ${ang}) (length ${n(PIN_LEN)}) (name ${q(p.name || '~')} ${font()}) (number ${q(p.number)} ${font()}))`);
  }
  out.push('      )');
  out.push('    )');
  return out;
}

export interface KicadSchOptions {
  /** Выгружать выносные детали (по умолчанию нет: на плате их нет). */
  offBoard?: boolean;
  /** Раздел детали; по умолчанию поле «Раздел» или «Схема». */
  groupOf?: (c: Component) => string;
  /** Порядок разделов. */
  groups?: readonly string[];
}

export interface KicadSchResult {
  text: string;
  /** Обозначение → UUID символа (для связи с платой: путь "/uuid" у корпуса). */
  paths: Record<string, string>;
  /** UUID листа (для файла проекта). */
  uuid: string;
}

export function exportKicadSch(p: Project, o: KicadSchOptions = {}): KicadSchResult {
  const comps = Object.values(p.components)
    .filter((c) => (o.offBoard || !c.offBoard) && p.footprints[c.footprint] && uniquePads(p.footprints[c.footprint]).length > 0)
    .sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }));
  const groupOf = o.groupOf ?? ((c: Component) => c.fields?.['Раздел'] ?? 'Схема');
  const order = [...(o.groups ?? []), ...new Set(comps.map(groupOf))].filter((g, i, a) => a.indexOf(g) === i);

  const syms = new Map<string, Sym>();
  for (const c of comps) {
    const fp = p.footprints[c.footprint];
    if (!syms.has(fp.id)) syms.set(fp.id, buildSym(fp));
  }
  const netName = (c: Component, pad: string): string | null => {
    const id = c.padNets[pad];
    return id ? (p.nets[id]?.name ?? null) : null;
  };

  // Раскладка: каждый раздел — блок из колонок высотой до COL_H; блоки — рядами слева направо,
  // ряд не шире ROW_W (лист примерно A0 по ширине).
  const COL_H = 150;
  const ROW_W = 1100;
  const placed: { c: Component; sym: Sym; x: number; y: number }[] = [];
  const titles: { text: string; x: number; y: number }[] = [];
  const blocks: { title: string; items: { c: Component; sym: Sym; x: number; y: number }[]; w: number; h: number }[] = [];
  for (const g of order) {
    const list = comps.filter((c) => groupOf(c) === g);
    if (!list.length) continue;
    const items: { c: Component; sym: Sym; x: number; y: number }[] = [];
    let x = 0;
    let y = 10;
    let colW = 0;
    let h = 0;
    let w = 0;
    for (const c of list) {
      const sym = syms.get(p.footprints[c.footprint].id)!;
      const labelLen = Math.max(4, ...sym.pins.map((pin) => (netName(c, pin.number) ?? '').length)) * 1.0 + 3;
      const sw = sym.w + 2 * (PIN_LEN + STUB + labelLen) + 6;
      const sh = (sym.two ? 2.54 : sym.h) + 10;
      if (y + sh > 10 + COL_H && y > 10) {
        x += colW;
        y = 10;
        colW = 0;
      }
      items.push({ c, sym, x: x + sw / 2, y: y + sh / 2 });
      y += sh;
      colW = Math.max(colW, sw);
      h = Math.max(h, y);
      w = Math.max(w, x + colW);
    }
    blocks.push({ title: g, items, w: Math.max(w, g.length * 2.2), h });
  }
  let bx = 20;
  let by = 20;
  let rowH = 0;
  let maxX = 0;
  for (const b of blocks) {
    if (bx > 20 && bx + b.w > ROW_W) {
      bx = 20;
      by += rowH + 15;
      rowH = 0;
    }
    titles.push({ text: b.title, x: bx, y: by });
    for (const it of b.items) placed.push({ ...it, x: snap(bx + it.x), y: snap(by + it.y) });
    bx += b.w + 20;
    rowH = Math.max(rowH, b.h);
    maxX = Math.max(maxX, bx);
  }
  const y0 = by + rowH + 10;
  const W = Math.ceil(Math.max(420, maxX + 20) / 10) * 10;
  const H = Math.ceil(Math.max(297, y0 + 10) / 10) * 10;

  const root = uuidOf('sch:' + p.meta.name);
  const out: string[] = [];
  out.push(`(kicad_sch (version 20211123) (generator plata)`);
  out.push(`  (uuid ${root})`);
  out.push(`  (paper "User" ${n(W)} ${n(H)})`);
  out.push(`  (title_block (title ${q(p.meta.name)}) (comment 1 ${q('Схема из Plata: детали соединены метками цепей')}))`);
  out.push('  (lib_symbols');
  for (const s of syms.values()) out.push(...libSymbol(s));
  out.push('  )');

  for (const t of titles) out.push(`  (text ${q(t.text)} (at ${n(t.x)} ${n(t.y)} 0) (effects (font (size 3 3) (thickness 0.6) bold) (justify left)) (uuid ${uuidOf('t:' + t.text)}))`);

  const paths: Record<string, string> = {};
  const instances: string[] = [];
  for (const { c, sym, x, y } of placed) {
    const fp = p.footprints[c.footprint];
    const id = uuidOf('sym:' + c.ref);
    paths[c.ref] = id;
    const top = sym.two ? 1.27 : Math.max(...sym.pins.map((pin) => pin.y)) + G;
    const bottom = sym.two ? -1.27 : Math.min(...sym.pins.map((pin) => pin.y)) - G;
    out.push(`  (symbol (lib_id ${q('Plata:' + sym.name)}) (at ${n(x)} ${n(y)} 0) (unit 1) (in_bom ${c.excludeFromBom ? 'no' : 'yes'}) (on_board yes) (fields_autoplaced)`);
    out.push(`    (uuid ${id})`);
    out.push(`    (property "Reference" ${q(c.ref)} (id 0) (at ${n(x)} ${n(y - top - 1.27)} 0) ${font()})`);
    out.push(`    (property "Value" ${q(c.value || fp.name)} (id 1) (at ${n(x)} ${n(y - bottom + 1.27)} 0) ${font()})`);
    out.push(`    (property "Footprint" ${q('Plata:' + fp.id)} (id 2) (at ${n(x)} ${n(y)} 0) ${fontHide()})`);
    out.push(`    (property "Datasheet" "" (id 3) (at ${n(x)} ${n(y)} 0) ${fontHide()})`);
    let fid = 4;
    const fields: Record<string, string> = { ...(c.fields ?? {}) };
    if (c.description) fields['Описание'] = c.description;
    for (const [k, v] of Object.entries(fields)) if (v) out.push(`    (property ${q(k)} ${q(v)} (id ${fid++}) (at ${n(x)} ${n(y)} 0) ${fontHide()})`);
    for (const pin of sym.pins) out.push(`    (pin ${q(pin.number)} (uuid ${uuidOf(`pin:${c.ref}:${pin.number}`)}))`);
    out.push('  )');
    instances.push(`    (path ${q('/' + id)} (reference ${q(c.ref)}) (unit 1) (value ${q(c.value || fp.name)}) (footprint ${q('Plata:' + fp.id)}))`);

    // Провод от конца вывода наружу и метка цепи; свободный вывод — знак «не подключён».
    for (const pin of sym.pins) {
      const px = x + pin.x;
      const py = y - pin.y;
      const net = netName(c, pin.number);
      if (!net) {
        out.push(`  (no_connect (at ${n(px)} ${n(py)}) (uuid ${uuidOf(`nc:${c.ref}:${pin.number}`)}))`);
        continue;
      }
      const ex = px + (pin.side === 'L' ? -STUB : STUB);
      out.push(`  (wire (pts (xy ${n(px)} ${n(py)}) (xy ${n(ex)} ${n(py)})) (stroke (width 0) (type default) (color 0 0 0 0)) (uuid ${uuidOf(`w:${c.ref}:${pin.number}`)}))`);
      const ang = pin.side === 'L' ? 180 : 0;
      out.push(`  (label ${q(net)} (at ${n(ex)} ${n(py)} ${ang}) (fields_autoplaced) (effects (font (size 1.27 1.27)) (justify ${pin.side === 'L' ? 'right' : 'left'} bottom)) (uuid ${uuidOf(`l:${c.ref}:${pin.number}`)}))`);
    }
  }
  out.push('  (sheet_instances (path "/" (page "1")))');
  out.push('  (symbol_instances');
  out.push(...instances);
  out.push('  )');
  out.push(')');
  return { text: out.join('\n') + '\n', paths, uuid: root };
}

/** Файл проекта KiCad (.kicad_pro) — минимальный, чтобы схема и плата открывались вместе. */
export function kicadProjectFile(name: string, sheetUuid: string): string {
  return JSON.stringify(
    {
      board: { design_settings: {} },
      boards: [],
      libraries: { pinned_footprint_libs: [], pinned_symbol_libs: [] },
      meta: { filename: `${name}.kicad_pro`, version: 1 },
      net_settings: { classes: [{ name: 'Default', clearance: 0.2, track_width: 0.25, via_diameter: 0.8, via_drill: 0.4 }], meta: { version: 2 } },
      pcbnew: { last_paths: {}, page_layout_descr_file: '' },
      schematic: { legacy_lib_dir: '', legacy_lib_list: [] },
      sheets: [[sheetUuid, '']],
      text_variables: {},
    },
    null,
    2,
  );
}
