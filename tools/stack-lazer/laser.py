#!/usr/bin/env python3
"""Файлы для лазера (выжигание краски с меди) из выгрузки теста (STACK_DUMP, <плата>.json).
Нужны shapely 2, ezdxf, pillow.

Для каждой стороны: область выжигания = плата − медь (+ точки под сверло в площадках),
нижняя сторона зеркально (лазер смотрит на медь), верхняя — как есть. Картинка = ровно
габарит платы, левый верхний угол = угол платы.

Выход: PNG 1000 dpi (1 бит, чёрное — жечь), SVG (чёрная заливка — жечь, красная линия —
контур платы), DXF (слой BURN — жечь, CUT — контур), и PNG «изоляция» (жечь только полосу
0,8 мм вокруг меди — в 3–5 раз быстрее, остальная медь остаётся пустыми островками).
"""
import json
import sys
from pathlib import Path

import ezdxf
from PIL import Image, ImageDraw
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import unary_union
from shapely import affinity

DPI = 1000
PX = DPI / 25.4
ISO = 0.8


def prim_geom(pr):
    k = pr['k']
    if k == 'path':
        pts = pr['pts']
        if pr.get('closed') and len(pts) > 2:
            pts = pts + [pts[0]]
        if len(pts) == 1:
            return Point(pts[0]).buffer(pr['w'] / 2, quad_segs=12)
        return LineString(pts).buffer(pr['w'] / 2, quad_segs=12, cap_style='round', join_style='round')
    if k == 'region':
        return Polygon(pr['pts']).buffer(0)
    if k == 'fill':
        g = None
        for loop in pr['loops']:
            if len(loop) < 3:
                continue
            q = Polygon(loop).buffer(0)
            g = q if g is None else g.symmetric_difference(q)
        return g
    pts, r = pr['pts'], pr['r']
    if len(pts) == 1:
        return Point(pts[0]).buffer(r, quad_segs=16)
    if len(pts) == 2:
        return LineString(pts).buffer(r, quad_segs=16)
    poly = Polygon(pts)
    return poly.buffer(r, quad_segs=16, join_style='round') if r > 0 else poly.buffer(0)


