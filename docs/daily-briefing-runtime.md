# Kurami Daily Briefing runtime

The Runtime MVP is a small Kurami-owned preview service. It deliberately does
not modify Telegram, Gmail, Calendar, or Discord.

## Ownership

- Tracked code: `_kurami/app/src/briefing/`
- Database migrations: `_kurami/app/migrations/briefing/`
- Active database and pages: `_kurami/state/briefing/`
- Systemd source unit: `_kurami/app/deploy/systemd/kurami-briefing.service`
- Skill contract: `_core/skills/kurami-daily-briefing/`

The SQLite database is separate from the orchestrator database. Edition
payloads and pages are retained for five days. Compact reaction events, the
topic registry, and preference aggregates survive edition cleanup.

## Commands

Run with Kurami's pinned Node runtime:

```text
/home/shagon1k/_hermes/_kurami/runtime/node/bin/node \
  /home/shagon1k/_hermes/_kurami/app/src/briefing/cli.ts init

/home/shagon1k/_hermes/_kurami/runtime/node/bin/node \
  /home/shagon1k/_hermes/_kurami/app/src/briefing/cli.ts \
  prepare-preview --payload /absolute/payload.json --html /absolute/rendered.html

/home/shagon1k/_hermes/_kurami/runtime/node/bin/node \
  /home/shagon1k/_hermes/_kurami/app/src/briefing/cli.ts inspect
```

The server listens only on `127.0.0.1:8787`. Prepared editions are available at
`/preview/daily/YYYY-MM-DD` or `/preview/cinema/YYYY-MM-DD`. `/health` reports
database integrity and always declares `externalMutations: false` in this MVP.

Before installing or restarting the systemd unit, build the runtime with
`npm run briefing:build`. The service runs the emitted JavaScript with
`--jitless`, allowing the systemd `MemoryDenyWriteExecute` boundary to remain
enabled. Do not point the unit at TypeScript source: Node's TypeScript stripper
requires WebAssembly, which is unavailable in jitless mode.

## Render boundary

Generated HTML is inert. The runtime rejects scripts, inline event handlers,
forms, frames, embedded objects, meta refresh, and files larger than 2 MiB. It
injects one trusted local script for theme switching, local read state on story
expansion, and explicit reactions.

The service remains behind loopback until the Cloudflare route and Access
policy are reviewed. Preview validation does not imply a production publish.

## Deferred production work

- Kurami-owned bounded Telegram `mark_read_through(chat_id, max_id)` adapter;
- idempotent Gmail `read_and_archive` action receipts;
- edition finalize/current transition and crash recovery;
- Discord release notification;
- Cloudflare `digest.shagon1k.win` route and Access protection;
- scheduled 09:00 Europe/Vilnius production job.

Do not modify the pinned external Telegram MCP checkout for these additions.
