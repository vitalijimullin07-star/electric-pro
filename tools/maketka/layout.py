#!/usr/bin/env python3
"""Пылесос S3 на макетной плате: два этажа 55×35 отверстий (шаг 2,54), детали, переходы и провода.

Схема — та же, что у этажерки под лазер (выгрузка теста «выгрузка», STACK_DUMP): цепи берутся оттуда,
межплатные разъёмы этажерки (PT1, PT2, J2–J4, XS1) не нужны — их заменяют переходы между этажами.

    layout.py <выгрузка> <data.json>

Этажи (от лица к задней стенке): 1 — лицевой (экран, кнопки, энкодер, PCA9555), 2 — контроллер
(ESP32, модули, ULN2003, разъёмные клеммники по краям). Все детали сверху, провода снизу. Переход: на нижнем этаже —
длинные штыри (паяются снизу, как деталь), на верхнем — гнездо снизу платы (хвосты паяются сверху);
провод верхнего этажа приходит в соседнее отверстие, на лицевой стороне — капля припоя к хвосту гнезда.
"""
import heapq
import json
import math
import sys
from pathlib import Path

G = 2.54
COLS, ROWS = 55, 35
POWER = {'GND', '3V3', '5V'}
ROW_NAMES = [chr(ord('A') + i) for i in range(26)] + ['A' + chr(ord('A') + i) for i in range(ROWS - 26)]


def hole(c, r):
    return f'{ROW_NAMES[r - 1]}{c}'


def rot(x, y, deg):
    t = math.radians(deg)
    return x * math.cos(t) + y * math.sin(t), -x * math.sin(t) + y * math.cos(t)


# ------------------------------------------------------------------ исходная схема

def load_parts(dump):
    """Детали этажерки: ссылка → описание и выводы (логические цепи). Совпадающие обозначения пульта переименованы."""
    rename = {('panel', 'DD1'): 'DD3', ('panel', 'DD2'): 'DD4', ('panel', 'C1'): 'C51', ('panel', 'C2'): 'C52', ('panel', 'C3'): 'C53', ('panel', 'C4'): 'C54'}
    skip = {'PT1', 'PT2', 'J2', 'J3', 'J4', 'XS1', 'H1', 'H2', 'H3', 'H4'}
    parts = {}
    for b in ('upper', 'lower', 'panel'):
        for c in json.loads((dump / f'{b}.json').read_text())['comps']:
            if c['ref'] in skip:
                continue
            ref = rename.get((b, c['ref']), c['ref'])
            assert ref not in parts, ref
            parts[ref] = dict(c, ref=ref, src=b)
    return parts


def reference_nets(parts):
    """Цепь → множество (обозначение, вывод) по исходной схеме."""
    nets = {}
    for p in parts.values():
        for q in p['pins']:
            if q['net']:
                nets.setdefault(q['net'], set()).add((p['ref'], q['n']))
    return nets


# ------------------------------------------------------------------ корпуса на макетке

def terminal(n):
    """Разъёмный клеммник 5,08 угловой: выводы по +x, вилка и винты — к краю платы (−y)."""
    return {'pins': [{'n': str(i + 1), 'name': '', 'x': i * 5.08, 'y': 0} for i in range(n)], 'body': [-2.6, -9.0, (n - 1) * 5.08 + 2.6, 2.0], 'h': 12}


DEVKIT_LEFT = ['3V3', '3V3', 'RST', 'IO4', 'IO5', 'IO6', 'IO7', 'IO15', 'IO16', 'IO17', 'IO18', 'IO8', 'IO3', 'IO46', 'IO9', 'IO10', 'IO11', 'IO12', 'IO13', 'IO14', '5V', 'GND']
DEVKIT_RIGHT = ['GND', 'TX', 'RX', 'IO1', 'IO2', 'IO42', 'IO41', 'IO40', 'IO39', 'IO38', 'IO37', 'IO36', 'IO35', 'IO0', 'IO45', 'IO48', 'IO47', 'IO21', 'IO20', 'IO19', 'GND', 'GND']


def devkit(rows_mm):
    pins = [{'n': str(i + 1), 'name': n, 'x': 0, 'y': i * G} for i, n in enumerate(DEVKIT_LEFT)]
    pins += [{'n': str(23 + i), 'name': n, 'x': rows_mm, 'y': i * G} for i, n in enumerate(DEVKIT_RIGHT)]
    return {'pins': pins, 'body': [-1.27, -7.9, rows_mm + 1.27, 61.3], 'h': 16}


