# Weekly Review v1

Weekly is an optional native add-on, not a second agent or a new scheduler.
On Sunday, the normal 09:00 Europe/Vilnius Daily completion prepares a review
of the preceding seven completed local dates (Sunday through Saturday).
Publication promotes the snapshot together with Daily. A failure stays isolated;
the previous successful Weekly remains available.

Weekly observation and promotion use a savepoint inside the Daily transaction.
If either write fails, Daily can still publish and
`weekly_persistence_failures` records the edition, operation, bounded error
code, and time. It stores no provider content. A successful retry clears that
edition's failure record; it does not reconstruct missing observations unless
the retained edition still contains the needed data.

The Weekly mail counter is also optional. If its write fails after a successful
`Read & Archive`, the mail action stays complete. The
`weekly_mail_observation_failures` table records only the opaque action ID,
edition ID, bounded error code and time. The next enabled Weekly history
collection retries completed action receipts without calling Gmail. A
successful counter write clears the failure record; repeated collection does
not count the action twice.

- `/weekly`: latest promoted review, retained until the next successful one.
- `/preview/weekly`: explicitly labelled, read-only preview of the last seven
  completed days relative to today. It is not a published Sunday edition.
- Only the matching Sunday Daily includes a compact teaser and Discord link.
- `weekly.enabled: false` disables new observations, the page routes and teaser.
  Existing counters still follow cleanup policy.

## Contract and ownership

`src/briefing/weekly` owns typed observations, period boundaries, deterministic
aggregation, validation, snapshot promotion and report rendering. The
`addons/weekly.ts` adapter registers Daily composition and teaser placement.
The module never fetches a provider, modifies Gmail or Telegram, generates a
new source summary, or asks an LLM to calculate totals.

The shared page shell, metric cards, theme, favicon and BarChart are reused.
Charts receive ordered dates and values; absent observations are null, not 0.
The UI preserves partial coverage, even when an attractive complete chart
would be easier to render.

## What is measured

- Calendar: planned timed events, all-day count separately, union of occupied
  minutes, and union of overlapping minutes. Cancelled, declined and demo
  events are excluded; cross-midnight intervals are clipped to the local day.
  Planned minutes are never described as actual work or attendance.
- Mail: first and last available Primary-unread count within that same local
  date, including source timestamps. Refreshing an old Daily with today's
  inbox must not rewrite historical inbox observations.
- Hygiene: only successful `Read & Archive` actions performed through Daily,
  deduplicated by action receipt. Direct Gmail activity is not inferred.
- News: the number of stories in each Daily snapshot. The sum is labelled as
  stories in editions, not as globally unique events.
- Interests: each story's last reaction within the period; cleared reactions
  do not count. Topic counts may overlap because a story can have several
  topics. Net reaction balance is not the Interest Profile weight.
- Previous-week calendar comparison appears only when both calendar weeks
  have seven observed days. Fewer than three reacted-to stories never support
  a strong preference-change claim.

The “Что заметила Курами” observations are factual, rule-based sentences in v1.
No stock doodle pool or fabricated AI analysis is added. The renderer does not
author these observations or change their values.

## History and privacy

Daily pages, payloads and media now retain the latest seven editions, with a
seven-day age ceiling. Existing published records can be extended by the
explicit `migrations/extend-daily-retention.ts --apply` operation; already
deleted pages and artifacts cannot be restored.

`weekly_daily_observations` contains compact counters and timestamps only:
no message text, subjects, event names, links, provider message IDs or images.
`weekly_mail_actions` contains an opaque action ID, date and count. Keep
`weekly.observationDays` completed days plus the open current-day bucket;
supported values are 7 and 28. The deployed default is 7 until a longer
aggregate horizon is explicitly selected. Raw Daily retention is independent.

Observation capture happens at publication, current-day live refresh and
successful mail actions. Completed calendar observations are frozen once
available. Backfill uses retained trustworthy data only; historical inbox data
that has already been overwritten by the poller remains missing. The first
Weekly can therefore be partial even after extending Daily retention.

## Late Daily publication

After images are imported but before the Telegram commit plan exists,
`refresh-before-publish` checks enabled live sources. If any timestamp is
missing, in the future, or older than 15 minutes, it refreshes Mail, Calendar
and Weather through existing restricted collectors and recomputes Signals.
Provider failures retain old data explicitly marked stale. News and source
batches are immutable, and the content digest lock is checked on write.
Refreshing a prepared edition invalidates its old validation receipt, which
is then recreated before acknowledgement. A resumed already-created commit
plan is not invalidated after possible provider mutations.

On Sundays this same boundary attaches Weekly without another provider call.
It does not delay or rewrite the morning news snapshot.

## Verification and preview

`npm run test:briefing-weekly` covers period arithmetic, counters, duplicate
observations, calendar overlap, inbox isolation, cleared reactions, missing
data, safe markup, Sunday promotion, mail observation failure and recovery,
opt-out routes, late live refresh and retention migration.
`WEEKLY_PREVIEW_PORT=8794 npm run test:briefing-weekly`
serves a local synthetic example through the real app renderer.
