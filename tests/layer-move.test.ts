import { describe, expect, test } from 'vitest';
import { produce } from 'immer';
import { libraryFootprint } from '../src/core/library';
import { addComponent, addDrawing, addTrack, addZone, connectPad, ensureNet } from '../src/core/model/edit';
import { createProject } from '../src/core/model/project';
import { applyLayerMove, planLayerContent, planLayerMove } from '../src/core/model/layer-move';
import { getWorld } from '../src/core/model/world';
import { computeConnectivity } from '../src/core/model/connectivity';

function board() {
  const p = createProject({ width: 60, height: 40 });
  const tht = libraryFootprint('R_Axial_0.25W_L6.3mm_D2.5mm_P10.16mm_Horizontal')!;
  const r1 = addComponent(p, tht, { x: 10, y: 10 });
  const r2 = addComponent(p, tht, { x: 10, y: 30 });
  const a = ensureNet(p, 'A').id;
  connectPad(p, r1.id, '2', a);
  connectPad(p, r2.id, '2', a);
  const w = getWorld(p);
  const p1 = w.pads.find((x) => x.component.id === r1.id && x.pad.number === '2')!.center;
  const p2 = w.pads.find((x) => x.component.id === r2.id && x.pad.number === '2')!.center;
  // Две дорожки встык посередине, обе на верхнем слое.
  const t1 = addTrack(p, { layer: 'F.Cu', width: 0.3, points: [p1, { x: p1.x + 10, y: 20 }] });
  const t2 = addTrack(p, { layer: 'F.Cu', width: 0.3, points: [{ x: p1.x + 10, y: 20 }, p2] });
  return { p: structuredClone(p), t1: t1.id, t2: t2.id };
}

describe('перенос между слоями', () => {
  test('одна дорожка на другой слой — на стыке ставится переходное, цепь цела', () => {
    const { p, t1 } = board();
    const plan = planLayerMove(p, [{ kind: 'track', id: t1 }], 'flip');
    expect(plan.moves).toEqual([{ ref: { kind: 'track', id: t1 }, layer: 'B.Cu' }]);
    expect(plan.vias).toHaveLength(1);
    expect(plan.broken).toHaveLength(0);
    const q = produce(p, (d) => applyLayerMove(d, plan));
    expect(q.tracks[t1].layer).toBe('B.Cu');
    expect(Object.keys(q.vias)).toHaveLength(1);
    expect(computeConnectivity(q).unrouted).toBe(0);
  });

  test('обе дорожки вместе — переходное не нужно', () => {
    const { p, t1, t2 } = board();
    const plan = planLayerMove(p, [{ kind: 'track', id: t1 }, { kind: 'track', id: t2 }], 'B.Cu');
    expect(plan.moves).toHaveLength(2);
    expect(plan.vias).toHaveLength(0);
  });

  test('обмен слоёв меди: всё верхнее вниз, нижнее вверх; графика — на свою сторону', () => {
    const { p, t1, t2 } = board();
    const p2 = produce(p, (d) => {
      addZone(d, { layer: 'B.Cu', net: null, outline: [{ x: 30, y: 5 }, { x: 55, y: 5 }, { x: 55, y: 35 }, { x: 30, y: 35 }], clearance: 0.3, minWidth: 0.25, priority: 0 });
      addDrawing(d, { kind: 'line', layer: 'F.Silk', a: { x: 1, y: 1 }, b: { x: 5, y: 1 }, width: 0.15 });
    });
    const plan = planLayerContent(p2, 'F.Cu', 'B.Cu', true);
    const q = produce(p2, (d) => applyLayerMove(d, plan));
    expect(q.tracks[t1].layer).toBe('B.Cu');
    expect(q.tracks[t2].layer).toBe('B.Cu');
    expect(Object.values(q.zones)[0].layer).toBe('F.Cu');
    expect(Object.values(q.drawings)[0].layer).toBe('F.Silk');
    const flip = planLayerMove(q, [{ kind: 'drawing', id: Object.keys(q.drawings)[0] }], 'flip');
    expect(flip.moves[0].layer).toBe('B.Silk');
  });

  test('медь — только на медь платы, надпись — не на контур', () => {
    const p = createProject({ width: 40, height: 30, copperLayers: 1 });
    const t = addTrack(p, { layer: 'B.Cu', width: 0.5, points: [{ x: 5, y: 5 }, { x: 20, y: 5 }] });
    const txt = addDrawing(p, { kind: 'text', layer: 'F.Silk', at: { x: 5, y: 10 }, text: 'A', size: 1.5 });
    const q = structuredClone(p);
    expect(planLayerMove(q, [{ kind: 'track', id: t.id }], 'F.Cu').skipped).toBe(1);
    expect(planLayerMove(q, [{ kind: 'drawing', id: txt.id }], 'Edge.Cuts').skipped).toBe(1);
    expect(planLayerMove(q, [{ kind: 'drawing', id: txt.id }], 'F.Fab').moves).toHaveLength(1);
  });

  test('конец на планарной площадке прежнего слоя — соединение отмечается как порванное', () => {
    const p = createProject({ width: 40, height: 30 });
    const fp = libraryFootprint('R_0805_2012Metric')!;
    const r = addComponent(p, fp, { x: 10, y: 10 });
    const pad = getWorld(p).pads.find((x) => x.component.id === r.id && x.pad.number === '1')!.center;
    const t = addTrack(p, { layer: 'F.Cu', width: 0.3, points: [pad, { x: 25, y: 10 }] });
    const plan = planLayerMove(structuredClone(p), [{ kind: 'track', id: t.id }], 'B.Cu');
    expect(plan.broken).toHaveLength(1);
    expect(plan.vias).toHaveLength(0);
  });
});
