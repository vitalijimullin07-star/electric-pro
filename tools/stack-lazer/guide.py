#!/usr/bin/env python3
"""Памятка «Пылесос S3 этажеркой»: HTML для печати в PDF (Chromium, print-pdf.cjs).

guide.py <выгрузка теста (json, asm-*.svg)> <папка laser (svg)> <выход>
"""
import base64
import html
import json
import sys
from pathlib import Path

D, L, OUT = (Path(a) for a in sys.argv[1:4])
OUT.mkdir(parents=True, exist_ok=True)
data = {b: json.loads((D / f'{b}.json').read_text()) for b in ('upper', 'lower', 'panel')}


def esc(s):
    return html.escape(str(s))


def svg_img(path, width_mm):
    b = base64.b64encode(Path(path).read_bytes()).decode()
    return f'<img src="data:image/svg+xml;base64,{b}" style="width:{width_mm}mm">'


def parts_table(board, skip=('H1', 'H2', 'H3', 'H4')):
    rows = []
    def key(c):
        import re
        m = re.match(r'([A-Z]+)(\d+)', c['ref'])
        return (m.group(1), int(m.group(2))) if m else (c['ref'], 0)
    for c in sorted(data[board]['comps'], key=key):
        if c['ref'] in skip:
            continue
        rows.append(f'<tr><td class="ref">{esc(c["ref"])}</td><td>{esc(c["value"])}</td><td>{esc(c["fp"])}</td><td>{esc(c["description"])}</td></tr>')
    return '<table class="parts"><tr><th>Поз.</th><th>Что</th><th>Корпус</th><th>Зачем и как ставить</th></tr>' + ''.join(rows) + '</table>'


def drill_table_all():
    what = {
        ('0.60', False): 'электролиты Ø5 (шаг 2 мм)',
        ('0.80', False): 'резисторы, конденсаторы, ULN2003, транзистор, диод',
        ('0.80', True): 'переходные пульта — проволочка 0,6 мм',
        ('0.90', False): 'MPX5100DP; на пульте — зуммер и светодиод',
        ('0.90', True): 'переходные питания пульта; на нижней — концы перемычки',
        ('1.00', False): 'штыри, гнёзда, модули, ESP32, разъёмы IDC',
        ('1.10', False): 'кнопки 12×12',
        ('1.20', False): 'клеммники 3,5 мм',
        ('1.60', False): 'лапки энкодера',
        ('3.20', False): 'крепёж M3 (на пульте ещё 4 — стойки экрана)',
    }
    keys = set()
    for b in ('upper', 'lower', 'panel'):
        for k in data[b]['drills']:
            keys.add((k.split()[0], 'переход' in k))
    rows = []
    for d, via in sorted(keys, key=lambda t: (float(t[0]), t[1])):
        k = d + (' (переходные)' if via else '')
        cnt = [data[b]['drills'].get(k) for b in ('upper', 'lower', 'panel')]
        cells = ''.join(f'<td class="n">{c if c else "—"}</td>' for c in cnt)
        dd = d.rstrip('0').rstrip('.').replace('.', ',')
        rows.append(f'<tr><td class="ref">{dd} мм{" (переходные)" if via else ""}</td>{cells}<td>{esc(what.get((d, via), ""))}</td></tr>')
    return ('<table class="small"><tr><th>Сверло</th><th>Верхняя</th><th>Нижняя</th><th>Пульт</th><th>Что</th></tr>' + ''.join(rows) + '</table>')


CABLE = [
    ('1', 'GND', 'земля'), ('2', '3V3', '3,3 В'), ('3', 'ENC_A', 'энкодер A (IO21)'), ('4', 'GND', 'земля'),
    ('5', 'ENC_B', 'энкодер B (IO47)'), ('6', 'GND', 'земля'), ('7', 'BZ', 'зуммер (IO45)'), ('8', 'GND', 'земля'),
    ('9', 'T_CS', 'CS касания (IO0)'), ('10', 'GND', 'земля'), ('11', 'LCD_CS', 'CS экрана (IO43)'), ('12', 'SPI_SCK', 'SCK (IO15)'),
    ('13', '5V', '5 В'), ('14', 'SPI_MOSI', 'MOSI (IO16)'), ('15', 'PNL_TX', 'голос DFPlayer (IO13)'), ('16', 'SPI_MISO', 'MISO (IO17)'),
    ('17', 'FLOAT', 'поплавок → PCA9555 P17'), ('18', 'LCD_DC', 'DC экрана (IO18)'), ('19', 'SCL', 'I²C SCL (IO12)'), ('20', 'SDA', 'I²C SDA (IO11)'),
]


def cable_table():
    half = [CABLE[i:i + 2] for i in range(0, 20, 2)]
    rows = ''.join(f'<tr><td>{a[0]}</td><td>{esc(a[2])}</td><td>{b[0]}</td><td>{esc(b[2])}</td></tr>' for a, b in half)
    return '<table class="small"><tr><th>Жила</th><th>Что</th><th>Жила</th><th>Что</th></tr>' + rows + '</table>'


