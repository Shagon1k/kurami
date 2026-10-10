/** Bounded issue-comment delivery. No issue, Project, checkbox or run mutations.
 * Caller supplies committed authoritative facts and serializes delivery per key.
 * GitHub adapter must use existing gh auth (execFile, no shell), paginate ALL
 * comments, validate REST response identities, and never return raw stderr.
 */
import { createHash } from "node:crypto";

export type IssueEndpoint = { repository: string; issueNumber: number };
export type LifecycleSnapshot = {
  runId: string;
  /** Monotonically increasing committed semantic revision, NOT a poll timestamp. */
  revision: number;
  endpoint: IssueEndpoint;
  runState: string;
  cancelled: boolean;
  newerRunId: string | null;
  projectState: string | null;
  cleanup: "pending" | "blocked" | "done";
  /** Safe owner-facing reason; never diagnostics, credentials or worker output. */
  reason: string;
  expectedPr: { number: number; headSha: string; base: string } | null;
  merge: {
    repository: string; number: number; headSha: string; base: string;
    mergeCommitSha: string; mergedAt: string;
  } | null;
  /** Explicit request acknowledgement only, not automatic close/reopen detection. */
  request: { id: string; action: string; outcome: "applied" | "refused" | "pending"; reason: string } | null;
};
export type LifecycleComment = {
  id: number; endpoint: IssueEndpoint; authorId: number; body: string;
};
export type FeedbackDelivery = {
  revision: number;
  commentId: number | null;
  deliveredDigest: string | null;
  /** Durable create fence: ambiguous POST must never be blindly repeated. */
  createPending: boolean;
  error: FeedbackErrorCode | null;
};
export type FeedbackErrorCode =
  | "permission_denied" | "github_unavailable" | "identity_mismatch"
  | "foreign_marker" | "duplicate_marker" | "comment_missing"
  | "create_unresolved" | "invalid_snapshot" | "persistence_unavailable";
export class LifecycleGitHubError extends Error {
  readonly code: "permission_denied" | "github_unavailable";
  constructor(code: "permission_denied" | "github_unavailable") {
    super(code);
    this.code = code;
  }
}
export type LifecycleGitHub = {
  authenticatedAuthorId(): Promise<number>;
  /** Must resolve the numbered issue, not a PR; verify repository/number from
   * REST issue URL and reject pull_request payloads. */
  issue(endpoint: IssueEndpoint): Promise<IssueEndpoint & { state: "open" | "closed"; isPullRequest: boolean }>;
  /** Complete listing; partial pagination MUST throw instead of returning absence. */
  comments(endpoint: IssueEndpoint): Promise<LifecycleComment[]>;
  create(endpoint: IssueEndpoint, body: string): Promise<LifecycleComment>;
  update(endpoint: IssueEndpoint, commentId: number, body: string): Promise<LifecycleComment>;
};
export type FeedbackStore = {
  /** Cross-process per-key exclusive lock; held through GitHub IO and save.
   * Do not hold an SQLite write transaction across network IO. */
  withLock<T>(key: string, work: () => Promise<T>): Promise<T>;
  load(key: string): Promise<FeedbackDelivery | null>;
  /** Durable atomic upsert; must finish before the external create starts. */
  save(key: string, delivery: FeedbackDelivery): Promise<void>;
};
export type FeedbackResult = {
  status: "created" | "updated" | "unchanged" | "stale" | "failed";
  commentId: number | null;
  error: FeedbackErrorCode | null;
};

/** Migration proposal ONLY; importing this module never initializes a database.
 * Parent must add docs reference-note and migration using its chosen next number.
 * delivery_key = SHA256(JSON.stringify([lowercase repo, issue number, run id])).
 * Parent implements the cross-process lock separately via existing runner lock.
 */
