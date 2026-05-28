Electric Pro V26.5 — Firebase DB Sync

Установка через Termux:
cd /sdcard/Download/ep
unzip -o ../db-v26-5-firebase-sync.zip
cd db-v26-5-firebase-sync
chmod +x install_termux_local.sh
bash install_termux_local.sh

После push:
https://vitalijimullin07-star.github.io/electric-pro/?fresh=265

Если Firebase пишет permission-denied:
обновить Firestore Rules через Ubuntu/Firebase CLI файлом:
FIRESTORE_RULES_DB_V26_5.rules
