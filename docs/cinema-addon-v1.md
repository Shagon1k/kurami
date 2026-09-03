# Cinema add-on v1 contract

Status: production-enabled after live provider verification and visual
approval. The current successful edition is served only at `/cinema` and is
replaced atomically by the next successful Saturday edition.
This document is the source of truth for the first Cinema add-on
iteration. Provider references, payload schemas, components, tests, and
deployment work must conform to it rather than silently choosing new product
semantics during implementation.

## Outcome

Cinema is Kurami Daily Briefing's first native optional add-on. It publishes a
fresh weekly cinema snapshot at 09:00 Europe/Vilnius every Saturday, keeps the
latest successful snapshot at `/cinema`, and contributes a compact preview to
that Saturday's Daily edition. It is not a separate application, polling
service, or page-specific visual language.

Cinema proves the add-on architecture without changing the behavior of the
existing Daily skeleton. A Cinema collection, editorial, rendering, or
publication failure must not block Daily publication and must not replace the
last successful `/cinema` snapshot.

## Existing foundation and implementation boundary

The repository already provides these foundations:

- `BriefingAddon` registration, ordered slots and metrics;
- `failurePolicy: "isolate"` for native optional add-ons;
- versioned `BriefingAddonEnvelope` values;
- persistent `addon_snapshots` storage;
- `daily` and `cinema` edition types;
- `/cinema` resolution to the current Cinema edition;
- `cinema_schedule: "0 9 * * 6"` eligibility and
  `cinema_retention: until_next_success` configuration;
- deterministic HTML validation and the shared Kurami UI visual language.

Those primitives and the Cinema pipeline are implemented. The tracked schedule
value is configuration, not a separately enabled scheduler. Production is
enabled after the live provider and credential checks passed. Cinema extends the
existing boundaries; it does not create another database, web server, cron
prompt, source gateway, or provider-specific rendering path.

An implementer can verify the existing boundary in:

| Concern | Existing source |
| --- | --- |
| Add-on interface and failure policy | `src/briefing/addons/types.ts` |
| Registry, ordering, isolation | `src/briefing/addons/registry.ts` |
| Versioned envelope validation | `src/briefing/model.ts` |
| Latest add-on snapshot storage | `src/briefing/store.ts`, migration `005_addon_snapshots.sql` |
| Daily/Cinema edition storage | `migrations/briefing/001_initial.sql` |
| `/cinema` route | `src/briefing/server.ts` |
| Shared deterministic renderer | `src/briefing/ui/render-page.ts` |
| Non-secret lifecycle values | `deploy/config/briefing.yaml` |

## Lifecycle

1. The approved scheduled Daily run is the sole trigger and starts at 09:00
   Europe/Vilnius. `cinema_schedule` is an eligibility rule checked by this
   run, not permission to install a second Cinema timer or cron job.
2. On Saturday only, the same invocation launches the isolated Cinema pipeline
   in addition to the normal Daily pipeline.
3. Cinema collectors freeze one weekly candidate set with explicit coverage
   timestamps and regions.
4. Deterministic normalization and validation run before any editorial step.
5. The editorial step selects and writes only the bounded human-facing fields
   described below. It cannot rewrite numeric facts, dates, source identity,
   ranks, or provenance.
6. The runtime prepares the full `cinema:<local-date>` edition without changing
   the current Cinema pointer. If validation succeeds, it atomically promotes
   that edition and its add-on snapshot before final Daily composition. A
   same-Saturday rerun replaces that internal edition atomically only after its
   complete new payload and HTML pass the same validation gates.
7. Daily composition reads the exact promoted snapshot digest. If Cinema was
   not promoted for this local date, Daily continues without a Cinema preview.
   If Cinema is promoted and Daily later fails independently, `/cinema` remains
   a valid new weekly edition; the failed Daily run follows normal Daily
   recovery without re-collecting or reverting Cinema.
8. Only a validated `ready` or promotable `partial` snapshot may become current.
   A failed attempt records diagnostics but leaves the previous successful
   `/cinema` edition unchanged.
