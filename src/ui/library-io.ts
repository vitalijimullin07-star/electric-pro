import { libraryFootprint } from '@core/library';
import { importKicadBoard, importKicadFootprint } from '@core/io/kicad';
import { layToProject, parseLay } from '@core/io/sprint-layout';
import { MY_CATEGORY } from '@core/library/builder';
import type { FootprintDef } from '@core/model/types';
import { useEditor } from '@editor/store';
import { addUserFootprints } from '@editor/userlib';
import { openFileBytes, openTextFile, openTextFiles, saveTextFile } from './files';

/* Файлы библиотеки: импорт корпусов KiCad и своих корпусов, выгрузка «Моих корпусов», плата из KiCad. */

const isFootprint = (x: unknown): x is FootprintDef => !!x && typeof (x as FootprintDef).id === 'string' && Array.isArray((x as FootprintDef).pads) && Array.isArray((x as FootprintDef).graphics);

/** Корпуса из текстов файлов: .kicad_mod или .json («Мои корпуса»). */
export function footprintsFromFiles(files: { name: string; text: string }[]): { fps: FootprintDef[]; warnings: string[]; errors: string[] } {
  const fps: FootprintDef[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      if (/\.json$/i.test(f.name)) {
        const data = JSON.parse(f.text) as unknown;
        const list = Array.isArray(data) ? data : (data as { footprints?: unknown[] }).footprints;
        if (!Array.isArray(list)) throw new Error('в файле нет списка корпусов');
        const ok = list.filter(isFootprint);
        if (!ok.length) throw new Error('в файле нет корпусов Plata');
        fps.push(...ok);
      } else {
        const r = importKicadFootprint(f.text);
        // Встроенный корпус с тем же именем важнее — импортированный получает приставку.
        const id = libraryFootprint(r.def.id) ? `KiCad_${r.def.id}` : r.def.id;
        fps.push({ ...r.def, id, category: MY_CATEGORY });
        warnings.push(...r.warnings);
      }
    } catch (e) {
      errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return { fps, warnings, errors };
}

export async function importFootprintFiles(): Promise<void> {
  const files = await openTextFiles('.kicad_mod,.json');
  if (!files.length) return;
  const s = useEditor.getState();
  const { fps, warnings, errors } = footprintsFromFiles(files);
  if (!fps.length) {
    s.setMessage(`Корпуса не импортированы: ${errors.join('; ') || 'пустые файлы'}.`);
    return;
  }
  const r = addUserFootprints(fps);
  s.setTool('place');
  s.patch({ placeFootprint: fps[0].id, panelTab: 'library', panelOpen: true });
  s.setMessage(
    `В «Мои корпуса» добавлено ${r.added}${r.replaced ? `, обновлено ${r.replaced}` : ''}.` +
      (warnings.length ? ` ${warnings.slice(0, 2).join(' ')}` : '') +
      (errors.length ? ` Не удалось: ${errors.slice(0, 2).join('; ')}.` : '') +
      ' Размеры помечены «типовые» — сверьте с даташитом.',
  );
}

export async function exportUserLibrary(): Promise<void> {
  const s = useEditor.getState();
  const list = s.userFootprints;
  if (!list.length) return;
  const ok = await saveTextFile('plata-my-footprints.json', JSON.stringify({ format: 'plata-footprints', version: 1, footprints: list }, null, 1), 'application/json');
  if (ok !== false) s.setMessage(`«Мои корпуса» (${list.length}) сохранены файлом. Загрузить на другом устройстве: Библиотека → Импорт.`);
}

/** Открывает плату KiCad (.kicad_pcb) как новый проект. */
export function openKicadBoardText(name: string, text: string): void {
  const s = useEditor.getState();
  try {
    const r = importKicadBoard(text, name.replace(/\.kicad_pcb$/i, ''));
    s.replaceProject(r.project, null);
    const n = Object.keys(r.project.components).length;
    s.setMessage(`Плата из KiCad: компонентов ${n}, дорожек ${Object.keys(r.project.tracks).length}.${r.warnings.length ? ' ' + r.warnings.slice(0, 3).join(' ') : ''} Правила — по умолчанию, проверьте их в настройках платы.`);
  } catch (e) {
    s.setMessage(`Не удалось открыть плату KiCad: ${(e as Error).message}`);
  }
}

export async function importKicadBoardFile(): Promise<void> {
  const f = await openTextFile('.kicad_pcb');
  if (f) openKicadBoardText(f.name, f.text);
}

/** Открывает плату Sprint Layout (.lay, .lay6) как новый проект: медь, площадки, шелкография, цепи по меди. */
export function openLayBytes(name: string, bytes: Uint8Array): void {
  const s = useEditor.getState();
  try {
    const lay = parseLay(bytes);
    const r = layToProject(lay, { name: name.replace(/\.lay6?$/i, '') });
    s.replaceProject(r.project, null);
    const p = r.project;
    s.setMessage(`Плата из Sprint Layout ${lay.version}: деталей ${Object.keys(p.components).length}, дорожек ${Object.keys(p.tracks).length}, цепей ${Object.keys(p.nets).length} (по связности меди).${r.warnings.length ? ' ' + r.warnings.slice(0, 2).join(' ') : ''} Группы стали деталями E1, E2… — задайте им обозначения и номиналы.`);
  } catch (e) {
    s.setMessage(`Не удалось открыть файл Sprint Layout: ${(e as Error).message}`);
  }
}

export async function importLayFile(): Promise<void> {
  const f = await openFileBytes('.lay,.lay6');
  if (f) openLayBytes(f.name, f.bytes);
}
