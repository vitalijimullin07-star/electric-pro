# V29.18 Existing Firebase Access Core

Добавлено:
- подключение V29 к Firebase первого проекта `electric-489f7`;
- чтение профиля пользователя из `users/{uid}`;
- чтение подписки из `user_subscriptions/{uid}`;
- чтение ИИ-баланса из `ai_accounts/{uid}`;
- обновление информационной панели главного экрана;
- страница админки в режиме Firebase Console.

Не делается:
- деплой Firestore Rules;
- деплой Cloud Functions;
- запись подписки или ИИ-баланса из V29;
- изменение старого рабочего проекта.
