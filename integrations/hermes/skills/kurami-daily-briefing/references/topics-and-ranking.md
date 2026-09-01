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
- Prefer a compositional mix of domain, geography, and durable subtype when
  each is genuinely relevant. For example, American AI regulation may carry
  `AI`, `Law`, `Politics`, and `United States`; Lithuanian municipal politics
  may carry `Politics`, `Lithuania`, and `Public Administration`. Do not create
  one combined topic such as `American Politics` when the intersection can be
  represented by stable independent topics.
- Use two for an unusually narrow story rather than padding.
- Do not use a person's name, company, product, city, channel, or provider as a
  topic by default; store it as an entity.
- Do not infer topics from a source group without reading the item.
- Treat channel identity and editorial origin as zero evidence for geography.
  An Onliner item is not `Belarus`, a Lithuanian-news-channel item is not
  `Lithuania`, and a travel-channel item is not `Travel` unless the story text
  itself supports that topic. Geography must describe where the event happens
  or the jurisdiction it concerns.
- Prefer the event mechanism over a generic container. `Housing` alone does
  not distinguish construction, demolition, housing policy, or the housing
  market; pair it with the applicable canonical subtype. Apply the same
  principle to other broad domains whenever the registry contains a durable
  narrower topic.
- Preserve topic order from most specific and useful to broader context.

## Propose and promote

Create a `proposed` topic only when no active topic expresses a durable,
repeatable distinction. Keep proposals outside the edition payload until they
are promoted; a proposed topic does not immediately affect the long-term
profile.

Promote it after it appears in at least three stories across at least two
editions or independent sources. Before promotion, check aliases and neighboring
topics again. Merge synonyms instead of creating parallel IDs.

Keep the active registry around 30–60 topics at this stage. Growth should reflect
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

Initially calculate per-topic positive and negative counts. Also retain the
canonical topic set on each explicit event so later profiling can distinguish
intersections such as `Politics + United States` from `Politics + Lithuania`.
After an exact topic pair has at least three explicit reactions, a bounded pair
score may refine `For You`; shrink sparse pairs toward their individual topic
scores. Do not create visible combined categories merely to support this score.
Do not add a machine-learning model, source preference, time decay, or inferred
negative feedback in the first version.

## Ranking modes

`Briefing` ignores personal reaction scores and uses editorial importance,
freshness, novelty, confidence, and diversity.

`For You` becomes available after ten explicit non-cleared reactions. It adds a
bounded preference adjustment to the same editorial base. The adjustment must
not override critical or strongly time-sensitive news and must not hide any
story.

Preserve variety inside each page: do not allow one domain, geography, source,
or learned preference cluster to dominate consecutive top positions when
comparably important alternatives exist. Diversity is a bounded reranking
constraint, not a reason to promote weak material or hide disliked topics.

`Newest` sorts by the newest reliable publication time. Merged stories use the
time of the newest contributing report while retaining all source times.

Use stable tie-breaking so pagination does not reshuffle while the reader is on
the frozen edition.
