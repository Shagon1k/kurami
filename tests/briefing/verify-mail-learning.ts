// Mail learning: archives count per sender address (never subjects), a rule is proposed after four archives
// and only once decided, an accepted rule overrides classification on refresh, a declined one stops the
// proposals, and a store without the migration means no rules rather than a failure.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { briefingPaths } from "../../src/briefing/paths.ts";
import { initializeBriefingStore, openBriefingDatabase } from "../../src/briefing/store.ts";
import { decideRule, loadSenderRules, recordArchived, ruleSuggestion, senderKey, senderRules } from "../../src/briefing/mail-learning.ts";
import { mailLifecycle } from "../../src/briefing/addons/mail/lifecycle.ts";

assert.equal(senderKey("News Bot <News@Example.COM>"), "news@example.com");
assert.equal(senderKey("plain@example.com"), "plain@example.com");
assert.equal(senderKey("No address here"), null);

const home = mkdtempSync(join(tmpdir(), "kurami-mail-learning-"));
try {
  const paths = briefingPaths({ ...process.env, KURAMI_HOME: home });
  assert.deepEqual(loadSenderRules(paths.databasePath), {}, "no store, no rules");
  await initializeBriefingStore(paths);
  const database = openBriefingDatabase(paths);
  try {
    recordArchived(database, ["News Bot <news@example.com>", "News Bot <news@example.com>", "Boss <boss@example.com>", "no address"]);
    assert.equal(ruleSuggestion(database), null, "two archives are not a pattern");
    recordArchived(database, ["news@example.com", "NEWS@example.com"]);
    assert.deepEqual(ruleSuggestion(database), { sender: "news@example.com", archived: 4 });
    assert.deepEqual(database.prepare("SELECT name FROM pragma_table_info('mail_sender_signals')").all().map(row => (row as { name: string }).name), ["sender", "archived", "updated_at"], "only the address is stored");

    decideRule(database, "news@example.com", "GENERAL");
    assert.equal(ruleSuggestion(database), null, "a decided sender is not proposed again");
    assert.deepEqual(senderRules(database), { "news@example.com": "GENERAL" });
    for (let index = 0; index < 4; index++) recordArchived(database, ["boss@example.com"]);
    decideRule(database, "boss@example.com", null);
    assert.equal(ruleSuggestion(database), null, "declined: no rule and no further proposals");
    assert.deepEqual(senderRules(database), { "news@example.com": "GENERAL" });
    assert.throws(() => decideRule(database, "news@example.com", "SPAM" as never));
  } finally { database.close(); }
  assert.deepEqual(loadSenderRules(paths.databasePath), { "news@example.com": "GENERAL" });

  // On refresh the owner's rule wins over the keyword class ("Action required" would be ACTION).
  const payload = { addons: { mail: { version: 2, state: "ready", capturedAt: "2026-10-07T05:00:00Z", data: { section: { state: "ready", items: [] } } } }, notes: [] } as never;
  const message = { id: "m1", providerItemId: "p1", threadId: "t1", title: "Action required: confirm", summary: "", sender: "News Bot <news@example.com>", receivedAt: "2026-10-07T04:00:00Z", classification: null };
  mailLifecycle.apply(payload, { gmail: { state: "ready", value: { unreadCount: 1, items: [message] }, fetchedAt: "2026-10-07T05:00:00Z", attempts: 1, issues: [] } } as never,
    { refreshedAt: "2026-10-07T05:00:00Z", senderRules: { "news@example.com": "GENERAL" } });
  assert.equal((payload as { addons: { mail: { data: { section: { items: { class: string }[] } } } } }).addons.mail.data.section.items[0]!.class, "GENERAL");
  console.log(JSON.stringify({ ok: true, mailLearning: "addresses only, proposal threshold, accepted and declined rules, rule wins on refresh" }));
} finally { rmSync(home, { recursive: true, force: true }); }
