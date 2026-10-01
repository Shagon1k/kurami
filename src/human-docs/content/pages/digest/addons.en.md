---
title: "Add-ons: the shared contract"
nav: Add-ons
summary: How everything that grows around the morning edition is built: the registry, failure modes, four kinds of add-on, the snapshot table and frozen teasers.
section: digest
group: internals
order: 60
next: weekly-internals
---

An add-on is an optional Digest module with its own data, schedule, page and failure rule. All add-ons obey one contract: an add-on failure does not stop the edition, and a failed new attempt does not replace the last good one. That is why [Weekly](@weekly), [Cinema](@cinema), [Stocks](@stocks) and [Investment Review](@investment-review) can be switched off, broken and repaired without touching the morning build.

:::glance
- What it does: plugs modules into the edition through a static registry and decides what on the page is live and what is frozen
- Started by: the edition build, the hourly poll at :37, the Saturday and Sunday jobs
- Runs where: inside the Digest runtime; the poll is the systemd unit `kurami-digest-central-poller.timer`
- State: `addons` in the edition JSON and the `addon_snapshots` table, one row per add-on
- What you see: teasers in the edition, the pages `/weekly`, `/cinema`, `/stocks`, buttons on the Discord card
:::

```diagram
kind: graph
title: An add-on around the edition
desc: The registry plugs add-ons into the edition page. Live add-ons are refreshed by the hourly poll, derived ones are recomputed on any change, attached ones are copied into the edition at publication. Snapshots live in addon_snapshots, and the add-on pages read them directly.
node you "You" "read the pages" owner at 0,0
node pages "Add-on pages" "/weekly /cinema /stocks" at 1,0
node daily "Daily edition" "teasers and blocks" at 2,0
node registry "Registry" "order, failure mode" at 1,1
node live "Live" "mail, calendar, weather" at 0,2
node derived "Derived" "Signals, Weekly" at 1,2
node attached "Attached" "Cinema, Weekly, Stocks" at 2,2
node poller "Poll" "hourly, at :37" at 0,3
node snapshots "addon_snapshots" "id · state · digest" store at 1,3
node editions "editions" "payload_json" store at 2,3
group kurami "Digest runtime" pages daily registry live derived attached poller snapshots editions
edge you -> pages "read"
edge you -> daily "read"
edge registry -> daily "renders blocks"
edge registry -> live
edge registry -> derived
edge registry -> attached
edge poller -> live "refreshes"
edge attached -> snapshots "copy"
edge attached -> editions "frozen"
edge snapshots -> pages "read by"
edge editions -> daily "page"
```

## The registry and failure modes

The registry is a static list of eight modules: mail, calendar, news, weather, cinema, signals, weekly, stocks. It sets the order of blocks on the page, their places (slots) and the failure rule. The list is static on purpose: order and id uniqueness are checked at load time, and dynamic plugin loading is not needed for one owner.

| Mode | Who | What happens on an error |
|---|---|---|
| `propagate` | mail, calendar, news, weather | The error rises and stops publication: this is the core content of the edition |
| `isolate` | cinema, signals, weekly, stocks | The block is replaced by fallback markup or disappears, the page stays |

Teasers sit under the news in the order Stocks, Cinema, Weekly. Signals sit higher, under the figures at the top of the page.

## Four kinds of add-on

The kind of an add-on determines who updates it and when. That is why one module cannot be live and frozen at the same time.

| Kind | Examples | Who updates it | In the edition |
|---|---|---|---|
| Live | mail, calendar, weather | The poll, every hour | Refreshed |
| Derived | Signals, the Weekly marker | Recomputed on any change of inputs | Recomputed |
| Attached | Cinema, the Weekly review, Stocks | Their own collection; a copy goes into the edition at publication | Frozen |
| Independent | Discovery, logos, Investment Review | The poll or the Sunday job | Not included |

Live add-ons read providers: web sources in parallel, Composio calls one at a time over a single connection. One failure does not hinder the others: a block keeps its previous value with the status `stale`. Derived add-ons do not call providers; they compute from their neighbours' data.

