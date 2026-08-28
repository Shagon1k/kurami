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
| `news.mark_read_through` | Mark one source read through an exact upper item ID | yes |
| `mail.list_unread` | Fetch all unread Gmail messages with pagination | no |
| `mail.read_and_archive` | Remove `UNREAD` and `INBOX` from selected messages | yes |
| `calendar.list_primary` | Fetch primary-calendar events for the briefing window | no |
| `weather.forecast` | Fetch local weather | no |
| `publisher.prepare` | Validate and durably stage an edition | local |
| `publisher.finalize` | Record commit results and make the edition current | local |
| `notifier.release` | Send the configured Discord summary and URL | yes |

A missing optional weather or cinema capability makes only that section partial.
Missing news, publisher, or safe cutoff support blocks a full production commit.

## Telegram snapshot boundary

For each configured channel:

1. Read the unread count and identify the current newest message ID.
2. Fetch enough newest messages to cover that count.
3. Store the fetched item IDs plus `min_id` and `max_id` in the prepared source
   batch.
4. After durable preparation, call `mark_read_through(chat_id, max_id)`.
5. Store the provider result before finalizing.

Never call an unbounded `mark_as_read(chat_id)` as a substitute. If the current
Telegram connector lacks `max_id`, production mutation remains disabled until
a Kurami-owned bounded adapter is installed and tested. Keep the external
connector checkout pinned and unmodified.

## Runtime MVP boundary

The initial runtime provides only local, reversible operations:

- migrate and inspect the dedicated briefing SQLite database;
- validate and stage a versioned payload plus inert rendered HTML;
- serve prepared previews on loopback;
- record briefing-local read state and explicit story reactions;
- delete expired daily editions while retaining compact preference events.

It does not finalize editions, make a prepared edition current, mutate Telegram
or Gmail, send notifications, or expose a public listener. Those capabilities
remain gated until their bounded adapters and commit receipts are implemented.

One failed channel does not block successful channels. Its messages remain
unread and the edition records a partial source. Retries fetch only failed
sources and deduplicate against recorded provider item IDs.

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
the durable prepared edition and commit receipts. Do not refetch and do not mark
the same source again.

## Retention

Delete daily payloads, rendered pages, raw source content, per-edition read
state, and action receipts after five days.

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
