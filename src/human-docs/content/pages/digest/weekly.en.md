---
title: Weekly
nav: Weekly
summary: What the Sunday review shows, why it has gaps, and how it relates to the «Прочитать и архивировать» button.
section: digest
group: guide
order: 50
next: cinema
---

Weekly is a review of seven completed days, Sunday through Saturday. Kurami builds it not from the sources but from observations that Daily recorded during the week. So the review requests nothing and invents nothing: a day nobody observed stays empty. Every Sunday at 09:00 local time the review appears together with the edition.

## Where to look

The review is available in three places. The Sunday edition carries a short teaser, «Неделя в нескольких цифрах» (the week in a few numbers), with an **Открыть обзор →** (open the review) button. The Discord card gets a **📊 Неделя** (week) button. The page itself is `/weekly`: it shows the latest published review and does not expire until the next Sunday. The address `/preview/weekly` builds a review on the fly for the last seven days and saves nothing; it is labelled «Предпросмотр» (preview). Before the first review, `/weekly` shows a placeholder, «Здесь будет ваша неделя» (your week will be here).

## What the page shows

| Block | Computed from | What it is not |
|---|---|---|
| **Занято в календаре** (busy in calendar) | Timed events, overlaps counted once | Not hours worked and not attendance |
| **Сюжеты в выпусках** (stories in editions) | The number of stories in each saved edition | Not unique events: one story can appear on several days |
| **Архивировано через Daily** (archived through Daily) | Successful presses of «Прочитать и архивировать» | Does not count mail you removed directly in Gmail |
| **Предпочтения** (preferences) | 🔔 and 🔕: the last reaction to each story in the week | Not the interest profile weight; an undone reaction does not count |
| «Что заметила Курами» (what Kurami noticed) | Up to three sentences from fixed rules | A model does not write them |
| Two charts | Calendar minutes and the unread mail balance per day | The balance is not the number of new mails per day |
| «На что вы реагировали» (what you reacted to) | Topics: more, less, balance, previous week | One topic can belong to several stories |

Next to each number there is its coverage, for example "5/7 days". Read a total together with it: "Busy in calendar: 12 h 30 min" at coverage 5/7 is the sum of the five known days.

## A gap is not zero

A day without observations stays *unknown*: on a chart it is a gap, and it takes no part in the sum. Kurami does not turn unknown into zero, because then a week with two lost days would look calm. A comparison with the previous week appears only when both weeks have all seven calendar days observed. If coverage is incomplete, a note «Пока неполная история» (history is still incomplete) sits at the top with three counters: calendar, mail, news.

The first week is always incomplete. Editions are kept for seven days, and the mail balance of a day that was already overwritten cannot be recovered.

## The «Прочитать и архивировать» button

The «Прочитать и архивировать» (read and archive) button is described in [The morning edition](@daily). Weekly counts only its presses: each confirmed action produces one record with the number of mails. If the record fails, the mails are archived anyway: the next hourly poll counts what was missed and never counts one action twice.

## When something is wrong

| Situation | What you see | What to do |
|---|---|---|
| A new review was not built | `/weekly` shows the previous one; the Sunday edition has no teaser | Nothing: the edition is not blocked, next Sunday builds again |
| Calendar or mail days are missing | The «Пока неполная история» note and coverage below 7/7 | Nothing: gaps are not filled |
| Weekly is switched off in settings | `/weekly` and `/preview/weekly` answer "Not found", no teaser | Turn `weekly.enabled` on |

How the review is computed, who writes the observations and what happens when a write fails is described in [How Weekly is computed](@weekly-internals). The shared add-on contract is in [Add-ons: the shared contract](@addons).

## Next

:::cards
- [Cinema](@cinema) — the Saturday cinema review
- [How Weekly is computed](@weekly-internals) — observations, aggregation, publication
- [The morning edition](@daily) — where the teaser and the Discord button sit
:::
