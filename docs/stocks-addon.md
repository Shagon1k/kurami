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

## Discovery feasibility — 2026-09-18

No automated `Вне твоего списка` feed is enabled yet. Discovery must be an
independent optional input and cannot consume the watchlist's reserved quota.
Do not display demo responses as live candidates or scrape around access gates.

- EODHD free plan covers our existing histories. Do not assume Screener access
  from having spare credits; a new endpoint's entitlement must be verified.
- Finviz exposes useful movement categories, but its official API/export link
  routes to Elite. No unlicensed scraper was added.
- Yahoo's public gainers page returned HTTP 429 during research; it is not
  accepted as a reliable automated dependency.
- Alpha Vantage documents `TOP_GAINERS_LOSERS` with 20 gainers, 20 losers and
  20 most-active US symbols. Default data updates at end of day; realtime and
  delayed intraday data require premium. Its support page states 25 daily
  requests for the free service. This is the preferred next feasibility test:
  one daily discovery request, then at most 2–3 identity-validated EODHD
  histories within the remaining base quota. A personal free key is required;
  the published demo query returned an informational key-required response,
  not market data. Real-key freshness, coverage and entitlement remain untested.

Before activation validate dated completed sessions, symbol identities and
allowed instrument types; exclude the current watchlist and low-liquidity
spikes, avoid repeats, and publish fewer candidates when evidence is weak.
Do not infer sustained trends from one day's gainers or a causal explanation
from price alone. Filters and exact ranking need validation against a real
response before being treated as a production contract.

Sources: [Alpha Vantage endpoint](https://www.alphavantage.co/documentation/#top-gainers-losers),
[free key / limits](https://www.alphavantage.co/support/),
[EODHD limits](https://eodhd.com/financial-apis/api-limits),
[Finviz API/export](https://finviz.com/api-and-exports).
