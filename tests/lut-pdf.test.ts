import { describe, expect, test } from 'vitest';
import { strFromU8, unzlibSync } from 'fflate';
import { convertLegacyBoard } from '../src/core/io/legacy-plata';
import { VACUUM_BOARD } from '../src/core/examples/vacuum-controller/board';
import { exportLutPdf, lutMirrorFor } from '../src/core/io/lut-pdf';
import { createProject } from '../src/core/model/project';
import { unsupportedChars } from '../src/core/render/stroke-font';

/** Распаковывает потоки страниц PDF, чтобы проверить команды рисования. */
function pageStreams(bytes: Uint8Array): string[] {
  const s = strFromU8(bytes, true);
  const out: string[] = [];
  const re = /\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    out.push(strFromU8(unzlibSync(bytes.subarray(start, start + +m[1]))));
  }
  return out;
}

describe('ЛУТ в PDF', () => {
  test('плата пылесоса: A4 альбомная, 1:1, линейка, точки под кернение, правильная структура', () => {
    const p = convertLegacyBoard(VACUUM_BOARD).project;
    const r = exportLutPdf(p, { sheets: [{ layer: 'B.Cu', mirror: false }, { layer: 'F.Silk', mirror: true }], copies: 2 });
    expect(r.tooBig).toBe(false);
    expect(r.paper).toBe('A4');
    expect(r.copies).toEqual([1, 1]);
    const s = strFromU8(r.bytes, true);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trim().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Count 2');
    // A4 альбомная: 297×210 мм = 841,89×595,276 pt.
    expect(s).toMatch(/\/MediaBox \[0 0 841\.89 595\.276\]/);
    // Таблица ссылок указывает точно на начала объектов.
    const xref = +/startxref\n(\d+)/.exec(s)![1];
    expect(s.slice(xref, xref + 4)).toBe('xref');
    const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => +m[1]);
    offs.forEach((o, i) => expect(s.slice(o, o + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`));
    const [cu, silk] = pageStreams(r.bytes);
    // Масштаб 1 мм и перевёрнутая ось Y; медь без зеркала, шелкография зеркально.
    expect(cu.startsWith('2.835 0 0 -2.835 0 595.276 cm')).toBe(true);
    expect(cu).toMatch(/\n1 0 0 1 [\d.-]+ [\d.-]+ cm/);
    expect(silk).toMatch(/\n-1 0 0 1 [\d.-]+ [\d.-]+ cm/);
    expect(cu.match(/ c\n/g)!.length).toBeGreaterThan(400); // круглые площадки и точки кернения
    expect(cu).toContain('1 g'); // белые точки в отверстиях
  });

  test('маленькая плата: несколько копий на A4, негатив, заливка по правилу чётности', () => {
    const p = createProject({ width: 40, height: 30 });
    const r = exportLutPdf(p, { sheets: [{ layer: 'B.Cu', mirror: false }], copies: 6, negative: true });
    expect(r.copies).toEqual([6]);
    expect(r.paper).toBe('A4');
    const [pg] = pageStreams(r.bytes);
    expect(pg.match(/\nq\n/g)!.length).toBeGreaterThanOrEqual(6);
  });

  test('огромная плата уходит на A3, слишком большая помечается', () => {
    expect(exportLutPdf(createProject({ width: 250, height: 180 }), { sheets: [{ layer: 'B.Cu', mirror: false }] }).paper).toBe('A3');
    expect(exportLutPdf(createProject({ width: 500, height: 400 }), { sheets: [{ layer: 'B.Cu', mirror: false }] }).tooBig).toBe(true);
  });

  test('зеркало по умолчанию и шрифт надписей', () => {
    expect(lutMirrorFor('F.Cu')).toBe(true);
    expect(lutMirrorFor('B.Cu')).toBe(false);
    for (const s of ['Проверьте линейкой: от 0 до 50 должно быть ровно 50 мм.', 'Иначе в печати выберите масштаб 100% (фактический размер).', 'ЛУТ: приложите лист тонером к меди. Точки в отверстиях - под кернение.', 'Шелкография для ЛУТ на сторону деталей после сверления.', 'зеркально, без зеркала, 1:1'])
      expect(unsupportedChars(s)).toEqual([]);
  });
});
