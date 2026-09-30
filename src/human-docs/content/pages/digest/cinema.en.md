---
title: Cinema
nav: Cinema
summary: The Saturday cinema page: four sections, where they come from and when a new snapshot replaces the old one.
section: digest
group: guide
order: 60
next: stocks
---

Cinema is a separate page, `/cinema`, with a review of the cinema week. Every Saturday at 09:00 local time Kurami collects a new snapshot, checks it and only then replaces the previous page with it. If the build fails, `/cinema` keeps last week's page. The Saturday Daily edition carries a short teaser with a link; on other days there is no teaser, although the page stays up.

## The four sections

| Section | What is inside | Source |
|---|---|---|
| **Box office pulse** | The US weekend winner, up to four "movements" (biggest debut, best hold, sharpest drop, chart shift), weekend and year tables, a chart of the top five over six weeks | Box Office Watch; AP and Kinopoisk on failure; Lithuania from the Lithuanian Film Centre report, world from Kinopoisk |
| **Trailers of the week** | Up to nine fresh trailers, at most three per channel; the button opens YouTube | Official studio channels through Composio |
| **Premieres** | Up to twelve films opening in Lithuania next week, with genre, runtime, director | cinema.lt |
| **News** | Up to fifteen stories from seven days with a Russian headline and summary | Variety, Deadline, The Hollywood Reporter, IndieWire |

Numbers, dates and ranks come from the sources and are computed by code. The model writes only the Russian headlines and summaries of the news and two or three short handwritten notes; it cannot change a number.

## When the page is replaced

Kurami replaces `/cinema` only with a checked snapshot. Each of the four sections gets its own state, and those states decide the fate of the whole snapshot.

| Snapshot | Decision | What you see |
|---|---|---|
| At least one section has data, the rest are ready or honestly empty | Accept | A new page |
| Two or more independent sections have data, but some sections failed | Accept as partial | A new page without the missing sections |
| Data in one section only, or none | Reject | The previous page stays |

An empty section is allowed only when collection succeeded and found nothing suitable. If Box Office Watch is unavailable, the US data comes from AP; then the page has no dynamics chart and no year totals, because AP does not provide them. A snapshot with an earlier date than the current one is not accepted.

## What Saturday looks like

:::steps
- **Kurami** — at 09:00 collects the snapshot and saves it as a file in the run folder.
- **Hermes agent** — reads the news candidates and writes Russian headlines and summaries.
- **Kurami** — fetches images, checks the snapshot and prepares the page.
- **Kurami** — replaces `/cinema` in one operation together with the snapshot.
- **You** — see the "Cinema of the week" teaser in Daily and the **🎬 Cinema** button on the Discord card.
:::

You do not configure channels and sources: they are set in `briefing.yaml`, and the market by the key `cinema.market` (currently `LT`).

## When something is wrong

| Situation | What you see | What to do |
|---|---|---|
| The snapshot is not accepted | `/cinema` shows last week with its date; the Saturday Daily has no teaser | Nothing: next Saturday builds again |
| One section did not build | The page lacks that section; the bottom strip says "There are data caveats" and "The snapshot is partial: 1 unavailable, 0 incomplete" | Nothing |
| An image did not arrive | The card stays without an image, the text is in place | Nothing |

How collection, fallback sources and the acceptance rule work is explained in [How Cinema is built](@cinema-internals).

## Next

:::cards
- [Stocks and Discovery](@stocks) — quotes of the watchlist
- [How Cinema is built](@cinema-internals) — collection, fallback sources, publication
- [Add-ons: the shared contract](@addons) — how an add-on lives beside Daily
:::
