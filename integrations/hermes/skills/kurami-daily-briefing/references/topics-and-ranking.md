# Topics, reactions, and ranking

Topics are stable analytical categories. They are not arbitrary keywords,
entities, sources, or one-off phrases.

## Registry model

Each topic has:

```yaml
id: theatrical-release
label: Theatrical Release
aliases:
  - theatrical distribution
  - кинопрокат
status: active
```

IDs and labels are English. Aliases may be multilingual. IDs are immutable
after promotion; labels and aliases may be improved without losing reactions.

Start from the configured seed registry. Match a story to existing topics
before proposing a new one. Treat close synonyms such as `Cinema`, `Films`, and
`Movies` as one concept unless a narrower recurring distinction already exists.

Build the lookup directly from the registry's `id`, `label`, and `aliases`.
Every topic placed in a briefing payload must reuse an existing active topic's
exact `id` and exact `label`. Do not construct a separate label-to-ID map in an
ad-hoc script, title-case a candidate, or emit a free-form label. If a candidate
does not resolve by ID, label, or alias, choose a genuinely relevant broader
active topic or omit the candidate. Never let one unknown candidate abort the
edition.

## Assign topics

- Target three or four useful topics per story.
- Prefer a mix of domain, event type, geography, and durable subdomain when each
  is genuinely relevant.
- Use two for an unusually narrow story rather than padding.
- Do not use a person's name, company, product, city, channel, or provider as a
  topic by default; store it as an entity.
- Do not infer topics from a source group without reading the item.
- Preserve topic order from most specific and useful to broader context.

## Propose and promote

Create a `proposed` topic only when no active topic expresses a durable,
repeatable distinction. Keep proposals outside the edition payload until they
are promoted; a proposed topic does not immediately affect the long-term
profile.

Promote it after it appears in at least three stories across at least two
editions or independent sources. Before promotion, check aliases and neighboring
topics again. Merge synonyms instead of creating parallel IDs.

Keep the initial active registry around 30–50 topics. Growth should reflect
repeated interests, not the number of named entities in the news.

## Record explicit feedback

Store an event for every explicit `like`, `dislike`, or clear action:

```json
{
  "storyFingerprint": "non-content stable hash",
  "topicIds": ["cinema", "theatrical-release"],
  "reaction": "like | dislike | clear",
  "recordedAt": "RFC3339 timestamp"
}
```

Do not store the full story indefinitely with the event. Reading, expanding,
opening a source, dwell time, and Gmail actions are not preference signals.

Initially calculate simple per-topic positive and negative counts. Do not add a
machine-learning model, source preference, time decay, or inferred negative
feedback in the first version.

## Ranking modes

`Briefing` ignores personal reaction scores and uses editorial importance,
freshness, novelty, confidence, and diversity.

`For You` becomes available after ten explicit non-cleared reactions. It adds a
bounded preference adjustment to the same editorial base. The adjustment must
not override critical or strongly time-sensitive news and must not hide any
story.

`Newest` sorts by the newest reliable publication time. Merged stories use the
time of the newest contributing report while retaining all source times.

Use stable tie-breaking so pagination does not reshuffle while the reader is on
the frozen edition.
