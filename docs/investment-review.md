# Investment Review

Status: bounded automatic weekly research and acceptance, manual monthly runs,
deterministic calculations, private storage, and a compact `/stocks` reader.
The weekly runner is independent of Daily/Weekly briefing generation and never
uses brokerage APIs or submits orders.

Draft v3 keeps an adult-beginner reading contract: each mini-review explains
its portfolio relevance in plain Russian, alongside conclusion, countercase
and revisit condition. Up to three shared contextual learning notes stay
collapsed until opened, with meaning/example/limitation/reference fields and
links from relevant positions. Evidence remains accessible in a separate
disclosure. Existing v1/v2 HTML stays intact; new drafts require v3.

The reusable `KuramiComment` component separates authored interpretation from
evidence with the short byline `🦊 Курами:`, warm panel and thin left rule.
Headline/summary, position reasoning/action considerations and next steps use
it; numeric tables, source disclosures, learning notes and policy do not.
Draft values and calculations are unchanged by this presentation treatment.

Reader-facing action caption is `Совет`, followed by a position-specific reason.
The old rubric conflated a missing valuation with inability to offer any useful
stance. The v3 rubric distinguishes maintain, no-add, wait, add, trim/exit,
insufficient evidence and not assessed. Only insufficient evidence requires a
specific `blockingInfo`; it must not become a generic fallback. There is no
forced distribution of advice or default hold. Use `акция` for a
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

Lifecycle contract: weekly automation runs only on Sunday in Europe/Vilnius.
Weekly and monthly accepted reports retain independent latest pointers. The
compact Week/Month view appears on `/stocks`; failures leave its previous
accepted report in place. Position changes and stale holdings invalidate action
applicability.

## Automatic weekly runner

Build with `npm run briefing:build`, then use this cron-safe command:

```text
KURAMI_HOME=/home/shagon1k/_hermes/_kurami /home/shagon1k/_hermes/_kurami/runtime/node/bin/node /home/shagon1k/_hermes/_kurami/app/dist/briefing/investment-review/automation.js run
```

The runner selects the newest private
`$KURAMI_HOME/state/briefing/portfolio/baseline-*.json`. Pass
`--baseline <private-file>` to pin one. Issuer identity patterns come from
`$KURAMI_HOME/config/investment-review-targets.json` when present, otherwise
`deploy/config/investment-review-targets.json`. `--targets`, `--hermes-repo`,
and `--python` provide deployment overrides.

`dry-run` evaluates the local-date, duplicate, baseline-age, and target-coverage
guards without writing state, calling providers, or invoking synthesis. It and
`inspect` accept `--now <ISO timestamp>` for deterministic checks; `run` always
uses the real clock so a caller cannot override the Sunday gate. Every command
prints one JSON receipt. Rejected and failed runs exit nonzero; ordinary skips
such as a non-Sunday or duplicate run exit zero.

`weekly-automation.json` records the atomic per-date claim and preserves a
separate `lastSuccess`. Run artifacts live under `portfolio/weekly-runs/<date>`;
accepted records remain in `portfolio/reviews`. A preexisting accepted weekly
report for the local date suppresses another run even if automation state is
missing. A crashed `running` claim also suppresses a retry for that date; remove
the lock only after operator inspection.

The production path is fixed: cached Stocks quotes and ECB snapshot, SEC metric
collection, Vanguard holdings, bounded primary-document extraction and its
independent tool-free check when needed, then one tool-free review synthesis.
The input is changed to `weekly` before any synthesis. At most three model calls
are possible and each has a five-minute process timeout. No report is accepted
when holdings are older than 30 days, current quotes or position evidence are
incomplete, a synthesis/check fails, or `validateReviewDraft` rejects the draft.

## Source collection and storage

