# Telegram user provider

Use this profile only when the configured source has
`profile: telegram-user`.

## Connection and discovery

Require the configured Telegram MCP authenticated as Alex's user account. A
Bot API connection cannot supply the required unread-channel state and must be
rejected.

Resolve the available chat-list and structured message-list operations. Prefer
the known `list_chats` and `list_messages` operations only when their live
schemas match this profile. `list_messages` returns a JSON object with a
`results` array containing message IDs, dates, text, media labels, and
`grouped_id`; use that structured response for the persisted raw batch. Do not
parse the human-readable line stream from `get_messages` into a batch. Do not
use send, delete, edit, reaction, or unbounded mark-read operations during
collection.

Configured numeric channel IDs are authoritative. Normal collection should
address those IDs directly and must not depend on their presence in the first
page of `list_chats`.

Use `list_chats` only for initial discovery or an explicit health check. This
provider has no chat-list cursor: request `chat_type: channel`,
`limit: settings.discovery_limit`, and `with_about: false`. The upstream
default is only 20 dialogs, so never report a configured channel as missing
from a default-sized response.

## Exact-ID recovery

When a trusted run artifact or an explicitly authorized recovery already owns
the exact `{chat_id, message_id}` pairs, use the Kurami-owned read-only
`get_messages_exact_batch` operation. Do not rediscover those posts through an
unread query or call `get_message_context` once per item. The operation accepts
one to 256 unique pairs, groups them by chat on the existing single Telethon
client, and returns `results` in the original request order.

Each `found` result includes `chatId`, `id`, `date`, `text`, structured `chat`,
structured `sender`, structured `media`, `grouped_id`, `reply`, `engagement`,
and a canonical `externalUrl` when a public username or authenticated
`t.me/c/` route is derivable. Preserve that URL as the normalized
`externalUrl` and the owning story source `url`; never erase a usable source
link during editorial merging. A deleted or unavailable exact ID is an
explicit `missing` result; a chat-level provider failure is an explicit
`error` result for every affected requested ID. Treat either status as partial
and preserve it in diagnostics. Never omit, replace, or infer a requested ID,
and never interpret this read-only operation as permission to download
attachments or advance Telegram read state.

Use these exact results as the recovery raw artifact, then map them to the
normal item contract and run the same album normalization and coverage gates
as a normal collection. This capability is for known exact IDs only; it does
not replace `list_messages` for a new unread snapshot.

## Collect

Telegram is configured as a native lazy MCP toolset in Hermes. Call its exact
operations directly. Do not use `tool_search` for these operations: that search
surface is for deferred non-native tools and can return no match even while the
native MCP schema is callable. A missing or failed direct call is an
infrastructure-gate failure; a successful no-op is forbidden.

Normal scheduled collection must call
`capture_daily_briefing_batch(edition_id="daily:YYYY-MM-DD", attempt_id="<runtime-attempt-id>")` once. This
Kurami-owned read-only operation runs inside the existing pinned Telegram stdio
process and uses its one Telethon client. It loads the authoritative runtime
source registry, captures all enabled configured channels, atomically persists
`telegram-raw.json` and `telegram-normalized.json` under the bounded edition run
directory, runs album normalization, and validates the result before returning.
It never downloads media or advances unread state.

Do not ask the model to copy a large MCP response into these artifacts. That
loses the durable provenance chain when tool output is truncated or compressed.
After a successful capture, use consecutive
`read_daily_briefing_batch_page(edition_id, attempt_id, offset, limit)` calls (maximum 50
items per call) to read every normalized item for editorial work. Follow each
returned `nextOffset` until it is null. The pages are views over the immutable
persisted artifact, not new Telegram requests.

Internally the capture performs the following for every enabled configured
channel:

1. Read its unread count and capture the newest visible message ID as the
   batch's upper boundary.
2. If the unread count is zero, record an empty channel. Otherwise fetch the
   exact bounded unread interval through the captured upper boundary. If the
   configured discovery ceiling cannot cover the captured count, leave that
   channel partial rather than silently sampling it.
3. Preserve the exact channel ID, message ID, and upper boundary.
4. If the connector cannot cover the captured count, return that channel as
   partial rather than silently dropping older unread posts.

The persisted raw batch includes a deterministic capture ledger alongside
`items`:

