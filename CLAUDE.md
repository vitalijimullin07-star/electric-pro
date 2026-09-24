# Заметки для разработки Plata

- Интерфейс, тексты и комментарии на русском, в предложениях обычный регистр.
- Стек: TypeScript (strict), Vite, React 19, zustand + immer, vitest. Без других фреймворков.
- Все размеры в модели — миллиметры, ось Y вниз, углы в градусах (положительный — против часовой на экране).
- Проект (`src/core/model/types.ts`) — простой сериализуемый объект. Изменения только через `commit` в store (immer) либо функциями `src/core/model/edit.ts` на свежем объекте. Кеши связности, DRC и геометрии привязаны к объекту проекта через WeakMap: после правок «на месте» (в тестах) делайте `structuredClone`.
- Ядро (`src/core`) не знает про React и DOM: его можно запускать в воркере и в Node.
- Слои названы как в KiCad (`F.Cu`, `B.Cu`, `F.Silk`, `Edge.Cuts`…), см. `src/core/model/layers.ts`.
- Корпуса в библиотеке (`src/core/library`) — параметрические генераторы. Новый корпус: функция в `generators/*.ts`, добавить в `all*()`, размеры из даташита, `verified: true` только если сверено. Тест `tests/library.test.ts` проверит площадки, габарит и уникальность.
- После изменений: `npm run check` (типы + тесты). Если трогали автотрассировку или связность — `npm test -- tests/router.test.ts` обязательно (плата пылесоса должна разводиться без ошибок).
- Меняя формат проекта, добавьте миграцию в `src/core/io/project-file.ts` (`migrateProject`).
- Пример платы пылесоса переносится из старого формата в `src/core/io/legacy-plata.ts`; данные — `src/core/examples/vacuum-controller`.
- Сайт https://vitalijimullin07-star.github.io/electric-pro/ — GitHub Pages из корня ветки `main`. Корневой `index.html` и `router.worker-*.js` — собранный редактор (генерирует `npm run build`), исходная страница — `app.html`. После любых изменений кода: `npm run build` и закоммитить обновлённый `index.html`, иначе CI упадёт.
