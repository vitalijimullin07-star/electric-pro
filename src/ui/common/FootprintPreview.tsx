import { useMemo } from 'react';
import type { FootprintDef } from '@core/model/types';
import { graphicPrims, type LayerPrims } from '@core/render/flatten';
import { padLocalShape, footprintBounds } from '@core/model/placement';
import { shapeOutline } from '@core/math/shape';
import { LAYERS } from '@core/model/layers';

const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Маленький рисунок корпуса в SVG для библиотеки и свойств. */
export function FootprintPreview({ fp, className = 'fp-preview' }: { fp: FootprintDef; className?: string }) {
  const svg = useMemo(() => {
    const b = footprintBounds(fp);
    const pad = 1;
    const x0 = b.min.x - pad;
    const y0 = b.min.y - pad;
    const w = b.max.x - b.min.x + 2 * pad;
    const h = b.max.y - b.min.y + 2 * pad;
    const prims: LayerPrims = {};
    for (const g of fp.graphics) graphicPrims(g, null, { id: '', ref: fp.refPrefix ?? 'X', value: '', footprint: fp.id, at: { x: 0, y: 0 }, rotation: 0, side: 'top', padNets: {} }, prims);
    let s = '';
    for (const layer of ['F.Courtyard', 'F.Fab', 'F.Silk'] as const) {
      const col = layer === 'F.Fab' ? '#7d8795' : layer === 'F.Courtyard' ? '#3a4652' : LAYERS[layer].color;
      for (const pr of prims[layer] ?? []) {
        if (pr.kind === 'path') s += `<path d="${pr.pts.map((q, i) => `${i ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`).join('')}${pr.closed ? 'Z' : ''}" fill="none" stroke="${col}" stroke-width="${f(Math.max(pr.width, w / 300))}" stroke-linecap="round" stroke-linejoin="round"/>`;
        else if (pr.kind === 'region') s += `<polygon points="${pr.pts.map((q) => `${f(q.x)},${f(q.y)}`).join(' ')}" fill="${col}"/>`;
      }
    }
    for (const p of fp.pads) {
      const sh = padLocalShape(p);
      const col = p.type === 'npth' ? '#0d1014' : p.type === 'tht' ? '#d9c27a' : '#e8b061';
      if (sh.pts.length === 1) s += `<circle cx="${f(sh.pts[0].x)}" cy="${f(sh.pts[0].y)}" r="${f(sh.r)}" fill="${col}"/>`;
      else s += `<polygon points="${shapeOutline(sh, 0.05).map((q) => `${f(q.x)},${f(q.y)}`).join(' ')}" fill="${col}"/>`;
      if (p.drill) s += `<circle cx="${f(p.at.x)}" cy="${f(p.at.y)}" r="${f(p.drill / 2)}" fill="#0d1014"/>`;
      if (p.type !== 'npth' && fp.pads.length <= 40) {
        const fs = Math.min(p.size.x, p.size.y) * 0.55;
        s += `<text x="${f(p.at.x)}" y="${f(p.at.y + fs * 0.35)}" font-size="${f(fs)}" text-anchor="middle" fill="#12161b" font-family="system-ui,sans-serif" font-weight="600">${p.number}</text>`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" preserveAspectRatio="xMidYMid meet">${s}</svg>`;
  }, [fp]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}