9. The Saturday Daily preview appears only when a new Cinema iteration was
   promoted for that date. Other Daily editions do not show it.
10. `/cinema` keeps the current successful snapshot until a later Saturday is
    successfully promoted. Historical Cinema routes are out of scope for v1.
    A same-Saturday rerun uses the same internal edition identity: validation
    leaves the current page untouched, then promotion replaces its payload,
    HTML, and latest-snapshot pointer in one guarded operation.

Cinema does not participate in the hourly Digest Central Poller. Its snapshot
is frozen until the next scheduled Cinema iteration.

### Snapshot and section states

Each of the four sections has its own state:

- `ready`: collection and validation completed and the section has qualified
  content;
- `empty`: collection and validation completed successfully but no item
  qualified inside the exact coverage window;
- `partial`: useful validated content exists, but a bounded source, enrichment,
  or editorial step failed or returned incomplete coverage;
- `failed`: no trustworthy useful content can be rendered for that section;
- `stale`: a previously promoted section is being viewed beyond its original
  coverage period; this is a presentation state derived from the immutable
  stored coverage timestamps, not a mutation of the stored envelope or digest.
  A newly collected stale section is never promoted.

A new envelope is `ready` when at least one section is `ready`, the remaining
enabled sections are `ready` or truthfully `empty`, and no integrity gate
failed. An all-empty result has envelope state `empty`. It is promotable as
`partial` when at least two independent sections
contain validated non-empty content and no cross-section integrity gate failed.
`empty`, `failed`, and `stale` envelopes are not promotable. If the first-ever
Cinema attempt is not promotable, `/cinema` remains unavailable and Saturday
Daily has no Cinema preview. A failed section is omitted from a promoted
partial page and disclosed in the compact quality state; do not render an
empty decorative shell. `partial` is considered the latest successful snapshot
only when it passes this promotion threshold.

The closed set of cross-section promotion gates is:

1. one edition ID, local date, configured market, timezone, and snapshot
   version are shared by every section;
2. every rendered item ID and provenance identity is unique within its owning
   collection, and every factual external item has one source record;
3. every coverage interval is valid, non-future, and compatible with the
   edition date and section-specific window;
4. the canonical envelope digest validates before both Cinema promotion and
   Daily preview attachment;
5. no stored media path escapes edition-owned storage and no active or
   credential-bearing content enters the payload.

Provider-specific quality failures cannot invent additional cross-section
gates. They affect only their section unless one of the five shared invariants
is actually violated.

## Market configuration

Local cinema behavior is selected by configuration rather than hard-coded in
collectors or components:

```yaml
cinema:
  enabled: true
  market: LT
  timezone: Europe/Vilnius
  language: ru
```

`market: LT` controls local theatrical dates and Lithuanian box-office data.
The full page remains globally oriented: only local premieres and the local
chart are Lithuanian-specific. The Lithuanian chart displays the original film
title extracted from the parenthesized bilingual LKC value and does not repeat
its local translation. A future country change should require a new
market adapter or configuration value, not changes to generic Cinema models or
UI components.

## Page composition

The full page uses the shared Kurami visual tokens, typography, sections,
buttons, notes, light/dark themes, and responsive grammar. UI labels are
Russian. Original English film titles are preferred over invented Russian
translations.

The v1 page contains four independent sections in this order:

1. «Пульс проката».
2. Fresh trailers.
3. Lithuanian premieres for the next calendar week.
4. Up to fifteen selected cinema-news stories from the previous seven days.

A section with no trustworthy fresh data is omitted or rendered with an
explicit bounded partial/stale state. It is never filled with old or invented
items. Each collection supports zero, one, and many items without assuming one
trailer or one premiere.

The compact Saturday Daily preview is derived from the same snapshot. It shows
only bounded highlights plus a clear link to `/cinema`; it does not duplicate
the entire weekly page inside Daily. Exact highlight density may be visually
iterated, but the preview cannot introduce data absent from the full snapshot.

