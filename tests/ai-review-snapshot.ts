import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { reviewStartHead } from "../src/orchestrator/projects/reviews/manager.ts";
import { buildGitHubReviewPayload, pullMatchesReview, publishReviewWithFences } from "../src/orchestrator/projects/reviews/worker.ts";
import { createReviewSnapshot, removeReviewSnapshot, reviewSnapshotMatches, reviewSnapshotPath } from "../src/orchestrator/projects/reviews/snapshot.ts";
import { reconcileAiReviews } from "../src/orchestrator/runtime/reconcile-ai-review.ts";

export function verifyReviewSnapshots(): void {
  const home = mkdtempSync(resolve(tmpdir(), "kurami-review-snapshot-"));
  const git = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_COMMITTER_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_EMAIL: "fixture@example.invalid" },
  }).trim();
  const db = new DatabaseSync(":memory:");
  try {
    const remote = resolve(home, "remote"); mkdirSync(remote); git(remote, "init", "-q");
    writeFileSync(resolve(remote, "file"), "base\n"); git(remote, "add", "."); git(remote, "commit", "-qm", "base");
    const base = git(remote, "rev-parse", "HEAD");
    const source = resolve(home, "managed"); git(home, "clone", "-q", remote, source);
    writeFileSync(resolve(remote, "file"), "external\n"); git(remote, "commit", "-qam", "external");
    const head = git(remote, "rev-parse", "HEAD"); git(remote, "update-ref", "refs/pull/160/head", head);
    const url = "https://github.com/Fixture/Repo/pull/160";
    db.exec("CREATE TABLE run_control_requests(request_id TEXT, requested_via TEXT); CREATE TABLE run_control_project_context(request_id TEXT, expected_head_sha TEXT, expected_pull_request_url TEXT)");
    db.prepare("INSERT INTO run_control_requests VALUES('rq_a','discord'),('rq_b','projects')").run();
    db.prepare("INSERT INTO run_control_project_context VALUES('rq_b',?,?)").run(head, url);
    const pull = { headRefOid: head, url };
    assert.equal(reviewStartHead(db, "rq_a", source, pull), head, "external advance accepted");
    assert.equal(git(source, "rev-parse", "HEAD"), base);
    const snapshot = reviewSnapshotPath(home, "air_a");
    createReviewSnapshot(snapshot, remote, 160, head, base, "fixture-token-not-a-secret");
    assert(reviewSnapshotMatches(snapshot, head));
    assert(!readFileSync(resolve(snapshot, ".git/config"), "utf8").includes("fixture-token"));
    assert.equal(git(snapshot, "config", "core.hooksPath"), "/dev/null");
    assert(git(snapshot, "diff", `${base}..${head}`).includes("+external"));
    assert.equal(git(snapshot, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD");
    assert.equal(readFileSync(resolve(snapshot, "file"), "utf8"), "external\n");
    assert.equal(git(source, "rev-parse", "HEAD"), base);
    assert.throws(() => createReviewSnapshot(snapshot, remote, 160, head, base), /EEXIST/);
    assert(reviewSnapshotMatches(snapshot, head), "existing snapshot not discarded");
    removeReviewSnapshot(home, "air_a"); assert(!existsSync(snapshot));

    writeFileSync(resolve(source, "local"), "unpublished\n"); git(source, "add", "."); git(source, "commit", "-qm", "local divergence");
    const localHead = git(source, "rev-parse", "HEAD");
    const localRefs = git(source, "show-ref");
    assert.equal(reviewStartHead(db, "rq_a", source, pull), head, "divergent clean source accepted without reset");
    createReviewSnapshot(snapshot, remote, 160, head, base);
    assert.equal(git(source, "rev-parse", "HEAD"), localHead);
    assert.equal(git(source, "show-ref"), localRefs);
    assert(!existsSync(resolve(snapshot, "local")), "unpublished source commit not reviewed");
    assert.equal(reviewStartHead(db, "rq_b", source, pull), head);
    assert.throws(() => reviewStartHead(db, "rq_b", source, { ...pull, headRefOid: base }), /different pull request or commit/);
    assert.throws(() => reviewStartHead(db, "rq_b", source, { ...pull, url: url + "0" }), /different pull request or commit/);
    writeFileSync(resolve(source, "file"), "dirty owner edit\n");
    assert.throws(() => reviewStartHead(db, "rq_a", source, pull), /clean managed worktree/);
    assert.equal(readFileSync(resolve(source, "file"), "utf8"), "dirty owner edit\n");
    assert.equal(git(source, "show-ref"), localRefs);

    const row = { review_id: "air_a", run_id: "r_fixture", review_number: 1, review_state: "running",
      repository: "Fixture/Repo", pull_request_number: 160, pull_request_url: url,
      base_ref: "main", base_sha: base, head_sha: head, worktree_path: snapshot,
      issue_number: 36, issue_title: null, branch_name: "feature" };
    const live = { state: "open", base: { ref: "main", sha: base }, head: { ref: "feature", sha: head } };
    assert(pullMatchesReview(row, live));
    for (const moved of [ { ...live, head: { ...live.head, sha: base } },
      { ...live, base: { ...live.base, sha: head } }, { ...live, state: "closed" } ])
      assert(!pullMatchesReview(row, moved), "PR movement at start/publication must fence review");
    const payload = buildGitHubReviewPayload({ summary: "Clean", findings: [] }, "air_a", head);
    assert.equal(payload.commit_id, head, "publication remains pinned even if PR changes during POST");
    let posts = 0;
    const cleanPublication = { inlineFindings: [], summaryOnlyFindings: [] };
    assert.equal(publishReviewWithFences(cleanPublication, [], () => false, () => { posts++; return { id: 1 }; }), null);
    assert.equal(posts, 0, "PR moved before publication: no POST");
    let current = true;
    assert.equal(publishReviewWithFences(cleanPublication, [], () => current, () => {
      posts++; current = false; return { id: 1, commit_id: head };
    }), null, "PR moves inside POST: no ready result");
    const finding = { severity: "important" as const, confidence: "high" as const, title: "Fixture", body: "Fixture", path: "file", line: 1 };
    current = true; posts = 0;
    assert.equal(publishReviewWithFences({ inlineFindings: [finding], summaryOnlyFindings: [] }, [finding], () => current, () => {
      posts++; current = false; throw new Error("HTTP 422: Path could not be resolved");
    }), null);
    assert.equal(posts, 1, "PR moves after anchor failure: fallback POST refused");
    assert.equal(publishReviewWithFences(cleanPublication, [], () => true, () => ({ id: 2 }))?.id, 2);
    writeFileSync(resolve(snapshot, "file"), "tampered\n"); assert(!reviewSnapshotMatches(snapshot, head));
    removeReviewSnapshot(home, "air_a");
    git(remote, "update-ref", "refs/pull/160/head", base);
    assert.throws(() => createReviewSnapshot(snapshot, remote, 160, head, base), /Could not fetch exact/);
    assert(!existsSync(snapshot), "mid-start PR movement cleans failed snapshot");

    mkdirSync(resolve(home, "state"), { recursive: true });
    const lifecycle = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    try {
      lifecycle.exec("CREATE TABLE run_ai_reviews(review_id TEXT, tmux_session_name TEXT, created_at TEXT, review_state TEXT, failure_reason TEXT, updated_at TEXT, completed_at TEXT)");
      for (const [id, state] of [["air_c", "running"], ["air_d", "ready"]]) {
        mkdirSync(reviewSnapshotPath(home, id!));
        lifecycle.prepare("INSERT INTO run_ai_reviews VALUES(?, 'invalid-fixture-session', '2020-01-01T00:00:00Z', ?, NULL,NULL,NULL)").run(id!, state!);
      }
      mkdirSync(reviewSnapshotPath(home, "air_e"));
      lifecycle.prepare("INSERT INTO run_ai_reviews VALUES(?, 'invalid-fixture-session', ?, 'running', NULL,NULL,NULL)").run("air_e", new Date().toISOString());
      reconcileAiReviews(lifecycle);
      assert(existsSync(reviewSnapshotPath(home, "air_e")), "worker startup grace preserves snapshot");
      assert(!existsSync(reviewSnapshotPath(home, "air_c")));
      assert(!existsSync(reviewSnapshotPath(home, "air_d")));
      assert.equal((lifecycle.prepare("SELECT review_state FROM run_ai_reviews WHERE review_id='air_c'").get() as { review_state: string }).review_state, "failed");
      assert.equal((lifecycle.prepare("SELECT review_state FROM run_ai_reviews WHERE review_id='air_d'").get() as { review_state: string }).review_state, "ready");
    } finally { lifecycle.close(); }
  } finally { db.close(); rmSync(home, { recursive: true, force: true }); }
  console.log(JSON.stringify({ ok: true, reviewSnapshot: true, externalAdvance: true, divergencePreserved: true,
    dirtySourceRefused: true, staleProjectsContextRefused: true, movingPrFenced: true, cleanupVerified: true }));
}
if (import.meta.main) verifyReviewSnapshots();
