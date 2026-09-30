---
title: Storage and live sections
nav: Storage and live sections
summary: Where an edition lives, how it enters the database in one transaction in the morning, how mail, calendar and weather refresh every hour and how long everything is kept.
section: digest
group: internals
order: 40
next: addons
---

Digest storage is the SQLite database `briefing.db` and a folder of files beside it. One edition lives in both places: data and state in the database, the finished page and images on disk. The checksum `content_digest` ties them together, and it also protects the edition from being written by two processes at once.

:::glance
- What it holds: editions, build attempts, reactions, receipts; pages and images as files
- Who writes: the runtime in the morning, the poller once an hour, the site on your clicks
- Where: `$KURAMI_HOME/state/briefing/` — SQLite in WAL mode and files
- Lifetime: the last seven editions; reactions and the topic registry live longer
- Result for you: the page is served from disk, while "read" marks and reactions are added from the database
:::

```diagram
kind: graph
title: What lives where
desc: An edition is stored as a row of the editions table and a page file. Items, capture boundaries and receipts hang off that row. An attempt is linked to the folder of its files. Reactions are kept separately and outlive editions.
node editions "editions" "id · state · payload_json · content_digest" entity at 0,0
node items "edition_items" "item_id · read_at · reaction" entity at 1,0
node batches "source_batches" "source_key · max_item_id · state" entity at 2,0
node attempts "briefing_run_attempts" "state · run_directory" entity at 0,1
node reactions "reaction_events" "fingerprint · topics · reaction" entity at 1,1
node receipts "Receipts" "validation · notification · card" entity at 2,1
node html "pages/preview/" "daily-<date>.html" store at 0,2
node media "media/daily/<date>/" "story images" store at 1,2
node runs "runs/<attempt>/" "attempt files" store at 2,2
group db "briefing.db" editions items batches attempts reactions receipts
group files "Files on disk" html media runs
edge editions <-> html "content_digest"
edge editions -> items "per edition"
edge editions -> batches "per channel"
edge attempts -> runs "run_directory"
edge items -> reactions "reaction" dashed
```

## An edition in the database and on disk

An edition is one `editions` row plus one HTML file. The row holds the whole edition, `payload_json`, along with the state `prepared`, `complete` or `partial`, the current-edition flag `is_current`, the publication time and the retention deadline. The file `pages/preview/daily-<date>.html` is the same one before and after publication: before publication it is visible only at `/preview/daily/<date>`, after it also at `/daily/<date>`.

`content_digest` is the sha256 of `payload_json`, a zero byte and the HTML. Every writer — the morning build, the poller, mail archiving — remembers the digest when it reads and writes its result only if the row still carries it. This is an optimistic lock: it is cheaper than locking the database while a file is written. Around the row sit `edition_items` — the "read" mark and reaction for every story and email, `source_batches` — the capture boundaries per channel, and the validation and notification receipts. The full list of tables is in the [data reference](@data-stores).

## Publication in one transaction

Publication moves an edition from `prepared` to `complete` or `partial` in a single SQLite transaction. `finalizeEdition` checks `planDigest`, capture completeness and post coverage, then in one transaction marks `source_batches` as `committed` or `failed`, records channel checkpoints, sets the edition state, clears `is_current` on the previous one and sets it on the new one. If any step fails, everything rolls back and the home page keeps the previous edition. State `partial` means a published edition with a caveat — for example, a channel could not be marked read.

## The hourly refresh

The poller re-reads mail, calendar and weather once an hour and rewrites the pages of all saved editions. A systemd timer starts it at :37 and it runs as plain code, without an agent. One call reads Gmail, each calendar and the weather for all dates of the kept editions at once and sorts events by date.

1. The poller takes the lock `.central-poller.lock`; if the previous poll is still running, it exits without error.
2. It reads up to seven editions and remembers each `content_digest`.
3. It collects data only for enabled sources that appear in at least one edition.
4. For every edition it applies the new data, recomputes Signals and the quality strip, and renders the page.
5. It writes the result only if the digest is unchanged and the frozen news, batch boundaries and stocks snapshot match the previous ones.
6. At the end it deletes editions past their retention time.

A failure of one source does not affect the others: the section keeps its last good value, gets status `stale` and a `staleAt` time. The `lastSuccessAt` mark moves only after a fully successful refresh. If an edition's write fails, the poller marks it `skipped`, the other editions are refreshed, and the process exits with code 1.