## Пульс проката

### Sources

Use Box Office Watch as the primary machine-readable source for current US
weekend actuals/estimates, recent weekend history, Domestic YTD, and Worldwide
YTD:

- `https://boxofficewatch.com/data/weekend.json`
- `https://boxofficewatch.com/data/yearly.json`

The site is an independent secondary aggregator, not an official Comscore API.
Fetch only the public factual data at low frequency, attribute Box Office
Watch with a source link, and do not copy its analysis, prose, graphics, or
visual design. Validate the expected JSON schema and coverage date before use.
Cache the accepted weekly input. Do not hotlink its poster URLs; resolve and
cache artwork through Kurami's configured TMDB adapter.

Use an AP weekly Comscore Top 10 article as the bounded US fallback when Box
Office Watch has a network, HTTP, schema, or freshness failure. Fallback use
must be visible in provenance. AP fallback supplies only the current US Top 10
and featured winner. Hide the Box Office Watch-dependent six-week chart,
Domestic/Worldwide YTD, historical rank movement, and estimate-to-actual
signal rather than fabricating or mixing them. Deterministic signals that
cannot be proved by the normalized AP Top 10 are also omitted. The US
subsection and overall Cinema envelope are therefore `partial`; Lithuanian and
global-pulse collection continue independently. Do not silently combine
conflicting estimates and actuals.

Use the latest official Lithuanian Film Centre (LKC) XLSX report for Lithuania,
discovered from
`https://www.lkc.lt/registras-ir-statistika/faktai-ir-statistika/naujausios-ataskaitos`.
The adapter preserves weekend dates, gross, admissions, show count, week in
release, cumulative gross, release date, and distributor when present.

Worldwide weekend reporting uses Kinopoisk's public worldwide chart, whose page
credits Box Office Mojo as the upstream data source. Direct server requests are
blocked by Yandex SSO, so collection uses a bounded replaceable reader transport;
the original Kinopoisk URL remains the source identity. A strict adapter emits
the same canonical `CinemaChart` contract as every other box-office provider.
The Kinopoisk USA chart is a fallback only when both Box Office Watch and AP
cannot produce the US weekend; it never overrides a healthy primary result.
Every numeric claim stores its source URL, source date, territory, period, and
evidence text. AI may write the short Russian explanation but cannot author
the number.

### Deterministic views

The section contains:

- one featured winner of the latest completed US weekend;
- four computed signals: largest debut, best hold, sharpest drop, and largest
  rank movement or material estimate-to-actual surprise;
- a separate latest-weekend row ordered World, US, Lithuania;
- a separate YTD row ordered World, US, Lithuania (v1 renders World and US);
- Top 5 with an explicit expansion to Top 10 in every available chart;
- three to five verified global pulse items when available;
- one multi-series trend chart.

All rankings, totals, changes, signals, and chart points are deterministic.
The editorial layer may choose concise labels and context but cannot choose a
different winner or recalculate values.

### Trend chart

`BoxOfficeTrendChart` visualizes the current US Top 5 over the latest six
completed weekends using each film's actual weekend gross, not cumulative
gross. Look up each current film across the Box Office Watch weekend archive,
including appearances below the historical Top 10 when present.

Use `current.actuals` plus each `archive[].actuals` collection from
`data/weekend.json`. Match the provider's exact normalized film identity; do
not fuzzy-merge similarly named films or a re-release into another run. If a
stable provider identity cannot be established, keep only the current point
and disclose missing history. The provider's normalized `change` field is the
weekend change; do not recompute it across a missing week. Absence from an
archive collection means unknown/not reported, not zero gross.

- Before a film's release, points are `null`; never draw artificial zeroes.
- A current film with provider `weeks == 1` has one honest point labelled `NEW`
  and no invented history or forecast line. An older film whose first visible
  point merely falls inside the six-week window is not relabelled as a debut.
