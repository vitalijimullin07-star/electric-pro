# Pool V22.1 — Route Fix + Auth Log Dedupe

По диагностике V22 уже загружен: `pool-v22-ready`.

Исправления:

- карточка/меню «Пул розеток/штроб» принудительно открывает `PoolV22CleanMonolith.open()`;
- старые функции открытия пула перекинуты на V22;
- если случайно открылся старый `ep-pool-v21-screen`, он закрывается;
- дубли `auth-restored` и `auth-persistence-local` фильтруются.
