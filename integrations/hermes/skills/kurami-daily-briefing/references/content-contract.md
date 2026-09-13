# Briefing content contract

The briefing producer owns facts, selection, ordering, topics, states, actions,
and provenance. The UI renderer receives display-ready content and must not
silently repair missing semantics.

## Edition envelope

Every payload uses a versioned envelope with these roles:

```json
{
  "schemaVersion": 2,
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
  "live": {
    "refreshedAt": "RFC3339 timestamp",
    "state": "ready | empty | partial | stale | failed",
    "lastSuccessAt": "RFC3339 timestamp"
  },
  "weather": {},
  "calendar": {},
  "priorities": [],
  "mail": {},
  "news": {
    "state": "ready",
    "pageSize": 10,
    "mainStoryIds": ["story:example"],
    "items": [],
    "exclusions": []
  },
  "cinemaPreview": null,
  "dataQuality": {},
  "actions": {}
}
```

## Kurami Notes

The producer, not the renderer, writes daily note copy in two passes. First
compose a rank-only preview without notes; then inspect its finished ranked story
list and author notes against those visible slots, alongside `recentNotes` from
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

Supply exactly the deterministic edition budget
`min(6, max(1, ceil(story_count / 5)))`, each one to four words. In the
ranked feed, story notes must occupy distinct consecutive five-story bands;
this is selected from the rank-only preview before the final compose. Supported
section targets are
`hero`, `news`, `calendar`, `mail`, `metric:mail`, `metric:stories`,
`metric:time`, and `metric:weather`. A note may instead target one concrete
visible item with `calendar-event:<item-id>`, `mail-item:<item-id>`, or
`story:<item-id>`. Supported roles are `focus`, `context`, `action`,
`reassurance`, and `personality`; supported tones are `signal` and `ink`;
supported rotations are `none`, `negative`, and `positive`. `mark` may be
`arrow-down`, `arrow-down-left`, `arrow-down-right`, or `arrow-right`. Story
notes use `arrow-down-left`; the composer normalizes their mark accordingly.

Write fresh copy for the edition rather than choosing from a phrase pool. At
least two thirds of the notes target concrete visible items, primarily stories.
The remaining notes may annotate a section or live metric. At most two notes
may use `role: "personality"` for gentle humor that follows from a visible fact;
the rest carry an informative signal. Never force a joke, joke about sensitive
news or private mail, or write vague commentary that could fit any day. Every
note must point to visible content, use a different target and treatment, and
avoid exact or conspicuously near
repeats from the retained five-day history. Omit a slot when no grounded note
is useful. The renderer validates and positions supplied notes; it never
supplies generic fallback phrases.

`weather`, `priorities`, `live`, and `cinemaPreview` may be absent when no trustworthy
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

`sourceKey` is canonical and starts with `telegram:`. Include a source batch
only for a non-empty captured Telegram batch. Empty, partial, and failed
configured channels still remain visible in the raw capture ledger and data
quality diagnostics.

The runtime persists this exact snapshot during preparation. In schema version
2, the union of all `sourceBatches[].itemIds` is an exact accounting set. Every
member must have exactly one owner: either one story source or one bounded
`news.exclusions` entry. Unknown IDs, missing IDs, and IDs claimed twice are
validation errors.

After final preparation and media import, bind the raw and normalized artifact
digests to the edition, create a commit plan, and pass that exact plan to the
bounded Telegram wrapper. The resulting receipt carries the edition ID, the
plan digest, and one `{sourceKey, status}` result per batch:

```json
{
  "editionId": "daily:2026-08-28",
  "planDigest": "2f3f...64 hexadecimal characters",
  "results": [
    {"sourceKey": "telegram:channel-key", "status": "committed"}
  ]
}
```

Then call:

```text
$BRIEFING_NODE $BRIEFING_CLI finalize --id <edition-id> --receipts <receipts.json>
```

Finalization rejects a missing or different `planDigest`.

## Bounded news exclusions

An exclusion is an explicit terminal owner for one captured Telegram input:

```json
{
  "sourceKey": "telegram:channel-key",
  "itemId": "145",
  "reason": "non-content | exact-duplicate | unsafe | unreadable",
  "note": "optional short non-secret diagnostic"
}
```

