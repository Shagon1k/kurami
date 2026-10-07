---
title: Investment Review
nav: Investment Review
summary: What the weekly portfolio analysis is, how an accepted report differs from a draft, and what you have to confirm yourself.
section: digest
group: guide
order: 80
next: daily-pipeline
---

Investment Review is a private analysis of your holdings that Kurami prepares once a week. It lives on the `/stocks` page in a collapsed block, **Обзор портфеля** (portfolio review). The analysis relies on saved quotes, company reports and the composition of the fund. It buys and sells nothing: there are no orders to a broker at all. The composition and quantities are kept only in a private directory on the server, not in the repository and not on the pages of this site.

## How a report appears

Every Sunday at 07:00 UTC (10:00 local time in summer, 09:00 in winter) Hermes starts a job with no orchestrating model. The job collects the data, calls a model without tools up to three times and checks the result. An accepted report becomes the current one, and you get a short Discord message with a link to `/stocks`. Any check the report fails leaves the previous accepted report in place and sends a "not ready" message with the reason.

| State | What it means | What you see |
|---|---|---|
| Draft | The model wrote the text, the checks are not passed yet | Nowhere: the draft sits in a private run folder |
| Accepted | Composition, quotes, sources and text passed the checks | The «Обзор портфеля» block on `/stocks`, a Discord message |
| Older accepted | The new report did not build | The previous report stays in the block |

There are two slots, «Неделя» (week) and «Месяц» (month), and they are independent. The monthly report is started only manually; the weekly one runs automatically.

## What is inside a report

Before you expand the panel, its heading shows each report's date and whether it is stale or needs confirmation of the holdings. Quote freshness does not imply that the portfolio analysis is current. Sources, positions and term explanations use the same SVG disclosure control.

The block opens with one click. If one report is accepted, it is open right away; if both, you choose «Неделя · дата» or «Месяц · дата» (week or month, with the date) inside. At the top is a short conclusion from Kurami. Then come the positions: each is collapsed and opens by its ticker. A position has «Совет» (advice; for example «Оставить без изменений», keep unchanged, or «Пока не увеличивать позицию», do not increase the position yet), «Короткий вывод» (short conclusion), «Для твоего портфеля» (for your portfolio), «Что может пойти иначе» (what could go differently) and «За чем следить» (what to watch), plus a «Факты и источники» (facts and sources) disclosure. Below there may be «Идеи для изучения» (ideas to study) — at most two, and they are not suggestions to buy — and short term explanations, «Разобраться по ходу» (understand as you go).

All sums, shares and stress scenarios (−30% and −50%) are computed by code, not by the model. Positions without enough data are marked «Недостаточно данных для совета» (not enough data for advice) and say exactly what is missing.

## What you confirm

Kurami does not know what you bought yesterday. The composition of the portfolio is a file that you confirm yourself: a private directory holds `baseline-<date>.json` with tickers, ISINs and quantities. If the file is older than 30 days, the Sunday run is rejected: "the current portfolio composition is not confirmed". Then update the file.

From day 25 Daily reminds you in the stocks block. If the positions have not changed, press **Состав не менялся** (positions unchanged) there: Kurami saves the same composition with today's date, zeroing the trade and contribution counters in a new month. If positions changed, update the file yourself.

When the review gives a position or idea an exact day to come back to it (an earnings, filing or index-change date from the sources), Daily says so in the stocks block that morning: «Сегодня по плану: NVDA — …» (due today). The date comes only from sources and at most 120 days ahead; without an exact date only the "what to watch" text remains.

The panel on the page always reminds you: «Нужно подтвердить текущий состав» (the current composition must be confirmed). This is intended: it does not check the analysis against a real account, so every "Keep" or "Consider" refers to the composition at the confirmation date. If positions changed, treat the advice as out of date until the next report.

## Discord messages

Links inside the standalone report use the unified Digest entry; embedded
images and fonts remain inside the private file.

| Message | Reason | What to do |
|---|---|---|
| Portfolio review for the date is ready | The report is accepted | Open `/stocks` |
| the current portfolio composition is not confirmed | The composition file is older than 30 days | Update the file |
| incomplete quote snapshot | Not all quotes arrived in the morning | Nothing: the next run is in a week, a manual one on request |
| confirmed sources are missing | No fresh data for a company or the fund | Nothing |
| the draft did not pass the checks | The text was rejected by the checks | Nothing |
| the review text could not be prepared | A model failure | Nothing |

There is no second run on the same day: a run claims the date. A skipped Sunday stays silent. How the checks, the model calls and acceptance of a report work is described in [Market data](@markets-internals).

## Next

:::cards
- [Stocks and Discovery](@stocks) — the page where the block lives
- [Market data](@markets-internals) — the report pipeline and its checks
- [Add-ons: the shared contract](@addons) — where Investment Review sits in the overall picture
:::
