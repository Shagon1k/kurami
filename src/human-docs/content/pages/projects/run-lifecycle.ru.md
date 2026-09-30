---
title: Жизненный цикл запуска
nav: Жизненный цикл
summary: Все состояния запуска, кто и почему переводит его из одного в другое, и три поля, которые вместе описывают, где запуск находится.
section: projects
group: internals
order: 40
next: codex-sessions
---

Запуск — это одна строка в таблице `runs`: одна попытка сделать одну задачу. Где эта попытка находится, описывают три поля: `state`, `owner_state` и `stop_reason`.

:::glance
- Что это: конечный автомат запуска в Run Store, десять реально используемых состояний
- Кто меняет: допуск, контроллер и его дочерние скрипты, каждый в своей транзакции
- Где записано: `runs.state`; каждая смена — строка в `run_state_history` с причиной
- Конечные состояния: `rejected`, `cancelled`, `archived`
- Параллельно: `owner_state` (кто держит Codex) и `stop_reason` (зачем останавливаем)
- Что видно: стадия карточки запуска в Discord
:::

```diagram
kind: graph
title: Состояния запуска
desc: Запуск начинается с admission_pending или сразу с rejected. Дальше он идёт через starting в running, затем либо в parked_review на паузу ревью, либо в remote_owned, когда ты забираешь сессию. Сбои ведут в needs_attention. Завершение и отмена идут через stopping в archived или cancelled.
node adm "admission_pending" "допущен" state at 0,0
node starting "starting" "копия" state at 1,0
node running "running" "Codex" state at 2,0
node remote "remote_owned" "у тебя" state at 3,0
node rej "rejected" "отказ допуска" fail at 0,1
node attn "needs_attention" "решение" wait at 1,1
node parked "parked_review" "пауза ревью" state at 2,1
node note "из любого живого" note at 3,2
node stopping "stopping" "завершение" state at 2,2
node archived "archived" "слито" end at 1,3
node cancelled "cancelled" "отменён" end at 3,3
edge adm -> starting "копия"
edge adm -> rej "лимиты"
edge starting -> running "Codex"
edge running -> parked "ход готов"
edge running -> remote "handoff"
edge parked -> remote "Continue"
edge remote -> running "сам" dashed
edge running -> attn "сбой" accent
edge attn -> parked "возврат" dashed
edge parked -> stopping "Done, Cancel"
edge note -- stopping
edge stopping -> archived "слито"
edge stopping -> cancelled "отмена"
edge stopping -> attn "блок" accent
```

## Три поля

`state` говорит, на каком этапе запуск. `owner_state` говорит, кто сейчас держит задачу Codex: `none` — никто, `cli` — управляемая tmux-сессия Kurami, `remote` — ты в приложении Codex. `stop_reason` — намерение остановки: пусто, `cancelled` (отмена) или `completed` (Done). Отмена сильнее всего: запуск с `stop_reason = cancelled` нельзя оживить ни переносом в Human Review или Done, ни кнопкой Take control. Поэтому причина остановки хранится отдельно от состояния: после сбоя контроллер читает её и продолжает отмену.

Ещё два поля помогают читать запуск: `execution_mode` (`live` или `dry_run`) и `interaction_policy` (`autonomous` или `human_control`).

## Состояния

| Состояние | Что значит | Из чего и как |
|---|---|---|
| `admission_pending` | Запуск допущен, ресурсы только запланированы | Допуск: событие прошло проверки |
| `rejected` | Допуск отказал из-за WIP или защиты ресурсов. Конечное, ресурсов нет | Допуск |
| `starting` | Рабочая копия создаётся или готова, Codex ещё не запущен | Создание копии |
| `running` | Codex работает в tmux, владелец `cli` | Запуск сессии; Continue autonomously из `remote_owned` |
| `parked_review` | Пауза ревью: карточка в Human Review или Codex закончил автономный ход | Освобождение сессии; перенос карточки в Human Review |
| `remote_owned` | Задачу Codex забрал ты, владелец `remote` | Передача управления; Continue in Codex |
| `needs_attention` | Автоматика остановилась и ждёт решения | Сбой копии, таймаут, запрос разрешения Codex, блокировка релиза |
| `stopping` | Идёт завершение или отмена: закрыть сессию, убрать превью, освободить копию | Перенос в Done, Backlog или Deferred; Cancel run |
| `archived` | Завершён, слияние доказано, ресурсы освобождены. Конечное | Релиз |
| `cancelled` | Отменён, ресурсы освобождены. Конечное | Релиз или подтверждённое удаление сохранённой работы |

Состояния `handoff_pending`, `waiting_human` и `failed` разрешены схемой базы, но код их не записывает. «Preparing human control» на карточке — стадия карточки, а не состояние запуска. Как стадии выглядят в Discord — в [Управлении из Discord](@owner-controls).

## Кто и когда переводит запуск

