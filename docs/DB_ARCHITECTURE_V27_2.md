# DB Architecture V27.2

V27.2 исправляет конфликт между старым монолитным экраном БД V26 и новым выборщиком позиций V27.

## Правило

Полный экран БД открывается только при явном маршруте/кнопке «База данных».

Подбор позиции для сметы открывается только через:

```text
modules/database/database-picker-v27.js
```

## Главный экран

Карточки должны быть без inline onclick:

```html
<div data-ep27-pick="material" data-ep27-db-picker="material">Материалы</div>
<div data-ep27-pick="work" data-ep27-db-picker="work">Работа</div>
```

## Почему нельзя inline onclick

Старый V26 route guard проверял атрибут `onclick` и если там было слово `database`, открывал всю БД. Поэтому `onclick="window.EPDatabasePickerV27..."` ломал поведение.

## Дальше

Следующий шаг V27.3 — отделить database-picker от legacy V26 окончательно и сделать чистый database-store/database-sync.
