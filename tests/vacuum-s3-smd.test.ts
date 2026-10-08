import { describe, expect, it } from 'vitest';
import { buildVacuumS3Smd, layoutVacuumS3Smd, SMD_PLACE, silkLabel } from '../src/core/examples/vacuum-s3/smd';
import { runDrc } from '../src/core/model/drc';
import { getWorld } from '../src/core/model/world';
import { pointInPolygon } from '../src/core/math/geom';

describe('пылесос S3 SMD: плата', () => {
  const p = layoutVacuumS3Smd(buildVacuumS3Smd());

  it('закреплённые детали стоят без перекрытий и на плате', () => {
    // Только закреплённые: остальные до отжига лежат рядами.
    const q = structuredClone(p);
    for (const [id, c] of Object.entries(q.components)) if (!SMD_PLACE[c.ref]) delete q.components[id];
    const bad = runDrc(q).markers.filter((m) => m.code === 'courtyard' || m.code === 'edge' || m.code === 'short');
    expect(bad.map((m) => m.message)).toEqual([]);
  });

  it('в сетевой зоне — только выводы 230 В', () => {
    const area = Object.values(p.ruleAreas).find((a) => a.onlyClasses?.includes('Mains'))!;
    const w = getWorld(p);
    const wrong = w.pads.filter((q) => q.net && SMD_PLACE[q.component.ref] && pointInPolygon(q.center, area.outline) && p.nets[q.net].netClass !== 'Mains').map((q) => `${q.component.ref}.${q.pad.name ?? q.pad.number}`);
    expect(wrong).toEqual([]);
  });

  it('подписи номиналов короткие', () => {
    expect(silkLabel('100 нФ')).toBe('100нФ');
    expect(silkLabel('1000 мкФ 25 В')).toBe('1000мкФ');
    expect(silkLabel('4,7k')).toBe('4k7');
    expect(silkLabel('~9 В с TV1')).toBe('~9В');
    expect(silkLabel('ESP32-S3-WROOM-1-N16R8')).toBe('ESP32-S3');
  });
});
