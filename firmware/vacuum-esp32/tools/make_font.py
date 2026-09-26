#!/usr/bin/env python3
"""Шрифт экрана 5×8 для прошивки: koi5x8 из набора X11 (xfonts-cyrillic, «Public domain
font. Share and enjoy.») → vac_font.h. Нужен Pillow и файл koi5x8.pcf.gz.

    python3 tools/make_font.py /usr/share/fonts/X11/cyrillic/koi5x8.pcf.gz > vac_font.h
"""
import gzip, io, sys
from PIL import PcfFontFile

path = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/X11/cyrillic/koi5x8.pcf.gz'
font = PcfFontFile.PcfFontFile(io.BytesIO(gzip.open(path).read()), 'iso8859-1')

def columns(code):
    g = font.glyph[code]
    if not g:
        return None
    im = g[3]
    cols = []
    for x in range(5):
        b = 0
        for y in range(8):
            if im.getpixel((x, y)):
                b |= 1 << y
        cols.append(b)
    return cols

chars = {}
for c in range(0x20, 0x7F):
    chars[c] = columns(c)
for k in range(0xC0, 0x100):
    chars[ord(bytes([k]).decode('koi8-r'))] = columns(k)
for k in (0xA3, 0xB3, 0x9C, 0x9D, 0x9E):
    chars[ord(bytes([k]).decode('koi8-r'))] = columns(k)
# ³ — из ² с другой нижней частью.
chars[0xB3] = [0x00, 0x11, 0x15, 0x0A, 0x00]
# Стрелки и значки для меню.
chars[0x25B6] = [0x7F, 0x3E, 0x1C, 0x08, 0x00]  # ▶
chars[0x25C0] = [0x08, 0x1C, 0x3E, 0x7F, 0x00]  # ◀
chars[0x2191] = [0x04, 0x02, 0x7F, 0x02, 0x04]  # ↑
chars[0x2193] = [0x10, 0x20, 0x7F, 0x20, 0x10]  # ↓
chars[0x2026] = [0x40, 0x00, 0x40, 0x00, 0x40]  # …

codes = sorted(c for c, v in chars.items() if v)
out = ['/* Сгенерировано tools/make_font.py из koi5x8 (X11, общественное достояние). */',
       '#ifndef VAC_FONT_H', '#define VAC_FONT_H', '#include <stdint.h>', '',
       f'#define VAC_FONT_COUNT {len(codes)}',
       '/* Коды Unicode по возрастанию. */',
       'static const uint16_t VAC_FONT_CODES[VAC_FONT_COUNT] = {']
for i in range(0, len(codes), 12):
    out.append('  ' + ', '.join(f'0x{c:04X}' for c in codes[i:i + 12]) + ',')
out += ['};', '/* 5 столбцов на знак, младший бит — верхняя строка. */',
        'static const uint8_t VAC_FONT_BITS[VAC_FONT_COUNT][5] = {']
for c in codes:
    ch = chr(c) if c != 0x5C else '\\\\'
    if ch in ('*/', '/'):
        ch = '/'
    out.append('  {' + ', '.join(f'0x{b:02X}' for b in chars[c]) + f'}}, /* U+{c:04X} */')
out += ['};', '#endif', '']
sys.stdout.write('\n'.join(out))
