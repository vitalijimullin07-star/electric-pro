# V29.26 Firebase Structure Inspector

Добавлен безопасный standalone-инструмент `tools/firebase-structure-inspector.html`.

Он:
- читает структуру Firestore через обычный Firebase Web SDK;
- работает только после входа Google;
- ничего не записывает;
- не деплоит rules/functions;
- показывает `permission-denied`, если текущие правила не дают читать коллекцию;
- формирует отчёт для дальнейшего проектирования полной Firebase-связки.
