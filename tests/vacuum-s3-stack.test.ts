import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { bodyBox, buildStackBoard, logicalNet, routeStackBoard, type StackBoard } from '../src/core/examples/vacuum-s3/stack';
import { parseProjectFile, serializeProject } from '../src/core/io/project-file';
import type { Vec2 } from '../src/core/math/vec';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import { boardPolygon } from '../src/core/model/project';
import type { Project } from '../src/core/model/types';
import { getWorld } from '../src/core/model/world';
import { flashOutline, flattenProject, type Prim } from '../src/core/render/flatten';

/*
 * Пылесос S3 «этажеркой» под лазер: верхняя и нижняя платы (односторонние) и пульт (двусторонний
 * без металлизации). Разведённые платы — в import/vacuum-s3-stack-*.plata.json; пересоздать:
 * STACK_WRITE=1 npx vitest run tests/vacuum-s3-stack.test.ts. Архив для гравера и памятка —
 * tools/stack-lazer/build.sh (берёт выгрузку STACK_DUMP=папка из последнего теста).
 */

const BOARDS: StackBoard[] = ['upper', 'lower', 'panel'];
const file = (b: StackBoard) => `import/vacuum-s3-stack-${b}.plata.json`;
const WRITE = process.env.STACK_WRITE === '1';
/** Папка для выгрузки (tools/stack-lazer/build.sh). */
const DUMP = process.env.STACK_DUMP;

/** Вывод детали → логическая цепь (островки «~» — та же цепь). */
function pinNets(p: Project, ref: string): Map<string, string> {
  const c = Object.values(p.components).find((q) => q.ref === ref);
  if (!c) throw new Error(`нет ${ref}`);
  return new Map(Object.entries(c.padNets).map(([pin, id]) => [pin, logicalNet(p.nets[id].name)]));
}

function load(b: StackBoard): Project {
  const r = parseProjectFile(readFileSync(file(b), 'utf8'));
  if (r.kind !== 'project') throw new Error('не проект');
  return r.project;
}

/** Переходные, площадка которых заходит под корпус кнопки, энкодера, зуммера или разъёма шлейфа. */
function viasUnderBodies(p: Project): string[] {
  const out: string[] = [];
  for (const c of Object.values(p.components)) {
    if (!/^(SB\d+|SA1|BA1|XS1)$/.test(c.ref)) continue;
    const [a, b] = bodyBox(c, p.footprints[c.footprint], 0);
    for (const v of Object.values(p.vias)) {
      const r = v.diameter / 2;
      if (v.at.x + r > a.x && v.at.x - r < b.x && v.at.y + r > a.y && v.at.y - r < b.y) out.push(`${c.ref}: ${v.at.x}, ${v.at.y}`);
    }
  }
  return out;
}

/** Ошибки DRC без «не разведено» (до трассировки). */
const errors = (p: Project, routed: boolean) => runDrc(p).markers.filter((m) => m.severity === 'error' && (routed || m.code !== 'unrouted'));

