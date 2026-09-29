# Kurami human docs — content map and page prototypes

Status: design record and early prototypes, not the published copy. Implementation lives in `src/human-docs/`; publication and verification live in `docs/human-docs-operations.md`. Validate each page against implementation when authoring it.

## What this site is for

The initial audience is the system owner or an authorized operator. Within a minute, the home page should explain what Kurami is, which parts exist, and where to go next. The site is bilingual (`/en/` and `/ru/`) and always behind Cloudflare Access. The main control surface is Discord; Telegram is mentioned only briefly. Do not reproduce credentials, private contents, or exact infrastructure addresses merely because the site is access-gated.

**Working description:** Kurami is a private agent system: it turns conversations and explicit owner decisions into bounded work, and makes the resulting state visible. Hermes provides the agent runtime; Kurami supplies product workflows and guardrails. Project Orchestrator is a distinct product within Kurami; Digest is another product surface. Avoid describing Kurami itself as a dashboard or equating it with either product.

**Home layout:** a short definition and a *system map*, not two equal hero buttons that imply Digest and Projects exhaust the system. Below the map, offer routes into **Understand**, **Digest**, **Project Orchestrator**, **Operations**, and **Changelog**. Each route says what question it answers. This leaves room for other capabilities without inventing a future roadmap.

## Information architecture

One route has one clear subject. Questions can guide an explanation, but section names and navigation labels should be compact nouns rather than a wall of questions. The following is a content inventory, not a demand to write long pages: a small page may consist of a diagram and two sentences. Every route needs matching EN/RU titles and honest translation availability. No search in the first build.

| Area | Small page / question | Suggested visual | Evidence to verify when writing |
| --- | --- | --- | --- |
| Start | What is Kurami? | system map and labeled boundaries | `README.md`, runtime integrations |
| Start | What belongs to Kurami, Hermes, and Codex? | three-part boundary diagram | `README.md`, `docs/technical-reference.md` |
| Understand | How does work move through the system? | paths from intent to evidence | control flow and subsystem guides |
| Understand | What counts as current, stale, failed, or accepted? | compact state legend | each product's runtime code |
| Digest · Daily | What does an edition show, and which sections can refresh? | frozen/live split | `docs/daily-briefing-runtime.md`, add-on code |
| Digest · Daily | What does “For me” change in the news order? | before/after ordered list | `src/briefing/interest-profile.ts` |
| Digest · Daily | How does an edition reach you? | publication and recovery path | attempt and publication code |
| Digest · Weekly | What can seven completed dates support? | coverage and missing-data example | `docs/weekly-review.md` |
| Digest · Cinema | When can a new snapshot replace the page? | section-to-promotion decision | `docs/cinema-addon-v1.md` |
| Digest · Markets | How do you read a Stocks row or Discovery card? | dated price and candidate checks | `docs/stocks-addon.md`, Stocks code |
| Digest · Markets | When is Investment Review accepted? | draft-to-accepted boundary | `docs/investment-review.md`, Review code |
| Projects | What is Project Orchestrator? | intent → run → PR → owner diagram | `README.md`, `docs/technical-reference.md` |
| Projects | What does Projects Digest suggest? | factual ranking versus optional owner-reviewed metadata | `docs/technical-reference.md`, triage/metadata code |
| Projects | How does a project become eligible? | readiness decision cards | `docs/project-readiness.md` |
| Projects | What happens during a run? | lifecycle rail with stop points | run controller, sessions, GitHub evidence |
| Projects | What are previews, CI and reviews? | three distinct evidence cards | preview/CI/review modules |
| Projects | How does the owner steer or stop work? | Discord controls + ownership boundary | Discord UI and controls |
| Operations | How does health monitoring report problems? | one persistent card, alert path | health code and config |
| Operations | What can be recovered, and what stays untouched? | recovery boundary diagram | `docs/recovery.md`, backup code |
| Operations | What runs on a schedule? | small schedule list, not a promise of uptime | current configured jobs and timers |
| Operations | What does monthly maintenance remove? | narrow cleanup versus preserved resources | maintenance and Resource Guard code |
| Operations | Which connector can read or change provider data? | three authority contours | `docs/composio-capability-contours.md` |
| Operations | Where does automation stop? | per-workflow guard and owner decision | runtime and connector contracts |
| Changelog | What changed, and when? | dated grouped entries | deployed commit range + curated copy |

