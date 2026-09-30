---
title: How backups work
nav: Backups
summary: Three stages of one script — a database snapshot, an encrypted bundle and an off-site copy — and the checks that stop an empty or broken file from counting as a backup.
section: platform
group: internals
order: 40
next: connector-authority
---

A Kurami backup is a chain of three stages in one shell script, where each stage checks the result of the previous one and fails loudly when in doubt.

:::glance
- What it does: copies the Run Store database and configuration, encrypts a bundle for rebuilding the server and puts it in external storage
- Triggered by: the Hermes job `kurami-state-backup`, `15 3 */3 * *` — at 03:15 UTC on days 1, 4, 7 and so on
- Runs where: `kurami-state-backup.sh` and three TypeScript commands in `src/system/recovery/`, no agent
- State: the `backups/` and `recovery/` directories and the `recovery/` folder in S3; a manifest with checksums at each step
- What you see: the "💾 Kurami backup completed" message in the maintenance channel
:::

```diagram
kind: graph
title: The three backup stages
desc: The script copies the Run Store database with VACUUM INTO and three configuration files into a snapshot directory. If a public key is set, it builds a bundle from the snapshot and four secret files, encrypts it with age and stores it in the recovery directory. If a bucket is set, it uploads the bundle to S3 and reads the result back.
node job "Hermes job" "03:15 UTC, */3" at 0,0
node db "orchestrator.db" "live database" store at 1,0
node snap "1. Snapshot" "VACUUM INTO, manifest" at 1,1
node snaps "backups/" "14 snapshots" store at 0,1
node bundle "2. Bundle" "tar.zst + age" at 1,2
node bundles "recovery/" "3 bundles" store at 0,2
node s3 "3. Upload" "S3 with read-back" at 1,3
node bucket "S3 bucket" "3 pairs of files" external at 2,3
node key "Public key" "recovery.env" external at 2,2
edge job -> snap "starts"
edge db -> snap "reads" muted
edge snap -> snaps "writes"
edge snap -> bundle "newest snapshot"
edge key -> bundle "encrypts for" muted
edge bundle -> bundles "writes"
edge bundle -> s3
edge s3 -> bucket "PUT and check"
```

## Stage 1: the snapshot

The first stage copies what the Run Store cannot be rebuilt without, and does it without stopping the system. The script opens the live database read-only, runs `PRAGMA quick_check` and executes `VACUUM INTO` into `backups/backup-<UTC time>/`. This SQLite command produces a consistent copy even while the database is being written to: copying the file the ordinary way could catch half a transaction. After copying, the script checks the copy itself.

`orchestrator.yaml`, `projects.yaml` and `Caddyfile` are placed beside it; the script rejects links instead of files. `manifest.json` is written last, listing every file with its size and SHA-256 and marked `secretsIncluded: false`. Then the script keeps the 14 latest snapshots (`KURAMI_BACKUP_RETENTION`, from 2 to 90). If any part fails, the half-made directory is deleted: a snapshot is either whole or absent.

## Stage 2: the encrypted bundle

The second stage builds a bundle that can bring a server up from nothing, and it is off by default. The file `secrets/recovery.env` turns it on: the script reads it only if it is a regular file, not a link, with mode exactly `600`; otherwise it stops with "Refusing unsafe Minimal DR config". If the file holds no `age` public key, stages 2 and 3 are skipped without an error.

Before packing, the script checks the inputs. The snapshot must have a manifest with `integrity: ok` and `secretsIncluded: false`, and every file must match it by SHA-256. Every secret source — the Hermes environment, `github.env`, `tailortales-preview.env` and the `cron/jobs.json` registry — must be a regular file with no permissions for group or others. Everything is put into a temporary directory with mode `700`, packed with `tar --zstd`, encrypted with `age --encrypt --recipient`, and a `.sha256` file is written beside it. An existing bundle cannot be overwritten. The plaintext is always deleted, including on failure. The three latest bundles stay locally.

## Stage 3: upload with read-back

