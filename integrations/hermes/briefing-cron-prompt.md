Run the configured Kurami Daily Briefing using the attached
`kurami-daily-briefing` skill.

Start by obtaining today's date in Europe/Vilnius, then call the canonical
briefing CLI start-attempt with that daily edition ID and --mode scheduled.
The runtime's shouldRun flag is the ONLY time/duplicate gate. Do not implement
another local-hour check. Candidate UTC ticks cover both DST and the 10:00
local recovery window. If shouldRun is false, return exactly [SILENT].

Run source stages strictly in sequence: collect-live -> capture_daily_briefing_batch.
Wait for collect-live to finish successfully and receipt live-collected before
calling capture. Never parallelize these calls (including in a multi-tool batch).
On approved resume, reuse durable telegram-raw.json even if normalization was
interrupted; do not refetch or move its cutoff. A prerequisite or stage-race
error requires inspecting the persisted stage, not skipping stages or reopening
an attempt from the agent. Invalid retained raw fails closed.

When shouldRun is true, resume the returned attempt and run directory from
its persisted stage. Never recollect a frozen Telegram capture or rewrite
accepted editorial content. A draft rejected by rank-preview is not accepted:
in the recovery window, repair it against the same frozen source batch before
retrying validation. Author the draft from all source items; never generate it
with an ad-hoc script that copies/clips provider text or assigns topics by
keywords. If faithful editorial work cannot be completed, record failure
instead of publishing a templated draft. Follow the bilingual
`localeVersion: 2` contract: every Kurami-authored story,
note, and custom hero needs English copy alongside Russian. Source titles,
names, and quotations may stay in their original language. Follow the two-pass
notes procedure in the Daily skill: draft without notes, rank-preview,
grounded notes in
distinct ranked bands, then compose. Apply its editorial quality rules to
every captured item. On Saturday, complete the enabled Cinema gate before
Daily composition; record an isolated Cinema failure without blocking Daily.
Do not hand-author the derived presentation payload or invoke a separate UI skill.

Once the attempt is editorialized or further, call the configured Telegram
finish_daily_briefing operation with edition_id and attempt_id. It owns render,
all retained images, receipts, validation, bounded acknowledgement, publication
and the idempotent notifier. Do not orchestrate individual image chunks or
write manifests/commit receipts yourself. On recovery call the same operation;
successful work is reused. Do not replace it with unbounded provider tools.

Require ok:true from completion, then call the canonical briefing CLI
assert-complete --id <edition-id> --attempt <attempt-id>. A tool return, a
prepared preview, an empty response or [SILENT] is NOT evidence of publication.
On a failure before completion, record a failed attempt with a safe error code.
Keep a published attempt awaiting notification intact for notifier-only recovery.

Only after verified completion, an explicitly recorded failure, or shouldRun:false,
return [SILENT]. The runtime owns the one Discord status/release card and exact
/daily/<date> link; never send a second message or a normal cron wrapper.