export const LIFECYCLE_FEEDBACK_TABLE_SQL = `CREATE TABLE github_lifecycle_feedback (
  delivery_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  comment_id INTEGER,
  delivered_digest TEXT,
  create_pending INTEGER NOT NULL DEFAULT 0 CHECK (create_pending IN (0, 1)),
  delivery_error TEXT
);`;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function lifecycleFeedbackKey(snapshot: Pick<LifecycleSnapshot, "endpoint" | "runId">): string {
  return hash(JSON.stringify([
    snapshot.endpoint.repository.toLowerCase(), snapshot.endpoint.issueNumber, snapshot.runId,
  ]));
}
export function lifecycleFeedbackMarker(snapshot: LifecycleSnapshot): string {
  return `<!-- kurami:lifecycle:v1:${lifecycleFeedbackKey(snapshot)} -->`;
}
function sameEndpoint(a: IssueEndpoint, b: IssueEndpoint): boolean {
  return a.repository.toLowerCase() === b.repository.toLowerCase() && a.issueNumber === b.issueNumber;
}
function text(value: string): string {
  // Single-line owner-facing fields cannot inject markers or task lists.
  return value.replace(/[\r\n]/gu, " ").replace(/[<>`]/gu, "");
}
function validSnapshot(s: LifecycleSnapshot): boolean {
  const sha = /^[a-f0-9]{40}$/iu;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(s.endpoint.repository)
    && Number.isSafeInteger(s.endpoint.issueNumber) && s.endpoint.issueNumber > 0
    && s.runId.length > 0 && Number.isSafeInteger(s.revision) && s.revision >= 0
    && s.reason.trim().length > 0
    && (!s.expectedPr || (Number.isSafeInteger(s.expectedPr.number) && s.expectedPr.number > 0
      && sha.test(s.expectedPr.headSha) && !!s.expectedPr.base))
    && (!s.merge || (Number.isSafeInteger(s.merge.number) && s.merge.number > 0
      && sha.test(s.merge.headSha) && sha.test(s.merge.mergeCommitSha) && !!s.merge.base && !!s.merge.mergedAt));
}

/** Semantic body contains no poll time/heartbeat and never infers issue acceptance. */
export function renderLifecycleFeedback(s: LifecycleSnapshot, issueState: "open" | "closed"): string {
  const m = s.merge;
  const p = s.expectedPr;
  const matched = !!m && !!p && m.repository.toLowerCase() === s.endpoint.repository.toLowerCase()
    && m.number === p.number && m.headSha.toLowerCase() === p.headSha.toLowerCase() && m.base === p.base;
  const outcome = s.cancelled ? "Отменён; merge не превращает отмену в завершение."
    : s.newerRunId ? `Исторический запуск; новый запуск: ${text(s.newerRunId)}.`
    : m && !matched ? "Merge не подтверждён для ожидаемого PR/репозитория/SHA/base."
    : matched ? "PR влит; состояние запуска и очистки указано отдельно."
    : "Подтверждённого merge нет.";
  return [
    lifecycleFeedbackMarker(s),
    "### Kurami — результат жизненного цикла запуска",
    `Запуск: ${text(s.runId)}; фактическое состояние: ${text(s.runState)}.`,
    `Результат: ${outcome}`,
    ...(s.newerRunId ? [`Более новый запуск: ${text(s.newerRunId)}; этот комментарий относится только к ${text(s.runId)}.`] : []),
    p ? `Ожидаемый PR: ${s.endpoint.repository}#${p.number}; head SHA: ${p.headSha}; base: ${text(p.base)}.`
      : "Ожидаемый PR: не установлен.",
    m ? `Наблюдаемый merge: ${text(m.repository)}#${m.number}; head SHA: ${m.headSha}; merge SHA: ${m.mergeCommitSha}; base: ${text(m.base)}; merged: ${text(m.mergedAt)}.`
      : "Merge: не подтверждён.",
    `Фактический тикет: ${s.endpoint.repository}#${s.endpoint.issueNumber}; ${issueState}.`,
    `Фактический Project: ${text(s.projectState ?? "неизвестно")}.`,
    `Очистка ресурсов: ${s.cleanup}.`,
    `Причина: ${text(s.reason)}.`,
    ...(s.request ? [`Запрос ${text(s.request.id)} (${text(s.request.action)}): ${s.request.outcome}; ${text(s.request.reason)}.`] : []),
    "Влитый PR ≠ принятие всего тикета. Оставшиеся критерии приёмки не проверены; требуется подтверждение владельца.",
    "Этот отчёт не закрывает тикет, не меняет Project и не отмечает чекбоксы.",
  ].join("\n\n");
}

/** Delivery errors never alter authoritative lifecycle facts or leak gh stderr.
 * Unknown create errors are ambiguous. After a durable create fence, absence in
 * discovery stays pending (no retry POST); operator may clear fence only after
 * independently establishing that no create occurred. This favors no duplicates.
 */
export async function reconcileLifecycleFeedback(
  snapshot: LifecycleSnapshot,
  expectedAuthorId: number,
  github: LifecycleGitHub,
  store: FeedbackStore,
): Promise<FeedbackResult> {
  const failed = (error: FeedbackErrorCode, commentId: number | null = null): FeedbackResult =>
    ({ status: "failed", commentId, error });
  if (!validSnapshot(snapshot) || !Number.isSafeInteger(expectedAuthorId) || expectedAuthorId <= 0)
    return failed("invalid_snapshot");
  const key = lifecycleFeedbackKey(snapshot);
  try {
    return await store.withLock(key, async () => {
      let delivery = await store.load(key);
      if (delivery && delivery.revision > snapshot.revision)
        return { status: "stale", commentId: delivery.commentId, error: null };
      delivery ??= { revision: snapshot.revision, commentId: null, deliveredDigest: null, createPending: false, error: null };
      const saveFailure = async (error: FeedbackErrorCode) => {
        delivery!.revision = snapshot.revision;
        delivery!.error = error;
        await store.save(key, delivery!);
        return failed(error, delivery!.commentId);
      };
      try {
        const author = await github.authenticatedAuthorId();
        const issue = await github.issue(snapshot.endpoint);
        if (author !== expectedAuthorId || !sameEndpoint(issue, snapshot.endpoint) || issue.isPullRequest
          || (issue.state !== "open" && issue.state !== "closed"))
          return await saveFailure("identity_mismatch");
        const marker = lifecycleFeedbackMarker(snapshot);
        const discover = async () => {
          const comments = await github.comments(snapshot.endpoint);
          const marked = comments.filter((comment) => comment.body.split(/\r?\n/u).includes(marker));
          if (marked.some((comment) => !sameEndpoint(comment.endpoint, snapshot.endpoint)))
            return { error: "identity_mismatch" as const, comment: null };
          if (marked.some((comment) => comment.authorId !== author))
            return { error: "foreign_marker" as const, comment: null };
          if (marked.length > 1) return { error: "duplicate_marker" as const, comment: null };
          const comment = marked[0] ?? null;
          if (comment && (!Number.isSafeInteger(comment.id) || comment.id <= 0
            || (delivery!.commentId !== null && delivery!.commentId !== comment.id)))
            return { error: "identity_mismatch" as const, comment: null };
          return { error: null, comment };
        };
        let found = await discover();
        if (found.error) return await saveFailure(found.error);
        if (!found.comment && delivery.commentId !== null) return await saveFailure("comment_missing");
        const body = renderLifecycleFeedback(snapshot, issue.state);
        const digest = hash(body);
        let status: FeedbackResult["status"] = "unchanged";
        if (!found.comment) {
          if (delivery.createPending) return await saveFailure("create_unresolved");
          delivery.createPending = true;
          delivery.revision = snapshot.revision;
          await store.save(key, delivery); // Before POST, including crash window.
          try {
            const created = await github.create(snapshot.endpoint, body);
            // Re-discover to verify endpoint/author/uniqueness, not trust POST alone.
            found = await discover();
            if (found.error) return await saveFailure(found.error);
            if (!found.comment || found.comment.id !== created.id) return await saveFailure("create_unresolved");
            status = "created";
          } catch (error) {
            if (error instanceof LifecycleGitHubError && error.code === "permission_denied") {
              delivery.createPending = false; // Adapter promises definitive rejected POST.
              return await saveFailure(error.code);
            }
            found = await discover(); // Timeout may have committed the POST.
            if (found.error) return await saveFailure(found.error);
            if (!found.comment) return await saveFailure("create_unresolved");
          }
        }
        const comment = found.comment!;
        if (comment.body !== body) {
          const updated = await github.update(snapshot.endpoint, comment.id, body);
          if (updated.id !== comment.id || updated.authorId !== author
            || !sameEndpoint(updated.endpoint, snapshot.endpoint) || updated.body !== body)
            return await saveFailure("identity_mismatch");
          status = "updated";
        }
        delivery = { revision: snapshot.revision, commentId: comment.id,
          deliveredDigest: digest, createPending: false, error: null };
        await store.save(key, delivery);
        return { status, commentId: comment.id, error: null };
      } catch (error) {
        return await saveFailure(error instanceof LifecycleGitHubError ? error.code : "github_unavailable");
      }
    });
  } catch {
    return failed("persistence_unavailable");
  }
}
