import { unzipSync } from 'fflate';

/*
 * STL: разбор двоичного и текстового вида, сведения о модели (габарит, объём, площадь,
 * замкнутость, число тел), острые рёбра для показа, разбиение на тела, поворот и пересечение
 * луча с моделью. STEP и IGES читает OpenCascade (см. step.ts) — сюда приходят их треугольники.
 * Единицы — как в файле (обычно мм). Вывернутая модель (отрицательный объём) при чтении
 * переворачивается: снаружи у всех граней обход против часовой стрелки.
 */

export type V3 = [number, number, number];

export interface StlEdges {
  /** Рёбра с одной гранью — дыры в поверхности. */
  open: number;
  /** Рёбра с тремя и более гранями. */
  nonManifold: number;
  /** Отдельных тел (связных по общим вершинам). */
  bodies: number;
  /** Отрезки острых рёбер (угол между гранями больше 30°) и краёв дыр: 6 чисел на отрезок. */
  lines: Float32Array;
}

export interface StlModel {
  name: string;
  /** Вершины треугольников подряд: 9 чисел на треугольник. */
  positions: Float32Array;
  /** Нормаль грани у каждой из трёх вершин. */
  normals: Float32Array;
  triangles: number;
  min: V3;
  max: V3;
  /** Объём, мм³ (у незамкнутой модели — приблизительный). */
  volume: number;
  /** Площадь поверхности, мм². */
  area: number;
  /** Модель была вывернута и перевёрнута при чтении. */
  flipped: boolean;
  /** Рёбра; null — модель слишком большая, не проверялась. */
  edges: StlEdges | null;
}

/** Больше стольких треугольников рёбра и замкнутость не считаются (память телефона). */
export const STL_EDGE_LIMIT = 400_000;
const FEATURE_COS = Math.cos((30 * Math.PI) / 180);

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const baseName = (n: string) => n.slice(n.replace(/\\/g, '/').lastIndexOf('/') + 1);

/** Вид файла модели по имени: STL, STEP, IGES или null. */
export function modelKind(name: string): ModelKind | null {
  const m = /\.(stl|step|stp|iges|igs)$/i.exec(name);
  if (!m) return null;
  const e = m[1].toLowerCase();
  return e === 'stl' ? 'stl' : e === 'iges' || e === 'igs' ? 'iges' : 'step';
}
export type ModelKind = 'stl' | 'step' | 'iges';

