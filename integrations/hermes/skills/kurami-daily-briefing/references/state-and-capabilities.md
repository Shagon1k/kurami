# State, capabilities, and mutations

The skill speaks in narrow capabilities. Configuration selects one provider
profile per source and supplies only safe source settings. The matching
`provider-<profile>.md` reference owns discovery, schema validation,
pagination, normalization, and acknowledgement constraints for the current
Telegram, Composio, Hermes, or Kurami implementation. Provider names must not
leak into generic content components.

Provider profiles are instructions, not a new integration DSL and not a hard
security boundary. Do not put MCP tool names, parameter mappings, or response
mappings in `briefing.yaml`. If a profile becomes large, fragile, or requires
deterministic transformation tests, replace that profile logic with a real
Kurami-owned adapter exposing a stable MCP schema.

## Required capabilities

| Capability | Purpose | Mutation |
| --- | --- | --- |
| `news.unread_count` | Read unread count for one configured source | no |
| `news.fetch_recent` | Fetch newest messages sufficient for the captured count | no |
| `news.mark_read_through` | Mark prepared sources read through exact upper item IDs in one bounded batch | yes |
| `mail.list_unread` | Fetch all unread Gmail messages with pagination | no |
| `mail.read_and_archive` | Remove `UNREAD` and `INBOX` from selected messages | yes |
| `calendar.list_events` | Fetch one configured calendar for the briefing window | no |
| `weather.forecast` | Fetch local weather | no |
| `publisher.prepare` | Validate and durably stage an edition | local |
| `publisher.telegram_validate` | Bind raw and normalized Telegram artifact digests to one final prepared edition | local |
| `publisher.telegram_plan` | Derive the exact content-covered acknowledgement plan and digest | local |
| `publisher.finalize` | Record commit results and make the edition current | local |
| `notifier.release` | Send or idempotently update one concise configured Discord release message | yes |
| `live.refresh` | Deterministically refresh allowed live surfaces on retained editions | local/read-only providers |

A missing optional weather or cinema capability makes only that section partial.
Missing news, publisher, or safe cutoff support blocks a full production commit.

## Telegram snapshot boundary

For each configured channel:

1. Read the unread count and identify the current newest message ID.
2. Fetch enough newest messages to cover that count.
3. Store the fetched item IDs plus `min_id` and `max_id` in the prepared source
   batch. In schema version 2, give every ID exactly one story or exclusion
   owner.
4. Import every retained media asset with exact source/message provenance.
5. Persist raw/normalized validation against the final prepared edition, then
   create its commit plan and digest.
6. Call `mark_read_through_batch(items, edition_id, attempt_id, plan_digest)` once with
   only the exact plan cutoffs.
7. Store the provider result and carry the same plan digest into finalization.

Never call an unbounded `mark_as_read(chat_id)` as a substitute. If the current
Telegram connector lacks `max_id`, production mutation remains disabled until
a Kurami-owned bounded adapter is installed and tested. Keep the external
connector checkout pinned and unmodified.

## Runtime boundary

The runtime provides local interaction state plus two narrow external mutation
surfaces:

- migrate and inspect the dedicated briefing SQLite database;
- validate and stage a versioned payload plus inert rendered HTML;
- enforce exact one-owner Telegram coverage for schema-version-2 payloads;
- bind immutable raw and normalized artifacts to the final prepared edition;
- reject a Telegram commit plan until retained media provenance is complete;
- serve prepared previews on loopback;
- record briefing-local read state and explicit story reactions;
- delete expired daily editions while retaining compact preference events;
- resolve selected internal mail IDs server-side and invoke only Gmail
  `read_and_archive` through the restricted automation contour;
- persist idempotent action receipts;
- let the production skill acknowledge prepared Telegram source batches only
  through the bounded same-process batch adapter.

The runtime still does not permit browser-selected provider tool names, raw
provider arguments, or unbounded Telegram acknowledgement.

