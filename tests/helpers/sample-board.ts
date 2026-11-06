import { readFileSync } from 'node:fs';
import { parseProjectFile } from '../../src/core/io/project-file';
import type { Project } from '../../src/core/model/types';

/** Образец разведённой платы для общих тестов: «Квазар» (односторонняя, 90×53 мм, ATmega). */
export function sampleBoard(): Project {
  const r = parseProjectFile(readFileSync('import/quasar-avr-desalex.plata.json', 'utf8'));
  if (r.kind !== 'project') throw new Error('не проект');
  return r.project;
}

/** Габарит платы, мм. */
export function boardSize(p: Project): { w: number; h: number } {
  const xs = p.board.outline.map((q) => q.x);
  const ys = p.board.outline.map((q) => q.y);
  return { w: Math.max(...xs), h: Math.max(...ys) };
}
