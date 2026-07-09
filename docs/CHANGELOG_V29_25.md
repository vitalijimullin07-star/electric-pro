# V29.25 Admin Boundaries Core

Что сделано:
- Админка стала понятнее по зонам ответственности.
- Раздел БД помечен как зона Claude, без неясных путей и без нашей логики записи.
- Предпросмотр в карточке пользователя переименован в «Данные для Firebase Console».
- Добавлена кнопка копирования короткого ТЗ для Claude по БД.
- Добавлен CSS-модуль `assets/css/admin-boundaries.css`.

Не трогалось:
- БД core/ui/storage/adapter.
- router/app-shell/auth/firebase-init.
- visual-settings/sound-feedback.
- firestore.rules/functions.

Firebase deploy не выполняется.
