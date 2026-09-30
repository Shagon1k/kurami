---
title: Signals
nav: Signals
summary: The "На заметку" strip under the edition's figures: eight rules that notice overlapping meetings, mail that needs action and the weather.
section: digest
group: guide
order: 40
next: weekly
---

Signals are up to three short hints under the figures at the top of the page, headed "На заметку" (worth noting). Rules choose them, not the agent: Kurami takes calendar, mail and weather data that has already been accepted and checks it against thresholds. Signals change nothing — they do not archive mail, move meetings or write to Discord. Each hint has a time until which it is shown.

## Eight rules

| Hint | When it appears | Priority |
|---|---|---|
| Встречи пересекаются (meetings overlap) | Two meetings overlap by at least 5 minutes of the remaining time | 10 |
| Письмо ждёт действия (mail waits for action) | An unread ACTION message older than 48 hours | 20 |
| Почта с действием (mail with action) | At least one unread ACTION message | 21 |
| Плотное расписание (dense schedule) | 240 or more busy minutes left today, or three meetings in a row with gaps under 15 minutes | 30 |
| Длинная встреча (long meeting) | A meeting of 120 minutes or more that has not finished | 31 |
| Завтра ранний старт (early start tomorrow) | Tomorrow's first meeting starts before 09:00 | 35 |
| Погода сегодня (weather today) | Chance of rain 60% or more, minimum below 0 °C or maximum 30 °C or more | 40 |
| Завтра заметно холоднее (noticeably colder tomorrow) | Tomorrow's maximum is 8 °C or more below today's | 41 |

The rules fall into four groups: calendar today, calendar tomorrow, mail, weather. Each group keeps one hint, the one with the lower priority number. For example, a meeting overlap displaces "dense schedule" and "long meeting", and "mail waits for action" displaces "mail with action". The first three of what remains are shown.

## When a hint is visible

A hint shows only while its data is fresh: the source is enabled, answered successfully and is at most 180 minutes old. The strip's header shows the time, for example "По данным на 09:37" (as of 09:37). When a meeting ends or the deadline passes, the hint disappears by itself, and an empty strip hides entirely. The strip exists only in the edition for today's date; in older editions, and in a browser without JavaScript, it stays hidden.

So the absence of a signal does not prove there are no messages or overlaps: the data may have gone stale. The freshness of the sources is visible on the "Почта" and "Расписание" blocks themselves.

## How it is configured

Thresholds, the number of hints (1 to 3), the freshness limit and the rule switches live in the `signals` section of `deploy/config/briefing.yaml`. A wrong setting does not break the edition: the strip hides. All keys are described in the [config reference](@config).

:::cards
- [The morning edition](@daily) — where the strip sits on the page
- [Add-ons: the shared contract](@addons) — how Signals attaches to the edition
:::
