"""
Иконки экрана 3,5″: рисуются здесь линиями в сетке 24×24 (как Material Symbols), сглаживание —
рисунок в 8 раз крупнее и уменьшение. Каждая иконка — знак шрифта с кодом U+E000… (ICONS ниже),
в C — макрос IC_… со строкой UTF-8 (fonts.h).
"""
import math
from PIL import Image, ImageDraw

SS = 8  # во сколько раз крупнее рисуем


class Pen:
    def __init__(self, size):
        self.s = size * SS / 24.0
        self.im = Image.new('L', (size * SS, size * SS), 0)
        self.d = ImageDraw.Draw(self.im)
        self.w = 2.0

    def p(self, x, y):
        return (x * self.s, y * self.s)

    def line(self, *pts, w=None):
        w = (w or self.w) * self.s
        P = [self.p(*q) for q in pts]
        self.d.line(P, fill=255, width=max(1, int(round(w))), joint='curve')
        r = w / 2
        for (x, y) in P:
            self.d.ellipse([x - r, y - r, x + r, y + r], fill=255)

    def circle(self, cx, cy, r, fill=False, w=None):
        w = (w or self.w) * self.s
        x, y = self.p(cx, cy)
        R = r * self.s
        if fill:
            self.d.ellipse([x - R, y - R, x + R, y + R], fill=255)
        else:
            self.d.ellipse([x - R - w / 2, y - R - w / 2, x + R + w / 2, y + R + w / 2], fill=255)
            self.d.ellipse([x - R + w / 2, y - R + w / 2, x + R - w / 2, y + R - w / 2], fill=0)

    def rect(self, x0, y0, x1, y1, r=0, fill=False, w=None):
        w = (w or self.w) * self.s
        a, b = self.p(x0, y0)
        c, d = self.p(x1, y1)
        if fill:
            self.d.rounded_rectangle([a, b, c, d], radius=r * self.s, fill=255)
        else:
            self.d.rounded_rectangle([a - w / 2, b - w / 2, c + w / 2, d + w / 2], radius=r * self.s + w / 2, fill=255)
            self.d.rounded_rectangle([a + w / 2, b + w / 2, c - w / 2, d - w / 2], radius=max(0, r * self.s - w / 2), fill=0)

    def poly(self, *pts):
        self.d.polygon([self.p(*q) for q in pts], fill=255)

    def arc(self, cx, cy, r, a0, a1, w=None):
        # углы в градусах, 0 — вправо, по часовой (как в PIL)
        w = (w or self.w) * self.s
        x, y = self.p(cx, cy)
        R = r * self.s
        self.d.arc([x - R - w / 2, y - R - w / 2, x + R + w / 2, y + R + w / 2], a0, a1, fill=255, width=max(1, int(round(w))))
        for a in (a0, a1):
            t = math.radians(a)
            px, py = x + R * math.cos(t), y + R * math.sin(t)
            self.d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=255)

    def erase_circle(self, cx, cy, r):
        x, y = self.p(cx, cy)
        R = r * self.s
        self.d.ellipse([x - R, y - R, x + R, y + R], fill=0)

    def done(self, size):
        return self.im.resize((size, size), Image.LANCZOS)


def i_home(p):
    p.line((3, 11), (12, 3.5), (21, 11))
    p.line((5.5, 9.5), (5.5, 20), (18.5, 20), (18.5, 9.5))
    p.rect(10, 14, 14, 20, r=0.5)


def i_burst(p):  # очистка: удар воздуха
    p.circle(12, 12, 3, fill=True)
    for k in range(8):
        a = math.radians(k * 45)
        r0, r1 = (6, 10) if k % 2 == 0 else (6, 8)
        p.line((12 + r0 * math.cos(a), 12 + r0 * math.sin(a)), (12 + r1 * math.cos(a), 12 + r1 * math.sin(a)))


