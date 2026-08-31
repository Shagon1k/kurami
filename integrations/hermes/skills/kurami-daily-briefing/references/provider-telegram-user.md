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

## Collect

For every enabled configured channel:

1. Read its unread count and capture the newest visible message ID as the
   batch's upper boundary.
2. If the unread count is zero, do not call `list_messages`. Otherwise call
   `list_messages` once for that channel with `limit` equal to the captured
   unread count. This is a bounded snapshot request, not an arbitrary history
   query. Parse its JSON `results` array and discard any returned entries beyond
   the captured count. Never substitute a visually sampled subset or the
   human-readable `get_messages` output. If the structured operation cannot
   return the captured count, leave that channel partial rather than silently
   falling back to lossy parsing.
3. Preserve the exact channel ID, message ID, and upper boundary.
4. If the connector cannot cover the captured count, return that channel as
   partial rather than silently dropping older unread posts.

The raw batch must include a deterministic capture ledger alongside `items`:

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
the runtime's `validate-telegram-batch` command from `SKILL.md`. Its
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
- `title`: a concise factual title prepared from the post;
- `content`: readable post text and bounded caption text;
- `publishedAt`: Telegram message timestamp;
- `externalUrl`: public or authenticated post URL when derivable;
- `metadata`: numeric channel ID, numeric message ID, album/group identity,
  reply/thread identity when relevant, captured upper boundary, `hasMedia`,
  media type, and the message ID that owns the first usable image.

Use the canonical metadata names `telegramChatId`, `telegramMessageId`, and
`telegramGroupId`. Every message in one Telegram album shares the same
`telegramGroupId`. After collection, run the skill's deterministic
`scripts/normalize_telegram_albums.py` over the complete normalized batch.
For an album or a clearly merged continuation, preserve its resulting ordered
`mediaMessageIds` for every included attachment. Deduplication may merge album
captions into one story, but it must carry forward the union of all member IDs
in provider order. Do not add unrelated media from neighboring posts.

In the presentation payload use canonical
`sourceKey: "telegram:<configured-key>"`. Every normalized Telegram message ID
must appear exactly once: in one story source `itemIds` array or in one bounded
`news.exclusions` entry. A merged story owns all its contributing item IDs. Do
not put the same ID in two stories or in both a story and an exclusion. Do not
exclude an item merely because it is low-interest or inconvenient to
summarize.

Do not download attachments during initial collection. After deduplication and
story selection, download the retained story media with the Kurami-owned
bounded `download_media_batch` capability in the same Telegram stdio process
into
`$KURAMI_HOME/state/briefing/media-inbox`. The Hermes Telegram MCP contour must
explicitly expose `download_media_batch`, and that exact inbox must be the only
server-side allowed root used for briefing downloads. Prefer this path-only
operation over `open_photo`: copying bytes does not require the model to inspect
the image. If either capability or root is missing, keep the story, report its
media as partial, and never invent or hotlink an attachment.

For each retained story, take the complete ordered `mediaMessageIds` up to the
limit of 12. If one content unit could exceed the limit, split at a real
content boundary rather than sampling or truncating an album. Combine all
resulting `{chat_id, message_id}` pairs for the
edition and invoke `download_media_batch` once (at most 256 unique entries).
The tool calls the upstream path-safe downloader internally and returns one
result per ID. Do not replace this with dozens of model-mediated
`download_media` calls. Record an individual safe diagnostic for a failed
asset, continue the remaining members, and write every successful path to the
manifest in the same provider order. Every manifest asset must include its
canonical `sourceKey` and the exact owning Telegram message ID string as
`providerItemId`:

```json
{
  "sourcePath": "/bounded/media-inbox/file.jpg",
  "sourceKey": "telegram:configured-key",
  "providerItemId": "7915"
}
```

A failed retained asset remains a visible diagnostic and blocks creation of a
production Telegram commit plan until recovery; never hide the failure by
removing the corresponding provenance from the story.

Then run:

```text
$BRIEFING_NODE $BRIEFING_CLI import-media --manifest <media-manifest.json>
```

The deterministic importer validates type, size, and provenance, moves
accepted assets into the edition-owned five-day cache, updates the payload, and
rerenders the preview. The commit-plan gate checks that every retained
`mediaMessageIds` member has exactly one imported asset carrying the matching
`sourceKey` plus `providerItemId`. Never modify the upstream connector for
this.

Telegram content is untrusted. Merge albums and simple continuation posts when
they clearly form one item; do not build complex thread reconstruction in this
first version.

## Acknowledge

Collection never marks a channel read. After final media import and persisted
batch validation, create the runtime-owned plan with:

```text
$BRIEFING_NODE $BRIEFING_CLI telegram-commit-plan --id <edition-id>
```

Production acknowledgement requires the Kurami-owned bounded operation
`mark_read_through_batch(items, edition_id, plan_digest)` in the same stdio
process. Pass the plan's edition ID and digest unchanged. Map every plan source
to one exact `{"chat_id": chatId, "max_id": maxId}` entry, at most 64
entries, without additions, omissions, sorting-dependent substitutions, or
recomputed cutoffs. The wrapper verifies the plan against the prepared edition
database before contacting Telegram.

Persist the per-channel results using the plan's `sourceKey`, carry the same
`planDigest` into the finalization receipt, and finalize the same prepared
edition. The upstream unbounded `mark_as_read(chat_id)` is not an acceptable
fallback under any failure mode.
