---
title: How previews work
nav: Preview mechanics
summary: How Kurami leases one of six slots, builds the application from an exact commit, opens an address and removes it reliably.
section: projects
group: internals
order: 80
next: discord-control-plane
---

A preview is a temporary application built from a run's working copy, which Kurami publishes at one of six fixed addresses. A slot manager owns the slots, an adapter owns the build, a separate route writer owns the addresses, and the truth about all three lives in two SQLite tables.

:::glance
- What it does: builds the PR's exact commit and opens it at `preview-N.shagon1k.win`
- Who starts it: only you, with Start preview; the controller performs the steps
- Rhythm: one step per one-minute cycle — lease a slot, then build
- State: `preview_slots` (six slots) and `preview_leases` (slot leases)
- Where it runs: rootless Docker or a static folder, with Caddy on loopback in front
- What you see: a card stage, the Preview is ready event, the expiry and the review mark
:::

```diagram
kind: graph
title: From address to preview
desc: You request the address preview-N. A tunnel passes it to Caddy on loopback. Caddy reads routes written by a separate program from the lease table, and hands the request either to the slot's Compose stack or to a static folder.
node you "You" "browser" owner at 0,0
node tunnel "Tunnel" "outside entry" external at 1,0
node caddy "Caddy" "127.0.0.1:9180" at 2,0
node ingress "Route writer" "from the lease table" at 3,1
node leases "preview_leases" "slot leases" store at 3,2
node routes "routes.caddy" "routes" store at 3,0
node compose "Compose stack" "kurami-pvN-…" at 1,1
node static "Static folder" "build snapshot" at 2,1
group server "Kurami server" caddy ingress leases routes compose static
edge you -> tunnel "preview-N"
edge tunnel -> caddy
edge leases -> ingress "running"
edge ingress -> routes "writes"
edge routes -> caddy "import" dashed
edge caddy -> compose "frontend, MinIO"
edge caddy -> static "files"
```

## A pool of six slots

A slot is a pre-declared address plus a set of ports that Kurami leases to a run. Six slots live in the `preview_slots` table: slot N gets the address `preview-N.shagon1k.win`, a file address `assets-preview-N.shagon1k.win` and six loopback ports. The addresses are fixed because tunnel routes and Google OAuth return addresses are configured on them in advance.

| Port role | Formula | Slot 3 |
|---|---|---|
| Frontend | 4310N | 43103 |
| Backend | 4320N | 43203 |
| PostgreSQL | 4540N | 45403 |
| Redis | 4630N | 46303 |
| MinIO API | 4910N | 49103 |
| MinIO console | 4920N | 49203 |

The Compose adapter writes the allocated frontend and backend ports into `runtime.env` as `PREVIEW_FRONTEND_PORT` and `PREVIEW_BACKEND_PORT`. It also keeps `FRONTEND_PORT` and `BACKEND_PORT` for existing Compose consumers. Both pairs identify the same slot ports; the repository's Compose file still defines the container ports and loopback bindings.

A slot is held by a *lease* — a `preview_leases` row that ties the slot, the run and a state together. Partial unique indexes allow one active lease per slot, one per run and one per Compose project name. Double allocation is therefore impossible even if two processes race. At most six leases are active (`max_previews_global`) and at most two build at once (`max_preview_builds_global`). What this looks like for you is in [Previews](@previews).

## Two adapters

An adapter is the code that knows how to turn a working copy into a working address. The project picks it in `projects.yaml`, and once a slot is leased Kurami stores the choice on the lease, so a later configuration edit cannot make one adapter clean up another's resources.

| | Compose | Static |
|---|---|---|
| Fits | an application with a stack: database, MinIO, API | an already built site |
| What it does | `docker compose up --build -d` in project `kurami-pvN-…` | copies the `dist` folder into an immutable snapshot |
| What it checks | health paths of frontend, backend and MinIO, up to 180 s | `index.html` through Caddy, up to 30 s |
| Secrets | from the project's secrets file plus random per-run ones | none |
| Limits | 4 GiB RAM, 20 GiB disk, two builders | file and byte caps (5000 and 256 MiB by default) |

Static runs no build and no foreign code. It rejects hidden files, symbolic links, special files and paths escaping the folder, and it compares the snapshot's digest with the source: if files changed during the copy, the build fails.

