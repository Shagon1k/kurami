# Kurami human docs — content map and page prototypes

Status: working design record. Implementation now lives in `src/human-docs/`; deployment is not configured. Validate each page against the implementation when authoring it.

## What this site is for

The only initial reader is Alex. Within a minute, the home page should explain what Kurami is, which parts exist, and where to go next. The site is bilingual (`/en/` and `/ru/`) and always behind Cloudflare Access. The main control surface is Discord; Telegram is mentioned only briefly. Do not reproduce credentials, private contents, or exact infrastructure addresses merely because the site is access-gated.

**Working description:** Kurami is Alex's private agent system: it turns conversations and explicit decisions into bounded work, and makes the resulting state visible. Hermes provides the agent runtime; Kurami supplies product workflows and guardrails. Project Orchestrator is a distinct product within Kurami; Digest is another product surface. Avoid describing Kurami itself as a dashboard or equating it with either product.

**Home layout:** a short definition and a *system map*, not two equal hero buttons that imply Digest and Projects exhaust the system. Below the map, offer routes into **Understand**, **Digest**, **Project Orchestrator**, **Operations**, and **Changelog**. Each route says what question it answers. This leaves room for other capabilities without inventing a future roadmap.

## Information architecture

One route answers one question. The following is a content inventory, not a demand to write long pages: a small page may consist of a diagram and two sentences. Every route needs matching EN/RU titles and honest translation availability. No search in the first build.

| Area | Small page / question | Suggested visual | Evidence to verify when writing |
| --- | --- | --- | --- |
| Start | What is Kurami? | system map and labeled boundaries | `README.md`, runtime integrations |
| Start | What belongs to Kurami, Hermes, and Codex? | three-part boundary diagram | `README.md`, `docs/technical-reference.md` |
| Understand | How does work move through the system? | paths from intent to evidence | control flow and subsystem guides |
| Understand | What counts as current, stale, failed, or accepted? | compact state legend | each product's runtime code |
| Digest | What does Daily show? | screenshot crop + frozen/live split | `docs/daily-briefing-runtime.md` |
| Digest | How does an edition reach you? | lifecycle rail | attempt and publication code |
| Digest | What do Weekly and Cinema add? | two small comparison cards | Weekly/Cinema docs and code |
| Digest | What is Stocks, and what is Investment Review? | source → report boundary | `docs/stocks-addon.md`, Investment Review code |
| Digest | What does “For me” change? | before/after ordered list | `src/briefing/interest-profile.ts` |
| Projects | What is Project Orchestrator? | intent → run → PR → owner diagram | `README.md`, `docs/technical-reference.md` |
| Projects | How does a project become eligible? | readiness decision cards | `docs/project-readiness.md` |
| Projects | What happens during a run? | lifecycle rail with stop points | run controller, sessions, GitHub evidence |
| Projects | What are previews, CI and reviews? | three distinct evidence cards | preview/CI/review modules |
| Projects | How does Alex steer or stop work? | Discord controls + ownership boundary | Discord UI and controls |
| Operations | How does health monitoring report problems? | one persistent card, alert path | health code and config |
| Operations | What can be recovered, and what stays untouched? | recovery boundary diagram | `docs/recovery.md`, backup code |
| Operations | What runs on a schedule? | small schedule list, not a promise of uptime | current configured jobs and timers |
| Changelog | What changed, and when? | dated grouped entries | deployed commit range + curated copy |

Small pages should not be padded to fill a template. A page whose subject is only two sentences may link to a neighboring flow. Avoid copying the existing technical reference wholesale; it is an evidence source, not reader-facing copy.

## Page pattern: one screen first, details in place

1. **Answer:** a one- or two-sentence response to the page's question.
2. **Picture:** one purposeful visual (diagram, comparison, or screenshot), with a text alternative. On mobile, it must remain legible without horizontal panning as the only way to read it.
3. **What happens:** up to four labeled steps or a short state legend.
4. **Boundary / current limit:** one precise paragraph, if a limitation matters.
5. **Technical lens (optional):** an inline disclosure containing a small TypeScript-like pseudocode example or a narrowly relevant source link. This is on the same page, not an obligatory separate “deep dive” page. A tutorial or reference page may need another pattern; don't force every topic into these five slots.

Use the Kurami visual language, not Digest's whole page renderer. First share semantic color/typography/theme tokens and reusable primitives that are truly generic; keep news-specific components where they are. Test light/dark and mobile together. Prefer Excalidraw-authored static SVG with the editable source in the repo; no production editor dependency. Diagram text must have an accessible prose equivalent. Live screenshots require data review/redaction before they enter Git; fixtures are safer where real content is private.

## Prototype A — system map / home (copy + wireframe)

