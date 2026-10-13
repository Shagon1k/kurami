// The Digest run card in Discord: a fox progress bar with what Kurami is doing now, a grey card for a day
// without an edition, and colours by state.
import assert from "node:assert/strict";
import { progressBar, runCardMessage } from "../../src/briefing/release-notifier.ts";
import type { BriefingRunAttempt } from "../../src/briefing/run-attempt.ts";

const attempt = (state: BriefingRunAttempt["state"]): BriefingRunAttempt => ({
  attemptId: "a", editionId: "daily:2026-10-07", mode: "scheduled", state, runDirectory: "/tmp/x", inputDigest: null, outputDigest: null,
  errorCode: null, createdAt: "2026-10-07T04:00:00Z", updatedAt: "2026-10-07T04:10:00Z", completedAt: null, recoveryStartedAt: null, recoveryCompletedAt: null,
});
const card = (state: BriefingRunAttempt["state"]) => runCardMessage({ attempt: attempt(state), payload: null, timeZone: "Europe/Vilnius", baseUrl: "https://kurami.shagon1k.win" });

assert.equal(progressBar(4), "🦊▰▰▰▰▱▱▱▱▱▱ 4/10");
assert.equal(progressBar(0), "🦊▱▱▱▱▱▱▱▱▱▱ 0/10");
const drawing = card("editorialized").body.embeds[0]!;
assert.equal(drawing.description, "⏳ Рисую картинки…");
assert.equal(drawing.color, 0xd97706);
assert.deepEqual(drawing.fields, [{ name: "Прогресс", value: "🦊▰▰▰▰▰▱▱▱▱▱ 5/10", inline: false }]);
assert.equal(card("live-collected").body.embeds[0]!.description, "⏳ Листаю Telegram…");

const skipped = card("skipped");
assert.equal(skipped.state, "success", "a skipped day is final");
assert.equal(skipped.body.embeds[0]!.description, "💤 Сегодня без выпуска.");
assert.equal(skipped.body.embeds[0]!.color, 0x6b7280);
assert.deepEqual(skipped.body.embeds[0]!.fields, []);
assert.deepEqual(skipped.body.components, []);
console.log(JSON.stringify({ ok: true, runCard: "fox bar, live captions, skipped day, colours" }));

await import("./verify-preparation.ts");