- A returning film begins a line only when actual history exists.
- The current point exposes exact gross and weekend change.
- Hover or keyboard focus emphasizes one series and dims the others.
- Nodes are 3px at rest and 6px on hover/focus, following the visual-language
  chart contract.
- A keyboard-accessible legend can hide/show a series. The visible-series
  domain is recalculated, so one outlier does not permanently compress every
  other line.
- `+` and `−` select a bounded three-to-six-week trailing window; they never
  interpolate or invent points.
- Both date and compact money axes are visible.
- Mobile preserves the same legend and scale controls and keeps the plot
  horizontally scrollable rather than deleting data.
- A compact accessible table or equivalent textual representation exposes the
  same exact values without relying on color or pointer interaction.
- AP fallback does not render this chart because it cannot prove the required
  history.

The chart is the first production use of a generic reusable `TrendChart`
primitive. Its component contract must remain domain-agnostic so a later stock
price add-on can reuse it. Cinema owns only the series mapping, labels, units,
and empty-state rules.

## Fresh trailers

Collect trailer candidates from YouTube through the restricted configured
Composio contour. Provider operations and exact allowlists belong in a Cinema
provider reference and non-secret configuration, not in renderer code or the
generic Daily skill flow.

The verified official-publisher seed should cover the major distributors and
studios relevant to wide releases, including Disney and Marvel, alongside
Warner Bros., Universal, Paramount, Sony, 20th Century Studios, Searchlight,
Lionsgate, A24, NEON, Netflix Film, Amazon MGM Studios, and Apple. Verify exact
channel identities before enabling them. Do not include MUBI merely as a broad
"cinema" source. Discovery channels, including Rotten Tomatoes Trailers and
other explicitly verified trailer aggregators, may find omissions but never
out-rank a matching official upload. The previously proposed Movieclips source
must not be configured without first resolving and verifying the exact channel.

Select at most nine fresh trailers published inside the seven-day coverage
window. The half-open window is `[previous Saturday 09:00, current Saturday
09:00)` in Europe/Vilnius; compare instants after resolving that timezone so a
DST transition does not change the intended local boundary.

1. reject clips, interviews, reactions, fan edits, recaps, and unrelated video;
2. cluster duplicate uploads by canonical film identity;
3. prefer an official main trailer over a teaser or aggregator copy;
4. preserve publication time, publisher, source URL, video ID, thumbnail,
   duration when available, and trailer type;
5. use TMDB film identity and metadata when confidently matched;
6. rank the remaining candidates by official provenance, freshness, material
   release significance, novelty, and bounded diversity;
7. apply a hard maximum of three selected trailers per publisher channel;
8. do not pad the section when fewer than nine qualified items exist.

The page never downloads or embeds full video files. It displays cached safe
thumbnails and opens the supplied YouTube destination through a clear external
play action. No iframe or active script is introduced into generated HTML.
There is no alternate trailer provider in v1. YouTube or credential failure
makes this section `failed`; an incomplete but useful bounded result is
`partial`.

## Lithuanian premieres

The section covers the next local calendar week in Lithuania, relative to the
Saturday edition date. Use `cinema.lt/filmai` as the local theatrical-date
source and enrich confidently matched films with TMDB metadata and cached
posters.

The target interval is `[next Monday 00:00, following Monday 00:00)` in
Europe/Vilnius. The local source must prove a premiere date inside this
half-open interval. The newest LKC weekend and Box Office Watch weekend used by
the same edition must end no more than fourteen days before the edition; an
older report is stale rather than current.

Show every relevant verified premiere up to twelve items. Preserve:

- original title and local title when supplied;
- exact Lithuanian premiere date and source date;
- poster;
- genre;
- runtime;
- age rating when available;
- director and up to four principal cast names from cinema.lt's Schema.org
  Movie payload;
- no production-budget row in v1; the current providers cannot fill it
  consistently enough to justify a mostly-empty UI field;
- source destination;
- TMDB identity and metadata provenance when matched.