```diagram
kind: sequence
title: The :37 hour and a write conflict
desc: The poller reads an edition and its digest, queries providers and applies the data. If you archived mail in the meantime, the digest changed, the write is rejected and the edition is skipped until the next hour.
actor poller "Poller"
actor prov "Gmail, calendar, weather" external
actor db "briefing.db"
actor you "You" owner
msg poller -> db "reads 7 editions"
msg db -> poller "content_digest"
msg poller -> prov "one request, all dates"
msg you -> db "archive mail" accent
self poller "applies the data"
msg poller -> db "write if digest same"
msg db -> poller "digest changed" accent
note poller "edition skipped until :37"
```

## Frozen and live

The news is what is frozen in an edition: the stories, capture boundaries, post ownership and images. The poller compares the digest of that part before and after the refresh and refuses to write if it changed. Mail, calendar, weather, Signals and the quality strip stay live. Reactions and "read" marks are not part of the page at all: the site mixes them in from `edition_items` on every response. Mail rows in `edition_items` are recreated on every refresh, while `read_at` is preserved.

## Retention

The last seven editions are kept, and the config pins that number. An edition lives until `retention_until` — the edition date plus seven days. The cleanup after a poll deletes the page, the images in `media/daily/<date>`, the folders of every attempt of that date, the card and the edition row with its dependent tables.

| Data | What happens after seven days |
|---|---|
| Page, images, attempt folders | Deleted |
| The `editions` row, `edition_items`, `source_batches`, receipts, `action_receipts` | Deleted by cascade |
| `briefing_run_attempts` and their stage receipts | Kept as a short journal |
| `reaction_events`, `topic_registry` | Kept: this is the memory of your interests |

## The site

The site is the process `kurami-briefing.service` on a local port. It reads the edition page from disk, adds the theme, the shared script and state from the database, and serves it. A Cloudflare Tunnel publishes it behind Cloudflare Access. A strict CSP allows only its own scripts, and the page has no forms or frames.

| Path | What it serves |
|---|---|
| `/` | The current edition or the page "Briefing ещё не опубликован" (briefing not published yet) |
| `/daily/<date>` | A published edition (`complete` or `partial`) |
| `/preview/daily/<date>` | Any edition, including one prepared but not published |
| `/media/…` | Edition images |
| `/api/items/read`, `/api/stories/reaction` | The "read" mark, 🔔/🔕 |
| `/api/mail/read-and-archive` | Archiving the selected messages |
| `/api/news/order` | The "Обзор" or "Для меня" order |
| `/health` | Database integrity, the current edition, the latest attempt |

::::example A conflict at 10:37
:::steps
- **Poller** — reads edition `daily:2026-10-01` with digest `9c1e…` and asks the providers for data.
- **Poller** — Gmail answers with an error three times in a row: the mail section gets `stale`, the 37 emails stay, the success time stays 09:37.
- **You** — at 10:37:30 archive 4 emails: the edition's digest changes.
- **Poller** — the write is rejected: "lost its optimistic edition lock". The edition is marked `skipped` and the process exits with code 1.
- **Poller** — at 11:37 reads the new digest, sees 33 emails and updates the page.
:::
The data is invented; the behaviour comes from the code.
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| A provider did not answer during a refresh | The section keeps old data with the `stale` mark | Nothing |
| A write conflicts with archiving or a text fix | That edition is skipped for an hour | Nothing |
| Two polls overlapped | The second exits with code 0 | Nothing |
| No `poller.js` build or Composio access | The script exits with code 78, no agent is started | You repair the deployment |
| A settings error (retention not 7, invalid Discord channel) | The runtime and the poller refuse to run | You fix `config/briefing.yaml` |
| Database integrity is broken | `/health` answers 503 | You restore the database, see [Recovery](@recovery) |

:::guarantees
- The frozen news, batch boundaries and stocks snapshot of a published edition do not change on refresh.
- An edition is written under the digest check with the file rolled back on failure: the page and the row do not drift apart.
- The poller writes nothing to Discord, Telegram or Gmail.
- When a provider fails, a block shows its last data with a mark, not invented values.
- Exactly seven editions are kept; reactions stay without headlines or texts.
- The site starts neither a build nor the agent, on viewing or on a click.
:::

:::code-map
- `src/briefing/store.ts` — the database, preparation, published editions
- `src/briefing/finalization-store.ts` — publication in one transaction
- `src/briefing/published-edition-store.ts` — live section refresh and text revision
- `src/briefing/poller.ts` — the hourly poll
- `src/briefing/retention-store.ts` — seven editions and cleanup
- `src/briefing/server.ts` — the site and the API
- `integrations/hermes/scripts/kurami-digest-central-poller.sh` — the poller wrapper
- `migrations/briefing/` — the database schema
:::
