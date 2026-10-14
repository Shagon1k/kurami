---
title: Projects Digest
summary: One card per project: how many issues sit where, which one to take next, and which empty Priority and Effort values the AI proposes to fill.
section: projects
group: guide
order: 70
next: event-intake
---

Projects Digest keeps one card per project in the private Digest channel. It answers "what should I take into work next". The card only advises: it does not move issues, set priorities by itself or start Codex. Moving an issue to In progress stays your decision.

::shot{file="shot-projects-digest.png" size="card" alt="Projects Digest card for PickFlick: a suggested issue with priority P1 and effort M, counts per column, applied metadata proposals and a Review sync result button." caption="The suggestion and its reason on top, board counts below, then the state of the metadata proposals and the buttons."}

## What the card suggests

The **Suggested next** block names one Backlog issue and explains the choice in one line: "Owner priority P1 · Effort M · Waiting 9 days · Ready to start". The choice follows fixed rules, with no AI. First it looks at the priority you set: the higher it is, the earlier the issue. Among issues of equal priority, the one with the better sum of two scores wins: a small Effort and its age (waiting counts up to 30 days). On a complete tie the lower issue number wins.

Only an issue that is ready to start can be picked: it is open, in Backlog, has a description, is not blocked by an open issue and has no active run. If none qualifies, the card says "No eligible backlog issue right now." Issues labelled `no-auto` stay visible in board totals but are excluded from suggestions and AI Priority/Effort assessment.

Below is a four-row table of counts: Open and Ready, Backlog and Active, Review and Blocked, Deferred and Done. **Open** means open issues except Done and Deferred. **Ready** means issues you could start right now.

The card refreshes once a day at 06:45 UTC and within a minute of a card moving on the board or metadata being written. The footer shows when the suggestion appeared and when the facts were last checked.

## Metadata proposals

The AI fills only empty fields. If a Backlog issue has no Priority or Effort, Kurami once a day collects such issues for the project and asks Codex, in read-only mode, to propose values: Priority is P1, P2 or P3, Effort ranges from XS to XL. The AI cannot propose P0. It does not guess dependencies and skips an issue when the evidence is thin, so no proposal appears.

At most 12 issues per project are assessed a day. You change the number in `/kurami settings` (0 turns the AI off).

A ready batch waits for you on the card: "Ready · N pending". You decide with the buttons.

| Button | What it does |
|---|---|
| **Review proposals** | Opens a list visible only to you: each proposal shows the issue, field, value and reason. You can exclude items, restore excluded ones and press Accept remaining |
| **Accept batch** | Accepts all remaining proposals. Nothing is written to GitHub yet |
| **Discuss batch** | Opens a thread to talk the batch over. The discussion changes nothing |
| **Skip batch** | Rejects the whole batch |
| **Review approved batch** / **Review sync result** | Shows the accepted batch or the write result |
| **Retry sync** | Appears after two failed write attempts and starts them again |

After **Accept batch** the card shows "Approved", and within a minute the guarded sync writes the values to the GitHub Project. For every field it reads the current value again. An empty field, or one that still holds a value Kurami wrote earlier, is updated. If you set a value by hand in the meantime, it stays and the proposal is marked as a conflict. The result shows on the card: "Applied", or "Partially applied" with the number of preserved values.

How the fact snapshot, the formula and the batches work is on [How Projects Digest picks the next issue](@planning-internals).

## What stays yours

Kurami does not overwrite values you set yourself, P0 included. It does not move or create issues. A run starts only when you move a card on the board — see [Board statuses](@board-statuses).

:::cards
- [How Projects Digest picks the next issue](@planning-internals) — formula, batches and the guarded write
- [Board statuses](@board-statuses) — what happens after a card moves
- [Settings](@settings) — the daily AI assessment limit
:::
