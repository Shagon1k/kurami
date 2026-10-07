---
title: Run Store
nav: Run Store
summary: Единственная база, в которой Kurami хранит всё о запусках: ключевые таблицы, защиты на уровне базы и где искать ответ, когда что-то пошло не так.
section: projects
group: internals
order: 110
next: projects-decisions
---

Run Store — это один файл SQLite, `$KURAMI_HOME/state/orchestrator.db`, и единственная память Project Orchestrator. Процессы живут секунды и ничего не помнят между запусками, поэтому всё, что система знает о запуске, лежит здесь.

:::glance
- Что это: SQLite в режиме WAL, все таблицы `STRICT`, время в ISO-8601 UTC
- Кто пишет: опрос доски, допуск, контроллер, дочерние скрипты, Discord-плагин, уведомители
- Схема: 32 миграции в `migrations/`, применяются командой `npm run db:init`
- Ключевое правило: все внешние ключи `ON DELETE RESTRICT`; строки не удаляются
- Правда о намерении: доска GitHub; Run Store хранит факт и ресурсы
- Бэкап: отдельная задача, раз в три дня
:::

```diagram
kind: graph
title: Главные таблицы Run Store
desc: Карточки доски и события хранятся отдельно. Событие порождает запуск, у запуска есть строка ресурсов, журнал смен состояния и очередь команд владельца.
node items "project_items" "project · item_id · status · present" entity at 0,0
node events "project_events" "event_id · from · to · processing_state" entity at 1,0
node runs "runs" "run_id · state · owner_state · stop_reason" entity at 1,1
node resources "run_resources" "worktree · branch · tmux · thread" entity at 0,1
node history "run_state_history" "sequence · from · to · reason" entity at 2,1
node requests "run_control_requests" "action · request_state · idempotency_key" entity at 1,2
edge items -> events "смена колонки"
edge events -> runs "trigger_event_id"
edge runs -> resources "run_id"
edge runs -> history "run_id"
edge runs -> requests "run_id"
```

## Как устроено хранение

База открывается в каждом процессе заново. Каждый шаг берёт запись, проверяет состояние и меняет его в транзакции `BEGIN IMMEDIATE`: пишущий процесс один, остальные ждут до пяти секунд. Так шаги пересекаются безопасно: у каждого своя проверка «состояние не изменилось». Таблицы историй (`run_state_history`) только дописываются, а внешние ключи запрещают удалять то, на что есть ссылки. Поэтому запуск, событие и команда не теряют связь. Состояния запуска описаны в [Жизненном цикле](@run-lifecycle).

Решения хранятся вместе с причинами. Событие, которое допуск проигнорировал, остаётся с пометкой `processing_note`; отказ остаётся строкой `runs` в состоянии `rejected` с `rejection_reason`. Так «почему не стартовало» всегда читается из базы.

## Защиты на уровне базы

Часть правил держит сама база. Их нельзя обойти ошибкой в коде.

| Защита | Что гарантирует |
|---|---|
| `runs_one_live_item_idx`: уникальный `(project, item_id)`, если состояние не `rejected`, `cancelled`, `archived` | У одной карточки не больше одного живого запуска |
| `runs.trigger_event_id` уникален | Одно событие создаёт не больше одного запуска |
| Идентификатор события — sha256 от перехода | Одно изменение колонки не попадёт в очередь дважды |
| `run_control_requests_one_pending_action_idx`: уникальный `(run_id, action)` среди `pending` и `processing` | Не бывает двух одинаковых команд в очереди; `idempotency_key` тоже уникален |
| Уникальны `worktree_path`, `branch_name`, `tmux_session_name` в `run_resources` | Два запуска не делят копию, ветку или сессию |
| `CHECK` на состояниях и перечислениях | В `state`, `owner_state`, `stop_reason` нельзя записать неизвестное значение |

## Какая таблица отвечает на какой вопрос

