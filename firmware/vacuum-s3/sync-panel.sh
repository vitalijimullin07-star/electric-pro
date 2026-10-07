#!/bin/sh
# Интерфейс пульта (firmware/vacuum-panel) → src/panel: Arduino собирает его вместе с прошивкой
# контроллера для экрана ILI9488 прямо на плате (lcd_s3.cpp). Запускать после правки пульта;
# копии не править — их сверяет tests/vacuum-s3.test.ts.
set -e
cd "$(dirname "$0")"
SRC=../vacuum-panel
mkdir -p src/panel
for f in panel_main.c panel_ui.c panel_s3.c panel_t35.c gfx.c fonts.c qr.c panel_int.h panel_ui.h gfx.h fonts.h qr.h; do
  {
    echo "/* Копия $SRC/$f (sync-panel.sh) — не править здесь. */"
    case $f in *.c) echo "#define PANEL_IN_CTRL 1" ;; esac
    cat "$SRC/$f"
  } > "src/panel/$f"
done
echo "src/panel: $(ls src/panel | wc -l) файлов"