def pca(rows_mm):
    """PCA9555 на переходнике DIP-24 (ряды 600 или 800 mil): номера = выводы микросхемы."""
    names = ['INT', 'A1', 'A2', 'P00', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'GND', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'A0', 'SCL', 'SDA', 'VDD']
    h = rows_mm / 2
    pins = [{'n': str(i + 1), 'name': names[i], 'x': -h, 'y': -13.97 + i * G} for i in range(12)]
    pins += [{'n': str(13 + i), 'name': names[12 + i], 'x': h, 'y': 13.97 - i * G} for i in range(12)]
    return {'pins': pins, 'body': [-h - 1.3, -16.0, h + 1.3, 16.0], 'h': 6}


# ------------------------------------------------------------------ раскладка

# Этаж, место начала координат корпуса (столбец, ряд — от 1, можно дробное), поворот.
F1, F2 = 1, 2
FLOORS = (F1, F2)
PLACE = {
    # --- этаж 1, лицевой: экран посередине, по 3 кнопки по бокам, внизу энкодер, Т1, Т2, Выкл ---
    'HG1': (F1, 9.2047, 2.4094, 0),
    'SB1': (F1, 4.5, 6, 0), 'SB2': (F1, 4.5, 13, 0), 'SB3': (F1, 4.5, 20, 0),
    'SB4': (F1, 51.5, 6, 0), 'SB5': (F1, 51.5, 13, 0), 'SB6': (F1, 51.5, 20, 0),
    'SB7': (F1, 13.5, 30, 0), 'SB8': (F1, 20.5, 30, 0), 'SB9': (F1, 35.5, 30, 0),
    'SA1': (F1, 28, 30.05, 0),
    'DD3': (F1, 35.5, 16, 90),
    'BA1': (F1, 47.5, 30, 0),
    'HL1': (F1, 41.5, 32, 0),
    # --- этаж 2, контроллер: клеммники по краям, ESP32 антенной к левому краю, ULN2003 у реле, модули справа ---
    'X6': (F2, 6, 3, 0), 'X8': (F2, 13, 3, 0), 'X7': (F2, 22, 3, 0), 'X11': (F2, 27, 3, 0), 'X9': (F2, 32, 3, 0), 'XP1': (F2, 37, 3, 0),
    'X1': (F2, 16, 33, 180), 'X5': (F2, 27, 33, 180), 'X2': (F2, 38, 33, 180),
    'X3': (F2, 53, 6, 270), 'X10': (F2, 53, 15, 270), 'X4': (F2, 53, 24, 270),
    'DD1': (F2, 11.5, 6.5, 90),
    'A1': (F2, 4, 22, 90),
    'DA1': (F2, 30, 12, 0),
    'DD4': (F2, 41, 11, 0),
    'DD2': (F2, 45.5, 23, 0),
    'B1': (F2, 46.5, 29, 0),
}
# Порядок выводов клеммников (как на этажерке: подписи слева направо, если смотреть со стороны винтов).
TERMINALS = {'X6': 3, 'X8': 4, 'X7': 2, 'X11': 2, 'X9': 2, 'XP1': 2, 'X1': 6, 'X5': 5, 'X2': 5, 'X3': 4, 'X10': 4, 'X4': 4}

# Переход: этаж со штырями → этаж с гнездом, ряд штырей, первый столбец, куда отверстие под провод.
HEADERS = [
    {'id': 'П', 'low': F2, 'up': F1, 'row': 10, 'col': 10, 'n': 17, 'hdir': 1},
]
# Стойки M3 по углам (общие для всех этажей), отверстие под сверло 3,2 мм.
STANDOFFS = [(2, 2), (54, 2), (2, 34), (54, 34)]

