---
title: Investment Review
nav: Investment Review
summary: What the weekly portfolio analysis is, how an accepted report differs from a draft, and what you have to confirm yourself.
section: digest
group: guide
order: 80
next: addons
---

Investment Review is a private analysis of your holdings that Kurami prepares once a week. It lives on the `/stocks` page in a collapsed block, **Portfolio review**. The analysis relies on saved quotes, company reports and the composition of the fund. It buys and sells nothing: there are no orders to a broker at all. The composition and quantities are kept only in a private directory on the server, not in the repository and not on the pages of this site.

## How a report appears

Every Sunday at about 10:00 local time (07:00 UTC) Hermes starts a job with no orchestrating model. The job collects the data, calls a model without tools three times and checks the result. An accepted report becomes the current one, and you get a short Discord message with a link to `/stocks`. Any check the report fails leaves the previous accepted report in place and sends a "not ready" message with the reason.

| State | What it means | What you see |
|---|---|---|
| Draft | The model wrote the text, the checks are not passed yet | Nowhere: the draft sits in a private run folder |
| Accepted | Composition, quotes, sources and text passed the checks | The "Portfolio review" block on `/stocks`, a Discord message |
| Older accepted | The new report did not build | The previous report stays in the block |

There are two slots, "Week" and "Month", and they are independent. The monthly report is started only manually; the weekly one runs automatically.

## What is inside a report

The block opens with one click. If one report is accepted, it is open right away; if both, you choose "Week · date" or "Month · date" inside. At the top is a short conclusion from Kurami. Then come the positions: each is collapsed and opens by its ticker. A position has "Advice" (for example, "Keep unchanged", "Do not increase the position yet", "Wait for a specific event"), "Short conclusion", "For your portfolio", "What could go differently" and "What to watch", plus a "Facts and sources" disclosure. Below there may be "Ideas to study" — at most two, and they are not suggestions to buy — and short term explanations, "Understand as you go".

All sums, shares and stress scenarios (−30% and −50%) are computed by code, not by the model. Positions without enough data are marked "Not enough data for advice" and say exactly what is missing.

## What you confirm

Kurami does not know what you bought yesterday. The composition of the portfolio is a file that you confirm yourself: a private directory holds `baseline-<date>.json` with tickers, ISINs and quantities. If the file is older than 30 days, the Sunday run is rejected: "the current portfolio composition is not confirmed". Then update the file.

The panel on the page always reminds you: "The current composition must be confirmed". This is intended: it does not check the analysis against a real account, so every "Keep" or "Consider" refers to the composition at the confirmation date. If positions changed, treat the advice as out of date until the next report.

## Discord messages

| Message | Reason | What to do |
|---|---|---|
| Portfolio review for the date is ready | The report is accepted | Open `/stocks` |
| the current portfolio composition is not confirmed | The composition file is older than 30 days | Update the file |
| incomplete quote snapshot | Not all quotes arrived in the morning | Nothing: the next run is in a week, a manual one on request |
| confirmed sources are missing | No fresh data for a company or the fund | Nothing |
| the draft did not pass the checks | The text was rejected by the checks | Nothing |
| the review text could not be prepared | A model failure | Nothing |

There is no second run on the same day: a run claims the date. A skipped Sunday stays silent. How the checks, the three-step model work and acceptance of a report work is described in [Market data](@markets-internals).

## Next

:::cards
- [Stocks and Discovery](@stocks) — the page where the block lives
- [Market data](@markets-internals) — the report pipeline and its checks
- [Add-ons: the shared contract](@addons) — where Investment Review sits in the overall picture
:::