| Переход | Кто и по какому условию | Причина в истории |
|---|---|---|
| → `admission_pending` | Допуск: все проверки пройдены | `activation_event_admitted` |
| → `rejected` | Допуск: WIP или защита ресурсов | `wip_limit_rejected`, `resource_guard_rejected` |
| → `starting` | Создание копии: начало | `worktree_provisioning_started` |
| → `needs_attention` | Создание копии: ошибка git | `worktree_provisioning_failed` |
| `starting` → `running` | Запуск Codex | `codex_initial_turn_started` |
| `running` → `parked_review` | Освобождение сессии: ход закончен | `codex_cli_park_completed` |
| `running` → `remote_owned` | Передача управления | `codex_cli_handoff_completed` |
| `parked_review` → `remote_owned` | Continue in Codex, сессии нет | `remote_claim_completed` |
| `remote_owned` → `running` | Continue autonomously: свежая задача Codex | `autonomous_successor_claimed` |
| любой живой → `parked_review` | Допуск: карточка перенесена в Human Review | `owner_moved_item_to_human_review` |
| `running` → `needs_attention` | Запрос разрешения Codex две минуты подряд | `codex_waiting_on_approval` |
| любой → `needs_attention` | Превышен лимит времени: 240 минут основной исполнитель, 90 минут техническая задача | `…_runtime_budget_exceeded` |
| любой живой → `stopping` | Перенос в Done (`stop_reason = completed`) | `owner_moved_item_to_done` |
| любой живой → `stopping` | Перенос в Backlog или Deferred либо Cancel run (`stop_reason = cancelled`) | `owner_moved_item_out_of_active` |
| `stopping` → `archived` | Релиз: слияние доказано | `merged_worktree_release_completed` |
| `stopping` → `cancelled` | Релиз: чистая отмена | `clean_worktree_release_completed` |
| `stopping` → `needs_attention` | Релиз заблокирован: незамёрженная работа или грязная копия | `worktree_release_blocked` |
| `needs_attention` → `cancelled` | Подтверждённое удаление сохранённой работы | `cancelled_local_work_discarded` |

Запуск, у которого нет физических ресурсов (режим `dry_run` или ресурсы только запланированы), при Done или отмене минует `stopping` и сразу становится `archived` или `cancelled`. Из `needs_attention` выходят по-разному: после исправления ревью запуск возвращается в `parked_review`, после ухода запроса разрешения — в `running`, при отмене — в `cancelled`.

## Состояние ресурсов

Ресурсы запуска (`run_resources.resource_state`) живут по своему автомату и идут вместе с запуском.

```diagram
kind: graph
title: Состояние ресурсов запуска
desc: Ресурсы сначала запланированы, затем создаются и становятся provisioned. При завершении они освобождаются через releasing в released. Ошибка создания или освобождения оставляет ресурсы в partial.
node planned "planned" "имена записаны" state at 0,0
node provisioning "provisioning" "создаются" state at 1,0
node provisioned "provisioned" "копия готова" state at 2,0
node releasing "releasing" "удаляются" state at 3,0
node released "released" "освобождено" end at 3,1
node partial "partial" "частично создано" fail at 1,1
edge planned -> provisioning "создание"
edge provisioning -> provisioned "готово"
edge provisioning -> partial "ошибка" accent
edge provisioned -> releasing "релиз"
edge releasing -> released "готово"
edge releasing -> partial "ошибка" accent
```

Из `partial` автоматика ничего не чинит: запуск остаётся в `needs_attention`. Cancel run переводит его в `stopping`, а релиз принимает ресурсы в `partial` и убирает то, что успело создаться.

::::example Путь запуска TT-42
:::steps
- **Допуск** — создаёт `r_26d6bafe366257202f23`: `admission_pending`, ресурсы `planned`.
- **Контроллер** — `worktree_provisioning_started`: `starting`, `provisioning`; затем ресурсы `provisioned`.
- **Контроллер** — `codex_initial_turn_started`: `running`, владелец `cli`.
- **Контроллер** — `codex_cli_park_completed`: `parked_review`, владелец `none`.
- **Ты** — в 11:20 переносишь карточку в Done: `stopping`, `stop_reason = completed`.
- **Контроллер** — `merged_worktree_release_completed`: `archived`, ресурсы `released`. Если слияния ещё нет, запуск остаётся в `stopping`, а релиз каждую минуту отвечает «ждём слияния».
:::
::::

## Что может пойти не так

| Ситуация | Что делает Kurami | Что делаешь ты |
|---|---|---|
| Сбой посреди создания копии | Запуск в `needs_attention`, ресурсы `partial`. Жёсткий обрыв прямо между захватом и записью оставляет `starting` с ресурсами `provisioning`: правила контроллера такой запуск не подхватывают | Нажми Cancel run, если карточка уже в `needs_attention`; иначе разбери вручную |
| Done до слияния | Запуск остаётся в `stopping`, релиз повторяется каждую минуту | Слей PR |
| Отмена при незамёрженной работе | `needs_attention` с `stop_reason = cancelled`, работа сохранена | Discard local work или Close draft PR & discard с подтверждением либо слей |
| Состояние изменилось во время шага | Шаг отказывается, контроллер планирует заново | Ничего |

:::guarantees
- Каждая смена состояния записывается в `run_state_history` с причиной: история только дописывается.
- Запуск с намерением отмены нельзя оживить переносом карточки или кнопкой.
- Запуск попадает в `archived` только когда слияние доказано.
- У одной карточки одновременно не бывает двух живых запусков.
:::

:::code-map
- `migrations/001_initial_run_store.sql` — допустимые состояния и индекс «один живой запуск»
- `src/orchestrator/projects/process-project-events.ts` — допуск, Human Review, Done, отмена по событию
- `src/orchestrator/runtime/automatic-plan.ts` — правила следующего шага
- `src/orchestrator/runtime/controller-execution.ts` — внутренние переходы: `claim_remote`, `request_stop`
- `src/orchestrator/projects/worktrees/provision.ts` — `starting` и `partial`
- `src/orchestrator/projects/worktrees/release.ts` — `archived`, `cancelled`, блокировка релиза
- `src/orchestrator/projects/sessions/runtime-budget.ts` — лимиты времени
:::