# Мелочь: куда тянуть, если цепи только питания (подсказка), и ограничение высоты под экраном.
NEAR = {'C53': ('HG1', '1'), 'C54': ('DD3', '24'), 'C82': ('DD2', '1'), 'C13': ('B1', '3'), 'C1': ('XP1', '1'), 'C80': ('DA1', '1'), 'C81': ('DA1', '1')}
FLOOR_OF_SMALL = {
    F1: ['R4', 'R9', 'R10', 'R5', 'R6', 'C51', 'C52', 'C53', 'C54', 'VT1', 'R7', 'VD1', 'R8'],
    F2: ['C80', 'C81', 'R80', 'JP1', 'XA1', 'C82', 'C13', 'R27', 'R28', 'C14', 'C20', 'C21', 'C22', 'R42', 'C41', 'R44', 'C42', 'R70', 'R71', 'C26',
         'C1', 'R58', 'R61', 'R62', 'R64', 'R20', 'R21', 'R22', 'R23', 'R24', 'C23', 'R40', 'R41', 'R43', 'C40', 'R25', 'R26', 'C24', 'C25', 'R72', 'R73'],
}
# На макетке — вертикальные резисторы (шаг 2,54) и керамика 2,54: компактнее; диод — 7,62.
SMALL_FP = {
    'R_Axial_0.25W_L6.3mm_D2.5mm_P2.54mm_Vertical': 1, 'R_Axial_0.25W_L6.3mm_D2.5mm_P7.62mm_Horizontal': 1,
    'C_Disc_D5mm_W2.5mm_P2.5mm': 1, 'C_Disc_D6mm_W2.5mm_P5mm': 2, 'CP_Radial_D5mm_P2mm': 1, 'PinHeader_1x02_P2.54mm': 1,
    'D_DO-35_P7.62mm_Horizontal': 3, 'Q_S8050_TO-92_Wide': 1, 'LED_D3.0mm': 1,
}


