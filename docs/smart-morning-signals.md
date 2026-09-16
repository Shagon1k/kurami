# Smart Morning Signals v1

Signals is an optional, deterministic derived add-on. It consumes normalized
Calendar, Mail and Weather data and contributes a compact strip immediately
below Daily's metric cards. It makes no provider mutations, LLM calls or
separate Discord notifications. News and Interest Profile are not inputs.

## Rules and priority

| Rule | Default threshold | Priority |
| --- | --- | ---: |
| Meeting overlap | At least 5 remaining overlapping minutes | 10 |
| Aged ACTION mail | Unread ACTION older than 48 hours | 20 |
| ACTION mail | At least one unread ACTION | 21 |
| Dense calendar | At least 240 remaining busy minutes, or 3 meetings in a chain with gaps under 15 minutes | 30 |
| Long meeting | At least 120 minutes; not finished | 31 |
| Early tomorrow | First timed meeting tomorrow starts before 09:00 local time | 35 |
| Weather today | Daily precipitation probability ≥60%, minimum <0 °C, or maximum ≥30 °C | 40 |
| Cooling tomorrow | Tomorrow's maximum is at least 8 °C below today's | 41 |

All thresholds, the maximum (1–3), freshness limit and individual rule flags
are configurable under `signals` in `briefing.yaml`; the tracked example is
in `deploy/config/briefing.yaml`. Missing configuration uses these defaults.
Set `signals.enabled: false` to disable the module. Invalid optional settings
produce an isolated failed diagnostic, not a failed Daily run.

Candidate groups are calendar-today, calendar-tomorrow, mail and weather.
Only the highest-priority candidate in each group survives; then take the
first three by priority and stable ID. Thus overlap supersedes dense/long-day
notices, aged mail supersedes the ordinary ACTION count, and weather notices
do not repeat. This is deterministic selection, not an AI editorial choice.

## Data contracts

The envelope lives exclusively in `addons.signals`:
- version 1, section state, capturedAt;
- data: policy, edition localDate/timezone, evaluatedAt, validUntil,
  selected items and machine-readable unavailable checks;
- each SignalItem: stable rule ID, group, priority, severity, title, detail,
  optional fixed section link and optional event expiry.

The add-on owns its config parser, pure engine and envelope validation in
`src/briefing/addons/signals/`. It registers a derived hook and the
`after-metrics` rendering slot. The shared `refreshDerivedAddons` runner
isolates failures and supports future derived modules without embedding
their calculations in the composer or Poller.

Calendar owns its optional normalized `tomorrow` object. Enabling earlyTomorrow
extends the existing bounded calendar read by one civil day, including DST.
Display rows and today's counters still use the edition date; tomorrow's
events do not enter today's schedule. The provider adapter does not know
about Signals; it receives a generic includeTomorrow collection option.

Open-Meteo already supplies multiple forecast days. Weather now retains the
first two aligned dates with numeric min/max and precipitation probability,
plus its successful fetchedAt. No new weather request or prose parsing is
needed. Missing tomorrow values never borrow today's numbers.

## Time and freshness

Signals are useful only for the current local-date Daily. Retained older
editions have an empty derived snapshot so current inbox/weather values cannot
create historical “today/tomorrow” alerts.

Calculations use an explicit instant, not hidden clock reads in the engine.
A source must be enabled, ready/empty, have an explicit offset/UTC fetchedAt,
and be no older than 180 minutes by default. Future, stale, failed or missing
timestamps/data cannot produce a positive signal. Missing checks remain in
the envelope and feed the existing quality summary.

Only unfinished timed meetings are considered. All-day, cancelled, declined,
demo and malformed events are excluded. Busy time is the union of remaining
intervals, so overlaps do not inflate the four-hour threshold. No urgency is
inferred from event titles.

Mail age comes from receivedAt, not a guessed deadline. ACTION is the existing
mail classification; the signal does not reclassify messages or claim a task
is overdue.

The strip displays its evaluation time. Its browser runtime reveals it only
while fresh and on the matching local day, then hides expired calendar items
and hides an empty strip. The normal 30-second clock update handles expiry.
Without JavaScript it remains hidden, preventing stale cached alerts.
Day-level weather probabilities are labelled as today's forecast, not as an
hour-specific prediction.

## Refresh and action ownership

- Initial composition derives Signals after source normalization and ranking.
- Poller refresh derives it after live inputs return, using completion time.
- Successful mail archive reconciliation re-derives it immediately using the
  retained policy, so processed mail does not leave a dangling signal.
- Explicit configuration overrides are applied at the next composition/poll.
- No extra scheduler is created. Provider failures stay independent.
- The News envelope, source batches, media, reactions and read state remain
  under their existing immutable/persistence rules.

## Deterministic UI

`SignalStrip` and `SignalItem` are canonical components in `ui/components/`.
They use shared typography, surfaces, borders and semantic colors. Attention
uses the existing amber token and a fixed exclamation mark; information uses
a fixed arrow. There are no day-specific layouts, generated HTML, random
icons, background illustrations or AI-authored fallback notes.

The strip has up to three responsive columns, then stacks at narrow widths.
An empty result renders no block. Fixed Calendar/Mail anchors use accessible
links with 44px targets. Copy is generated by the rule templates from facts;
optional future Kurami Notes must not alter these rules or component geometry.

## Verification

`npm run test:briefing-signals` covers exact threshold boundaries, priority
and deduplication, stale/future/partial inputs, archived dates, invalid config,
mail reconciliation, unchanged news, safe rendering, forecast alignment and
49-hour DST look-ahead. Optional `SIGNALS_PREVIEW_PORT` starts a synthetic
local page for responsive/light/dark UI verification.

After deployment, run one normal Poller and verify source freshness,
look-ahead dates, selected rule IDs, strict max-three/group uniqueness and
unchanged frozen News. Do not insert synthetic production events or mail.