TERMINALS = [
    ('XP1', 'Питание 5 В', '+5В, GND', 'Блок питания 5 В 3 А (Hi-Link HLK-PM05 мало — нужен 3 А: модули реле и плеер). Соблюдайте полярность. Модули реле, SSR и ZMPT101B — от того же блока своими проводами, земля общая.'),
    ('X6', 'Реле', 'K1, K2, K3', 'Входы IN модулей реле 30 А с управлением низким уровнем (перемычка на модуле — L): K1 — турбина 1, K2 — турбина 2, K3 — розетка инструмента. VCC и GND модулей — от блока 5 В.'),
    ('X7', 'МР248', 'УПР2, УПР1', 'Входы «управление» регуляторов МР248: УПР1 — турбина 1, УПР2 — турбина 2. ШИМ 0–3,3 В → 0–100 %.'),
    ('X11', '3,3 В для МР248', '+3,3В, GND', 'Питание входов МР248: +VCC и GND обоих регуляторов (параллельно).'),
    ('X8', 'Клапаны', 'L2, L1, H2, H1', 'L1/L2 — ключ на землю (ULN2003) для SSR G3MB с управлением низким уровнем (CH1/CH2); H1/H2 — «1» 3,3 В через 100 Ом для SSR High Level или модулей AOD4184 (вход PWM). Подключайте один из вариантов.'),
    ('X9', 'ZMPT101B', 'OUT, GND', 'Выход модуля ZMPT101B и его GND. Питание модуля 5 В — от блока питания, сеть 230 В — на винтовой клеммник самого модуля в сетевом отсеке.'),
    ('X1', 'Ток', 'ср, ср, ср, ТТ1, ТТ2, ТТ3', 'Трансформаторы тока SCT-013 с выходом 1 В: S1 → ТТ1 (турбина 1, 020: 20 А), ТТ2 (турбина 2, 020), ТТ3 (розетка, 030: 30 А); S2 каждого — на любой «ср» (середина 1,65 В).'),
    ('X5', 'Бак', 'E1, E0, E2, ПОПЛ, GND', 'E0 — общий электрод внизу бака, E1 — уровень (турбины стоп), E2 — перелив (авария); поплавок — между ПОПЛ и GND (замкнут = полный бак).'),
    ('X2', 'Термисторы', 'GND, NTC1, GND, NTC2, GND', 'NTC 10 кОм B3950 на двигателях: турбина 1 — NTC1 и соседний GND, турбина 2 — NTC2 и соседний GND.'),
    ('X3', 'I²C-A', '3,3В, SCL, SDA, GND', 'Датчики 3,3 В на основной шине: SDP810-500 (перепад на фильтре, 0x25), NAU7802 (весы, 0x2A). По два провода в винт — можно цепочкой.'),
    ('X10', 'I²C-B', 'GND, SDA, SCL, 3,3В', 'Та же шина: SDP811 (расходомер, 0x26), BME280 (воздух, 0x76).'),
    ('X4', 'I²C-2', '3,3В, SCL2, SDA2, GND', 'Вторая шина (IO14/IO13): расходомер SDP810-125Pa (0x25), если нет SDP811. Тогда снимите перемычку JP1 «голос» на пульте.'),
]


def term_table():
    rows = ''.join(f'<tr><td class="ref">{a}</td><td>{esc(b)}</td><td>{esc(c)}</td><td>{esc(d)}</td></tr>' for a, b, c, d in TERMINALS)
    return '<table class="parts"><tr><th>Клеммник</th><th>Надпись</th><th>Выводы слева направо (сверху вниз)</th><th>Что подключать</th></tr>' + rows + '</table>'


