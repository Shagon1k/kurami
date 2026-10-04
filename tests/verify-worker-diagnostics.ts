import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { protocolRepository } from "./fixtures/protocol-repository.ts";
import { recordTurnCompleted } from "../src/orchestrator/integrations/codex/task-store.ts";
import { completedWorkerSummary, sanitizeWorkerSummary, technicalWorkerDiagnostic, workerDiagnosticText } from "../src/orchestrator/integrations/codex/worker-diagnostic.ts";
import { reconcileCiRepairAttempts } from "../src/orchestrator/runtime/reconcile-ci-repair.ts";
import { runControlStatus } from "../src/orchestrator/controls/run.ts";
import { threadControlPayload, controlComponents } from "../src/orchestrator/controls/discord.ts";
import { collectProjectsSnapshot } from "../src/projects-site/snapshot.ts";
import { repairPrompt, initialPrompt, reviewFixPrompt } from "../src/orchestrator/projects/sessions/prompts.ts";

const run = { repository: "Fixture/Repo", issue_number: 1, issue_url: null, run_id: "run" };
const prompt = repairPrompt(run, { attemptNumber: 1, sourceHeadSha: "source-head", sourceCiState: "failed", sourceChecks: [{ name: "braces audit high", state: "failed", detailsUrl: null }], pullRequestUrl: "https://github.com/Fixture/Repo/pull/1" });
for (const phrase of ["Exact failed CI evidence", "minimal compatible published upstream security fix", "compatible override", "Verify the published fixed version", "no compatible published upstream fix exists", "explicit developer approval for focused commits", "same branch"])
  assert.ok(prompt.includes(phrase), phrase);
for (const phrase of ["major-version upgrades", "custom patches or forks", "advisory exceptions or suppression", "audit-policy changes or weakened checks", "schema/data migration", "security-boundary changes", "secrets", "permissions", "changed PR head", "unrelated dependency upgrades", "broad lockfile refreshes"])
  assert.ok(prompt.includes(phrase), phrase);
assert.ok(!prompt.includes("evidence points to dependency upgrades"));
assert.ok(!initialPrompt({ ...run, interaction_policy: "human_control" }).includes("explicit developer approval for focused commits"));
assert.ok(initialPrompt({ ...run, interaction_policy: "autonomous" }).includes("explicit developer approval for focused commits"));
const review = reviewFixPrompt(run, { requestId: "q", roundId: "f", roundNumber: 1, sourceHeadSha: "source-head", pullRequestNumber: 1, pullRequestUrl: "pr", threads: [], summaryOnlyFindings: [] });
assert.ok(review.includes("speculative improvements, dependency upgrades"));
assert.ok(!review.includes("published upstream security fix"));

const final = (text: string) => ({ type: "agentMessage", phase: "final_answer", text });
for (const items of [null, [{ type: "userMessage", text: "instructions" }], [{ type: "commandExecution", stdout: "error" }], [{ type: "agentMessage", phase: "commentary", text: "progress" }], [{ type: "agentMessage", text: "ambiguous phase" }], [{ type: "agentMessage", phase: "final", text: "not the installed protocol phase" }]])
  assert.equal(completedWorkerSummary(items), null);
assert.equal(sanitizeWorkerSummary(prompt), null, "full prompt echo is refused even in final channel");
for (const scheme of ["postgres", "postgresql", "redis", "rediss", "mongodb+srv", "amqp", "https"]) {
  const summary = sanitizeWorkerSummary(`Connection failed: DATABASE_URL=${scheme}://synthetic-user:fixture-sensitive-value@host.invalid/db`)!;
  assert.ok(!summary.includes("fixture-sensitive-value"), scheme);
  assert.ok(!summary.includes("synthetic-user"), scheme);
}
const secret = `github_pat_${"Z".repeat(40)}`;
const safe = sanitizeWorkerSummary(`No fix. ${secret} GH_TOKEN=abc123 api_key="short" sk-${"x".repeat(30)} Bearer abcd https://user:password@example.invalid/?token=secret <@123> @everyone \u001b[31m \u202e ${"x".repeat(1000)}`)!;
assert.ok(safe.length <= 800);
for (const forbidden of [secret, "abc123", "short", "abcd", "password", "@", "<", "\u001b", "\u202e", "https://"]) assert.ok(!safe.includes(forbidden), forbidden);
assert.equal(sanitizeWorkerSummary(" \u0000 "), null);
assert.ok(!sanitizeWorkerSummary("x".repeat(790) + " " + secret)?.includes("github_pat"), "redact before boundary truncation");
assert.ok(!sanitizeWorkerSummary("-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----")?.includes("private-material"));

