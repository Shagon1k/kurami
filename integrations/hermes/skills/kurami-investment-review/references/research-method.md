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

`collect.ts` is the first autonomous source adapter: official SEC company
identity plus XBRL companyfacts, at most 15 public symbols / 16 requests per
run. It needs no API key and never sends quantities. It preserves source
currency, actual start/end, filing date and accession; never annualise an
interim result, merge different metrics or confuse YTD with a quarter.
Coverage refers ONLY to these accounting metrics, not complete research.
Foreign issuers and newly listed companies may lack current tagged data.
An unavailable feed or missing XBRL record is NOT an issuer-identity mismatch:
keep separately confirmed ISIN/issuer mapping and retained filings valid unless
contradictory evidence actually appears. Do not ask the owner to re-confirm an
identity solely because this adapter has no data.
Retained issuer evidence keeps its original dates and is never relabelled as
freshly collected. A partial collection cannot justify claiming autonomous
coverage of all holdings. Report any material disagreement with retained facts.

For gaps, `primary.ts` discovers issuer documents from live SEC submissions,
not a manually dated release URL. It selects recent 8-K earnings disclosures
(item 2.02) or 6-K reports, follows at most two same-filing HTML exhibits, and
bounds the run to eight issuers / 64 requests. Network failures remain gaps.
Documents over 50,000 text characters are explicitly excerpts.
`primary-evidence.ts packet` prepares tool-free extraction; `validate` checks
document/issuer/hash binding, exact short anchors and quote budgets. Guidance
is labelled separately from achieved results. These checks are necessary but
do not establish semantic truth: inspect statement context, period, units and
accounting basis. Do not map an ordinary-share dividend onto an ADR.
Only after that review use `merge-reviewed`. It supersedes older narrated
facts for the refreshed issuer, keeps independent SEC metrics and unrelated
fund evidence, and preserves the old input as an immutable audit artifact.
One bounded repair may fix extraction diagnostics; repeated failure stops
without changing the accepted report. Do not loosen validation to accept it.

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

For new long-term ideas, prefer a comprehensible business with current primary
evidence and a different economic driver from the user's concentrated exposures.
Compare against existing holdings and no new position. A company already inside
VUAA is not a new independent source of diversification merely because its
ticker is absent from the direct holdings. Missing price/valuation evidence
means study-only, not a purchase recommendation. One strong candidate is enough.

In a frozen-input independent trial, use only the supplied evidence and calculated
metrics. Do not pretend to have browsed or researched beyond that packet.
Keep source-derived paraphrases compact (normally under 150 words per issuer
source across the report); general analytical reasoning is separate. Return the
structured draft, not hand-authored HTML. This tests synthesis and contract
compliance, not autonomous source collection or unattended scheduling.

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