/** Модели из выбранного файла: сам файл или все STL, STEP и IGES из архива ZIP (с путями внутри архива). */
export function modelSources(name: string, bytes: Uint8Array): { name: string; bytes: Uint8Array; kind: ModelKind }[] {
  if (!isZip(bytes)) return [{ name: baseName(name), bytes, kind: modelKind(name) ?? 'stl' }];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => modelKind(f.name) !== null && !/(^|\/)__MACOSX\//.test(f.name) });
  } catch {
    throw new Error(`${baseName(name)}: архив повреждён или сжат неизвестным способом`);
  }
  return Object.keys(files)
    .map((k) => ({ name: zipName(k), bytes: files[k], kind: modelKind(k)! }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Имена в архивах Windows без отметки UTF-8 записаны в CP866 — fflate читает их как latin1. */
function zipName(n: string): string {
  if (!/[\u0080-\u00ff]/.test(n) || /[^\u0000-\u00ff]/.test(n)) return n;
  const b = Uint8Array.from(n, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    try {
      return new TextDecoder('ibm866').decode(b);
    } catch {
      return n;
    }
  }
}

function looksText(b: Uint8Array): boolean {
  let i = 0;
  while (i < b.length && i < 64 && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  const head = new TextDecoder('latin1').decode(b.subarray(i, Math.min(b.length, i + 2048))).toLowerCase();
  return head.startsWith('solid') && /facet|endsolid/.test(head);
}

/** Разбор STL. Ошибка — с понятным текстом, если это не STL. */
export function parseStl(bytes: Uint8Array, name = 'model.stl'): StlModel {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = bytes.length >= 84 ? dv.getUint32(80, true) : -1;
  let pos: Float32Array;
  let solid = '';
  if (bytes.length >= 84 && 84 + declared * 50 === bytes.length) pos = readBinary(dv, declared);
  else if (looksText(bytes)) {
    const r = readAscii(new TextDecoder('latin1').decode(bytes));
    pos = r.pos;
    solid = r.name;
  } else if (bytes.length >= 134) {
    // Число треугольников в заголовке не сходится с длиной: верить длине, если заголовок обещает больше или ноль.
    const fit = Math.floor((bytes.length - 84) / 50);
    pos = readBinary(dv, declared > 0 && declared <= fit ? declared : fit);
  } else throw new Error(`${baseName(name)}: это не STL`);
  if (!pos.length) throw new Error(`${baseName(name)}: в файле нет треугольников`);
  return buildModel(pos, name || solid);
}

function readBinary(dv: DataView, n: number): Float32Array {
  const out = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++) out[t * 9 + k] = dv.getFloat32(o + k * 4, true);
  }
  return out;
}

function readAscii(text: string): { pos: Float32Array; name: string } {
  const name = /^\s*solid[ \t]+([^\r\n]*)/i.exec(text)?.[1]?.trim() ?? '';
  let out = new Float32Array(Math.max(9, Math.ceil(text.length / 25)));
  let n = 0;
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (n + 3 > out.length) {
      const bigger = new Float32Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[n++] = parseFloat(m[1]);
    out[n++] = parseFloat(m[2]);
    out[n++] = parseFloat(m[3]);
  }
  return { pos: out.slice(0, n - (n % 9)), name };
}

/**
 * Модель из вершин треугольников (9 чисел на треугольник): убирает битые грани, считает всё остальное.
 * smooth — нормали у вершин (из STEP: поверхность гладкая); без них — нормаль грани.
 */
export function buildModel(raw: Float32Array, name: string, smooth?: Float32Array): StlModel {
  // Треугольники с NaN или бесконечностью — пропустить.
  let pos = raw;
  let nrmIn = smooth && smooth.length === raw.length ? smooth : undefined;
  let bad = 0;
  for (let i = 0; i < raw.length; i++) if (!Number.isFinite(raw[i])) bad++;
  if (bad) {
    const keep: number[] = [];
    const keepN: number[] = [];
    for (let t = 0; t < raw.length / 9; t++) {
      let ok = true;
      for (let k = 0; k < 9; k++) if (!Number.isFinite(raw[t * 9 + k])) ok = false;
      if (!ok) continue;
      for (let k = 0; k < 9; k++) keep.push(raw[t * 9 + k]);
      if (nrmIn) for (let k = 0; k < 9; k++) keepN.push(nrmIn[t * 9 + k]);
    }
    pos = new Float32Array(keep);
    if (nrmIn) nrmIn = new Float32Array(keepN);
  }
  const T = pos.length / 9;
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  let vol6 = 0;
  let area2 = 0;
  for (let t = 0; t < T; t++) {
    const o = t * 9;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
    const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
    vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    area2 += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    for (let k = 0; k < 9; k += 3) {
      for (let a = 0; a < 3; a++) {
        const v = pos[o + k + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
  }
  // Вывернутая модель: поменять местами вторую и третью вершины у всех граней.
  const flipped = vol6 < 0;
  if (flipped) {
    if (pos === raw) pos = raw.slice();
    if (nrmIn && nrmIn === smooth) nrmIn = nrmIn.slice();
    for (const arr of nrmIn ? [pos, nrmIn] : [pos]) {
      for (let o = 0; o < arr.length; o += 9) {
        for (let a = 0; a < 3; a++) {
          const v = arr[o + 3 + a];
          arr[o + 3 + a] = arr[o + 6 + a];
          arr[o + 6 + a] = v;
        }
      }
    }
  }
  const faces = faceNormals(pos);
  return {
    name,
    positions: pos,
    normals: nrmIn ?? faces,
    triangles: T,
    min,
    max,
    volume: Math.abs(vol6) / 6,
    area: area2 / 2,
    flipped,
    edges: T <= STL_EDGE_LIMIT ? analyzeEdges(pos, faces) : null,
  };
}

function faceNormals(pos: Float32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let o = 0; o < pos.length; o += 9) {
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z);
    if (l > 0) {
      x /= l;
      y /= l;
      z /= l;
    } else z = 1;
    for (let k = 0; k < 9; k += 3) {
      n[o + k] = x;
      n[o + k + 1] = y;
      n[o + k + 2] = z;
    }
  }
  return n;
}

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/** Общие вершины по точному совпадению координат: номер общей вершины у каждой вершины треугольника. */
function weld(pos: Float32Array): { vid: Int32Array; first: Int32Array; nu: number } {
  const nv = pos.length / 3;
  // Открытая адресация по битам float32 (−0 и +0 — одна точка).
  const bits = new Uint32Array(pos.buffer, pos.byteOffset, pos.length);
  const key = (i: number) => (bits[i] === 0x80000000 ? 0 : bits[i]);
  const vcap = pow2(nv * 2);
  const vtab = new Int32Array(vcap).fill(-1);
  const vid = new Int32Array(nv);
  const first = new Int32Array(nv);
  let nu = 0;
  for (let i = 0; i < nv; i++) {
    const x = key(i * 3), y = key(i * 3 + 1), z = key(i * 3 + 2);
    let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d);
    h ^= h >>> 15;
    let s = h & (vcap - 1);
    for (;;) {
      const u = vtab[s];
      if (u < 0) {
        vtab[s] = nu;
        first[nu] = i;
        vid[i] = nu++;
        break;
      }
      const j = first[u];
      if (key(j * 3) === x && key(j * 3 + 1) === y && key(j * 3 + 2) === z) {
        vid[i] = u;
        break;
      }
      s = (s + 1) & (vcap - 1);
    }
  }
  return { vid, first, nu };
}

/**
 * Общие вершины (по точному совпадению координат), рёбра: дыры, «лишние» грани, острые рёбра;
 * тела — грани, связанные через рёбра ровно с двумя гранями (детали сборки, касающиеся друг друга
 * гранями или вершинами, остаются разными телами). bodyOf — номер тела у каждой грани.
 */
function topology(pos: Float32Array, nrm: Float32Array): StlEdges & { bodyOf: Int32Array } {
  const T = pos.length / 9;
  const { vid, first, nu } = weld(pos);
  // Рёбра: ключ — пара номеров вершин (меньший·nu + больший), при второй грани — проверка угла.
  const ecap = pow2(T * 4);
  const ekey = new Float64Array(ecap).fill(-1);
  const etri = new Int32Array(ecap);
  const etri2 = new Int32Array(ecap);
  const ecnt = new Uint8Array(ecap);
  const lines: number[] = [];
  const pushLine = (a: number, b: number) => {
    const i = first[a] * 3, j = first[b] * 3;
    lines.push(pos[i], pos[i + 1], pos[i + 2], pos[j], pos[j + 1], pos[j + 2]);
  };
  for (let t = 0; t < T; t++) {
    const v = [vid[t * 3], vid[t * 3 + 1], vid[t * 3 + 2]];
    for (let e = 0; e < 3; e++) {
      const a = Math.min(v[e], v[(e + 1) % 3]);
      const b = Math.max(v[e], v[(e + 1) % 3]);
      if (a === b) continue;
      const k = a * nu + b;
      let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77);
      h ^= h >>> 13;
      let s = h & (ecap - 1);
      while (ekey[s] !== -1 && ekey[s] !== k) s = (s + 1) & (ecap - 1);
      if (ekey[s] === -1) {
        ekey[s] = k;
        etri[s] = t;
        ecnt[s] = 1;
        continue;
      }
      if (ecnt[s] < 255) ecnt[s]++;
      if (ecnt[s] === 2) {
        etri2[s] = t;
        const o1 = etri[s] * 9, o2 = t * 9;
        if (nrm[o1] * nrm[o2] + nrm[o1 + 1] * nrm[o2 + 1] + nrm[o1 + 2] * nrm[o2 + 2] < FEATURE_COS) pushLine(a, b);
      }
    }
  }
  // Тела: объединение граней через рёбра. Ребро двух граней — одно тело; ребро трёх и более граней
  // (детали касаются, сетки совпали) — грани по кругу вокруг ребра, в пару — те, между которыми
  // материал (по направлению обхода, как у правильно вывернутого тела).
  const parent = new Int32Array(T);
  for (let t = 0; t < T; t++) parent[t] = t;
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  let open = 0;
  let nonManifold = 0;
  for (let s = 0; s < ecap; s++) {
    if (ekey[s] === -1) continue;
    if (ecnt[s] === 1) {
      open++;
      const k = ekey[s];
      const a = Math.floor(k / nu);
      pushLine(a, k - a * nu);
    } else if (ecnt[s] === 2) {
      const ra = find(etri[s]), rb = find(etri2[s]);
      if (ra !== rb) parent[rb] = ra;
    } else nonManifold++;
  }
  if (nonManifold) pairAroundEdges(pos, vid, first, nu, ekey, ecnt, ecap, (x, y) => {
    const ra = find(x), rb = find(y);
    if (ra !== rb) parent[rb] = ra;
  });
  const bodyOf = new Int32Array(T);
  let bodies = 0;
  for (let t = 0; t < T; t++) {
    const r = find(t);
    if (r === t) bodies++;
    bodyOf[t] = r;
  }
  return { open, nonManifold, bodies, lines: new Float32Array(lines), bodyOf };
}