def i_filter(p):  # складки фильтра в рамке
    p.rect(3, 3.5, 21, 20.5, r=2)
    p.line((7, 8), (12, 6.5), (17, 8), w=1.8)
    p.line((7, 12), (12, 10.5), (17, 12), w=1.8)
    p.line((7, 16), (12, 14.5), (17, 16), w=1.8)


def i_chart(p):
    p.line((3, 3), (3, 21), (21, 21))
    p.line((6, 16), (10, 11), (14, 14), (20, 6))


def i_grid(p):
    for x in (3.5, 13.5):
        for y in (3.5, 13.5):
            p.rect(x, y, x + 7, y + 7, r=1.5)


def i_fan(p):  # турбина
    p.circle(12, 12, 9)
    p.circle(12, 12, 2, fill=True)
    for k in range(3):
        a = math.radians(k * 120 - 90)
        b = a + math.radians(55)
        p.line((12 + 2.5 * math.cos(a), 12 + 2.5 * math.sin(a)), (12 + 7 * math.cos(b), 12 + 7 * math.sin(b)))


def i_valve(p):  # тарельчатый клапан
    p.line((3, 9), (9, 9))
    p.line((15, 9), (21, 9))
    p.line((6, 14), (18, 14), w=2.6)
    p.line((12, 14), (12, 20))
    p.line((9, 5), (12, 9), (15, 5))


def i_plug(p):  # розетка
    p.circle(12, 12, 9)
    p.circle(8.5, 12, 1.4, fill=True)
    p.circle(15.5, 12, 1.4, fill=True)


def i_drop(p):
    p.line((12, 3), (6.5, 11.5))
    p.line((12, 3), (17.5, 11.5))
    p.arc(12, 14.5, 6, -15, 195)


def i_scale(p):  # весы
    p.rect(3, 9, 21, 20, r=3)
    p.arc(12, 16, 5, 200, 340)
    p.line((12, 16), (14.5, 12))
    p.line((9, 6), (15, 6))
    p.line((12, 6), (12, 9))


def i_speaker(p):
    p.poly((4, 9), (8, 9), (13, 4.5), (13, 19.5), (8, 15), (4, 15))
    p.arc(13, 12, 4, -45, 45)
    p.arc(13, 12, 8, -45, 45)


def i_clock(p):
    p.circle(12, 12, 9)
    p.line((12, 7), (12, 12), (15.5, 14))


def i_wifi(p):
    p.arc(12, 18, 14, 225, 315)
    p.arc(12, 18, 9.5, 225, 315)
    p.arc(12, 18, 5, 225, 315)
    p.circle(12, 18.5, 1.6, fill=True)


def i_bt(p):
    p.line((7, 7.5), (17, 16.5), (12, 21), (12, 3), (17, 7.5), (7, 16.5))


def i_phone(p):
    p.rect(7, 2.5, 17, 21.5, r=2.5)
    p.line((10.5, 18.5), (13.5, 18.5))


def i_wrench(p):
    p.line((4.5, 19.5), (12, 12), w=3)
    p.circle(15.5, 8.5, 5.2, fill=True)
    p.erase_circle(15.5, 8.5, 2.6)
    p.d.polygon([p.p(15.5, 8.5), p.p(22, 2), p.p(24, 6), p.p(19.5, 8.5)], fill=0)


def i_flag(p):  # первый пуск
    p.line((5, 21), (5, 3))
    p.poly((5.5, 3.5), (19, 3.5), (15.5, 8), (19, 12.5), (5.5, 12.5))


def i_report(p):
    p.rect(5, 3, 19, 21, r=2)
    p.line((8.5, 8), (15.5, 8))
    p.line((8.5, 12), (15.5, 12))
    p.line((8.5, 16), (12.5, 16))


def i_list(p):
    for y in (6, 12, 18):
        p.circle(5, y, 1.4, fill=True)
        p.line((9, y), (20, y))


