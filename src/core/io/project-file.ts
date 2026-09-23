import { PROJECT_FORMAT, PROJECT_VERSION, type Project } from '../model/types';
import { createProject } from '../model/project';
import { isLegacyProjectFile, type LegacyProjectFile } from './legacy-plata';

/* Файл проекта .plata.json: сериализация, проверка и миграция версий. */

export function serializeProject(p: Project, pretty = false): string {
  return JSON.stringify(p, null, pretty ? 1 : 0);
}

export type ParsedFile = { kind: 'project'; project: Project } | { kind: 'legacy'; file: LegacyProjectFile };

export class ProjectFileError extends Error {}

export function parseProjectFile(text: string): ParsedFile {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new ProjectFileError('Это не JSON. Нужен файл проекта Plata целиком, от { до }.');
  }
  if (isLegacyProjectFile(obj)) return { kind: 'legacy', file: obj };
  if (!obj || typeof obj !== 'object' || (obj as { format?: string }).format !== PROJECT_FORMAT) throw new ProjectFileError('Файл не похож на проект Plata.');
  return { kind: 'project', project: migrateProject(obj as Project) };
}

/** Дополняет проект недостающими полями (старые версии формата) и проверяет ссылки. */
export function migrateProject(raw: Project): Project {
  const base = createProject();
  const p: Project = {
    ...base,
    ...raw,
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    meta: { ...base.meta, ...raw.meta },
    board: { ...base.board, ...raw.board },
    rules: { ...base.rules, ...raw.rules },
    netClasses: raw.netClasses && Object.keys(raw.netClasses).length ? raw.netClasses : base.netClasses,
    nets: raw.nets ?? {},
    footprints: raw.footprints ?? {},
    components: raw.components ?? {},
    tracks: raw.tracks ?? {},
    vias: raw.vias ?? {},
    wires: raw.wires ?? {},
    zones: raw.zones ?? {},
    ruleAreas: raw.ruleAreas ?? {},
    drawings: raw.drawings ?? {},
  };
  if (!Array.isArray(p.board.outline) || p.board.outline.length < 3) p.board.outline = base.board.outline;
  if (p.board.copperLayers !== 1 && p.board.copperLayers !== 2) p.board.copperLayers = 2;
  for (const [id, c] of Object.entries(p.components)) {
    c.id = id;
    c.padNets ??= {};
    c.rotation ??= 0;
    c.side ??= 'top';
    for (const k of Object.keys(c.padNets)) if (!p.nets[c.padNets[k]]) delete c.padNets[k];
  }
  for (const [id, t] of Object.entries(p.tracks)) {
    t.id = id;
    if (!Array.isArray(t.points) || t.points.length < 2) delete p.tracks[id];
  }
  for (const [id, v] of Object.entries(p.vias)) v.id = id;
  for (const [id, w] of Object.entries(p.wires)) w.id = id;
  for (const [id, n] of Object.entries(p.nets)) {
    n.id = id;
    if (!p.netClasses[n.netClass]) n.netClass = Object.keys(p.netClasses)[0];
  }
  return p;
}

export const PROJECT_EXT = '.plata.json';
