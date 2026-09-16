# Daily Briefing add-on lifecycle

Weather, Calendar, Mail and News now have explicit module ownership. Cinema
keeps its existing weekly lifecycle. The shared shell, UI tokens, publishing
transactions, action receipts and five-day Daily retention stay common.

## Module boundaries

| Module | Owns | Update policy |
| --- | --- | --- |
| Weather | Open-Meteo collection, weather mapping, stale fallback, metric | Morning and hourly |
| Calendar | Configured calendar collection, local-date partitioning, event mapping, conflicts, item notes | Morning and hourly |
| Mail | Primary unread collection, classification mapping, selected-message archive executor, retained-page reconciliation | Morning, hourly and explicit page actions |
| News | Editorial draft interpretation, source ownership, stable story identities, source batches, snapshot and feed UI | Frozen morning snapshot |
| Cinema | Weekly providers, editorial composition, promotion, full page and teaser | Saturday, last successful snapshot |

Entry points are `src/briefing/addons/{mail,calendar,weather,news}.ts`.
Their domain implementations live in the corresponding subdirectories.
Shared provider adapters remain in `providers/`, deterministic visual components
in `ui/components/`, and transaction/receipt enforcement in `store.ts`.

`addons/registry.ts` owns ordered rendering slots, metrics, quality reporting,
and references to optional live lifecycles. `addons/live.ts` derives its
participants from that registry; News and Cinema have no hourly lifecycle.

A live lifecycle declares its ID, provider-result key, transport lane,
collection function and section update function. HTTP collection may overlap
MCP collection. MCP calls remain sequential within one lazily acquired
Composio read caller. Failures are captured independently, so one failed
collection cannot prevent another module from attempting its own source.
No model is invoked by live refresh.

## Data and compatibility

New built-in envelopes use version 2:

```text
addons.<id> = {
  version: 2,
  state,
  capturedAt,
  data: {
    section,
    sourceBatches? // News only
  }
}
```

The section contains actual normalized data, not the former empty manifest
placeholder. Each module has a typed `BuiltinAddonEnvelope<id>`.
Cinema retains its independently versioned contract.

For compatibility, schemaVersion 1/2 payloads still expose the root
`mail`, `calendar`, `weather`, `news` and `sourceBatches` fields.
Existing writers update those fields; `parseBriefingPayload` synchronizes
version-2 envelopes from that canonical compatibility view. Add-on-only inputs
can omit those root fields; the parser reconstructs them from the envelopes
and runs the same validation. Do not separately author two conflicting copies.
Unknown built-in envelope versions are rejected.

Existing version-1 empty manifests and payloads without any manifest remain
readable. They do not require a bulk database migration or regeneration.
A live update upgrades only its enabled live envelopes; it leaves the frozen
News envelope unchanged. The media-import invariant normalizes the duplicate
News view before comparing non-media content, so attaching images remains
compatible. Explicit editorial revisions still use the established guarded
revision command.

Removing root compatibility fields and introducing a new universal payload
schema are deferred. This migration provides module ownership without forcing
every existing CLI, media operation and retained edition to switch at once.

## Enable and disable

Use the existing booleans in `config/briefing.yaml`:

```yaml
sources:
  weather:
    enabled: true
  calendar:
    enabled: true
  mail:
    enabled: true
  news:
    enabled: true
```

Keep the existing provider settings next to these flags. The composer reads the
flags, omits disabled modules from the new edition manifest, and keeps the
remaining section layout deterministic. Omission in an existing manifest
continues to mean disabled for that edition.

The Poller collects a live source only if configuration enables it and at
least one retained edition includes it. Turning a source off pauses refresh
of its existing sections; it does not erase historical data or silently add
the section to editions that never had it. A disabled Mail module rejects
page actions for that edition. Global Mail disabling also disables the
server's production executor after service reload.

With News explicitly disabled, the existing capture operation writes and
validates an empty ledger without acquiring a Telegram client. Composition
accepts no stories, and publication still requires the persisted validation
receipt and matching empty commit plan. A validated empty acknowledgement
returns without a Telegram connection. Enabled News retains its existing
coverage and publication gates; disabling News cannot legitimize unaccounted
story inputs.

## Failure and mutation rules

- Unusable or partial live responses preserve the last good section as stale.
  Initial collection failures produce a failed section with no invented data.
- An unsuccessful refresh never invents `lastSuccessAt`. Section `fetchedAt`
  remains the time of its last accepted provider value; `capturedAt` records
  the envelope update attempt.
- Calendar and Mail remove item-bound notes only when the referenced item
  disappears. An empty note list is omitted to preserve the parser contract.
- Mail actions keep server-resolved IDs, bounded retries, durable receipts and
  optimistic publication locks. Successful actions reconcile all retained
  editions immediately through the Mail module.
- Hourly writes preserve News, its envelope, source batches, images, read
  state and reactions. The store checks the frozen-news digest.
- Editorial and HTML validation remain publication gates. Built-in renderer
  programming errors still propagate; provider failure isolation does not
  suppress those errors. Cinema keeps its existing isolated renderer policy.

## Verification

`npm run test:briefing-addons` checks legacy/native HTML equivalence, envelope-only
round trips, version rejection, disabled-source zero I/O, sequential MCP calls,
independent collection/normalization failure, stale values, vanished item notes,
Mail envelope reconciliation, frozen News and empty-ledger publication.

The existing runtime, editorial, media, provider, Poller, workflow, Mail UI and
Cinema suites continue to cover their established contracts. The editorial
media-import fixture also uses populated envelopes so duplicate data cannot
silently invalidate media-only updates.