The local-date parser is deterministic and fixture-tested. A TMDB mismatch
must not replace a cinema.lt title or release date. If cinema.lt changes markup
or cannot prove the target-week date, mark only this section partial or omit
it. Do not substitute TMDB's generic release calendar for a Lithuanian
theatrical date.
There is no alternate Lithuanian premiere source in v1. A cinema.lt failure
makes only this section `failed`; TMDB failure removes enrichment and artwork
but preserves a locally verified premiere.

## Weekly cinema news

Collect the same half-open seven-day interval used for trailers from the
verified feeds for Variety, Deadline, The Hollywood Reporter, and IndieWire.
The deterministic layer owns feed pagination, URL canonicalization,
publication-window validation, exact and near-duplicate candidate clustering,
source provenance, and image acquisition. For a selected story whose feed has
no image, it performs one bounded article-page read and accepts only an
allowlisted publisher-owned `og:image`/`twitter:image`; failure leaves the
fixed visual placeholder intact.

Select up to fifteen stories. The editorial score should consider:

- industry impact and release significance;
- freshness within the weekly window;
- novelty versus duplicate reporting;
- confidence and directness of sourcing;
- relevance to major films, filmmakers, distribution, exhibition, production,
  or meaningful market changes;
- source and subject diversity.

Prefer major announcements, production developments, substantial deals,
festival/distribution outcomes, and consequential industry events. Deprioritize
rumors, tiny casting updates, promotional listicles, reviews, and repetitive
box-office recaps already represented by the pulse section. No source receives
an automatic quota, but one publisher must not dominate when equally material
independent stories are available.

Code assigns bounded per-candidate scores and a stable tie-break of published
time descending, canonical URL ascending. AI may choose only among qualified
candidates whose score falls inside the configured editorial tie band. Code
then applies duplicate, subject-diversity, and source-diversity constraints and
owns final ordering. Global-pulse candidates follow the same rule: code proves
the numeric claim and candidate window, AI may choose which equally material
verified claims deserve the bounded three-to-five slots, and code owns stable
ordering.

Each selected story contains an independently authored Russian headline, a
brief factual summary, source and publication time, external destination, and
at least one safe cached image when the source provides one. Detailed inline
news expansion is out of scope for this compact weekly section. Do not invent
or search for replacement art when no safe image is available.

Add two or three fresh Kurami Notes across a full fifteen-story news section
when concrete safe targets exist. Notes follow the common deterministic budget,
are one to four words, balance information with restrained content-specific
humor, use varied placements, and are never selected from a phrase pool.
There is no alternate weekly-news source in v1. Individual feed failures yield
a truthful `partial` section when enough qualified stories remain; total feed
or editorial failure makes the news section `failed` and omits it.

## Data ownership and editorial boundary

Collectors and deterministic code own:

- provider discovery, pagination, time windows, identifiers, and provenance;
- local market dates and regions;
- numeric facts and units;
- candidate deduplication and canonical film matching;
- ranking inputs and all computed box-office views;
- cached image identity and paths;
- schema validation, freshness, state, and diagnostics;
- stable IDs, final ordering, retention, promotion, and publication paths.

The editorial/model step may own only:

- final selection among already bounded qualified news/trailer candidates when
  deterministic scores do not fully decide it;
- concise Russian cinema-news headlines and summaries;
- concise Russian explanations of already verified box-office facts;
- fresh, grounded Kurami Note copy;
- bounded featured emphasis when the input contract explicitly permits it.

If the editorial/model step fails, deterministic sections remain usable:
box-office facts use fixed UI labels, premieres keep source titles, and trailers
fall back to deterministic score order with original publisher titles. Weekly
news and Kurami Notes are omitted because their required Russian editorial copy
cannot be produced safely. The resulting envelope may be promoted only if it
still passes the two-section partial threshold.

For every Cinema section, a "safe cached image" means that deterministic code
accepted an allowlisted HTTPS origin or provider asset, enforced bounded bytes
and an allowlisted image MIME type, decoded or otherwise validated the image,
wrote it into edition-owned media storage, and emitted only a runtime-local
path. Remote URLs, HTML responses, SVG/scriptable documents, data URLs, and
provider credentials never enter the rendered image contract.

