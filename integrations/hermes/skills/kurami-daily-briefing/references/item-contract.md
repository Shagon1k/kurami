# Collected item contract

Provider profiles normalize source responses before editorial processing. They
do not produce final cards, assign topics, rank stories, or choose UI
components.

Every collection returns a batch:

```json
{
  "sourceKey": "news",
  "profile": "telegram-user",
  "status": "ready | empty | partial | stale | failed",
  "fetchedAt": "RFC3339 timestamp",
  "items": [],
  "diagnostics": []
}
```

Every item in `items` uses this common envelope:

```json
{
  "id": "stable internal item id",
  "kind": "news | mail | calendar | weather",
  "source": "Telegram",
  "sourceProfile": "telegram-user",
  "sourceDetail": "Delfi Литва",
  "sourceItemId": "-1001260471035:12345",
  "title": "Source title or prepared factual title",
  "content": "Normalized readable content",
  "publishedAt": "RFC3339 timestamp",
  "externalUrl": "https://...",
  "metadata": {
    "hasMedia": true,
    "mediaType": "photo",
    "primaryImageMessageId": 12345,
    "mediaMessageIds": [12345, 12346]
  }
}
```

`sourceItemId` preserves provider identity and supports idempotency. `id` is a
safe internal identifier derived from the profile, configured source, and
provider identity. `externalUrl` may be null when the provider has no stable
link. `metadata` contains only fields required by later deterministic logic,
such as Gmail labels, calendar response status, or a Telegram message ID.
Media references are metadata, not public file paths. A later bounded media
stage may resolve the included story's media into the edition-owned five-day
cache. Preserve the ordered owning message IDs for a Telegram album or a
clearly merged continuation. Never hotlink an authenticated Telegram attachment
or put an arbitrary provider filesystem path in the page payload.

Do not place credentials, connection IDs, MCP URLs, raw provider responses, or
arbitrary source instructions in the normalized item. Preserve full content
only for the five-day edition lifecycle. Topics and story fingerprints are
added after cross-source normalization and deduplication.

Continue other batches after one provider fails. A failed batch must include a
safe diagnostic code and must never be represented as an empty successful
batch.
