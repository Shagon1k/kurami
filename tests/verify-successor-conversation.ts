import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { captureSuccessorConversation } from "../src/orchestrator/projects/sessions/successor-conversation.ts";
import { conversationRecords, lateChoices, writeConversation } from "./predecessor-conversation-fixture.ts";

const home = mkdtempSync(resolve(tmpdir(), "kurami-successor-conversation-"));
const codexHome = resolve(home, "codex");
const worktree = resolve(home, "worktree"), branch = "PF-62", runId = "run-pf62";
mkdirSync(resolve(codexHome, "sessions"), { recursive: true });
mkdirSync(worktree);
const statePath = resolve(codexHome, "state_5.sqlite");
const lineagePath = resolve(home, "orchestrator.db");
const state = new DatabaseSync(statePath);
state.exec("CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT, cwd TEXT, source TEXT)");
const writer = new DatabaseSync(lineagePath);
// Same selected migration columns, deliberately without uniqueness/check constraints
// so corrupt, legacy or unrelated durable mappings can be tested fail-closed.
writer.exec(`CREATE TABLE run_autonomous_successions (
  succession_id TEXT, run_id TEXT, request_id TEXT, succession_number INTEGER,
  predecessor_thread_id TEXT, successor_thread_id TEXT, worktree_path TEXT,
  branch_name TEXT, source_head_sha TEXT, succession_state TEXT)`);
const database = new DatabaseSync(lineagePath, { readOnly: true });
const sourcePath = (id: string) => resolve(codexHome, "sessions", `${id}.jsonl`);
function thread(id: string, text?: string): void {
  let records = conversationRecords(id, worktree);
  if (text !== undefined) {
    records = [records[0]!, records[1]!,
      { type: "response_item", payload: { type: "message", role: "user",
        content: [{ type: "input_text", text: "Continue the approved work." }],
        internal_chat_message_metadata_passthrough: { content_item_kinds: ["user.text"] } } },
      { type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer",
        content: [{ type: "output_text", text }] } },
      { type: "event_msg", payload: { type: "task_complete", turn_id: "turn-one" } }];
  }
  writeConversation(sourcePath(id), records);
  state.prepare("INSERT OR REPLACE INTO threads VALUES (?,?,?,'cli')").run(id, sourcePath(id), worktree);
}
function edge(predecessor: string, successor: string, number: number, run = runId): void {
  writer.prepare("INSERT INTO run_autonomous_successions VALUES (?,?,?,?,?,?,?,?,?,'parked')")
    .run(`succession-${number}`, run, `request-${number}`, number, predecessor, successor, worktree, branch, "abcdef123456");
}
function reset(): void {
  writer.exec("DELETE FROM run_autonomous_successions");
  state.exec("DELETE FROM threads");
  thread("original");
  thread("failed", "Failed successor report: implementation blocked. The old handoff omitted the Card choice.");
  edge("original", "failed", 1);
}
function snapshot(): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(path: string): void {
    for (const entry of readdirSync(path)) {
      const full = resolve(path, entry);
      if (statSync(full).isDirectory()) visit(full);
      else result[relative(home, full)] = readFileSync(full).toString("base64");
    }
  }
  visit(home);
  return result;
}
function noWrites<T>(action: () => T): T {
  const before = snapshot();
  try { return action(); }
  finally {
    assert.deepEqual(snapshot(), before, "capture/revalidation changed local files");
    assert.equal(database.prepare("SELECT total_changes() AS n").get()!.n, 0);
  }
}
const capture = (id = "failed") => captureSuccessorConversation(database, runId, id, worktree, branch, codexHome);
const refused = (pattern: RegExp, id = "failed") => noWrites(() => assert.throws(() => capture(id), pattern));

