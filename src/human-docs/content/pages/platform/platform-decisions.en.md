---
title: Why it is so
summary: The decisions that shaped the Kurami platform: what was needed, what was decided, why, and what it costs.
section: platform
group: decisions
order: 10
---

Each decision is written in one format: **Context** — what was needed, **Decision** — what was done, **Why** — the reason, **Trade-off** — what it costs. The system-wide principles are on the [Principles](@principles) page.

## Hermes stays the runtime, and Kurami is a layer around it

**Context.** Hermes already provides a schedule, the Discord connection, model runs and external tools. Building a second bot or a scheduler of our own would duplicate it and compete with it for events.

**Decision.** Kurami ships job scripts, the Discord plugin, skills and CLI commands, while the scheduler and the single Discord listener stay with Hermes. Ten of twelve jobs are script jobs; only Daily and the documentation audit start a model.

**Why.** One event listener rules out double handling of button presses. Scripts are deterministic, covered by tests and spend no tokens.

**Trade-off.** While `hermes-gateway` is down, every cron job stands still. Scripts, the plugin and skills must be copied into Hermes's directory by hand or with the sync scripts.

## Cron in UTC, and code checks the local time

**Context.** Hermes jobs here have no time zone, yet the morning edition must come out at 09:00 local time all year. A clock change shifts local time by an hour.

**Decision.** The schedule sets candidate firings in UTC (`0 6,7,8`, `0 3,4 * * 1`), and the runtime itself decides from local time whether this one counts: Daily checks the hour, the documentation audit checks Monday and hour 06, Investment Review checks Sunday. systemd timers are set in local time directly.

**Why.** Nobody has to edit the jobs twice a year, and the rule for what 09:00 means sits next to the code that uses it.

**Trade-off.** One or two extra firings a day that quietly do nothing.

## Jobs with `local` delivery write to Discord themselves

**Context.** Hermes's standard delivery adds a generic header to a message and cannot edit an already sent one, while the health card must be one persistent message.

**Decision.** Health, Projects Digest and controller notifications run with `deliver: local` and send or edit messages themselves through the Discord REST API. The token comes from Hermes's `.env` and is stored nowhere.

**Why.** The script knows which message to update and can make a retry safe with the message identifier and a nonce.

**Trade-off.** A crash of such a script sends nothing: you see it from the stale time on the card and in the log.

## Three Composio authority levels instead of one per task

**Context.** Background reading of mail and calendar, one automatic action and work at the owner's request need different degrees of trust. The hosted Composio MCP cannot restrict call arguments.

**Decision.** Three separate sessions: `composio-read` with seven read tools, `composio-automation` with the single `GMAIL_BATCH_MODIFY_MESSAGES`, and a broad `composio` only for interactive work. Access is set twice — by the session policy and by the `tools.include` list in Hermes — and the workflow code checks the argument rules.

**Why.** Background work physically cannot reach a channel with write access, and full trust is safe only for a list of one exact tool.

**Trade-off.** Every new automatic action is a change to the policy, the Hermes list, a document and tests; the narrow argument rules live in code, not in Composio.

## Hub reads local sources and writes nothing

**Context.** The owner wants one page with project state, Git and Codex usage. Calling GitHub and Codex for it would mean holding tokens, hitting limits and risking a write.

**Decision.** Hub opens the Project Orchestrator database read-only, reads the local `git log` and local Codex logs, and listens only on `127.0.0.1`. It has no authorization of its own: Cloudflare Access guards the entrance.

**Why.** A service with no writes and no tokens cannot be used to change state, and the data already lies on the server.

**Trade-off.** The numbers may lag GitHub, Codex tokens are counted approximately from local logs, and safety depends on an Access setup outside the repository.

## An alert follows a streak of checks, not a single reading

**Context.** Server CPU and memory jump around: building an image or a preview easily produces a peak of a few seconds. A message for every peak would teach you to ignore the alerts channel.

