import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { redactSecretLikeText, sanitizeUntrustedPromptData, serializeUntrustedPromptData } from "../../security/prompt-safety.ts";

// Read the complete source, never just its tail: late decisions and earlier reversals both matter.
const SOURCE_LIMIT = 16 * 1024 * 1024;
const CONTEXT_LIMIT = 64 * 1024;
const MESSAGE_LIMIT = 256;
// Keep decision formatting and addresses intact; reuse the shared normalizer and the
// credential patterns from worker diagnostics without its presentation-only flattening.
function redactConversationText(text: string): string {
  return redactSecretLikeText(text)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[^\s]+)\b/giu, "[REDACTED_CREDENTIAL]")
    .replace(/\b[\w.-]*(?:token|secret|password|passwd|api_key|private_key|credential)[\w.-]*\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/giu, "[REDACTED_CREDENTIAL]")
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/giu, "[REDACTED_CREDENTIAL]");
}
function refuse(reason: string): never {
  throw new Error(`Predecessor conversation unavailable: ${reason}. No successor may start; finish the Remote conversation and retry with complete local history.`);
}

/** Same exact-thread, read-only state_5/rollout boundary as primary-diagnostic.ts.
 * No Codex process, resume, history search, tool output, or generated summary is involved.
 */
export function capturePredecessorConversation(threadId: string, worktree: string,
  home = process.env.CODEX_HOME ?? resolve(homedir(), ".codex")) {
  let database: DatabaseSync | undefined;
  let fd: number | undefined;
  try {
    database = new DatabaseSync(resolve(home, "state_5.sqlite"), { readOnly: true, timeout: 1000 });
    const row = database.prepare("SELECT rollout_path, cwd, source FROM threads WHERE id=?").get(threadId);
    if (!row || typeof row.rollout_path !== "string" || row.cwd !== worktree || row.source !== "cli")
      refuse("missing or unrelated native thread mapping");
    const path = realpathSync(row.rollout_path);
    if (!["sessions", "archived_sessions"].some(dir => path.startsWith(resolve(home, dir) + sep)))
      refuse("rollout outside the local session store");
    fd = openSync(path, "r");
    const before = fstatSync(fd);
    if (!before.isFile() || before.size === 0 || before.size > SOURCE_LIMIT) refuse("source exceeds the 16 MiB complete-read bound or is empty");
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const length = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!length) refuse("source ended during capture");
      offset += length;
    }
    if (buffer.at(-1) !== 10) refuse("incomplete final source record");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const lines = text.slice(0, -1).split("\n");
    const meta = JSON.parse(lines[0]!);
    if (meta.type !== "session_meta" || meta.payload?.id !== threadId || meta.payload.cwd !== worktree ||
        meta.payload.source !== "cli" || meta.payload.thread_source !== "user" || meta.payload.forked_from_id) refuse("unrelated session identity or source");
    const messages: { role: "user" | "assistant"; text: string; sourceLine: number }[] = [];
    const ownerReceipts: string[] = [];
    const ownerMessages: string[] = [];
    let turn: string | null = null;
    let stopped = false;
    for (let index = 1; index < lines.length; index++) {
      const record = JSON.parse(lines[index]!);
      const payload = record.payload;
      if (!payload || typeof record.type !== "string") refuse("malformed source record");
      if (!["compacted", "session_meta", "turn_context", "event_msg", "response_item", "token_usage_record", "world_state"].includes(record.type))
        refuse("unsupported source record; coverage cannot be proven");
      // Compaction replacements cannot establish full owner-message coverage. Do not trust summaries.
      if (record.type === "compacted") refuse("compacted history has unsupported coverage");
      if (record.type === "session_meta") refuse("multiple session identities");
      if (record.type === "turn_context" && payload.cwd !== worktree) refuse("turn worktree changed");
      if (record.type === "event_msg") {
        if (payload.thread_id && payload.thread_id !== threadId) refuse("event thread identity changed");
        if (payload.type === "item_completed" && payload.item?.type === "UserMessage") {
          const parts = payload.item.content;
          if (!Array.isArray(parts) || !parts.length || parts.some(part => part?.type !== "text" || typeof part.text !== "string"))
            refuse("unsupported owner receipt content");
          ownerReceipts.push(parts.map(part => part.text).join("\n"));
        }
        if (payload.type === "task_started") {
          if (typeof payload.turn_id !== "string" || !payload.turn_id) refuse("missing turn identity");
          turn = payload.turn_id; stopped = false;
        }
        if (["task_complete", "turn_aborted"].includes(payload.type)) {
          if (!turn || payload.turn_id !== turn) refuse("unmatched terminal turn receipt");
          stopped = true;
        }
      }
      if (record.type !== "response_item" || payload.type !== "message") continue;
      if (payload.role === "assistant" && !["commentary", "final_answer"].includes(payload.phase))
        refuse("assistant message phase is ambiguous");
      if (payload.role !== "user" && !(payload.role === "assistant" && payload.phase === "final_answer")) continue;
      if (!Array.isArray(payload.content)) refuse("malformed message content");
      let content = payload.content;
      if (payload.role === "user") {
        const kinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds;
        if (!Array.isArray(kinds) || kinds.length !== content.length || kinds.some(kind => typeof kind !== "string"))
          refuse("owner-message provenance is missing or ambiguous");
        if (kinds.some(kind => kind.startsWith("user.") && kind !== "user.text")) refuse("non-text owner message cannot be carried completely");
        content = content.filter((_: unknown, i: number) => kinds[i] === "user.text");
        if (!content.length) continue; // Native AGENTS/environment/application context is not owner speech.
        stopped = false; // A late owner message after the terminal receipt must not be lost.
      }
      if (!content.length || content.some((part: {type?: string; text?: unknown}) =>
        part?.type !== (payload.role === "user" ? "input_text" : "output_text") || typeof part.text !== "string"))
        refuse("unsupported message content");
      const messageText = content.map((part: {text: string}) => part.text).join("\n");
      if (payload.role === "user") ownerMessages.push(messageText);
      messages.push({ role: payload.role, text: redactConversationText(messageText), sourceLine: index + 1 });
    }
    if (!turn || !stopped || !messages.some(message => message.role === "user")) refuse("missing owner history or final stopped-turn receipt");
    if (JSON.stringify(ownerReceipts) !== JSON.stringify(ownerMessages))
      refuse("owner-message records and native receipts disagree or are incomplete");
    const mapping = database.prepare("SELECT rollout_path, cwd, source FROM threads WHERE id=?").get(threadId);
    if (JSON.stringify(mapping) !== JSON.stringify(row) || realpathSync(row.rollout_path) !== path)
      refuse("thread mapping changed during capture");
    const after = fstatSync(fd), current = statSync(path);
    if (before.dev !== current.dev || before.ino !== current.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.size !== before.size ||
        current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs) refuse("source changed during capture");
    const evidence = sanitizeUntrustedPromptData({
      threadId, coverage: "complete local rollout; all proven owner text and assistant final replies in source order; no tool outputs or compaction summaries",
      sourceBytes: buffer.length, sourceRecords: lines.length, messages,
    });
    // Sanitize complete selected content before measuring. Never slice a decision or a credential.
    if (messages.length > MESSAGE_LIMIT || Buffer.byteLength(serializeUntrustedPromptData(evidence), "utf8") > CONTEXT_LIMIT)
      refuse("selected conversation exceeds 256 messages or 64 KiB; nothing was truncated");
    const fingerprint = createHash("sha256").update(buffer).update(JSON.stringify({ path, dev: before.dev, ino: before.ino, ctime: before.ctimeMs, mtime: before.mtimeMs })).digest("hex");
    return { evidence, fingerprint };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Predecessor conversation unavailable:")) throw error;
    // Native parse/SQLite errors may contain source material: report a fixed, non-secret reason.
    refuse("local state or rollout is missing, malformed, or unreadable");
  } finally {
    if (fd !== undefined) closeSync(fd);
    database?.close();
  }
}

export function assertPredecessorConversationUnchanged(threadId: string, worktree: string, fingerprint: string): void {
  if (capturePredecessorConversation(threadId, worktree).fingerprint !== fingerprint)
    refuse("source changed after capture");
}
