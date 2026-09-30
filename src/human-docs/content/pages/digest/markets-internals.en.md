---
title: Market data
nav: Markets internals
summary: How Kurami protects the free quote quota once a day, selects the Discovery cards, and how the Sunday pipeline turns data into an accepted report.
section: digest
group: internals
order: 90
---

Market data lives apart from the edition: only the hourly poll and the Sunday job collect it, and the pages read a finished cache. So opening `/stocks` makes no provider request at all, and a failure of the quote provider does not touch the morning build. The main concern of this part is the free EODHD key with 20 requests a day: quotes, Discovery and any future consumer share it.

:::glance
- What it does: once a day refreshes the watchlist quotes, checks the Discovery candidates and once a week prepares a portfolio report
- Started by: the poll at :37 (the first attempt after 05:00 UTC) and the Hermes Sunday job at 07:00 UTC
- Runs where: the Digest runtime; the report is the script `kurami-investment-review-weekly.sh` and a Hermes subprocess without tools
- State: `stocks_refresh_days`, `stocks_discovery_days`, the rows `stocks`, `stocks-discovery`, `stock-logos` in `addon_snapshots`; the private `portfolio/` directory
- What you see: the `/stocks` page, the "Stocks" teaser in the edition, the "Portfolio review" block, a Discord message
:::

```diagram
kind: sequence
title: The morning poll: quotes, then Discovery
desc: The poll claims the date in the database, checks the EODHD plan, reads the catalogue and twelve histories, and saves the cache. If the day completed fully, it takes the lists from Alpha Vantage, checks up to three candidates in EODHD and saves the cards.
actor poller "Poll"
actor db "briefing.db"
actor eod "EODHD" external
actor av "Alpha Vantage" external
msg poller -> db "claims the date"
msg poller -> eod "plan and quota"
msg poller -> eod "catalogue, 12 histories"
msg poller -> db "stocks cache"
phase "Discovery, if the day is complete"
msg poller -> av "top gainers and losers"
msg poller -> eod "catalogue, up to 3 histories"
msg poller -> db "cards"
```

## The quota and the claimed date

A quote refresh starts with a write to `stocks_refresh_days`, not with a request. The poll tries to insert a row with the UTC date; if the row exists, the attempt is not repeated. The request counter is written *before* each call. So after a crash in the middle Kurami treats the quota as possibly spent and waits for the next day. That costs a lost morning, but the key is not burned before tomorrow.

The poll checks the key: the file `$KURAMI_HOME/config/stocks.env` must be a regular file with no group or other permissions. `GET /api/user` must say the plan is free with a limit of 20. Of that limit Kurami spends at most 18 and ignores bonus credits. If the remaining quota is not enough for the securities, the refresh does not start.

A list of twelve securities takes fifteen requests: the plan check, the US catalogue, an ETF search by ISIN and twelve histories. Histories run three at a time with an 8-second timeout. Each security is checked against the catalogue: ticker, currency and ISIN must match, otherwise the series is rejected as `identity_mismatch`. One security failing leaves its earlier prices marked `stale`; the cache is always saved.

## The frozen teaser

At 09:00 the pre-publication step copies the cache into the edition as `addons.stocks`, cutting off points dated the edition date or later. So the morning teaser shows the last completed session. After that the edition write compares the sha256 of this envelope and rejects any change: the `/stocks` page moves forward, the edition stays a record of the morning. More in [Add-ons: the shared contract](@addons).

## Discovery: selection and verification

Discovery runs only after a fully completed quote day: the `stocks_refresh_days` row must be `complete`, that is all twelve securities are fresh. If one security lags, Discovery does not run that day. Kurami calls Alpha Vantage once, takes the remaining EODHD quota (at most four units) and selects candidates.

| Stage | Condition |
|---|---|
| List | Top gainers, losers and most active; not from your list; price from $5; price × volume from $20 million; a move of 3–30% |
| Catalogue | Exactly one ordinary USD stock on a main exchange; not a warrant, preferred or ETF |
| Repeat | The same ticker is not shown for three days unless the move reversed or grew 1.5 times and by 3 points |
| History | At most three candidates; the last date equals the session; price within 0.5%, volume within 10% |
| Corporate action | An ordinary versus adjusted move differing by more than 0.5 points — rejected |
| Volume | At least 1.5 times the average of the previous 20 sessions |

The session is taken from Alpha Vantage's `last_updated` and must match the last US session in the cache. At weekends the same session with the earlier snapshot is reused without new requests. Zero cards is a normal result: the block is simply not drawn.

## Logos

Logos are decoration, and their failure blocks nothing. Pinned "ticker + ISIN" pairs need no requests. For new ones Kurami makes at most three requests to the AllInvestView service per poll and records the attempt *before* the answer: a restart will not search for the same name again and again. Only an exact match of ticker, normalized name and a US exchange is accepted. A success is kept for 30 days, a failure for 7. The browser loads the image directly from the CDN with no referrer.

## The portfolio report: the pipeline

