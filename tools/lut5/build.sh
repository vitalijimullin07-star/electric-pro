#!/bin/sh
# Архив этажерки под ЛУТ для мастера: Gerber и PDF 1:1 каждого этажа, памятка PDF.
# Платы — из import/vacuum-s3-lut-f*.plata.json (развести заново — LUT_WRITE=1, см. tests/vacuum-s3-lut.test.ts).
#   sh tools/lut5/build.sh   → import/vacuum-s3-lut.zip
set -e
cd "$(dirname "$0")/../.."
PY=${PYTHON:-python3}
W=$(mktemp -d)
LUT_PACK=1 LUT_HTML="$W/pamyatka.html" npx vitest run tests/vacuum-s3-lut.test.ts -t "архив" > "$W/vitest.log"
node tools/stack-lazer/print-pdf.cjs "$W/pamyatka.html" "$W/Pamyatka.pdf"
$PY -c "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1], 'a', zipfile.ZIP_DEFLATED); z.write(sys.argv[2], 'Pamyatka.pdf'); z.close()" import/vacuum-s3-lut.zip "$W/Pamyatka.pdf"
rm -r "$W"
