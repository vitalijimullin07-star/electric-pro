import { describe, expect, test } from 'vitest';
import { produce } from 'immer';
import { libraryFootprint } from '../src/core/library';
import { addComponent, addTrack, addWire, connectPad, ensureNet } from '../src/core/model/edit';
import { createProject } from '../src/core/model/project';
import { applyFollow, planFollow, simplifyPath } from '../src/core/model/follow';
import { getWorld } from '../src/core/model/world';
import { computeConnectivity } from '../src/core/model/connectivity';

function board() {
  const p = createProject({ width: 60, height: 40 });
  const fp = libraryFootprint('R_0805_2012Metric')!;
  const r1 = addComponent(p, fp, { x: 10, y: 10 });
  const r2 = addComponent(p, fp, { x: 30, y: 10 });
  const a = ensureNet(p, 'A').id;
  connectPad(p, r1.id, '2', a);
  connectPad(p, r2.id, '1', a);
  const w = getWorld(p);
  const p1 = w.pads.find((x) => x.component.id === r1.id && x.pad.number === '2')!.center;
  const p2 = w.pads.find((x) => x.component.id === r2.id && x.pad.number === '1')!.center;
  const t = addTrack(p, { layer: 'F.Cu', width: 0.25, points: [p1, { x: 20, y: 10 }, p2] });
  return { p: structuredClone(p), r1: r1.id, r2: r2.id, t: t.id };
}

describe('дорожки за компонентом', () => {
  test('перенос одного компонента: конец едет с площадкой, излом 45°, цепь не рвётся', () => {
    const { p, r2, t } = board();
    const plan = planFollow(p, [{ kind: 'component', id: r2 }])!;
    expect(plan.anchors).toHaveLength(1);
    const q = produce(p, (d) => {
      d.components[r2].at = { x: 30, y: 16 };
      applyFollow(d, p, plan, { translate: { x: 0, y: 6 } });
    });
    const pts = q.tracks[t].points;
    const end = pts[pts.length - 1];
    const pad = getWorld(q).pads.find((x) => x.component.id === r2 && x.pad.number === '1')!.center;
    expect(end).toEqual({ x: +pad.x.toFixed(4), y: +pad.y.toFixed(4) });
    expect(pts[0]).toEqual(p.tracks[t].points[0]);
    // Все отрезки — по осям или под 45°.
    for (let i = 0; i + 1 < pts.length; i++) {
      const dx = Math.abs(pts[i + 1].x - pts[i].x);
      const dy = Math.abs(pts[i + 1].y - pts[i].y);
      expect(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6).toBe(true);
    }
    expect(computeConnectivity(q).unrouted).toBe(0);
  });

  test('оба конца на переносимых деталях — дорожка переносится целиком', () => {
    const { p, r1, r2, t } = board();
    const plan = planFollow(p, [{ kind: 'component', id: r1 }, { kind: 'component', id: r2 }])!;
    expect(plan.whole.has('track:' + t)).toBe(true);
    const q = produce(p, (d) => {
      d.components[r1].at = { x: 15, y: 13 };
      d.components[r2].at = { x: 35, y: 13 };
      applyFollow(d, p, plan, { translate: { x: 5, y: 3 } });
    });
    expect(q.tracks[t].points).toEqual(p.tracks[t].points.map((v) => ({ x: +(v.x + 5).toFixed(4), y: +(v.y + 3).toFixed(4) })));
  });

  test('поворот: конец остаётся на площадке', () => {
    const { p, r2, t } = board();
    const plan = planFollow(p, [{ kind: 'component', id: r2 }])!;
    const q = produce(p, (d) => {
      d.components[r2].rotation = 90;
      applyFollow(d, p, plan);
    });
    const pad = getWorld(q).pads.find((x) => x.component.id === r2 && x.pad.number === '1')!.center;
    const end = q.tracks[t].points[q.tracks[t].points.length - 1];
    expect(Math.hypot(end.x - pad.x, end.y - pad.y)).toBeLessThan(1e-3);
    expect(computeConnectivity(q).unrouted).toBe(0);
  });

  test('перемычка едет за площадкой, выделенная дорожка не трогается планом', () => {
    const { p, r2, t } = board();
    const pad = getWorld(p).pads.find((x) => x.component.id === r2 && x.pad.number === '2')!.center;
    const p2 = produce(p, (d) => void addWire(d, pad, { x: 50, y: 30 }));
    const plan = planFollow(p2, [{ kind: 'component', id: r2 }, { kind: 'track', id: t }])!;
    expect(plan.anchors.map((a) => a.kind)).toEqual(['wire']);
    const wid = Object.keys(p2.wires)[0];
    const q = produce(p2, (d) => {
      d.components[r2].at = { x: 31, y: 10 };
      applyFollow(d, p2, plan, { translate: { x: 1, y: 0 } });
    });
    expect(q.wires[wid].a.x).toBeCloseTo(pad.x + 1, 4);
    expect(q.wires[wid].b).toEqual({ x: 50, y: 30 });
  });

  test('упрощение ломаной: повторы и точки на прямой убираются', () => {
    expect(simplifyPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }])).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }]);
  });
});
