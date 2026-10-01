---
title: Каталоги, процессы и выкладка
nav: Каталоги и выкладка
summary: Где на сервере лежат код, состояние и секреты, как ограничены сервисы, какой Node закреплён и что нужно сделать после изменения каждой части.
section: platform
group: internals
order: 20
next: health-internals
---

Весь Kurami живёт в одном каталоге — `$KURAMI_HOME`, а всё, что принадлежит Hermes, лежит рядом в `$HERMES_HOME`. Одна точка отсчёта нужна, чтобы не гадать, какая копия кода и состояния «настоящая»: каталог должен быть реальным, а не ссылкой, и определяется в одном месте кода.

:::glance
- Корень: `$KURAMI_HOME`; если переменная не задана, берётся родитель каталога `app/`
- Код: `app/` — обычный checkout ветки `main`; `app/dist/` — собранный Digest
- Состояние: `state/` — базы, JSON-файлы, блокировки; секреты — `secrets/` с правами 0600
- Процессы: пять постоянных сервисов и два таймера под `systemd --user`
- Runtime: закреплённый Node 24, Caddy, age, LibreSpeed в `runtime/`
- Выкладка: руками — обновить checkout, собрать и перезапустить то, что затронуто
:::

## Каталоги

```diagram
kind: graph
title: Что лежит в $KURAMI_HOME
desc: В корне лежат код app, закреплённые программы runtime, конфигурация, изменяемое состояние, секреты, копии, архивы восстановления, журналы и коннекторы. Из них только state, backups, recovery и logs растут во время работы.
node app "app" "код и dist" at 0,0
node runtime "runtime" "Node, Caddy, age" at 1,0
node config "config" "копия deploy/config" at 2,0
node state "state" "базы, JSON, замки" store at 0,1
node secrets "secrets" "права 0600" at 1,1
node connectors "connectors" "Composio, Telegram" at 2,1
node backups "backups" "14 снимков" store at 0,2
node recovery "recovery" "3 архива" store at 1,2
node logs "logs" "журналы заданий" store at 2,2
group home "$KURAMI_HOME" app runtime config state secrets connectors backups recovery logs
```

| Каталог | Что внутри | Кто пишет |
|---|---|---|
| `app/` | репозиторий; `dist/` — результат `npm run briefing:build` | ты, вручную |
| `runtime/` | Node v24, Caddy, age, `tools/librespeed-cli`, uv | ты, при установке |
| `config/` | копии `orchestrator.yaml`, `projects.yaml`, `Caddyfile`, `briefing.yaml` | ты, из `deploy/config/` |
| `state/` | см. таблицу ниже | задания и сервисы |
| `secrets/` | токены GitHub, `recovery.env`; значения не читает ни один документ | ты |
| `connectors/` | `.env` трёх сессий Composio и данные Telegram MCP | скрипты коннекторов |
| `backups/` | `backup-<UTC>/`: снимки баз, файлы настроек, манифест | задание бэкапа |
| `recovery/` | `kurami-recovery-<UTC>.tar.zst.age` и `.sha256` | задание бэкапа |
| `logs/` | `*.log` и `*.jsonl` по подсистемам | скрипты; удаляются через 90 дней |

## Что лежит в `state/`

Файлы JSON — небольшие, записываются атомарно (временный файл и переименование) с правами 0600.

