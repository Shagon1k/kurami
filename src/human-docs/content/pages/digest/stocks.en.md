---
title: Stocks and Discovery
nav: Stocks
summary: How to read a watchlist row — price, change and freshness — and what the Discovery cards are.
section: digest
group: guide
order: 70
next: investment-review
---

Stocks is the page `/stocks` ("My stocks", my stocks) with closing prices from your watchlist. It is not a trading terminal: once a day Kurami fetches the daily history and shows the last completed session. The page has no share counts, no profit and loss, and no recommendations. The morning edition carries a "Stocks" teaser: it is frozen at publication and not updated afterwards.

Charts share their light and dark palettes with Digest and Hub. Legends, tooltips and the exact-value table keep the data accessible; missing history remains a gap in the line. Switching themes preserves the selected period and each miniature chart’s own scale.

Charts fit the available width on a phone without cropping the selected period. Date labels become less frequent; every exact value remains in the tooltip and data table. A single series uses the shared ochre colour.

## Reading a row

In Daily, Open overview sits to the right of the Stocks title when space allows.
The main instrument's price and session change sit together. On Stocks, the Order
label and select share one row; quote and portfolio-review expansion use the
shared SVG icon.

A list row is an expandable block. Open it to see the chart and the figures for a period. One row is open at a time.

The selected chart period uses a quiet ochre toggle, not the primary action colour. The links still open the selected period when JavaScript is unavailable.

| What | What it means | Source |
|---|---|---|
| Large price | The ordinary closing price of the session, in the security's currency | Exchange data without adjustments |
| Percentage on the right («за сессию», per session) | Change over the session including splits and dividends | Adjusted prices |
| Date under the price | The session the price belongs to | The last point of the history |
| "Stale" / "No data" | The data was fetched more than 48 hours ago, the last session is older than seven days, or there is no data at all | Freshness is checked at display time |
| "One month" mini chart | Adjusted closes for 30 days | Each row has its own scale |

The price and the percentage are computed from different series, so you cannot convert one into the other: from a price of €102 and "+4% per week" you cannot derive last week's price. If there is nothing earlier to compare with, the change is shown as a dash, not as zero. Mini charts cannot be compared by slope: each has its own scale.

Inside a row there is a chart for «Месяц», "3 months" or "Year" and the figures for 7 days, 30 days and a year. The year chart consists of weekly closes. The **Порядок** (order) selector reorders the rows: "My order" or "Notable moves". The order never changes on its own. The "What changed" block above the list names up to three facts: a notable daily move, a weekly move of 5% or more, and a new three-month high. Kurami does not guess the cause of a move.

## The list and its data

The list is defined in `briefing.yaml`, key `stocks.assets`: up to 12 securities, each with a ticker, ISIN, currency and exchange. Kurami accepts a history only if the ISIN and currency match the provider's catalogue: this guards against a swapped ticker. The refresh runs once a day on the morning poll. A free EODHD key gives 20 requests a day and Kurami spends at most 18, so a failed attempt is not repeated the same day. If a security did not refresh, its row keeps the earlier prices with the "Stale" label, and a warning appears at the top of the page: «Свежие котировки: 11/12» (fresh quotes).

## Discovery: outside your list

The "Outside your watchlist" block shows up to three US stocks that moved notably on higher volume in the last session. Kurami takes the lists of top gainers and losers from Alpha Vantage and re-checks every candidate against an independent EODHD history: the same company, the same session, matching price and volume. A card is a reason to take a look, not a recommendation. It shows the price, the move, the volume multiple («×2,1 к среднему за 20 сессий», ×2.1 of the 20-session average), the change over 7 and 30 days and a **Изучить компанию ↗** (study the company) link.

There can be zero, one or several matching cards; empty places are never filled, and with zero the block is absent altogether. Kurami does not repeat a security for three days unless the move reverses or grows one and a half times. The selection conditions — price from $5, turnover from $20 million, a move from 3% to 30% — are in the "Selection method" disclosure.

## What to do

| Situation | What you see | What to do |
|---|---|---|
| Quotes did not refresh | The "Stale" label, the warning «Свежие котировки: k/n» | Nothing: tomorrow's poll repeats |
| You need another security | It is not in the list | Add it to `stocks.assets` with its ISIN |
| No Discovery block | No matching cards, or the watchlist did not refresh fully | Nothing |

How the request budget, candidate checks and selection work is described in [Market data](@markets-internals). The «Обзор портфеля» (portfolio review) block on the same page is a separate add-on: [Investment Review](@investment-review).

## Next

:::cards
- [Investment Review](@investment-review) — the weekly portfolio analysis
- [Market data](@markets-internals) — quotas, Discovery, logos
- [Add-ons: the shared contract](@addons) — why the teaser in the edition does not change
:::