| Вопрос | Таблица |
|---|---|
| Что сейчас на доске и когда карточку видели в последний раз? | `project_items` |
| Удался ли последний опрос? Сколько осталось лимита GitHub? | `project_poll_state` |
| Что произошло на доске и что допуск сделал с переходом? | `project_events` (`processing_state`, `processing_note`) |
| В каком состоянии запуск, кто держит Codex, почему отказ? | `runs` |
| Где ветка, копия, tmux-сессия, тред Codex? | `run_resources` |
| Почему и когда запуск сменил состояние? | `run_state_history` (`reason`, `details_json`) |
| Что ты нажал и чем кончилась команда? | `run_control_requests` (`result_json`) |
| Что говорит CI по точному коммиту? | `run_ci_snapshots` |
| Какие лимиты действуют сейчас и кто их менял? | `orchestrator_setting_revisions` |
| Почему допуск блокируется? | `resource_quarantines`, `resource_guard_events` |
| Какое превью занимает слот? | `preview_leases`, `preview_slots` |

Полный список таблиц с описанием строки — в [справочнике хранилищ](@data-stores). Смотреть базу можно только на чтение: `sqlite3 -readonly $KURAMI_HOME/state/orchestrator.db`. Менять её вручную нельзя: состояние запуска согласовано с Git, tmux и GitHub, и правка одной базы разойдётся с миром.

## Миграции

Схема растёт файлами `migrations/NNN_name.sql`. Команда `npm run db:init` применяет новые по порядку, каждую в своей транзакции, записывает имя в `schema_migrations` и в конце проверяет `PRAGMA integrity_check`. Для таблиц с ограничениями миграция переименовывает старую таблицу в `<имя>_vNN`, создаёт новую и копирует данные: такие остатки в базе нормальны. Сейчас применено 32 миграции, от `001_initial_run_store` до `032_review_fix_reconciliation`.

::::example Что найти в базе по задаче TT-43
:::steps
- **Ты** — спрашиваешь, почему TT-43 не стартовала.
- **Ты** — находишь в `runs` строку задачи: состояние `rejected`, `rejection_reason = WIP limit reached: global 2/2, project 1/2`.
- **Ты** — в `run_state_history` видишь причину `wip_limit_rejected` с числами в `details_json`; ресурсов в `run_resources` нет.
- **Ты** — в `project_events` видишь событие с `processing_note = Rejected by WIP gate`.
:::
::::

## Что может пойти не так

| Ситуация | Что делает Kurami | Что делаешь ты |
|---|---|---|
| База занята дольше пяти секунд | Шаг завершается ошибкой, следующая минута повторяет. Неудачное ожидание и транзакция дольше секунды записываются в `logs/sqlite-locks.jsonl` с процессом и местом в коде | Ничего; если ошибки частые, лог покажет, кто держит базу |
| Процесс убит посреди транзакции | SQLite откатывает её, база цела | Ничего |
| Состояние базы разошлось с Git или tmux | Защита ресурсов находит расхождение и блокирует допуск | Разбери ресурс; базу руками не правь |
| Повреждение базы | Проверка целостности в health-задаче сообщает о проблеме | Восстанови из бэкапа: [Восстановление](@recovery) |

:::guarantees
- Строки Run Store не удаляются, а история только дописывается.
- Каждый шаг меняет состояние в транзакции и сначала проверяет, что оно не изменилось.
- Правила «один запуск на карточку» и «одно событие — один запуск» держит база, а не только код.
:::

:::code-map
- `src/orchestrator/state/init-run-store.ts` — применение миграций, WAL, проверка целостности
- `src/orchestrator/state/database.ts` — открытие базы для записи: общие настройки и замер блокировок
- `migrations/001_initial_run_store.sql` — события, запуски, ресурсы, история
- `migrations/002_project_snapshots.sql` — снимок доски и здоровье опроса
- `migrations/006_run_controls.sql` — очередь команд владельца
- `migrations/028_resource_guardrails.sql` — карантин ресурсов
- `migrations/030_runtime_settings.sql` — ревизии настроек
- `src/orchestrator/runtime/run-read-model.ts` — запрос, собирающий факты о запуске
:::
