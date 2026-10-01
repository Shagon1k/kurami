---
title: Why it is so
summary: The decisions that shaped Digest: what was needed, what was decided, why, and what it costs.
section: digest
group: decisions
order: 10
---

Each decision is written in one format: **Context** — what was needed, **Decision** — what was done, **Why** — the reason, **Trade-off** — what it costs. The system-wide principles are on the [Principles](@principles) page.

## The news queue is "unread" in Telegram itself

**Context.** Every morning we need to know which posts of 15 channels have not yet reached an edition. We can keep our own cursor or use the read boundary that every channel already has.

**Decision.** Kurami freezes the unread count and the id of the newest message of a channel, and after publication marks the channel read exactly up to that id. There is no cursor of its own.

**Why.** The boundary lives where the posts live and cannot drift from them. Marking after publication guarantees an edition that did not come out does not eat the news, and posts that arrived during the build stay for tomorrow.

**Trade-off.** If you read a channel in Telegram itself, those posts will not reach the edition. A failed marking gives a `partial` edition, and the posts return the next day.

## The agent writes only the draft; code does everything else

**Context.** A language model retells well and guarantees completeness, order and safety poorly. A cron job cannot approve dangerous tools.

**Decision.** The agent writes `editorial-draft.json`: texts, topics and four ratings per story. Checks, identifiers, ranking, the page, publication and marking channels are done by the runtime, driven by saved receipts.

**Why.** Text quality is checked mechanically: copying the source, length, topics, post coverage. A bad draft is rejected, not published. The order of an edition is reproducible.

**Trade-off.** The strict checks sometimes reject a good text. Then the attempt waits for a corrected draft in the recovery window, and if that fails the day stays without an edition.

## The publication tail is one tool inside the Telegram process

**Context.** Publication is about ten steps: page, images, validation, marking channels, publishing, notifying. If an agent orchestrates them, it can lose its way, skip a step or pass a foreign path.

**Decision.** The agent calls `finish_daily_briefing(edition_id, attempt_id)` and passes nothing else. The tool runs in the Telegram MCP process with its single session, under a lock and a 900-second budget, and resumes from receipts.

**Why.** One Telegram client rules out session conflicts. Two identifiers as input leave no room for paths, boundaries and foreign tools.

**Trade-off.** The tail is Python that calls the Node CLI as a subprocess. The MCP request timeout must exceed the tail's budget.

## Done means published and notified

**Context.** A tool answer, an empty agent reply and a cron status of "completed" prove nothing about whether the edition is on the site and you know about it.

**Decision.** The `assert-complete` command requires three facts: the attempt is `notified`, the edition is `complete` or `partial`, the notification receipt is `complete`. Only then does the agent return `[SILENT]`.

**Why.** Saved facts are checked, not words. A gap between publication and notification is healed by repeating one notification, with no rebuild.

**Trade-off.** The guard needs its own systemd timer and access to Hermes metadata. If their format changes, the hard deadlines of 09:50 and 10:50 remain.

## The news is frozen, the rest is live, and writes go by digest

**Context.** The morning edition must be reproducible, while mail, calendar and weather go stale within an hour. A refresh without an agent must not spoil the page.

**Decision.** Once an hour code rewrites the live blocks of all saved editions, but writes the result only if the row's `content_digest` is unchanged and the frozen news matches the previous one.

**Why.** It is cheaper than locking the database while a file is written, and any conflict — with mail archiving or a text fix — is safely put off for an hour.

**Trade-off.** Data can be an hour older, so every block has a time and an "outdated" mark. A conflicting edition is skipped until the next hour.

## A published edition is the record of the morning: add-ons are attached as a copy and frozen

**Context.** The add-on pages (`/stocks`, `/cinema`, `/weekly`) move forward, while the edition for a date must stay what you saw in the morning. Meanwhile the hourly poll refreshes live blocks.

**Decision.** The Cinema, Weekly and Stocks teasers are copied into the edition at publication as `addons.<id>` envelopes. The edition write compares the sha256 of the frozen Stocks envelope and rejects a change. The fresh snapshot is stored separately in `addon_snapshots`, and the add-on pages read it.

**Why.** Two copies with different roles are cheaper than one mutable copy: the edition stays a record, and the page is a showcase of fresh data. Recomputing the teaser on every poll would make yesterday's editions untrustworthy.

**Trade-off.** The teaser in the edition can lag behind the add-on page, and every value is stored twice.

## Two failure modes in a static registry: `propagate` and `isolate`

**Context.** Mail, calendar, news and weather are the content of the edition. Weekly, Cinema, Signals and Stocks are extras that leave the edition complete without them.

**Decision.** In `BRIEFING_ADDONS` every module has a failure mode. A `propagate` error stops publication, an `isolate` error removes the block and leaves the page. The registry is a static array; order and id uniqueness are checked at load time.

**Why.** Bad data in the core content must not be published silently, and a cinema failure must not cost you the morning edition. Dynamic plugin loading is not needed for one owner.

**Trade-off.** A new add-on is a code change: a module file, a registry line, tests.

## Optional Weekly writes run in a SAVEPOINT inside the edition transaction

**Context.** Weekly observations must reach the database together with the edition, but a Weekly failure has no right to break publication.

**Decision.** `persistOptionalWeekly` opens a `SAVEPOINT` inside the publication transaction. On an error only it rolls back, publication goes on, and a short reason code is written to `weekly_persistence_failures`.

**Why.** A write after the commit could be lost on a process crash, and a shared transaction would make Weekly mandatory. A savepoint gives both atomicity and isolation.

**Trade-off.** A failure is visible only in the table and in the log, not in the interface.

## The model boundary in Cinema is a points band

**Context.** The model writes good Russian headlines but cannot honestly choose news by points on its own, and numbers and dates must not be trusted to it.

**Decision.** Code freezes a pool of up to 45 stories and their points. The model chooses among candidates within 12 points of the boundary and writes the text. The composer reorders the choice and applies a per-publisher cap. Trailers are selected by code alone.

**Why.** The editor keeps freedom of choice, while fact substitution and a skew toward one publisher are impossible.

**Trade-off.** A good candidate outside the band does not pass, even if the model would prefer it.

## Quotes: one attempt a day, the quota is written before the request

**Context.** A free EODHD key gives 20 requests a day, shared by quotes, Discovery and the report. Exhausting the key breaks the morning teaser.

**Decision.** The poll first claims the date in `stocks_refresh_days`, then writes the counter before each request. At most 18 requests are spent, bonus credits do not count, and the plan is checked on every run.

**Why.** After a crash it is unknown how many requests were spent, and a retry risks exhausting the key. A lost morning is cheaper than a lost day.

**Trade-off.** A failed attempt cannot be repeated until the next day.

## The portfolio report is accepted as a separate step, with no retries and no orders

**Context.** A model can write a convincing but wrong analysis. The report concerns the owner's money.

**Decision.** The Sunday coordinator passes gates (composition not older than 30 days, complete quotes and sources), makes at most three model calls without tools and checks the draft against the hash of the input. Acceptance writes a file named by its sha256 and switches a pointer atomically. There are no orders: the `proposedOrders` field is empty.

**Why.** It is better to keep the previous report than to accept a wrong one. A retry after a failure would hide the cause.

**Trade-off.** Any failure means a week without a new report.

## Read next

:::cards
- [Digest](@digest) — the whole section in one picture
- [How Daily is built](@daily-pipeline) — the mechanics of the morning build
- [Add-ons: the shared contract](@addons) — the registry, failure modes, frozen teasers
- [Market data](@markets-internals) — quotas and the portfolio report
- [Principles](@principles) — the system-wide principles
:::
