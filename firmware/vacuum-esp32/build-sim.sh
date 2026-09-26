#!/bin/sh
# Ядро прошивки → WebAssembly для симуляции в Plata (нужен clang с целью wasm32 и wasm-ld).
# Результат: vacuum-esp32.wasm (кладётся в проект как прошивка для симуляции).
set -e
cd "$(dirname "$0")"
CC=${CC:-clang}
EXPORTS="vac_setup vac_loop vac_tick vac_on_pin vac_serial vac_uart vac_command vac_status_json sim_buffer"
FLAGS=""
for e in $EXPORTS; do FLAGS="$FLAGS -Wl,--export=$e"; done
$CC --target=wasm32 -O2 -std=c11 -Wall -Wextra -Wno-unused-parameter \
  -nostdlib -ffreestanding -fno-builtin-memset \
  -Wl,--no-entry -Wl,--allow-undefined -Wl,--export-memory -Wl,-z,stack-size=32768 $FLAGS \
  -o vacuum-esp32.wasm vac_core.c vac_link.c vac_drv.c sim_wasm.c
echo "vacuum-esp32.wasm: $(wc -c < vacuum-esp32.wasm) байт"