def polys(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [x for x in getattr(g, 'geoms', []) if isinstance(x, Polygon)]


def side_geometry(d, layer, mirror, iso=False):
    board = Polygon(d['outline']).buffer(0)
    minx, miny, maxx, maxy = board.bounds
    copper = unary_union([g for g in (prim_geom(p) for p in d['layers'][layer]) if g is not None and not g.is_empty])
    copper = copper.intersection(board)
    if iso:
        burn = copper.buffer(ISO, quad_segs=8).difference(copper).intersection(board)
        # Под антенной ESP32 и у стоек — меди не остаётся совсем.
        forced = [Polygon(k['pts']).buffer(0) for k in d['keepouts'] if k['layers'] is None or layer in k['layers']]
        if forced:
            burn = unary_union([burn] + [f.intersection(board).difference(copper) for f in forced])
    else:
        burn = board.difference(copper)
    dots = []
    keep = []
    for h in d['holes']:
        c = Point(h['x'], h['y'])
        if h['npth']:
            keep.append(c.buffer(0.4, quad_segs=8))
        elif copper.contains(c):
            dots.append(c.buffer(min(0.4, max(0.25, h['d'] / 3)), quad_segs=8))
    if dots:
        burn = unary_union([burn] + dots)
    if keep:
        burn = burn.difference(unary_union(keep))
    # Линия контура (0,2 мм внутри края) — по ней резать.
    edge = board.exterior.buffer(0.1, quad_segs=4).intersection(board.buffer(-0.0))
    burn = unary_union([burn, edge.intersection(board)])
    # В координаты картинки: левый верхний угол = (minx, miny); нижняя сторона — зеркально.
    if mirror:
        burn = affinity.scale(burn, xfact=-1, yfact=1, origin=((minx + maxx) / 2, 0))
        board_m = affinity.scale(board, xfact=-1, yfact=1, origin=((minx + maxx) / 2, 0))
    else:
        board_m = board
    burn = affinity.translate(burn, -minx, -miny)
    board_m = affinity.translate(board_m, -minx, -miny)
    return burn, board_m, (maxx - minx, maxy - miny)


def write_png(burn, size, path):
    w, h = size
    W, H = round(w * PX), round(h * PX)
    img = Image.new('1', (W, H), 1)
    dr = ImageDraw.Draw(img)
    for poly in sorted(polys(burn), key=lambda q: -Polygon(q.exterior).area):
        dr.polygon([(x * PX, y * PX) for x, y in poly.exterior.coords], fill=0)
        for ring in poly.interiors:
            dr.polygon([(x * PX, y * PX) for x, y in ring.coords], fill=1)
    img.save(path, dpi=(DPI, DPI), optimize=True)


def ring_d(coords):
    pts = list(coords)
    return 'M' + 'L'.join(f'{x:.3f} {y:.3f}' for x, y in pts[:-1]) + 'Z'


def write_svg(burn, board, size, path, title):
    w, h = size
    d = ''.join(ring_d(p.exterior.coords) + ''.join(ring_d(r.coords) for r in p.interiors) for p in polys(burn))
    out = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.3f}mm" height="{h:.3f}mm" viewBox="0 0 {w:.3f} {h:.3f}">\n'
        f'<title>{title}</title>\n'
        f'<path d="{d}" fill="#000000" fill-rule="evenodd" stroke="none"/>\n'
        f'<path d="{ring_d(board.exterior.coords)}" fill="none" stroke="#ff0000" stroke-width="0.1"/>\n'
        '</svg>\n'
    )
    Path(path).write_text(out, encoding='utf-8')


def write_dxf(burn, board, path):
    doc = ezdxf.new('R2010', setup=False)
    doc.units = ezdxf.units.MM
    doc.header['$INSUNITS'] = 4
    doc.layers.add('BURN', color=7)
    doc.layers.add('CUT', color=1)
    msp = doc.modelspace()
    # DXF — ось Y вверх: переворачиваем, чтобы картинка не была вверх ногами.
    _, _, _, h = board.bounds

    def add(coords, layer):
        msp.add_lwpolyline([(x, h - y) for x, y in list(coords)[:-1]], close=True, dxfattribs={'layer': layer})

    for p in polys(burn):
        add(p.exterior.coords, 'BURN')
        for r in p.interiors:
            add(r.coords, 'BURN')
    add(board.exterior.coords, 'CUT')
    doc.saveas(path)


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    jobs = [
        ('upper', 'B.Cu', True, 'verhnyaya-plata_med-snizu_ZERKALNO'),
        ('lower', 'B.Cu', True, 'nizhnyaya-plata_med-snizu_ZERKALNO'),
        ('panel', 'B.Cu', True, 'pult_niz-storona-paiki_ZERKALNO'),
        ('panel', 'F.Cu', False, 'pult_verh-storona-detalei'),
    ]
    for board, layer, mirror, name in jobs:
        d = json.loads((src / f'{board}.json').read_text())
        burn, outline, size = side_geometry(d, layer, mirror)
        write_png(burn, size, out / f'{name}_1000dpi.png')
        write_svg(burn, outline, size, out / f'{name}.svg', name)
        write_dxf(burn, outline, out / f'{name}.dxf')
        iso, _, _ = side_geometry(d, layer, mirror, iso=True)
        write_png(iso, size, out / f'{name}_izolyaciya_1000dpi.png')
        full_area = sum(p.area for p in polys(burn))
        iso_area = sum(p.area for p in polys(iso))
        print(f'{name}: {size[0]:.1f}×{size[1]:.1f} мм, жечь {full_area:.0f} мм² (изоляция {iso_area:.0f} мм²)')


if __name__ == '__main__':
    main()
