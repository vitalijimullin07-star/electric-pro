# DB V26.6 — Subscription + Balance + Sync UI

## Исправлено

- Верхняя строка подписки/баланса теперь подтягивается из Firestore.
- Проверяются документы:
  - `users/{uid}`
  - `user_subscriptions/{uid}`
  - `subscriptions/{uid}`
  - `ai_balances/{uid}`
  - `ai_wallets/{uid}`
  - `token_balances/{uid}`
- V26.5 sync-layer отключается, чтобы не плодить повторные auth-listeners и не вызывать лёгкие подвисания.
- Внутри БД добавляется строка:
  - загрузка из Firebase;
  - выгрузка в Firebase;
  - синхронизировано;
  - ошибка доступа.

## Firestore Rules

Если подписка/баланс не читаются, обновить правила:

`firebase-rules-snippets/FIRESTORE_RULES_DB_V26_6.rules`
