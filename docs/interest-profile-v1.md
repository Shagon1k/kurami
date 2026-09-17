# Interest Profile v1

Interest Profile is a deterministic service used by the News add-on.
It learns only from explicit 🔔 / 🔕 / clear events and supplies an optional
view order. It never edits the frozen edition, selects morning stories,
hides items, downloads media or calls an LLM/search provider.

## Evidence and storage

Migration `008_interest_profile.sql` adds nullable `context_json` to the
existing `reaction_events` table. Existing events and topic sets survive.
New events include only `{version: 1, sources: [canonical source keys]}`;
headlines, summaries, private bodies and entities are not copied into the
long-term profile.

The latest event per story fingerprint is authoritative. Repeated votes on
the same story do not increase evidence. Changing a vote replaces its
contribution; clear removes it. Reading and source clicks are not feedback.

The one-time `interest-context.js --apply` backfill can recover source keys
from still-retained editions with an exact matching fingerprint. It does not
invent the source for deleted editions or change historical topic sets.
Source coverage is visible in the explanation disclosure. Old reactions with
no source context still contribute their preserved topics.

Events remain after the seven-day edition cleanup. There is no time decay,
automatic classification of the reader, or external learning service in v1.

## Canonical features

Use the existing seeded/runtime topic pool:
- exact canonical IDs win;
- otherwise a normalized exact ID/label/alias with one owner resolves to that ID;
- ambiguous aliases never silently merge separate concepts;
- repeated aliases within one story count only once.

Geography uses the configured `geography_topics` set. Broad domains use
`generic_topics`. Other canonical topics are narrower aspects, such as
construction, demolition or housing policy. New geography IDs must be
declared in the taxonomy; channel identity is not geography evidence.

Distinct contextual topic pairs are internal features, not additional
visible topic labels. This permits opposite preferences for Politics +
United States and Politics + Lithuania. Source keys provide a separate,
deliberately weaker signal.
Pairs of two broad containers (AI + Technology) or two geography tags do not
receive a contextual-pair boost.

## Versioned formula

Policy: `interest-v1`, implemented in `src/briefing/interest-profile.ts`.

A profile becomes available after **10 active distinct story reactions**.
For each feature, let `n = likes + dislikes`:
- fewer than 3 distinct story reactions: weight = 0;
- otherwise: `weight = (likes - dislikes) / (n + 4)`.

Weights are rounded to four decimal places and remain between -1 and +1.
Conflicting reactions reduce the magnitude. Sparse evidence shrinks toward
zero rather than causing a strong immediate preference.

For a candidate story, average matching feature weights within each dimension,
including zero-evidence features in the denominator, then multiply by:

| Dimension | Maximum contribution |
| --- | ---: |
| Broad topic | 4 |
| Narrow aspect | 8 |
| Geography | 2 |
| Source | 2 |
| Topic pair | 12 |

Clamp the total adjustment to ±20. The editorial view position supplies
`base = -4 × zero-based index`; sort by base + adjustment, breaking ties by
the original position. Thus the morning editorial/diversity order remains the
starting point and distant stories cannot jump arbitrarily far based on a
single broad preference.

Critical stories retain their exact original position. So do stories marked
today-urgent with either high importance or high public interest.
No story is removed. The original payload and saved ranks are never changed.

## UI and API

`FeedOrderControl` uses shared button tokens/states and two explicit modes:
- **Обзор**: exact saved editorial order, the default;
- **Для меня**: server-supplied order when enough evidence exists.

The mode is reflected in `newsOrder=for-you`; pagination remains in
`newsPage`. Changing modes returns to page 1. Reload preserves the chosen
mode and page, using the latest explicit feedback. A reaction does not
reorder the page while it is being read: the user explicitly reapplies
Для меня. Clicking an already-selected bell clears it.

The disclosure shows the formula's intent, strongest learned weights and
source-context coverage. In personal mode a quiet story hint shows its
strongest contributing feature or its protected editorial priority.
On an API failure the current order stays usable. The client verifies that
the returned IDs exactly match the full rendered set before reordering.

- `GET /api/profile/interests`: current profile, policy, evidence, weights,
  coverage and revision.
- `GET /api/news/order?editionId=daily:YYYY-MM-DD&mode=briefing|for-you`:
  complete ID permutation plus bounded adjustments and explanations.
- Existing reaction endpoints remain unchanged.

These APIs perform local read-only computations behind the existing site
access boundary. No new public page, cron, provider or credential is needed.
To turn off personalized ordering while reading, select Обзор.

## Verification and rollout

`npm run test:briefing-interest` covers warm-up, sparse evidence, repeated
votes, reversal/clear, aliases and ambiguity, geographic intersections,
protected slots, bounded adjustments, exact item preservation, API behavior,
retention, source backfill and migration of pre-existing events.

Deploy the additive migration with the normal runtime update, run the context
backfill once, then refresh retained pages with the standard Poller so the
new canonical control appears. Check both modes, page navigation, reload,
reaction clearing, and mobile/light/dark states. Do not create synthetic votes
in production.
