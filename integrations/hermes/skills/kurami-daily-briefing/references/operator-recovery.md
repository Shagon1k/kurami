# Daily Briefing operator recovery

Read this reference only for manual dry-run media staging, an explicitly
authorized recovery, or a published-copy correction. The scheduled agent calls
`finish_daily_briefing(edition_id, attempt_id)` and verifies `assert-complete`;
it never runs the low-level sequence below. Inspect the durable attempt and
receipts before taking any action. Do not move a Telegram cutoff, refetch a
frozen capture, or repeat a successful provider mutation.

## Dry-run media staging

After `render-preview` prepares a dry-run edition with retained images, take
the complete ordered image-only `{chat_id, message_id}` pairs from the
accepted payload. Call the configured `download_media_batch` operation in
consecutive chunks of at most 12. Retry only failed or missing pairs; retain
successful paths under the bounded media inbox. Do not inspect image bytes or
drop an expected image to make the preview appear complete.

Write a small JSON artifact in the attempt directory with a `results` array
containing each exact successful `chatId`, `messageId`, `status` (`downloaded`
or `reused`), and `path` returned by the connector. Use Hermes `write_file`,
not a shell-generated artifact. Then let the runtime derive and validate the
manifest against the prepared edition:

```text
$BRIEFING_NODE $BRIEFING_CLI build-media-manifest --id <edition-id> --downloads <download-receipts.json> --output <media-manifest.json>
$BRIEFING_NODE $BRIEFING_CLI import-media --manifest <media-manifest.json> --attempt <attempt-id>
```

If any retained pair lacks a successful receipt, stop with a visible media
diagnostic. A dry run never creates a Telegram commit plan, acknowledges
read state, finalizes a live edition, or sends a release notification.

## Exact-ID Telegram capture repair

When a trusted run artifact already owns exact `{chat_id, message_id}` pairs,
use the read-only `get_messages_exact_batch` operation described in
`provider-telegram-user.md`. Preserve request order and every `missing` or
`error` result. Do not rediscover known posts from unread state or make one
model-mediated context call per message. Preserve each canonical
`externalUrl` in the normalized item and owning story source.

If an authorized repair must construct replacement raw and normalized
artifacts, normalize the complete captured batch:

```text
python3 /home/shagon1k/_hermes/_core/skills/kurami-daily-briefing/scripts/normalize_telegram_albums.py --input <batch.json> --output <normalized-batch.json>
```

Then validate configured-channel coverage, captured unread counts, fetched
and normalized IDs, and complete album membership:

```text
$BRIEFING_NODE $BRIEFING_CLI validate-telegram-batch --config $CONFIG --raw <batch.json> --normalized <normalized-batch.json>
```

A validation error stops Telegram editorial work. Record incomplete coverage
as a partial or failed source; never treat a smaller hand-selected list as a
complete capture. The normalized artifact must preserve ordered
`allMediaMessageIds`, image-only `mediaMessageIds`, and diagnostic
`nonImageMediaMessageIds` for every captured `grouped_id`.

## Completion worker contract

These commands describe the worker's guarded sequence and are available for
operator diagnosis. They are not a second agent publication path. For a failed
technical tail, use
`$BRIEFING_NODE $BRIEFING_CLI resume-completion --id <edition-id> --attempt <attempt-id>`
only when that command accepts the attempt, then call the same completion tool.
Earlier editorial failures cannot be resumed through this command.

1. Prepare the final `schemaVersion: 2` payload and rendered page before any
   external mutation. Every captured Telegram input must have exactly one
   story owner or bounded exclusion. If preparation fails, retain the previous
   latest edition and do not mutate Telegram or Gmail.
