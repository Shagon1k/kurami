---
title: How Cinema is built
nav: Cinema internals
summary: How the Saturday run collects four sections from six sources, where the model works and by which rule a new snapshot replaces the page.
section: digest
group: internals
order: 80
next: markets-internals
---

Cinema is a pipeline of five commands and a fallback, which the Hermes agent runs inside the Saturday Daily edition. Code collects and checks all the facts, the model writes only the Russian news, and the publication rule decides whether to accept the snapshot. Cinema has no timer of its own: the `cinema_schedule` field in `briefing.yaml` is not read by code, and the `collect` command itself checks that the day is a Saturday.

:::glance
- What it does: collects the week's snapshot, checks it and replaces the `/cinema` page in one transaction
- Started by: the Hermes agent in the Saturday Daily edition, at 09:00 local time
- Runs where: the CLI `dist/briefing/cinema/cli.js`, a separate edition type `cinema`
- State: snapshot files in the run folder, the edition `cinema:<date>`, the `cinema` row in `addon_snapshots`
- What you see: the `/cinema` page, a teaser in the Saturday Daily, the "🎬 Cinema" button in Discord
:::

```diagram
kind: graph
title: The Saturday pipeline
desc: Collect freezes the candidates into a file. The agent writes the Russian news texts. Cache-media saves the images, compose builds the envelope. Prepare makes the page, promote replaces it and writes the snapshot. Daily picks up the snapshot only with the same date.
node collect "collect" "six sources" at 0,0
node cand "cinema-candidate.json" "frozen candidates" store at 1,0
node agent "Hermes agent" "Russian news texts" at 2,0
node media "cache-media" "images into media/" at 2,1
node compose "compose" "the snapshot envelope" at 1,1
node env "cinema-envelope.json" "the whole snapshot" store at 0,1
node prepare "prepare" "page, prepared" at 0,2
node promote "promote" "one transaction" at 1,2
node snap "addon_snapshots" "cinema" store at 2,2
node page "/cinema" "the page" end at 1,3
node daily "Daily" "teaser if dates match" at 2,3
edge collect -> cand
edge cand -> agent "candidates"
edge agent -> media "draft"
edge media -> compose
edge compose -> env
edge env -> prepare
edge prepare -> promote
edge promote -> snap
edge promote -> page "replaces"
edge snap -> daily "date matched" dashed
```

## Collection: six sources and fallbacks

`collect --date` accepts only a Saturday and freezes six sources in parallel. Each section has its own state: no items and failures — `failed`, no items and no failures — `empty`, items and failures — `partial`, otherwise `ready`.

| Section | Primary source | Fallback |
|---|---|---|
| US box office | Box Office Watch (`weekend.json`, `yearly.json`) | AP: only a Top 10, without year totals, signals and the chart; then Kinopoisk USA |
| World box office | Kinopoisk through a reader proxy | — |
| Lithuanian box office | The XLSX of the Lithuanian Film Centre | — |
| Premieres | cinema.lt: cards with a "Premjera" date next week and the film pages | — |
| News | Four RSS feeds | One feed failing makes the section `partial` |
| Trailers | YouTube channels through Composio | No connection — the section is `failed` |

A fallback shows only what it can prove: AP has no history, so the dynamics chart and year totals disappear rather than being invented. Code computes the signals: biggest debut, best hold, sharpest drop, chart shift — up to four in all. There is no TMDB feed in collection.

## Code picks the trailers

Trailers are selected without a model. A title must contain trailer or teaser; clips such as interviews, reactions and breakdowns are dropped, as are re-releases of old films. Points: an official channel 1000, an aggregator channel 500, plus a bonus for the type (main 80, final 60, teaser 40). Duplicates by film title are removed, and at most three are taken from one channel. So it is better to show seven trailers than to hand the page to one studio.

## Where the model works

The model chooses news and writes the Russian text for it. Code freezes a pool of up to 45 candidates beforehand: points from 100, plus for notable events, minus for reviews and listicles, plus for freshness. The agent writes `cinema-editorial-draft.json`: up to 15 stories with a headline (12–150 characters) and a summary (45–420) and up to three notes no longer than four words. The composer accepts only candidates whose points are not below the fifteenth's minus 12, reorders them itself and applies the per-publisher cap. A candidate outside the band is an exception, and the agent fixes the draft or runs `fallback`, which honestly turns the news section off.

