# Pool V22.7 — Stable Monolith

## Что сделано

Рабочая цепочка пула собрана в один файл:

```text
assets/js/pool-v22-clean-monolith.js
```

Внутрь объединены рабочие слои:

- V22.2 core;
- route fix;
- Android back/home menu;
- safe DB picker;
- manual candidate picker;
- version guard.

## Что удалено из index.html

Отдельные подключения:

- pool-v22-2-force-route.js;
- v22-3-back-home-menu-fix.js;
- pool-v22-4-db-picker.js;
- pool-v22-5-safe-db-picker.js;
- pool-v22-5-1-force-safe-picker.js;
- pool-v22-6-manual-db-candidate-picker.js;
- pool-v22-6-1-version-lock-fix.js;
- pool-v22-6-2-pool-version-guard.js.

## Что должно работать

- открытие пула;
- Android назад;
- кнопка «Главный экран»;
- расчёт черновой;
- безопасный подбор из БД;
- предупреждение по отличию размера;
- ручной выбор кандидата;
- удаление/очистка без падения версии.
