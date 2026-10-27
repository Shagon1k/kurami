---
title: Команды и кнопки
summary: Все команды `/kurami`, кнопки карточки запуска и карточки Digest, имена запросов и текстовые команды — с условиями показа и эффектом.
section: reference
group: reference
order: 60
---

Названия кнопок и этапов даны так, как они выглядят в Discord: в коде они английские. Как это работает — на страницах [Управление из Discord](@owner-controls), [Ручное управление](@human-control), [Превью](@previews), [Projects Digest](@project-digest) и [Discord: карточки и команды](@discord-control-plane).

## Команды /kurami

Все команды доступны только владельцу. Верхнеуровневый `/status` занят Hermes, поэтому Kurami использует группу `/kurami`.

| Команда | Где работает | Что делает |
|---|---|---|
| `/kurami status` | внутри треда запуска | Публикует свежую карточку запуска внизу треда, удаляет прежнюю, отвечает ссылкой. Вне треда отказывает |
| `/kurami settings` | сервер проекта | Открывает панель лимитов: System Health, Capacity & WIP, AI triage, Previews. Apply, Undo last и Reset defaults работают, только когда нет активных запусков |
| `/kurami composio-check` | любой канал | Проверяет состояние Composio Session по трём контурам: Broad, Read-only, Automation |

## Кнопки карточки запуска

Кнопка несёт идентификатор `kurami:<действие>:<id запуска>`. Карточка показывает не больше четырёх кнопок в порядке таблицы, остальные лежат в меню **More actions…** (`kurami:run_actions:<id запуска>`). Нажатие ставит запрос указанного вида, контроллер выполняет его на ближайшем цикле.

| Кнопка | Когда показана | Запрос | Что делает контроллер |
|---|---|---|---|
| **Recover interrupted fix** | `needs_attention`, владелец `none`, причина `review_fix_uncommitted_changes`, точная завершившаяся с ошибкой, остановленная и освобождённая задача протокола, полный сохранённый контекст ревью | `recover_interrupted_review_fix` | сохраняет незакоммиченную работу и запускает одного нового ограниченного исполнителя для исходного раунда; старую задачу не возобновляет |
| **Retry** | `needs_attention`, владелец `cli`, причина `primary_attempt_failed`; основная сессия в режиме live, ресурсы provisioned, последний нативный ход завершился с ошибкой, есть адаптер повтора, подтверждены бездействующая сессия и идентичность управляемой рабочей копии; нет ожидающего запроса управления/действия с PR, неосвобождённого технического исполнителя, работающего ревью или уже закреплённого повтора этого хода | `retry` | один раз отправляет продолжение в ту же сессию; внимание требуется до наблюдения нового нативного хода; без новой задачи, смены модели и автоматического повтора отправки |
| **Recover delivered fix** | запуск в `needs_attention`, владелец `cli`, причина `review_fix_uncommitted_changes` | `recover_managed_task` | перепроверяет сохранённую задачу, запушенный коммит и свежий CI, доводит исправление |
| **Take control** | владелец `cli`, идёт управляемая сессия, запуск не в `needs_attention` | `take_control` | `handoff`: просит Codex остановиться, ждёт тихой паузы, отпускает tmux; запуск `remote_owned` |
| **Take control** | владелец `none`, состояние `parked_review` или `waiting_human` | `take_control` | `claim_remote`: владелец становится `remote`, на карточке ссылка Open session |
| **Continue autonomously** | запуск `remote_owned`, владелец `remote` | `take_control` | `successor_start`: новая управляемая задача Codex в той же рабочей копии |
| **Start preview** | у проекта есть превью, аренды нет, запуск на ревью или под управлением владельца, известны PR и его точный наблюдаемый head | `preview_start` | выдаёт слот, затем собирает превью |
| **Remove preview** | аренда в любом состоянии, кроме released | `preview_stop` | снимает маршрут, останавливает стек, освобождает слот |
| **Extend 24h** | превью работает, до конца меньше двух часов | `preview_start` | `preview_extend`: срок плюс 24 часа |
| **Mark reviewed** | превью работает и не отмечено | прямой вызов, без очереди | записывает отметку проверки на аренде |
| **Attempt CI fix** | `parked_review`, CI `failed` или `missing`, попыток меньше двух | `ci_repair` | `repair_start`: новая задача Codex на точный упавший коммит |
| **Run review → General / Clarity / Spec** | запуск припаркован и без владельца, известны PR и коммит, выбранный профиль не в очереди, не работает и не имеет готового ревью этого коммита | `ai_review`, выбранный профиль | `review_start`: независимый ревьюер только для чтения публикует ревью в GitHub; другой профиль может независимо ждать в очереди или работать |
| **Fix findings** | готовое ревью текущего коммита содержит замечания, нет ревью в очереди или работе | `review_fix`, все профили | `review_fix_start`: одна новая задача Codex исправляет актуальные замечания General, Clarity и Spec и нерешённые потоки владельца; потоки закрываются после подтверждения CI |
| **Cancel run** | отмена ещё не начата | `stop` | `request_stop`: остановка, освобождение ресурсов, задача в Backlog |
| **Discard local work** | этап «Cancelled — local work preserved», PR нет | подтверждение, затем `discard_local` | `discard_cancelled`: удаляет неопубликованную рабочую копию и ветку |
| **Close draft PR & discard** | тот же этап, есть черновой PR | подтверждение, затем `discard_published` | `discard_published_cancelled`: закрывает точный черновой PR и удаляет ветки |