describe('пылесос S3 этажеркой', () => {
  it('платы собираются без нарушений зазоров', () => {
    for (const b of BOARDS) expect(errors(buildStackBoard(b), false).map((m) => m.message), b).toEqual([]);
  });

  it('разъёмы между платами: на обеих платах одни и те же цепи', () => {
    const up = buildStackBoard('upper');
    const low = buildStackBoard('lower');
    const panel = buildStackBoard('panel');
    const same = (a: Project, b: Project, ref: string) => {
      const x = pinNets(a, ref);
      const y = pinNets(b, ref);
      const pins = new Set([...x.keys(), ...y.keys()]);
      for (const pin of pins) expect(x.get(pin), `${ref}.${pin}`).toBe(y.get(pin));
    };
    for (const ref of ['PT1', 'PT2', 'J2', 'J3', 'J4']) same(up, low, ref);
    same(low, panel, 'XS1');
  });

  it.runIf(WRITE)(
    'развести и записать платы',
    async () => {
      for (const b of BOARDS) {
        const r = await routeStackBoard(buildStackBoard(b));
        expect(r.failed, b).toBe(0);
        writeFileSync(file(b), serializeProject(r.project));
      }
    },
    1_800_000,
  );

  it.runIf(existsSync(file('upper')))('разведённые платы: всё соединено, DRC чистый', () => {
    const wires: Record<StackBoard, number> = { upper: 0, lower: 1, panel: 0 };
    for (const b of BOARDS) {
      const p = load(b);
      const fresh = buildStackBoard(b);
      // Файл от той же схемы: те же детали и цепи выводов.
      for (const c of Object.values(fresh.components)) expect(pinNets(p, c.ref), `${b} ${c.ref}`).toEqual(pinNets(fresh, c.ref));
      const cn = computeConnectivity(p);
      expect([...cn.nets.values()].filter((n) => !n.complete).map((n) => p.nets[n.netId]?.name), b).toEqual([]);
      expect(errors(p, true).map((m) => m.message), b).toEqual([]);
      expect(Object.keys(p.wires).length, b).toBe(wires[b]);
      expect(p.board.copperLayers, b).toBe(b === 'panel' ? 2 : 1);
      // Проволочки-переходные пульта не под корпусами: кнопки, энкодер, зуммер и разъём сядут ровно.
      expect(viasUnderBodies(p), b).toEqual([]);
    }
  });

  it.runIf(!!DUMP && existsSync(file('upper')))('выгрузка для лазера и памятки', () => {
    mkdirSync(DUMP!, { recursive: true });
    for (const b of BOARDS) {
      const p = load(b);
      writeFileSync(`${DUMP}/${b}.json`, JSON.stringify(dump(p)));
      writeFileSync(`${DUMP}/asm-${b}.svg`, assemblySvg(p));
    }
  });
});

/* ---------------- выгрузка для tools/stack-lazer ---------------- */

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const xy = (q: Vec2) => [r4(q.x), r4(q.y)];
const num = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * Плата для гравера и памятки: контур, медь по слоям (примитивы), отверстия, запреты меди (под антенной
 * и у стоек медь снимается и в быстром варианте), детали и свёрла.
 */
function dump(p: Project) {
  const prims = flattenProject(p, { fab: false });
  const layers = Object.fromEntries(
    (['B.Cu', 'F.Cu'] as const).map((l) => [
      l,
      (prims[l] ?? []).map((pr) => {
        if (pr.kind === 'path') return { k: 'path', pts: pr.pts.map(xy), w: pr.width, closed: !!pr.closed };
        if (pr.kind === 'region') return { k: 'region', pts: pr.pts.map(xy) };
        if (pr.kind === 'fill') return { k: 'fill', loops: pr.loops.map((loop) => loop.map(xy)) };
        return { k: 'flash', pts: pr.shape.pts.map(xy), r: pr.shape.r };
      }),
    ]),
  );
  const w = getWorld(p);
  const holes = [
    ...w.pads.filter((wp) => wp.drill).map((wp) => ({ x: r4(wp.center.x), y: r4(wp.center.y), d: wp.drill, npth: wp.pad.type === 'npth' })),
    ...w.vias.map((v) => ({ x: r4(v.via.at.x), y: r4(v.via.at.y), d: v.via.drill, npth: false })),
  ];
  const keepouts = Object.values(p.ruleAreas)
    .filter((a) => a.keepoutTracks && !a.name.startsWith('Надпись'))
    .map((a) => ({ name: a.name, layers: a.layers ?? null, pts: a.outline.map(xy) }));
  // Детали с выводами (для монтажки на макетке, tools/maketka): вывод — место в корпусе и логическая цепь.
  const comps = w.components.map((wc) => {
    const c = wc.component;
    const fp = p.footprints[c.footprint];
    const pins = (fp?.pads ?? [])
      .filter((q) => q.type !== 'npth')
      .map((q) => ({ n: q.number, name: q.name ?? '', x: r4(q.at.x), y: r4(q.at.y), net: c.padNets[q.number] ? logicalNet(p.nets[c.padNets[q.number]].name) : null }));
    return { ref: c.ref, value: c.value, description: c.description ?? '', fp: fp?.name ?? '', fid: c.footprint, at: xy(c.at), rot: c.rotation, pins, crt: fp?.courtyard ? [xy(fp.courtyard.min), xy(fp.courtyard.max)] : null, h: fp?.height ?? null };
  });
  const drills: Record<string, number> = {};
  for (const wp of w.pads) if (wp.drill) drills[wp.drill.toFixed(2)] = (drills[wp.drill.toFixed(2)] ?? 0) + 1;
  for (const v of w.vias) drills[`${v.via.drill.toFixed(2)} (переходные)`] = (drills[`${v.via.drill.toFixed(2)} (переходные)`] ?? 0) + 1;
  const topTracks = Object.values(p.tracks).filter((t) => t.layer === 'F.Cu').length;
  return { name: p.meta.name, outline: boardPolygon(p.board).map(xy), layers, holes, keepouts, comps, drills, vias: Object.keys(p.vias).length, wires: Object.keys(p.wires).length, topTracks };
}

