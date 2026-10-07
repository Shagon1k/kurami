---
name: kurami-ideas
description: Keep Alex's spontaneous ideas, plans and thoughts that are not (yet) a task in a durable pool, and bring them back on request. Use when he shares an idea in Discord or Telegram ("идея:", "запиши идею", "мысль на потом", "а что если…", "hold this idea"), asks what ideas he has, wants to add a thought to one, or wants to park or close one. Never use it to start work on an idea.
---

# Kurami Ideas

An idea is a thought worth keeping, not a task. Saving it starts nothing. The
pool lives in Kurami and is shown in Projects under the task table.

```text
KURAMI_HOME=/home/shagon1k/_hermes/_kurami
NODE=/home/shagon1k/_hermes/_kurami/runtime/node/bin/node
IDEAS=/home/shagon1k/_hermes/_kurami/app/src/system/ideas/ideas.ts
```

Run `$NODE $IDEAS <command>` with `KURAMI_HOME` set to the value above. Pass
every value as its own argument, exactly as text; never build a shell string
from the message. Each command prints one JSON object; `ok: false` carries the
reason.

## Saving an idea

1. Write the gist as one short phrase in Alex's language (3–200 characters).
   This is the only required field.
2. Keep his message verbatim as `--original`.
3. Fill what the message already says, and nothing more:
   - `--context`: what prompted it;
   - `--area`: a project key from `config/projects.yaml`, `kurami`, or `other`
     for anything outside the projects;
   - `--first-step`: a first step, or how he would know it is done;
   - `--when`: `someday`, `month` or `soon`.
4. Save first: `capture --summary … --original … [the fields above] --source discord`.
   Add `--key` with the message ID when you have one, so a retry does not save
   it twice.
5. Then, in one short message, ask at most three of the missing questions above.
   Say he can answer "пропусти" or ignore them. Never ask again in the same
   conversation.
6. Put the answers in with `note <id> --text …`, one note per answer, starting
   with the question ("Что натолкнуло: …"). Do not rewrite the gist.

Reply with the gist and the idea number, for example: «Записала идею #12:
"Свой чат с Kurami на сайте". Она в Projects → Идеи».

## Coming back to ideas

| He asks | Command |
|---|---|
| what ideas he has | `list --open` |
| about one idea | `show <id>` |
| to add a thought or a decision | `note <id> --text …` |
| to think about it / park it / close it | `status <id> --to thinking`, `parked` or `closed` |

Name ideas by number and gist; quote the journal only when asked.

## Limits

- Never start, plan or assign work because of an idea. Turning an idea into a
  task is Alex's explicit step: point him to Projects → Ideas → "Make it a task".
  `status --to task` needs the issue link and is only for recording a task he
  already created.
- Do not save secrets, passwords, tokens or other people's private data. If the
  message contains them, save the idea without them and say so.
- One idea per capture. If he lists several, save each one separately and say
  how many you saved.