def side_svg():
    """Этажерка сбоку: разрез посередине плат, номера — выноски, пояснения справа."""
    X = 18  # левый край плат
    o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 186 76" style="width:180mm">'
         '<style>text{font-family:Inter,Arial,sans-serif;font-size:2.6px} .t{font-size:3.4px;font-weight:600} .d{font-size:2.5px;fill:#333}</style>']
    r = lambda x, y, w, h, c, extra='': o.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" fill="{c}" {extra}/>')
    ln = lambda x1, y1, x2, y2, c='#000', w=0.25: o.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="{c}" stroke-width="{w}"/>')
    o.append('<text x="0" y="4" class="t">Этажерка сбоку (разрез посередине плат), высота с ножками ≈ 47 мм</text>')
    # Дно, ножки и стойки, платы (медь — оранжевая полоска снизу).
    r(14, 60, 104, 2.5, '#d7ccc8')
    for x in (X + 2, X + 91):
        r(x, 50, 3, 10, '#9e9e9e')
        r(x, 28.4, 3, 20, '#9e9e9e')
    for y in (26.8, 48.4):
        r(X, y, 96, 1.6, '#2e7d32')
        r(X, y + 1.6, 96, 0.35, '#c77d3a')
    # Длинные штыри: сквозь верхнюю плату вниз, в гнёзда нижней.
    for k in range(11):
        x = X + 34.3 + k * 5.08
        ln(x, 28.75, x, 43, '#b8860b', 0.5)
    r(X + 33, 39.9, 56, 8.5, '#263238')
    # Нижняя плата: ADS1115 у левого края, MPX5100DP между рядами гнёзд.
    r(X + 1.5, 43.2, 15, 1.6, '#1565c0')
    r(X + 6, 42.2, 5, 1, '#111')
    r(X + 11.5, 45.9, 3.5, 2.5, '#111')
    r(X + 53, 32.4, 16, 16, '#546e7a', 'stroke="#263238" stroke-width="0.3"')
    for cx in (X + 57.5, X + 64.5):
        o.append(f'<circle cx="{cx}" cy="36.5" r="1.4" fill="#cfd8dc" stroke="#263238" stroke-width="0.3"/>')
    # Верхняя плата: клеммники у края, гнёзда ESP32 и детали под ней, DevKitC с модулем и USB.
    r(X + 0.5, 19.3, 7.6, 7.5, '#43a047', 'stroke="#1b5e20" stroke-width="0.3"')
    for cx in (X + 2.4, X + 6.2):
        o.append(f'<circle cx="{cx}" cy="20.6" r="0.9" fill="#c8e6c9" stroke="#1b5e20" stroke-width="0.2"/>')
    r(X + 33, 18.3, 56, 8.5, '#263238')
    for x in (X + 40, X + 47, X + 61, X + 72):
        r(x, 21.2, 2.6, 5.6, '#a1887f')
    r(X + 29.6, 16.7, 62.7, 1.6, '#1b5e20')
    r(X + 25.4, 13.5, 18, 3.2, '#b0bec5', 'stroke="#546e7a" stroke-width="0.2"')
    r(X + 88.5, 14.2, 5, 2.5, '#cfd8dc', 'stroke="#546e7a" stroke-width="0.2"')
    # Размеры слева.
    def dim(x, y1, y2, t1, t2=''):
        ln(x, y1, x, y2)
        ln(x - 1.2, y1, x + 1.2, y1)
        ln(x - 1.2, y2, x + 1.2, y2)
        ym = (y1 + y2) / 2
        o.append(f'<text x="{x - 2}" y="{ym}" class="d" text-anchor="end">{t1}</text>')
        if t2:
            o.append(f'<text x="{x - 2}" y="{ym + 3}" class="d" text-anchor="end">{t2}</text>')
    dim(15, 28.4, 48.4, '20 мм', 'стойки')
    dim(15, 50, 60, '10 мм', 'ножки')
    dim(15, 13.5, 26.8, '≈ 13 мм')
    # Выноски.
    def call(n, cx, cy, tx=None, ty=None):
        if tx is not None:
            ln(cx, cy, tx, ty, '#000', 0.2)
        o.append(f'<circle cx="{cx}" cy="{cy}" r="2" fill="#fff" stroke="#000" stroke-width="0.3"/><text x="{cx}" y="{cy + 0.95}" text-anchor="middle" style="font-size:2.6px;font-weight:600">{n}</text>')
    call(1, X + 62, 10.5, X + 62, 16.7)
    call(2, X + 4.3, 13, X + 4.3, 19.3)
    call(3, X + 20, 33, X + 20, 28.4)
    call(4, X + 28.5, 36.5, X + 34.3, 36.5)
    call(5, X + 79, 44)
    call(6, X + 9, 38, X + 9, 42.2)
    call(7, X + 61, 44)
    call(8, X + 26, 54, X + 26, 50)
    call(9, X + 98.5, 38, X + 94, 38)
    # Пояснения.
    notes = [
        ('1', ['ESP32-S3-DevKitC-1 на гнёздах 8,5 мм,', 'USB — к правому краю']),
        ('2', ['клеммники — по краям верхней платы']),
        ('3', ['верхняя плата: детали сверху, медь снизу;', 'под ESP32 — детали не выше 9 мм']),
        ('4', ['длинные штыри PT1, PT2, J2–J4: пластик', 'сверху, выводы ≈ 15 мм вниз сквозь плату']),
        ('5', ['гнёзда PT1, PT2, J2–J4 нижней платы']),
        ('6', ['ADS1115 у левого края']),
        ('7', ['MPX5100DP (не выше 18 мм), трубка —', 'между платами к краю']),
        ('8', ['нижняя плата: медь снизу, земля заливкой;', 'шлейф к пульту — от XS1 у нижнего края']),
        ('9', ['стойки M3 20 мм между платами (4 шт.),', 'ножки M3 10 мм к корпусу']),
    ]
    y = 9
    for n, lines in notes:
        o.append(f'<circle cx="127" cy="{y - 0.9}" r="1.7" fill="#fff" stroke="#000" stroke-width="0.25"/><text x="127" y="{y}" text-anchor="middle" style="font-size:2.3px;font-weight:600">{n}</text>')
        for i, t in enumerate(lines):
            o.append(f'<text x="130" y="{y + i * 3.1}">{esc(t)}</text>')
        y += 3.1 * len(lines) + 2.2
    o.append('</svg>')
    return ''.join(o)


