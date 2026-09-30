---
title: Choosing and ordering news
nav: Choosing and ordering news
summary: Which checks the agent's draft passes, how code ranks the stories and how the interest profile rearranges the feed for you by formula.
section: digest
group: internals
order: 30
next: digest-storage
---

News selection is a set of checks and formulas that turn the agent's draft into an ordered feed. The agent supplies the words and four ratings per story, and code decides everything else: which texts are acceptable, where a story lands and how the order changes with your reactions. No model is called in the process, so the same draft always produces the same feed.

:::glance
- What it does: checks the draft, polices topics, computes the "Обзор" (overview) order and the "Для меня" (for me) order
- Started by: the edition build in the morning; a press of "Для меня" on the page
- Where it runs: the runtime and the Digest site, in TypeScript, without a model
- State: `topic_registry`, `reaction_events`, the `rank` field of every story
- Result for you: a feed where every post is accounted for, topics are valid and the order is explainable
:::

```diagram
kind: graph
title: From the draft to two orders
desc: The draft passes text, topic and coverage checks, then ranking produces the overview order. Reactions accumulate in the database and build a profile, and the profile together with the overview order produces the for-me order.
node draft "Draft" "written by the agent" actor at 0,0
node text "Text checks" "headlines, summaries" at 1,0
node topics "Topic checks" "registry and rules" at 2,0
node cover "Coverage" "every post once" at 2,1
node rank "Ranking" "deterministic-v1" at 1,1
node feed "Overview order" "saved in the morning" at 0,1
node forme "For-me order" "on request" at 0,2
node profile "Profile" "topic and source weights" at 1,2
node reactions "reaction_events" "your 🔔 and 🔕" store at 2,2
edge draft -> text
edge text -> topics
edge topics -> cover
edge cover -> rank
edge rank -> feed
edge feed -> forme "base"
edge reactions -> profile
edge profile -> forme "adjustments"
```

## Draft checks

The checks keep weak texts out of the edition, because rejecting a bad draft is easier than repairing a finished page. They run three times: in the trial ranking, in the build and when the page is prepared. A draft must pass every check at once.

| Area | Rule |
|---|---|
| Headline | At most 120 characters and 18 words, no template prefixes like "Что произошло:" (what happened), no ellipsis at the end |
| Summary | At most 360 characters and 55 words, does not repeat the headline, no filler like "подробности сохранены в раскрытии" (details are kept in the disclosure) |
| `details` paragraphs | The first paragraph does not wrap the source text and does not repeat the summary |
| Copying | A headline and summary do not equal the start of the source post; two stories may not share a summary |
| Duplicates | Two posts with identical text of 80 characters or more must join one story |
| Notes | The number of notes is exact, at most one per five consecutive stories |

The copy check exists because the easiest thing for an agent is to paste a post's first sentence. A "headline = clipped source" is rejected automatically, and the agent has to rewrite the story.

## Post coverage

Coverage guarantees that no captured post is lost. Every post of the batch has exactly one owner: a story or an entry in `exclusions`. The exclusion reason is one of four — `non-content`, `exact-duplicate`, `unsafe`, `unreadable`; "not interesting" or "the edition is long" are not reasons. A post in two stories, a post with no owner and an owner with an unknown post all reject the draft alike. A long feed is relieved by pagination of 10 stories, not by dropping posts.

## Topics

Every story gets topics from one shared registry, and the registry has rules. The registry is a starting list of about seventy topics plus the `topic_registry` table. A topic has an English id and label, plus Russian and English synonyms.

- A known topic must be given with its canonical label, without extra fields.
- A new topic is declared by the agent as `proposed`: an English id, a label of at most 48 characters without Cyrillic, synonyms. If it matches an existing topic, the draft is rejected.
- A geographic topic is allowed only with textual evidence in the story.
- One broad topic is not enough: every story needs a narrow one. For `housing` a narrow topic from the list is mandatory.
- The same set of topics may appear at most `max(3, ceil(stories / 10))` times in an edition and at most three times per channel.

A proposed topic becomes active when at least three different stories have used it, in at least two editions or two channels. That way the registry grows from material, not from the whim of one draft.

## The "Обзор" ranking

The overview order is the sum of the agent's four ratings, recomputed by code. The agent chooses only a word from a fixed set, and code assigns the number.

| Rating | Values and points |
|---|---|
| Importance | `low` 0, `medium` 30, `high` 70, `critical` 120 |
| Urgency | `none` 0, `soon` 10, `today` 25 |
| Public interest | `low` 0, `medium` 12, `high` 28 |
| Confidence | `low` −12, `medium` 0, `high` +8 |

