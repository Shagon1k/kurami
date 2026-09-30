---
title: Connector authority
nav: Connectors
summary: How Kurami limits what automation may do in Gmail, Calendar and other services: three access levels, two allowlists and the rules that code checks.
section: platform
group: internals
order: 50
next: automation-boundaries
---

A connector is an external set of tools through which an agent or a Kurami script reaches Gmail, Calendar, YouTube and other services. Kurami divides access not by task but by authority: there are three levels, and every operation must choose exactly one. That way background work physically cannot end up in a channel where writing is allowed.

:::glance
- Levels: `composio-read` (read only), `composio-automation` (one allowed action), `composio` (broad, for you)
- Two lists that must agree: the session policy in Composio and `tools.include` in Hermes
- Who calls: polls and Daily — `read`; the "Прочитать и архивировать" (Read and archive) button — `automation`; you in chat — `composio`
- Drift check: the `/kurami composio-check` command in Discord
- A fourth connector: Telegram MCP — the news source for Daily
- Secrets: separate `.env` directories with mode 0600, never in Git
:::

## Three levels

```diagram
kind: graph
title: Three Composio access levels
desc: Background reading goes through the read session with seven read tools. The only automatic action, archiving mail, goes through the automation session with one tool. The broad session is only for work at your request and requires approval for writes.
node ingest "Polls and Daily" "background reading" at 0,0
node mail "Digest button" "read and archive" at 1,0
node you "You in chat" owner at 2,0
node read "composio-read" "7 read tools" at 0,1
node auto "composio-automation" "1 write tool" at 1,1
node broad "composio" "broad" at 2,1
node hermes "Hermes" "second list, trust" at 1,2
node composio "Composio" "sessions and accounts" external at 1,3
group kurami "Kurami" ingest mail
edge ingest -> read
edge mail -> auto
edge you -> broad
edge read -> hermes
edge auto -> hermes
edge broad -> hermes
edge hermes -> composio "MCP"
```

| Level | Who calls | Side effects | Hermes trust |
|---|---|---|---|
| `composio-read` | polls, Daily, trial checks | none: only tools marked `readOnlyHint` | `untrusted` |
| `composio-automation` | the read-and-archive button in Digest | only `GMAIL_BATCH_MODIFY_MESSAGES` | `full` |
| `composio` | you, in interactive work | broad; a write requires approval | `untrusted` |

The `composio-read` tools: `GMAIL_FETCH_EMAILS`, `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID`, `GOOGLECALENDAR_EVENTS_LIST` and four YouTube tools. In the broad session Hermes sees only three service tools: search, schemas and multi-execute.

## Two lists must agree

Access is limited twice, and the two limits are independent. The first is the session policy that Composio reads: which tools are enabled, which tags are forbidden (`destructiveHint` is forbidden everywhere), whether connection management and the workbench are off. The second is the `tools.include` list in Hermes's configuration, written by the `install-hermes-*` command. If someone adds a write tool on one side, the other list will not let it through.

`full` trust on the automation session is safe only because the list consists of one exact tool: the decision to allow was made once, when the list was reviewed, not at every call. A new automatic action is a change to the YAML policy file, the Hermes list, the authority document and the tests, and all of that goes through review.

## Code checks the argument rules

The `GMAIL_BATCH_MODIFY_MESSAGES` tool can both add and remove any labels, and the hosted Composio MCP does not apply argument restrictions. So the narrow rule is held by the workflow code, not by Composio. Before the call it must make sure that:

- `userId` is `me` and there are 1 to 1000 message identifiers;
- `addLabelIds` is empty or unset;
- `removeLabelIds` is a non-empty subset of `INBOX` and `UNREAD`;
- the identifiers come from a stored read result, not from the text of a message or a model answer.

So the "Прочитать и архивировать" button removes the `UNREAD` and `INBOX` labels but cannot delete a message, send a reply or add a label. If a check on the tool side is ever needed, it takes a local adapter with a fixed operation.

## Reconciling: `/kurami composio-check`

The command shows all three levels at once and compares each live session with the desired state from `deploy/config/connectors/`. You pick a level in the "Choose capability contour…" list. The "Apply <level> changes" button appears only for the selected level that has drifted, and is bound to the session version, the tool list and the shown difference: if something changes between showing and pressing, it refuses. Creating a session and installing configuration into Hermes are deployment operations through the `bin/kurami-composio-session` CLI; they are unavailable from Discord.

## Telegram as the fourth connector

Digest's news is read from Telegram channels through your account. For this Hermes connects a separate MCP server, `telegram`, with 15 tools and full trust; Kurami's wrapper adds the collection and completion tools for Daily. The point is not breadth of access but that this server has no levels: it reads the named channels, downloads images and marks them read. A channel becomes read only after the edition is published and only up to a saved boundary: if publication fails, nothing is marked.

::::example The "Прочитать и архивировать" button in Digest (invented data)
:::steps
- **Digest poll** — at 07:37 gets 12 unread messages through `composio-read` and records their identifiers in the database.
- **You** — pick three messages on the page and press the archive button.
- **Digest code** — takes the identifiers from the database and builds the call: `userId=me`, `removeLabelIds=[INBOX, UNREAD]`, `addLabelIds` empty.
- **Digest code** — checks the rules above. If the request has anything else, the call is not made.
- **Hermes** — passes the call to `composio-automation`, where one tool is allowed, and Composio removes two labels from three messages.
- **Digest** — saves the action receipt and updates the page.
:::
::::

## What can go wrong

| Situation | What Kurami does | What you do |
|---|---|---|
| A session drifted from the YAML | `/kurami composio-check` shows the difference | review it and press Apply |
| The tool is not in the Hermes list | the call is rejected | add it through review; background code will not switch to the broad session |
| Call arguments break the rules | the workflow does not call the tool | nothing; the error stays in the log |
| Composio is unavailable | Digest marks the block stale and goes on | wait or check the session |

:::guarantees
- Background work does not use the broad session under any failure.
- `composio-read` has not a single write tool.
- Automation can only remove the `INBOX` and `UNREAD` labels.
- Message identifiers come from a stored read, not from text.
- Keys, session addresses and account identifiers are not stored in Git.
:::

:::code-map
- `docs/composio-capability-contours.md` — the contract of the levels
- `deploy/config/connectors/` — the policies of the three sessions
- `src/connectors/composio/session-sync.ts` — session reconciling and applying
- `src/connectors/composio/hermes-install.ts` — the tool lists in Hermes
- `bin/kurami-composio-session` — the reconcile and install CLI
- `integrations/hermes/connectors/telegram_stdio_wrapper.py` — the Telegram MCP wrapper
:::