class Layout:
    def __init__(self, parts, devkit_mm, pca_mm):
        self.parts = parts
        self.devkit_mm = devkit_mm
        self.pca_mm = pca_mm
        self.placed = {}  # ref → {floor, pins:[{n,name,net,c,r}], body:[c0,r0,c1,r1], h, under}
        self.occ = {f: {} for f in FLOORS}  # (c, r) → ref (лицевая сторона: выводы и корпуса)
        self.warn = []

    # --- корпус детали на макетке
    def fp(self, ref):
        p = self.parts[ref]
        if ref == 'A1':
            return devkit(self.devkit_mm)
        if ref == 'DD3':
            return pca(self.pca_mm)
        if ref in TERMINALS:
            return terminal(TERMINALS[ref])
        # Лапки крепления энкодера (MP) — не выводы: под них рассверлить.
        pins = [{'n': q['n'], 'name': q['name'], 'x': q['x'], 'y': q['y']} for q in p['pins'] if q['name'] != 'MP']
        crt = p['crt'] or [[-1, -1], [1, 1]]
        return {'pins': pins, 'body': [crt[0][0], crt[0][1], crt[1][0], crt[1][1]], 'h': p['h'] or 3}

    def net_of(self, ref, n):
        for q in self.parts[ref]['pins']:
            if q['n'] == n:
                return q['net']
        return None

    def place(self, ref, floor, c0, r0, deg, fp=None):
        fp = fp or self.fp(ref)
        pins = []
        for q in fp['pins']:
            dx, dy = rot(q['x'] / G, q['y'] / G, deg)
            c, r = c0 + dx, r0 + dy
            ci, ri = round(c), round(r)
            err = math.hypot(c - ci, r - ri) * G
            if err > 0.8:
                self.warn.append(f'{ref}.{q["n"]}: не на сетке ({err:.2f} мм)')
            pins.append({'n': q['n'], 'name': q['name'], 'net': self.net_of(ref, q['n']), 'c': ci, 'r': ri, 'err': round(err, 2)})
        b = fp['body']
        xs, ys = [], []
        for x in (b[0], b[2]):
            for y in (b[1], b[3]):
                dx, dy = rot(x / G, y / G, deg)
                xs.append(c0 + dx)
                ys.append(r0 + dy)
        body = [min(xs), min(ys), max(xs), max(ys)]
        self.placed[ref] = {'floor': floor, 'pins': pins, 'body': body, 'h': fp['h'], 'deg': deg, 'at': [c0, r0]}
        return self.placed[ref]

    def mark(self, ref, under=False):
        """Занятые отверстия: выводы и всё под корпусом (кроме экрана — под ним можно низкие детали)."""
        pl = self.placed[ref]
        o = self.occ[pl['floor']]
        for q in pl['pins']:
            o[(q['c'], q['r'])] = ref
        if not under:
            c0, r0, c1, r1 = pl['body']
            for c in range(math.ceil(c0 - 0.3), math.floor(c1 + 0.3) + 1):
                for r in range(math.ceil(r0 - 0.3), math.floor(r1 + 0.3) + 1):
                    o.setdefault((c, r), ref)

    def reserve(self, floor, cells, tag):
        for cell in cells:
            self.occ[floor].setdefault(cell, tag)

    def build(self):
        # Крупные детали — по таблице. Для этажа 2 и 1 сначала занимаем места обоих вариантов рядов.
        for ref, (f, c, r, d) in PLACE.items():
            self.place(ref, f, c, r, d)
            self.mark(ref, under=(ref == 'HG1'))
        for alt in ((25.4 if self.devkit_mm == 22.86 else 22.86),):
            saved = self.placed['A1']
            self.devkit_mm, keep = alt, self.devkit_mm
            self.place('A1', *PLACE['A1'])
            self.mark('A1')
            self.devkit_mm = keep
            self.placed['A1'] = saved
        for alt in ((15.24 if self.pca_mm == 20.32 else 20.32),):
            saved = self.placed['DD3']
            self.pca_mm, keep = alt, self.pca_mm
            self.place('DD3', *PLACE['DD3'])
            self.mark('DD3')
            self.pca_mm = keep
            self.placed['DD3'] = saved
        # Стойки (3×3 отверстия), отверстия под стойки экрана (сверло 3,2 мм — по кругу 1,5 отв.), антенна.
        for f in FLOORS:
            for (c, r) in STANDOFFS:
                self.reserve(f, [(c + i, r + j) for i in (-1, 0, 1) for j in (-1, 0, 1)], 'стойка')
        hg = self.placed['HG1']
        self.display_holes = []
        for (x, y) in ((3.0, 3.42), (95.0, 3.42), (3.0, 52.92), (95.0, 52.92)):
            c, r = hg['at'][0] + x / G, hg['at'][1] + y / G
            self.display_holes.append((c, r))
            self.reserve(F1, [(cc, rr) for cc in range(math.floor(c - 1.2), math.ceil(c + 1.2) + 1) for rr in range(math.floor(r - 1.2), math.ceil(r + 1.2) + 1) if math.hypot(cc - c, rr - r) < 1.5], 'стойка экрана')
        # Энкодер: лапки крепления — рассверлить (между отверстиями).
        sa = self.placed['SA1']
        self.encoder_tabs = [(sa['at'][0] - 5.6 / G, sa['at'][1]), (sa['at'][0] + 5.6 / G, sa['at'][1])]
        for (c, r) in self.encoder_tabs:
            self.reserve(F1, [(math.floor(c), round(r)), (math.ceil(c), round(r))], 'лапка энкодера')
        # Переходы: ряд штырей (T) и соседний ряд под провод (H) — свободны на обоих этажах.
        for h in HEADERS:
            for i in range(h['n']):
                c = h['col'] + i
                for f in (h['low'], h['up']):
                    self.reserve(f, [(c, h['row'])], h['id'])
                self.reserve(h['up'], [(c, h['row'] + h['hdir'])], h['id'] + ' провод')
        # Мелочь — жадно, ближе к своим цепям.
        for f, refs in FLOOR_OF_SMALL.items():
            order = sorted(refs, key=lambda x: (all(q['net'] in POWER for q in self.parts[x]['pins'] if q['net']), x))
            for ref in order:
                self.place_small(ref, f)

    def pads_of(self, floor, net, skip=None):
        out = []
        for ref, pl in self.placed.items():
            if pl['floor'] != floor or ref == skip:
                continue
            for q in pl['pins']:
                if q['net'] == net:
                    out.append((q['c'], q['r']))
        return out

    def place_small(self, ref, floor):
        p = self.parts[ref]
        span = SMALL_FP.get(p['fid'], 1)
        pins = [q for q in p['pins']]
        n = len(pins)
        targets = []
        for q in pins:
            if q['net'] and q['net'] not in POWER:
                pads = self.pads_of(floor, q['net'])
                if pads:
                    targets.append((q['net'], pads, 1.0))
        if ref in NEAR:
            tr, tp = NEAR[ref]
            if tr in self.placed:
                tq = [q for q in self.placed[tr]['pins'] if q['n'] == tp][0]
                targets.append(('near', [(tq['c'], tq['r'])], 1.5))
        if not targets:
            for q in pins:
                if q['net']:
                    pads = self.pads_of(floor, q['net'])
                    if pads:
                        targets.append((q['net'], pads, 0.2))
        best = None
        o = self.occ[floor]
        hg = self.placed['HG1']
        pin_cells = {(q['c'], q['r']) for pl in self.placed.values() if pl['floor'] == floor for q in pl['pins']}
        # Под корпусами и вплотную к ним мелочь не ставим (кроме экрана — под ним низкие детали можно).
        body_cells = set()
        for ref2, pl in self.placed.items():
            if pl['floor'] != floor or ref2 == 'HG1':
                continue
            c0, r0, c1, r1 = pl['body']
            body_cells |= {(c, r) for c in range(math.floor(c0 - 0.2), math.ceil(c1 + 0.2) + 1) for r in range(math.floor(r0 - 0.2), math.ceil(r1 + 0.2) + 1)}
        for r in range(2, ROWS):
            for c in range(2, COLS):
                for horiz in (True, False):
                    if n == 3:
                        cells = [(c + i, r) for i in range(3)] if horiz else [(c, r + i) for i in range(3)]
                    else:
                        cells = [(c, r), (c + span, r)] if horiz else [(c, r), (c, r + span)]
                    if any(not (1 <= cc <= COLS and 1 <= rr <= ROWS) for cc, rr in cells):
                        continue
                    # Свободно само место, и рядом нет чужих выводов (между деталями — хотя бы одно пустое отверстие).
                    ring = {(cc + dc, rr + dr) for cc, rr in cells for dc in (-1, 0, 1) for dr in (-1, 0, 1)} - set(cells)
                    if any(cell in o for cell in cells) or any(cell in pin_cells for cell in ring):
                        continue
                    if any(cell in body_cells for cell in cells):
                        continue
                    # Высокие (электролиты, транзистор) — и соседние отверстия не под чужим корпусом.
                    if (p['h'] or 0) > 6 and any(cell in body_cells for cell in ring):
                        continue
                    # Под экраном — только низкие (до 8 мм): электролиты и транзистор не ставим.
                    under = hg['body'][0] - 0.5 <= c <= hg['body'][2] + 0.5 and hg['body'][1] - 0.5 <= r <= hg['body'][3] + 0.5 and floor == F1
                    if under and (p['h'] or 0) > 8:
                        continue
                    cost = 0.0
                    for i, q in enumerate(pins):
                        pc, pr = cells[i] if n <= len(cells) else cells[-1]
                        for net, pads, w in targets:
                            if net != 'near' and q['net'] != net:
                                continue
                            d = min(math.hypot(pc - a, pr - b) for a, b in pads)
                            cost += w * d
                    cost += 0.01 * (abs(c - COLS / 2) + abs(r - ROWS / 2))
                    if best is None or cost < best[0]:
                        best = (cost, cells, horiz)
        if best is None:
            raise RuntimeError(f'{ref}: нет места на этаже {floor}')
        _, cells, horiz = best
        placed_pins = []
        for i, q in enumerate(pins):
            cc, rr = cells[i] if n == 3 else cells[min(i, 1)]
            placed_pins.append({'n': q['n'], 'name': q['name'], 'net': q['net'], 'c': cc, 'r': rr, 'err': 0})
        c0 = min(cc for cc, _ in cells)
        r0 = min(rr for _, rr in cells)
        c1 = max(cc for cc, _ in cells)
        r1 = max(rr for _, rr in cells)
        self.placed[ref] = {'floor': floor, 'pins': placed_pins, 'body': [c0 - 0.45, r0 - 0.45, c1 + 0.45, r1 + 0.45], 'h': p['h'] or 3, 'deg': 0 if horiz else 90, 'at': [c0, r0]}
        for cell in cells:
            o[cell] = ref

    # --- переходы и провода
    def floors_of(self, net):
        return {pl['floor'] for pl in self.placed.values() for q in pl['pins'] if q['net'] == net}

    def connect(self):
        nets = sorted({q['net'] for pl in self.placed.values() for q in pl['pins'] if q['net']})
        cross = {}
        for net in nets:
            fl = self.floors_of(net)
            # Переход между соседними этажами k и k−1 нужен, если цепь есть и выше, и ниже этой границы.
            for k in FLOORS[1:]:
                if any(x >= k for x in fl) and any(x <= k - 1 for x in fl):
                    cross.setdefault((k, k - 1), []).append(net)
        self.trans = []  # {hid, low, up, net, c, r, hc, hr}
        for (low, up), lst in cross.items():
            hdrs = [h for h in HEADERS if h['low'] == low and h['up'] == up]
            extra = ['GND']
            slots = []
            for h in hdrs:
                for i in range(h['n']):
                    slots.append((h, h['col'] + i))
            # Цепь → место: ближе всего к её выводам на обоих этажах (сначала сигналы, потом питание).
            want = [n for n in lst if n not in POWER] + [n for n in lst if n in POWER] + extra
            taken = set()
            for net in want:
                pads = self.pads_of(up, net) + self.pads_of(low, net)
                best = None
                for h, c in slots:
                    if (h['id'], c) in taken:
                        continue
                    d = sum(min(math.hypot(c - a, h['row'] - b) for a, b in [p]) for p in pads) / max(1, len(pads))
                    if best is None or d < best[0]:
                        best = (d, h, c)
                if best is None:
                    raise RuntimeError(f'не хватает переходов {low}→{up}: {net}')
                _, h, c = best
                taken.add((h['id'], c))
                self.trans.append({'hid': h['id'], 'low': low, 'up': up, 'net': net, 'c': c, 'r': h['row'], 'hc': c, 'hr': h['row'] + h['hdir']})
            self.trans.sort(key=lambda t: (t['hid'], t['c']))
        # Провода: по этажам и цепям — кратчайшее дерево между выводами, штырями и отверстиями «провод» гнёзд.
        self.wires = []
        internal = {('A1', 'GND'): ['22', '23', '43', '44'], ('A1', '3V3'): ['1', '2'], ('DA1', 'GND'): ['7', '10']}
        for f in FLOORS:
            for net in nets:
                nodes = []
                for ref, pl in self.placed.items():
                    if pl['floor'] != f:
                        continue
                    seen_group = set()
                    for q in pl['pins']:
                        if q['net'] != net:
                            continue
                        grp = internal.get((ref, net))
                        if grp and q['n'] in grp:
                            if 'g' in seen_group:
                                continue
                            seen_group.add('g')
                        nodes.append({'ref': ref, 'pin': q['n'], 'name': q['name'], 'c': q['c'], 'r': q['r']})
                for t in self.trans:
                    if t['net'] != net:
                        continue
                    if t['low'] == f:
                        nodes.append({'ref': t['hid'], 'pin': str(t['c'] - [h for h in HEADERS if h['id'] == t['hid']][0]['col'] + 1), 'name': 'штырь', 'c': t['c'], 'r': t['r']})
                    if t['up'] == f:
                        nodes.append({'ref': t['hid'], 'pin': str(t['c'] - [h for h in HEADERS if h['id'] == t['hid']][0]['col'] + 1), 'name': 'гнездо (провод в соседнее)', 'c': t['hc'], 'r': t['hr']})
                if len(nodes) < 2:
                    continue
                for a, b in mst(nodes):
                    na, nb = nodes[a], nodes[b]
                    d = math.hypot(na['c'] - nb['c'], na['r'] - nb['r']) * G
                    length = int(math.ceil((d * 1.15 + 15) / 5) * 5)
                    self.wires.append({'floor': f, 'net': net, 'a': na, 'b': nb, 'len': length, 'id': f'{f}:{net}:{na["ref"]}.{na["pin"]}-{nb["ref"]}.{nb["pin"]}'})

    def check(self, ref_nets):
        """Каждая цепь макетки = цепь схемы, все выводы связаны проводами и переходами."""
        got = {}
        for ref, pl in self.placed.items():
            for q in pl['pins']:
                if q['net']:
                    got.setdefault(q['net'], set()).add((ref, q['n']))
        problems = []
        for net in set(got) | set(ref_nets):
            a = got.get(net, set())
            b = ref_nets.get(net, set())
            # У гнёзд этажерки ESP32 был запасной ряд 45–66 — в схеме он лишний.
            b = {x for x in b if not (x[0] == 'A1' and int(x[1]) > 44)}
            if a != b:
                problems.append(f'{net}: макетка {sorted(a - b)}, схема {sorted(b - a)}')
        # Связность: узлы — выводы (этаж, отверстие), рёбра — провода, внутренние связи, переходы.
        parent = {}

        def find(x):
            parent.setdefault(x, x)
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            parent[find(a)] = find(b)

        for w in self.wires:
            union((w['floor'], w['a']['c'], w['a']['r']), (w['floor'], w['b']['c'], w['b']['r']))
        for t in self.trans:
            union((t['low'], t['c'], t['r']), (t['up'], t['c'], t['r']))
            union((t['up'], t['c'], t['r']), (t['up'], t['hc'], t['hr']))
        for (ref, net), grp in {('A1', 'GND'): ['22', '23', '43', '44'], ('A1', '3V3'): ['1', '2'], ('DA1', 'GND'): ['7', '10']}.items():
            pl = self.placed[ref]
            cells = [(pl['floor'], q['c'], q['r']) for q in pl['pins'] if q['n'] in grp]
            for x in cells[1:]:
                union(cells[0], x)
        for net in got:
            roots = {find((self.placed[ref]['floor'], q['c'], q['r'])) for ref, pl in self.placed.items() for q in pl['pins'] if q['net'] == net}
            if len(roots) != 1:
                problems.append(f'{net}: не связана ({len(roots)} частей)')
        # Разные цепи не должны встретиться в одном отверстии.
        for f in FLOORS:
            used = {}
            for ref, pl in self.placed.items():
                if pl['floor'] != f:
                    continue
                for q in pl['pins']:
                    k = (q['c'], q['r'])
                    if k in used and used[k] != (ref, q['n']):
                        problems.append(f'этаж {f}, {hole(*k)}: {used[k]} и {ref}.{q["n"]} в одном отверстии')
                    used[k] = (ref, q['n'])
            for t in self.trans:
                for (ff, c, r) in ((t['low'], t['c'], t['r']), (t['up'], t['c'], t['r']), (t['up'], t['hc'], t['hr'])):
                    if ff == f and (c, r) in used:
                        problems.append(f'этаж {f}, {hole(c, r)}: переход {t["hid"]} попал на вывод {used[(c, r)]}')
        return problems