/** Рёбра с тремя и более гранями: грани сортируются по углу вокруг ребра, связываются пары с материалом между ними. */
function pairAroundEdges(pos: Float32Array, vid: Int32Array, first: Int32Array, nu: number, ekey: Float64Array, ecnt: Uint8Array, ecap: number, join: (a: number, b: number) => void): void {
  const lists = new Map<number, { t: number; s: number }[]>();
  const T = pos.length / 9;
  for (let t = 0; t < T; t++) {
    for (let e = 0; e < 3; e++) {
      const p = vid[t * 3 + e], q = vid[t * 3 + ((e + 1) % 3)];
      if (p === q) continue;
      const a = Math.min(p, q), b = Math.max(p, q);
      const k = a * nu + b;
      let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77);
      h ^= h >>> 13;
      let sl = h & (ecap - 1);
      while (ekey[sl] !== k) sl = (sl + 1) & (ecap - 1);
      if (ecnt[sl] < 3) continue;
      let l = lists.get(sl);
      if (!l) lists.set(sl, (l = []));
      l.push({ t, s: p === a ? 1 : -1 });
    }
  }
  for (const [sl, l] of lists) {
    const k = ekey[sl];
    const a = Math.floor(k / nu), b = k - a * nu;
    const A = first[a] * 3, B = first[b] * 3;
    let dx = pos[B] - pos[A], dy = pos[B + 1] - pos[A + 1], dz = pos[B + 2] - pos[A + 2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    // Базис поперёк ребра: e1 ⟂ d, e2 = d × e1.
    const ax = Math.abs(dx) < 0.6 ? [1, 0, 0] : Math.abs(dy) < 0.6 ? [0, 1, 0] : [0, 0, 1];
    let e1x = dy * ax[2] - dz * ax[1], e1y = dz * ax[0] - dx * ax[2], e1z = dx * ax[1] - dy * ax[0];
    const el = Math.hypot(e1x, e1y, e1z) || 1;
    e1x /= el;
    e1y /= el;
    e1z /= el;
    const e2x = dy * e1z - dz * e1y, e2y = dz * e1x - dx * e1z, e2z = dx * e1y - dy * e1x;
    const ang = l.map(({ t, s }) => {
      let c = 0;
      for (let v = 0; v < 3; v++) if (vid[t * 3 + v] !== a && vid[t * 3 + v] !== b) c = (t * 3 + v) * 3;
      const ux = pos[c] - pos[A], uy = pos[c + 1] - pos[A + 1], uz = pos[c + 2] - pos[A + 2];
      let th = Math.atan2(ux * e2x + uy * e2y + uz * e2z, ux * e1x + uy * e1y + uz * e1z);
      // ±π — одно направление: собрать у −π, чтобы совпавшие грани не разъехались по краям списка.
      if (th > Math.PI - 0.02) th -= 2 * Math.PI;
      return { t, s, th };
    });
    // Совпавшие грани (касание деталей; на кривой поверхности — почти совпавшие, до ~1°): сначала та,
    // у которой материал «до» неё, — между ними пусто.
    ang.sort((p, q) => (Math.abs(p.th - q.th) > 0.02 ? p.th - q.th : q.s - p.s));
    for (let i = 0; i < ang.length; i++) {
      const nx = ang[(i + 1) % ang.length];
      if (ang[i].s === -1 && nx.s === 1) join(ang[i].t, nx.t);
    }
  }
}

