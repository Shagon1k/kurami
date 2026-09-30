---
title: How Daily is built
nav: How Daily is built
summary: From Telegram channels, mail, calendar and weather to an accepted draft: the agent's single step and the eleven states of the morning attempt.
section: digest
group: internals
order: 10
next: daily-publication
---

A Daily build is one *attempt*: a record in the database that passes eleven states in order, and in that chain the agent performs exactly one step. Code does the rest: it reads the sources, freezes the batch of posts, validates the draft and assembles the edition. The attempt saves every state it reaches, so after a failure the build continues from the last one.

:::glance
- What it does: turns everything unread this morning into an accepted draft and an edition ready to publish for the date
- Started by: the Hermes job `kurami-daily-briefing`, 09:00 local time, recovery window at 10:00
- Where it runs: the agent calls runtime commands (`cli.js`) and Telegram MCP tools
- State: a row in `briefing_run_attempts` and the folder `$KURAMI_HOME/state/briefing/runs/<attempt>/`
- Result for you: the page `/daily/<date>` and a Discord card that walks up to "Выпуск готов" (edition ready)
:::

```diagram
kind: graph
title: The morning build: from sources to an accepted draft
desc: An attempt starts with the start-attempt command. The runtime reads live data and Telegram MCP freezes the batch of posts. The agent writes the draft, the checks accept or return it, then assembly produces the edition and stores it as prepared.
node start "Attempt" "start-attempt" start at 0,0
node live "Live data" "mail, calendar, weather" at 1,0
node cap "Capture" "Telegram MCP" at 2,0
node draft "Draft" "written by the agent" actor at 2,1
node gates "Checks" "text, topics, coverage" at 1,1
node compose "Assembly" "order, add-ons, signals" at 0,1
node files "runs/attempt/" "attempt files" store at 1,2
node db "briefing.db" "prepared edition" store at 0,2
edge start -> live
edge live -> cap "snapshot"
edge cap -> draft "post ledger"
edge draft -> gates
edge gates -> draft "rejected" accent
edge gates -> compose "accepted"
edge compose -> db "prepared"
edge cap -> files "frozen" dashed
```

## Sources

Daily reads four sources, each in its own way.

| Source | What is taken | How it is read |
|---|---|---|
| News | Unread posts of 15 Telegram channels | The Telegram MCP server reads the channels through your account |
| Mail | Unread Gmail Primary messages (`in:inbox is:unread category:primary`) | Composio, read only, up to 20 pages of 100 messages |
| Calendar | The day's events from three calendars | Composio, read only |
| Weather | Current weather and a two-day forecast | Open-Meteo, plain HTTPS without keys |

News comes from Telegram because "unread" is a queue Telegram already has: every channel keeps its own read boundary. Kurami keeps no cursor of its own. That is why channels are marked read only at the end, after publication ([Publication and recovery](@daily-publication)). The Composio session for reading is limited to a list of seven tools, so nothing can be changed through it. Every call is retried up to three times with a 12-second timeout; a failure of mail or weather does not stop the attempt, it makes the edition "partial".

## Freezing the batch

The capture fixes which posts belong to today's edition and never moves that boundary again. For each channel the `capture_daily_briefing_batch` tool reads the unread count and the id of the newest message — the *upper boundary*. It then collects messages from the last read one up to that boundary, at most 200 per channel. Posts that arrive after the boundary stay unread for tomorrow's edition.

Each channel gets a status: `empty` (nothing to read), `ready` (exactly as many collected as are unread), `partial` (fewer collected) or `failed` (the dialog is unavailable). The result is written to `telegram-raw.json`, then albums are merged into `telegram-normalized.json`: messages sharing a `grouped_id` become one post, and images are separated from other attachments. Finally `validate-telegram-batch` compares three id lists — declared, collected and normalized. A capture is *complete* only if every channel is `ready` without gaps or `empty`. Only a complete capture moves the attempt to `capture-validated`; with an incomplete one the build stops here.

## The agent's single step

The agent reads the batch and writes `editorial-draft.json` — that is all of its creative work. It gets the batch in pages of 50 posts through `read_daily_briefing_batch_page`. For each story it gives `sourceItemIds` (which posts went in), a headline and a short retelling in Russian, `details` paragraphs, topics with canonical English ids and four ratings: importance, urgency, public interest, confidence. Posts that did not become a story are listed in `exclusions` with one reason: `non-content`, `exact-duplicate`, `unsafe` or `unreadable`. It may also override mail classes.

The agent first writes the draft without notes and runs `rank-preview`: the runtime applies all checks and prints the final order. Then the agent adds Kurami notes — exactly `min(6, max(1, ceil(stories / 5)))`, at most one per five consecutive stories. That way the notes point at real places in the feed, not at the draft's order.

## Checks and assembly

The `compose` command turns the draft into one edition, and it is plain code. It checks that a headline and summary do not copy the source, that every post belongs to exactly one story or exclusion, and that topics are valid ([Choosing and ordering news](@news-selection)). Then it gives each story the id `story-` plus the first 16 characters of the sha256 of its post list and applies live data: mail, calendar, weather. The `deterministic-v1` ranking computes the order, and Signals are derived from the accepted data. The finished `payload.json` is checked once more, and only then does the attempt reach `editorialized`.

