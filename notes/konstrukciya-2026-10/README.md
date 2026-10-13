# Конструкция: решения октября 2026

`konstrukciya.tgz.enc` — к чему пришли по конструкции пылесоса (заметки, эскизы, скрипты). Зашифровано так же, как
общий архив идей (AES-256, openssl, pbkdf2), пароль тот же — у автора.

Распаковать:

    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in notes/konstrukciya-2026-10/konstrukciya.tgz.enc -pass pass:ПАРОЛЬ | tar -xz -C папка