The Hermes Sunday job runs `automation.js run`; the weekday and the claimed date are checked inside the code, so cron stays simple. The pipeline passes fixed gates, and every "no" leaves the previous accepted report.

```diagram
kind: graph
title: The Sunday report gates
desc: The run is skipped on a day that is not Sunday and on a claimed date. Then the age of the composition file, the completeness of quotes, the completeness of sources and the validity of the draft are checked. Any failure leaves the previous report; success accepts the new one.
node sunday "Sunday?" decision at 0,0
node free "Date free?" decision at 1,0
node baseline "Composition under 30 days?" decision at 2,0
node quotes "Quotes complete?" decision at 2,1
node sources "Sources complete?" decision at 1,1
node valid "Draft valid?" decision at 0,1
node accept "Report accepted" end at 0,2
node keep "Previous report stays" fail at 2,2
node skip "Skip" "no message" state at 1,2
edge sunday -> free "yes"
edge sunday -> skip "no"
edge free -> baseline "yes"
edge free -> skip "no"
edge baseline -> quotes "yes"
edge baseline -> keep "no"
edge quotes -> sources "yes"
edge quotes -> keep "no"
edge sources -> valid "yes"
edge sources -> keep "no"
edge valid -> accept "yes"
edge valid -> keep "no"
```

Collection goes in this order: a snapshot of the quote cache (all securities on one session) and the ECB rate; the full VUAA fund composition from the Vanguard site; SEC company metrics (at most 15 tickers and 16 requests). For companies where metrics are not enough, the job downloads their reports from the SEC archive (up to eight companies and 64 requests). Then a model without tools extracts facts, a second call checks them independently, and a third writes the report draft. If the metrics are complete, there is one call. In all, at most three calls of five minutes each, with no retries. Code assigns the fragment identifiers so that the model does not retype quotations itself.

The draft check binds it to the hash of the input data, verifies the fact references and forbids orders: the `proposedOrders` field must be empty. Acceptance is a separate step: the report is written as a file named by the sha256 of its content, then the pointer `latest-weekly.json` is switched atomically. The `accept.lock` lock protects against parallel writes. An old date cannot replace a new one.

::::example Thursday 2026-10-01 and Sunday 2026-10-04
:::steps
- **Poll** — at 05:37 UTC claims the date `2026-10-01`. The plan is free, used 0: the limit is 18. 15 requests, the day is `complete`.
- **Poll** — Discovery: one Alpha Vantage call, then `/api/user` (used 15): `min(4, 18 − 15) = 3` units are available. The catalogue and at most two histories. Candidate XYZ: +8.4%, price $12.30, turnover about $50 million, volume ×2.1. It qualifies.
- **Job** — on Sunday 2026-10-04 at 07:00 UTC the composition file dated 2026-09-18 (16 days) qualifies. For five companies the SEC metrics are not enough: the job fetches their reports, the first model call extracts facts, the second checks them, the third writes the draft.
- **Acceptance** — the check passes, the file `reviews/<sha256>.json` is written, the pointer is switched. Discord gets "Portfolio review for 2026-10-04 is ready".
:::
The data is invented; limits and names are taken from the code.
::::

## When something goes wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| `stocks.env` missing or wrong | The whole day is `failed`, prices stay `stale`; the attempt is claimed until the next day | Fix the file (permissions 600) |
| The plan is not free or the quota is short | No requests except the plan check | Check the EODHD account |
| A crash in the middle of a refresh | The date stays `running`, no retry | Nothing |
| Any Discovery error | A `failed` snapshot is saved with the earlier cards and a warning | Nothing |
| The Sunday run died in `running` | The claimed date and `weekly-automation.lock` block a retry | Inspect the run and remove the lock by hand |
| The report is rejected | The previous accepted one stays; Discord says "not ready: reason" | Update the composition or wait a week |

The `accept.lock` lock is not released automatically either: after an interrupted acceptance an operator removes it.

:::guarantees
- The pages and the report panel read only stored data, with no provider requests.
- Kurami spends at most 18 of 20 requests a day and does not repeat an uncertain attempt.
- Discovery does not enter the edition and does not add securities to the list.
- The report sends no orders to a broker; acceptance is a separate checked step.
- The data on composition and quantities stays in the server's private directory.
:::

:::code-map
- `src/briefing/stocks/collector.ts` — quote refresh, quota and the claimed date
- `src/briefing/stocks/lifecycle.ts` — copying the cache into the edition
- `src/briefing/stocks/discovery.ts` — the Discovery refresh and selection
- `src/briefing/stocks/discovery-model.ts` — filters and history verification
- `src/briefing/stocks/logos.ts` — the logo cache
- `src/briefing/investment-review/automation.ts` — the Sunday pipeline and gates
- `src/briefing/investment-review/model.ts` — calculations and draft validation
- `src/briefing/investment-review/store.ts` — acceptance and pointers
- `bin/investment-review-trial.py` — the call of a model without tools
:::