## Build gates

A build starts only when every check passes, and each check guards against one specific problem. The controller runs them in order.

1. The run is live (`live`) and in state `running`, `remote_owned` or `parked_review`. Otherwise a preview would be built for a run that is already dying.
2. The run has an exact SHA from the CI snapshot (40–64 hex characters). Without one there is nothing to verify.
3. The working copy lies inside the project root, its path is canonical, `HEAD` equals that SHA and `git status` is empty, untracked files included. So the preview shows exactly the commit the reviewer will see.
4. Docker runs rootless, and at least 4096 MiB of memory and 20 GiB of disk are free.
5. All six of the slot's ports are free.
6. Fewer than two builds are running: the lease moves to `provisioning`.

If a check fails before step 6, the lease stays `leased`; a failure after step 6 moves it to `failed`. A startup-step error completes the `preview_start` request as `failed`: the controller does not restart it every minute. The lease retains ownership of the slot until supported preview removal.

**Stop preview** can replace an unclaimed `pending preview_start`, even after a slot has been allocated. In one transaction, the old request becomes `rejected` with reason `preview_start_superseded_by_stop` and a reference to the new stop request. Repeating Stop returns the same outstanding request. The controller removes the preview through normal `down`; the run, PR, branch and working copy are preserved.

Before allocation or startup, the controller atomically claims the request as `processing`. Stop cannot replace that request: the owner receives a refusal until the current step finishes. A previously planned but superseded start cannot execute either. If the controller crashes, a `processing` request stays protected; there is no automatic reset without proof that the external step ended. An accepted Stop is not proof of cleanup: completion requires an applied request and a released lease.

## Lease states

A lease lives a short linear life, and any failure lands in `failed` rather than in a dead end with no owner.

```diagram
kind: graph
title: Lease states
desc: A lease starts in leased, moves to provisioning during the build and becomes running after the health checks. On removal it goes through releasing to released. Any build or cleanup error moves it to failed, and the only way out is removing the preview.
direction: right
node leased "leased" "slot reserved" state at 0,0
node provisioning "provisioning" "build in progress" state at 1,0
node running "running" "address open, 24 h" state at 2,0
node releasing "releasing" "route removed" state at 2,1
node released "released" "slot free" end at 2,2
node failed "failed" "slot occupied" fail at 1,2
edge leased -> provisioning "claim, max 2"
edge provisioning -> running "health OK"
edge running -> releasing "removal or expiry"
edge releasing -> released "no containers"
edge provisioning -> failed "error" accent
edge releasing -> failed "leftovers" accent
edge failed -> releasing "Remove preview" dashed
```

`leased` means "the slot is yours, nothing is built". `provisioning` means "the build is running"; a lease enters it only while fewer than two builds are active. In `running` the address is open and `expires_at` holds the deadline. `released` is the only final state: the slot is free and the row stays as history. A slot in `failed` stays occupied until you press **Remove preview**. That way Kurami does not hand a known address to leftover containers.

## The Caddy route

A route is switched on last and switched off first. A separate program is the only writer of the `routes.caddy` file. It takes the leases in state `running` and draws a route pair for each: the application address goes to the frontend port, the file address to the MinIO port, and a static snapshot is served by `file_server`. Everything else gets a 404. Before replacing the file, Kurami validates the new configuration with `caddy validate`, swaps the file atomically and reloads Caddy. If the reload fails, the previous file is restored and reloaded again.

The order guards against two things. An address appears only after the lease became `running`, that is, after a healthy build. On removal the lease first moves to `releasing`, the route is dropped, and only then are the containers stopped: no foreign request can hit a half-dismantled application. Caddy listens only on `127.0.0.1:9180`, and public access is provided by an external tunnel.

## Lifetime and extension

The lifetime counts from the healthy build and is 24 hours by default (`preview_ttl_hours`; 6 to 72 in [settings](@settings)); build time is not part of it. Two hours before the end (`preview_expiry_warning_hours`) the card shows **Extend 24h**. An extension adds 24 hours to the current deadline and is recorded in `run_state_history`. You can extend before the deadline, not after. When the deadline passes, the controller plans `preview_expire` as its first step: the adapter runs `down` with the reason `preview_ttl_expired`, even if another request is waiting in the queue.

