# Briefing content contract

The briefing producer owns facts, selection, ordering, topics, states, actions,
and provenance. The UI renderer receives display-ready content and must not
silently repair missing semantics.

## Edition envelope

Every payload uses a versioned envelope with these roles:

```json
{
  "schemaVersion": 1,
  "edition": {
    "id": "daily:2026-08-28",
    "type": "daily",
    "localDate": "2026-08-28",
    "timezone": "Europe/Vilnius",
    "generatedAt": "RFC3339 timestamp",
    "status": "complete | partial",
    "retentionUntil": "RFC3339 timestamp"
  },
  "hero": {},
  "notes": [],
  "weather": {},
  "calendar": {},
  "priorities": [],
  "mail": {},
  "news": {
    "state": "ready",
    "pageSize": 10,
    "mainStoryIds": ["story:example"],
    "items": []
  },
  "cinemaPreview": null,
  "dataQuality": {},
  "actions": {}
}
```

## Kurami Notes

The producer, not the renderer, writes the daily note copy. Notes are authored
from the finished visible payload after inspecting `recentNotes` from
`briefing inspect`:

```json
{
  "notes": [
    {
      "id": "note:hero",
      "target": "hero",
      "text": "утро без суеты",
      "role": "reassurance",
      "tone": "signal",
      "rotation": "positive",
      "mark": "arrow-down-right"
    }
  ]
}
```

Supply one or two notes, each one to four words. Supported targets are `hero`
and `news`; supported roles are `focus`, `context`, `action`, `reassurance`,
and `personality`; supported tones are `signal` and `ink`; supported rotations
are `none`, `negative`, and `positive`. `mark` may be `arrow-down`,
`arrow-down-right`, or `arrow-right`.

Write fresh copy for the edition rather than choosing from a phrase pool. Every
note must point to visible content, use a different role or treatment when two
are present, and avoid exact or conspicuously near repeats from the retained
five-day history. Omit a slot when no grounded note is useful. The renderer
validates and positions supplied notes; it never supplies generic fallback
phrases.

`weather`, `priorities`, and `cinemaPreview` may be absent when no trustworthy
input exists. `calendar`, `mail`, `news`, and `dataQuality` must always disclose
whether they are ready, empty, partial, stale, or failed. Empty is a valid fact;
it is not a rendering error.

## Calendar

Provide:

- accepted and tentative timed events from every enabled configured calendar;
- all-day events in a separate collection;
- conflicts with the exact overlapping events and duration;
- useful free windows derived from known events;
- calendar key and display label on every event;
- independent source freshness and retrieval status per calendar.

Do not infer an event priority from its title. Exclude declined and cancelled
events. Preserve source time zones and provide normalized local display times.
One failed calendar makes the aggregate section partial while successful
calendar events remain visible.

## Mail

Every unread message belongs to exactly one editorial class:

- `ACTION`: Alex probably needs to reply or do something;
- `IMPORTANT`: important information without a required action;
- `GENERAL`: everything else.

Each mail item needs a stable internal item ID, sender, subject, received time,
short summary, class, source state, selected state, and a server-side action
reference. For Gmail, store `provider: "gmail"` and the provider message ID as
`providerItemId` in the payload persisted by the runtime. The renderer must not
print `providerItemId`, and the browser submits only the internal item ID.

The only initial bulk mutation is `read_and_archive`: remove `UNREAD` and
`INBOX` from the explicitly selected messages. Generation itself never invokes
this action.

## Prepared source batches

A production daily payload includes one `sourceBatches` entry per successfully
captured Telegram channel:

```json
{
  "sourceKey": "telegram:channel-key",
  "provider": "telegram",
  "providerSourceId": "-1001234567890",
  "minItemId": "101",
  "maxItemId": "145",
  "itemIds": ["101", "102", "145"]
}
```

The runtime persists this exact snapshot during preparation. After the bounded
provider commit, write a small receipt artifact containing the edition ID and
one `{sourceKey, status}` result per batch, then call:

```text
$BRIEFING_NODE $BRIEFING_CLI finalize --id <edition-id> --receipts <receipts.json>
```

## News story

Use a flexible story rather than a mandatory prose template:

