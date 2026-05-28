Electric Pro V26.6 — Subscription + Balance + DB Sync UI

Установка через Termux:
cd /sdcard/Download/ep
unzip -o ../db-v26-6-subscription-balance-sync-ui.zip
cd db-v26-6-subscription-balance-sync-ui
chmod +x install_termux_local.sh
bash install_termux_local.sh

После push:
https://vitalijimullin07-star.github.io/electric-pro/?fresh=266

Если подписка/баланс не читаются:
обновить Firestore Rules файлом FIRESTORE_RULES_DB_V26_6.rules через Ubuntu/Firebase CLI.
