#!/bin/sh
# Прошивка контроллера для ESP32-S3 с флешем 8 МБ (N8R8): разметка default_ffat_8MB —
# две программы по 3,2 МБ (обновление с телефона) и FAT 1,5 МБ под «чёрный ящик».
# Готовое — build-8m/: vacuum-s3.ino.merged.bin (целиком с адреса 0), vacuum-s3.ino.bin (для телефона).
set -e
cd "$(dirname "$0")"
CLI=${ARDUINO_CLI:-/root/tools/arduino-cli}
"$CLI" compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=8M,PSRAM=opi \
  --build-property build.partitions=default_ffat_8MB --build-property upload.maximum_size=3342336 \
  --output-dir build-8m .