function analyzeEdges(pos: Float32Array, nrm: Float32Array): StlEdges {
  const { bodyOf: _, ...e } = topology(pos, nrm);
  return e;
}

/**
 * Разбить модель на тела (грани, связанные общими рёбрами): сборка из одного файла STL или «составное
 * тело» STEP. Крупные тела — первыми. Одно тело — массив из одной модели.
 */
export function splitBodies(m: StlModel): StlModel[] {
  const { bodyOf } = topology(m.positions, faceNormals(m.positions));
  const T = m.triangles;
  const groups = new Map<number, number[]>();
  for (let t = 0; t < T; t++) {
    const r = bodyOf[t];
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(t);
  }
  if (groups.size <= 1) return [m];
  const parts = [...groups.values()].sort((a, b) => b.length - a.length);
  return parts.map((tris, i) => {
    const pos = new Float32Array(tris.length * 9);
    const nrm = new Float32Array(tris.length * 9);
    tris.forEach((t, k) => {
      pos.set(m.positions.subarray(t * 9, t * 9 + 9), k * 9);
      nrm.set(m.normals.subarray(t * 9, t * 9 + 9), k * 9);
    });
    return buildModel(pos, `${m.name} · тело ${i + 1}`, nrm);
  });
}

/** Повернуть модель на 90° вокруг X (лежащая на боку модель с осью Y вверх встаёт на Z). */
export function rotateX90(m: StlModel): StlModel {
  const rot = (a: Float32Array) => {
    const o = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 3) {
      o[i] = a[i];
      o[i + 1] = -a[i + 2];
      o[i + 2] = a[i + 1];
    }
    return o;
  };
  return buildModel(rot(m.positions), m.name, rot(m.normals));
}