def wiring_svg():
    """Схема подключения: сетевой отсек сверху, верхняя плата этажерки как есть (клеммники на своих
    местах, 1:1), датчики слева и снизу, пульт внизу. Линии отсека не пересекаются."""
    o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 204" style="width:182mm"><style>text{font-family:Inter,Arial,sans-serif}</style>']

    def box(x, y, w, h, t, fill, size=2.8):
        lines = t.split('|')
        o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="1.5" fill="{fill}" stroke="#333" stroke-width="0.35"/>')
        y0 = y + h / 2 - (len(lines) - 1) * size * 0.6 + size * 0.36
        for i, line_ in enumerate(lines):
            o.append(f'<text x="{x + w / 2}" y="{y0 + i * size * 1.2:.2f}" text-anchor="middle" style="font-size:{size}px">{esc(line_)}</text>')

    def line(pts, c, dash=''):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        o.append(f'<polyline points="{" ".join(f"{x},{y}" for x, y in pts)}" fill="none" stroke="{c}" stroke-width="0.5"{d}/>')

    def text(x, y, t, size=2.5, c='#000', anchor='start', weight=''):
        w = f';font-weight:{weight}' if weight else ''
        o.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" style="font-size:{size}px;fill:{c}{w}">{esc(t)}</text>')

    OR, VI, BL, PU = '#e65100', '#6a1b9a', '#1565c0', '#4527a0'
    # Сетевой отсек: верхний ряд — к чему идут провода с платы, нижний — что они включают.
    o.append(f'<rect x="2" y="2" width="186" height="46" rx="2" fill="#fff3e0" stroke="{OR}" stroke-width="0.5" stroke-dasharray="3 1.5"/>')
    text(5, 7.5, 'Сетевой отсек 230 В — отдельно от этажерки', 3.4, OR, weight='600')
    for x, t in [(4, 'Модули реле 30 А ×3|вход IN, перемычка L'), (41, 'SSR или AOD4184 ×2|клапаны'), (78, 'МР248 ×2|регуляторы турбин'),
                 (115, 'ZMPT101B|напряжение сети'), (152, 'Блок питания|5 В 3 А')]:
        box(x, 11, 34, 14, t, '#ffe0b2')
    for x, t in [(25, 'Турбины Т1, Т2|через реле и МР248'), (62, 'Клапаны К1, К2|через SSR / AOD4184'), (99, 'Розетка|через реле K3')]:
        box(x, 31, 30, 12, t, '#ffcc80', 2.6)
    # Верхняя плата 96×82 в масштабе 1:1 (как на рисунке платы), клеммники на своих местах.
    BX, BY = 56, 66
    o.append(f'<rect x="{BX}" y="{BY}" width="96" height="82" rx="2" fill="#e8f5e9" stroke="#2e7d32" stroke-width="0.6"/>')
    o.append(f'<rect x="{BX + 29.6}" y="{BY + 22.6}" width="62.7" height="27.8" rx="1" fill="#fff" stroke="#2e7d32" stroke-width="0.35"/>')
    text(BX + 61, BY + 36, 'ESP32-S3-DevKitC-1', 3.0, '#1b5e20', 'middle', '600')
    text(BX + 61, BY + 40, 'прошивка 6.4', 2.6, '#1b5e20', 'middle')
    text(BX + 91, BY + 37.5, 'USB →', 2.5, '#1b5e20', 'end')
    text(BX + 48, BY + 72, 'Верхняя плата этажерки (вид сверху)', 3.0, '#1b5e20', 'middle', '600')
    text(BX + 7, BY + 62, 'под ней — нижняя плата: MPX5100DP, XS1', 2.5, '#1b5e20')
    terms = {  # имя: x, y, ширина, высота (мм на плате)
        'X6': (39.2, 0, 10.5, 5), 'X8': (50.25, 0, 14, 5), 'X7': (66.75, 0, 7, 5), 'X9': (75, 0, 7, 5),
        'X10': (8, 77, 14, 5), 'X1': (33.95, 77, 21, 5), 'X5': (63.75, 77, 17.5, 5),
        'X2': (0, 6.75, 5, 17.5), 'X11': (0, 26, 5, 7), 'X4': (0, 33.25, 5, 14), 'X3': (0, 47.75, 5, 14),
        'XP1': (77.5, 62.5, 5, 7),
    }
    for name, (x, y, w, h) in terms.items():
        o.append(f'<rect x="{BX + x}" y="{BY + y}" width="{w}" height="{h}" fill="#2e7d32"/>')
        o.append(f'<text x="{BX + x + w / 2}" y="{BY + y + h / 2 + 0.85}" text-anchor="middle" style="font-size:2.3px;fill:#fff;font-weight:600">{name}</text>')
    # Отсек → клеммники верхнего края: чем правее блок, тем выше поворот — линии не пересекаются.
    line([(132, 25), (132, 52), (134.5, 52), (134.5, BY)], VI)
    text(134, 50.5, 'OUT, GND', 2.4, VI)
    line([(95, 25), (95, 55), (126.25, 55), (126.25, BY)], OR)
    text(98, 54.2, 'УПР1, УПР2', 2.4, OR)
    line([(58, 25), (58, 58), (113.25, 58), (113.25, BY)], OR)
    text(61, 57.2, 'входы SSR (CH или PWM)', 2.4, OR)
    line([(21, 25), (21, 61), (100.45, 61), (100.45, BY)], OR)
    text(24, 60.2, 'входы IN K1, K2, K3', 2.4, OR)
    line([(169, 25), (169, BY + 66), (BX + 82.5, BY + 66)], OR)
    text(170.5, 100, '+5 В, GND', 2.4, OR)
    text(170.5, 103, '→ XP1', 2.4, OR)
    # Слева: датчики и питание входов МР248.
    for y0, h, t, fill, ym in [(74, 14, 'Термисторы NTC 10k|на двигателях Т1, Т2', '#e3f2fd', 81.5),
                               (90, 11, 'К МР248: +VCC и GND|(питание входов)', '#ffe0b2', 95.5),
                               (102, 9.5, 'I²C-2: SDP810-125Pa|расходомер (без SDP811)', '#e3f2fd', 106.25),
                               (114, 13.5, 'I²C-A: SDP810-500|(фильтр), NAU7802 (весы)', '#e3f2fd', 120.75)]:
        box(4, y0, 42, h, t, fill, 2.6)
        line([(46, ym), (BX, ym)], OR if fill == '#ffe0b2' else BL)
    # Снизу: датчики к клеммникам нижнего края.
    for x0, w, t, xm in [(50, 36, 'I²C-B: SDP811|(расход), BME280', 71), (88, 32, 'SCT-013 ×3 (1 В)|на проводах в отсеке', 100.45),
                         (122, 30, 'Бак: электроды|E0, E1, E2, поплавок', 128.5)]:
        box(x0, 156, w, 14, t, '#e3f2fd', 2.6)
        line([(xm, BY + 82), (xm, 156)], VI if 'SCT' in t else BL)
    # Пульт на шлейфе.
    box(50, 184, 100, 16, 'Пульт 3,5″: экран, 9 кнопок, энкодер, зуммер,|голос (DFPlayer + динамик), часы DS3231', '#ede7f6', 2.9)
    line([(BX + 96, 140), (184, 140), (184, 192), (150, 192)], PU, '2 1')
    for i, t in enumerate(['шлейф IDC 20 жил', '≤ 40 см, от XS1', 'нижней платы']):
        text(155, 150 + i * 3.2, t, 2.5, PU)
    o.append('</svg>')
    return ''.join(o)


