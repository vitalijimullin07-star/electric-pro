import { filletPolygon, boxOfPoints, type Box } from '../math/geom';
import type { Vec2 } from '../math/vec';
import { FACTORY_RULES, HOMEMADE_RULES, defaultNetClasses } from './rules';
import { PROJECT_FORMAT, PROJECT_VERSION, type Board, type Project } from './types';

export function rectOutline(w: number, h: number, x = 0, y = 0): Vec2[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export interface NewProjectOptions {
  name?: string;
  width?: number;
  height?: number;
  cornerRadius?: number;
  copperLayers?: 1 | 2;
  homemade?: boolean;
  template?: string;
}

export function createProject(o: NewProjectOptions = {}): Project {
  const now = new Date().toISOString();
  const homemade = o.homemade ?? false;
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    meta: { name: o.name ?? 'Новая плата', created: now, modified: now, template: o.template },
    board: {
      outline: rectOutline(o.width ?? 100, o.height ?? 80),
      cornerRadius: o.cornerRadius ?? 0,
      cutouts: [],
      copperLayers: o.copperLayers ?? 2,
      thickness: 1.6,
      maskColor: '#1f6b3a',
    },
    rules: structuredClone(homemade ? HOMEMADE_RULES : FACTORY_RULES),
    netClasses: defaultNetClasses(homemade),
    nets: {},
    footprints: {},
    components: {},
    tracks: {},
    vias: {},
    wires: {},
    zones: {},
    ruleAreas: {},
    drawings: {},
  };
}

/** Контур платы с учётом скругления углов, разбитый на отрезки. */
export function boardPolygon(b: Board): Vec2[] {
  return b.cornerRadius > 0 ? filletPolygon(b.outline, b.cornerRadius) : b.outline;
}

export function boardBox(b: Board): Box {
  return boxOfPoints(b.outline);
}

/** Если контур — прямоугольник по осям, вернёт его размеры. */
export function rectSize(outline: Vec2[]): { x: number; y: number; w: number; h: number } | null {
  if (outline.length !== 4) return null;
  const b = boxOfPoints(outline);
  const ok = outline.every(
    (p) => (Math.abs(p.x - b.minX) < 1e-6 || Math.abs(p.x - b.maxX) < 1e-6) && (Math.abs(p.y - b.minY) < 1e-6 || Math.abs(p.y - b.maxY) < 1e-6),
  );
  return ok ? { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY } : null;
}
