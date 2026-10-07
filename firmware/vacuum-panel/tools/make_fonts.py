#!/usr/bin/env python3
"""
Шрифты пульта: DejaVu Sans и Sans Mono → сглаженные глифы 4 бита на точку (C).
Запуск: python3 tools/make_fonts.py  (нужен Pillow с FreeType) → fonts.c, fonts.h.
Размеры — как в макете панели (CSS font-size, px).
"""
import os
from PIL import Image, ImageDraw, ImageFont
from icons import ICONS, render

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
# Экран 3,5″ на контроллере: Roboto (Apache 2.0, tools/fonts) и иконки (icons.py).
RREG = os.path.join(HERE, 'fonts', 'Roboto-Regular.ttf')
RMED = os.path.join(HERE, 'fonts', 'Roboto-Medium.ttf')
RBOLD = os.path.join(HERE, 'fonts', 'Roboto-Bold.ttf')

TEXT = ''.join(chr(c) for c in range(32, 127)) + ''.join(chr(c) for c in range(0x410, 0x450)) + 'Ёё'
TEXT += '◀▶⚙≈▤▦⚡✕←→↓✓↺▲▼⇄⌁✎·—–°³«»‹›…№◷±×'
DIGITS = '0123456789.,-–— %'
BIG = DIGITS + ':+/'
# Roboto: без стрелок и значков (их рисуют иконки).
RTEXT = ''.join(chr(c) for c in range(32, 127)) + ''.join(chr(c) for c in range(0x410, 0x450)) + 'Ёё' + '·—–°³«»…№±×‹›²≈−' + '→✓'
# Знаки, которых нет в Roboto, — из DejaVu Sans того же размера.
FALLBACK = '→✓'

FONTS = [
    # имя, файл, размер, набор знаков
    ('S11', SANS, 11, TEXT),
    ('S12', SANS, 12, TEXT),
    ('S13', SANS, 13, TEXT),
    ('S14', SANS, 14, TEXT),
    ('S15', SANS, 15, TEXT),
    ('S16', SANS, 16, TEXT),
    ('S20', SANS, 20, TEXT),
    ('M13', MONO, 13, TEXT),
    ('M14', MONO, 14, TEXT),
    ('M15', MONO, 15, TEXT),
    ('M16', MONO, 16, TEXT),
    ('M18', MONO, 18, TEXT),
    ('M22', MONO, 22, TEXT),
    ('M27', MONO, 27, DIGITS),
    ('M82', MONO, 82, DIGITS),
    # экран 3,5″: N — Roboto Regular, D — Medium, B — Bold
    ('N12', RREG, 12, RTEXT),
    ('N14', RREG, 14, RTEXT),
    ('N16', RREG, 16, RTEXT),
    ('D13', RMED, 13, RTEXT),
    ('D15', RMED, 15, RTEXT),
    ('D17', RMED, 17, RTEXT),
    ('D20', RMED, 20, RTEXT),
    ('D24', RMED, 24, RTEXT),
    ('B30', RBOLD, 30, RTEXT),
    ('B44', RBOLD, 44, BIG),
    ('B60', RBOLD, 60, BIG),
]
# Иконки (знаки U+E000…): размеры в точках.
ICON_SIZES = [18, 24, 32, 44]


def notdef(font, size):
    return glyph(font, '￿', size)[4]


def glyph(font, ch, size):
    pad = size
    im = Image.new('L', (size * 3, size * 3))
    ImageDraw.Draw(im).text((pad, pad * 2), ch, font=font, fill=255, anchor='ls')
    bb = im.getbbox()
    adv = round(font.getlength(ch))
    if not bb:
        return 0, 0, 0, 0, b'', adv
    x0, y0, x1, y1 = bb
    crop = im.crop(bb)
    return x0 - pad, y0 - pad * 2, x1 - x0, y1 - y0, crop.tobytes(), adv