Small pages should not be padded to fill a template. A page whose subject is only two sentences may link to a neighboring flow. Avoid copying the existing technical reference wholesale; it is an evidence source, not reader-facing copy.

## Writing: explain, then bound

The first published copy read like a specification: every sentence was a separate invariant, limits came before the thing being limited, and internal terms appeared unexplained. The owner found it hard to follow. These rules replace the earlier "answer in one or two sentences" pattern. They apply to every page and to automated drafts (the weekly audit prompt points here).

**Voice.** Write to the owner as "you" / «ты». Use a calm, concrete, spoken register: short paragraphs of connected sentences, not lists of assertions. Russian and English are written separately; Russian must read as if it were written in Russian first (no calques such as «доказательство слияния», «сохраняемая попытка», «не служит источником истины»).

**Order inside a page.**

1. **Orientation (1–2 sentences):** what this page is about and why the reader would care.
2. **How it works, as a story:** follow one concrete case from start to finish ("You move an issue into the active status. Kurami notices…"). Name the actor at every step. Connect steps with "then", "because", "so", "if … then".
3. **Picture:** a diagram, comparison or screenshot that shows the same story, with the prose above as its text alternative.
4. **What can go wrong and what you do:** failure and stale paths, and the owner action for each.
5. **Limits:** what the system deliberately does not do, stated once, after the reader understands what it does. Prefer one positive sentence plus the exception to a chain of negations.
6. **Details (optional disclosure):** exact states, SHAs, stores and source links for readers who want to verify.
7. **Next:** one or two links to the natural following page.

A page may drop steps it does not need, but never starts with limits and never consists only of limits.

**Terms.** Explain every internal term the first time it appears on a page, in plain words, and link the glossary. Keep one name per concept across pages. Product names (Digest, Project Orchestrator, Hermes, Codex) stay in Latin in both languages; ordinary words are translated (a "run" is «запуск», "admission" is «допуск», "worktree" is «рабочая копия (worktree)» on first use).

**Negation budget.** At most one "not / never / does not" sentence per paragraph. If a boundary matters, say what happens instead ("Kurami stops and asks you" rather than "Kurami does not guess").

**Length.** Clarity beats brevity: a page may be three times longer than the old copy if every added sentence connects or explains. Cut repetition, not reasons. Stop when a first-time reader could retell the page.

**Accuracy.** Every claim still traces to code, a test, an internal reference or verified runtime state, and each page keeps its source links. Rewriting for readability never adds capabilities, schedules or promises.

**Check before publishing.** Read the page aloud in both languages. If a sentence only makes sense to someone who has read the code, rewrite it or move it into the details disclosure.

Use the Kurami visual language, not Digest's whole page renderer. First share semantic color/typography/theme tokens and reusable primitives that are truly generic; keep news-specific components where they are. Test light/dark and mobile together. Prefer Excalidraw-authored static SVG with the editable source in the repo; no production editor dependency. Diagram text must have an accessible prose equivalent. Live screenshots require data review/redaction before they enter Git; fixtures are safer where real content is private.

## Prototype A — system map / home (copy + wireframe)

```text
Kurami — a private agent system
Conversations and explicit owner decisions become bounded work. See what ran,
what awaits a decision, and what automation will not do alone.

[ Owner in Discord ] ──> [ Hermes: agent runtime ] ──┐
                                                     ├─> [ bounded Kurami workflows ]
[ schedules and sources ] ──> [ deterministic code ] ─┘         ├─ Digest: information and review
                                                                ├─ Project Orchestrator: engineering runs
                                                                └─ Operations: health and recovery
                                      [ separate states + evidence ] ──> [ visible results ]

Explore: Understand the system  |  Read Digest  |  Run projects  |  Operations
```

RU copy:

> **Курами — личная агентная система.** Разговоры и явные решения владельца превращаются в ограниченные по правилам действия. Видно, что сделано, где требуется решение и чего автоматика не делает сама.

EN copy:

