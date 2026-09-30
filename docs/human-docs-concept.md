# Kurami human docs — how to write them

The reader-facing site at `docs.shagon1k.win` (source `src/human-docs/`). This file is the writing and format
contract for every page, for people and for the weekly docs agent (`src/human-docs/automation/weekly-audit.md`
points here). Building, publishing and the changelog are in `docs/human-docs-operations.md`.

## Reader and goal

The reader is a **human middle engineer** who has never seen the code, and the owner. Agents read the repository
itself. The site is layered by depth, so a reader gets the gist fast and goes deeper only as far as needed:

| Layer (`group:`) | Budget | Purpose |
|---|---|---|
| home | 1 min | what Kurami is, one map, where to go |
| `start` | 5 min | one per section: the product as a whole — one diagram, one short story, cards deeper |
| `guide` | 3–5 min | what the owner sees and presses, what to do when something is wrong |
| `internals` | 10–15 min | "How it works": the mechanism, one worked example, states, failures, guarantees, code map |
| `decisions` | as needed | "Why it is so": short ADRs (Context / Decision / Why / Trade-off) |
| `reference` | as needed | exact tables; generated from code where possible |

Sections: `basics` (Overview), `digest`, `projects`, `platform`, `reference`. Navigation is derived from each
page's frontmatter (`section`, `group`, `order`); the side menu shows the current section grouped by depth.

## Page anatomy

**start** — :::glance, one diagram, a short :::steps story or ::::example, :::cards to deeper pages,
optionally :::guarantees, :::code-map. 400–800 words.

**guide** — starts from the owner's view; a table of buttons/states or :::steps; at most two screenshots;
links to the matching internals page. 250–700 words.

**internals** — in this order, adapted rather than padded:
1. First sentence: a definition with the system as subject.
2. :::glance — 4–6 lines: what it does, trigger, where/how often, state, owner-visible result.
3. Diagram #1: the whole mechanism in one picture.
4. `##` sections, each opening with its own claim, 80–250 words, explaining *why* once.
5. ::::example — one running example with realistic synthetic values, traced with the same ids.
6. What can go wrong — a table: situation | what Kurami does | what you do.
7. :::guarantees — the deliberate boundaries, once. The only place for "never".
8. :::code-map — 4–10 files.
800–1800 words, 1–3 diagrams of *different kinds*.

## Style

- Russian first, written as Russian; English is a natural translation with the same structure.
- «ты» / "you" for the owner's actions; the system as subject when describing mechanisms.
- Sentences of 10–20 words, one idea each; connected paragraphs of 2–5 sentences.
- Name the actor in every step. One term per concept everywhere; explain internal terms on first use.
  Russian vocabulary: run → «запуск», admission → «допуск», worktree → «рабочая копия (worktree)» on first use,
  edition → «выпуск», preview → «превью», controller → «контроллер».
- Code names in `monospace`, exactly as in code — but only where the reader needs them to find or recognise
  something; everything else belongs in the code map.
- **Caveat budget**: at most one caveat per page body; no hedging. Exceptions go into tables, "never" into
  :::guarantees.
- Concrete numbers, limits, times, state and button names. Tables for ≥3 attributes per item.
- Describe what the code does now. Unused configuration keys are not features; real gaps the owner will hit go
  factually into the failure table.
- Telegram in Digest is a news source (read through the owner's account by the Telegram MCP server); Discord is
  the only control and notification channel.

## Privacy

No personal names, no city or time-zone name («по местному времени» / "local time"), no Discord/chat IDs, IPs,
tokens, e-mail addresses or secret contents. Hostnames: only `docs.shagon1k.win` and `preview-N.shagon1k.win`.
Write `$KURAMI_HOME/…`, never home-directory paths. Worked examples use invented data. `tests/human-docs/verify.ts`
enforces part of this.

## Format

Pages are `src/human-docs/content/pages/<section>/<slug>.ru.md` and `.en.md` (home: `pages/home.*.md`), in the
docs Markdown subset parsed by `src/human-docs/markdown.ts`. No raw HTML.

```
---
title: Допуск
nav: Допуск                # optional short menu label
summary: One sentence under the title.
section: projects          # basics | digest | projects | platform | reference
group: internals           # start | guide | internals | decisions | reference
order: 20
next: controller           # optional
---
```

Body: `##`–`####` headings, paragraphs, `-`/`1.` lists (nest with two spaces), GFM tables, fenced code with an
optional `title="path"`. Inline: `code`, **bold**, *italic*, links `[text](@slug)`, `[text](@slug#heading-id)`,
`[text](repo:path)`, `[text](https://…)`.

| Block | Syntax |
|---|---|
| At a glance | `:::glance` + `- Key: value` |
| Steps | `:::steps` + `- **Actor** — text` |
| Worked example | `::::example Title` … `::::` (outer blocks use more colons) |
| Compare | `:::compare` + 2–3 `### Column` sections |
| Cards | `:::cards` + `- [Title](@slug) — one line` |
| Key terms | `:::terms` + `- **term** — definition` |
| Callouts | `:::note Title`, `:::warning Title`, `:::limit Title` — rare, never stacked |
| Details | `:::details Summary` |
| Guarantees | `:::guarantees` + list |
| Code map | `:::code-map` + `` - `path` — what it does `` (paths must exist) |
| Screenshot | `::shot{file="shot-x.png" size="card|wide" alt="…" caption="…"}` — guide pages only |
| Generated table | `::generated{name="orchestrator-states"}` — see `src/human-docs/reference.ts` |

The build checks that EN and RU have the same structure: the same number of `##`, the same diagrams (by node ids),
screenshots, generated tables and glance/guarantees/code-map blocks.

## Diagrams

A ```` ```diagram ```` block is drawn at build time by the diagram kit (`src/human-docs/diagrams/kit.ts`) into a
theme-aware SVG; the kit can also export an Excalidraw scene. Every diagram needs `desc:` (the text equivalent).
Max width 980 px (the build fails beyond it); aim for ≤ 760. ≤ 12 nodes, short labels, different kinds on one page.

- **graph** — `node id "Label" "sublabel" [kind] [at COL,ROW]`, `group id "Label" members… [boundary|band|highlight]`,
  `edge a -> b "label" [dashed|accent|muted]` (also `<->`, `--`). Kinds: `process`, `store`, `actor`, `owner`,
  `external`, `state`, `start`, `end`, `fail`, `wait`, `decision`, `entity` (sublabel `field · field`), `note`.
  Place nodes with `at` for anything over ~6 nodes; ≤ 4 columns.
- **sequence** — `actor id "Label" [owner|external]`, `msg a -> b "label" [style]`, `self a "action"`,
  `note a "text"`, `phase "Label"`.
- **timeline** — `lane id "Label"`, `span lane HH:MM-HH:MM "label" [accent]`, `at lane HH:MM "label" [accent]`,
  `every lane 60m "label" [from HH:MM]`, optional `range HH:MM-HH:MM`.

The legend of shapes is itself a page: `basics/how-to-read`.

## Checking a page

```
node src/human-docs/tools/check-pages.ts <slug…> --shots=/abs/dir [--width=390]
```

It validates syntax, parity, links, paths and diagram sizes, and saves full-page screenshots. Look at them.
Then `npm run test:docs` and `npm run docs:build`.

## Before publishing

Read the page as someone who has not seen the code. If a sentence only makes sense to someone who has, rewrite it
or move the detail into the code map. Every claim traces to code, a test or verified runtime state.