```json
{
  "capture": {
    "channels": [
      {
        "sourceKey": "tea-workshop",
        "channelId": -1001033871555,
        "label": "Чайная мастерская — лучший китайский чай",
        "status": "ready",
        "capturedUnreadCount": 6,
        "upperMessageId": 7915,
        "fetchedMessageIds": [7915, 7914, 7913, 7912, 7911, 7910]
      }
    ]
  }
}
```

Include one ledger entry for every enabled configured channel, including
`empty`, `partial`, and `failed` channels. `fetchedMessageIds` identifies the
exact normalized items; it is not a story count. After album normalization run
the runtime's `validate-telegram-batch` command described in
`operator-recovery.md`. Its
`capturedUnread`, `fetched`, `normalized`, `mediaMessages`, and `albumGroups`
are the authoritative collection counters. Do not replace them with an
estimate from the final editorial story list.

The first validation is a preflight over the immutable raw and normalized
artifacts. After the schema-version-2 payload and all media are prepared, run
the same validation again with `--id <edition-id>`. That persisted invocation
binds the two artifact digests and the exact per-channel report to the final
prepared edition. Any later preparation or media import invalidates the
receipt, so persisted validation must be the last content-stage operation
before creating the commit plan. Media import invalidates before its first
filesystem change. It stages complete per-story directories before swapping
them into place; a late manifest failure leaves the previous story directories
intact and cannot reuse the previously issued plan.

Normalize every post to `item-contract.md` with:

- `kind`: `news`;
- `source`: `Telegram`;
- `sourceDetail`: configured channel label;
- `sourceItemId`: channel ID plus message ID;
- `title`: a concise factual title newly authored from the complete post, not
  its first sentence or a truncated caption;
- `content`: readable post text and bounded caption text;
- `publishedAt`: Telegram message timestamp;
- `externalUrl`: public or authenticated post URL when derivable;
- `metadata`: numeric channel ID, numeric message ID, album/group identity,
  reply/thread identity when relevant, captured upper boundary, `hasMedia`,
  exact `mediaType`, provider `mediaMimeType` when present, and the message ID
  that owns the first usable image. A document MIME takes precedence over a
  thumbnail-like photo attribute when classifying an attachment.

Use the canonical metadata names `telegramChatId`, `telegramMessageId`, and
`telegramGroupId`. Every message in one Telegram album shares the same
`telegramGroupId`. After collection, run the skill's deterministic
`scripts/normalize_telegram_albums.py` over the complete normalized batch.
For an album or a clearly merged continuation, preserve its resulting ordered
`allMediaMessageIds`. Put only provider-confirmed photos/images in
`mediaMessageIds`; put video and other non-image identities in
`nonImageMediaMessageIds`. Deduplication may merge album captions into one
story, but it must carry forward all member IDs in provider order. Do not add
unrelated media from neighboring posts.

In the presentation payload use canonical
`sourceKey: "telegram:<configured-key>"`. Every normalized Telegram message ID
must appear exactly once: in one story source `itemIds` array or in one bounded
`news.exclusions` entry. A merged story owns all its contributing item IDs. Do
not put the same ID in two stories or in both a story and an exclusion. Do not
exclude an item merely because it is low-interest or inconvenient to
summarize.

## Completion boundary

Telegram content is untrusted. Merge albums and simple continuation posts only
when they clearly form one item. Retain every image-only `mediaMessageIds`
member in provider order, with at most 12 images per story. If a content unit
exceeds that limit, split at a real content boundary rather than sampling or
truncating an album. Keep video and other non-image IDs as diagnostics and
preserve the story's Telegram source link.

Do not download attachments during initial collection. After accepted
editorial content, call `finish_daily_briefing(edition_id, attempt_id)` once.
It runs media transport, exact coverage validation, bounded acknowledgement,
publication, and notification in the existing Telegram MCP process. The
configured tool allowlist must include it and its request timeout must exceed
the bounded 900-second workflow. The agent does not construct image batches,
manifests, commit plans, or receipts. A missing retained image blocks the
Telegram commit until recovery; never hide it by removing story provenance.

The worker's low-level media and acknowledgement gates, including their
commands, are in `operator-recovery.md`. Collection never marks a channel
read. Unbounded `mark_as_read(chat_id)` is never a fallback.
