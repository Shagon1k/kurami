---
title: Jobs and schedule
nav: Jobs
summary: All Kurami jobs, timers and services: mechanism, schedule in UTC and local time, what they do and where they write.
section: reference
group: reference
order: 40
---

This reference shows what runs on the server and when: twelve Hermes jobs (ten script jobs and two agent jobs), two systemd timers and the permanent services. The Hermes and server schedules are set in UTC. Local time: summer = UTC+3, winter = UTC+2. How the system survives a clock change is explained in [Schedule](@scheduling), and how Hermes runs jobs in [Kurami and Hermes](@hermes-integration). Output "local" means Hermes sends nothing: the script writes to Discord itself when needed.

## Hermes jobs

| Job | Kind | Cron expression (UTC) | Local time, summer / winter | What it does | Where the result goes |
|---|---|---|---|---|---|
| `kurami-tailortales-poller` | script | `* * * * *` | every minute | the Project Orchestrator cycle for TailorTales | `local`; the controller writes the Discord cards |
| `kurami-pickflick-poller` | script | `* * * * *` | every minute | the same for PickFlick | `local` |
| `kurami-<project>-poller` (third) | script | `* * * * *` | every minute | the same for the third project | `local` |
| `kurami-docs-approval` | script | `* * * * *` | every minute | a step of the documentation proposal worker | `local`; log `logs/docs-approval.log` |
| `kurami-system-health` | script | `*/10 * * * *` (set by the interval in `/kurami settings` or Hub; 10 minutes now) | every 10 minutes | the health check: collects a cycle, then delivers the card and alerts | `local`; Discord over REST |
| `kurami-network-speed` | script | `7 */6 * * *` | 03:07, 09:07, 15:07, 21:07 / 02:07, 08:07, 14:07, 20:07 | a LibreSpeed speed sample | `local`; `state/network-speed.json` |
| `kurami-projects-digest` | script | `45 6 * * *` | 09:45 / 08:45 | the daily Projects Digest | `local`; Discord over REST |
| `kurami-daily-briefing` | agent, skill `kurami-daily-briefing` | `0 6,7,8 * * *` | 09:00, 10:00, 11:00 / 08:00, 09:00, 10:00 (working windows: hours 9 and 10) | the morning Daily edition; Cinema on Saturdays, Weekly on Sundays | `local`; the runtime maintains the card |
| `kurami-state-backup` | script | `15 3 */3 * *` | 06:15 / 05:15 on day 1, 4, 7 … 31 of the month | a database snapshot, recovery archive, off-site copy | the maintenance channel |
| `kurami-monthly-maintenance` | script | `15 4 1 * *` | 07:15 / 06:15 on the 1st | cleaning logs and Docker | the maintenance channel |
| `kurami-monthly-resource-audit` | script + agent | `30 6 1 * *` | 09:30 / 08:30 on the 1st | disk/RAM audit; no cleanup | maintenance channel + Hub |
| `kurami-investment-review-weekly` | script | `0 7 * * 0` | Sunday 10:00 / 09:00; the runtime checks local Sunday itself | the weekly Investment Review | the thread where the job was created |
| `kurami-docs-freshness` | agent, filter script | `0 3,4 * * 1` | Monday 06:00 (one of the two firings fits) | the documentation audit and a draft of changes | the updates channel |

## systemd timers and services

| Unit | Kind | Schedule | What it does | Result |
|---|---|---|---|---|
| `kurami-digest-central-poller` | timer | every hour at :37 UTC, random delay up to 20 s, catches up after downtime | refreshes the live blocks of stored editions; once a day after 05:00 UTC warms the Stocks cache | the systemd journal; writes nothing to Discord |
| `kurami-daily-briefing-guard` | timer | local time: 09:05–09:45 and 10:05–10:40 every 5 minutes, 09:50 and 10:50 | checks that Daily completed; deadlines 09:50 and 10:50 | edits the Daily card |
| `kurami-cpu-statistics` | service | permanent, a sample every 15 s | rolling CPU average and peak | `state/cpu-statistics.json` |
| `kurami-briefing` | service | permanent | the Digest site, `127.0.0.1:8787` | — |
| `kurami-human-docs` | service | permanent | this documentation, `127.0.0.1:8799` | — |
| `kurami-hub` | service | permanent | Hub, `127.0.0.1:8800`, with owner controls | — |
| `kurami-preview-ingress` | service | permanent | Caddy for previews, `127.0.0.1:9180` | — |
| `hermes-gateway` | Hermes service | permanent | the cron ticker every 60 s, Discord | — |

## Local-time rules inside the code

| Where | Rule |
|---|---|
| Daily | hour 9 is the primary window, hour 10 the recovery window, other firings are skipped |
| Documentation audit | continues only on Monday at hour 06 |
| Investment Review | runs only on Sunday and once a day |
| Daily guard | deadlines 09:50 (primary window) and 10:50 (recovery); checks before minute 50 act only if the agent has already finished |
| Weekly and Cinema | no schedule of their own: Weekly is the Sunday Daily, Cinema the Saturday Daily |
| Stocks | no schedule of their own: the cache warm-up is part of the hourly poll |
| Hub | the browser refreshes the page every minute while visible, the server caches a snapshot for 45 seconds; the health snapshot counts as stale after twice the check interval plus five minutes |
| Times on cards and pages | in local time |

:::code-map
- `integrations/hermes/scripts/` — Hermes job wrappers
- `deploy/systemd/` — timers and services
- `run-project-poller.sh` — the project poll cycle
- `run-projects-digest.sh` — Projects Digest
- `run-docs-approval.sh` — a step of the docs worker
- `src/briefing/run-attempt.ts` — the Daily windows
:::
