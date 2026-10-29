#!/bin/sh
# Монтажка «Пылесос S3 на макетке»: одна страница с заказом, цветами провода, этажами и списком проводов.
# Детали и цепи — из плат этажерки (import/vacuum-s3-stack-*.plata.json), раскладка — layout.py.
#   sh tools/maketka/build.sh   → maketka.html в корне сайта (потом npm run build — для работы без сети)
set -e
cd "$(dirname "$0")/../.."
PY=${PYTHON:-python3}
export PYTHONDONTWRITEBYTECODE=1
W=$(mktemp -d)
STACK_DUMP="$W/dump" npx vitest run tests/vacuum-s3-stack.test.ts -t "выгрузка" > "$W/vitest.log"
$PY tools/maketka/build.py "$W/dump" maketka.html
rm -r "$W"
