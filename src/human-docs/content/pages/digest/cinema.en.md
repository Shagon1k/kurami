---
title: Cinema
nav: Cinema
summary: The Saturday cinema page: four blocks, where they come from and when a new snapshot replaces the old one.
section: digest
group: guide
order: 60
next: stocks
---

Cinema is a separate page, `/cinema`, with a review of the cinema week. Every Saturday at 09:00 local time Kurami collects a new *snapshot* — the week's data set — checks it and only then replaces the previous page with it. If the build fails, `/cinema` keeps last week's page. The Saturday Daily edition carries a short teaser with a link; on other days there is no teaser, although the page stays up.

## The four blocks

Below the title, section links take you to Box office, Trailers, Premieres and News. Only blocks present in the edition have a link. The links scroll with the page; they do not add a fixed header row.

Rankings show five films initially. **Show top 10** reveals the remaining rows through the shared SVG disclosure control.

On phones, a story image sits above its text, as in Daily. Desktop retains the
horizontal layout. Images keep their proportions; a story without an image
does not reserve an empty image column.

| Block | What is inside | Source |
|---|---|---|
| **Пульс проката** (box office pulse) | The US weekend winner, up to four "movements" (biggest debut, best hold, sharpest drop, chart shift), weekend and year tables, a chart of the top five over six weeks | Box Office Watch; AP and Kinopoisk on failure; Lithuania from the Lithuanian Film Centre report, world from Kinopoisk |
| **Трейлеры недели** (trailers of the week) | Up to nine fresh trailers, at most three per channel; the button opens YouTube | Official studio channels through Composio |
| **Премьеры** (premieres) | Up to twelve films opening in Lithuania next week, with genre, runtime, director | cinema.lt |
| **Новости** (news) | Up to fifteen stories from seven days with a Russian headline and summary | Variety, Deadline, The Hollywood Reporter, IndieWire |

Numbers, dates and ranks come from the sources and are computed by code. The model writes only the Russian headlines and summaries of the news and two or three short handwritten notes; it cannot change a number.

## When the page is replaced

The supplemental world weekend table is omitted, with a diagnostic and partial
box-office status, if its source cannot prove the same weekend as the collected
US table, or if an unambiguous exact film match has world gross below domestic
gross in the same currency. Source references remain available for audit. Kurami
does not relabel uncertain figures as international or add them to US figures.
Recovery must create a new candidate from the frozen file, preserving dates and
provenance; it must not overwrite the original or recollect a different week.

Kurami replaces `/cinema` only with a checked snapshot. Each of the four blocks gets its own state, and those states decide the fate of the whole snapshot.

| Snapshot | Decision | What you see |
|---|---|---|
| At least one block has data, the rest are ready or honestly empty | Accept | A new page |
| Two or more independent blocks have data, but some blocks failed | Accept as partial | A new page without the missing blocks |
| Data in one block only, or none | Reject | The previous page stays |

An empty block is allowed only when collection succeeded and found nothing suitable. If Box Office Watch is unavailable, the US data comes from AP; then the page has no dynamics chart and no year totals, because AP does not provide them. A snapshot with an earlier date than the current one is not accepted.

## What Saturday looks like

:::steps
- **Kurami** — at 09:00 collects the snapshot and saves it as a file in the run folder.
- **Hermes agent** — reads the news candidates and writes Russian headlines and summaries.
- **Kurami** — fetches images, checks the snapshot and prepares the page.
- **Kurami** — replaces `/cinema` in one operation together with the snapshot.
- **You** — see the "Cinema this week" teaser in Daily and the **🎬 Cinema** button on the Discord card.
:::

You do not configure channels and sources: they are set in `briefing.yaml`, and the market by the key `cinema.market` (currently `LT`).

## When something is wrong

| Situation | What you see | What to do |
|---|---|---|
| The snapshot is not accepted | `/cinema` shows last week with its date; the Saturday Daily has no teaser | Nothing: next Saturday builds again |
| One block did not build | The page lacks that block; the bottom strip says "Data caveats" and «Срез собран частично: 1 недоступно, 0 неполно» (the snapshot is partial: 1 unavailable, 0 incomplete) | Nothing |
| An image did not arrive | The card stays without an image, the text is in place | Nothing |

How collection, fallback sources and the acceptance rule work is explained in [How Cinema is built](@cinema-internals).

## Next

:::cards
- [Stocks and Discovery](@stocks) — quotes of the watchlist
- [How Cinema is built](@cinema-internals) — collection, fallback sources, publication
- [Add-ons: the shared contract](@addons) — how an add-on lives beside Daily
:::
