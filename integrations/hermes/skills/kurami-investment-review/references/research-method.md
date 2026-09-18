# Research method and source discipline

## Methodology reviewed

Reviewed 2026-09-18: Anthropic Financial Services Equity Research entrypoints
[thesis-tracker](https://github.com/anthropics/financial-services/blob/main/plugins/vertical-plugins/equity-research/skills/thesis-tracker/SKILL.md),
[earnings-analysis](https://github.com/anthropics/financial-services/blob/main/plugins/vertical-plugins/equity-research/skills/earnings-analysis/SKILL.md),
[morning-note](https://github.com/anthropics/financial-services/blob/main/plugins/vertical-plugins/equity-research/skills/morning-note/SKILL.md).
Upstream repository is Apache-2.0. This is independently written guidance,
not a vendored plugin or copied skill implementation.

Retain falsifiable company reasoning, contrary evidence, dated updates and
event relevance. Deliberately omit the large institutional document format,
mandatory analyst-consensus comparisons, automatic price targets, stop-loss
prescriptions, intraday signals and paid-terminal dependencies. No upstream
scripts, connectors, dependency installers or agents were installed.

## Research sequence

1. Read issuer IR releases, filed annual/quarterly statements and fund holdings.
   SEC-hosted exhibits are useful public primary sources. Search results locate
   documents; read the document before asserting its contents. A scheduled
   earnings announcement is not the earnings result.
2. Separate reporting period, publication date, retrieval time and price date.
   Match fiscal years carefully. Never mix USD growth with local-currency
   growth, adjusted EBITDA with net income, or management guidance with facts.
3. Start with portfolio materiality and fund overlap. Research the largest or
   materially changed exposures before spending equal effort on tiny positions.
   Do not sell a tiny position merely to make the table look tidy.
4. For each investigated company state the business proposition, contrary
   evidence, unresolved questions and a fact/event that would change the view.
   Positive earnings growth is not proof the stock is cheap. A large fall is
   not proof of a bargain; a large gain is not proof it should be sold.
5. Fair-value estimates require explicit inputs and sensitivity analysis. If
   valuation evidence is missing, say so; do not backfill model memory or invent
   precise target prices/confidence percentages. Treat company outlooks as
   interested-party forecasts, not independent guarantees.
6. Keep the report brief: three portfolio-level observations, selective deeper
   review, explicit coverage gaps and a small list of next decisions. Store
   source-backed facts separately from narrative so later runs can update
   only new material. Do not present an unresearched ticker as analyzed.

## Data/cost boundary

Existing EODHD cache supplies closes without new calls. ECB dated XML supplies
reference FX, not a broker execution rate. Fund issuer pages supply dated fund
constituents; only verified fields enter look-through calculations. Issuer IR
and SEC pages can be read without buying a terminal subscription; availability
is not guaranteed and rate limits/access policies must be respected.

The already-budgeted Alpha Vantage discovery feed is not sufficient evidence
for long-term recommendations. No new Alpha Vantage/EODHD endpoints are called
by this prototype. Broad web searches/LLM work have real resource costs even
when market-data APIs are free: use existing authorized tools, bounded source
sets, and no unapproved paid plan. Research cannot delay the morning Daily.

## Checks before handoff

- All holdings accounted for; exact input hash bound to the draft.
- EUR conversion direction, quantities and source dates checked by code.
- Personal return/cost basis remain unknown unless supplied.
- No future-dated source facts; conflicting or stale evidence disclosed.
- Every narrative claim manually checked against its cited evidence.
- Both positive and adverse evidence represented; no forced new trade.
- No private holdings, account documents or research reports committed to Git.
- No scheduled job, public route, brokerage mutation or implicit notification.

Deterministic validation cannot prove semantic truth or investment usefulness.
Before activation, Alex reviews the private trial and a later clean-context
run should be evaluated on the same frozen input for factual consistency,
unsupported claims, abstention behavior and cost. Popularity is not proof of
investment performance; historical backtests are not a promise of returns.
