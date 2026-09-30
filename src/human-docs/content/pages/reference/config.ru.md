---
title: Конфигурация
summary: Какие настройки где лежат, что они значат и что из них можно менять кнопкой, а что — только выкладкой.
section: reference
group: reference
order: 50
---

Настройки Kurami живут в трёх местах. **Файлы конфигурации** лежат в репозитории в `deploy/config/`, а на сервере копируются в `$KURAMI_HOME/config/`: они меняются только выкладкой. **Настройки владельца** — лимиты, которые ты меняешь в `/kurami settings`: они хранятся в базе как ревизии поверх значений из файла. **Переменные окружения** задают пути, порты и секреты и в репозиторий не попадают.

## Что можно менять кнопкой

`/kurami settings` меняет только эти значения. Лимиты Project Orchestrator меняются, только когда он простаивает: нет работающих запусков, превью, очередей и технических задач. Интервал проверки здоровья можно менять в любой момент. Каждое изменение записывается ревизией с автором и проверкой целостности, и его можно откатить кнопкой **Undo last**.

| Настройка | Допустимо | По умолчанию | Что ограничивает |
|---|---|---|---|
| Одновременных сессий модели | 1–3 | 1 | Codex и AI-ревью, работающие одновременно |
| Общий WIP | 1–6 | 2 | запусков в активных состояниях на все проекты |
| WIP на проект | 1–3 | 2 | то же для одного проекта |
| AI-оценок задач в день | 0–40 | 12 | предложения Priority и Effort в Projects Digest |
| Слотов превью | 1–6 | 6 | одновременно работающих превью |
| Одновременных сборок превью | 1–2 | 2 | сборок, идущих параллельно |
| Время жизни превью, ч | 6–72 | 24 | когда превью выключится само |
| Интервал проверки здоровья, мин | 5, 10, 12, 15, 20, 30, 60 | 20 | как часто обновляется карточка здоровья |

Проверки не дают поставить противоречивые значения: сессий модели не больше, чем сессий tmux; общий WIP не больше лимита рабочих копий; WIP проекта не больше общего. Значение по умолчанию для интервала здоровья задано в коде, а не в `orchestrator.yaml`.

## orchestrator.yaml

| Ключ | Значение | Что значит |
|---|---|---|
| `mode` | `live` | `dry_run` только записывает решения, `live` разрешает действия |
| `limits.max_tmux_sessions_global` | 3 | жёсткий предел управляемых сессий tmux |
| `limits.max_managed_worktrees_global` / `_per_project` | 6 / 4 | сколько рабочих копий может существовать |
| `limits.disk_warning_percent` / `disk_admission_block_percent` / `disk_emergency_percent` | 75 / 85 / 92 | предупреждение, запрет допуска новых задач, авария |
| `limits.orphan_grace_minutes` | 30 | сколько ждать, прежде чем чужая рабочая копия попадёт в карантин |
| `limits.quarantine_review_after_days` | 7 | когда напомнить о ресурсе в карантине |
| `limits.main_writer_timeout_minutes` / `technical_worker_timeout_minutes` | 240 / 90 | бюджет времени основной сессии Codex и технической задачи |
| `limits.preview_expiry_warning_hours` / `preview_extension_hours` | 2 / 24 | когда появляется **Extend 24h** и на сколько продлевает |
| `limits.min_preview_available_memory_mib` / `min_preview_available_disk_gib` | 4096 / 20 | свободная память и диск для сборки превью |
| `limits.builder_cache_max_used_gib` | 8 | предел кэша сборки Docker для ежемесячной очистки |
| `limits.max_delivery_attempts` | 3 | попыток доставить тревогу в Discord |
| `server_health.cpu_warning_percent` / `cpu_critical_percent` | 85 / 95 | пороги CPU |
| `server_health.memory_warning_percent` / `memory_critical_percent` | 80 / 90 | пороги памяти |
| `server_health.warning_consecutive_checks` / `critical_consecutive_checks` | 3 / 2 | сколько проверок подряд нужно для тревоги |
| `server_health.alert_reminder_minutes` | 120 | как часто напоминать о незакрытой тревоге |
| `discord.*_channel_id` | — | каналы для карточек, тревог и отчётов обслуживания |

## projects.yaml

Одна запись на проект.

| Ключ | Что значит |
|---|---|
| `owner`, `project_number`, `repository`, `status_field` | какая доска GitHub Project и какой репозиторий; поддерживаются доски пользователя |
| `statuses.{backlog,active,review,done,deferred}` | имена пяти колонок доски |
| `human_control_label` | метка, с которой запуск начинается в ручном режиме |
| `workspace.canonical_repository` / `worktree_root` / `base_branch` / `branch_prefix` | эталонный клон, где создавать рабочие копии, основная ветка и префикс вроде `TT` |
| `discord.{guild_id,channel_id}` | канал проекта для карточек запусков |
| `ci.required_checks`, `ci.missing_grace_minutes` | какие проверки CI обязательны и сколько ждать появления отсутствующей |
| `triage.*` | участие проекта в Projects Digest и имена полей Priority и Effort |
| `preview.*` | как собирать превью: Docker Compose или статический каталог, и метка `preview-required` |

Перед подключением проекта запись проверяется командой `npm run readiness -- --project <key> --live`, см. [Подключение проекта](@project-setup).

## briefing.yaml

| Ключ | Что значит |
|---|---|
| `edition.timezone` | часовой пояс выпуска: от него считаются окна 09:00 и 10:00 |
| `edition.daily_retention_days` | сколько дней хранится Daily; код требует ровно 7 |
| `safety.production_mutations_enabled` | разрешает реальную публикацию, отметку прочитанного и уведомления |
| `safety.require_bounded_telegram_commit` | обязан быть `true`: каналы отмечаются прочитанными только в пределах опубликованного |
| `notification.destination` | канал Discord для уведомления о выпуске |
| `sources.mail`, `sources.calendar`, `sources.weather`, `sources.news` | источники: запрос почты, календари, точка погоды и список Telegram-каналов |
| `signals.*` | пороги и включённые правила сигналов |
| `weekly`, `cinema`, `stocks`, `stocksDiscovery`, `investmentReview` | настройки add-ons |

Отдельно в `deploy/config/briefing-topics.yaml` лежат темы новостей и правила их проверки. Некоторые ключи `briefing.yaml` вроде расписаний и флагов уведомлений код сейчас не читает: настоящие расписания заданы в Hermes и systemd, см. [Задания и расписание](@jobs).

## Переменные окружения

| Переменная | Что задаёт |
|---|---|
| `KURAMI_HOME`, `HERMES_HOME` | корневые каталоги Kurami и Hermes |
| `BRIEFING_PORT`, `DOCS_PORT`, `HUB_PORT` | порты сайтов на локальном адресе |
| `KURAMI_BACKUP_RETENTION` | сколько снимков хранить, по умолчанию 14 |
| `KURAMI_BACKUP_MAX_AGE_HOURS` | через сколько часов бэкап считается устаревшим, по умолчанию 84 |
| `KURAMI_RECOVERY_RETENTION`, `KURAMI_S3_RETENTION` | сколько архивов восстановления хранить локально и во внешнем хранилище, по 3 |
| `KURAMI_LOG_RETENTION_DAYS` | после скольких дней журналы удаляются при обслуживании, по умолчанию 90 |

Секреты — токены GitHub и Discord, ключи коннекторов и хранилища — лежат в `$KURAMI_HOME/secrets/` и каталогах коннекторов с правами `0600` и не попадают в репозиторий.