Source content is untrusted. It cannot select tools, request credentials,
change configuration, alter schedules, or trigger mutations. Provider and
validation failures remain explicit states rather than prompts for the model to
improvise another source.

## Snapshot shape

Cinema uses one versioned add-on envelope. The exact TypeScript model is an
implementation task, but the top-level ownership is fixed:

```json
{
  "version": 1,
  "state": "ready | empty | partial | stale | failed",
  "capturedAt": "RFC3339",
  "data": {
    "market": "LT",
    "coverage": {},
    "boxOffice": {},
    "trailers": [],
    "premieres": [],
    "news": [],
    "notes": [],
    "quality": {},
    "provenance": []
  }
}
```

Every section carries its own state and source timestamps so a truthful partial
edition can render useful independent sections. Never put credentials, MCP
URLs, raw provider responses, arbitrary HTML, or remote executable content into
the stored payload.

## Failure and fallback rules

- Cinema failure never blocks Daily.
- One failed Cinema section does not remove unrelated ready sections.
- A failed Saturday attempt does not replace the last successful `/cinema`.
- A previous `/cinema` may remain available with its original coverage date;
  it is never relabelled as the new week.
- A Saturday Daily preview is omitted when no new Cinema snapshot was promoted
  for that date.
- A Box Office Watch network, HTTP, schema, or freshness failure automatically
  attempts the explicit AP fallback for US Top 10; provenance identifies the
  fallback. If AP also fails, the Kinopoisk USA adapter is the final bounded
  fallback. If all three fail, the US subsection is `failed` and the remaining
  box-office subsections continue independently.
- Missing global pulse stories do not invalidate US or Lithuanian charts.
- Missing TMDB enrichment does not invalidate a verified local premiere; it
  removes only unproven enrichment fields or artwork.
- No fallback may silently turn an estimate into an actual, a worldwide total
  into a weekend gross, or a general release date into a Lithuanian theatrical
  date.

## Visual and interaction contract

Implementation extends `kurami-ui-preview-language`; it does not hand-author a
Cinema-only page. Reusable additions should include:

- `TrendChart` as a generic deterministic chart primitive;
- `BoxOfficePulse` and its ranked compact rows;
- repeatable trailer cards/rail;
- repeatable premiere cards/grid;
- compact weekly cinema-news cards;
- standard source/freshness and partial-state treatments.

The page supports light/dark mode, keyboard access, mobile/desktop parity,
cached images, explicit external destinations, and truthful loading/empty/
partial/stale/error states. Red remains a signal accent rather than a fill for
every card. Doodles are supplied content, not renderer decoration.

## Credentials and network dependencies

Implementation needs the existing restricted `composio-read` connection with
the exact read-only YouTube leaf operations named in its future provider
reference, and a TMDB read-access token supplied as
`TMDB_READ_ACCESS_TOKEN` through the production secret boundary. Startup
preflight must confirm both without printing their values. An unavailable or
revoked Composio credential fails only trailers; an unavailable or revoked TMDB
credential removes TMDB enrichment and cached TMDB artwork. AP, Box Office
Watch, LKC, cinema.lt, and the RSS sources require no credential in v1. The
token must never enter tracked configuration, logs, fixtures, generated HTML,
or model-authored artifacts.

Box Office Watch, Kinopoisk through its reader transport, AP, LKC, cinema.lt,
RSS publishers, YouTube, and TMDB are external dependencies. Every adapter uses bounded timeouts, response-size
limits, retries appropriate to idempotent reads, descriptive user-agent
identification where applicable, and stored fixtures for deterministic tests.
Do not add a paid web-search dependency for v1.

## Acceptance criteria

Cinema v1 is ready for production only when all of the following pass:

1. Existing Daily regression tests and a production-like Daily dry run using
   the normal runtime/composer/renderer with a temporary database and provider
   fixtures are unchanged when Cinema is explicitly disabled and on
   non-Saturdays.
