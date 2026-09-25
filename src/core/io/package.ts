import { strToU8, zipSync } from 'fflate';
import type { Project } from '../model/types';
import { exportBomCsv, exportNetlistText, exportPickPlaceCsv } from './bom';
import { exportGerbers, safeName } from './gerber';
import { serializeProject } from './project-file';
import { exportAssemblySvg, exportCopperSvg } from './svg-export';
import { boardCopperLayers } from '../model/layers';
import { exportLutPdf, lutMirrorFor } from './lut-pdf';

/** Архив для завода: Gerber, сверловка, BOM, расстановка. */
export function fabricationZip(p: Project): { name: string; data: Uint8Array } {
  const base = safeName(p.meta.name);
  const files: Record<string, Uint8Array> = {};
  for (const f of exportGerbers(p)) files[f.name] = strToU8(f.content);
  files[`${base}-BOM.csv`] = strToU8(exportBomCsv(p));
  files[`${base}-PickPlace.csv`] = strToU8(exportPickPlaceCsv(p));
  files[`${base}-netlist.txt`] = strToU8(exportNetlistText(p));
  return { name: `${base}-gerber.zip`, data: zipSync(files, { level: 6 }) };
}

/** Комплект для домашнего изготовления: медь 1:1, сборочный вид, список соединений, проект. */
export function homemadeZip(p: Project): { name: string; data: Uint8Array } {
  const base = safeName(p.meta.name);
  const files: Record<string, Uint8Array> = {};
  for (const l of boardCopperLayers(p.board.copperLayers)) {
    files[`${base}-${l.replace('.', '_')}.svg`] = strToU8(exportCopperSvg(p, l));
    files[`${base}-${l.replace('.', '_')}-mirror.svg`] = strToU8(exportCopperSvg(p, l, { mirror: true }));
  }
  const layers = [...boardCopperLayers(p.board.copperLayers), 'F.Silk' as const];
  files[`${base}-LUT.pdf`] = exportLutPdf(p, { sheets: layers.map((layer) => ({ layer, mirror: lutMirrorFor(layer) })) }).bytes;
  files[`${base}-assembly-top.svg`] = strToU8(exportAssemblySvg(p, 'top'));
  files[`${base}-netlist.txt`] = strToU8(exportNetlistText(p));
  files[`${base}-BOM.csv`] = strToU8(exportBomCsv(p));
  files[`${base}.plata.json`] = strToU8(serializeProject(p, true));
  return { name: `${base}-lut.zip`, data: zipSync(files, { level: 6 }) };
}