```text
Kurami — a private agent system for Alex
Conversations and explicit decisions become bounded work. You can see what ran,
what is waiting for you, and what the system will not do without your input.

[ Alex in Discord ] ──> [ Hermes: agent runtime ] ──┐
                                                     ├─> [ bounded Kurami workflows ]
[ schedules and sources ] ──> [ deterministic code ] ─┘         ├─ Digest: information and review
                                                                ├─ Project Orchestrator: engineering runs
                                                                └─ Operations: health and recovery
                                      [ separate states + evidence ] ──> [ visible results ]

Explore: Understand the system  |  Read Digest  |  Run projects  |  Operations
```

RU copy:

> **Курами — личная агентная система для Лёши.** Разговоры и явные решения превращаются в ограниченные по правилам действия. Ты видишь, что сделано, что ждёт тебя и что система не станет делать без твоего участия.

EN copy:

> **Kurami is Alex's private agent system.** Conversations and explicit decisions become bounded actions. You can see what ran, what is waiting for you, and what the system will not do without your input.

The map is intentionally conceptual: it must not imply that all actions require a model call, or that Digest and Project Orchestrator share the same state machine. If the wording “agent system” feels too broad, try “private agent workspace”; avoid “control plane” as the unexpanded first sentence, since it names an implementation role rather than the benefit to the reader.

## Prototype B — Project Orchestrator (single-page progressive disclosure)

**Question:** How does a project change become a managed engineering run?

RU copy:

> Project Orchestrator следит за явным изменением статуса задачи в GitHub Project. Перед запуском он проверяет совместимость проекта, свободные ресурсы и границы задачи. Принятая задача получает отдельную ветку и рабочую копию; Codex работает там, а ты управляешь ходом через Discord.

EN copy:

> Project Orchestrator observes an explicit status change in GitHub Project. Before starting work, it checks project readiness, capacity, and task boundaries. An admitted task gets its own branch and worktree. Codex works there; you steer the run through Discord.

Visual: `intent → admission → isolated run → PR evidence → owner decision → verified release`. Under each step, use at most one sentence and one state label. A failure arrow points to a visible blocked state, not directly to cleanup.

**Current limit:** Kurami does not merge PRs or deploy application code on its own. It preserves work if ownership or cleanup evidence is ambiguous.

Optional inline technical lens (pseudocode, **not** a real API):

```ts
if (!explicitProjectTransition || !readinessPasses || !capacityAvailable) {
  return visibleBlockedState;
}
const run = createIsolatedWorktree();
return observeEvidenceUntilOwnerDecision(run);
```

This page does not duplicate all project readiness checks or the full run-state table. Those have their own narrow pages. Use a source link only when the implementation detail helps Alex verify a claim.

## Prototype C — Daily snapshot (contrast layout)

**Question:** Why can mail and weather change while the news stays the same?

RU copy:

> Утренние новости фиксируются в выпуске: обновление страницы не перечитывает Telegram и не пересобирает сюжеты. Погода, календарь и непрочитанная почта могут обновляться отдельно. Если свежие данные недоступны, страница показывает последнее достоверное значение как устаревшее, а не придумывает новое.

EN copy:

> Morning news is frozen into the edition: reloading the page does not reread Telegram or rebuild stories. Weather, calendar, and unread mail can refresh separately. If a refresh fails, the page keeps the last known value and marks it stale rather than inventing a new one.

Visual: two columns, **Frozen in the edition** vs **Can refresh**. On mobile, stack them. Use one small `captured → validated → published` rail below, then a narrow note: a requested editorial correction can replace authored copy without changing story ownership, reactions, or the source batch. Do not expose provider bodies or private screenshot data.

## Changelog: proposed contract

Generate entries from the deployed Git commit range at build time, grouped by date and `New / Improved / Fixed / Operations`. Link each entry to its commit, and optionally to the related docs page. Do **not** publish every commit subject verbatim: conventional subjects are useful input, not guaranteed human copy. A small curated metadata file supplies bilingual summaries and optional affected routes for changes whose commit subjects are cryptic. Missing/unsafe summaries should fail the docs publication gate or be explicitly excluded with a recorded reason. The build must record its source commit so the page cannot claim changes that are committed but not deployed. No tags or version numbers required.

A feature change is not complete without a human-facing doc update and a changelog entry or explicit `no reader-visible change` classification. Rather than make the owner do a separate weekly docs chore, enforce this in change review/build for meaningful behavior changes; use periodic audit only to catch drift. Do not quietly rewrite docs by summarizing source with a model on each deploy.

## Decisions after prototype review

- "Private agent system" names the whole system; "control plane" can appear when explaining its technical role.
- Technical detail stays in an optional inline disclosure, never an obligatory second page.
- Operations remains a first-class route alongside Digest and Project Orchestrator.
- Accessible HTML cards and maps cover the initial flows; Excalidraw source files are reserved for diagrams that would genuinely benefit from illustration.

Implementation: the responsive HTML system map and 17 bilingual pages are in `src/human-docs/`; the changelog gate is implemented. The hostname already responds with a Cloudflare Access login redirect to anonymous requests, but the origin and authenticated route are not verified. See `docs/human-docs-operations.md`.
