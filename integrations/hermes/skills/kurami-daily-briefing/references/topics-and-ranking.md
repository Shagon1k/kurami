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

Start from the runtime topic pool returned by
`$BRIEFING_NODE $BRIEFING_CLI topic-pool`. It combines the configured seed with
topics proposed in previous editions. Analyze the full normalized story content
before assigning topics. Match a story to the pool before proposing a new one.
Treat close synonyms such as `Cinema`, `Films`, and `Movies` as one concept
unless a narrower recurring distinction already exists.

Build the lookup directly from the registry's `id`, `label`, and `aliases`.
An existing topic placed in a briefing payload must reuse its exact `id` and
exact `label`; omit proposal metadata when reusing it. Do not construct a
separate label-to-ID map in an ad-hoc script or title-case candidates blindly.

When no pool entry expresses a durable and useful distinction, create a new
topic in the same story and use it immediately:

```json
{
  "id": "food-theft",
  "label": "Food Theft",
  "status": "proposed",
  "aliases": ["stolen food", "кража еды"]
}
```

The runtime persists it in the pool for subsequent editions. Before proposing,
compare the candidate ID, label, and aliases against every pool entry. Do not
create a synonym, spelling variant, renamed entity, one-off joke, company,
person, or source label. If the distinction is not likely to recur, use the
closest meaningful existing topic instead.

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
- Every story must contain at least one contextual subtype beyond broad
  containers and geography. `Society + Media`, `AI + Technology`, and
  `Cinema + Culture` are incomplete assignments by themselves: add or propose
  the durable mechanism actually present in that story.
- Do not stamp one topic pair across a channel. The runtime rejects excessive
  reuse of an exact topic set globally and more than three uses of that set for
  one source in an edition. This is a shortcut detector, not a quota: topics
  still have to be supported by each story's complete content.

## Propose and promote

Create a `proposed` topic only when no registered topic expresses a durable,
repeatable distinction. A proposal is visible in the edition immediately and
may collect feedback immediately; `proposed` describes registry maturity, not
UI visibility.

Promote it to `active` after it appears in at least three stories across at least two
editions or independent sources. Before promotion, check aliases and neighboring
topics again. Merge synonyms instead of creating parallel IDs.

Keep the active registry around 30–80 topics at this stage. Growth should reflect
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
After a feature has at least three distinct-story reactions, its weight is
`(likes - dislikes) / (likes + dislikes + 4)`. Before that its weight is zero.
Bounded pair scores refine `For You`; sparse evidence shrinks toward zero. Do not create visible combined categories merely to support this score.
Interest Profile v1 now also captures canonical source keys as a weak signal,
following the approved roadmap. Do not add a machine-learning model, time decay
or inferred negative feedback.

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

## Implemented Interest Profile v1

The News runtime owns profile calculation and optional view ordering. The
skill continues to produce the ordinary editorial morning order and must not
pre-sort or omit stories using personal weights. Runtime policy `interest-v1`
uses broad topics, narrower canonical aspects, configured geography, topic
pairs and a weak source dimension. Full formula, thresholds, APIs and
retention are in `docs/interest-profile-v1.md` in the application repository.
The UI provides Обзор / Для меня. A selected bell toggles to clear; a reaction
never triggers an implicit reshuffle or changes the published snapshot.