**Decision.** Every problem has a key, a severity and a number of checks in a row: 3 for a warning and 2 for a critical problem on CPU, RAM and network. A message goes out only when the streak reaches the required length. The card shows the problem from the first check. The 5-second reading decides, not the rolling average.

**Why.** An average would smooth away a long overload and the alert would come late. A streak filters short peaks without hiding sustained ones. Recovery, by contrast, arrives at the first clean check: an alert must not outlive its problem.

**Trade-off.** A real problem is reported two or three checks late, up to half an hour at a ten-minute interval.

## One card is edited in place, alerts are separate messages

**Context.** The owner needs two different things: to look at the state at any moment and to learn about an event when it happens.

**Decision.** The state lives in one message of the health channel, which the script edits every time. Messages in the alerts channel appear only for a new problem, a change of severity, as a reminder after 120 minutes and on recovery. The Hermes job is marked `deliver: local`, and the script calls Discord directly.

**Why.** The channel does not fill with history, and every message in it is a reason to act. A direct call removes the generic Hermes header from the card and makes editing possible. A nonce makes a retry after a failure safe.

**Trade-off.** If the check or Hermes stops silently, nobody reports it: the only sign is a frozen "Updated" time.

## Monitoring observes and repairs nothing

**Context.** An orphaned preview, a disputed working copy or an unhealthy container can look like rubbish and still be someone's work.

**Decision.** The health check only reports: orphan previews, failed leases and quarantine stay in place until you decide. For the same reason monthly maintenance removes only old logs, unused images and surplus builder cache, and leaves containers, volumes, networks, working copies and preview runtimes alone.

**Why.** A wrong automatic deletion is irreversible, while an extra gigabyte on disk is not. The cost of a mistake is asymmetric, so the decision belongs to the owner.

**Trade-off.** If the disk is full of resources that maintenance does not touch, you free the space by hand.

## Backup runs in three tiers, and secrets are switched on separately

**Context.** A snapshot on the same disk does not survive losing the server, and a backup with secrets is dangerous if stolen.

**Decision.** The database and configuration snapshot holds no secrets and stays local. The bundle with secrets is created only when an `age` public key exists, and the private key stays with the owner off the server. The S3 copy is uploaded with a key that can write and delete only the current objects of its own folder, and counts as done after reading the size and checksum back.

**Why.** Each tier guards against a heavier loss, and a compromised server does not open the bundles. Bucket versioning leaves a margin for a mistaken deletion.

**Trade-off.** Digest data and some keys are in no tier and after losing the server are recovered only by creating them again.

## Documentation is published only on the owner's click

**Context.** An agent finds drift between the site and the code every week, but a mistake in documentation misleads a reader as much as a mistake in code.

**Decision.** The agent edits only a separate working copy. The worker drops everything outside an allowlist, opens a PR and posts a card. Publishing is possible only after Publish is pressed and only if the PR head equals the one on the card. The release is swapped whole, the previous one is kept for rollback, and a smoke check rolls back a failure by itself.

**Why.** A human stays the last link, and everything mechanical — build, merge, rollback — is done by code, not by the agent. The allowlist keeps a proposal away from application code.

**Trade-off.** Without your click even a correct edit does not reach the site, and while a proposal is open no new draft is created.

## The UI guard freezes violations and only lets them shrink

**Context.** Three sites must look the same, and an agent writing pages habitually adds literal colours and hand-made buttons.

**Decision.** The guard counts departures from the library per file and keeps the counters in a baseline. A growing counter fails the test; a reduction has to be recorded. A special element is accepted only with a written reason in the same file, and a PR declares `UI-Library: used`, `extended` or `exception`.

**Why.** Banning everything at once is impossible: old code breaks the rules. A freeze stops the debt from growing today and makes every exception visible to the reviewer.

**Trade-off.** Every new part needs a decision: use, extend the library or justify an exception.
