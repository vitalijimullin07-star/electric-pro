# V29.27 Visual Firebase Sync Core

- Добавлена синхронизация настроек визуала через Firestore.
- Путь хранения: `users/{uid}/settings/visual`.
- localStorage остаётся локальным кэшем: `ep_visual_settings_clean_v5_3`, `ep.visual.v29`.
- На втором устройстве визуал загружается из Firebase после входа.
- На странице настроек добавлена панель ручной синхронизации.
- Firebase Rules/Functions не менялись, deploy не выполняется.
- БД Claude не трогается.
