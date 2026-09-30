---
title: Digest
nav: Overview
summary: Every morning Kurami gathers your Telegram channels, mail, calendar and weather into one dated edition, then keeps it fresh on its own.
section: digest
group: start
order: 10
next: daily
---

:::glance
- What it does: builds one edition per date — news from Telegram channels, mail, calendar, weather and short signals
- Who starts it: a Hermes job on a schedule, every morning at 09:00 local time
- Rhythm: build in the morning, then refresh the live sections every hour, at :37
- State: the `briefing.db` SQLite database and the finished edition page on disk
- Where you see it: the edition page on the Digest site and one card in Discord
- Your decisions: 🔔/🔕 reactions, the "Прочитать и архивировать" (read and archive) button, manual recovery
:::

Digest is a personal morning newspaper. Every morning Kurami turns everything unread into one edition at `/daily/<date>`: news, mail, the day's meetings and the weather on one page. The news is fixed at the moment of publication, while mail, calendar and weather keep refreshing on their own. The rest of the day you open a finished page and wait for nothing: viewing starts neither a build nor an agent.

## The parts

```diagram
kind: graph
title: Digest in one picture
desc: Telegram channels and external services feed Digest. The Hermes agent writes only the news draft; the runtime validates it, assembles the edition and publishes it to the database. A poller refreshes the live sections, the site serves the page, Discord shows a card.
node tg "Telegram channels" "15 channels, via your account" external at 0,0
node prov "Mail, calendar" "and weather" external at 1,0
node you "You" "read, react" owner at 2,0
node agent "Hermes agent" "writes the news draft" at 0,1
node runtime "Digest runtime" "validates, builds, publishes" at 1,1
node site "Digest site" "edition page and API" at 2,1
node poller "Poller" "live sections, hourly" at 0,2
node db "briefing.db" "editions, attempts, reactions" store at 1,2
node discord "Discord" "one card per date" external at 2,2
group kurami "Kurami on the server" agent runtime site poller db
edge tg -> runtime "posts and images"
edge runtime -> tg "marks them read" dashed
edge prov -> runtime "in the morning"
edge prov -> poller "every hour"
edge agent <-> runtime "draft"
edge runtime -> db "edition"
edge poller -> db "refreshes"
edge db -> site "page"
edge you -> site "you read"
edge site -> db "reactions" dashed
edge runtime -> discord "card"
```

Digest is a daily edition plus several add-ons. **Daily** is the edition itself: news, mail, calendar, weather. **Signals** are short hints under the figures at the top of the page. The other add-ons live on their own pages: [Weekly](@weekly) collects the week's totals, [Cinema](@cinema) is the Saturday film review, [Stocks](@stocks) shows a watchlist, and [Investment Review](@investment-review) adds a portfolio review to it.

## One place for AI

In Digest the agent does exactly one job: it reads the morning batch of posts and writes the news draft — headlines, short retellings, topics and importance ratings. Everything else is ordinary code: it takes data from Gmail, the calendar and Open-Meteo, freezes the batch of posts, validates the draft, computes the order, renders the page, marks channels read and publishes. If the agent writes badly, the code rejects the draft, so a bad edition does not go out. After publication the agent is not needed at all.

## A day in Digest

::::example The edition for 2026-10-01
:::steps
- **Hermes** — at 09:00 local time starts the job. The agent opens the build attempt `daily-2026-10-01--scheduled`, and a card appears in Discord.
- **Runtime** — reads 37 unread emails, 5 calendar events and the weather, then freezes 212 new posts from 11 channels.
- **Agent** — writes the draft: 41 stories and 6 excluded posts.
- **Runtime** — checks every post, computes the order, downloads 58 images and marks the channels read.
- **Runtime** — publishes the edition and edits the card: "Выпуск опубликован" (edition published), with an "Открыть выпуск" (open edition) button.
- **Poller** — at 09:37 and every hour after that, re-reads mail, calendar and weather. The 41 stories do not change.
- **You** — read, press 🔔/🔕, archive mail. Once you have 10 reactions, the "Для меня" (for me) button reorders the feed.
:::
The data in the example is invented; the steps and names come from the code.
::::

## Where to go next

:::cards
- [The morning edition](@daily) — what you see on the page and in Discord
- [For me](@for-me) — how reactions change the order of the news
- [Signals](@signals) — short hints under the figures
- [How Daily is built](@daily-pipeline) — from Telegram channels to the draft and the attempt
- [Publication and recovery](@daily-publication) — attempt states, windows and the guard
- [Choosing and ordering news](@news-selection) — checks, ranking, the interest profile
- [Storage and live sections](@digest-storage) — what lives in the database and how the hourly refresh works
- [Digest add-ons](@addons) — the shared add-on contract and the edition they attach to
:::

:::guarantees
- Viewing the page, reading, reactions and refreshing live sections never start the agent.
- Every captured post lands in exactly one story or in the excluded list.
- Channels are marked read only after validation, and only up to the captured boundary.
- Mail changes in Gmail only when you press "Прочитать и архивировать", and only for the selected messages.
- A failed source is never replaced with invented data: the block shows its last good value with an "outdated" mark.
- Discord gets one card per date: it is edited, not duplicated.
:::

:::code-map
- `src/briefing/cli.ts` — runtime commands: attempt, validation, build, publication
- `src/briefing/composer.ts` — assembles the edition from the draft, the post batch and live data
- `src/briefing/poller.ts` — hourly refresh of live sections
- `src/briefing/server.ts` — the Digest site: pages, API, `/health`
- `integrations/hermes/skills/kurami-daily-briefing/` — the agent's instructions
- `deploy/config/briefing.yaml` — sources, channels, signal thresholds
:::