| Файл или каталог | Что хранит | Пишет | Читает |
|---|---|---|---|
| `orchestrator.db` | Run Store | Project Orchestrator | здоровье, Hub (только чтение), бэкап |
| `system-health.db` | цикл здоровья: измерения, серии, ожидающие сообщения тревог | сборщик здоровья | доставка здоровья, Hub (только чтение), бэкап |
| `hub/control-audit.jsonl` | короткая запись на каждое действие Controls в Hub | Hub | ты, для проверки |
| `briefing/` | база Digest, страницы, медиа | Digest | сайт Digest |
| `human-docs/` | `release/`, `rollback-<sha>/`, `proposals.db`, черновики | воркер документации | сервер документации |
| `caddy/routes.caddy` | маршруты превью | сборка маршрутов | Caddy |
| `cpu-statistics.json` | до 1440 замеров CPU | сэмплер | проверка здоровья |
| `network-speed.json` | последний замер скорости | задание скорости | проверка здоровья |
| `runtime-health-*.json`, `system-health-*.json`, `health-settings.json` | проекции цикла здоровья, id карточки, интервал проверки | сборщик и доставка здоровья; интервал — `/kurami settings` или Hub | проверка здоровья и плагин (подробнее — [Как работает мониторинг](@health-internals)) |
| `*.lock` | блокировки заданий | обёртки через `flock` | они же |

Блокировка — пустой файл: скрипт берёт её командой `flock` без ожидания и, если она занята, тихо выходит. Так пересекающиеся запуски не мешают друг другу. Общая блокировка `project-event-consumer.lock` держится на весь проход «события, контроллер, уведомления», а блокировки опроса и Projects Digest — свои.

## Сервисы systemd

Все сервисы работают от твоего пользователя (`systemd --user`) и получают одинаковый набор ограничений, а различаются только тем, куда им можно писать.

| Сервис | Порт | Куда может писать | Особенность |
|---|---|---|---|
| `kurami-briefing` | 8787 | `state/briefing` | `node --jitless`, собранный `dist/`, `MemoryDenyWriteExecute` |
| `kurami-human-docs` | 8799 | никуда | стартует, только если есть `release/build.json` |
| `kurami-hub` | 8800 | `state`, `connectors`, каталог Codex и домашний каталог Hermes | стартует, только если есть `orchestrator.db`; пути записи нужны действиям Controls |
| `kurami-preview-ingress` | 9180 | `state/caddy` | проверяет конфигурацию перед запуском |
| `kurami-cpu-statistics` | — | `state` | только Unix-сокеты, сети нет |

Ограничения общие: `ProtectSystem=strict` (файловая система только для чтения), `ProtectHome=read-only`, `NoNewPrivileges`, `PrivateTmp`, запрет новых пространств имён, `UMask=0077`. Сервис, который ничего не пишет, например сервер документации, не получает ни одного `ReadWritePaths`. У Hub короткий список, потому что его действия обновляют состояние Kurami, рабочие файлы коннекторов, настройки Codex и настройки Hermes; применить изменённый юнит и перезапустить Hub — шаг выкладки.

## Закреплённый Node и два способа запуска

В `runtime/node` лежит одна закреплённая версия Node 24. Digest собирается компилятором в `dist/` и запускается с `--jitless`: его сервис запрещает исполняемую память, а без JIT Node иначе не запустится. Из-за этого глобальный `fetch` там не работает, и Digest ходит в сеть через `node:http`. Всё остальное — здоровье, бэкап, Hub, документация — запускается прямо из TypeScript: Node 24 умеет выполнять `.ts` без сборки.

## Что делать после изменения

```diagram
kind: graph
title: Что перезапускать после правки
desc: Правка кода Digest требует сборки и перезапуска сервиса. Правка остальных скриптов работает со следующего запуска, а для постоянного сервиса нужен перезапуск.
node q1 "Что изменено?" decision at 1,0
node digest "Digest" "npm run briefing:build" at 0,1
node restartD "Перезапуск kurami-briefing" at 0,2
node scripts "Скрипт или CLI" at 1,1
node next "Со следующего запуска" end at 1,2
node svc "Постоянный сервис" at 2,1
node restartS "systemctl --user restart" at 2,2
edge q1 -> digest "src/briefing"
edge q1 -> scripts "задание"
edge q1 -> svc "Hub, docs, Caddy"
edge digest -> restartD
edge scripts -> next
edge svc -> restartS
```