```json
{
  "id": "stable internal story id",
  "fingerprint": "stable cross-edition content fingerprint",
  "headline": "Russian headline",
  "summary": "Concise Russian summary",
  "details": ["extended factual paragraph available inline"],
  "context": "optional background",
  "whyItMatters": "optional, only when it adds information",
  "depth": "compact | standard | deep",
  "topics": [
    {"id": "cinema", "label": "Cinema"}
  ],
  "entities": ["Original entity spelling"],
  "media": [
    {
      "id": "story-example-media-1",
      "kind": "image",
      "src": "/media/daily/2026-08-28/story-example/01.jpg",
      "mimeType": "image/jpeg",
      "alt": "Contextual image description"
    }
  ],
  "sources": [
    {
      "provider": "Telegram",
      "profile": "telegram-user",
      "sourceId": "configured source key",
      "sourceLabel": "channel display name",
      "url": "original destination",
      "publishedAt": "RFC3339 timestamp",
      "itemIds": ["provider item ids retained server-side"]
    }
  ],
  "duplicateCount": 1,
  "readState": "unread | read",
  "reaction": null
}
```

`media` is optional and may contain one to twelve edition-cached images or
videos in provider order. The first image becomes the compact feed cover; the
full set appears only inside the expanded story. Do not put provider-local
paths, Telegram-authenticated URLs, or base64 payloads into this contract.

`news.items` is the complete normalized collection for the edition.
`news.mainStoryIds` references zero or more IDs from that collection and
`news.pageSize` is an integer from 10 through 12. The renderer may paginate but
must not drop items. Story IDs identify one edition item; fingerprints identify
the same underlying story across editions and are used only for deduplication
and durable preference events.

Target three or four canonical topics. Use two only for a genuinely narrow
story; never pad with a provider, channel name, arbitrary person, or vague
synonym. Entities remain separate from topics.

`summary` is the scan layer: it says what happened without turning into a
second headline. `details` is a self-contained reading layer, not a two-sentence
teaser. It must preserve enough concrete actors, actions, dates, numbers,
background, uncertainty, and consequences for Alex to understand the useful
substance without leaving the briefing. Remove channel boilerplate and do not
merely repeat the summary.

Use length as a diagnostic, never as a reason to pad or invent:

- `compact`: normally 250–500 characters when the source supports it;
- `standard`: normally 500–1000 characters;
- `deep`: normally 900–1600 characters.

A genuinely short source may remain shorter if the details contain every
meaningful fact. A complex event may use several paragraphs. For standard and
deep stories, follow the linked primary article when it is available and the
configured capability permits it; preserve that provenance in `sources`. Do
not add `whyItMatters` merely to fill a card.

`media` is optional. Include one to twelve ordered edition-cached images or
videos when safe media is available; omit the entire field otherwise. The
first image is the compact cover and the complete set belongs to the expanded
reading layer. `src`
must be a runtime-local media path, never an authenticated Telegram URL or an
arbitrary filesystem path. Preserve intrinsic dimensions and write factual alt
text. The renderer must not invent a placeholder.

## Feed controls

The frozen daily snapshot supports:

- `Briefing`: editorial importance, freshness, novelty, and diversity;
- `For You`: the same base with bounded preference influence;
- `Newest`: reverse chronology.

Show three to five important stories before the general feed when justified.
Paginate the general feed at 10–12 stories. All stories remain reachable in
every mode. Provide topic and source filters from actual payload values.

Expanding a story may invoke `mark_briefing_item_read`. External source links
remain separate. Reactions expose explicit `like`, `dislike`, and clear-state
semantics with accessible labels.

## Cinema

The Saturday daily payload may contain a compact preview of the current weekly
cinema edition. The full cinema edition has its own `cinema:<local-date>` ID and
may contain multiple recent trailers, next-week premieres, and box-office
items. Every time-sensitive claim needs a source date and target region. Omit a
section that cannot establish freshness rather than filling it with old data.

## Data quality

Provide a compact public summary and detailed diagnostics containing only
non-secret operational facts:

- section and source status;
- Telegram collection counts kept as distinct values: captured unread
  messages, fetched messages, normalized messages, resulting stories, and
  imported media assets;
- last successful timestamp;
- missing or stale source label;
- safe error code and short explanation;
- whether Telegram read commit succeeded through the recorded cutoff.

Never expose credentials, MCP URLs, raw email bodies, environment values, or
stack traces in the page payload.
