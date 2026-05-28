# Electric Pro V27.2 — main picker route guard

## Fixed
- «Материалы» и «Работа» на главном экране больше не должны открывать полный экран БД.
- Убран inline onclick с названием `EPDatabasePickerV27`, из-за которого старый V26 route guard видел слово `database` и открывал БД.
- Старые V26 обработчики БД теперь игнорируют элементы V27 picker: `[data-ep27-pick]`, `[data-ep27-db-picker]`, `.ep27-picker`.

## Not changed
- Пул розеток.
- Щит.
- Админка.
- Подписки.
- Firebase-данные.