for (const scenario of ["no_change", "scope_refusal", "absent", "crash", "interrupted"]) {
  const f = protocolRepository();
  try {
    f.database.exec("UPDATE run_codex_tasks SET thread_id='exact',turn_id='turn',phase='running'; UPDATE run_resources SET codex_thread_id='exact'");
    const text = scenario === "scope_refusal" ? "Dependency remediation excluded by scope; braces advisory has no upstream fix." : "No compatible upstream fix exists. No changes or push.";
    const receipt = { method: "turn/completed", params: { threadId: "exact", turn: { id: "turn", status: scenario === "crash" ? "failed" : scenario === "interrupted" ? "interrupted" : "completed", items: scenario === "absent" ? [] : [final(text)], error: { message: "Never store raw crash prose", codexErrorInfo: "sandboxError" } } } };
    assert.equal(recordTurnCompleted(f.database, "missing-task", receipt), false);
    assert.equal(recordTurnCompleted(f.database, f.id, { ...receipt, params: { ...receipt.params, threadId: "stale" } }), false);
    assert.equal(recordTurnCompleted(f.database, f.id, { ...receipt, params: { ...receipt.params, turn: { ...receipt.params.turn, id: "stale" } } }), false);
    assert.equal(recordTurnCompleted(f.database, f.id, receipt), true);
    recordTurnCompleted(f.database, f.id, { ...receipt, params: { ...receipt.params, turn: { ...receipt.params.turn, items: [final("Conflicting replay")] } } });
    const stored = f.database.prepare("SELECT * FROM run_codex_tasks").get()!;
    assert.equal(stored.final_summary, ["absent", "crash", "interrupted"].includes(scenario) ? null : text);
    f.database.exec(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state) VALUES('q','run','ci_repair','cli','q','applied');
      INSERT INTO run_ci_repair_attempts(attempt_id,run_id,request_id,attempt_number,source_head_sha,source_ci_state,source_checks_json,attempt_state,codex_thread_id,updated_at)
      VALUES('run','run','q',1,'source-head','failed','[]','waiting_ci','exact','2000-01-01');
      UPDATE runs SET state='parked_review',owner_state='none';
      UPDATE run_resources SET tmux_session_name=NULL,codex_thread_id='restored-primary';
      UPDATE run_codex_tasks SET stopped_at='2026-01-01',released_at='2026-01-01';`);
    reconcileCiRepairAttempts(f.database);
    assert.equal(f.database.prepare("SELECT failure_reason FROM run_ci_repair_attempts").get()?.failure_reason, "No new PR head appeared after the fixer task");
    const diagnostic = technicalWorkerDiagnostic(f.database, "run")!;
    assert.equal(diagnostic.taskId, f.id);
    assert.equal(diagnostic.contextId, "run"); assert.equal(diagnostic.threadId, "exact"); assert.equal(diagnostic.turnId, "turn");
    assert.equal(diagnostic.outcome, "No new PR head appeared after the fixer task");
    f.database.exec(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES('run','needs_attention','needs_attention','ci_repair_task_archived','{}');`);
    assert.deepEqual(technicalWorkerDiagnostic(f.database, "run"), diagnostic, "cleanup bookkeeping does not replace the actual cause");
    assert.equal(diagnostic.workerSummary, stored.final_summary);
    assert.deepEqual(runControlStatus(f.database, "run").technical_worker_diagnostic, diagnostic);
    assert.ok(!JSON.stringify(diagnostic).includes("Never store raw crash prose"));
    if (scenario === "crash") assert.ok(workerDiagnosticText(diagnostic)?.includes("Worker failure: protocol_sandboxError"));
    if (scenario === "absent") assert.ok(workerDiagnosticText(diagnostic)?.includes("summary unavailable"));
    if (scenario === "scope_refusal") {
      mkdirSync(resolve(f.root, "config"));
      writeFileSync(resolve(f.root, "config/projects.yaml"), JSON.stringify({ projects: { fixture: { owner: "Fixture", project_number: 1, repository: "Fixture/Repo", statuses: { backlog: "Todo", active: "Doing", review: "Review", done: "Done", deferred: "Later" } } } }));
      f.database.exec(`INSERT INTO project_items(project,item_id,content_type,repository,issue_number,title,status,present,first_seen_at,last_seen_at) VALUES('fixture','item','Issue','Fixture/Repo',1,'Synthetic task','Review',1,'2026-01-01','2026-01-01');`);
      // Synthetic presentation fixture: unrelated status fields are deliberately absent.
      const card = { ...runControlStatus(f.database, "run"), run_state: "needs_attention", stage: "needs_attention",
        detail: "No delivery", title: "Synthetic task", latest_attention_reason: null, previous_codex_thread_id: null,
        codex_thread_id: null, ci_repair_state: "needs_attention", review_fix_state: null, ai_review_state: null,
        preview_state: null, preview_hostname: null, execution_mode: "live" } as Parameters<typeof threadControlPayload>[0];
      const project = { workspace: { branch_prefix: "FX" } } as Parameters<typeof threadControlPayload>[1];
      const controlsBefore = controlComponents(card, project, null);
      card.technical_worker_detail = workerDiagnosticText(diagnostic);
      assert.ok(JSON.stringify(threadControlPayload(card, project, null, false)).includes(text), "Discord shows the exact bounded blocker");
      assert.deepEqual(controlComponents(card, project, null), controlsBefore, "diagnostics do not change Discord eligibility");
      const before = f.database.prepare("SELECT state,owner_state FROM runs").get();
      const snapshot = collectProjectsSnapshot({ home: f.root });
      assert.ok(snapshot.available); assert.ok(snapshot.items[0]?.detail?.includes(text));
      assert.deepEqual(f.database.prepare("SELECT state,owner_state FROM runs").get(), before);
    }
    f.database.exec(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES('run','parked_review','needs_attention','unrelated_preview_failure','{}');`);
    assert.equal(technicalWorkerDiagnostic(f.database, "run"), null, "old worker prose cannot explain a later unrelated failure");
    f.database.prepare("INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES('run','parked_review','needs_attention','ci_repair_no_new_head',?)").run(JSON.stringify({ attemptId: "run" }));
    f.database.exec("UPDATE run_ci_repair_attempts SET codex_thread_id='mismatched'");
    assert.equal(technicalWorkerDiagnostic(f.database, "run"), null);
    f.database.exec("UPDATE run_ci_repair_attempts SET codex_thread_id='exact'; UPDATE run_codex_tasks SET context_id='old-attempt'");
    assert.equal(technicalWorkerDiagnostic(f.database, "run"), null);
    f.database.exec(`UPDATE run_codex_tasks SET context_id='run';
      INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state) VALUES('q2','run','ci_repair','cli','q2','applied');
      INSERT INTO run_ci_repair_attempts(attempt_id,run_id,request_id,attempt_number,source_head_sha,source_ci_state,source_checks_json,attempt_state,codex_thread_id)
      VALUES('new-attempt','run','q2',2,'source-head','failed','[]','needs_attention','new-thread');`);
    assert.equal(technicalWorkerDiagnostic(f.database, "run"), null, "a prior task cannot explain a newer attempt");
    f.database.exec("UPDATE runs SET state='running'");
    assert.equal(technicalWorkerDiagnostic(f.database, "run"), null);
  } finally { f.database.close(); rmSync(f.root, { recursive: true, force: true }); }
}
// Review fix shares diagnostics, including acknowledged initialization failures before binding.
for (const unbound of [false, true]) {
  const f = protocolRepository();
  try {
    f.database.exec(`UPDATE run_codex_tasks SET kind='review_fix',context_id='round',thread_id='exact',turn_id='turn';
      UPDATE run_resources SET codex_thread_id='exact';`);
    if (!unbound) recordTurnCompleted(f.database, f.id, { method: "turn/completed", params: { threadId: "exact", turn: { id: "turn", status: "completed", items: [final("Review scope excludes security remediation. No push.")] } } });
    else f.database.exec("UPDATE run_codex_tasks SET thread_id=NULL,turn_id=NULL,failure_code='protocol_disconnect_or_ambiguous_dispatch'");
    f.database.exec(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state) VALUES('q','run','review_fix','cli','q','applied');
      INSERT INTO run_review_fix_rounds(round_id,run_id,request_id,round_number,round_state,repository,pull_request_number,pull_request_url,source_head_sha,snapshot_json,codex_thread_id,failure_reason)
      VALUES('round','run','q',1,'needs_attention','Fixture/Repo',1,'https://example.invalid/pr','source-head','[]','exact','review_fix_no_new_head');
      UPDATE runs SET state='needs_attention',owner_state='none';
      UPDATE run_codex_tasks SET stopped_at='2026-01-01',released_at='2026-01-01';`);
    if (unbound) f.database.exec("UPDATE run_review_fix_rounds SET codex_thread_id=NULL");
    f.database.prepare("INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES('run','running','needs_attention','protocol_worker_stopped',?)").run(JSON.stringify({ taskId: f.id }));
    const diagnostic = technicalWorkerDiagnostic(f.database, "run")!;
    assert.equal(diagnostic.kind, "review_fix"); assert.equal(diagnostic.contextId, "round");
    if (unbound) { assert.equal(diagnostic.workerSummary, null); assert.equal(diagnostic.failureCode, "protocol_disconnect_or_ambiguous_dispatch"); }
    else assert.equal(diagnostic.workerSummary, "Review scope excludes security remediation. No push.");
  } finally { f.database.close(); rmSync(f.root, { recursive: true, force: true }); }
}
const legacy = new DatabaseSync(":memory:");
assert.equal(technicalWorkerDiagnostic(legacy, "run"), null); legacy.close();
process.stdout.write(JSON.stringify({ ok: true, promptPolicy: true, workerStopScenarios: 5, exactIdentity: true, noPromptOrStdout: true, boundedSanitization: true, statusReadOnly: true, fallback: true }) + "\n");