Stories are sorted by the sum, then by the post's time, then by place in the draft. A diversity pass follows: after each story the next one is taken that shares no topic with the previous one, but only if it trails by at most 12 points. The main stories are up to five with importance `critical` or `high`; if there are fewer than three, the first three are taken. The order is stored in the edition and not recomputed: that is the "Обзор".

## The "Для меня" interest profile

The profile turns your reactions into weights of topics and sources. Only the latest reaction per story counts; a repeat does not double the weight, and clearing removes it. The profile switches on when there are 10 active reactions on different stories. How this looks on the page is described in [For me](@for-me).

A story has features of five kinds: broad topic, narrow topic, geography, topic pair and source. A feature's weight is `(likes − dislikes) / (n + 4)`, where `n` is the number of reactions with that feature; with fewer than three reactions the weight is zero. The 4 in the denominator softens rare cases: three reactions give a weight below 0.43, not 1.

| Feature kind | Maximum contribution |
|---|---|
| Broad topic | 4 |
| Narrow topic | 8 |
| Geography | 2 |
| Source | 2 |
| Topic pair | 12 |

Each kind's contribution is the weight times the cap divided by the number of features of that kind on the story. The sum of adjustments is capped at ±20. A story's position for "Для меня" is `−1.5 × place in Overview + adjustment`. Protected stories — `critical` and those urgent for today with high importance or high interest — stay in their places; the others fill the free places in the order of the new score.

```diagram
kind: graph
title: Where a story lands in For me
desc: With fewer than ten reactions the overview order stays. Otherwise a protected story stays in place, and the others get an adjustment from minus twenty to plus twenty and take places by the new score.
node ready "10+ reactions?" decision at 1,0
node overview "Overview order" end at 0,1
node protected "Story protected?" decision at 2,1
node stay "Stays in place" end at 1,2
node adjust "Adjustment ±20" "from feature weights" at 2,2
node place "New place" "−1.5 × place + adjustment" end at 2,3
edge ready -> overview "no"
edge ready -> protected "yes"
edge protected -> stay "yes"
edge protected -> adjust "no"
edge adjust -> place
```

::::example Story story-3fa2c19b7d40e5a1 in tenth place
:::steps
- **Runtime** — the story's ratings: `medium` (30) + `none` (0) + `high` (28) + `high` (+8) = 66 points. In Overview it is tenth: index 9.
- **Profile** — the story has four features: `topic:science`, `aspect:space`, `pair:science+space` and `source:telegram:space-news`. Weights: 0.2 (4 likes, 2 dislikes, 6 reactions → 2/10), 0.4 (5 and 1 → 4/10), 0.5 (4 and 0 → 4/8) and 0.43 (3 and 0 → 3/7).
- **Runtime** — contributions: 0.2 × 4 = 0.8; 0.4 × 8 = 3.2; 0.5 × 12 = 6.0; 0.43 × 2 = 0.86. The adjustment is 10.86, below the cap of 20.
- **Runtime** — the story's score: −1.5 × 9 + 10.86 = −2.64. It is compared with −1.5 × index for the others and lands roughly in third place.
- **You** — press "Для меня" and see the hint "Больше такого: Science · Space" under the story.
:::
The data is invented; the formulas come from the code.
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| The draft breaks a rule | Returns the list of violations (up to 40), the edition is not built | Nothing: the agent fixes it |
| A topic is unknown and not declared | Rejects the story: an unknown topic must be declared as `proposed` | Nothing |
| A synonym matches several topics | Does not merge topics, the feature stays separate | Nothing |
| The order for you did not load | The page keeps the current order and says "Не удалось обновить профиль" (could not update the profile) | Press "Для меня" again |
| The server returned not all stories | The page rejects such an answer entirely | Nothing |
| Fewer than 10 reactions | "Для меня" falls back to "Обзор" | You keep reacting |

:::guarantees
- The "Обзор" order is stored in the edition and is not recomputed after publication.
- "Для меня" only rearranges stories: it hides nothing and changes neither texts nor stored places.
- Critical and urgent important stories stay in their places.
- The profile keeps only topic ids and channel keys, no headlines or texts.
- The profile does not count reading or source clicks, does not decay over time and calls no external services.
- The page applies an order for you only as a whole: the full set of ids without losses or repeats.
:::

:::code-map
- `src/briefing/editorial-validation.ts` — text, topic and note checks
- `src/briefing/addons/news/editorial.ts` — copy check, duplicates, story ids
- `src/briefing/coverage.ts` — post coverage
- `src/briefing/ranking.ts` — points and the "Обзор" order
- `src/briefing/interest-profile.ts` — weights and the "Для меня" order
- `src/briefing/interest-profile-store.ts` — reactions and events
- `deploy/config/briefing-topics.yaml` — the topic seed and rules
- `docs/interest-profile-v1.md` — the original description of the formula
:::