/** Габарит модели, мм. */
export const stlSize = (m: StlModel): V3 => [m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]];

/**
 * Пересечение луча с треугольниками (Мёллер — Трумбор). Луч — в координатах модели.
 * keep — какие точки учитывать (например, по эту сторону плоскости разреза).
 * Возвращает расстояние вдоль луча (в длинах dir) или null.
 */
export function raycastStl(pos: Float32Array, o: V3, d: V3, keep?: (x: number, y: number, z: number) => boolean): number | null {
  let best = Infinity;
  for (let i = 0; i < pos.length; i += 9) {
    const e1x = pos[i + 3] - pos[i], e1y = pos[i + 4] - pos[i + 1], e1z = pos[i + 5] - pos[i + 2];
    const e2x = pos[i + 6] - pos[i], e2y = pos[i + 7] - pos[i + 1], e2z = pos[i + 8] - pos[i + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = o[0] - pos[i], ty = o[1] - pos[i + 1], tz = o[2] - pos[i + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t <= 0 || t >= best) continue;
    if (keep && !keep(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t)) continue;
    best = t;
  }
  return best < Infinity ? best : null;
}

/** Двоичный STL из вершин треугольников (9 чисел на треугольник). */
export function binaryStl(pos: Float32Array, header = 'Plata'): Uint8Array {
  const T = Math.floor(pos.length / 9);
  const out = new Uint8Array(84 + T * 50);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode(header.slice(0, 80)));
  dv.setUint32(80, T, true);
  const n = faceNormals(pos.subarray(0, T * 9));
  for (let t = 0; t < T; t++) {
    const o = 84 + t * 50;
    for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, n[t * 9 + k], true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, pos[t * 9 + k], true);
  }
  return out;
}