try {
  reset();
  const first = noWrites(() => capture());
  assert.deepEqual(first.evidence.conversations.map(item => item.threadId), ["original", "failed"]);
  assert.deepEqual(first.evidence.lineage.map(item => item.succession_number), [1]);
  const original = first.evidence.conversations[0]!;
  assert.deepEqual(original.messages.map(message => message.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(original.messages[2]!.text, lateChoices);
  assert(original.messages[0]!.sourceLine < original.messages[2]!.sourceLine);
  assert(first.evidence.conversations[1]!.messages[1]!.text.includes("Failed successor report"));
  assert(!JSON.stringify(first.evidence).includes("TOOL OUTPUT MUST NOT"));
  noWrites(() => first.assertUnchanged());
  // An unrelated neighboring run is not imported into this chain.
  thread("neighbor", "UNRELATED NEIGHBOR MUST NOT ENTER CONTEXT");
  edge("elsewhere", "neighbor", 99, "other-run");
  assert(!JSON.stringify(noWrites(() => capture()).evidence).includes("UNRELATED NEIGHBOR"));
  noWrites(() => first.assertUnchanged());

  // Multiple successive failures retain the complete original decisions oldest first.
  thread("failed-again", "A second failure, not a substitute for the owner decisions.");
  edge("failed", "failed-again", 2);
  const multiple = noWrites(() => capture("failed-again"));
  assert.deepEqual(multiple.evidence.conversations.map(item => item.threadId), ["original", "failed", "failed-again"]);
  assert.deepEqual(multiple.evidence.lineage.map(item => item.succession_number), [1, 2]);
  noWrites(() => multiple.assertUnchanged());

  // Every captured lineage identity, including deletion/root extension, is fenced.
  for (const sql of [
    "UPDATE run_autonomous_successions SET succession_id='replacement'",
    "UPDATE run_autonomous_successions SET request_id='replacement'",
    "UPDATE run_autonomous_successions SET source_head_sha='1234567'",
    "UPDATE run_autonomous_successions SET predecessor_thread_id='replacement'",
    "UPDATE run_autonomous_successions SET succession_number=2",
    "DELETE FROM run_autonomous_successions",
  ]) {
    reset(); const saved = capture(); writer.exec(sql);
    noWrites(() => assert.throws(() => saved.assertUnchanged(), /lineage changed/));
  }
  reset(); const rootExtended = capture(); edge("older", "original", 2);
  noWrites(() => assert.throws(() => rootExtended.assertUnchanged(), /succession identity|lineage changed/));
  for (const column of ["run_id", "worktree_path", "branch_name"]) {
    reset(); const saved = capture();
    writer.exec(`UPDATE run_autonomous_successions SET ${column}='unrelated'`);
    refused(/unrelated/);
    noWrites(() => assert.throws(() => saved.assertUnchanged(), /unrelated/));
  }
  for (const id of ["original", "failed"]) {
    reset(); const saved = capture();
    fs.appendFileSync(sourcePath(id), JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }) + "\n");
    noWrites(() => assert.throws(() => saved.assertUnchanged(), /source changed after capture/));
  }
  reset(); const remapped = capture();
  state.prepare("UPDATE threads SET cwd='/unrelated' WHERE id='original'").run();
  noWrites(() => assert.throws(() => remapped.assertUnchanged(), /unrelated/));

  // Missing ancestors never silently degrade to failed-current-only context.
  reset(); state.prepare("DELETE FROM threads WHERE id='original'").run(); refused(/mapping/);
  reset(); fs.unlinkSync(sourcePath("original")); refused(/missing|unreadable/);
  reset(); edge("other-original", "failed", 2); refused(/duplicate successor/);
  reset(); edge("other-original", "failed", 2, "other-run"); refused(/duplicate successor/);
  reset(); writer.exec("UPDATE run_autonomous_successions SET succession_number=0"); refused(/succession identity/);
  reset(); writer.exec("UPDATE run_autonomous_successions SET predecessor_thread_id=''"); refused(/succession identity/);
  reset(); edge("failed", "original", 1); refused(/succession identity|cyclic/);
  reset(); writer.exec("UPDATE run_autonomous_successions SET predecessor_thread_id='failed'"); refused(/cyclic/);
  reset(); thread("third"); edge("failed", "third", 2); edge("third", "original", 3); refused(/succession identity|cyclic/, "third");
  reset(); thread("third"); edge("failed", "third", 1); refused(/succession identity/, "third");
  reset(); thread("third"); edge("failed", "third", 2);
  writer.exec("UPDATE run_autonomous_successions SET request_id='same'"); refused(/duplicate succession or request/, "third");
  reset(); thread("third"); edge("failed", "third", 2);
  writer.exec("UPDATE run_autonomous_successions SET succession_id='same'"); refused(/duplicate succession or request/, "third");

  // A single original is valid; chains beyond 16 threads and combined context
  // beyond 128 KiB refuse, never truncate an earlier decision or latest report.
  reset(); writer.exec("DELETE FROM run_autonomous_successions");
  assert.equal(noWrites(() => capture("original")).evidence.conversations.length, 1);
  for (let i = 1; i <= 16; i++) {
    thread(`chain-${i}`, `Report ${i}`);
    edge(i === 1 ? "original" : `chain-${i - 1}`, `chain-${i}`, i);
  }
  assert.equal(noWrites(() => capture("chain-15")).evidence.conversations.length, 16);
  refused(/16 complete threads/, "chain-16");
  reset(); thread("original", "x".repeat(30 * 1024)); thread("failed", "y".repeat(30 * 1024));
  const sixtyKiB = noWrites(() => capture());
  assert.equal(sixtyKiB.evidence.conversations[0]!.messages[1]!.text.length, 30 * 1024);
  noWrites(() => sixtyKiB.assertUnchanged());
  reset(); thread("original", "x".repeat(46 * 1024)); thread("failed", "y".repeat(46 * 1024));
  thread("large-third", "z".repeat(46 * 1024)); edge("failed", "large-third", 2);
  refused(/128 KiB/, "large-third");

  // Default-home path also exercises the reused native fingerprint assertion.
  reset(); const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const native = noWrites(() => captureSuccessorConversation(database, runId, "failed", worktree, branch));
    noWrites(() => native.assertUnchanged());
    fs.appendFileSync(sourcePath("original"), JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }) + "\n");
    noWrites(() => assert.throws(() => native.assertUnchanged(), /source changed after capture/));
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
  }
  console.log("PASS successor conversation: complete oldest-first lineage, exact decisions/report provenance, mapping/cycle/bound/source fences, readonly capture and revalidation");
} finally {
  database.close(); writer.close(); state.close();
  rmSync(home, { recursive: true, force: true });
}
