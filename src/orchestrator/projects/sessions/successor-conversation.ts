import type { DatabaseSync } from "node:sqlite";
import { capturePredecessorConversation, assertPredecessorConversationUnchanged } from "../../integrations/codex/predecessor-conversation.ts";
import { serializeUntrustedPromptData } from "../../security/prompt-safety.ts";

const MAX_THREADS = 16;
const MAX_CONTEXT_BYTES = 128 * 1024;

type LineageIdentity = {
  succession_id: string;
  run_id: string;
  request_id: string;
  succession_number: number;
  predecessor_thread_id: string;
  successor_thread_id: string;
  worktree_path: string;
  branch_name: string;
  source_head_sha: string;
};

function refuse(reason: string): never {
  throw new Error(`Successor conversation unavailable: ${reason}; no successor may start.`);
}

/** Exact same-run ancestry only. The caller still owns run/resource admission and its
 * dispatch fence; this helper neither resumes a task nor acquires a writer claim.
 */
export function captureSuccessorConversation(database: DatabaseSync, runId: string,
  currentThreadId: string, worktree: string, branch: string, optionalCodexHome?: string) {
  if ([runId, currentThreadId, worktree, branch].some(value => !value.trim()))
    refuse("missing run, thread, worktree, or branch identity");

  function readLineage(): { threadIds: string[]; lineage: LineageIdentity[] } {
    const threadIds: string[] = [];
    const lineage: LineageIdentity[] = [];
    const seenThreads = new Set<string>();
    const seenSuccessions = new Set<string>();
    const seenRequests = new Set<string>();
    let threadId = currentThreadId;
    let newerNumber = Infinity;
    while (true) {
      if (seenThreads.has(threadId)) refuse("cyclic or duplicate thread lineage");
      if (threadIds.length >= MAX_THREADS) refuse("lineage exceeds 16 complete threads; nothing was truncated");
      seenThreads.add(threadId);
      threadIds.push(threadId);
      // Deliberately do not filter by run: a foreign or duplicate mapping must be
      // refused, not mistaken for an original thread with no predecessor.
      const rows = database.prepare(`SELECT succession_id, run_id, request_id,
        succession_number, predecessor_thread_id, successor_thread_id,
        worktree_path, branch_name, source_head_sha
        FROM run_autonomous_successions WHERE successor_thread_id = ? LIMIT 2`).all(threadId);
      if (!rows.length) break;
      if (rows.length !== 1) refuse("duplicate successor mapping");
      const row = rows[0] as unknown as LineageIdentity;
      if (row.run_id !== runId || row.worktree_path !== worktree || row.branch_name !== branch ||
          row.successor_thread_id !== threadId) refuse("unrelated run, worktree, branch, or thread mapping");
      if ([row.succession_id, row.request_id, row.predecessor_thread_id, row.source_head_sha]
          .some(value => typeof value !== "string" || !value.trim()) ||
          !Number.isSafeInteger(row.succession_number) || row.succession_number <= 0 ||
          row.succession_number >= newerNumber) refuse("invalid or non-decreasing backward succession identity");
      if (seenSuccessions.has(row.succession_id) || seenRequests.has(row.request_id))
        refuse("duplicate succession or request identity");
      seenSuccessions.add(row.succession_id);
      seenRequests.add(row.request_id);
      newerNumber = row.succession_number;
      lineage.push(row);
      threadId = row.predecessor_thread_id;
    }
    return { threadIds: threadIds.reverse(), lineage: lineage.reverse() };
  }

  const identities = readLineage();
  const captured = identities.threadIds.map(threadId =>
    capturePredecessorConversation(threadId, worktree, optionalCodexHome));
  const evidence = {
    runId, currentThreadId, worktree, branch,
    coverage: "complete bounded same-run predecessor chain, oldest thread first; exact source-order messages within each thread; no summaries or resumed ancestors",
    lineage: identities.lineage,
    conversations: captured.map(item => item.evidence),
  };
  if (Buffer.byteLength(serializeUntrustedPromptData(evidence), "utf8") > MAX_CONTEXT_BYTES)
    refuse("combined selected context exceeds 128 KiB; nothing was truncated");

  // Keep the identities/fingerprints private: mutating returned prompt evidence
  // cannot change what is checked immediately before the caller's claim/dispatch.
  const identitySnapshot = JSON.stringify(identities);
  function assertUnchanged(): void {
    if (JSON.stringify(readLineage()) !== identitySnapshot) refuse("lineage changed after capture");
    captured.forEach((item, index) => {
      const threadId = identities.threadIds[index]!;
      if (optionalCodexHome === undefined) {
        assertPredecessorConversationUnchanged(threadId, worktree, item.fingerprint);
      } else if (capturePredecessorConversation(threadId, worktree, optionalCodexHome).fingerprint !== item.fingerprint) {
        // The existing native recheck has no explicit-home parameter. Preserve its
        // full recapture/fingerprint check for disposable or non-default homes.
        refuse("source changed after capture");
      }
    });
    if (JSON.stringify(readLineage()) !== identitySnapshot) refuse("lineage changed during source recheck");
  }
  assertUnchanged();
  return { evidence, assertUnchanged };
}