def i_info(p):
    p.circle(12, 12, 9)
    p.line((12, 11), (12, 16.5))
    p.circle(12, 7.6, 1.3, fill=True)


def i_warn(p):
    p.line((12, 3.5), (21.5, 20), (2.5, 20), (12, 3.5))
    p.line((12, 9.5), (12, 14))
    p.circle(12, 17, 1.3, fill=True)


def i_check(p):
    p.line((4.5, 12.5), (9.5, 17.5), (19.5, 6.5), w=2.4)


def i_cross(p):
    p.line((6, 6), (18, 18), w=2.4)
    p.line((18, 6), (6, 18), w=2.4)


def i_back(p):
    p.line((20, 12), (4.5, 12))
    p.line((11, 5.5), (4.5, 12), (11, 18.5))


def i_chev(p):
    p.line((9, 5), (16, 12), (9, 19))


def i_plus(p):
    p.line((12, 4.5), (12, 19.5), w=2.4)
    p.line((4.5, 12), (19.5, 12), w=2.4)


def i_minus(p):
    p.line((4.5, 12), (19.5, 12), w=2.4)


def i_power(p):
    p.arc(12, 13, 8, -55, 235)
    p.line((12, 3), (12, 11))


def i_play(p):
    p.poly((7, 4), (20, 12), (7, 20))


def i_stop(p):
    p.rect(5.5, 5.5, 18.5, 18.5, r=2, fill=True)


def i_hand(p):  # ладонь на шланг
    for x, top in ((7, 7), (10.3, 4.5), (13.7, 4.5), (17, 7)):
        p.line((x, 13), (x, top), w=2.4)
    p.line((7, 13), (7, 15.5), (10, 20.5), (16, 20.5), (18.5, 16), (17, 11), w=2.4)
    p.line((4.5, 12.5), (7, 16), w=2.4)


def i_gear(p):
    p.circle(12, 12, 3.2)
    for k in range(8):
        a = math.radians(k * 45)
        p.line((12 + 6.5 * math.cos(a), 12 + 6.5 * math.sin(a)), (12 + 9 * math.cos(a), 12 + 9 * math.sin(a)), w=2.8)
    p.circle(12, 12, 6.5)


def i_bell(p):
    p.arc(12, 11, 6, 180, 360)
    p.line((6, 11), (6, 16), (4.5, 18), (19.5, 18), (18, 16), (18, 11))
    p.line((10, 21), (14, 21))


def i_thermo(p):
    p.line((12, 4), (12, 14))
    p.rect(9.5, 2.5, 14.5, 15, r=2.5)
    p.circle(12, 17.5, 3.5, fill=True)


def i_bolt(p):
    p.poly((13.5, 2), (5, 13.5), (11, 13.5), (9.5, 22), (19, 9.5), (13, 9.5))


def i_tank(p):
    p.rect(5, 6, 19, 21, r=2.5)
    p.line((3.5, 6), (20.5, 6))
    p.line((7.5, 15), (16.5, 15))


def i_hose(p):
    p.arc(9, 12, 6, 90, 270)
    p.line((9, 6), (20, 6))
    p.line((9, 18), (14, 18))
    p.line((20, 3.5), (20, 8.5))


def i_flow(p):  # схема
    p.rect(2.5, 9, 7.5, 15, r=1)
    p.rect(16.5, 9, 21.5, 15, r=1)
    p.line((7.5, 12), (16.5, 12))
    p.line((12, 4), (12, 9))
    p.line((12, 15), (12, 20))
    p.line((10, 7), (12, 9), (14, 7))


def i_loop(p):
    p.arc(12, 12, 8, 30, 300)
    p.poly((19.5, 2.5), (20.5, 9.5), (13.5, 8))


def i_calendar(p):
    p.rect(3.5, 5, 20.5, 20.5, r=2)
    p.line((3.5, 10), (20.5, 10))
    p.line((8, 3), (8, 7))
    p.line((16, 3), (16, 7))


