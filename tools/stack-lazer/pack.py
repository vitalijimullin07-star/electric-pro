#!/usr/bin/env python3
"""Архив для мастерской: pack.py <папка (PDF, laser/)> <архив.zip> <проекты плат…>"""
import sys
import zipfile
from pathlib import Path

README = '''Пылесос S3 — контроллер «этажеркой» под лазер (прошивка 6.4)
============================================================

Sborka-i-podklyuchenie.pdf — памятка: что на каждой плате, перечень деталей, изготовление
    лазером, сборка этажерки, подключение клеммников, первый пуск.
Lazer-1-k-1.pdf — все стороны плат в масштабе 1:1 с линейкой 50 мм (проверка масштаба, печать).

laser/ — файлы для гравера (выжигание краски с меди перед травлением):
    verhnyaya-plata_med-snizu_ZERKALNO   верхняя плата 96×82 мм, медь снизу — уже зеркально
    nizhnyaya-plata_med-snizu_ZERKALNO   нижняя плата 96×82 мм — уже зеркально
    pult_niz-storona-paiki_ZERKALNO      пульт 160×90 мм, нижняя сторона (пайка) — уже зеркально
    pult_verh-storona-detalei            пульт, верхняя сторона (детали) — без зеркала

    *_1000dpi.png              растр 1000 dpi, чёрное — жечь (LaserGRBL, LightBurn и др.)
    *.svg                      вектор: чёрная заливка — жечь, красная линия — контур платы
    *.dxf                      вектор в мм: слой BURN — жечь, CUT — контур
    *_izolyaciya_1000dpi.png   быстрый вариант: жечь только полосу 0,8 мм вокруг меди

    Картинка = ровно плата, без полей: левый верхний угол картинки — угол платы.
    Повторно не отражать! После выжигания надписи на меди читаются нормально.

plata/ — проекты плат для редактора Plata (https://vitalijimullin07-star.github.io/electric-pro/).
'''


def main():
    src, out, *boards = sys.argv[1:]
    src = Path(src)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr('README.txt', README.encode('utf-8-sig'))
        for name in ('Sborka-i-podklyuchenie.pdf', 'Lazer-1-k-1.pdf'):
            z.write(src / name, name)
        for f in sorted((src / 'laser').iterdir()):
            z.write(f, f'laser/{f.name}')
        for b in boards:
            z.write(b, f'plata/{Path(b).name}')
    print(f'{out}: {Path(out).stat().st_size // 1024} КБ')


if __name__ == '__main__':
    main()
