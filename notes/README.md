# Зашифрованный архив идей

`pylesos-idei.tgz.enc` — заметки, расчёты, скрипты моделей и PDF по пылесосу (ячейка фильтра, клапаны, турбины,
потоки, пульт, планы на будущее). Зашифровано AES-256 (openssl, pbkdf2). Пароль хранится у автора, в репозитории его нет.

Распаковать:

    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in notes/pylesos-idei.tgz.enc -pass pass:ПАРОЛЬ | tar -xz -C папка

Обновить: распаковать, дополнить `ZAMETKI.md`, упаковать `tar -czf` и зашифровать тем же паролем (`openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt`).
