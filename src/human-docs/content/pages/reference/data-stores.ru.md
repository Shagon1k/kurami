---
title: Хранилища данных
summary: Каждая таблица обеих баз Kurami — что хранит одна строка, ключевые колонки и связи. Собрано из миграций.
section: reference
group: reference
order: 30
---

У Kurami две SQLite-базы с общей историей миграций: `state/orchestrator.db` у Project Orchestrator и `state/briefing/briefing.db` у Digest. Таблицы ниже собираются при сборке документации: миграции применяются к пустой базе в памяти, и получившаяся схема читается обратно. Описание каждой таблицы лежит рядом с генератором, и сборка падает, если миграция добавила таблицу без описания.

Третья, небольшая база `state/system-health.db` хранит цикл здоровья и ожидающие сообщения тревог. Свои три таблицы она создаёт сама и миграций не имеет, поэтому ниже её нет; см. [Как работает мониторинг](@health-internals).

Где эти базы находятся на диске и какие ещё файлы хранят состояние, объясняет страница [Где живёт состояние](@state-and-truth). Колонки `created_at` и `updated_at` в таблицах не показаны, они есть почти везде.

## orchestrator.db — Project Orchestrator

::generated{name="orchestrator-tables"}

## briefing.db — Digest

::generated{name="digest-tables"}
