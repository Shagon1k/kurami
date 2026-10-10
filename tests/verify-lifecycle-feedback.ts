import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  LIFECYCLE_FEEDBACK_TABLE_SQL, LifecycleGitHubError,
  lifecycleFeedbackKey, lifecycleFeedbackMarker, reconcileLifecycleFeedback,
  renderLifecycleFeedback,
} from "../src/orchestrator/projects/lifecycle-feedback.ts";
import type {
  FeedbackDelivery, FeedbackStore, LifecycleComment, LifecycleGitHub,
  LifecycleSnapshot,
} from "../src/orchestrator/projects/lifecycle-feedback.ts";

const headSha = "a".repeat(40);
const mergeCommitSha = "b".repeat(40);
const snapshot: LifecycleSnapshot = {
  runId: "r_test", revision: 1,
  endpoint: { repository: "owner/repo", issueNumber: 42 },
  runState: "archived", cancelled: false, newerRunId: null,
  projectState: "Human Review", cleanup: "done",
  reason: "Ресурсы освобождены; тикет остаётся на приёмке",
  expectedPr: { number: 7, headSha, base: "main" },
  merge: { repository: "owner/repo", number: 7, headSha, base: "main",
    mergeCommitSha, mergedAt: "2026-10-10T12:00:00Z" },
  request: null,
};
function fixture() {
  // Disposable database, no live state/config or GitHub operations.
  const db = new DatabaseSync(":memory:");
  db.exec(LIFECYCLE_FEEDBACK_TABLE_SQL);
  let queue: Promise<unknown> = Promise.resolve();
  const store: FeedbackStore = {
    async withLock(_key, work) {
      const result = queue.then(work);
      queue = result.catch(() => {});
      return result;
    },
    async load(key) {
      const row = db.prepare("SELECT * FROM github_lifecycle_feedback WHERE delivery_key = ?").get(key);
      return row ? {
        revision: Number(row.revision), commentId: row.comment_id === null ? null : Number(row.comment_id),
        deliveredDigest: row.delivered_digest as string | null,
        createPending: row.create_pending === 1, error: row.delivery_error as FeedbackDelivery["error"],
      } : null;
    },
    async save(key, delivery) {
      db.prepare(`INSERT INTO github_lifecycle_feedback VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(delivery_key) DO UPDATE SET revision=excluded.revision,
        comment_id=excluded.comment_id, delivered_digest=excluded.delivered_digest,
        create_pending=excluded.create_pending, delivery_error=excluded.delivery_error`)
        .run(key, delivery.revision, delivery.commentId, delivery.deliveredDigest,
          Number(delivery.createPending), delivery.error);
    },
  };
  const comments: LifecycleComment[] = [];
  const calls = { create: 0, update: 0, list: 0, issue: 0 };
  let mode: "normal" | "committed-timeout" | "timeout" | "denied" = "normal";
  const github: LifecycleGitHub = {
    async authenticatedAuthorId() { return 123; },
    async issue(endpoint) { calls.issue++; return { ...endpoint, state: "open", isPullRequest: false }; },
    async comments() { calls.list++; return structuredClone(comments); },
    async create(endpoint, body) {
      calls.create++;
      assert.equal((await store.load(lifecycleFeedbackKey(snapshot)))?.createPending, true);
      if (mode === "denied") throw new LifecycleGitHubError("permission_denied");
      if (mode === "timeout") throw new Error("DO_NOT_LEAK_TOKEN_OR_STDERR");
      const comment = { id: 100, endpoint, authorId: 123, body };
      comments.push(comment);
      if (mode === "committed-timeout") throw new Error("DO_NOT_LEAK_TOKEN_OR_STDERR");
      return structuredClone(comment);
    },
    async update(endpoint, id, body) {
      calls.update++;
      const comment = comments.find((entry) => entry.id === id)!;
      assert.deepEqual(comment.endpoint, endpoint);
      comment.body = body;
      return structuredClone(comment);
    },
  };
  return { db, store, github, comments, calls, setMode(value: typeof mode) { mode = value; } };
}
let checked = 0;
async function test(name: string, work: (f: ReturnType<typeof fixture>) => Promise<void>) {
  const f = fixture();
  try { await work(f); checked++; console.log(`OK: ${name}`); }
  finally { f.db.close(); }
}
await test("создание, no-op и смысловое обновление одного комментария", async (f) => {
  const ownerBody = "Owner prose\n- [ ] acceptance";
  f.comments.push({ id: 99, endpoint: snapshot.endpoint, authorId: 999, body: ownerBody });
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).status, "created");
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).status, "unchanged");
  assert.deepEqual(f.calls, { create: 1, update: 0, list: 3, issue: 2 });
  const before = (await f.store.load(lifecycleFeedbackKey(snapshot)))!.deliveredDigest;
  const changed = { ...snapshot, revision: 2, cleanup: "blocked" as const, reason: "Очистка заблокирована" };
  assert.equal((await reconcileLifecycleFeedback(changed, 123, f.github, f.store)).status, "updated");
  assert.notEqual((await f.store.load(lifecycleFeedbackKey(snapshot)))!.deliveredDigest, before);
  assert.equal(f.comments[0].body, ownerBody);
  assert.equal(f.comments.length, 2);
  assert.equal(f.calls.update, 1);
  assert.equal((await reconcileLifecycleFeedback({ ...changed, revision: 3 }, 123, f.github, f.store)).status, "unchanged");
  assert.equal(f.calls.update, 1); // Revision alone is not a heartbeat.
});
await test("неоднозначный create найден по маркеру без повторного POST", async (f) => {
  f.setMode("committed-timeout");
  const result = await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store);
  assert.equal(result.status, "unchanged");
  assert.equal(result.commentId, 100);
  assert.equal(f.calls.create, 1);
  assert.equal((await f.store.load(lifecycleFeedbackKey(snapshot)))!.createPending, false);
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).status, "unchanged");
  assert.equal(f.calls.create, 1);
});
await test("неразрешённый POST сохраняет fence; поздняя видимость восстанавливается", async (f) => {
  f.setMode("timeout");
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).error, "create_unresolved");
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).error, "create_unresolved");
  assert.equal(f.calls.create, 1);
  f.comments.push({ id: 100, endpoint: snapshot.endpoint, authorId: 123,
    body: renderLifecycleFeedback(snapshot, "open") });
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).status, "unchanged");
  assert.equal(f.calls.create, 1);
});
await test("чужой автор маркера не редактируется", async (f) => {
  f.comments.push({ id: 101, endpoint: snapshot.endpoint, authorId: 999, body: lifecycleFeedbackMarker(snapshot) });
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).error, "foreign_marker");
  assert.equal(f.calls.create + f.calls.update, 0);
});
await test("неверный endpoint или authenticated author блокируют запись", async (f) => {
  f.github.issue = async () => ({ repository: "other/repo", issueNumber: 42, state: "open", isPullRequest: false });
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).error, "identity_mismatch");
  f.github.issue = async () => ({ ...snapshot.endpoint, state: "open", isPullRequest: false });
  assert.equal((await reconcileLifecycleFeedback(snapshot, 456, f.github, f.store)).error, "identity_mismatch");
  assert.equal(f.calls.create + f.calls.update, 0);
  f.comments.push({ id: 100, endpoint: { repository: "other/repo", issueNumber: 42 },
    authorId: 123, body: lifecycleFeedbackMarker(snapshot) });
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).error, "identity_mismatch");
});
await test("PR endpoint не принимается вместо тикета", async (f) => {
  f.github.issue = async () => ({ ...snapshot.endpoint, state: "open", isPullRequest: true });
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).error, "identity_mismatch");
  assert.equal(f.calls.create + f.calls.update, 0);
});
await test("старый snapshot не откатывает более новую доставку", async (f) => {
  await reconcileLifecycleFeedback({ ...snapshot, revision: 9 }, 123, f.github, f.store);
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).status, "stale");
  assert.equal(f.calls.issue, 1);
  assert.equal(f.calls.update, 0);
});
await test("permission error безопасен и не меняет lifecycle", async (f) => {
  const before = structuredClone(snapshot);
  f.setMode("denied");
  const result = await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store);
  assert.deepEqual(result, { status: "failed", commentId: null, error: "permission_denied" });
  assert.equal((await f.store.load(lifecycleFeedbackKey(snapshot)))!.error, "permission_denied");
  assert.equal((await f.store.load(lifecycleFeedbackKey(snapshot)))!.createPending, false);
  assert.deepEqual(snapshot, before);
});
await test("merge не означает приёмку; отмена и новый запуск имеют приоритет", async (f) => {
  const body = renderLifecycleFeedback(snapshot, "open");
  assert.match(body, /open/);
  assert.match(body, /Human Review/);
  assert.match(body, /приёмки не проверены/);
  assert.match(body, /не закрывает тикет/);
  assert.match(body, new RegExp(headSha));
  assert.match(body, new RegExp(mergeCommitSha));
  assert.match(renderLifecycleFeedback({ ...snapshot, cancelled: true, newerRunId: "r_new" }, "open"), /Отменён/);
  assert.match(renderLifecycleFeedback({ ...snapshot, newerRunId: "r_new" }, "open"), /Исторический запуск; новый запуск: r_new/);
  for (const merge of [
    { ...snapshot.merge!, repository: "wrong/repo" },
    { ...snapshot.merge!, headSha: "c".repeat(40) },
    { ...snapshot.merge!, base: "wrong-base" },
    { ...snapshot.merge!, number: 8 },
  ]) assert.match(renderLifecycleFeedback({ ...snapshot, merge }, "open"), /Merge не подтверждён/);
  assert.doesNotMatch(body, /\[x\]/);
  await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store);
  f.github.issue = async () => ({ ...snapshot.endpoint, state: "closed", isPullRequest: false });
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).status, "updated");
  assert.match(f.comments[0].body, /closed/); // Actual fetched state, not acceptance.
});
await test("explicit request acknowledgement отражает отказ без нового комментария", async (f) => {
  await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store);
  const ack = { ...snapshot, revision: 2, request: { id: "req_1", action: "complete",
    outcome: "refused" as const, reason: "Тикет не принят" } };
  assert.equal((await reconcileLifecycleFeedback(ack, 123, f.github, f.store)).status, "updated");
  assert.match(f.comments[0].body, /req_1 \(complete\): refused; Тикет не принят/);
  assert.equal((await reconcileLifecycleFeedback(ack, 123, f.github, f.store)).status, "unchanged");
  assert.equal(f.calls.create, 1);
});
await test("дубликат маркера и потерянный comment ID не создают дубликаты", async (f) => {
  await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store);
  f.comments.push({ ...f.comments[0], id: 101 });
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).error, "duplicate_marker");
  f.comments.length = 0;
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).error, "comment_missing");
  assert.equal(f.calls.create, 1);
});
await test("параллельные reconcile под lock создают один комментарий", async (f) => {
  const results = await Promise.all([
    reconcileLifecycleFeedback(snapshot, 123, f.github, f.store),
    reconcileLifecycleFeedback(snapshot, 123, f.github, f.store),
  ]);
  assert.deepEqual(results.map((result) => result.status), ["created", "unchanged"]);
  assert.equal(f.calls.create, 1);
});
await test("invalid snapshot и недоступная persistence не начинают POST", async (f) => {
  assert.equal((await reconcileLifecycleFeedback({ ...snapshot, expectedPr: { ...snapshot.expectedPr!, headSha: "bad" } },
    123, f.github, f.store)).error, "invalid_snapshot");
  f.store.save = async () => { throw new Error("secret storage diagnostics"); };
  assert.equal((await reconcileLifecycleFeedback(snapshot, 123, f.github, f.store)).error, "persistence_unavailable");
  assert.equal(f.calls.create, 0);
});
console.log(`Проверено сценариев: ${checked}. Live GitHub и рабочая БД не использовались.`);
