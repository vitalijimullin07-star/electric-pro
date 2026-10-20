#!/bin/sh
# Интерфейс пульта → WebAssembly для симуляции в Plata (clang с целью wasm32 и wasm-ld).
# Результат: vacuum-panel.wasm и vacuum-panel-hd.wasm (для телефона, кадр втрое крупнее).
# Импорты: phal_uart_write, phal_log.
set -e
cd "$(dirname "$0")"
CC=${CC:-clang}
EXPORTS="sim_setup sim_setup_t35 sim_width sim_height sim_scale sim_frame ui_loop ui_touch ui_rx ui_sleeping"
FLAGS=""
for e in $EXPORTS; do FLAGS="$FLAGS -Wl,--export=$e"; done
$CC --target=wasm32 -O2 -std=c11 -Wall -Wextra -Wno-unused-parameter \
  -nostdlib -ffreestanding -fno-builtin-memset \
  -Wl,--no-entry -Wl,--allow-undefined -Wl,--export-memory -Wl,-z,stack-size=65536 $FLAGS \
  -o vacuum-panel.wasm panel_main.c panel_ui.c panel_s3.c panel_t35.c gfx.c fonts.c qr.c sim_wasm.c
echo "vacuum-panel.wasm: $(wc -c < vacuum-panel.wasm) байт"
# Для приложения на телефоне: тот же интерфейс в кадре втрое крупнее (шрифты — fonts_hd.c, нужен Pillow).
[ -f fonts_hd.c ] || python3 tools/make_fonts.py --hd 3
$CC --target=wasm32 -O2 -std=c11 -Wall -Wextra -Wno-unused-parameter -DPANEL_SCALE=3 \
  -nostdlib -ffreestanding -fno-builtin-memset \
  -Wl,--no-entry -Wl,--allow-undefined -Wl,--export-memory -Wl,-z,stack-size=65536 $FLAGS \
  -o vacuum-panel-hd.wasm panel_main.c panel_ui.c panel_s3.c panel_t35.c gfx.c fonts.c fonts_hd.c qr.c sim_wasm.c
echo "vacuum-panel-hd.wasm: $(wc -c < vacuum-panel-hd.wasm) байт"
