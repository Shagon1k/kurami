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
| **Recover delivered fix** | запуск в `needs_attention`, владелец `cli`, причина `review_fix_uncommitted_changes` | `recover_managed_task` | перепроверяет сохранённую задачу, запушенный коммит и свежий CI, доводит исправление |
| **Take control** | владелец `cli`, идёт управляемая сессия, запуск не в `needs_attention` | `take_control` | `handoff`: просит Codex остановиться, ждёт тихой паузы, отпускает tmux; запуск `remote_owned` |
| **Continue in Codex** | владелец `none`, состояние `parked_review` или `waiting_human` | `take_control` | `claim_remote`: владелец становится `remote`, на карточке ссылка Open in Codex |
| **Continue autonomously** | запуск `remote_owned`, владелец `remote` | `take_control` | `successor_start`: новая управляемая задача Codex в той же рабочей копии |
| **Start preview** | у проекта есть превью, аренды нет, запуск на ревью или у тебя | `preview_start` | выдаёт слот, затем собирает превью |
| **Remove preview** | аренда в любом состоянии, кроме released | `preview_stop` | снимает маршрут, останавливает стек, освобождает слот |
| **Extend 24h** | превью работает, до конца меньше двух часов | `preview_start` | `preview_extend`: срок плюс 24 часа |
| **Mark reviewed** | превью работает и не отмечено | прямой вызов, без очереди | записывает отметку проверки на аренде |
| **Attempt CI fix** | `parked_review`, CI `failed` или `missing`, попыток меньше двух | `ci_repair` | `repair_start`: новая задача Codex на точный упавший коммит |
| **AI Code Review** | `parked_review`, PR и коммит известны, этот коммит ещё не ревьюили | `ai_review` | `review_start`: независимый ревьюер только для чтения, ревью публикуется в GitHub |
| **Fix Review** | в актуальном AI-ревью есть замечания | `review_fix` | `review_fix_start`: новая задача Codex правит замечания, закрывает их треды |
| **Cancel run** | отмена ещё не начата | `stop` | `request_stop`: остановка, освобождение ресурсов, задача в Backlog |
| **Discard local work** | этап «Cancelled — local work preserved», PR нет | подтверждение, затем `discard_local` | `discard_cancelled`: удаляет неопубликованную рабочую копию и ветку |
| **Close draft PR & discard** | тот же этап, есть черновой PR | подтверждение, затем `discard_published` | `discard_published_cancelled`: закрывает точный черновой PR и удаляет ветки |

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

Строка запроса живёт в `run_control_requests`. Состояния: `pending`, `processing`, `applied`, `rejected`, `failed`. На одно действие приходится один активный запрос.

| Запрос | Кнопки, которые его ставят | Конфликтует с |
|---|---|---|
| `take_control` | Take control, Continue in Codex, Continue autonomously | `review_fix`, `recover_managed_task` |
| `preview_start` | Start preview, Extend 24h | `preview_stop` |
| `preview_stop` | Remove preview | `preview_start` |
| `stop` | Cancel run | — |
| `discard_local`, `discard_published` | кнопки подтверждения | — |
| `ci_repair` | Attempt CI fix | `review_fix`, `recover_managed_task` |
| `ai_review` | AI Code Review | `review_fix`, `recover_managed_task` |
| `review_fix` | Fix Review | `take_control`, `ci_repair`, `ai_review` |
| `recover_managed_task` | Recover delivered fix | `take_control`, `ci_repair`, `ai_review` |

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
| Codex approval blocked | Codex запросил разрешение, которое Kurami не выдаёт |

## Текстовые команды

Агент Hermes понимает те же действия словами: Status, Take control, Continue in Codex, Continue autonomously, Attempt CI fix, AI Code Review, Fix Review, Recover delivered fix, Start preview, Stop preview, Cancel run, Discard local work, Close draft PR and discard, Open in Codex, Show controls. Задачу можно назвать полным id запуска, ключом `TT-42` или `PF-33` либо написать в треде запуска. Удаление сохранённой работы агент выполняет только после явного второго подтверждения.