2. A Saturday run can produce both Daily and `/cinema` from one accepted
   snapshot without duplicate collection.
3. A forced failure in every individual Cinema provider proves Daily still
   publishes and unrelated Cinema sections retain truthful state.
4. A total Cinema failure leaves the previous `/cinema` content digest and
   coverage date unchanged and omits the new Saturday Daily preview.
5. Fixture tests cover Box Office Watch estimates/actuals/archive, AP and
   Kinopoisk fallbacks, Kinopoisk worldwide weekend, LKC XLSX, cinema.lt dates,
   YouTube duplicate trailers, RSS duplicate news, missing TMDB enrichment,
   and schema drift.
6. The box-office signals and six-week Top 5 chart are reproducible from the
   same fixture input, including a one-point debut and a missing pre-release
   history.
7. Numeric claims, dates, ranks, and regions in the rendered page match stored
   provenance; no editorial step can change them.
8. Zero/one/many states render without structural distortion for trailers,
   premieres, news, global pulse items, and chart series.
9. Desktop and mobile are visually inspected in light and dark modes; chart
   focus, legend, tooltip, and accessible fallback work without color alone.
10. Generated HTML passes the existing inert-content and size limits; no
    iframe, downloaded video, provider credential, or remote active content is
    present, and the existing 2 MiB rendered-HTML limit is enforced.
11. The latest successful snapshot is reachable at `/cinema`, Saturday Daily
    links to it, and the existing five-day Daily retention remains unchanged.
12. The tracked skill/provider references, non-secret configuration, runtime
    documentation, and recovery notes are updated before the scheduled job is
    enabled.
13. A cold start with no previous Cinema edition, a repeated scheduled attempt
    for the same local date, and an explicit manual retry are fixture-tested;
    none can create duplicate current editions or move the weekly cutoff.
14. Browser checks cover current Chrome desktop at 1440px and mobile at 390px,
    in light and dark themes, with keyboard-only navigation. Wider regression
    coverage may be added but is not required to define v1 readiness.
15. One live read-only smoke test verifies source freshness and secret preflight
    immediately before enabling the Saturday eligibility path. Safe run-stage
    diagnostics identify the failed section/provider without raw responses or
    secrets.
16. Rollback is tested: disabling `cinema.enabled` or removing Cinema from the
    registry restores the pre-Cinema Daily path without a schema rollback or
    deletion of the last snapshot.

## Explicitly out of scope for v1

- historical Cinema routes or an archive UI;
- daily Cinema refreshes;
- stock-price data or portfolio analytics;
- downloading or locally streaming trailer video;
- paid search APIs;
- user ratings, watchlists, or cinema-ticket purchasing;
- AI-generated box-office numbers, release dates, translations, or artwork;
- a new service, database, source orchestrator, or provider-specific renderer.

## First implementation gate

No additional product decision is required before coding. The first phase must
turn the source feasibility work into reproducible provider contracts before
adding UI:

1. verify and record exact read-only Composio YouTube leaf operations and exact
   official/discovery channel IDs;
2. add non-secret Cinema configuration, initially disabled for the feasibility
   spike and enabled only after live verification;
3. define strict TypeScript schemas for the versioned Cinema envelope and each
   section;
4. capture bounded redacted fixtures for Box Office Watch, AP fallback, LKC,
   cinema.lt, YouTube, TMDB, and each RSS publisher;
5. implement and test collectors/normalizers plus snapshot promotion in
   isolation;
6. only then add reusable UI components and enable a fixture-backed preview;
7. request `TMDB_READ_ACCESS_TOKEN` through the secret boundary only when the
   TMDB adapter is ready for a live read-only smoke test.

Exact provider URLs, leaf operation names, pagination fields, response mappings,
timeouts, byte limits, retry counts, and freshness diagnostics belong in the
provider references and tests produced by this phase. They may refine mechanics
but cannot change the product, lifecycle, selection, ownership, fallback, or
failure semantics in this contract without Alex's approval.
