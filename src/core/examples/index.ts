import { convertLegacyBoard, type LegacyProjectFile } from '../io/legacy-plata';
import type { Project } from '../model/types';
import { VACUUM_BOARD } from './vacuum-controller/board';

export interface ExampleProject {
  id: string;
  name: string;
  description: string;
  size: [number, number];
  create(): Project;
}

export const EXAMPLES: ExampleProject[] = [
  {
    id: 'vacuum-controller',
    name: VACUUM_BOARD.title,
    description: VACUUM_BOARD.description ?? '',
    size: [203.2, 132.1],
    create: () => convertLegacyBoard(VACUUM_BOARD).project,
  },
];

/** Открывает сохранённый проект старой версии Plata (плата пылесоса). */
export function importLegacyVacuumProject(file: LegacyProjectFile): Project {
  return convertLegacyBoard(VACUUM_BOARD, file).project;
}
