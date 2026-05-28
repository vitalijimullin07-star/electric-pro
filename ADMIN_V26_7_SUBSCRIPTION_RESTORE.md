# Admin V26.7 — Subscription Panel Restore

## Что восстановлено

Блок админ-панели `Управление подпиской`:

- выбор мастера;
- тариф:
  - Базовая;
  - С ИИ;
  - Тест 2 дня;
- срок:
  - 2 / 30 / 90 / 180 / 360 дней;
- ИИ режим:
  - API сервера / баланс;
  - API клиента;
  - ИИ выключен;
- баланс ИИ в рублях;
- отключение подписки.

## Куда пишет

Подписка:

- `user_subscriptions/{uid}`
- `subscriptions/{uid}`
- `users/{uid}.subscription`

ИИ баланс:

- `ai_balances/{uid}`
- `ai_wallets/{uid}`
- `token_balances/{uid}`
- `users/{uid}.ai`

## Если Missing or insufficient permissions

Нужно обновить Firestore Rules файлом:

`firebase-rules-snippets/FIRESTORE_RULES_ADMIN_V26_7.rules`
