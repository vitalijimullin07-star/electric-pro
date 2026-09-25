/*
 * Ввод пером (S Pen, Apple Pencil, Wacom), пальцем и мышью: у каждого свой допуск
 * попадания и порог начала перетаскивания; касания ладони, пока перо рядом с экраном
 * или на нём, не считаются.
 */

export type PointerKind = 'mouse' | 'touch' | 'pen';

/** Сколько миллисекунд после последнего события пера касания считаются ладонью. */
const PALM_MS = 700;

export class PointerInput {
  kind: PointerKind = 'mouse';
  private penAt = 0;
  private penDown = false;
  private ignored = new Set<number>();
  private touches = new Set<number>();
  /** Перо встречалось: подсказку показываем один раз. */
  penSeen = false;

  /**
   * Принять событие или отбросить (ладонь). Для пера, коснувшегося экрана, возвращает
   * также касания, которые надо забыть (ладонь легла раньше пера).
   */
  accept(e: PointerEvent, phase: 'down' | 'move' | 'up'): { ok: boolean; drop: number[] } {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (e.pointerType === 'pen') {
      this.penAt = now;
      this.kind = 'pen';
      let drop: number[] = [];
      if (phase === 'down') {
        this.penDown = true;
        drop = [...this.touches];
        for (const id of drop) this.ignored.add(id);
        this.touches.clear();
      } else if (phase === 'up') this.penDown = false;
      return { ok: true, drop };
    }
    if (e.pointerType === 'touch') {
      if (this.ignored.has(e.pointerId)) {
        if (phase === 'up') this.ignored.delete(e.pointerId);
        return { ok: false, drop: [] };
      }
      if (phase === 'down') {
        if (this.penDown || now - this.penAt < PALM_MS) {
          this.ignored.add(e.pointerId);
          return { ok: false, drop: [] };
        }
        this.touches.add(e.pointerId);
        this.kind = 'touch';
      } else if (phase === 'up') this.touches.delete(e.pointerId);
      return { ok: true, drop: [] };
    }
    if (phase === 'down' || phase === 'move') this.kind = 'mouse';
    return { ok: true, drop: [] };
  }

  /** Допуск попадания в пикселях экрана. */
  tolPx(): number {
    return this.kind === 'touch' ? 12 : this.kind === 'pen' ? 7 : 6;
  }

  /** Сдвиг, после которого нажатие считается перетаскиванием. */
  dragPx(): number {
    return this.kind === 'touch' ? 8 : this.kind === 'pen' ? 6 : 4;
  }
}

/** Кнопка на корпусе пера (S Pen) приходит как правая кнопка, ластик — как пятая. */
export const isPenBarrel = (e: PointerEvent) => e.pointerType === 'pen' && (e.button === 2 || (e.buttons & 2) !== 0);
export const isPenEraser = (e: PointerEvent) => e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
