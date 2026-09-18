# Investment Review — manual prototype

Status: manual research pipeline, deterministic calculations, private renderer
and accepted weekly/monthly storage. A compact /stocks reader is implemented
behind `investmentReview.enabled` (false by default). No cron, Poller
participant, automatic acceptance, public activation or order submission.
The existing Daily/Stocks/Discovery continue independently.

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

Lifecycle contract: independently retained latest weekly/monthly reports,
Sunday and first-calendar-day cadence, combined work on collisions; compact
Week/Month view on `/stocks` only. Preserve last success with visible freshness
and invalidate action applicability after relevant changes. Activation requires
review of the trial and confirmation of private-page access, source automation,
fees/cash/monthly transaction reconciliation and risk/target policy.

Next readiness steps, before recurring activation:
1. Complete an initial research pass for currently uncovered holdings and
   test that a fresh run follows the skill rather than a handcrafted layout.
2. Exercise the separate bounded long-term idea contract: up to two registered
   non-held candidates, own evidence, risks, portfolio fit, alternatives and
   missing valuation checks. Ideas are study-only, not holdings or orders.
   Existing movement-based Discovery is not this.
3. Finish source coverage and owner review, enable the already implemented
   compact reader, then validate scheduling/collisions separately.

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
of twelve requested companies and partial metrics for one more. Other issuers
need primary-release adapters; VUAA holdings still use retained issuer evidence.
Retained facts keep original dates and a visible coverage disclosure. This is
not sufficient for unattended comprehensive research or automatic publication.

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

`accept --input ... --draft ... --store <private-directory>` is an explicit
acceptance step, not generation. Only weekly/monthly inputs may update their own
latest pointer. Content-addressed records and an atomic pointer swap preserve
previous success; a writer lock prevents parallel acceptance. Trial reports
cannot silently become published weekly reports. No retention cleanup deletes
these private accepted records yet. After an interrupted acceptance the lock
may require operator recovery; no automatic stale-lock deletion is implemented.

The optional /stocks panel reads accepted files only, never calls a provider,
and is absent from Daily. Each period and position is collapsed by default.
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

Hermes completion is **not** report acceptance: run the deterministic renderer
against the exact frozen input and inspect claims/plain-language quality before
sharing. A rejected draft cannot produce an HTML report. A single explicit
repair attempt may use validator diagnostics; retain both attempts and never
silently hand-edit the model's investment judgments. If repair still fails,
stop and keep the previous accepted report.

The September 18 trial used manually verified public issuer/SEC evidence and
the existing quote snapshot, without additional financial API requests. This
tests synthesis and rendering, not autonomous research, comprehensive current
news coverage or unattended scheduling. Action judgments may vary between
runs on identical facts; structural checks do not make them deterministic.
Recurring activation therefore remains a separate readiness step.

Observed trial outcome: two clean-context syntheses and one bounded repair,
one model call each, no tools. The second draft's dangling lesson reference
was rejected before HTML creation. The repaired draft validated; its action
choices, candidate selection and fact references were checked unchanged from
the rejected draft. The first draft also exposed unnecessary English jargon,
so the reader contract was clarified rather than hand-editing report copy.
Neither trial is evidence of investment performance or unattended reliability.
