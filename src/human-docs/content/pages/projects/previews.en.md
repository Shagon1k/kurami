---
title: Previews
summary: A preview is a temporary running copy of a change at preview-N.shagon1k.win. You start it yourself, look at it and, when required, confirm it before completion.
section: projects
group: guide
order: 60
next: project-digest
---

A preview is the application built from a run's working copy (worktree), so you can click through the change before deciding to merge. Kurami starts a preview only when you press **Start preview**. Every preview gets one of six fixed addresses, `preview-1.shagon1k.win` … `preview-6.shagon1k.win`. Six previews can stand at once, and two can build at once; you can lower these limits in [Settings](@settings).

::shot{file="shot-run-preview-queued.png" size="card" alt="Run card PF-33 at Preview queued: a slot is allocated and publication is queued; CI failed, AI review running, preview not reviewed." caption="While the preview is queued there are no preview buttons. The Preview block shows the Compose runtime and Not reviewed; Policy shows it is required."}

## Starting and what you see

Press **Start preview** on the run card once the agent has finished, the PR is open and its exact head commit has been observed. Kurami replies "Start preview queued" and the card moves to the **Preview queued** stage. A slot is leased on the next minute, the build starts on the one after and usually takes a few minutes. When the preview passes its health checks, the thread gets a **Preview is ready** event with a link, and the card gets a Preview block with the address, a short SHA, the expiry and "Not reviewed".

The preview is built only from the exact commit currently in the PR: the working copy must be clean and its HEAD must equal the commit CI has checked. So press the button after the PR exists and CI has seen it.

There are two kinds of preview, and the project chooses, not you. **Compose** brings up the project's whole stack in Docker: TailorTales and PickFlick. **Static** serves an already built folder of files, which is how the third project works.

## Preview buttons

| Button | When it appears | What happens |
|---|---|---|
| **Start preview** | no preview exists, and the PR has an observed exact head commit | A slot is leased and the preview is built |
| **Mark reviewed** | the preview runs and is not marked yet | You confirm you looked at exactly this commit |
| **Extend 24h** | less than two hours are left | The lifetime grows by 24 hours |
| **Remove preview** | a preview exists in any state | The address goes off, containers and files are deleted, the slot is freed |

## Lifetime

By default a preview lives 24 hours from the moment it passes its health checks; the lifetime is set in [Settings](@settings). Two hours before the end the card warns "Preview expires soon" and shows **Extend 24h**. You can extend any time before it expires — after that Kurami removes the preview itself. Build time does not count toward the 24 hours.

## Required previews

Before the exact managed task PR is verified merged, if the issue carries the label `preview-required` when it moves to In progress, the run cannot complete without a preview. When you move the card to Done, Kurami does not complete the run; it shows the **Preview required** stage. Start a preview, look at it and press **Mark reviewed**. The mark counts only if the preview was built from the PR's current commit. If a new commit is pushed after it, the card shows "Outdated" and the preview must be rebuilt. A verified exact merge accepts the task and waives Preview without inventing technical evidence; guarded resource cleanup remains separate.

**Mark reviewed** is only your note. It does not approve the merge, extend the lifetime or stop the preview. You can press it once per preview.

## If the preview does not come up

| What you see | Cause | What to do |
|---|---|---|
| A long "Preview queued" | all slots are taken or two builds run, low memory or disk, the PR has no checked commit | wait, or press **Remove preview** |
| A **Preview failed** event, stage Needs attention | the build or health check failed | press **Remove preview**, fix the cause, start again |
| The preview is gone | 24 hours passed | start it again |

A slot whose preview failed stays occupied until you press **Remove preview**. That way Kurami does not hand a known address to leftover containers.

The mechanics of slots, builds and addresses are on [How previews work](@preview-internals).

:::cards
- [How previews work](@preview-internals) — slots, build, route and lease states
- [Controls in Discord](@owner-controls) — the run card and all its buttons
- [Commands and buttons](@commands) — the reference
:::
