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

The reusable `KuramiComment` component separates authored interpretation from
evidence with the short byline `🦊 Курами:`, warm panel and thin left rule.
Headline/summary, position reasoning/action considerations and next steps use
it; numeric tables, source disclosures, learning notes and policy do not.
Draft values and calculations are unchanged by this presentation treatment.

Reader-facing action caption is `Совет`. Keep the distinction between
`Пока без рекомендации` (reviewed, but no supported action yet) and
`Анализ ещё не проведён` (not covered); neither means hold. Use `акция` for a
company and `фонд`/`ETF` for funds instead of the generic `бумага`.

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

Next readiness steps, before recurring activation:
1. Complete an initial research pass for currently uncovered holdings and
   test that a fresh run follows the skill rather than a handcrafted layout.
2. Agree and add a separate bounded long-term idea contract: candidates are
   not holdings, with evidence, risks and comparison against adding to existing
   holdings or doing nothing. Existing movement-based Discovery is not this.
3. Add independently retained weekly/monthly report storage and the compact
   `/stocks` view; then validate scheduling, collision handling and source costs.

On 2026-09-18 an anonymous HTTP request to `/stocks` returned a 302 redirect
to Cloudflare Access. This confirms an anonymous access gate, not a complete
audit of the Access allow policy. No personal report has been published yet.

Verification: `npm run test:investment-review`. Tests use synthetic holdings
only and cover leap-month boundaries, FX direction, missing/old/identity-mismatch
quotes, overlap, unknown month usage, evidence binding, unsafe markup and
rejection of executable orders. They do not prove narrative factual accuracy.