> **Kurami is a private agent system.** Conversations and explicit owner decisions become bounded actions. See what ran, what awaits a decision, and what automation cannot do alone.

The map is intentionally conceptual: it must not imply that all actions require a model call, or that Digest and Project Orchestrator share the same state machine. If the wording “agent system” feels too broad, try “private agent workspace”; avoid “control plane” as the unexpanded first sentence, since it names an implementation role rather than the benefit to the reader.

## Prototype B — Project Orchestrator (single-page progressive disclosure)

**Question:** How does a project change become a managed engineering run?

RU copy:

> Project Orchestrator следит за явным изменением статуса задачи в GitHub Project. Перед запуском он проверяет совместимость проекта, свободные ресурсы и границы задачи. Принятая задача получает отдельную ветку и рабочую копию; Codex работает там, а владелец управляет ходом через Discord.

EN copy:

> Project Orchestrator observes an explicit status change in GitHub Project. Before starting work, it checks project readiness, capacity, and task boundaries. An admitted task gets its own branch and worktree. Codex works there; the owner steers the run through Discord.

Visual: `intent → admission → isolated run → PR evidence → owner decision → verified release`. Under each step, use at most one sentence and one state label. A failure arrow points to a visible blocked state, not directly to cleanup.

**Current limit:** Kurami does not merge PRs or deploy application code on its own. It preserves work if ownership or cleanup evidence is ambiguous.

The published page now uses a verified run-state disclosure rather than a synthetic API example. The conceptual path above remains a layout prototype.

This page does not duplicate all project readiness checks or the full run-state table. Those have their own narrow pages. Use a source link only when the implementation detail helps verify a claim.

## Prototype C — Daily snapshot (contrast layout)

**Question:** Why can mail and weather change while the news stays the same?

RU copy:

> Новости фиксируются в выпуске: обновление страницы не перечитывает Telegram и не пересобирает сюжеты. Погода, календарь и непрочитанная почта могут обновляться отдельно. Если свежие данные недоступны, страница показывает последнее достоверное значение как устаревшее, а не придумывает новое.

EN copy:

> News is frozen into the edition: reloading the page does not reread Telegram or rebuild stories. Weather, calendar, and unread mail can refresh separately. If a refresh fails, the page keeps the last known value and marks it stale rather than inventing a new one.

Visual: two columns, **Frozen in the edition** vs **Can refresh**. On mobile, stack them. Use one small `captured → validated → published` rail below, then a narrow note: a requested editorial correction can replace authored copy without changing story ownership, reactions, or the source batch. Do not expose provider bodies or private screenshot data.

## Changelog: proposed contract

Generate entries from the deployed Git commit range at build time, grouped by date and `New / Improved / Fixed / Operations`. Link each entry to its commit, and optionally to the related docs page. Do **not** publish every commit subject verbatim: conventional subjects are useful input, not guaranteed human copy. A small curated metadata file supplies bilingual summaries and optional affected routes for changes whose commit subjects are cryptic. Missing/unsafe summaries should fail the docs publication gate or be explicitly excluded with a recorded reason. The build must record its source commit so the page cannot claim changes that are committed but not deployed. No tags or version numbers required.

A feature change is not complete without a human-facing doc update and a changelog entry or explicit `no reader-visible change` classification. Rather than make the owner do a separate weekly docs chore, enforce this in change review/build for meaningful behavior changes; use periodic audit only to catch drift. Do not quietly rewrite docs by summarizing source with a model on each deploy.

## Decisions after prototype review

- "Private agent system" names the whole system; "control plane" can appear when explaining its technical role.
- Technical detail stays in an optional inline disclosure, never an obligatory second page.
- Operations remains a first-class route alongside Digest and Project Orchestrator.
- Accessible HTML cards and maps cover the initial flows; Excalidraw source files are reserved for diagrams that would genuinely benefit from illustration.

Implementation update: `main` contains 28 bilingual article routes, including the expanded Operations section and four editable bilingual Excalidraw scenes. These changes have not been promoted to the docs site; the published docs-only release remains the earlier 17-route artifact. Select authenticated routes were checked at earlier release checkpoints, not against this expanded source. The changelog gate remains deployment-revision-bound. See `docs/human-docs-operations.md`.
