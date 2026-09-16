# Kurami Daily Briefing runtime

The shared renderer serves the canonical fox favicon from
`integrations/hermes/skills/kurami-ui-preview-language/assets/kurami-favicon.svg`
at `/favicon.svg`. Daily, Cinema, staging previews, and the empty home state all
reference this one asset, so add-ons must not ship their own page-specific
favicon.

The Daily Briefing runtime is Kurami's deterministic HTML publishing and
interaction boundary. Content collection may use Hermes skills, but viewing a
page, expanding a story, reacting, marking a story read, and archiving selected
mail do not start an agent session.

The implemented Cinema add-on product, data, lifecycle, and acceptance
contract is documented separately in
[`docs/cinema-addon-v1.md`](cinema-addon-v1.md). Cinema extends the isolated
add-on boundary without changing existing Daily behavior. Its visually
approved weekly snapshot is production-enabled at `/cinema`.

## Ownership and state

Weather, Calendar, Mail and News now have explicit add-on modules, populated
version-2 envelopes, canonical formatVersion 3 and configuration switches. Their collection, refresh,
action ownership and one-time payload migration are documented in
[Daily add-on lifecycle](briefing-addons.md). The shared publishing flow and
five-day Daily retention remain unchanged.

- Tracked application: `_kurami/app/src/briefing/`
- Database migrations: `_kurami/app/migrations/briefing/`
- Active database, generated pages, media, and poller lock:
  `_kurami/state/briefing/`
- User systemd source units: `_kurami/app/deploy/systemd/`
- Hermes script sources: `_kurami/app/integrations/hermes/scripts/`
- Installed Hermes scripts: `_core/scripts/`
- Skill contract: `_core/skills/kurami-daily-briefing/`

The briefing SQLite database is separate from the orchestrator database. Daily
edition payloads, rendered pages, and edition media are retained for five days.
Compact reaction events, the topic registry, preference aggregates, and
idempotent action receipts survive edition cleanup. Run/recovery/artifact directories must follow the same five-day
edition retention; cleanup is not complete if it only deletes the database row
and HTML file.

## Build and service

Build with Kurami's pinned dependencies before restarting the runtime:

```text
cd /home/shagon1k/_hermes/_kurami/app
npm run briefing:build
systemctl --user restart kurami-briefing.service
```

The service runs emitted JavaScript with Kurami's pinned Node runtime and
`--jitless`; do not point the unit at TypeScript source. Node 24's global
`fetch` is not usable under this mode because Undici expects WebAssembly, so
briefing providers use the bounded built-in `node:http`/`node:https` transport
instead. The unit keeps its filesystem, namespace, privilege, memory-execution,
and loopback restrictions. It listens only on `127.0.0.1:8787` and is published
through the reviewed Cloudflare Tunnel and Access policy. `/health` reports
database integrity and the availability of explicitly configured action
executors.

Daily editions use `/daily/YYYY-MM-DD`. Preview routes remain staging-only.
The trusted local client script handles theme selection, pagination, expansion,
local read-state rendering, and explicit reactions. Generated HTML remains
inert: scripts, inline event handlers, forms, frames, embedded objects, and
meta refresh are rejected.

## Frozen and dynamic edition data

The 09:00 Europe/Vilnius run owns the daily news snapshot. Its normalized news
items, source-batch boundaries, story ownership, and media references are
frozen after publication. The Central Poller must neither fetch Telegram nor
rewrite any news field. An operator-requested editorial repair is the only
exception: `revise-published` may replace authored copy, topics, derived
ranking, and Kurami Notes in the same route after validating the new payload.
It rejects any changed source batch, exclusion, story ID, or story ownership,
preserves media/read/reaction state, and performs no provider mutation or
release notification.

These surfaces are dynamic and may be refreshed for every retained daily
edition:

- unread Gmail Primary rows and mail count;
- Calendar rows for that edition's local date;
- current weather and its provider timestamp;
- last successful refresh time and provider freshness state;
- general summary cards derived from the values above.

