---
title: How Weekly is computed
nav: Weekly internals
summary: Where observations come from, how they become a seven-day review, and why a Weekly failure does not stop the edition.
section: digest
group: internals
order: 70
next: cinema-internals
---

Weekly is a deterministic fold of seven daily observations into one review. It has no providers and no model: Kurami sums what Daily recorded all week and honestly shows which days are missing. That is why the Sunday run is fast and independent of external services. What you see is on the [Weekly](@weekly) page.

:::glance
- What it does: keeps one compact record per date and folds seven records into a review
- Started by: edition publication, the hourly poll at :37, a press of "Read and archive"; the review is built by the Sunday 09:00 build
- Runs where: inside the Digest runtime, with no provider calls and no model
- State: `weekly_daily_observations`, `weekly_mail_actions`, the `weekly` row in `addon_snapshots`
- What you see: a teaser in the Sunday edition, the `/weekly` page, the "📊 Week" button in Discord
:::

```diagram
kind: graph
title: Observations and the review
desc: Three writers write observations: edition publication, the hourly poll and a mail action. The Sunday builder folds seven records into a review, and publication saves it in the weekly snapshot.
node publish "Publication" "every morning" at 0,0
node poller "Poll" "every hour" at 1,0
node mail "Archiving" "a press in the edition" owner at 2,0
node obs "weekly_daily_observations" "date · calendar · mail · stories" entity at 0,1
node actions "weekly_mail_actions" "action_id · date · count" entity at 2,1
node build "Builder" "seven days, coverage" at 1,2
node review "Review" "totals · topics · insights" at 1,3
node snap "addon_snapshots" "weekly" store at 2,3
node page "/weekly" "the page" end at 0,3
edge publish -> obs "observation"
edge poller -> obs "recompute"
edge poller -> actions "catches up" dashed
edge mail -> actions "one action_id"
edge obs -> build
edge actions -> build "archived"
edge build -> review
edge review -> snap "publication"
edge snap -> page
```

## Three observation writers

Each observation is one JSON row per date: the number of stories, the calendar, the mail balance. The rows hold no mail texts, meeting names or links, only counters and times. Three independent writers write it, because no single one of them covers the week.

- **Edition publication and refresh** write the observation in the same transaction as the edition itself.
- **The hourly poll** rereads all saved editions and repeats the observations, then deletes records older than the horizon — 7 completed days plus today.
- **The "Read and archive" button** adds a row to `weekly_mail_actions` in the transaction of the action receipt.

The write rules protect history from being overwritten. The calendar is recomputed only while the day itself is running; afterwards it is frozen. The mail balance is taken only if its read time falls on the edition's date: the first value is fixed, the last one moves forward. So refreshing an old edition with today's mail does not rewrite the past.

## How the calendar is counted

A calendar observation is the busy and overlapping minutes of one day. Kurami takes timed events, drops cancelled, declined, demo and all-day ones, clips the rest to the boundaries of the local day and removes duplicates by identifier. Then it sorts the interval endpoints and walks through them left to right. A minute counts as busy if at least one interval is open, and as an overlap if two or more are open. Every minute is counted once, not once per pair of meetings. All-day events are counted separately and never turned into minutes.

## Building the review

The builder takes the period `[Sunday − 7; Saturday]` and fills seven cells: a known day is its record, an unknown day is a record of only `null`s. Coverage is counted over three series: news, calendar, mail, 0–7 in each. A series total is `null` if all days are empty, otherwise the sum of the known ones. The review state: `empty` with no data at all, `ready` at coverage 7/7 for all three series, otherwise `partial`.

Reactions come from the journal: for each story the last reaction in the period, 🔔 and 🔕 separately, undone ones do not count. Topics are sorted by the number of reactions and eight remain. The comparison with the previous week appears only when all seven calendar days of both weeks are known. The three sentences of "What Kurami noticed" are the busiest day, the overlap minutes, the change of the mail balance, and with fewer than three reactions a message that there are few.

## Attach and publish

The review gets into the edition in two steps. Before publication the attach step refreshes history, builds the review and puts it into the edition's `addons.weekly`; an empty review is not attached. A failure here only writes a warning, the edition goes on. At publication a savepoint (`SAVEPOINT`) is opened: inside it the last observation is written and the `weekly` snapshot is saved. If something fails, only the savepoint rolls back, the edition is published, and the reason — a short code — is written to `weekly_persistence_failures`. The snapshot is not accepted if the table already holds a review with a later date.

::::example The week of 27 September to 3 October, edition `daily:2026-10-04`
:::steps
- **Poll** — writes rows all through the period: 63 stories over 7 days, the calendar known for 5 days (Wednesday and Thursday unobserved), mail for 2 days.
- **Archiving** — two presses during the week: 6 and 8 mails. `weekly_mail_actions` has two rows, the sum is 14.
- **Builder** — on Monday 28 September the events 09:00–10:30 and 10:00–11:00: 120 minutes busy, overlap 30. Busy over the known days: 675 minutes, that is 11 h 15 min.
- **Builder** — calendar coverage is 5/7, so there is no comparison with the previous week. 9 reactions: 🔔 6 and 🔕 3. The review state is `partial`.
- **Publication** — on Sunday at 09:00 writes the `weekly` row to `addon_snapshots`; the Discord card gets "📊 Week".
:::
The data is invented; the formulas are taken from the code.
::::

## Project history is a separate read

The week in projects block reads the Run Store when the Weekly page is requested. It shows the latest seven days of observed board moves, completed CI repairs and AI reviews, with at most twelve events per local day. This rolling period is separate from the Sunday–Saturday period of the saved review. Reloading may therefore change project history without republishing the Weekly totals or Daily teaser.

A quiet or unavailable project history produces no block; its absence does not prove that every project was idle. A long history scrolls inside its own keyboard-focusable region. Hub uses the same read-only chronicle.

## When something goes wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| The Weekly write failed at publication | Rolls back the savepoint, the edition is published, a reason code goes to `weekly_persistence_failures` | Check the table; the next publication clears the row |
| The archive counter write failed | The action stays done; a row goes to `weekly_mail_observation_failures` | Nothing: the poll catches up without double counting |
| The poll was down for hours | Days stay `null`, coverage is below 7/7 | Nothing: gaps are not filled |
| The review is empty (coverage 0/7) | Not attached to the edition, the snapshot does not change | Nothing |
| Weekly is switched off | No new observations, the pages answer "Not found" | Turn `weekly.enabled` on |

:::guarantees
- A Weekly failure does not stop the publication of an edition.
- The review does not call providers and does not use a model.
- An unknown day stays `null` and never turns into zero.
- A mail action is counted once: the receipt id is unique.
:::

:::code-map
- `src/briefing/weekly/observations.ts` — writing an observation, calendar minutes, pruning the horizon
- `src/briefing/weekly/mail-observation.ts` — the "Read and archive" counter and the failure table
- `src/briefing/weekly/build.ts` — building the seven-day review
- `src/briefing/weekly/lifecycle.ts` — history, attach, snapshot publication
- `src/briefing/weekly/persistence.ts` — `persistOptionalWeekly`: the `SAVEPOINT` and failure record
- `src/briefing/weekly/chronicle.ts` — request-time project history, separate from the saved review
- `src/briefing/weekly/render.ts` — the teaser and the `/weekly` page
- `src/briefing/addons/weekly.ts` — the Weekly marker and the teaser slot
- `migrations/briefing/` — the `weekly_*` tables
:::
