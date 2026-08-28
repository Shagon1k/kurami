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

`weather`, `priorities`, and `cinemaPreview` may be absent when no trustworthy
input exists. `calendar`, `mail`, `news`, and `dataQuality` must always disclose
whether they are ready, empty, partial, stale, or failed. Empty is a valid fact;
it is not a rendering error.

## Calendar

Provide:

- accepted and tentative timed events from the primary calendar;
- all-day events in a separate collection;
- conflicts with the exact overlapping events and duration;
- useful free windows derived from known events;
- source freshness and retrieval status.

Do not infer an event priority from its title. Exclude declined and cancelled
events. Preserve source time zones and provide normalized local display times.

## Mail

Every unread message belongs to exactly one editorial class:

- `ACTION`: Alex probably needs to reply or do something;
- `IMPORTANT`: important information without a required action;
- `GENERAL`: everything else.

Each mail item needs a stable internal item ID, sender, subject, received time,
short summary, class, source state, selected state, and a server-side action
reference. Provider message IDs may be stored server-side but must not become
arbitrary browser-supplied tool parameters.

The only initial bulk mutation is `read_and_archive`: remove `UNREAD` and
`INBOX` from the explicitly selected messages. Generation itself never invokes
this action.

## News story

Use a flexible story rather than a mandatory prose template:

```json
{
  "id": "stable internal story id",
  "fingerprint": "stable cross-edition content fingerprint",
  "headline": "Russian headline",
  "summary": "Concise Russian summary",
  "details": ["optional extended factual paragraphs"],
  "context": "optional background",
  "whyItMatters": "optional, only when it adds information",
  "depth": "compact | standard | deep",
  "topics": [
    {"id": "cinema", "label": "Cinema"}
  ],
  "entities": ["Original entity spelling"],
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

`news.items` is the complete normalized collection for the edition.
`news.mainStoryIds` references zero or more IDs from that collection and
`news.pageSize` is an integer from 10 through 12. The renderer may paginate but
must not drop items. Story IDs identify one edition item; fingerprints identify
the same underlying story across editions and are used only for deduplication
and durable preference events.

Target three or four canonical topics. Use two only for a genuinely narrow
story; never pad with a provider, channel name, arbitrary person, or vague
synonym. Entities remain separate from topics.

`summary` must make the news understandable without opening the source.
`details` may be long when the event genuinely needs explanation. Do not add
`whyItMatters` merely to fill a card.

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
- last successful timestamp;
- missing or stale source label;
- safe error code and short explanation;
- whether Telegram read commit succeeded through the recorded cutoff.

Never expose credentials, MCP URLs, raw email bodies, environment values, or
stack traces in the page payload.