Discord предлагает **Recover interrupted fix** только при `review_fix_uncommitted_changes`. Projects также поддерживает защищённое восстановление после управляемого тайм-аута (`review_fix_runtime_budget_exceeded`); эта более широкая возможность не означает наличия кнопки Discord для тайм-аутов.

Запрос `ci_repair` также допускает защищённую вторую попытку из `needs_attention`, владелец `none`, причина `ci_repair_no_new_head`: ровно одна завершённая первая попытка не дала нового head; её задача протокола успешно завершена, остановлена, освобождена и архивирована; основной тред восстановлен; свежий CI (наблюдение не старше двух минут) всё ещё падает на том же исходном SHA. Не должно быть конкурирующего запроса управления, действия с PR, исполнителя записи, ревью/исправления, преемника, более нового запуска или ожидающего перехода статуса. При захвате права записи перепроверяются чистая зарегистрированная рабочая копия, локальный/удалённый head, идентичность открытого PR и отсутствие другого исполнителя записи. Расходуется оставшаяся попытка без стирания первого результата. Кнопка Discord **Attempt CI fix** по-прежнему ограничена `parked_review`.

Кнопка **Fix findings** несёт идентификатор `kurami:review_fix_all:<id запуска>`; обработчик Discord ставит в очередь `review_fix` с `--all-reviews`. У этого действия нет выбора профиля.

Кнопки подтверждения видны только тебе и живут две минуты: **Discard preserved local work** (`kurami:discard_local:…`) и **Close draft PR & discard** (`kurami:discard_published:…`).

## Ответы на нажатия

| Ответ | Значение |
|---|---|
| «<Действие> queued. The live card will update after reconciliation.» | запрос записан |
| «<Действие> is already queued (`pending`).» | такой запрос уже ждёт обработки |
| «Control rejected safely: …» | условие не выполнено, ничего не изменилось |
| «This Kurami control is not authorized for your account.» | нажал пользователь не из списка разрешённых |
| «Autonomous continuation queued…» | подтверждён Continue autonomously |
| «Preview reviewed. TTL and lifecycle are unchanged.» | отметка проверки записана |

## Виды запросов

Строка запроса живёт в `run_control_requests`. Состояния: `pending`, `processing`, `applied`, `rejected`, `failed`. На одно действие приходится один активный запрос; для `ai_review` разрешён один запрос на профиль.

Это направленные проверки при постановке в очередь против существующих запросов `pending`/`processing`, а не симметричная или исчерпывающая гарантия совместимости. Ниже **запросы записи** — `review_fix`, `recover_managed_task` и `recover_interrupted_review_fix`. Запросы того же действия дедуплицируются, а не отклоняются как конфликты разных действий.

