# Stocks add-on

`/stocks` is the latest cached watchlist, titled **Мои акции**. Daily carries
an immutable **Акции** teaser attached before publication. There are no dated
Stocks routes, portfolio quantities, trading actions, recommendations or P&L.

## Data and lifecycle

- `stocks` in `config/briefing.yaml` is optional; `enabled: false` stops
  collection and new Daily attachment and disables the route/navigation after
  service reload. Historical Daily teasers remain part of their saved issue.
- Each asset declares ID, provider symbol, ISIN, currency, exchange, timezone
  and optional listing date. Metadata must match before accepting history.
  VUAA uses the EUR Xetra reference listing, not a promise of Revolut execution
  prices. SPCX identifies SpaceX by ISIN and excludes pre-IPO history.
- EODHD is the sole initial adapter. The key is only in private
  `config/stocks.env` (`EODHD_API_TOKEN`, mode 600); never commit or log it.
  The collector requires the free account with base limit 20/day. Welcome or
  purchased credits do not increase its budget.
- Central Poller warms the cache once per UTC date, after 05:00 UTC. The
  existing hourly :37 schedule therefore collects before 09:00 Vilnius.
  Twelve histories plus US catalogue and VUAA identity lookup use 14 quota
  calls, plus one account check. A durable SQLite claim prevents a second
  attempt that day; at most 18 HTTP calls are reserved before sending them.
  A failed/crashed attempt waits until tomorrow rather than retrying against
  uncertain quota. Do not share this key with another scheduled consumer.
- Collection is bounded to the previous completed market date and one year,
  with three concurrent history requests and eight-second request timeouts.
  Failures preserve previous values as stale; absent values stay unavailable.
- `addon_snapshots.stocks` stores a validated version-1 envelope with the
  policy and per-asset `{date, close, adjusted}` series, fetch times and states.
  `stocks_refresh_days` stores daily request claims, retained for 31 days.
  No model, MCP connection or network request is involved in rendering.
- Prepublication attaches only the cache to `addons.stocks`. Once attached,
  Daily does not refresh it; the publication store rejects later modifications.
  Missing or failed Stocks data must never block Daily or change frozen News.

## Calculations and components

Row prices are raw session closes in native currency. Day/week/month returns
and charts use adjusted close (splits **and dividends**). Week/month compare
against the last available session on or before 7/30 calendar days earlier;
insufficient history is an em dash, not zero.

Daily shows VUAA and at most three ready non-benchmark movers meeting the
configured absolute daily threshold (initially 2%). A quiet day produces no
invented event. Dates and unavailable/stale coverage are explicit.

`stocks/render.ts` owns `StocksTeaser` and page composition; `components.ts`
owns `StockRow` and `StockDetails`. There are no comparison checkboxes or a
wide quote table. Rows show company/ticker, raw close, daily change, session
date and a shared `ui/charts/Sparkline` for the month. Sparklines use independent
scales and never imply directly comparable slopes.

One native details row opens at a time. Its large shared `TrendChart` has
1m/3m/1y controls and period return. Week/month/year returns are shown with
missing values explicit; short IPO history is not called a yearly return.
Year charts sample actual weekly closes and mark incomplete weeks.
The initial page sends no hidden large charts; a linked selected symbol gets
one server-rendered chart. Other details load via the cache-only
`GET /api/stocks/details?symbols=NVDA&period=1m`. The same symbol/period response
is reused in the browser. There is no provider call from this route.
Request versions prevent late responses overwriting newer choices. Failed
loads retain the old chart and offer retry. Periods persist when switching
rows; links remain a non-JavaScript fallback. Shared chart mounting is
idempotent and can be requested after inserting a disclosure.

Default order is the configured watchlist. Optional `Заметные движения` sorts
by absolute fresh daily change with stable original-order ties, placing
unavailable/stale values last. Nothing changes order automatically.

`insights.ts` supplies at most three distinct-symbol factual observations:
largest daily move above the configured threshold, largest weekly move of at
least 5% that exceeds its daily move, then strict new three-month adjusted
closing highs with sufficient history. Stale/missing/flat data create no
observation. These are not buy recommendations or inferred news causes.

Old multi-symbol URLs open their first selected symbol. The pure comparison
calculation remains tested internally but is no longer primary page UI.

## Operations and verification

`npm run test:briefing-stocks` covers quota/idempotency, free-only access,
partial failures, identity/IPO boundaries, adjusted returns, chart contracts,
route opt-out, bootstrap and frozen Daily. It performs no real API requests.

Normal collection belongs to Central Poller. An explicit operator invocation
is `node dist/briefing/stocks/collector.js --apply`; it respects the same ledger.
Initial rollout may reuse the verified research report with
`node dist/briefing/stocks/import-probe.js --file <report.json>`: this validates
identities/history and imports the actual quota ledger without network access.
It refuses an existing cache or a report older than 72 hours.

Provider reference: https://eodhd.com/financial-apis/api-for-historical-data-and-volumes

## Stocks Discovery v1 — /stocks only

An independent optional sub-module under `stocksDiscovery.enabled` (absent
means disabled). Its snapshot ID is `stocks-discovery`; it never enters a
Daily payload, teaser or Discord release. Disabling it removes the section
after service reload and stops collection; the ordinary watchlist is unchanged.

Central Poller calls it after the ordinary watchlist refresh. A completed
current-UTC-day watchlist ledger is mandatory. A unique daily claim allows at
most one Alpha Vantage request and four paid-in-quota EODHD units: one US
catalogue and at most three histories. `/api/user` costs zero. The fresh
account quota must confirm the free plan; total usage is capped at 18 of the
base 20, ignoring bonus credits. A smaller remaining budget reduces the number
of histories; no retries or replacement candidates may consume the reserve.
Claims survive crashes; the next UTC day is the next automatic attempt.
The API key `ALPHAVANTAGE_API_KEY` shares the private `config/stocks.env` file.

