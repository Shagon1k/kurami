---
title: The morning edition
nav: Edition
summary: What you see on the edition page and in Discord, what is fixed, what refreshes every hour and what each button does.
section: digest
group: guide
order: 20
next: for-me
---

Every morning you get one page, `/daily/<date>`, and one card in Discord. The page has two kinds of blocks. The news is fixed at the moment of publication: the stories, their order and their images stop changing. Mail, calendar, weather and signals are live: once an hour Kurami re-reads them and updates the page.

## The page from top to bottom

| Block | What it shows | Fixed or live |
|---|---|---|
| Greeting | Title, subtitle and a note from Kurami | fixed |
| Figures | Mail, stories, local time, weather | mail and weather live, the clock ticks in the browser |
| "На заметку" (worth noting) | Up to three short hints ([Signals](@signals)) | live |
| "Расписание" (schedule) | The day's events from three calendars, meeting conflicts | live |
| "Почта" (mail) | Unread Primary mail with classes ACTION, IMPORTANT, GENERAL | live |
| "Новости" (news) | Stories, 10 per page, with images and topics | fixed |
| Teasers | Stocks, cinema, week — when the add-on is on | by the add-on's rules ([add-ons](@addons)) |
| Quality strip | "Источники обновлены" (sources updated) or "Есть оговорки по данным" (data caveats) | recomputed on refresh |

If a source does not answer, the block does not go blank. It keeps the last good data and gets an "outdated" mark with the time of the last success. An empty block without a mark means there is really no data.

## What to press

| Button | What happens |
|---|---|
| **Читать** / **Свернуть** (read / collapse) | Expands the story and marks it read; no build starts |
| **🔔 Больше такого** / **🔕 Меньше такого** (more / less of this) | Records a reaction; a second click clears it |
| **Обзор** / **Для меня** (overview / for me) | Switch the news order ([how it works](@for-me)) |
| **Прочитать и архивировать** (read and archive) | Removes the selected messages from the Gmail inbox and marks them read |
| ↗ on a story | Opens the source post in Telegram |
| An image | Opens it full size |

Archiving mail is the one action on the page that changes something outside Kurami. It applies only to messages you ticked, and it removes them from every saved edition at once.

## The Discord card

::shot{file="shot-daily-card.png" size="card" alt="Discord card: Daily Digest, edition published, story, message and event counts, an Open edition button." caption="A finished card: counters, update time and a link to the edition."}

Kurami keeps one card per date. It appears when the build starts and is edited at every stage: "Подключаю источники" (connecting sources), "Собираю изображения" (collecting images), "Публикую страницу" (publishing the page), up to "Выпуск готов" (edition ready). At the end it holds the counters for news, mail and events and an **Открыть выпуск** (open edition) button. Cinema and the week add **🎬 Cinema** and **📊 Неделя** buttons. The buttons are links only; you cannot control Digest from Discord.

A red card, "Выпуск не опубликован" (edition not published), shows the last finished stage and the reason. You need to do nothing: at 10:00 local time the same build continues from that stage, and the card turns into "Выпуск восстановлен автоматически" (edition recovered automatically). If that window also passes, the reason on the card is `recovery window incomplete`, and the home page keeps the previous edition. Details are in [Publication and recovery](@daily-publication).

## What refreshes every hour

Once an hour, at :37, Kurami refreshes mail, calendar and weather in every saved edition — seven are kept. One call reads the sources for all dates at once. Older editions get the events of their own date and the current mail, while only today's edition shows signals. An edition never recomputes its news, order or reactions. How the refresh runs and what happens on a failure is described in [Storage and live sections](@digest-storage).

## Next

:::cards
- [For me](@for-me) — how reactions reorder the feed
- [Signals](@signals) — the rules behind the "На заметку" hints
- [How Daily is built](@daily-pipeline) — how an edition reaches the page
- [Storage and live sections](@digest-storage) — how the hourly refresh works
:::