CSS = '''
@page { size: A4; margin: 12mm 12mm 14mm 12mm; }
body { font-family: Inter, 'IBM Plex Sans', Arial, sans-serif; font-size: 9.6pt; line-height: 1.38; color: #111; }
h1 { font-size: 18pt; margin: 0 0 2mm; } h2 { font-size: 13pt; margin: 5mm 0 2mm; border-bottom: 0.4mm solid #2e7d32; padding-bottom: 1mm; page-break-after: avoid; }
h3 { font-size: 10.5pt; margin: 3mm 0 1.5mm; page-break-after: avoid; }
p { margin: 1.2mm 0; } ul, ol { margin: 1mm 0 1mm 5mm; padding-left: 3mm; } li { margin: 0.6mm 0; }
.note { background: #fff8e1; border-left: 1.2mm solid #f9a825; padding: 2mm 3mm; margin: 2mm 0; }
.warn { background: #ffebee; border-left: 1.2mm solid #c62828; padding: 2mm 3mm; margin: 2mm 0; }
table { border-collapse: collapse; width: 100%; margin: 1.5mm 0; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 0.2mm solid #999; padding: 0.8mm 1.4mm; vertical-align: top; text-align: left; }
th { background: #e8f5e9; }
table.parts td { font-size: 8.2pt; } table.small td, table.small th { font-size: 8.6pt; } td.n { text-align: center; white-space: nowrap; }
td.ref { font-weight: 600; white-space: nowrap; }
.fig { text-align: center; margin: 2mm 0; } .cap { font-size: 8.4pt; color: #444; text-align: center; }
.pb { page-break-before: always; }
.cols { display: flex; gap: 5mm; } .cols > div { flex: 1; }
code { font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace; font-size: 8.8pt; background: #f1f1f1; padding: 0 0.6mm; }
'''


def plural(n, one, few, many):
    word = one if n % 10 == 1 and n % 100 != 11 else few if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14) else many
    return f'{n} {word}'


def jumpers(d):
    n = d['wires']
    return 'нет' if n == 0 else plural(n, 'перемычка', 'перемычки', 'перемычек') + ' проводом'


