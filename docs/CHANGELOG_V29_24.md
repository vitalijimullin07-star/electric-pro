# V29.24 Firebase Database Sync Core

Добавлен общий слой синхронизации БД через Firestore для двух фронтов:
- `electric-pro`
- `electric-pro-refactor`

Firestore-структура:
- `server_database/{itemId}` — общая БД сервера;
- `users/{uid}/my_database/{itemId}` — личная БД мастера.

`localStorage` ключи `epdb26_my` и `epdb26_server` сохранены как быстрый кэш.
Firebase deploy не выполняется. Firestore Rules и Cloud Functions не трогаются.
