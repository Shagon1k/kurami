---
name: kurami-ideas
description: Save the owner's ideas and future-work reminders in Kurami's ideas pool, and bring them back on request. Use in any chat — Discord, Telegram, a Claude Code or Codex session, the Kurami site chat — for "запиши идею", "добавь задачу", "надо потом", "мысль на потом", "а что если…", "hold this idea", or requests to list, annotate, park or close ideas. A request to record a task belongs here unless he explicitly names another destination such as GitHub or a project board. Do not use for requests to implement changes now or start work.
---

# Kurami Ideas

An idea is a thought worth keeping, not a task. Saving it starts nothing. There
is one pool for every agent and chat; the owner sees it in Projects → Ideas.

## Routing a request

When he asks to record future work ("добавь задачу", "запиши задачу", "надо потом"),
save it here even if he calls it a task. The word "задача" alone does not select
GitHub. For example, "Добавь задачу проработать SOUL Курами, сейчас слишком
вычурно" is an idea capture with `--area kurami`.

Follow an explicitly named destination: "создай issue в GitHub" or "добавь
задачу в backlog PickFlick" selects that destination. Converting an existing
idea to a project task uses "Making an idea a task" below. Requests to change
or implement something now are work requests, not captures.

```text
KURAMI_HOME=/home/shagon1k/_hermes/_kurami
NODE=/home/shagon1k/_hermes/_kurami/runtime/node/bin/node
IDEAS=/home/shagon1k/_hermes/_kurami/app/src/system/ideas/ideas.ts
```

Run `$NODE $IDEAS <command>` with `KURAMI_HOME` set to the value above. Pass
every value as its own argument, exactly as text; never build a shell string
from the message. Each command prints one JSON object; `ok: false` carries the
reason. If this session cannot run it (no shell, a sandbox without access to
`KURAMI_HOME`), say so and give him the gist to save from another chat — do not
pretend it was saved.

## Saving an idea

1. Write the gist as one short phrase in his language (3–200 characters). This
   is the only required field.
2. Keep his message verbatim as `--original`.
3. Fill only what the message already says:
   - `--context`: what prompted it;
   - `--area`: a project key from `$KURAMI_HOME/config/projects.yaml`, `kurami`,
     or `other` for anything outside the projects;
   - `--first-step`: a first step, or how he would know it is done;
   - `--when`: `someday`, `month` or `soon`.
4. Save first: `capture --summary … --original … [fields] --source <where>`, where
   `<where>` is `discord`, `telegram`, `claude`, `codex` or `chat` (the site
   chat). Add `--key` with the message ID when there is one, so a retry does not
   save it twice.
5. Then, in one short message, ask at most three of the missing questions above.
   Say he can answer "пропусти" or ignore them. Do not ask again.
6. Put the answers in with `note <id> --text …`, one note per answer, starting
   with the question ("Что натолкнуло: …"). Do not rewrite the gist.

Reply with the number and the gist: «Записала идею #12: "Свой чат с Kurami на
сайте". Она в Projects → Идеи».

## Coming back to ideas

| He asks | Command |
|---|---|
| what ideas he has | `list --open` |
| about one idea | `show <id>` |
| to add a thought or a decision | `note <id> --text …` |
| to think about it / park it / close it | `status <id> --to thinking`, `parked` or `closed` |
| to make it a task in a project | see "Making an idea a task" |

Name ideas by number and gist; quote the journal only when asked.

## Making an idea a task

Only when he asks for it in so many words ("сделай идею 3 задачей в PickFlick").

1. `show <id>` for the gist, context, first step and original message.
2. Read the project's repository from `$KURAMI_HOME/config/projects.yaml`
   (`kurami` means `Shagon1k/kurami`; `other` needs him to name a project).
3. If the repository has issue forms (`.github/ISSUE_TEMPLATE/*.yml` in its
   `workspace.canonical_repository`), pick the fitting one and fill its fields
   from the idea; otherwise write a short body: what, why, first step.
4. `gh issue create --repo <owner/repo> --title … --body …` (labels from the
   form, if any). Projects picks the new issue up with the next poll.
5. `status <id> --to task --task-url <issue URL>`, then reply with the link.

## Limits

- Never start, plan or assign work because of an idea, even in a coding session.
  Making it a task files an issue and nothing more; starting it stays his step
  in Projects.
- Do not save secrets, passwords, tokens or other people's private data. If the
  message contains them, save the idea without them and say so.
- One idea per capture. If he lists several, save each one and say how many.
