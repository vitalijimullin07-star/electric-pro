#!/bin/sh
# Интерфейс пульта → WebAssembly для симуляции в Plata (clang с целью wasm32 и wasm-ld).
# Результат: vacuum-panel.wasm. Импорты: phal_uart_write, phal_log.
set -e
cd "$(dirname "$0")"
CC=${CC:-clang}
EXPORTS="sim_setup sim_frame ui_loop ui_touch ui_rx"
FLAGS=""
for e in $EXPORTS; do FLAGS="$FLAGS -Wl,--export=$e"; done
$CC --target=wasm32 -O2 -std=c11 -Wall -Wextra -Wno-unused-parameter \
  -nostdlib -ffreestanding -fno-builtin-memset \
  -Wl,--no-entry -Wl,--allow-undefined -Wl,--export-memory -Wl,-z,stack-size=65536 $FLAGS \
  -o vacuum-panel.wasm panel_ui.c gfx.c fonts.c sim_wasm.c
echo "vacuum-panel.wasm: $(wc -c < vacuum-panel.wasm) байт"