| Что изменилось | Команда | Вступает в силу |
|---|---|---|
| Digest (`src/briefing`, `src/core`) | `npm run briefing:build`, `systemctl --user restart kurami-briefing` | после перезапуска; сторож, опрос и Investment Review используют тот же `dist/` |
| Скрипт задания Hermes, плагин Discord или скиллы | копируются вручную или скриптами синхронизации, см. [Kurami и Hermes](@hermes-integration) | скрипты — со следующего запуска, скиллы — со следующей агентной сессии, плагин — после перезапуска `hermes-gateway` |
| Код, который вызывают задания (здоровье, бэкап, контроллер) | обновить checkout | при следующем запуске |
| Hub, документация, сэмплер CPU | обновить checkout и `systemctl --user restart <сервис>` | после перезапуска |
| Сайт документации | сборка `docs-release` и продвижение в `release/` (обычно через карточку предложения) | после перезапуска `kurami-human-docs` |
| Библиотека UI | `npm run ui:export` | обновляет пакет скилла |

GitHub Actions на каждый PR запускает типы, проверку заявления о влиянии на документацию и полный набор тестов, но ничего не выкладывает.

::::example Правка карточки Digest (данные выдуманы)
:::steps
- **Ты** — сливаешь PR, меняющий `src/briefing/ui/components/reaction-group.ts`, коммит `7f3a9c2`.
- **Ты** — в `$KURAMI_HOME/app` подтягиваешь `main`, запускаешь `npm run briefing:build`: компилятор обновляет `dist/briefing/ui/...`.
- **Ты** — перезапускаешь `kurami-briefing`: сервис читает новый `dist/` с порта 8787.
- **Systemd** — `ExecStartPre` выполняет `cli.js init`, затем сервис подхватывает базу без потери данных.
- **Часовой опрос** — в :37 запускает уже собранный `dist/briefing/poller.js`, то есть тоже новый код.
:::
::::

## Что может пойти не так

| Ситуация | Что делает Kurami | Что делаешь ты |
|---|---|---|
| Забыл `briefing:build` | сервис продолжает работать на старом `dist/` | собрать и перезапустить |
| Обновил checkout, а сервис не перезапущен | постоянный сервис работает со старым кодом в памяти, задания — уже с новым | перезапустить сервис |
| Нет `release/build.json` | `kurami-human-docs` не стартует | продвинуть релиз документации |
| Нет `orchestrator.db` | `kurami-hub` не стартует | `npm run db:init` или восстановление из бэкапа |
| Каталог `$KURAMI_HOME` переименован или подменён ссылкой | пути в скриптах не находятся | вернуть реальный каталог |

:::guarantees
- У `$KURAMI_HOME` одно определение, и его нельзя заменить ссылкой.
- Сервисы пишут только туда, где это разрешает их юнит: документация — никуда, Hub — только в пути, нужные его действиям.
- Все файлы состояния закрыты правами 0600, JSON записывается атомарно.
- Код приложения не обновляет сам себя: выкладка — ручное действие.
:::

:::code-map
- `src/core/kurami-home.ts` — определение `$KURAMI_HOME`
- `tsconfig.briefing-runtime.json` — что попадает в `dist/`
- `deploy/systemd/` — все сервисы и таймеры
- `deploy/config/` — конфигурация, которая копируется в `config/`
- `integrations/hermes/scripts/` — скрипты заданий и их блокировки
- `run-project-poller.sh` — пример блокировок опроса и общего потребителя
- `.github/workflows/regression.yml` — проверки на каждый PR
:::


## Lifecycle технических Codex-задач

CI repair и review fix выполняются отдельным Codex app-server worker. Launcher сохраняет tmux как supervisor процесса, но завершение определяется событием сохранённого thread и turn, а не текстом экрана. Основной writer и Remote handoff остаются на прежнем TUI-пути. При остановке, timeout и ошибке инициализации сохраняется identity задачи; ownership освобождается только после подтверждённого выхода процесса.
