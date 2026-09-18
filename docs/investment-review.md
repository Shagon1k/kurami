# Investment Review — manual prototype

Status: skill + deterministic calculations + private trial renderer. No route,
cron, Poller participant, public payload, order submission or production UI
integration is enabled. The existing Daily/Stocks/Discovery remain unchanged.

Draft v2 adds an adult-beginner reading contract: each mini-review explains
its portfolio relevance in plain Russian, alongside conclusion, countercase
and revisit condition. Up to three shared contextual learning notes stay
collapsed until opened, with meaning/example/limitation/reference fields and
links from relevant positions. Evidence remains accessible in a separate
disclosure. Existing v1 HTML stays intact; new drafts use v2 explicitly.

`integrations/hermes/skills/kurami-investment-review` contains the custom method,
user constraints and evidence contract. `src/briefing/investment-review` owns
input/draft validation, calendar boundaries, valuations, overlap, hypothetical
stress arithmetic, private file I/O and the report renderer.

Portfolio quantities and instantiated evidence/drafts/reports live in private
runtime state, never in this repository. Existing user baseline is immutable;
new goals do not retrospectively invent purchases, costs or cash. Snapshot
requires a private regular baseline file and only reads the Stocks database.
Its one network source is fixed ECB 90-day reference FX XML. Render/calculate
make no network calls. New artifacts are mode 600 and refuse overwriting.

Reuse page shell, tokens, typography and native disclosures. Prototype HTML
is a private artifact, not a served page. Embedded fixed theme code is only
for that standalone artifact; model-supplied HTML/scripts are never accepted.
Narrative fields are escaped. The UI displays explicit research coverage,
unpriced positions, unknown allowances and valuation-vs-personal-return limits.

Phase-two contract: independently retained latest weekly/monthly reports,
Sunday and first-calendar-day cadence, combined work on collisions; compact
Week/Month view on `/stocks` only. Preserve last success with visible freshness
and invalidate action applicability after relevant changes. Activation requires
review of the trial and confirmation of private-page access, source automation,
fees/cash/monthly transaction reconciliation and risk/target policy.

Verification: `npm run test:investment-review`. Tests use synthetic holdings
only and cover leap-month boundaries, FX direction, missing/old/identity-mismatch
quotes, overlap, unknown month usage, evidence binding, unsafe markup and
rejection of executable orders. They do not prove narrative factual accuracy.