## The envelope and the snapshot table

Each add-on is stored in the edition as an *envelope* `addons.<id>` with a version, a state, a snapshot time and data. The state is one of `ready`, `empty`, `partial`, `stale`, `failed`. There are no root fields: data lives only in the envelope, so there is one copy of the truth.

The `addon_snapshots` table is the "last good snapshot" of an add-on: one row each for `cinema`, `weekly`, `stocks`, `stocks-discovery`, `stock-logos`. A row holds the data JSON in canonical form (keys sorted) and its sha256. The pages `/cinema`, `/weekly`, `/stocks` read this table, not the edition; so they show fresher data than the teaser in the edition.

## The frozen teaser

A teaser in the edition is a copy taken at publication, and the poll is not allowed to change it. The edition write compares the sha256 of the Stocks envelope before and after a refresh and rejects a change. The reason: a published page must remain a record of what you saw in the morning, even if the stock cache became fresher in the evening. The add-on page keeps moving forward, the edition does not.

::::example Sunday 2026-10-04, edition `daily:2026-10-04`
```diagram
kind: sequence
title: One edition and four add-ons
desc: The build puts the Weekly marker into the edition, before publication the week review and the stocks are copied into it, at publication the review is saved to addon_snapshots, and the hourly poll refreshes only live blocks.
actor compose "Build"
actor pre "Before publication"
actor publish "Publication"
actor poller "Poll"
actor db "briefing.db"
self compose "weekly marker, state empty"
msg pre -> db "reads the stocks cache"
self pre "week review and stocks into the edition"
msg publish -> db "edition complete"
msg publish -> db "weekly snapshot" accent
msg poller -> db "09:37 live blocks"
note poller "Stocks stays as is"
```
:::steps
- **Build** — at 09:00 creates the edition; the derived Weekly module puts the marker `addons.weekly` with state `empty`.
- **Pre-publication step** — builds the review for 27 September to 3 October, puts `addons.weekly` (`partial`, calendar 5/7) into the edition, and a copy of the stocks cache `addons.stocks` (the whole list and three notable securities).
- **Publication** — in one transaction marks the edition `complete` and writes the row `addon_snapshots.weekly`.
- **Poll** — at 09:37 refreshes mail, calendar and weather. The `stocks` envelope stays as it was: a write that changes it is rejected.
- **You** — on Monday the edition `daily:2026-10-05` has only the empty Weekly marker, while `/weekly` still shows the Sunday review.
:::
The data is invented; state and table names are taken from the code.
::::

## When something goes wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| An `isolate` add-on block failed to render | The block disappears, the page is built | Nothing |
| A live source answered partially | The previous value stays as `stale`; `lastSuccessAt` does not move | Nothing |
| An add-on is switched off in config | New editions without it; old ones keep their data; the poll does not read it | Turn the `enabled` key on |
| The poll tries to change the frozen Stocks | The write is rejected, the edition is skipped until the next hour | Nothing |
| A snapshot older than the current one | The replacement is rejected, the previous one stays | Nothing |

:::guarantees
- A failure of an `isolate` add-on does not stop the publication of an edition.
- A failed attempt does not replace the last good snapshot.
- The poll does not change the frozen news or the Stocks teaser.
- An unknown value is stored as `null`, not as zero.
:::

:::code-map
- `src/briefing/addons/registry.ts` — the `BRIEFING_ADDONS` array, slots (`after-metrics`, `after-main`), error isolation
- `src/briefing/addons/types.ts` — the `BriefingAddon` contract
- `src/briefing/addons/live.ts` — collecting and applying live add-ons
- `src/briefing/addons/derived.ts` — recomputing derived add-ons
- `src/briefing/addons/snapshot-store.ts` — the `addon_snapshots` table, canonical JSON, sha256
- `src/briefing/addon-publication-store.ts` — atomic replacement of a published add-on
- `src/briefing/poller.ts` — the hourly poll
- `src/briefing/prepublication.ts` — refresh and attach before publication
:::