One failed channel does not block successful channels. Its messages remain
unread and the edition records a partial source. Retries fetch only failed
sources and deduplicate against recorded provider item IDs.

The schema-version-2 commit plan is the mutation authority. The agent may not
derive cutoffs directly from the payload, raw batch, prior run, or provider
response after the plan exists. The bounded Telegram wrapper independently
loads the persisted plan and verifies `edition_id`, `plan_digest`, and the exact
`items` set before making a provider call.

## Gmail action boundary

Briefing generation is read-only for Gmail. The web runtime accepts only an
internal edition ID, internal selected-item IDs, and the fixed action
`read_and_archive`.

The server resolves provider message IDs from SQLite, verifies that every item
belongs to the visible edition and has not already been committed, then invokes
the allowlisted provider operation to remove `UNREAD` and `INBOX`. The browser
cannot choose a tool name, account, labels, or raw provider arguments.

Store a deterministic action receipt so a retry is idempotent. A partial Gmail
action reports per-item results; never claim the whole selection succeeded from
one successful message.

## Publication state machine

```text
collecting -> prepared -> committing -> complete | partial
                    \-> aborted
```

- `prepared` means payload and rendered HTML are durable and validated.
- `committing` records each allowed Telegram mutation.
- `complete` means every required section and commit succeeded.
- `partial` is useful and publishable but carries explicit source diagnostics.
- `aborted` never replaces the current edition and never permits further source
  mutation without an explicit recovery decision.

Publishing uses one edition ID per local date. An automatic rerun of a complete
edition is a no-op. A partial rerun may merge only missing-source results into
the same edition. There are no public revisions.

If the process stops after Telegram commit but before finalization, recover from
the durable prepared edition, persisted validation, commit plan, and commit
receipts. Do not refetch, recompute the plan, or mark the same source again.

## Discord release boundary

The release notifier runs only after successful finalization. It sends one
concise message to the configured Discord destination and links directly to
`/daily/<local-date>`. It is idempotent for the edition: a retry updates or
reuses the recorded release rather than posting a second one.

The scheduled Hermes job uses local delivery. Do not use the Hermes cron
wrapper as the release message and do not include a cron response header, job
ID, management instruction, stop instruction, raw run counters, or a second
home-page link. Notification failure does not roll back the published edition;
record it separately and retry the notifier only.

## Digest Central Poller

The `Digest-Central-Poller` is an hourly deterministic runtime process. It does
not run this skill, an agent, or an LLM. For every retained daily edition it may
refresh Gmail, Open-Meteo weather, relevant calendar state, the last-update
timestamp, and the client-side current clock. Provider failures are fail-soft:
preserve the last successful value, mark it stale or partial, and continue
independent providers.

The poller's immutable boundary is the edition envelope plus `news`,
`sourceBatches`, story media, topics, reactions, and story read state. It never
fetches new Telegram posts, changes a news counter, rewrites or reranks a story,
downloads Telegram media, builds a Telegram commit plan, or marks Telegram
read. The daily news collection remains the frozen 09:00 Europe/Vilnius
snapshot.

## Retention

Delete daily payloads, rendered pages, raw and normalized source artifacts,
run and recovery artifacts, edition media, per-edition read state, validation
and action receipts, and release-notification receipts after five days.

Keep only the current weekly cinema edition until a newer successful edition
replaces it.

Retain the non-secret source registry, source checkpoints, canonical topic
registry, compact reaction events, and aggregate topic preference profile. A
long-term reaction event stores no full story or email content.

## Failure semantics

- A meaningful partial edition becomes the current daily page with a visible
  quality warning.
- A total failure preserves the previous current edition and sends an error
  notification rather than a release notification.
- Gmail, Calendar, weather, and cinema retrieval failures never authorize an
  external mutation.
- Cinema failure on Saturday does not block the daily edition.
- Provider authentication, network reachability, and authorization scope are
  separate diagnostics; do not report credentials invalid from a network error.