def mst(nodes):
    n = len(nodes)
    inside = [False] * n
    dist = [math.inf] * n
    prev = [-1] * n
    dist[0] = 0
    edges = []
    heap = [(0, 0)]
    while heap:
        d, i = heapq.heappop(heap)
        if inside[i]:
            continue
        inside[i] = True
        if prev[i] >= 0:
            edges.append((prev[i], i))
        for j in range(n):
            if not inside[j]:
                dd = math.hypot(nodes[i]['c'] - nodes[j]['c'], nodes[i]['r'] - nodes[j]['r'])
                if dd < dist[j]:
                    dist[j] = dd
                    prev[j] = i
                    heapq.heappush(heap, (dd, j))
    return edges


def main():
    dump, out = Path(sys.argv[1]), Path(sys.argv[2])
    parts = load_parts(dump)
    ref_nets = reference_nets(parts)
    variants = {}
    for dk in (22.86, 25.4):
        for pc in (20.32, 15.24):
            lay = Layout(parts, dk, pc)
            lay.build()
            lay.connect()
            probs = lay.check(ref_nets)
            key = f'{dk}/{pc}'
            print(key, 'деталей', len(lay.placed), 'проводов', len(lay.wires), 'переходов', len(lay.trans), 'замечаний', len(lay.warn), 'ошибок', len(probs))
            for w in lay.warn[:10]:
                print('   !', w)
            for p in probs[:30]:
                print('   ✗', p)
            if probs:
                sys.exit(1)
            variants[key] = {
                'placed': lay.placed,
                'trans': lay.trans,
                'wires': lay.wires,
                'displayHoles': lay.display_holes,
                'encoderTabs': lay.encoder_tabs,
                'warn': lay.warn,
            }
    info = {ref: {'value': p['value'], 'desc': p['description'], 'fid': p['fid'], 'src': p['src']} for ref, p in parts.items()}
    out.write_text(json.dumps({'variants': variants, 'parts': info, 'headers': HEADERS, 'standoffs': STANDOFFS, 'rows': ROW_NAMES, 'cols': COLS, 'nrows': ROWS}, ensure_ascii=False))


if __name__ == '__main__':
    main()