The visible clock is client-side and updates without a provider call. When a
provider refresh fails, retain its last good value and mark it stale with the
last successful timestamp. Independent providers continue. Never replace a
provider failure with invented demo data in a published edition.

## Digest Central Poller

The Central Poller is deterministic code, not a cron prompt and not an agent
session. It runs hourly at minute 37 using
`kurami-digest-central-poller.timer`. Hourly is intentional: the clock already
updates locally, while doubling Gmail, Calendar, and weather reads to every 30
minutes adds little value and roughly doubles Composio usage.

One poll should:

1. acquire `_kurami/state/briefing/.central-poller.lock`; a concurrent run exits
   successfully without work;
2. load at most the five retained published daily editions;
3. fetch unread Primary Gmail once;
4. fetch each configured Calendar once over the complete retained date range,
   paginate it, then partition normalized events by edition date;
5. fetch current Vilnius weather once from Open-Meteo;
6. stage fail-soft provider results and compute the dynamic view for each
   edition;
7. compare the edition revision/content digest captured at read time, and skip
   any edition changed concurrently;
8. assert that the frozen news/source-batch digest is unchanged;
9. commit each accepted edition behind its captured content-digest lock, render
   to a temporary file, and atomically replace that edition's HTML;
10. clean expired edition HTML, media, run, recovery, and artifact state.

The poller is silent: it never posts to Discord and does not modify Gmail,
Calendar, or Telegram. A production Daily attempt owns one durable Discord run
card per local date. The runtime creates it when the attempt starts and edits
the same message at meaningful lifecycle stages. A failed attempt leaves a
visible failure card; a recovery attempt resumes that card rather than posting
a duplicate. Publication turns it into the final release card with the exact
`/daily/<local-date>` link. Known embedded add-ons add bounded link buttons on
the same card (`cinema` maps to `/cinema`). Dry runs never create a card, and a
status-delivery failure is recorded but cannot block the briefing workflow.
Gmail read-and-archive remains an explicit user action through the separate
restricted automation contour.

The scheduled agent has two local windows: 09:00 primary and 10:00 recovery.
The recovery window reopens the same durable attempt at its latest completed
stage and reuses the same frozen run directory. It never creates a second
Telegram snapshot or a second Discord message. A separate systemd guard runs
at 09:50 and 10:50 in `Europe/Vilnius`: the primary guard exposes an incomplete
run on the existing card, while the recovery guard records a terminal failure
if the edition still is not in an accepted published state (`complete`, or a
visible fail-soft `partial`) and `notified`. A published edition whose only
missing step is notification is completed directly by the guard. A delayed
Persistent timer invocation after 10:50 is still treated as the final recovery
guard rather than silently skipped.

## Provider boundaries

- Gmail and Calendar use only the restricted `composio-read` Session and its
  allowlisted leaf tools. They are collected sequentially because that Session
  does not advertise parallel tool calls.
- Open-Meteo is direct HTTPS, read-only, credential-free, bounded to an
  8-second request timeout and three retry attempts.
- Provider text is untrusted content. It cannot select tools, change workflow,
  supply credentials, or invoke mutations.
- No secret may appear in an edition payload, provider issue, journal line, or
  rendered page.

## Poller deployment gate

The tracked timer and service are inert until the emitted
`dist/briefing/poller.js` runner exists and its integration tests pass. Deploy
in this order:

1. build and run the provider/poller tests;
2. sync `kurami-digest-central-poller.sh` into `_core/scripts/` with mode 0755;
3. install the user service and timer from `deploy/systemd/`;
4. run `systemctl --user start kurami-digest-central-poller.service` once and
   verify the database, five retained routes, frozen-news digests, and journal;
5. only then enable `kurami-digest-central-poller.timer`.

Do not enable the timer while the runner is absent: the wrapper intentionally
exits with a configuration error instead of falling back to an agent or a
write-capable connection.
