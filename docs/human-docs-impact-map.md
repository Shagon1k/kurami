# Human-docs change impact

Use this map when a PR or direct commit changes Kurami behavior, an owner control or an operational boundary. It points to the human-docs section to review; it does not claim that a source commit is deployed. The PR gate in `tests/human-docs/impact.ts` checks changed paths and the PR-body declaration only when a PR exists. A human still has to decide whether the text and diagrams match the change.

| Changed area | Review these human-docs sources | Questions to check |
| --- | --- | --- |
| `src/briefing/`, Daily Hermes skill, briefing cron sync/config | `src/human-docs/content/digest.ts` | Did the reader path, freshness, failure isolation, acceptance or schedule boundary change? |
| `src/orchestrator/`, `src/discord/`, Discord controls plugin | `src/human-docs/content/projects.ts` | Did admission, run ownership, evidence or an owner decision change? |
| `src/connectors/`, `src/system/`, other deployment and workflow scripts | `src/human-docs/content/operations.ts` | Did authority, health, scheduling, recovery or cleanup change? |
| `src/core/` | `src/human-docs/content/start.ts` or `understand.ts` | Did the system boundary or source of truth change? |
| Other shared/product code, package scripts | Relevant `src/human-docs/` source | Which visible or operator-facing contract changed? |

For a reader- or operator-visible change, update each affected section and add these lines to the PR body:

```text
Docs-Impact: updated
Changelog-EN: <short, reviewed English description>
Changelog-RU: <short, reviewed Russian description>
```

A PR that touches UI rendering (`src/ui-library/`, `src/briefing/ui/`, renderer, style or component modules, or the UI-language skill) also declares how it used the shared UI library, checked by the same gate:

```text
UI-Library: used | extended | exception
UI-Reason: <required for exception: why no library part fits, and whether it should be promoted later>
```

`extended` must change `src/ui-library/`. If the frozen UI-guard exceptions in `tests/ui-library/guard-baseline.json` grew, only `exception` is accepted. See `AGENTS.md`.

For a change with no intended reader-visible effect, state the specific reason:

```text
Docs-Impact: none
Docs-Reason: <what moved or changed, and why the documented behavior is unchanged>
```

The gate ignores human-docs-only paths, the regression workflow that hosts this check, and `package.json` changes limited to docs-specific scripts. For product changes, it rejects missing declarations, missing affected-section edits for `updated`, and missing bilingual summaries. It cannot prove that a `none` claim is true, that the copy is accurate, or that the code reached production. Reviewers must check those claims. After Git assigns the final commit SHA, add the reviewed EN/RU summary—or a specific no-reader-visible-change classification—to `src/human-docs/changelog.json`. A contentless merge is skipped only when its tree matches a parent; a merge with its own changes still needs classification.

For direct commits, use the same map and classify the final SHA without inventing a PR declaration. The installed weekly Hermes audit checks for missed source and documentation changes and reports to `#updates`; it cannot replace factual review or publish changes. Its first scheduled Discord delivery remains unverified. An app-bound changelog build still needs a successful application revision from a trusted deployment controller. Until that exists, publish docs-only with `revision: null` and an empty app changelog. A docs push, merged PR or audit report is not a deploy signal. Docs promotion remains a separate, owner-controlled release step with its own smoke and rollback checks.
