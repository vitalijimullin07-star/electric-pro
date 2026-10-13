/*
 * STEP и IGES: читает OpenCascade (occt-import-js, WebAssembly — в редакторе загружается
 * отдельно, в воркере). Здесь — только перевод его ответа в детали: дерево сборки → список
 * деталей с именами узлов, треугольники развёрнуты (9 чисел на треугольник), гладкие нормали.
 */

export interface OcctMesh {
  name?: string;
  color?: ArrayLike<number> | null;
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } };
  index: { array: ArrayLike<number> };
}

export interface OcctNode {
  name?: string;
  meshes?: number[];
  children?: OcctNode[];
}

export interface OcctResult {
  success: boolean;
  root: OcctNode;
  meshes: OcctMesh[];
}

export interface CadPart {
  name: string;
  /** Узлы сборки над деталью через « / » (пусто — деталь в корне). */
  path: string;
  /** Вершины треугольников подряд, мм. */
  positions: Float32Array;
  /** Нормали у вершин (гладкая поверхность) или null. */
  normals: Float32Array | null;
  /** Цвет из файла 0…1 или null. */
  color: [number, number, number] | null;
}

/** Параметры сетки для OpenCascade: миллиметры, прогиб — доля габарита, угол — рад. */
export const OCCT_PARAMS = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.35 };

/** Безликие имена тел, которые пишут САПР: вместо них — имя узла сборки. */
const GENERIC = /^(solid|body|shape|compound|part|тело|деталь)\s*[-_]?\d*$/i;

function expand(m: OcctMesh): { pos: Float32Array; nrm: Float32Array | null } {
  const p = m.attributes.position.array;
  const n = m.attributes.normal?.array;
  const idx = m.index.array;
  const pos = new Float32Array(idx.length * 3);
  const nrm = n && n.length === p.length ? new Float32Array(idx.length * 3) : null;
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i] * 3;
    pos[i * 3] = p[v];
    pos[i * 3 + 1] = p[v + 1];
    pos[i * 3 + 2] = p[v + 2];
    if (nrm && n) {
      nrm[i * 3] = n[v];
      nrm[i * 3 + 1] = n[v + 1];
      nrm[i * 3 + 2] = n[v + 2];
    }
  }
  return { pos, nrm };
}

/** Детали из ответа OpenCascade: обход дерева сборки, имена — по деталям, иначе по узлам; повторы — «(2)», «(3)». */
export function cadParts(r: OcctResult): CadPart[] {
  if (!r.success) throw new Error('файл не прочитан — это не STEP/IGES или он повреждён');
  const out: CadPart[] = [];
  const seen = new Map<string, number>();
  const used = new Set<number>();
  const add = (mi: number, base: string, path: string[], k: number, many: boolean) => {
    const m = r.meshes[mi];
    if (!m || used.has(mi) || !m.index.array.length) return;
    used.add(mi);
    const own = (m.name ?? '').trim();
    let name = own && !GENERIC.test(own) ? own : base || own || 'Деталь';
    if (many && (!own || GENERIC.test(own))) name += ` · ${k + 1}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n > 1) name += ` (${n})`;
    const { pos, nrm } = expand(m);
    const c = m.color && m.color.length >= 3 ? ([m.color[0], m.color[1], m.color[2]] as [number, number, number]) : null;
    out.push({ name, path: path.join(' / '), positions: pos, normals: nrm, color: c });
  };
  const walk = (node: OcctNode, path: string[]) => {
    const nm = (node.name ?? '').trim();
    const ms = node.meshes ?? [];
    ms.forEach((mi, k) => add(mi, nm, path, k, ms.length > 1));
    for (const ch of node.children ?? []) walk(ch, nm ? [...path, nm] : path);
  };
  walk(r.root, []);
  // Тела, которых нет в дереве, — тоже показать.
  r.meshes.forEach((_, mi) => add(mi, '', [], mi, true));
  return out;
}
