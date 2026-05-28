Electric Pro — V27.3 Active Base Lock

Назначение:
- Исправляет выбор активной базы для нового V27 picker.
- Если в разделе «База данных» выбрана «БД сервера», то «Работа» и «Материалы» на главном экране должны открываться из БД сервера.
- Если выбрана «БД моя», то подбор должен открываться из Моей БД.

Что трогает:
- core/top-status-v27.js — только версия.
- modules/database/database-gateway-v27.js — единый источник активной базы.
- modules/database/database-picker-v27.js — перед открытием заново читает активную базу.
- assets/js/database-v26-surgical-monolith.js — зеркалит выбор БД в ключи V27.
- index.html — обновляет cache-busting.

Что НЕ трогает:
- пул розеток;
- щит;
- админку;
- подписки;
- Firebase rules/functions.
