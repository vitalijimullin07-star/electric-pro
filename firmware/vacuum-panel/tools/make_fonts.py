#!/usr/bin/env python3
"""
Шрифты пульта: DejaVu Sans и Sans Mono → сглаженные глифы 4 бита на точку (C).
Запуск: python3 tools/make_fonts.py  (нужен Pillow с FreeType) → fonts.c, fonts.h.
Размеры — как в макете панели (CSS font-size, px).
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'

TEXT = ''.join(chr(c) for c in range(32, 127)) + ''.join(chr(c) for c in range(0x410, 0x450)) + 'Ёё'
TEXT += '◀▶⚙≈▤▦⚡✕←→↓✓↺▲▼⇄⌁✎·—–°³«»‹›…№◷±×'
DIGITS = '0123456789.,-–— %'

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
]


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
    ]
    total = 0
    for name, path, size, chars in FONTS:
        font = ImageFont.truetype(path, size)
        nd = notdef(font, size)
        ascent, descent = font.getmetrics()
        glyphs = []
        bits = bytearray()
        for ch in sorted(set(chars)):
            x, y, w, h, data, adv = glyph(font, ch, size)
            if ch != ' ' and data == nd:
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
    hdr += ['', '#endif', '']
    with open(os.path.join(OUT, 'fonts.c'), 'w') as f:
        f.write('\n'.join(src))
    with open(os.path.join(OUT, 'fonts.h'), 'w') as f:
        f.write('\n'.join(hdr))
    print(f'fonts.c: {total} байт растров')


main()