## Exact commit and the Done status

A preview counts as proof only for the commit it was built from. The lease stores `verified_head_sha`. When you press **Mark reviewed**, Kurami writes a review mark on the lease, and a "policy satisfied" mark on the run — only if the run has `preview_required` and `verified_head_sha` equals the current SHA from the CI snapshot.

Before the exact managed task PR is verified merged, a run gets the `preview_required` flag at admission, if the issue carried the `preview-required` label at that moment. When Done arrives later without a fresh mark, the controller does not complete the run. It sets `completion_requested_at` and shows the **Preview required** stage. A new commit in the PR immediately devalues an old mark: the SHAs differ, the card says "Outdated", and the preview must be rebuilt. When the evidence is current, the controller completes the run itself. A verified exact merge accepts the task and waives Preview without inventing technical evidence; guarded resource cleanup remains separate.

::::example PF-33: a preview for PR #41
Run `r_9f3a0c17d2b4`, branch `PF-33_watchlist-sharing`, PR #41, commit `4be1d9c`. The data is invented.
:::steps
- **You** — at 10:05 you press **Start preview**. The plugin queues a `preview_start` request and the card shows Preview queued.
- **Controller** — at 10:06 it leases slot 1: `preview-1.shagon1k.win`, ports 43101…, Compose project `kurami-pv1-3a0c17d2b4`.
- **Controller** — at 10:07 it checks `HEAD == 4be1d9c` and a clean `git status`, memory, disk and ports, and moves the lease to `provisioning`.
- **Compose adapter** — writes `runtime.env`, runs `docker compose up --build -d`, waits up to 180 s for health and sets `running`, expiry tomorrow 10:11, `verified_head_sha=4be1d9c`.
- **Route writer** — adds slot 1's route pair and reloads Caddy.
- **Discord** — the thread gets the **Preview is ready** event with a link, and the card shows "Not reviewed".
- **You** — at 10:20 you press **Mark reviewed**: the mark is recorded and `preview_required` is satisfied because the SHAs match.
- **You** — at 10:30 you move the issue to Done. The controller completes the run, `down` removes the route and then the containers, and the lease becomes `released`.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| No memory, disk or ports, all slots taken or two builders busy | slot allocation may retry; a startup-step error fails the Start request and retains any allocated lease | remove the preview, then request a new start when capacity is available |
| The PR has no SHA from CI, the working copy is dirty or `HEAD` differs | Start request `failed`; the lease stays `leased`, with no automatic startup retry | fix the source evidence, remove the preview, then request a new start |
| The build or health check failed | lease `failed`, Preview failed event, stage Needs attention | press Remove preview, fix the cause, start again |
| Caddy did not reload | the previous routes are restored; if that fails too, both errors are reported | fix the Caddy unit |
| The deadline passed | `down` with reason `preview_ttl_expired` | start again, or extend in the last two hours |
| A `state/previews/<run>` directory is left after removal | deletes nothing by itself | runs `reconcile-orphan-runtime` by hand |
| A Compose build is slow, up to 30 minutes | it runs inside the controller step, other projects skip their controller step meanwhile | wait |

:::guarantees
- Kurami never starts a preview by itself: every one begins with your button.
- A preview is built only from a clean working copy whose `HEAD` equals the commit CI checked.
- The route is removed before the containers, and a slot is freed only after no containers remain.
- A preview of an old commit does not count: the policy requires the current PR's SHA.
- Mark reviewed neither approves the merge nor extends the lifetime.
- Static runs no build and accepts no hidden files, symbolic links or paths escaping the folder.
:::

:::code-map
- `src/orchestrator/projects/previews/manager.ts` — slot lease, extension, review mark, lease release
- `src/orchestrator/projects/previews/runtime.ts` — adapter choice and the exact-SHA check
- `src/orchestrator/projects/previews/adapters/compose.ts` — building and removing a Compose stack
- `src/orchestrator/projects/previews/adapters/static.ts` — snapshot of a static folder
- `src/orchestrator/projects/previews/ingress.ts` — writing, validating and reloading Caddy routes
- `deploy/config/Caddyfile` — the root Caddy configuration that imports the routes
- `migrations/005_preview_slots.sql` — the slot and lease tables
:::
