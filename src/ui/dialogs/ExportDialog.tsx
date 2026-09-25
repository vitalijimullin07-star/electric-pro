import { useState } from 'react';
import { useEditor } from '@editor/store';
import { Dialog } from './Dialog';
import { saveTextFile, copyText, isHostedPage } from '../files';
import { fabricationZip, homemadeZip } from '@core/io/package';
import { exportGerbers, safeName } from '@core/io/gerber';
import { exportAssemblySvg, exportCopperSvg } from '@core/io/svg-export';
import { exportLutPdf, lutMirrorFor, type LutSheet } from '@core/io/lut-pdf';
import type { LayerId } from '@core/model/types';
import { exportBomCsv, exportNetlistText, exportPickPlaceCsv } from '@core/io/bom';
import { serializeProject, PROJECT_EXT } from '@core/io/project-file';
import { boardCopperLayers, LAYERS } from '@core/model/layers';
import { runDrc } from '@core/model/drc';
import { computeConnectivity } from '@core/model/connectivity';

export function ExportDialog() {
  const s = useEditor();
  const p = s.project;
  const base = safeName(p.meta.name);
  const [mirror, setMirror] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const copperLayers = boardCopperLayers(p.board.copperLayers);
  const [lutLayers, setLutLayers] = useState<LayerId[]>(copperLayers);
  const [lutCopies, setLutCopies] = useState(1);
  const [lutNegative, setLutNegative] = useState(false);
  const [lutMirror, setLutMirror] = useState(true);
  const toggleLut = (l: LayerId) => setLutLayers((xs) => (xs.includes(l) ? xs.filter((x) => x !== l) : [...xs, l]));
  const lutPdf = () => {
    const sheets: LutSheet[] = lutLayers.map((layer) => ({ layer, mirror: lutMirror ? lutMirrorFor(layer) : false }));
    const r = exportLutPdf(p, { sheets, copies: lutCopies, negative: lutNegative });
    return { r, name: `${base}-LUT${lutNegative ? '-negative' : ''}.pdf` };
  };
  const drc = runDrc(p);
  const conn = computeConnectivity(p);
  const copper = boardCopperLayers(p.board.copperLayers);

  const hosted = isHostedPage();
  const run = async (label: string, fn: () => Promise<unknown> | unknown) => {
    setBusy(label);
    try {
      const r = await fn();
      s.setMessage(r === false ? `${label}: сохранение отменено.` : `${label}: готово.`);
    } catch (e) {
      s.setMessage(`${label}: ошибка — ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title="Экспорт" size="wide">
      {(drc.errors > 0 || conn.unrouted > 0) && (
        <p className="hint" style={{ color: 'var(--warn)' }}>
          Внимание: {conn.unrouted ? `не разведено цепей: ${conn.unrouted}; ` : ''}
          {drc.errors ? `ошибок проверки: ${drc.errors}. ` : ''}
          Файлы всё равно можно выгрузить.
        </p>
      )}
      <h4 style={{ marginTop: 0 }}>На завод</h4>
      <p className="hint">Gerber RS-274X (медь, маска, шелкография, паста, контур), сверловка Excellon, перечень элементов и файл расстановки — одним архивом. Подходит для JLCPCB, PCBWay, Резонита и других.</p>
      <div className="row">
        <button className="btn primary" disabled={!!busy} onClick={() => run('Архив Gerber', async () => {
          const z = fabricationZip(p);
          return saveTextFile(z.name, z.data, 'application/zip');
        })}>
          Скачать архив Gerber + сверловка
        </button>
        {!hosted && (
          <button className="btn" disabled={!!busy} onClick={() => run('Gerber по файлам', async () => {
            for (const f of exportGerbers(p)) if (!(await saveTextFile(f.name, f.content, 'text/plain'))) return false;
          })}>
            Отдельными файлами
          </button>
        )}
      </div>
      <h4>Дома: печать для ЛУТ (PDF)</h4>
      <p className="hint">
        Лист A4 (или A3 для большой платы) строго 1:1, по листу на слой. Печатайте с масштабом 100% («фактический размер») и проверьте линейку 50 мм внизу листа. Для ЛУТ верхние слои печатаются зеркально, нижняя медь — без зеркала.
      </p>
      <div className="row">
        {[...copperLayers, 'F.Silk' as LayerId].map((l) => (
          <label key={l}>
            <input type="checkbox" checked={lutLayers.includes(l)} onChange={() => toggleLut(l)} /> {LAYERS[l].name}
          </label>
        ))}
      </div>
      <div className="row">
        <label>
          копий на листе{' '}
          <input className="inp" style={{ width: 64 }} type="number" min={1} max={20} value={lutCopies} onChange={(e) => setLutCopies(Math.max(1, Math.min(20, Math.round(+e.target.value || 1))))} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label>
          <input type="checkbox" checked={lutMirror} onChange={(e) => setLutMirror(e.target.checked)} /> зеркало как для ЛУТ
        </label>
        <label>
          <input type="checkbox" checked={lutNegative} onChange={(e) => setLutNegative(e.target.checked)} /> негатив
        </label>
      </div>
      <div className="row">
        <button
          className="btn primary"
          disabled={!!busy || !lutLayers.length}
          onClick={() =>
            run('Печать для ЛУТ', async () => {
              const { r, name } = lutPdf();
              const ok = await saveTextFile(name, r.bytes, 'application/pdf');
              if (ok !== false && r.tooBig) s.setMessage('Плата больше листа A3: PDF сохранён, но рисунок не поместится на лист целиком.');
              else if (ok !== false && r.copies[0] < lutCopies) s.setMessage(`На лист ${r.paper} помещается копий: ${r.copies[0]}. PDF сохранён.`);
              return ok;
            })
          }
        >
          Скачать PDF для печати
        </button>
      </div>
      <h4>Дома: SVG для ЛУТ или фоторезиста</h4>
      <p className="hint">
        SVG в масштабе 1:1 (размеры в мм в самом файле): печатайте без подгонки под лист, масштаб 100%. Вид со стороны деталей: для нижнего слоя при ЛУТ печатать без зеркала, для фоторезиста — как требует ваш процесс. В центрах отверстий оставлены точки под кернение.
      </p>
      <div className="row">
        {copper.map((l) => (
          <button key={l} className="btn" disabled={!!busy} onClick={() => run(`Медь ${LAYERS[l].name}`, () => saveTextFile(`${base}-${l.replace('.', '_')}${mirror ? '-mirror' : ''}.svg`, exportCopperSvg(p, l, { mirror }), 'image/svg+xml'))}>
            {LAYERS[l].name}, SVG 1:1
          </button>
        ))}
        <label>
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> зеркально
        </label>
      </div>
      <div className="row">
        <button className="btn" disabled={!!busy} onClick={() => run('Сборочный вид', () => saveTextFile(`${base}-assembly-top.svg`, exportAssemblySvg(p, 'top'), 'image/svg+xml'))}>
          Сборочный вид сверху, SVG
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run('Комплект для дома', async () => {
          const z = homemadeZip(p);
          return saveTextFile(z.name, z.data, 'application/zip');
        })}>
          Весь комплект архивом
        </button>
      </div>
      <h4>Документы</h4>
      <div className="row">
        <button className="btn" disabled={!!busy} onClick={() => run('Перечень элементов', () => saveTextFile(`${base}-BOM.csv`, exportBomCsv(p), 'text/csv'))}>
          Перечень элементов (BOM), CSV
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run('Расстановка', () => saveTextFile(`${base}-PickPlace.csv`, exportPickPlaceCsv(p), 'text/csv'))}>
          Расстановка (Pick&Place), CSV
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run('Список соединений', () => saveTextFile(`${base}-netlist.txt`, exportNetlistText(p), 'text/plain'))}>
          Список соединений, TXT
        </button>
      </div>
      <h4>Проект</h4>
      <div className="row">
        <button className="btn" disabled={!!busy} onClick={() => run('Файл проекта', () => saveTextFile(`${base}${PROJECT_EXT}`, serializeProject(p, true), 'application/json'))}>
          Сохранить проект файлом
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run('Копирование', async () => {
          if (!(await copyText(serializeProject(p)))) throw new Error('буфер обмена недоступен');
        })}>
          Скопировать проект в буфер
        </button>
      </div>
      <p className="hint">Проект автоматически сохраняется в браузере; файл нужен, чтобы перенести его на другое устройство или в облако.</p>
    </Dialog>
  );
}