The third stage counts an upload as successful only after it has read the result back itself. The script verifies the local checksum, then sends the bundle and the `.sha256` file through `curl` with an AWS SigV4 signature. It passes the access keys through standard input so they never appear in the process list. After that the script runs a chain of checks.

```diagram
kind: sequence
desc: The script sends the bundle and its checksum to S3, then requests the object size, reads the checksum, lists the folder, deletes the oldest pairs and lists again to confirm that three pairs remain.
actor script "Script"
actor s3 "S3" external
msg script -> s3 "PUT bundle and .sha256"
msg script -> s3 "HEAD: size"
self script "size = local?"
msg script -> s3 "GET .sha256"
self script "sum = local?"
msg script -> s3 "LIST: pair present?"
msg script -> s3 "DELETE old pairs"
msg script -> s3 "LIST: three left?"
```

Deleting old pairs is constrained: the write key for the storage can only list the `recovery/` folder and read, write and delete current objects in it. It does not have `DeleteObjectVersion`, so the bucket's versioning keeps a deleted object, and a lifecycle rule erases old versions after 30 days. That margin is for the case where a script fault deleted too much.

## Schedule

The `*/3` step in the day-of-month field means days 1, 4, 7, …, 31, not "every 72 hours". The count restarts each month, so the gaps are uneven.

| Month | Last backup of the month | Until the next |
|---|---|---|
| 31 days | the 31st | 1 day |
| 30 days | the 28th | 3 days |
| 29 days | the 28th | 2 days |
| 28 days | the 28th | 1 day |

The longest gap is three days, or 72 hours. The health check limit is 84 hours, so the schedule never causes a false alert about an old backup.

::::example The backup of 4 October (invented data)
:::steps
- **Hermes** — at 03:15:00 starts `kurami-state-backup.sh`.
- **Snapshot** — creates `backups/backup-20261004T031500Z/` with five files: `orchestrator.db`, three configuration copies and `manifest.json`. The oldest snapshot is deleted, 14 remain.
- **Bundle** — at 03:15:03 puts `kurami-recovery-20261004T031503Z.tar.zst.age` and its `.sha256` in `recovery/`. Inside are the snapshot, three secret files, the cron registry and a manifest.
- **Upload** — sends the pair to the bucket, checks the size and sum, deletes the fourth pair in line and verifies that three remain.
- **Hermes** — posts the summary to the maintenance channel: the snapshot name, the file count, how many snapshots remain, the bundle name and a line about the upload.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| Database `quick_check` is not `ok` | the first stage fails, no snapshot is created, the job ends with an error | investigate the database; earlier snapshots are intact |
| `recovery.env` has wrong permissions | after the snapshot the script stops, there is no bundle | fix the mode to `600` |
| A secret is group-accessible or is a link | no bundle is created, the local snapshot stays | fix the file's permissions |
| No `age` key set | stages 2 and 3 are skipped without a message; the summary has no bundle lines | read the summary and add the key |
| Size or sum in S3 does not match | the job fails, the local bundle stays | retry, check the AWS keys |
| Backup older than 84 hours | the health check raises a critical problem | find out why the job does not run |

:::guarantees
- The snapshot holds no secrets: the manifest is marked `secretsIncluded: false`, and a bundle will not be built without that mark.
- The private `age` key never reaches the server or the bucket.
- Decrypted files never stay on disk, on success or failure.
- A bundle is not overwritten and is not counted as uploaded until the bucket confirms its size and sum.
- The S3 access keys are not visible in the process list.
:::

:::code-map
- `integrations/hermes/scripts/kurami-state-backup.sh` — the three stages in a row and the `recovery.env` check
- `src/system/recovery/backup-state.ts` — the snapshot: `VACUUM INTO`, manifest, retention
- `src/system/recovery/recovery-bundle.ts` — building, encrypting and verifying the bundle
- `src/system/recovery/s3-recovery.ts` — upload, read-back and retention in S3
- `docs/recovery.md` — the restore order for the operator
- `src/orchestrator/health/runtime.ts` — the backup age check
:::
