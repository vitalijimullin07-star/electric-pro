# V29.21 Visual Settings Core

## Что сделано
- Возвращена страница `pages/settings.html` с корнем `#visual-settings-root`.
- Возвращены `assets/css/visual-settings.css` и `assets/js/modules/visual-settings.js`.
- Сохранён модуль `assets/js/modules/sound-feedback.js`, чтобы настройки звука/отклика не пропали.
- В `index.html` гарантируется подключение CSS/JS визуальных настроек.
- В `assets/js/core/app-shell.js` гарантируется кнопка меню `🎨 Настройки визуала`.

## Безопасность
- Firestore Rules не меняются.
- Cloud Functions не меняются.
- Основной `electric-pro` не трогается.
- Работа идёт только с `electric-pro-refactor`.