def main():
    src = ['/* Создано tools/make_fonts.py из шрифтов DejaVu (свободная лицензия Bitstream Vera). */', '#include "fonts.h"', '']
    hdr = [
        '/* Шрифты пульта: сглаживание 4 бита на точку, знаки по возрастанию кода. */',
        '#ifndef PANEL_FONTS_H',
        '#define PANEL_FONTS_H',
        '#include <stdint.h>',
        '',
        'typedef struct {',
        '  uint16_t cp;      /* код знака (Юникод) */',
        '  uint8_t w, h;     /* размер растра */',
        '  int8_t x, y;      /* смещение растра от точки на базовой линии */',
        '  uint8_t adv;      /* шаг */',
        '  uint32_t off;     /* начало растра в bits (растр — по 2 точки в байте, строки подряд) */',
        '} pglyph_t;',
        '',
        'typedef struct {',
        '  const pglyph_t *glyphs;',
        '  uint16_t count;',
        '  uint8_t size, ascent, descent;',
        '  const uint8_t *bits;',
        '} pfont_t;',
        '',
        '#ifdef __cplusplus',
        'extern "C" {',
        '#endif',
        '',
    ]
    total = 0
    for name, path, size, chars in FONTS:
        font = ImageFont.truetype(path, size)
        nd = notdef(font, size)
        ascent, descent = font.getmetrics()
        glyphs = []
        bits = bytearray()
        fb = ImageFont.truetype(SANS, size) if path != SANS and path != MONO else font
        for ch in sorted(set(chars)):
            x, y, w, h, data, adv = glyph(fb if ch in FALLBACK else font, ch, size)
            if ch != ' ' and data == nd and ch not in FALLBACK:
                raise SystemExit(f'{name}: нет знака {ch!r} U+{ord(ch):04X}')
            off = len(bits)
            px = [v >> 4 for v in data]
            if len(px) % 2:
                px.append(0)
            for i in range(0, len(px), 2):
                bits.append(px[i] << 4 | px[i + 1])
            glyphs.append((ord(ch), w, h, x, y, adv, off))
        total += len(bits)
        src.append(f'static const uint8_t {name}_bits[{len(bits)}] = {{')
        for i in range(0, len(bits), 24):
            src.append('  ' + ','.join(str(b) for b in bits[i : i + 24]) + ',')
        src.append('};')
        src.append(f'static const pglyph_t {name}_glyphs[{len(glyphs)}] = {{')
        for g in glyphs:
            src.append('  {%d,%d,%d,%d,%d,%d,%d},' % g)
        src.append('};')
        src.append(f'const pfont_t F_{name} = {{{name}_glyphs, {len(glyphs)}, {size}, {ascent}, {descent}, {name}_bits}};')
        src.append('')
        hdr.append(f'extern const pfont_t F_{name};')
    # Иконки — шрифты I18, I24…: растр иконки — знак, шаг = размер, верх — на size над базовой линией.
    for size in ICON_SIZES:
        name = f'I{size}'
        glyphs, bits = [], bytearray()
        for i, (_, fn) in enumerate(ICONS):
            im = render(fn, size)
            off = len(bits)
            px = [v >> 4 for v in im.tobytes()]
            if len(px) % 2:
                px.append(0)
            for k in range(0, len(px), 2):
                bits.append(px[k] << 4 | px[k + 1])
            glyphs.append((0xE000 + i, size, size, 0, -size, size, off))
        total += len(bits)
        src.append(f'static const uint8_t {name}_bits[{len(bits)}] = {{')
        for i in range(0, len(bits), 24):
            src.append('  ' + ','.join(str(b) for b in bits[i : i + 24]) + ',')
        src.append('};')
        src.append(f'static const pglyph_t {name}_glyphs[{len(glyphs)}] = {{')
        for g in glyphs:
            src.append('  {%d,%d,%d,%d,%d,%d,%d},' % g)
        src.append('};')
        src.append(f'const pfont_t F_{name} = {{{name}_glyphs, {len(glyphs)}, {size}, {size}, 0, {name}_bits}};')
        src.append('')
        hdr.append(f'extern const pfont_t F_{name};')
    hdr.append('')
    hdr.append('/* Иконки: строка UTF-8 знака U+E000 + номер (g_text со шрифтом F_I18…F_I44). */')
    for i, (n, _) in enumerate(ICONS):
        cp = 0xE000 + i
        b = chr(cp).encode('utf-8')
        hdr.append('#define IC_%s "%s"' % (n, ''.join('\\x%02X' % x for x in b)))
    hdr += ['', '#ifdef __cplusplus', '}', '#endif', '#endif', '']
    with open(os.path.join(OUT, 'fonts.c'), 'w') as f:
        f.write('\n'.join(src))
    with open(os.path.join(OUT, 'fonts.h'), 'w') as f:
        f.write('\n'.join(hdr))
    print(f'fonts.c: {total} байт растров')


main()