`collect.ts` reads the free SEC ticker registry and companyfacts API:
at most 15 public tickers and 16 requests; no holdings quantities or paid quote
calls. Metrics retain currency, reporting start/end, filing date and accession.
Only periods ending within 150 days are selected, aliases are never summed,
conflicting values are omitted, and financial-company revenue uses an explicit
net-interest-aware tag. Operating cash flow is not part of this first adapter.
No automatic annualisation, quarterly derivation, ADR conversion or fair-value
model is attempted. A failed XBRL fetch does not revoke a confirmed issuer ISIN.
The returned coverage is accounting-field coverage, not full company research.

September 18's corrected collection returned the full three metrics for six
of twelve requested companies and partial metrics for one more. The subsequent
primary-document adapter covers issuer gaps. VUAA now has a separate automatic adapter.
Retained facts keep original dates and a visible coverage disclosure. This is
not sufficient for unattended comprehensive research or automatic publication.

### Primary documents

`primary.ts <public-targets.json> <date> <new-collection.json>` discovers recent
issuer filings through the SEC submissions API and retrieves the relevant HTML
release/report. It checks ticker/name/CIK, dates and document paths; exhibits
must remain in the same SEC filing directory. Limits: eight targets, eight
candidate filings per target, two exhibits per filing, 64 total requests,
15 seconds per request, explicit text truncation above 50,000 characters.

`primary-evidence.ts packet <collection> <new-packet>` creates a bounded,
tool-free fact-extraction prompt (v2). Then `validate <collection> <new-evidence>
<extraction>` rejects unknown documents, mismatched issuers/digests, invented
fragment IDs and ambiguous English-thousands/Russian-decimal separators.
Source fragments are deterministically numbered; models never retype table cells
as quotation locators. Existing v1 extraction artifacts are archival only.
Keep original period and currency; do not turn approvals into actual spending
or a dividend on ordinary shares into a dividend on ADRs. Numerical/semantic
context is checked separately: a valid fragment ID is not proof of the whole claim.

After explicit semantic review, `merge-reviewed <collection> <new-input>
<extraction> <previous-input>` replaces previous narrative facts only for
successfully refreshed issuers. Structured metrics and unrelated fund evidence
remain; old immutable inputs preserve history. It does not approve a report,
change holdings, enable the reader or create a schedule.

The September 18 live trial discovered six issuer documents with 28 requests
and extracted 18 facts after one bounded anchor-repair pass. No release URL or
financial fact was manually supplied to that extraction. Periods, units and
reported/forecast distinctions were checked against source context before merge.
Autonomous publication and full news/fair-value research are still outside this trial.

### VUAA refresh and full manual run

`vanguard.ts <date> <new-result> [previous-result]` checks the official VUAA
share-class identity and fetches the full published holdings via the public page's
read-only GraphQL operation. At most four pages plus one identity page. Pagination,
dates, duplicate securities and weights are checked; only stocks/REITs are matched
to confirmed held identities. Cash, rights and derivatives are not allocated to
companies. The current live response contains 512 rows, 503 eligible equity rows;
the effective date remains the publisher's date, not today's download date.
Failed refreshes retain the previous snapshot unchanged. Look-through older than
45 days is suppressed, not displayed as zero.

`run.ts prepare <date> <private-baseline> <public-targets> <new-private-directory>`
starts from current cached quotes, ECB, SEC and Vanguard; it does not read old
authored facts. For incomplete SEC metrics it collects primary documents and emits
an extraction packet. A separate tool-free Hermes call extracts facts. The
`check-packet` operation prepares an independent semantic check with exact input
hashes and explicit issues. `run.ts finish-checked <directory> <extraction> <check>`
requires that check to pass, then prepares the draft packet. The existing renderer
validates the completed draft. No phase accepts/publishes a report or touches a
weekly/monthly success pointer. Failed attempts remain separate artifacts.

The first full trial exposed a fragile exact-quotation contract and ambiguous
thousands separators. Its bounded retry failed, so no report was produced.
Extraction v2 uses deterministic fragment references; the rules were corrected
before a new from-scratch trial, rather than patching that failed output by hand.