def page():
    up, low, pan = data['upper'], data['lower'], data['panel']
    h = [f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Пылесос S3 этажеркой — сборка и подключение</title><style>{CSS}</style></head><body>']
    h.append('<h1>Пылесос S3 — контроллер «этажеркой» под лазер</h1>')
    h.append('<p>Прошивка 6.4 «S3» (ESP32-S3-DevKitC-1), выводы — как у навесного монтажа 6.1 (без IO8). Три платы: две одинакового размера 96×82 мм стоят друг над другом на стойках, третья — пульт с экраном 3,5″, кнопками и энкодером, — отдельно, на шлейфе.</p>')
    h.append('<table class="small"><tr><th>Плата</th><th>Размер</th><th>Медь</th><th>Перемычки / переходные</th><th>Что на ней</th></tr>'
             f'<tr><td class="ref">Верхняя</td><td>96×82 мм</td><td>одна сторона (снизу)</td><td>{jumpers(up)}</td><td>ESP32-S3-DevKitC-1 на гнёздах, ULN2003, все клеммники: питание 5 В, реле, клапаны, МР248, ZMPT101B, трансформаторы тока, бак, термисторы, датчики I²C</td></tr>'
             f'<tr><td class="ref">Нижняя</td><td>96×82 мм</td><td>одна сторона (снизу)</td><td>{jumpers(low)}</td><td>АЦП ADS1115 (термисторы), датчик разрежения MPX5100DP, середина 1,65 В для ТТ, ШИМ к МР248, разъём шлейфа к пульту</td></tr>'
             f'<tr><td class="ref">Пульт</td><td>160×90 мм</td><td>две стороны, без металлизации</td><td>{plural(pan["vias"], "переходное", "переходных", "переходных")} (проволочки), {plural(pan["topTracks"], "дорожка", "дорожки", "дорожек")} сверху</td><td>экран MSP3520 3,5″, PCA9555, 9 кнопок, энкодер EC11, зуммер, светодиод, плеер голоса DFPlayer Mini с динамиком, часы DS3231</td></tr></table>')
    h.append(f'<div class="fig">{side_svg()}</div>')
    h.append('<h3>Что в архиве</h3><ul>'
             '<li><b>Sborka-i-podklyuchenie.pdf</b> — эта памятка.</li>'
             '<li><b>Lazer-1-k-1.pdf</b> — все стороны плат в масштабе 1:1 с линейкой (проверка масштаба, печать).</li>'
             '<li><b>laser/</b> — файлы для гравера: <code>*_1000dpi.png</code> (растр, чёрное — жечь; LaserGRBL, LightBurn и др.), '
             '<code>*.svg</code> (вектор: чёрная заливка — жечь, красная линия — контур платы), <code>*.dxf</code> (слой BURN — жечь, CUT — контур), '
             '<code>*_izolyaciya_1000dpi.png</code> — быстрый вариант: жечь только полосу 0,8 мм вокруг меди.</li>'
             '<li><b>plata/</b> — проекты плат Plata (<code>.plata.json</code>) — открываются в редакторе Plata для правок.</li></ul>')

    # --- изготовление
    h.append('<h2 class="pb">Изготовление плат лазером</h2>')
    h.append('<ol>'
             '<li>Текстолит: этажерка — односторонний 1,5 мм (медь 35 мкм), пульт — двусторонний. Зачистите медь (мелкая шкурка или губка, затем спирт).</li>'
             '<li>Краска: тонкий ровный слой матовой чёрной аэрозольной краски на медь, высушить полностью.</li>'
             '<li>Гравер: файл <code>…_1000dpi.png</code>, размер ровно как у платы (96×82 или 160×90 мм — разрешение записано в файле). '
             'Чёрное — жечь (снимается краска), белое — останется медью. Рамки и полей у картинки нет: левый верхний угол картинки — угол платы. '
             'Режим — гравировка растра; мощность и скорость подберите на обрезке так, чтобы краска снималась до чистой меди без нагара '
             '(диод 5–10 Вт: обычно 60–100 %, 1500–3000 мм/мин; CO2 40–60 Вт: примерно 10–25 %, 100–300 мм/с; шаг строк 0,05–0,08 мм; если остаётся плёнка — второй проход).</li>'
             '<li><b>Проверка зеркала:</b> файлы с <code>ZERKALNO</code> уже отражены — лазер смотрит на медь снизу платы. Повторно не отражайте! '
             'После выжигания надпись на меди («ПЫЛЕСОС S3 · ВЕРХ», «· НИЗ», «· ПУЛЬТ») должна читаться нормально.</li>'
             '<li>Травление — хлорное железо или персульфат аммония; потом краску снять растворителем (ацетон).</li>'
             '<li>Сверление по точкам в площадках (точки протравлены ямками) — таблица свёрл ниже.</li></ol>')
    h.append('<div class="note"><b>Быстрый вариант</b> (<code>_izolyaciya</code>): жжётся только полоса 0,8 мм вокруг дорожек и площадок, остальная медь остаётся пустыми островками. '
             'Гравировка в 2–5 раз быстрее, травить меньше. На этих платах нет 230 В, так что островки не мешают; под антенной ESP32 и у стоек медь всё равно снимается полностью.</div>')
    h.append('<h3>Пульт — две стороны</h3><ol>'
             '<li>Отрежьте заготовку точно 160×90 мм с прямыми углами. Покрасьте обе стороны.</li>'
             '<li>На столе гравера закрепите угловой упор (две ровные планки под 90°), начало задания — во внутреннем углу упора.</li>'
             '<li>Нижняя сторона (сторона пайки) вверх, угол заготовки — в упор: файл <code>pult_niz-storona-paiki_ZERKALNO</code>.</li>'
             '<li>Переверните заготовку <b>слева направо</b> (верхний край остаётся верхним), снова в упор: файл <code>pult_verh-storona-detalei</code>. '
             'Надпись «ПУЛЬТ S3 · ВЕРХНЯЯ СТОРОНА» должна читаться.</li>'
             '<li>После травления посмотрите на просвет: площадки переходных сверху и снизу должны совпасть (допуск — половина площадки).</li>'
             '<li>Переходные: в отверстие 0,8–0,9 мм — луженый медный провод 0,6–0,7 мм, пропаять с обеих сторон, откусить заподлицо. '
             'Под кнопками, энкодером, зуммером и разъёмом шлейфа переходных нет — корпуса сядут ровно.</li>'
             '<li>Все детали паяются только снизу; сверху медь только соединяет переходные.</li></ol>')
    h.append(f'<h3>Сверловка (отверстий на плате)</h3>{drill_table_all()}')

    # --- верхняя плата
    h.append('<h2 class="pb">Верхняя плата</h2>')
    h.append(f'<div class="fig">{svg_img(D / "asm-upper.svg", 178)}</div><p class="cap">Вид со стороны деталей. Серое — площадки, голубое — дорожки снизу (просвечивают).</p>')
    h.append('<ul>'
             '<li><b>ESP32-S3-DevKitC-1</b> — на двух гнёздах 1×22 (PBS-22). Для верхнего гнезда два ряда отверстий (подписи у правого края): 22,86 мм от нижнего ряда — оригинал Espressif, 25,4 мм — часть клонов (широкие платы); гнездо — в тот ряд, что подходит к вашей плате. USB — к правому краю (для прошивки).</li>'
             '<li><b>Проходные штыри PT1, PT2 (1×22), J2 (1×11), J3, J4 (1×2)</b> — штыри с длинными выводами (25 мм, отломить от 1×40): пластик сверху платы, выводы сквозь плату вниз, примерно на 15–17 мм ниже платы (входят в гнёзда нижней платы на 4–6 мм; длиннее — укоротите).</li>'
             '<li>Под ESP32 стоят детали не выше 9 мм (C20–C22, R42, C41, R44, C42, R28) — их паять до установки гнёзд ESP32.</li>'
             '<li>Под антенной ESP32 (слева, «антенна — без меди») ничего не ставить.</li></ul>')
    h.append(parts_table('upper'))

    # --- нижняя плата
    h.append('<h2 class="pb">Нижняя плата</h2>')
    h.append(f'<div class="fig">{svg_img(D / "asm-lower.svg", 170)}</div><p class="cap">Вид со стороны деталей. Красная линия — перемычка проводом (5 В к датчику разрежения) поверх платы.</p>')
    h.append('<ul>'
             '<li><b>Гнёзда PT1, PT2 (PBS-22), J2 (PBS-11), J3, J4 (PBS-2)</b> — ровно под штырями верхней платы. Удобно: вставьте штыри верхней платы в гнёзда, наденьте нижнюю, стяните стойками — и только потом паяйте гнёзда, тогда всё совпадёт.</li>'
             '<li><b>ADS1115</b> — модуль у левого края, платкой к краю, на своих штырях (под ним только дорожки).</li>'
             '<li><b>MPX5100DP</b> — между рядами гнёзд; до верхней платы 20 мм (сверьте высоту своего датчика с выводами — не больше 18 мм). Трубка от входа турбин — на штуцер P2 (вакуумный), проложите её между платами к краю.</li>'
             '<li><b>Перемычка</b> проводом в изоляции сверху, между двумя переходными над гнездом PT2 (5 В от PT2 21 к датчику).</li>'
             '<li><b>XS1</b> — угловой IDC 2×10, вход шлейфа — к нижнему краю платы. Ключ (вырез) — как на рисунке, вывод 1 — красная жила.</li></ul>')
    h.append(parts_table('lower'))

    # --- пульт
    h.append('<h2 class="pb">Пульт</h2>')
    h.append(f'<div class="fig">{svg_img(D / "asm-panel.svg", 182)}</div><p class="cap">Вид со стороны деталей (лицевая). Голубое — дорожки снизу, розовое — сверху, красные кольца — переходные (проволочки).</p>')
    h.append('<ul>'
             '<li><b>Экран MSP3520</b> — на гнезде 1×14 (PBS-14) и 4 стойках M3 11 мм; под экраном детали не выше 8 мм.</li>'
             '<li><b>PCA9555 на платке 800 mil</b> и <b>DFPlayer</b> — под экраном: паять прямо штырями, лишнее над платкой откусить. '
             'Карту microSD с голосом (папка <code>mp3</code> из прошивки <code>firmware/vacuum-s3/voice/mp3</code>) вставьте до установки экрана — слот выходит к левому краю экрана.</li>'
             '<li><b>DS3231 «для Raspberry Pi»</b> — в левой полосе, на штырях 1×5, платкой к краю; батарейка CR1220.</li>'
             '<li><b>JP1 «голос»</b> — перемычка: IO13 → плеер. Снимите, если к X4 подключён расходомер SDP810-125 (вторая шина I²C).</li>'
             '<li><b>XA1</b> — динамик 8 Ом 1–3 Вт на корпусе пульта (полярность не важна).</li>'
             '<li>Кнопки 12×12: используются только выводы по диагонали (1 и 4) — подойдёт любая разводка выводов внутри кнопки. Кнопки 1–3 — под вкладками экрана «Главная», «Очистка», «Фильтр».</li>'
             '<li><b>XS1</b> — угловой IDC 2×10, вход шлейфа — к верхнему краю.</li></ul>')
    h.append(parts_table('panel'))

    # --- сборка
    h.append('<h2 class="pb">Сборка этажерки</h2><ol>'
             '<li>Верхняя плата: сначала низкие детали (резисторы, конденсаторы, ULN2003), потом детали под ESP32, клеммники, гнёзда ESP32, длинные штыри (пластик сверху).</li>'
             '<li>Нижняя плата: резисторы, конденсаторы, ADS1115, MPX5100DP, XS1. Гнёзда PT1, PT2, J2–J4 вставьте, соберите обе платы на стойках M3 20 мм (4 шт., «мама-мама» + винты M3×6) со штырями в гнёздах, и только потом паяйте гнёзда.</li>'
             '<li>Перемычка на нижней плате (провод в изоляции).</li>'
             '<li>Снизу нижней платы — ножки (стойки M3 8–10 мм) к корпусу: снизу медь и пайка.</li>'
             '<li>ESP32-S3-DevKitC-1 — в гнёзда верхней платы, USB к краю.</li>'
             '<li>Шлейф: IDC 2×10 на обоих концах, красная жила — вывод 1 с обеих сторон, длина до 40 см.</li></ol>')
    h.append('<h3>Жилы шлейфа к пульту</h3>' + cable_table())
    h.append('<div class="warn">Перед первым включением: прозвоните +5 В — земля и 3,3 В — земля на обеих платах и на пульте (не должно быть замыкания), проверьте полярность XP1. '
             'Первый раз включайте без ESP32 и модулей сетевого отсека: на XP1 5 В, на гнёздах ESP32 (выводы 5V и GND) — 5 В.</div>')

    # --- подключение
    h.append('<h2 class="pb">Подключение</h2>')
    h.append(f'<div class="fig">{wiring_svg()}</div>')
    h.append('<ul>'
             '<li>L и N сети — на блок питания 5 В, модули реле, МР248, SSR и винтовой клеммник ZMPT101B.</li>'
             '<li>Турбина 1: фаза → контакт реле K1 → МР248 №1 → двигатель; турбина 2 — через K2 и МР248 №2; розетка инструмента — через K3.</li>'
             '<li>Провод каждой турбины и розетки проходит через свой SCT-013: ТТ1 — турбина 1, ТТ2 — турбина 2, ТТ3 — розетка (выводы — на X1).</li>'
             '<li>Клапаны: SSR G3MB с управлением низким уровнем — на L1/L2 клеммника X8; модули AOD4184 (магниты 24 В DC) или SSR High Level — на H1/H2.</li>'
             '<li>Питание 5 В модулей реле, SSR и ZMPT101B — от того же блока своими проводами; земля общая с XP1.</li></ul>')
    h.append('<h3>Клеммники верхней платы</h3>' + term_table())
    h.append('<div class="warn">230 В — только в сетевом отсеке, на модулях реле, МР248, SSR, ZMPT101B и розетке. На платы этажерки и пульта сеть не заводится; '
             'трансформаторы тока SCT-013 надеваются на провод (фазу) поверх изоляции.</div>')

    # --- пуск
    h.append('<h2 class="pb">Первый пуск и настройки</h2><ul>'
             '<li>Прошивка 6.4 «S3» — по USB ESP32 (или из приложения «Пылесос S3» по кабелю OTG). Модуль N16R8 — вариант на 16 МБ, N8R8 — на 8 МБ (свои загрузчик и разделы). Монитор порта 115200.</li>'
             '<li>Экран: <code>lcd cal</code> — калибровка касания (три крестика); если картинка вверх ногами — <code>lcd flip</code>.</li>'
             '<li>Зуммер без генератора — <code>set buzz 0</code>, со своим генератором — <code>set buzz 1</code>.</li>'
             '<li>Клапаны: тарельчатые на удерживающих магнитах — <code>set valves plate</code>, импульсные — <code>set valves pulse</code>.</li>'
             '<li>Напряжение сети: после подключения ZMPT101B — <code>mains cal 230</code> по показаниям мультиметра; <code>mains</code> — что видно.</li>'
             '<li>Проверки первого пуска: <code>test zero</code> (ноль сети), <code>test t1</code>, <code>test t2</code> (турбины), <code>test v1</code>, <code>test v2</code> (клапаны), <code>test hold</code>, <code>test filter</code>.</li>'
             '<li>Розетка инструмента: <code>sock auto</code> (по умолчанию: есть ли ТТ3), <code>sock none</code> — нет розетки.</li>'
             '<li>Код Bluetooth для телефона — <code>ble code</code> в порт USB (в журнал не пишется).</li></ul>')
    h.append('<h3>Адреса I²C</h3><p>PCA9555 — 0x20 (A0–A2 на земле), SDP810-500 — 0x25, SDP811 — 0x26, NAU7802 — 0x2A, ADS1115 — 0x48, DS3231 — 0x68, BME280 — 0x76. '
             'Подтяжки основной шины 4,7 кОм — на пульте (R9, R10), второй шины — на верхней плате (R72, R73); у модуля ADS1115 обычно свои 10 кОм.</p>')
    h.append('<h3>Что сверить до заказа деталей</h3><ul>'
             '<li>Расстояние между рядами вашей ESP32-S3-DevKitC-1 (22,86 или 25,4 мм) — на плате есть оба ряда.</li>'
             '<li>Размеры модулей: DFPlayer Mini (ряды через 18,03 мм), DS3231 «для Pi» (5 выводов: 3,3 В, SDA, SCL, —, GND), PCA9555 на платке 800 mil (2×12), ADS1115 (1×10: VDD, GND, SCL, SDA, ADDR, ALRT, A0–A3), MPX5100DP (6 выводов, 1 — VOUT).</li>'
             '<li>Транзистор SS8050 зуммера: порядок выводов Э — Б — К (бывает иначе — сверьте с корпусом).</li></ul>')
    h.append('</body></html>')
    return ''.join(h)


def laser_page():
    jobs = [
        ('verhnyaya-plata_med-snizu_ZERKALNO', 'Верхняя плата — медь снизу, зеркально (как видит лазер)'),
        ('nizhnyaya-plata_med-snizu_ZERKALNO', 'Нижняя плата — медь снизу, зеркально'),
        ('pult_niz-storona-paiki_ZERKALNO', 'Пульт — нижняя сторона (пайка), зеркально'),
        ('pult_verh-storona-detalei', 'Пульт — верхняя сторона (детали), без зеркала'),
    ]
    css = '@page { size: A4 landscape; margin: 10mm; } body{font-family:Inter,Arial,sans-serif;margin:0} .pg{page-break-after:always} h2{font-size:12pt;margin:0 0 3mm} p{font-size:9pt;margin:1mm 0 4mm} .ruler{margin-top:5mm}'
    h = [f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Платы 1:1</title><style>{css}</style></head><body>']
    ruler = ['<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="9mm" viewBox="0 0 60 9" class="ruler"><g stroke="#000" stroke-width="0.15">',
             '<line x1="0" y1="6" x2="50" y2="6"/>']
    for i in range(51):
        ln = 3 if i % 10 == 0 else 2 if i % 5 == 0 else 1.2
        ruler.append(f'<line x1="{i}" y1="6" x2="{i}" y2="{6 - ln}"/>')
    ruler.append('</g>' + ''.join(f'<text x="{i}" y="8.6" font-size="2.2" text-anchor="middle">{i}</text>' for i in range(0, 51, 10)) + '<text x="52" y="6.5" font-size="2.2">мм</text></svg>')
    rsvg = ''.join(ruler)
    for name, title in jobs:
        svg = (L / f'{name}.svg').read_text()
        h.append(f'<div class="pg"><h2>{esc(title)}</h2><p>Масштаб 1:1: при печати — «фактический размер» (100 %), проверьте линейкой — 50 мм. Чёрное — снять краску (жечь), белое — медь; красная линия — контур платы. Для гравера берите файлы из папки laser.</p>{svg}{rsvg}</div>')
    h.append('</body></html>')
    return ''.join(h)


(OUT / 'guide.html').write_text(page(), encoding='utf-8')
(OUT / 'laser11.html').write_text(laser_page(), encoding='utf-8')
print('ok')
