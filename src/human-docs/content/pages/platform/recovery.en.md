---
title: Backups and recovery
nav: Backups
summary: What Kurami copies every three days, what sits in the encrypted bundle on someone else's server, and what you rebuild by hand if the whole server is lost.
section: platform
group: guide
order: 50
next: maintenance
---

Kurami backs up in three tiers, and each one guards against a heavier loss. A snapshot on the same disk saves you from a broken database. An encrypted bundle holds the secrets needed to rebuild the server. A copy in external storage survives losing the server itself. The job runs at 03:15 UTC on days 1, 4, 7 … of the month, so runs are at most 72 hours apart, and the result arrives in the maintenance channel.

## Three tiers

| Tier | What is inside | Where it lives | How many are kept |
|---|---|---|---|
| Snapshot | the Run Store database (`orchestrator.db`) and, when present, the Health database (`system-health.db`) the Digest database (`briefing.db`) and Ideas (`ideas.db`); `orchestrator.yaml`, `projects.yaml`, `Caddyfile` and the Digest settings `briefing.yaml`, `briefing-topics.yaml`; a manifest with checksums; no secrets | `$KURAMI_HOME/backups/backup-<UTC time>/` | the latest 14 |
| Encrypted bundle | the newest verified snapshot, three secret files (Hermes environment, GitHub, TailorTales preview) and the Hermes cron registry | `$KURAMI_HOME/recovery/*.tar.zst.age` | the latest 3 |
| Off-site copy | the same bundle plus its checksum file | S3 cloud storage, `recovery/` folder | the latest 3 pairs |

The second and third tiers switch on only when you put an `age` public key and storage access into a private settings file. Without the key Kurami takes only the snapshot. You keep the private key yourself, off the server and out of the storage: a bundle that the server's own key could open would protect nothing.

## What is not copied

The code lives in GitHub and is not part of the backup. Outside every tier you also lose:

- the Digest edition pages and media in `state/briefing/` (the database `briefing.db` with the editions' data is copied, the finished pages are not);
- the docs proposal database `proposals.db` and `stocks.env`;
- the remaining secrets: Composio environments, the GitHub App key for reviews, the PickFlick preview environment, the Telegram session;
- logs, Docker data, working copies, Codex sessions and the previews themselves.

So after a total server loss the finished edition pages and media do not come back, and some keys must be issued again. The Health database keeps pending alert messages and streaks, so a restored server does not forget an open problem; an older backup without it is still valid, and the next check starts Health state afresh.

## What you see

After every run the maintenance channel gets "💾 Kurami backup completed": the snapshot name, the SQLite check result, the file count, how many snapshots remain and how many were removed, and the creation time. With the second tier on, lines about the bundle and the upload follow, or the line "Off-site upload: not configured". If something breaks, the job fails and the local snapshot stays. The [health check](@health) also raises a critical problem when the latest backup is older than 84 hours. The stages are described on [How backups work](@backup-internals).

## Copies and receipts

```diagram
kind: graph
desc: Selected databases and configuration form a local verified snapshot. The snapshot and selected secret files form an encrypted bundle. A verified S3 upload records a receipt. Git supplies code separately; Cloudflare policies and excluded transient state need separate recovery.
node state "Selected state" "databases and config" store at 0,0
node snap "Snapshot" "integrity and checksums" store at 1,0
node bundle "Encrypted bundle" "selected secrets" store at 1,1
node s3 "S3 copy" "verified upload" external at 1,2
node receipt "Upload receipt" "not a restore drill" store at 0,2
node git "Git" "code separately" external at 0,1
edge state -> snap
edge snap -> bundle
edge bundle -> s3
edge s3 -> receipt
```

A verified upload writes `state/recovery-upload.json`; Health can evaluate its age. A local snapshot does not prove an off-site copy exists, and an upload receipt does not prove that decryption and a full rebuild have been tested. Cloudflare policies, excluded secrets and transient sessions need the separate recovery steps.

## Checking the bundle

A bundle that cannot be opened is worse than no bundle, so it is worth testing. You run the check by hand on a clean machine, not on the production server.

:::steps
- **You** — download the newest bundle and its `.sha256` file from storage and compare the checksum.
- **You** — run `recovery-bundle.ts verify` with the private key you keep offline.
- **The check** — decrypts the bundle into a temporary directory, rejects unsafe paths in the archive, compares every file to the manifest and runs `quick_check` on each database in it, including `system-health.db`, `briefing.db` and `ideas.db` when present.
- **The check** — deletes the decrypted files and prints the result.
:::

## Restore order

A real restore is a manual operation, and the order matters. The environment comes first, then the code, then secrets and data; the pollers switch on last so that nothing starts working on half a state.

:::steps
- **You** — install the dependencies: Git, tmux, Node.js, rootless Docker, Cloudflare Tunnel, Hermes.
- **You** — clone the repository from GitHub into `$KURAMI_HOME/app`, then run `npm ci` and `npm run check`.
- **You** — copy the configuration from `deploy/config`, install the systemd units, the Hermes plugin and skills.
- **You** — decrypt the bundle and put the secrets back with mode `0600`.
- **You** — restore the newest verified database snapshot (`orchestrator.db` and, when included, `system-health.db`, `briefing.db` and `ideas.db`) while the services and jobs are stopped, or pick a clean database if the run history is expendable.
- **Operator** — restore the project clones, build Digest and promote an owner-approved docs artifact.
- **Operator** — install all tracked app services and both Digest timers, including Projects and the web gateway; check Hermes plugin and skill sync before starting Docker, Hermes and the services.
- **You** — recreate the cron jobs from the inventory: they get new identifiers.
- **You** — validate everything and only then switch the project pollers on.
:::

:::cards
- [How backups work](@backup-internals) — three stages, file checks and retention
- [Monthly maintenance](@maintenance) — what is cleaned and what stays
- [Server health](@health) — the backup age check
:::
