# V29.11 Device Feedback Core

Добавлено:
- единый чистый модуль `assets/js/modules/sound-feedback.js`;
- публичный API `window.SoundAPI`, который уже ожидает модуль визуальных настроек;
- поддержка настроек `soundEnabled`, `hapticEnabled`, `soundVolume`, `soundStyle`;
- кнопка «Проверить звук» в настройках теперь получает реальный обработчик;
- виброотклик использует `hapticEnabled`.

Без patch/fix/restore файлов.