function primSvg(pr: Prim, color: string, scaleW = 1): string {
  const path = (pts: Vec2[]) => pts.map((q, i) => `${i ? 'L' : 'M'}${num(q.x)} ${num(q.y)}`).join('');
  if (pr.kind === 'path') return `<path d="${path(pr.pts)}${pr.closed ? 'Z' : ''}" fill="none" stroke="${color}" stroke-width="${num(pr.width * scaleW)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (pr.kind === 'region') return `<path d="${path(pr.pts)}Z" fill="${color}"/>`;
  if (pr.kind === 'fill') return `<path d="${pr.loops.map((l) => path(l) + 'Z').join('')}" fill="${color}" fill-rule="evenodd"/>`;
  const s = pr.shape;
  if (s.pts.length === 1) return `<circle cx="${num(s.pts[0].x)}" cy="${num(s.pts[0].y)}" r="${num(s.r)}" fill="${color}"/>`;
  return `<path d="${path(flashOutline(s))}Z" fill="${color}"/>`;
}

/** Вид со стороны деталей для памятки: медь бледно (снизу — голубая, сверху — розовая), площадки, шелкография, переходные, перемычки. */
function assemblySvg(p: Project): string {
  const pr = flattenProject(p, { fab: false });
  const ol = boardPolygon(p.board);
  const xs = ol.map((q) => q.x);
  const ys = ol.map((q) => q.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x0 - 1)} ${num(y0 - 1)} ${num(w + 2)} ${num(h + 2)}" width="${num(w + 2)}mm" height="${num(h + 2)}mm">`];
  out.push(`<path d="${ol.map((q, i) => `${i ? 'L' : 'M'}${num(q.x)} ${num(q.y)}`).join('')}Z" fill="#f4f7f2" stroke="#000" stroke-width="0.3"/>`);
  for (const q of pr['B.Cu'] ?? []) if (q.kind !== 'flash') out.push(primSvg(q, '#cfe0f5'));
  if (p.board.copperLayers === 2) for (const q of pr['F.Cu'] ?? []) if (q.kind !== 'flash') out.push(primSvg(q, '#f5c9c9'));
  for (const q of pr['B.Cu'] ?? []) if (q.kind === 'flash') out.push(primSvg(q, '#9a9a9a'));
  for (const q of pr['F.Silk'] ?? []) out.push(primSvg(q, '#000', 1.2));
  for (const v of Object.values(p.vias)) out.push(`<circle cx="${num(v.at.x)}" cy="${num(v.at.y)}" r="${num(v.diameter / 2)}" fill="none" stroke="#c0392b" stroke-width="0.35"/>`);
  for (const wr of Object.values(p.wires)) out.push(`<line x1="${num(wr.a.x)}" y1="${num(wr.a.y)}" x2="${num(wr.b.x)}" y2="${num(wr.b.y)}" stroke="#d62728" stroke-width="0.7" stroke-linecap="round"/>`);
  out.push('</svg>');
  return out.join('');
}
