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

Table prices are raw session closes in native currency. Day/week/month returns
and charts use adjusted close (splits **and dividends**). Week/month compare
against the last available session on or before 7/30 calendar days earlier;
insufficient history is an em dash, not zero.

Daily shows VUAA and at most three ready non-benchmark movers meeting the
configured absolute daily threshold (initially 2%). A quiet day produces no
invented event. Dates and unavailable/stale coverage are explicit.

`stocks/render.ts` owns `StocksTeaser` and the detailed watchlist. It reuses the
shared shell, selection control, buttons and `ui/charts/TrendChart`. Query
parameters select 1m/3m/1y and one to five registered symbols. A single series
shows adjusted price; comparisons show native-currency percentage change
from a common available date, without currency conversion. Year charts sample
actual weekly closes; incomplete weeks are marked. IPO gaps are not invented.

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
