# Структура доступа через Firebase Console

На этом этапе V29 только читает данные из существующего Firebase первого проекта.
Управление выполняется вручную через Firebase Console или старую рабочую админку.

## users/{uid}

- uid: string
- email: string
- name / displayName: string
- role: "admin" | "master"
- status: "approved" | "pending" | "blocked"
- isApproved: true/false
- isAdmin: true/false

## user_subscriptions/{uid}

- uid: string
- planId: "basic" | "pro_ai"
- planName: "Базовая" | "С ИИ"
- status: "active" | "trial" | "cancelled"
- expiresAt: Timestamp
- features: object
- storageMode: "last_only" | "full"

## ai_accounts/{uid}

- uid: string
- accessMode: "admin_api" | "own_api" | "disabled"
- allowAi: true/false
- balanceRub: number

## Важное правило

V29 не пишет эти поля напрямую. Это защищает от подделки данных в клиенте.
