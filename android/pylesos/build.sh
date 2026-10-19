#!/bin/sh
# Сборка APK «Пылесос S3» без Gradle: aapt2 → javac → d8 → zipalign → apksigner.
#   ANDROID_HOME — Android SDK (platforms;android-35, build-tools;35.0.0), по умолчанию /root/android-sdk
#   PYLESOS_KEY_PASS — пароль ключа подписи (release.jks.enc зашифрован им же; тот же, что у архива заметок).
#                      Без него — подпись временным ключом (поставить можно, обновить поверх подписанного — нет).
# Интерфейс собирается из src/pylesos/apk (vite.apk.config.ts), голос — firmware/vacuum-s3/voice/mp3.
# Готовый файл: android/pylesos/build/pylesos.apk (копию кладите в корень сайта: pylesos.apk).
set -e
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
SDK=${ANDROID_HOME:-/root/android-sdk}
BT=$SDK/build-tools/35.0.0
JAR=$SDK/platforms/android-35/android.jar
CODE=$(sed -n 1p version.txt)
NAME=$(sed -n 2p version.txt)
B=build
rm -rf $B/gen $B/classes $B/dex $B/res.zip $B/*.apk $B/assets
mkdir -p $B/gen/ru/pylesos/app $B/classes $B/dex $B/assets/voice

# 1. Интерфейс (страница) и голос
(cd "$ROOT" && npx vite build -c vite.apk.config.ts --logLevel warn)
cp -r "$ROOT/android/pylesos/build/www" $B/assets/www
cp "$ROOT"/firmware/vacuum-s3/voice/mp3/*.mp3 $B/assets/voice/

# 2. Ресурсы и манифест
cat > $B/gen/ru/pylesos/app/BuildInfo.java <<EOF
package ru.pylesos.app;
/** Создано build.sh. */
final class BuildInfo {
    static final String VERSION = "$NAME";
}
EOF
"$BT/aapt2" compile --dir res -o $B/res.zip
"$BT/aapt2" link -o $B/app.unaligned.apk -I "$JAR" --manifest AndroidManifest.xml -A $B/assets \
  --min-sdk-version 26 --target-sdk-version 35 --version-code "$CODE" --version-name "$NAME" \
  --java $B/gen -0 wasm -0 mp3 $B/res.zip

# 3. Код
javac -nowarn -encoding UTF-8 --release 17 -classpath "$JAR" -d $B/classes $(find src $B/gen -name '*.java') 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
test -f $B/classes/ru/pylesos/app/MainActivity.class
"$BT/d8" --release --min-api 26 --lib "$JAR" --output $B/dex $(find $B/classes -name '*.class')
python3 - "$B/app.unaligned.apk" "$B/dex/classes.dex" <<'EOF'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(sys.argv[2], 'classes.dex')
EOF

# 4. Выравнивание и подпись
"$BT/zipalign" -f -p 4 $B/app.unaligned.apk $B/app.aligned.apk
if [ -n "$PYLESOS_KEY_PASS" ]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "pass:$PYLESOS_KEY_PASS" -in release.jks.enc -out $B/release.jks
  KS=$B/release.jks; PASS=$PYLESOS_KEY_PASS
else
  echo "ВНИМАНИЕ: нет PYLESOS_KEY_PASS — подпись временным ключом" >&2
  KS=$B/debug.jks; PASS=android
  [ -f $KS ] || keytool -genkeypair -keystore $KS -storetype PKCS12 -storepass $PASS -keypass $PASS -alias pylesos -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=debug" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks $KS --ks-pass "pass:$PASS" --ks-key-alias pylesos --out $B/pylesos.apk $B/app.aligned.apk
rm -f $B/release.jks
"$BT/apksigner" verify $B/pylesos.apk
ls -la $B/pylesos.apk
