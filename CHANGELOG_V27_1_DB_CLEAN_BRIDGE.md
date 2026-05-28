# V27.1 DB Clean Bridge

## Добавлено
- `core/top-status-v27.js` — единая верхняя строка подписки/ИИ.
- `modules/database/database-gateway-v27.js` — единый источник активной базы: `my` / `server`.
- `modules/database/database-picker-v27.js` — новый выбор материалов/работ с главного экрана.
- `docs/DB_ARCHITECTURE_V27_1.md` — описание текущего шага архитектуры БД.

## Изменено
- Из `index.html` отключены старые слои:
  - `electric-pro-v26-16-status-and-main-fix.js`;
  - `electric-pro-v26-15-main-db-pick-estimate.js`.
- `pages/main.html` переключён на `EPDatabasePickerV27`.
- `database-v26-6-subscription-balance-sync-ui.js` теперь отдаёт отрисовку верхней строки в `EPTopStatusV27`, если он загружен.

## Не тронуто
- Старый рабочий редактор БД `database-v26-surgical-monolith.js`.
- Firebase sync БД.
- Пул розеток.
- Админка.
- Подписка и ИИ-баланс как данные Firestore.
- Щит.