The v2 live end-to-end trial then completed from a fresh private directory:
current stock cache + ECB → Vanguard full list → SEC metrics → five primary
documents → extraction → independent semantic check → new draft → validated
HTML. It used no prior authored facts or report text and no new EODHD calls.
There were three model calls in that successful trial and no repairs. Twelve
positions and 37 source facts were bound into the report; four fund overlaps
were confirmed. The prior failed trial remains separate. This validates the
bounded pipeline, not the correctness or future performance of a judgment.

`draft-packet --input ... --output ...` creates the reproducible skill/evidence/
calculation prompt for the installed tool-free Hermes runner. Drafts cannot
invent learning reference URLs; company facts are mandatory, with supplementary
fund facts allowed only for verified overlap.

Manual pipeline: collect public targets → `merge-evidence --input <previous-input>
--collected <collection> --output <evidence>` → snapshot with confirmed baseline
and current cached quotes/ECB → draft-packet → isolated Hermes → validate/render.
Merging replaces matching adapter fact IDs, keeps dated primary evidence and
marks retained coverage. No model needs to manually recalculate the input hash.
Acceptance is separate and never implicit after a model call.

`accept --input ... --draft ... --store <private-directory>` remains the manual
acceptance command. Weekly automation calls the same `acceptReview` function
only after all gates pass. Only weekly/monthly inputs may update their own latest
pointer. Content-addressed records and an atomic pointer swap preserve previous
success; a writer lock prevents parallel acceptance. Trial reports cannot
silently become weekly reports. No retention cleanup deletes these private
accepted records yet. After an interrupted acceptance the lock may require
operator recovery; no automatic stale-lock deletion is implemented.

The optional /stocks panel reads accepted files only, never calls a provider,
and is absent from Daily. Its one collapsed heading is `Обзор портфеля`.
One report opens directly; separate period selectors appear inside only when
both slots exist. Dates, coverage and necessary warnings remain inside; no
repeated trial/editorial title or routine "saved" disclaimer. Positions stay collapsed.
It reuses the same position/idea/learning components as the standalone report.
Missing/corrupt slots are isolated from each other and from quotes. With no
separately supplied current baseline it explicitly asks to confirm the current
composition; it does not falsely certify old holdings as still current.

On 2026-09-18 an anonymous HTTP request to `/stocks` returned a 302 redirect
to Cloudflare Access. This confirms an anonymous access gate, not a complete
audit of the Access allow policy. No personal report has been published yet.

Verification: `npm run test:investment-review`. Tests use synthetic holdings
only and cover leap-month boundaries, FX direction, missing/old/identity-mismatch
quotes, overlap, unknown month usage, evidence binding, unsafe markup and
rejection of executable orders. They do not prove narrative factual accuracy.

## Independent frozen-input trial

`bin/investment-review-trial.py` runs the installed Hermes environment's
configured model with an empty tool allowlist, no memory/context-file loading,
no background reviews and no publishing. It preserves Kurami's existing soul.
Input is a mode-600 JSON packet with a `prompt`; use the skill, source-backed
facts and calculated metrics, without a previous handcrafted report. Output
must be a fresh private directory. Raw response, draft and minimal status are
retained there; exceptions do not print provider credentials. An external
timeout bounds the manual process. The wrapper never retries on its own.

Hermes completion alone is **not** report acceptance. Manual trials still need
review. The weekly coordinator additionally requires complete current inputs,
an independent primary-evidence check when applicable, and deterministic draft
validation before it calls `acceptReview`. It performs no repair attempt. Any
failure keeps the previous accepted report.

The September 18 trial used manually verified public issuer/SEC evidence and
the existing quote snapshot, without additional financial API requests. This
tests synthesis and rendering, not comprehensive current-news coverage. Action
judgments may vary between runs on identical facts; structural checks do not
make them deterministic.

Observed trial outcome: two clean-context syntheses and one bounded repair,
one model call each, no tools. The second draft's dangling lesson reference
was rejected before HTML creation. The repaired draft validated; its action
choices, candidate selection and fact references were checked unchanged from
the rejected draft. The first draft also exposed unnecessary English jargon,
so the reader contract was clarified rather than hand-editing report copy.
Neither trial is evidence of investment performance or unattended reliability.