## Images and the publication rule

`cache-media` downloads only approved images. The address must be HTTPS and on the allowed host list for its type; the file is up to 8 MiB, up to 96 MiB per snapshot in total; the format is detected from the first bytes, so SVG and HTML do not pass. Without an image the card keeps its text.

```diagram
kind: graph
title: The acceptance rule
desc: If all sections are ready or empty, at least one section with data is needed. Otherwise data in at least two sections is needed. Then the snapshot is checked not to be older than the current one; only then is the page replaced.
node q1 "Sections ready or empty?" decision at 1,0
node q2 "Data in at least one?" decision at 0,1
node q3 "Data in two or more?" decision at 2,1
node q4 "Not older than current?" decision at 1,2
node acc "Replace /cinema" end at 0,3
node rej "Previous page stays" fail at 2,3
edge q1 -> q2 "all"
edge q1 -> q3 "some failed"
edge q2 -> q4 "yes"
edge q2 -> rej "no"
edge q3 -> q4 "yes"
edge q3 -> rej "no"
edge q4 -> acc "yes"
edge q4 -> rej "no"
```

`promote` also checks the edition: it must be `prepared`, and the date must match the snapshot's date. Then `finalizeEdition` in one transaction marks the edition `complete` or `partial`, clears the current flag of the previous one and writes the row to `addon_snapshots`. A rerun on the same Saturday takes another path: `prepare` only validates, and `promote` atomically replaces the page and the snapshot together.

::::example Saturday 2026-10-03, edition `cinema:2026-10-03`
:::steps
- **Agent** — at 09:00 runs `collect --date 2026-10-03`. The trailer and news window is 26 September 09:00 to 3 October 09:00, the premiere window is 5 to 12 October.
- **Collect** — Box Office Watch answers 500 on `yearly.json`. Code takes AP: the box office section is `partial` with the diagnostic `box-office-watch:fallback_to_ap`, without the chart and year totals.
- **Collect** — trailers `partial` (one channel did not answer, seven trailers, at most three from Disney), premieres `ready` (five cards), news `ready` (pool of 45).
- **Agent** — picks fifteen stories from the points band. `compose` would reject a candidate below the boundary.
- **Compose** — the envelope is `partial`, with data in four sections — so it is accepted.
- **Promote** — the edition `cinema:2026-10-03` becomes current, `/cinema` shows it. The Daily of the same day gets the "Cinema of the week" teaser with the button "Open Cinema ↗".
:::
The data is invented; state and file names are taken from the code.
::::

## When something goes wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| A source failure | The section gets `failed` or `partial`; the snapshot still goes on if enough sections have data | Nothing |
| The snapshot fails the rule | `promote` exits with an error; `/cinema` stays as it was; no teaser in Daily | Nothing |
| The agent's draft is rejected | `compose` fails; the agent fixes it or runs `fallback` without news | Nothing |
| Daily did not come out after Cinema | `/cinema` stays new, Cinema is not collected again | Nothing |
| Old Cinema editions | Not deleted: cleanup covers only Daily | Delete manually if you need the space |

:::guarantees
- A Cinema failure does not stop Daily.
- A failed attempt does not replace the last accepted page.
- Numbers, dates and ranks are set by code, not by the model.
- Only checked images reach the page, no video and no scripts.
:::

:::code-map
- `src/briefing/cinema/cli.ts` — the pipeline commands
- `src/briefing/cinema/collector.ts` — parallel collection and fallbacks
- `src/briefing/cinema/providers/` — source parsers (Box Office Watch, AP, Kinopoisk, LKC, cinema.lt, RSS, YouTube)
- `src/briefing/cinema/selection.ts` — trailer and news points
- `src/briefing/cinema/composer.ts` — the envelope, the points band, notes
- `src/briefing/cinema/media-cache.ts` — safe saving of images
- `src/briefing/cinema/promotion.ts` — the acceptance rule and page replacement
- `integrations/hermes/skills/kurami-daily-briefing/references/cinema-addon.md` — the agent's Saturday instruction
:::
