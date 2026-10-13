import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { binaryStl, parseStl, raycastStl, stlSize, modelSources, STL_EDGE_LIMIT } from '../src/core/io/stl';

/** Куб со стороной s от (x0,y0,z0): 12 треугольников, обход против часовой снаружи. */
function cube(s = 10, x0 = 0, y0 = 0, z0 = 0): number[] {
  const v = (i: number) => [x0 + (i & 1 ? s : 0), y0 + (i & 2 ? s : 0), z0 + (i & 4 ? s : 0)];
  const quads = [
    [0, 2, 3, 1], // низ (z=0), нормаль −z
    [4, 5, 7, 6], // верх, +z
    [0, 1, 5, 4], // y=0, −y
    [2, 6, 7, 3], // y=s, +y
    [0, 4, 6, 2], // x=0, −x
    [1, 3, 7, 5], // x=s, +x
  ];
  const out: number[] = [];
  for (const [a, b, c, d] of quads) out.push(...v(a), ...v(b), ...v(c), ...v(a), ...v(c), ...v(d));
  return out;
}

function ascii(tris: number[], name = 'cube'): Uint8Array {
  let s = `solid ${name}\n`;
  for (let i = 0; i < tris.length; i += 9) {
    s += '  facet normal 0 0 0\n    outer loop\n';
    for (let k = 0; k < 9; k += 3) s += `      vertex ${tris[i + k]} ${tris[i + k + 1]} ${tris[i + k + 2]}\n`;
    s += '    endloop\n  endfacet\n';
  }
  return strToU8(s + `endsolid ${name}\n`);
}

describe('STL', () => {
  it('двоичный куб: габарит, объём, площадь, замкнут', () => {
    const m = parseStl(binaryStl(new Float32Array(cube(10))), 'cube.stl');
    expect(m.triangles).toBe(12);
    expect(stlSize(m)).toEqual([10, 10, 10]);
    expect(m.volume).toBeCloseTo(1000, 6);
    expect(m.area).toBeCloseTo(600, 6);
    expect(m.flipped).toBe(false);
    expect(m.edges).toMatchObject({ open: 0, nonManifold: 0, bodies: 1 });
    // Острые рёбра куба — 12 (диагонали граней плоские и не рисуются).
    expect(m.edges!.lines.length / 6).toBe(12);
    // Нормаль первой грани (низ) — вниз.
    expect([...m.normals.slice(0, 3)]).toEqual([0, 0, -1]);
  });

  it('текстовый STL и «solid» в заголовке двоичного', () => {
    const a = parseStl(ascii(cube(20)), 'a.stl');
    expect(a.triangles).toBe(12);
    expect(a.volume).toBeCloseTo(8000, 6);
    // Двоичный файл, заголовок которого начинается со «solid» (так пишут некоторые САПР).
    const b = parseStl(binaryStl(new Float32Array(cube(5)), 'solid part from CAD'), 'b.stl');
    expect(b.volume).toBeCloseTo(125, 6);
  });

  it('вывернутая модель переворачивается, два тела и дыра считаются', () => {
    const inv = cube(10);
    for (let i = 0; i < inv.length; i += 9) for (let a = 0; a < 3; a++) [inv[i + 3 + a], inv[i + 6 + a]] = [inv[i + 6 + a], inv[i + 3 + a]];
    const m = parseStl(binaryStl(new Float32Array(inv)), 'inv.stl');
    expect(m.flipped).toBe(true);
    expect(m.volume).toBeCloseTo(1000, 6);
    expect([...m.normals.slice(0, 3)]).toEqual([0, 0, -1]);

    const two = parseStl(binaryStl(new Float32Array([...cube(10), ...cube(5, 20, 0, 0)])), 'two.stl');
    expect(two.edges!.bodies).toBe(2);
    expect(two.volume).toBeCloseTo(1125, 6);

    const hole = parseStl(binaryStl(new Float32Array(cube(10).slice(0, 9 * 10))), 'hole.stl');
    expect(hole.edges!.open).toBe(4);
  });

  it('не STL и пустой файл — понятная ошибка; неверное число граней в заголовке', () => {
    expect(() => parseStl(strToU8('привет'), 'x.stl')).toThrow(/не STL/);
    expect(() => parseStl(new Uint8Array(84), 'e.stl')).toThrow(/нет треугольников/);
    const b = binaryStl(new Float32Array(cube(10)));
    new DataView(b.buffer).setUint32(80, 0, true);
    expect(parseStl(b, 'zero.stl').triangles).toBe(12);
  });

  it('ZIP: только STL, по алфавиту, с путями; обычный файл — как есть', () => {
    const z = zipSync({
      'печать/стакан.stl': binaryStl(new Float32Array(cube(10))),
      'печать/кожух.stl': ascii(cube(4)),
      'readme.txt': strToU8('привет'),
      '__MACOSX/печать/._кожух.stl': strToU8('мусор'),
    });
    const src = modelSources('Пылесос.zip', z);
    expect(src.map((s) => s.name)).toEqual(['печать/кожух.stl', 'печать/стакан.stl']);
    expect(parseStl(src[0].bytes, src[0].name).volume).toBeCloseTo(64, 6);
    const one = modelSources('C:\\детали\\a.stl', binaryStl(new Float32Array(cube(1))));
    expect(one).toHaveLength(1);
    expect(one[0].name).toBe('a.stl');
  });

  it('луч: ближняя грань, разрез отсекает', () => {
    const m = parseStl(binaryStl(new Float32Array(cube(10))), 'c.stl');
    // Сверху вниз по центру: попадание в верх куба (z = 10) с высоты 30.
    expect(raycastStl(m.positions, [5, 5, 30], [0, 0, -1])).toBeCloseTo(20, 6);
    // Верхняя половина отрезана (оставляем z ≤ 5): видна внутренняя сторона дна.
    expect(raycastStl(m.positions, [5, 5, 30], [0, 0, -1], (_x, _y, z) => z <= 5)).toBeCloseTo(30, 6);
    expect(raycastStl(m.positions, [50, 5, 30], [0, 0, -1])).toBeNull();
  });

  it('большие модели: рёбра не считаются, остальное есть', () => {
    const n = STL_EDGE_LIMIT + 1;
    const pos = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) pos.set([t, 0, 0, t + 1, 0, 0, t, 1, 0], t * 9);
    const m = parseStl(binaryStl(pos), 'big.stl');
    expect(m.triangles).toBe(n);
    expect(m.edges).toBeNull();
    expect(m.area).toBeCloseTo(n / 2, 0);
  });
});