Use `non-content` only for material with no news substance, such as an isolated
navigation post or empty service update. Use `exact-duplicate` only when the
same captured fact is already owned by a story and this provider item itself is
not also listed in that story. Use `unsafe` for content that cannot safely be
carried into the briefing, and `unreadable` for an input whose meaningful text
cannot be recovered. Low interest, low rank, inconvenient length, and page
volume are not exclusion reasons. Pagination handles volume.

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
    {"id": "cinema", "label": "Cinema"},
    {
      "id": "food-theft",
      "label": "Food Theft",
      "status": "proposed",
      "aliases": ["stolen food", "кража еды"]
    }
  ],
  "entities": ["Original entity spelling"],
  "editorialSignals": {
    "importance": "low | medium | high | critical",
    "urgency": "none | soon | today",
    "publicInterest": "low | medium | high",
    "confidence": "low | medium | high",
    "publishedAt": "optional reliable RFC3339 timestamp"
  },
  "media": [
    {
      "id": "story-example-media-1",
      "kind": "image",
      "src": "/media/daily/2026-08-28/story-example/01.jpg",
      "mimeType": "image/jpeg",
      "alt": "Contextual image description",
      "sourceKey": "telegram:channel-key",
      "providerItemId": "145"
    }
  ],
  "sources": [
    {
      "provider": "Telegram",
      "profile": "telegram-user",
      "sourceKey": "telegram:channel-key",
      "sourceLabel": "channel display name",
      "url": "original destination",
      "publishedAt": "RFC3339 timestamp",
      "itemIds": ["provider item ids retained server-side"],
      "mediaMessageIds": ["provider item IDs with retained images"]
    }
  ],
  "duplicateCount": 1,
  "readState": "unread | read",
  "reaction": null
}
```

`media` is optional and may contain one to twelve edition-cached images in
provider order. Every Telegram-backed asset carries the same
canonical `sourceKey` as its story source and the exact Telegram message ID as
`providerItemId`. The pair must match one entry from that source's
`mediaMessageIds`. The first image becomes the compact feed cover; the full set
appears only inside the expanded story. Do not put provider-local paths,
Telegram-authenticated URLs, or base64 payloads into this contract.

`news.items` plus `news.exclusions` is the complete normalized Telegram
collection for the edition. Every `sourceBatches[].itemIds` member occurs
exactly once across `news.items[].sources[].itemIds` and
`news.exclusions`; a merged story claims all contributing input IDs. An item
cannot be both a story source and an exclusion, and it cannot be claimed by two
stories.

`news.items` is the complete visible story collection for the edition.
`news.mainStoryIds` references zero or more IDs from that collection and
`news.pageSize` is an integer from 10 through 12. The renderer may paginate but
must not drop items. Story IDs identify one edition item; fingerprints identify
the same underlying story across editions and are used only for deduplication
and durable preference events.

The editorial step supplies only bounded `editorialSignals`. The runtime owns
their versioned weights, stable tie-breaking, diversity pass, final rank,
`mainStoryIds`, stable story ID and fingerprint. Do not hand-author those
derived fields in an editorial draft.

Target three or four canonical topics. Use two only for a genuinely narrow
story; never pad with a provider, channel name, arbitrary person, or vague
synonym. Reused topics carry only their registered `id` and `label`. A newly
created topic additionally carries `status: "proposed"` and one to eight
multilingual aliases; the runtime adds it to the persistent pool and permits it
in the same story. Entities remain separate from topics.

`summary` is the scan layer: it says what happened without turning into a
second headline. `headline` and `summary` are separately authored editorial
fields, not two character-limited slices of the source post. The headline must
identify the event in a complete phrase; the summary must add useful facts and
must not start by repeating the whole headline. Neither may end with an
ellipsis caused by clipping. `details` is a self-contained reading layer, not
a two-sentence teaser. It must preserve enough concrete actors, actions, dates, numbers,
background, uncertainty, and consequences for Alex to understand the useful
substance without leaving the briefing. Remove channel boilerplate and do not
merely repeat the summary.

The production validator rejects generic headline prefixes such as
`Что произошло:`, headlines above 120 characters or 18 words, identical scan
summaries, navigation placeholders in `summary`, and source wrappers in
`details`. It also rejects topic assignments made only of broad containers and
geography, plus suspicious edition-wide or per-source reuse of one exact topic
set. A failed validation is a request to repair the editorial draft; never work
around it with another stock phrase.

Use length as a diagnostic, never as a reason to pad or invent:

- `compact`: normally 250–500 characters when the source supports it;
- `standard`: normally 500–1000 characters;
- `deep`: normally 900–1600 characters.

A genuinely short source may remain shorter if the details contain every
meaningful fact. A complex event may use several paragraphs. For standard and
deep stories, follow the linked primary article when it is available and the
configured capability permits it; preserve that provenance in `sources`. Do
not add `whyItMatters` merely to fill a card.

`media` is optional. Include the complete ordered retained set of one to twelve
edition-cached images when safe media is available; omit the entire
field otherwise. Do not sample only the first one or two attachments. Preserve
the album's provider order. If a real content unit would exceed twelve assets,
split it at a genuine content boundary rather than silently truncating it. The
first image is the compact cover and the complete set belongs to the expanded
reading layer. `src`
must be a runtime-local media path, never an authenticated Telegram URL or an
arbitrary filesystem path. Preserve intrinsic dimensions and write factual alt
text. The renderer must not invent a placeholder.

Telegram videos and other non-image attachments are not transported into an
edition. Preserve their provider identities in normalized diagnostic metadata
and keep the story source link so the user can open them in Telegram. They must
not appear in `mediaMessageIds`, a media manifest, or the commit-gate expected
asset count.

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

## Hourly live refresh

The production edition freezes `edition`, `news`, `sourceBatches`, topics,
media, reactions, and story read state at the morning publication boundary.
The deterministic external `Digest-Central-Poller` may refresh only live
surfaces for the retained five-day window: `mail`, `weather`, relevant
`calendar` state, and `live` timestamps. It uses the `open-meteo` provider for
weather, runs hourly without an agent or model, and preserves the last
successful value when one provider fails. A poller update must not mutate,
acknowledge, rerank, or rewrite Telegram news.