### Selection contract

1. Alpha Vantage `TOP_GAINERS_LOSERS` supplies its three top-20 lists, not the
   entire market. Deduplicate by symbol and exclude the configured watchlist.
2. Accept only uniquely identified USD Common Stock on supported major US
   exchanges, with ISIN/name validated in the EODHD catalogue. Exclude ETFs,
   warrants, preferred shares and units.
3. Require price ≥$5, price × share volume ≥$20M (a turnover proxy, not actual
   traded dollar value), and absolute daily change from 3% through 30%.
   Extreme jumps need separate corporate-action research and are not included.
4. Skip recent symbols for three calendar days unless direction reverses or
   absolute movement grows at least 1.5× AND by at least 3 percentage points.
   The same session is never treated as a new event.
5. Rank eligible candidates by absolute daily change descending, ticker as
   tie-breaker. Request histories for at most three, within quota.
6. Require the history's final date to match the completed discovery session;
   the discovery date must also match the latest US watchlist session.
   Reject >0.5% closing-price difference, >0.5 percentage-point daily-change
   mismatch, or >0.5-point raw/adjusted daily difference (possible corporate
   action). Reject incomplete/invalid volumes and >10% volume disagreement.
7. Require at least 21 history points and final share volume ≥1.5× the mean
   of the preceding 20 sessions, excluding the current session.
8. Publish zero to three passing cards, without filling vacancies. Week/month
   returns use adjusted closes and 7/30 calendar-day lookbacks. Reasons are
   factual movement/volume descriptions, never inferred news causes.

A weekend/holiday response for the same accepted session reuses that dated
snapshot without catalogue/history calls. Last-known cards survive a provider
failure only with an explicit warning; sessions older than four calendar days
are hidden. A healthy empty result renders no block. At most 31 days of
attempt metadata and 14 days of symbol cooldown records are retained.

### UI and verification

`discovery-render.ts` owns `StocksDiscovery` and `DiscoveryCard`; render only
on the detailed Stocks page. Use the shared tokens, percentage formatting and
optional Sparkline. There are no buy buttons or automatic watchlist additions.
Both sources are linked and methodology is in a quiet disclosure.

`npm run test:briefing-discovery` covers priorities, budgets, concurrency
claims/idempotency, filtering, corporate-action mismatch, relative volume,
cooldown, stale/empty/partial states, disabled routing, cache isolation and
offline bootstrap. No test consumes real API quota.

The initial rollout imports the 2026-09-18 verified feasibility artifacts via
`importDiscoveryProbe`, with no new provider requests. It accepts at most a
48-hour-old source/verification pair, checks agreement and thresholds, refuses
an existing cache and records the already-consumed calls. Those artifacts did
not retain raw history points: initial cards deliberately omit sparklines;
subsequent normal fetches supply them. No graph is fabricated.

Sources: [Alpha Vantage endpoint](https://www.alphavantage.co/documentation/#top-gainers-losers),
[free key / limits](https://www.alphavantage.co/support/),
[EODHD limits](https://eodhd.com/financial-apis/api-limits).

## Company logos

`stocksLogos.enabled` independently enables external company logos on `/stocks`
(absent/false means letters only). No financial provider requests or quota are
used. `ui/components/company-avatar.ts` is the canonical 40px component with
the same geometry in the watchlist and Discovery cards. Brand colors remain
unchanged; a white substrate keeps transparent black marks readable in either
theme. Initial/missing/error/no-JS states keep a two-letter ticker fallback.
The decorative image has empty alt text; the adjacent company name supplies
the accessible identity. Lazy images retain layout before loading.

`stocks/logo-registry.ts` pins manually checked domains by BOTH ticker and
ISIN, so reused tickers cannot inherit another company's brand. The initial
2026-09-18 metadata check matched 11 watchlist companies plus Intel and
CoreWeave. VUAA deliberately uses its issuer Vanguard. Gorilla Technology's
search result contained website `nan`: no domain was inferred from it.

For new identities, `stocks/logos.ts` performs at most three sequential metadata
searches per Poller run, after Stocks/Discovery. Require an exact ticker,
normalized company name and a supported US exchange code. Ambiguous, missing
exchange, malformed/private domains or mismatched results remain letters.
Positive matches are cached 30 days, negative/failed attempts seven days in
the independent `stock-logos` snapshot (maximum 100 entries). A metadata
attempt is recorded before awaiting the request; failures cannot block Daily.
Rendering is cache-only and never triggers a search.

The browser retrieves only needed images from the fixed
`https://cdn.tickerlogos.com/{domain}` origin with `referrerpolicy=no-referrer`.
There is no bulk logo download or proxy to arbitrary company sites. This does
expose a normal image request to that CDN; images are optional, not private
market data. The page includes the service's required visible dofollow
`Logos by AllInvestView` link in the shared page footer, without a separate
content footnote or issuer explanation. No API key or signup is needed.
General explanatory paragraphs under the watchlist and observations are
omitted; detailed chart labels and Discovery methodology remain contextual.

`npm run test:briefing-company-logos` covers domain/name/exchange validation,
ticker reuse, fallback load/error behavior, cached and negative lookups,
attribution, constant sizing and `/stocks`-only output.

Provider: [API](https://www.allinvestview.com/tools/ticker-logos/docs/),
[terms](https://www.allinvestview.com/tools/ticker-logos/terms/).
