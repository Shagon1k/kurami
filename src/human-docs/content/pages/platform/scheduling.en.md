---
title: Schedule
nav: Schedule
summary: What runs at which local time, why the Hermes schedule is set in UTC, how the system survives a clock change, and how to tell "the job started" from "the result is there".
section: platform
group: guide
order: 40
next: recovery
---

Every Kurami job runs by the clock, but Hermes and you use different clocks. Hermes and the server run on UTC, while you live on local time: in summer it is three hours ahead, in winter two. All times below are local unless stated otherwise. The exact list of all jobs with their UTC times is in the reference [Jobs and schedule](@jobs).

## What happens during the day

| When (local, summer) | What | Where to look |
|---|---|---|
| Every minute | three project polls and the docs proposal worker | run cards; silent when there is nothing to report |
| At the set interval (10 minutes now) | health check | the health card and the alerts channel |
| Every hour at :37 | refresh of Digest live blocks (mail, calendar, weather) | the update time on the edition page |
| 03:07, 09:07, 15:07, 21:07 | network speed sample | the Network line on the health card |
| 09:00 (and 10:00) | Daily: the primary window and the recovery window | the Daily card in Discord |
| 09:05–09:50, 10:05–10:50 | edition guard | the same Daily card |
| 09:45 | the daily Projects Digest | the project card in Discord |
| 06:15 on day 1, 4, 7 … of the month | backup | a message in the maintenance channel |
| 07:15 on the 1st | monthly maintenance | a message in the maintenance channel |
| Sunday 10:00 | weekly Investment Review | a message in the Daily thread |
| Monday 06:00 | documentation audit and draft of changes | a card in the updates channel |

## Why cron is UTC and the code checks the time

The Hermes schedule is a cron expression in UTC, with no time zone. A clock change shifts local time by an hour while UTC stays put. So Kurami does not try to fit cron to the season: it starts the job with a margin and lets the code decide.

| Job | Fires (UTC) | Who decides what to do |
|---|---|---|
| Daily | 06:00, 07:00, 08:00 | the Digest runtime: local hour 9 is the primary window, 10 the recovery window, any other is a silent skip |
| Documentation audit | Monday 03:00 and 04:00 | the script: checks that the local day is Monday and the hour is 06; exactly one of the two firings fits |
| Investment Review | Sunday 07:00 | the runtime: runs only if the local day is Sunday and there was no attempt today |
| Daily guard | — | a systemd timer set in local time, so it needs no check |
| Backup, maintenance | fixed UTC times | no check: in winter they fall an hour earlier in local time (05:15 and 06:15) |

In summer Daily wakes at 09:00, 10:00 and 11:00 local: the first two firings work, the third is skipped silently. In winter the same 06:00, 07:00 and 08:00 UTC are 08:00, 09:00 and 10:00 local: the first is skipped. The price of this scheme is one or two idle firings a day.

## "The job ran" is not a result

The Hermes mark "ok" only means the script finished without an error. Each process has its own result, and that is what to check.

| Process | What "the job ran" does not prove | What proves the result |
|---|---|---|
| Daily | the edition is published | the accepted edition for the date and the notification receipt; the Daily card links to `/daily/<date>` |
| Project poll | the transition was recorded | the event in the queue and the run state on the card |
| Health | the card is fresh | the "Updated" time on the health card |
| Backup | the copy is safe | the "Kurami backup completed" message and, with the off-site copy enabled, the encrypted archive and its checksum |
| Documentation audit | the site changed | the proposal card in the updates channel |

Silent jobs with `local` delivery send nothing even on failure: you see their failure from a stale card or from the log in `$KURAMI_HOME/logs/`. The backup, maintenance and audit jobs send an error message themselves. Details are in [Kurami and Hermes](@hermes-integration).

## What you can change

From Discord you can change only the health check interval: 5, 10, 12, 15, 20, 30 or 60 minutes, in the `/kurami settings` panel ([Settings](@settings)). The other times are part of the deployment: whoever installs the jobs in Hermes changes them, and they are recorded in the reference table.

:::code-map
- `integrations/hermes/briefing-cron-prompt.md` — the Daily prompt: "the only time gate is the runtime"
- `src/briefing/run-attempt.ts` — the local hour 9 and 10 windows
- `src/briefing/run-guard.ts` — the guard deadlines 09:50 and 10:50
- `src/human-docs/automation/hermes-wrapper.sh` — the "Monday, 06:00 local" filter
- `src/briefing/investment-review/automation.ts` — the "Sunday" check and one run per day
- `deploy/systemd/kurami-daily-briefing-guard.timer` — the timer in local time
:::

## Resource audit

On the first day of each month at 06:30 UTC, `kurami-monthly-resource-audit` collects server disk and RAM usage and starts a separate Hermes analysis session. Delivery goes to the maintenance Discord channel; its Hub notice remains until reviewed. The job cannot clean. See [maintenance](@maintenance) for the approval boundary.