2. Reconcile durable media chunk receipts. The runtime derives the manifest
   from the prepared payload and exact receipts:

   The worker uses `download_media_batch` in the existing Telegram stdio
   process. Its only briefing download root is
   `$KURAMI_HOME/state/briefing/media-inbox`; it does not inspect bytes with
   `open_photo`. It partitions complete ordered image-only pairs into
   consecutive chunks of at most 12, processes chunks sequentially, and
   retries only `failed` or `missing` pairs. An earlier successful pair is
   never redownloaded. A failed capability or path leaves visible media
   diagnostics, not a hotlinked substitute.

   ```text
   $BRIEFING_NODE $BRIEFING_CLI build-media-manifest --id <edition-id> --downloads <download-receipts.json> --output <media-manifest.json>
   ```

   Each expected image pair needs exactly one `downloaded` or `reused` path.
   Each imported asset must match a story source `mediaMessageIds` entry by
   `sourceKey` and `providerItemId`. Video and other non-image IDs remain
   diagnostic and are never downloaded or counted by this gate. A failed,
   missing, or duplicate image pair stops import and commit-plan creation.
   Media bytes are transport, not model input. The runtime accepts images up
   to 25 MiB each and 256 MiB per retained edition. These are transport
   limits, not permission to sample or drop an expected image.

   A manifest asset has the exact owning Telegram message ID:

   ```json
   {
     "sourcePath": "/bounded/media-inbox/file.jpg",
     "sourceKey": "telegram:configured-key",
     "providerItemId": "7915"
   }
   ```

   The guarded importer validates type, size, and provenance, moves accepted
   assets into the edition-owned cache, and rerenders the preview:

   ```text
   $BRIEFING_NODE $BRIEFING_CLI import-media --manifest <media-manifest.json> --attempt <attempt-id>
   ```
3. Persist validation against the final prepared edition using the unchanged
   raw and normalized artifacts:

   ```text
   $BRIEFING_NODE $BRIEFING_CLI validate-telegram-batch --config $CONFIG --raw <batch.json> --normalized <normalized-batch.json> --id <edition-id> --attempt <attempt-id>
   ```

   This binds artifact digests and coverage to the edition. A new preparation
   or media import invalidates the receipt before the first media filesystem
   change. The importer stages complete story directories before swapping
   them; a late copy failure leaves prior directories intact. Rerun persisted
   validation after a successful import or preparation.
4. Derive the only allowed acknowledgement plan:

   ```text
   $BRIEFING_NODE $BRIEFING_CLI telegram-commit-plan --id <edition-id> --attempt <attempt-id>
   ```

   Use its exact `sources` and `planDigest`. The worker invokes
   `mark_read_through_batch` once with `edition_id`, `attempt_id`,
   `plan_digest`, and only the planned sources mapped to
   `{"chat_id": chatId, "max_id": maxId}` (at most 64 entries). Never add,
   omit, refetch, or edit a cutoff, and never call unbounded `mark_as_read`.
5. Persist exact per-source results in a small receipts artifact:

   ```json
   {
     "editionId": "daily:YYYY-MM-DD",
     "planDigest": "64-character digest from the commit plan",
     "results": [
       {"sourceKey": "telegram:configured-key", "status": "committed"}
     ]
   }
   ```

   Preserve failures as `status: "failed"` with a safe `errorCode`, then run
   `$BRIEFING_NODE $BRIEFING_CLI finalize --id <edition-id> --receipts <receipts.json> --attempt <attempt-id>`.
   Finalize the same prepared edition and plan digest. After a crash, recover
   from persisted validation, plan, and commit receipts without reprocessing
   committed items.
6. A meaningful partial edition becomes latest with a visible quality warning.
   A total failure retains the previous latest edition. After finalization,
   the idempotent notifier updates the date's existing Discord run card:

   ```text
   $BRIEFING_NODE $BRIEFING_CLI notify-release --id <edition-id> --attempt <attempt-id>
   ```

   The card links to the configured base URL plus `/daily/<local-date>` and
   may add links for embedded add-ons. The scheduled Hermes job uses local
   delivery; it must not emit a second release message or cron wrapper.

Do not create separately addressable public revisions. A retry updates the
same daily edition only with missing-source results. For an explicitly
requested correction of published editorial copy, compose against the frozen
capture and run
`$BRIEFING_NODE $BRIEFING_CLI revise-published --id <edition-id> --payload <payload.json>`.
The command accepts only the same source batches, exclusions, story IDs, and
source ownership. It preserves media, read state, and reactions, and performs
no provider mutation or release notification.
