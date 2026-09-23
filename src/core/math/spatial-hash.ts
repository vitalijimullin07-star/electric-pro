import type { Box } from './geom';

/**
 * Простая пространственная сетка: быстро находит объекты, чьи габариты
 * пересекаются с заданным прямоугольником. Хватает для плат в тысячи объектов.
 */
export class SpatialHash<T> {
  private cells = new Map<number, T[]>();
  private readonly inv: number;

  constructor(cell = 2) {
    this.inv = 1 / cell;
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  insert(item: T, b: Box): void {
    const i0 = Math.floor(b.minX * this.inv);
    const i1 = Math.floor(b.maxX * this.inv);
    const j0 = Math.floor(b.minY * this.inv);
    const j1 = Math.floor(b.maxY * this.inv);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let a = this.cells.get(k);
        if (!a) this.cells.set(k, (a = []));
        a.push(item);
      }
  }

  /** Все объекты, чьи ячейки пересекаются с прямоугольником. Без повторов. */
  query(b: Box): T[] {
    const i0 = Math.floor(b.minX * this.inv);
    const i1 = Math.floor(b.maxX * this.inv);
    const j0 = Math.floor(b.minY * this.inv);
    const j1 = Math.floor(b.maxY * this.inv);
    const seen = new Set<T>();
    const out: T[] = [];
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const a = this.cells.get(this.key(i, j));
        if (!a) continue;
        for (const it of a)
          if (!seen.has(it)) {
            seen.add(it);
            out.push(it);
          }
      }
    return out;
  }
}