def i_sun(p):
    p.circle(12, 12, 4)
    for k in range(8):
        a = math.radians(k * 45)
        p.line((12 + 7 * math.cos(a), 12 + 7 * math.sin(a)), (12 + 9.5 * math.cos(a), 12 + 9.5 * math.sin(a)))


def i_mic(p):  # голос
    p.rect(9, 3, 15, 14, r=3)
    p.arc(12, 11, 6.5, 0, 180)
    p.line((12, 17.5), (12, 21))


def i_turbo(p):  # разгон: два шеврона вверх
    p.line((5, 14), (12, 7), (19, 14), w=2.4)
    p.line((5, 20), (12, 13), (19, 20), w=2.4)


def i_edit(p):
    p.line((4.5, 19.5), (5.5, 15), (16, 4.5), (19.5, 8), (9, 18.5), (4.5, 19.5))


def i_brush(p):  # щётка: ручка и щетина
    p.line((15, 3.5), (9.5, 12), w=2.4)
    p.rect(5, 12, 15, 15.5, r=1, fill=True)
    for x in (6, 8.5, 11, 13.5):
        p.line((x, 16), (x - 0.8, 20.5), w=1.6)


def i_vacuum(p):  # пылесос: бак на колёсах и шланг
    p.rect(4, 7, 15, 18, r=2.5)
    p.line((15, 10), (19, 10), (20.5, 5), w=1.8)
    p.circle(7, 20, 1.6, fill=True)
    p.circle(13, 20, 1.6, fill=True)


def i_dot(p):
    p.circle(12, 12, 5, fill=True)


ICONS = [
    ('HOME', i_home), ('CLEAN', i_burst), ('FILTER', i_filter), ('CHART', i_chart), ('GRID', i_grid),
    ('FAN', i_fan), ('VALVE', i_valve), ('PLUG', i_plug), ('DROP', i_drop), ('SCALE', i_scale),
    ('SPEAKER', i_speaker), ('CLOCK', i_clock), ('WIFI', i_wifi), ('BT', i_bt), ('PHONE', i_phone),
    ('WRENCH', i_wrench), ('FLAG', i_flag), ('REPORT', i_report), ('LIST', i_list), ('INFO', i_info),
    ('WARN', i_warn), ('CHECK', i_check), ('CROSS', i_cross), ('BACK', i_back), ('CHEV', i_chev),
    ('PLUS', i_plus), ('MINUS', i_minus), ('POWER', i_power), ('PLAY', i_play), ('STOP', i_stop),
    ('HAND', i_hand), ('GEAR', i_gear), ('BELL', i_bell), ('THERMO', i_thermo), ('BOLT', i_bolt),
    ('TANK', i_tank), ('HOSE', i_hose), ('SCHEME', i_flow), ('LOOP', i_loop), ('CALENDAR', i_calendar),
    ('SUN', i_sun), ('MIC', i_mic), ('TURBO', i_turbo), ('EDIT', i_edit), ('DOT', i_dot),
    ('BRUSH', i_brush), ('VACUUM', i_vacuum),
]


def render(fn, size):
    p = Pen(size)
    fn(p)
    return p.done(size)


def sheet(size=48, path='icons.png'):
    """Лист всех иконок — посмотреть глазами."""
    cols = 9
    rows = (len(ICONS) + cols - 1) // cols
    im = Image.new('L', (cols * (size + 16), rows * (size + 16)), 20)
    for i, (n, fn) in enumerate(ICONS):
        g = render(fn, size)
        im.paste(255, ((i % cols) * (size + 16) + 8, (i // cols) * (size + 16) + 8), g)
    im.save(path)


if __name__ == '__main__':
    import sys
    sheet(int(sys.argv[1]) if len(sys.argv) > 1 else 48, sys.argv[2] if len(sys.argv) > 2 else 'icons.png')
