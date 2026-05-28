# Electric Pro V27.1 — БД, первый чистовой мост

## Цель

Начать уход от патчей поверх патчей, не ломая рабочую БД.

V27.1 не переписывает редактор БД полностью. Он создаёт понятный мост между текущей рабочей БД V26 и будущей чистой архитектурой V27.

## Новый слой

```text
core/top-status-v27.js
modules/database/database-gateway-v27.js
modules/database/database-picker-v27.js
```

## Что делает `database-gateway-v27.js`

Это единый источник правды для активной базы:

```text
my      = БД моя
server  = БД сервера
```

Он синхронизирует старые и новые ключи:

```text
epdb26_active_base
epdb27_active_base
```

Дальше все новые модули должны брать активную базу только через:

```js
window.EPDatabaseV27.getActiveBase()
window.EPDatabaseV27.setActiveBase('my')
window.EPDatabaseV27.setActiveBase('server')
```

## Что делает `database-picker-v27.js`

Открывает список работ/материалов из активной базы и добавляет выбранные позиции в предварительную смету.

Главный экран должен вызывать:

```js
window.EPDatabasePickerV27.open('material')
window.EPDatabasePickerV27.open('work')
```

## Что пока оставлено старым

Редактор БД пока остаётся:

```text
assets/js/database-v26-surgical-monolith.js
```

Причина: он рабочий и содержит много логики импорта/экспорта/редактирования. Его нужно переписывать отдельным шагом V27.2/V27.3, а не ломать сразу.

## Что отключено

Из `index.html` отключены старые патчи:

```text
assets/js/electric-pro-v26-15-main-db-pick-estimate.js
assets/js/electric-pro-v26-16-status-and-main-fix.js
```

Файлы физически пока не удаляются. Они остаются резервом, но не должны управлять главным экраном.

## Дальше

Следующий этап:

```text
V27.2 — чистовой редактор БД
```

План:

```text
modules/database/database-ui-v27.js
modules/database/database-import-v27.js
modules/database/database-export-v27.js
modules/database/database-admin-v27.js
```

После этого старый `database-v26-surgical-monolith.js` можно будет отключить.
