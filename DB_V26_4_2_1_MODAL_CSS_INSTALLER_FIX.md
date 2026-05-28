# DB V26.4.2.1 — Modal CSS Installer Fix

## Что было

Установщик V26.4.2 падал с ошибкой Python:
`SyntaxError: closing parenthesis ')' does not match opening parenthesis '('`.

Причина была не в БД, а в сломанной строке Python внутри `install_termux_local.sh`, которая добавляла `<script>` в `index.html`.

## Исправлено

- Переписан установщик без опасной экранировки кавычек.
- CSS-lock подключается последним.
- `#ep-db-v26` принудительно становится fullscreen/fixed.
- Главный экран и бургер не меняются.
