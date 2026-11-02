import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseProjectFile } from '../src/core/io/project-file';
import { exportEasyedaPcb } from '../src/core/io/easyeda-pcb-export';
import { getWorld } from '../src/core/model/world';
import type { Project } from '../src/core/model/types';

/*
 * Плата для EasyEDA Standard: на этаже 4 этажерки под ЛУТ (сквозные площадки с медью только снизу,
 * дорожки с обеих сторон, переходные). EASYEDA_OUT=папка — записать файлы всех четырёх плат.
 */

const load = (f: number): Project => {
  const r = parseProjectFile(readFileSync(`import/vacuum-s3-lut-f${f}.plata.json`, 'utf8'));
  if (r.kind !== 'project') throw new Error('не проект');
  return r.project;
};

describe('плата в формате EasyEDA Standard', () => {
  it('корпуса, площадки, цепи, дорожки и переходные на месте', () => {
    const p = load(4);
    const j = JSON.parse(exportEasyedaPcb(p));
    expect(j.head.docType).toBe('3');
    const shapes: string[] = j.shape;
    const libs = shapes.filter((s) => s.startsWith('LIB~'));
    const w = getWorld(p);
    expect(libs.length).toBe(w.components.length);
    const sub = libs.flatMap((s) => s.split('#@$').slice(1));
    const pads = sub.filter((s) => s.startsWith('PAD~'));
    expect(pads.length).toBe(w.pads.filter((q) => q.pad.type !== 'npth').length);
    // Площадка: центр в единицах 10 mil от (4000, 3000), цепь — имя цепи проекта.
    const wp = w.pads.find((q) => q.net && q.pad.type === 'tht')!;
    const f = pads.map((s) => s.split('~')).find((a) => Math.abs(+a[2] - (4000 + wp.center.x / 0.254)) < 0.01 && Math.abs(+a[3] - (3000 + wp.center.y / 0.254)) < 0.01)!;
    expect(f, 'площадка по координатам').toBeTruthy();
    expect(f[7]).toBe(p.nets[wp.net!].name);
    // Медь только снизу: планарная площадка на нижнем слое и отверстие.
    expect(f[6]).toBe('2');
    expect(sub.filter((s) => s.startsWith('HOLE~')).length).toBeGreaterThan(0);
    const tracks = shapes.filter((s) => /^TRACK~[^~]+~[12]~/.test(s));
    expect(tracks.length).toBe(Object.values(p.tracks).filter((t) => t.points.length >= 2).length);
    expect(tracks.filter((s) => s.split('~')[3] === '').length, 'дорожки без цепи').toBe(0);
    expect(shapes.filter((s) => s.startsWith('VIA~')).length).toBe(Object.keys(p.vias).length);
    expect(shapes.some((s) => s.startsWith('TRACK~') && s.split('~')[2] === '10')).toBe(true);
    // Разделители EasyEDA не попадают в поля.
    for (const s of shapes) for (const part of s.split('#@$')) expect(part.split('~').length, part.slice(0, 40)).toBeGreaterThan(4);
  });

  it.runIf(!!process.env.EASYEDA_OUT)('записать платы 1–4', () => {
    for (const f of [1, 2, 3, 4]) writeFileSync(`${process.env.EASYEDA_OUT}/plata-${f}.pcb.json`, exportEasyedaPcb(load(f)));
  });
});