The edition is stored in one format: `formatVersion: 3` with an `addons` map, where each add-on has its own envelope with state, time and data. News sits in the `news` envelope together with the capture boundaries, `sourceBatches`.

## Eleven states

| State | Moved by | Card label |
|---|---|---|
| `created` | `start-attempt` | Подключаю источники (connecting sources) |
| `live-collected` | `collect-live` | Почта, расписание и погода собраны (mail, schedule and weather collected) |
| `telegram-captured` | Telegram MCP after writing the batch | Telegram-пачка получена (Telegram batch received) |
| `capture-validated` | `validate-telegram-batch`, only on a complete capture | Проверяю и объединяю материалы (checking and merging) |
| `editorialized` | `compose` | Сюжеты подготовлены (stories ready) |
| `prepared` | `render-preview` | Собираю изображения (collecting images) |
| `media-ready` | `import-media` or `media-ready` | Изображения готовы (images ready) |
| `commit-planned` | `telegram-commit-plan` | Завершаю Telegram-гигиену (finishing Telegram hygiene) |
| `telegram-committed` | `finalize` | Публикую страницу (publishing the page) |
| `published` | `finalize` | Выпуск готов (edition ready) |
| `notified` | `notify-release` or the guard | Выпуск готов (edition ready) |

States go strictly in order: skipping or going back is not allowed, and repeating the current state changes nothing. From any state the attempt can move to `failed`. The last seven states are passed by the `finish_daily_briefing` tool, described in [Publication and recovery](@daily-publication).

::::example Attempt daily-2026-10-01--scheduled
:::steps
- **Runtime** — creates the attempt and the folder `runs/daily-2026-10-01--scheduled/`. The runtime reads 37 emails, 5 events and the weather into `live-snapshot.json`.
- **Telegram MCP** — 11 of 15 channels have unread posts. Channel `space-news` has 9 posts, with upper boundary message 48211. In total 212 posts, 58 of them with images.
- **Agent** — merges posts 48211 and 48208 into one story. The runtime gives it the id `story-3fa2c19b7d40e5a1`.
- **Agent** — leaves 6 posts in exclusions as `non-content`. Total: 206 posts in 41 stories plus 6 exclusions — all 212 accounted for.
- **Runtime** — 41 stories need `min(6, ceil(41/5))` = 6 notes. `compose` accepts the draft and the attempt becomes `editorialized`.
:::
The data is invented; file names and rules come from the code.
::::

A fragment of the draft for that story:

```json title="editorial-draft.json"
{
  "sourceItemIds": ["telegram:space-news:48211", "telegram:space-news:48208"],
  "headline": "Зонд передал первые снимки кольца новой планетной системы",
  "topics": [{"id": "space", "label": "Space"}, {"id": "science", "label": "Science"}],
  "signals": {"importance": "medium", "urgency": "none", "publicInterest": "high", "confidence": "high"}
}
```

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| Composio or Open-Meteo did not answer | The section gets status `failed` with no invented data and the edition is marked "partial"; the next hourly poll fills it | Nothing |
| A channel is unavailable or fewer posts were collected than are unread | The capture is incomplete, `capture-validated` is not reached, the build stops; the retry at 10:00 reuses the same frozen batch | You look at the red card; a new capture is an operator decision |
| The draft fails the checks | `rank-preview` and `compose` return the list of violations; `compose` deletes its output and the attempt stays at `capture-validated` | Nothing: the agent fixes the draft in the same window |
| The agent finished early | The guard records `agent_returned_incomplete` and the attempt continues at 10:00 | Nothing |
| Telegram MCP is unavailable | The agent records an infrastructure failure, not a "successful empty run" | You repair the Telegram connection in Hermes |
| `capture_daily_briefing_batch` is called again | Returns the files already saved (`reused: true`); the boundary does not move | Nothing |

:::guarantees
- The agent writes only the draft; the order, ids, page and publication are made by code.
- Every post of the batch belongs to exactly one story or one exclusion — otherwise `compose` refuses.
- The batch boundary is frozen once and survives retries and the recovery window.
- The capture marks nothing read and downloads no images.
- The composer rejects an incomplete capture and a draft that copies its source.
- Data is collected through a read-only Composio session; the agent does not call general Composio tools.
:::

:::code-map
- `src/briefing/run-attempt.ts` — the attempt, its states and transition rules
- `src/briefing/live-collector.ts` — `collect-live`, the live data snapshot
- `integrations/hermes/connectors/telegram_stdio_wrapper.py` — batch capture, pages, download, marking read
- `src/briefing/telegram-batch.ts` — capture completeness check
- `src/briefing/composer.ts` — assembles the edition from the draft, batch and live data
- `src/briefing/addons/news/editorial.ts` — stories, ids, capture boundaries
- `src/briefing/coverage.ts` — "every post exactly once"
- `integrations/hermes/skills/kurami-daily-briefing/SKILL.md` — what the agent is told
:::
