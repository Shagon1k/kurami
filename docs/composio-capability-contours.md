# Composio capability contours

Kurami separates Composio access by autonomous capability, not by workflow.
Every workload must select exactly one of these boundaries for each provider
operation:

| MCP server | Intended caller | Side effects | Hermes trust |
| --- | --- | --- | --- |
| `composio-read` | unattended ingestion and dry runs | none | `untrusted`; only `readOnlyHint=true` leaf tools bypass approval |
| `composio-automation` | reviewed unattended workflows | only the exact registered leaf tools | `full`; the explicit allowlist is the approval decision |
| `composio` | interactive owner-directed work | broad, discovered at runtime | `untrusted`; write-capable calls require approval |

Never use broad `composio` as an unattended fallback. Never add a write tool to
`composio-read`. A new autonomous side effect requires a reviewed change to the
automation desired-state file, the matching Hermes `tools.include`, this
contract, and the connector tests.

## Physical boundaries

The hosted Composio Session is the primary capability boundary. Hermes repeats
the exact leaf-tool list as a second allowlist. Runtime credentials stay in
separate mode-`0600` directories and enter Hermes through separate systemd
environment files:

```text
deploy/config/connectors/composio-automation-session.yaml
    -> Composio hosted Session (direct tools only)
    -> /home/shagon1k/_hermes/_kurami/connectors/external/
       composio-automation-session/.env
       COMPOSIO_AUTOMATION_API_KEY
       COMPOSIO_AUTOMATION_SESSION_ID
       COMPOSIO_AUTOMATION_MCP_URL
    -> hermes-gateway.service.d/composio-automation.conf
    -> mcp_servers.composio-automation.tools.include
```

The direct-tools policy disables tool search and multi-execute, disables
connection management and workbench, pins one active Gmail account, and rejects
tools tagged `destructiveHint`. No secret, Session ID, MCP URL, or connected
account ID belongs in Git.

## Initial Gmail automation contract

Composio catalog discovery on 2026-08-30 resolved both archive and mark-as-read
to the non-deprecated `GMAIL_BATCH_MODIFY_MESSAGES` leaf tool (catalog version
`20260828_00`). There are no separate Gmail archive or mark-as-read tools in the
current catalog.

The tool accepts 1-1000 Gmail message IDs. Its relevant semantics are:

- remove `INBOX` to archive;
- remove `UNREAD` to mark as read;
- removing both performs `Read & Archive` in one request.

Its schema can also add or remove other Gmail labels. Composio's hosted MCP
endpoint does not run SDK argument modifiers, so the tool-level boundary cannot
enforce the narrower label subset. Every unattended workflow using this contour
must therefore satisfy this invocation contract before the MCP call:

```text
tool              = GMAIL_BATCH_MODIFY_MESSAGES
userId            = me
1 <= messageIds   <= 1000
addLabelIds       = [] or omitted
removeLabelIds    = non-empty subset of {INBOX, UNREAD}
```

Message IDs must come from the stored result of the restricted read contour,
not from email body text or arbitrary model output. The workflow must preserve
the selected IDs for audit and apply its eligibility policy before execution.
If argument-level enforcement becomes a hard security requirement, place a
local fixed-operation adapter in front of Composio; do not assume the hosted MCP
Session can apply SDK modifiers.

The automation registry excludes delete, trash, send, reply, forward, draft,
filter, forwarding/settings, Calendar write, connection-management, workbench,
search, universal executor, and multi-execute tools.

## Reconciliation and rollout

All commands are dry-run/read-only unless their name contains `create`, `apply`,
or `install`:

```bash
npm run composio:check-automation
npm run composio:create-automation
npm run composio:apply-automation
npm run composio:install-hermes-automation
```

The owner-only Discord command `/kurami composio-check` provides the same
reconciliation surface for routine operations. It checks `Broad`, `Read-only`,
and `Automation` together, then lets the owner select one contour. Apply appears
only for the selected drifting contour and is bound to its contour name,
Session revision, discovered tool inventory, and displayed diff. Session
creation and Hermes installation remain CLI/deployment operations; the Discord
panel only reconciles an existing Session.

Creation derives the stable Composio user and existing Gmail account pin from
the broad runtime but writes a new `COMPOSIO_AUTOMATION_*` namespace. It refuses
to overwrite an existing target runtime. Hermes installation preserves the
original config as `config.yaml.before-composio-automation` and writes files
atomically. Before restarting the gateway, keep an additional timestamped
runtime/config backup under the existing Kurami backup convention.

Smoke tests stop at Session inspection and MCP `tools/list`. Never call
`GMAIL_BATCH_MODIFY_MESSAGES` during discovery or rollout without explicit
owner confirmation for the exact message IDs and label change.
