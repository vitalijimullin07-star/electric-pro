#!/bin/sh
# Архив «этажерки» пылесоса S3 под лазер: файлы гравера, памятка PDF, платы 1:1, проекты плат.
# Нужны python3 с shapely 2, ezdxf и pillow (другой python — PYTHON=python3.13) и Chromium из playwright.
#   sh tools/stack-lazer/build.sh   → import/vacuum-s3-stack-lazer.zip
set -e
cd "$(dirname "$0")/../.."
PY=${PYTHON:-python3}
T=tools/stack-lazer
W=$(mktemp -d)
STACK_DUMP="$W/dump" npx vitest run tests/vacuum-s3-stack.test.ts -t "выгрузка" > "$W/vitest.log"
$PY $T/laser.py "$W/dump" "$W/out/laser"
$PY $T/guide.py "$W/dump" "$W/out/laser" "$W/html"
node $T/print-pdf.cjs "$W/html/guide.html" "$W/out/Sborka-i-podklyuchenie.pdf"
node $T/print-pdf.cjs "$W/html/laser11.html" "$W/out/Lazer-1-k-1.pdf" landscape
$PY $T/pack.py "$W/out" import/vacuum-s3-stack-lazer.zip import/vacuum-s3-stack-upper.plata.json import/vacuum-s3-stack-lower.plata.json import/vacuum-s3-stack-panel.plata.json
rm -r "$W"