| Входящий запрос | Кнопки, которые его ставят | Существующие запросы, проверяемые на конфликт |
|---|---|---|
| `take_control` | Take control, Continue autonomously | запросы записи, `retry` |
| `preview_start` | Start preview, Extend 24h | запросы записи, `retry`, `preview_stop` |
| `preview_stop` | Remove preview | запросы записи, `retry`, обрабатываемый `preview_start`; ожидающий `preview_start` можно вытеснить |
| `stop` | Cancel run | исключение из этой проверки конфликтов разных действий, в том числе с ожидающим `retry`; остальные проверки безопасности сохраняются |
| `discard_local`, `discard_published` | кнопки подтверждения | запросы записи, `retry` |
| `ci_repair` | Attempt CI fix | запросы записи, `retry`; защищённая вторая попытка без нового head также требует отсутствия других ожидающих/обрабатываемых запросов управления |
| `ai_review` | Run review → General / Clarity / Spec | запросы записи, `retry`; другой профиль ревью независим |
| `review_fix` | Fix findings | запросы записи, `retry`, `take_control`, `ci_repair`, `ai_review` |
| `recover_managed_task` | Recover delivered fix | запросы записи, `retry`, `take_control`, `ci_repair`, `ai_review` |
| `recover_interrupted_review_fix` | Recover interrupted fix | запросы записи, `retry`, `take_control`, `ci_repair`, `ai_review`; проверка восстановления также требует отсутствия других ожидающих запросов управления |
| `retry` | Retry | любой другой ожидающий/обрабатываемый запрос управления |

Допуск в очередь не разрешает последующую отправку без повторной проверки. При исполнении/захвате права записи перепроверяются состояние и доказательства для конкретного действия; Retry перед единственной отправкой сверяет точную сессию, неудачный ход, идентичность панели и Git head. Stop — исключение из проверки конфликтов при постановке в очередь, а не способ обойти проверки перед исполнением.

## Кнопки карточки Digest

| Кнопка | Когда показана | Эффект |
|---|---|---|
| **Accept batch** | пакет `ready` или `discussing` | принимает оставшиеся предложения, пакет `accepted`, запись в очереди; в GitHub ничего не пишется |
| **Review proposals** | пакет `ready` или `discussing` | открывает список для тебя |
| **Discuss batch** | пакет `ready` или `discussing` | создаёт один тред обсуждения, пакет `discussing` |
| **Skip batch** | пакет `ready` или `discussing` | пропускает пакет, тред архивируется |
| **Review approved batch** | пакет `accepted` | показывает принятые предложения |
| **Review sync result** | пакет `applied`, `partially_applied` или `failed` | показывает итог записи |
| **Retry sync** | пакет `accepted`, две попытки записи неудачны | ставит запись в очередь заново |

В списке **Review proposals** доступны: меню исключения («Exclude selected proposals from this batch»), меню возврата («Restore excluded proposals»), **Accept remaining** и **Previous**/**Next** для страниц по 12 предложений. Исключить все предложения нельзя — для этого есть Skip batch.

## События в треде

| Событие | Когда появляется |
|---|---|
| Ready for review | запуск ждёт ревью, сессия свободна |
| Preparation is ready for you | задача с меткой `human-control` подготовлена и передана тебе |
| Preview is ready | превью прошло проверки здоровья |
| Preview failed | сборка или проверка превью упала |
| CI failed, Required CI check is missing | CI коммита красный или нет обязательной проверки |
| Agent approval blocked | Codex запросил разрешение, которое Kurami не выдаёт |

## Текстовые команды

Агент Hermes понимает те же действия словами: Status, Retry, Take control, Continue autonomously, Attempt CI fix, AI Code Review, Fix Review, Recover delivered fix, Recover interrupted fix, Start preview, Stop preview, Cancel run, Discard local work, Close draft PR and discard, Open session, Show controls. Задачу можно назвать полным id запуска, ключом `TT-42` или `PF-33` либо написать в треде запуска. Удаление сохранённой работы агент выполняет только после явного второго подтверждения.


## Подтвердить решение владельца

Прочитай controls текущего запуска и возьми `owner_decision_identity` как `<token>`. Сначала ответь с настроенной учётной записи OWNER в точном обсуждении Kurami в ревью PR. Устаревший токен или изменённый ответ требуют нового подтверждения.

```sh
node src/orchestrator/controls/run.ts controls --project <project> --issue <number>
node src/orchestrator/controls/run.ts request --run-id <run_id> --action decision_ready --decision-token <token> --via cli --apply
```
