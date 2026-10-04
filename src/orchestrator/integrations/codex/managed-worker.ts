import { readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AppServerClient, detachedCodexEnvironment } from "./app-server.ts";
import { markTaskFailure, recordTurnCompleted, taskForSession, type ProtocolTask } from "./task-store.ts";

import { completedWorkerSummary } from "./worker-diagnostic.ts";

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export async function executeManagedTask(database: DatabaseSync, task: ProtocolTask, options: {
  codexBin: string; cwd: string; canonicalRepository: string; prompt: string; title: string;
  timeoutMs: number; environment?: NodeJS.ProcessEnv;
  onError?: (error: unknown) => void;
}): Promise<void> {
  if (!["ci_repair", "review_fix"].includes(task.kind)) throw new Error("Unsupported protocol task kind");
  const git = (...args: string[]) => execFileSync("git", ["-C", options.cwd, ...args], { encoding: "utf8" }).trim();
  const common = git("rev-parse","--path-format=absolute","--git-common-dir");
  const isolated = git("rev-parse","--path-format=absolute","--git-dir");
  const canonical = realpathSync(options.canonicalRepository);
  const expectedCommon = execFileSync("git", ["-C", canonical,"rev-parse","--path-format=absolute","--git-dir"], { encoding:"utf8" }).trim();
  if (task.worktree_path !== options.cwd || git("branch","--show-current") !== task.branch_name ||
      realpathSync(options.cwd) !== options.cwd || canonical !== options.canonicalRepository ||
      common !== expectedCommon || !isolated.startsWith(common + "/worktrees/"))
    throw new Error("Protocol worker requires the exact linked worktree and canonical Git directories");
  const owner = () => database.prepare(`SELECT r.owner_state, r.stop_reason, rr.tmux_session_name,
      rr.worktree_path, rr.branch_name, rr.codex_thread_id FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id=?`)
    .get(task.run_id) as { owner_state: string; stop_reason: string | null; tmux_session_name: string | null;
      worktree_path: string; branch_name: string; codex_thread_id: string | null };
  const checkOwner = () => {
    const current = owner();
    if (current.owner_state !== "cli" || current.tmux_session_name !== task.session_name ||
        current.worktree_path !== task.worktree_path || current.branch_name !== task.branch_name ||
        (task.thread_id !== null && current.codex_thread_id !== task.thread_id) ||
        taskForSession(database,task.session_name)?.task_id !== task.task_id ||
        taskForSession(database,task.session_name)?.released_at)
      throw new Error("Protocol worker ownership fence changed");
  };
  checkOwner();
  // Writers receive only the existing writer token. Reviewer App identity remains stripped.
  const environment = detachedCodexEnvironment(options.environment ?? process.env);
  if ((options.environment ?? process.env).GH_TOKEN)
    environment.GH_TOKEN = (options.environment ?? process.env).GH_TOKEN;
  let interaction = false;
  const finalItems = new Map<string, { type: string; phase: string; text: string }>();
  const pending: Array<{ method?: string; params?: unknown }> = [];
  const client = new AppServerClient(options.codexBin, {
    cwd: options.cwd, environment, rejectServerRequests: true,
    args: ["-c", `projects.${JSON.stringify(canonical)}.trust_level="trusted"`],
    onInteraction: () => { interaction = true; markTaskFailure(database, task.task_id, "permission_request_denied"); },
    onNotification: (message) => {
      const params = message.params as { threadId?: string; turnId?: string; item?: unknown; turn?: { id?: string; items?: unknown } } | undefined;
      if (message.method === "item/completed") {
        const text = completedWorkerSummary([params?.item]);
        if (text && params?.threadId === task.thread_id && params.turnId &&
            (!task.turn_id || params.turnId === task.turn_id) && finalItems.size < 16)
          finalItems.set(params.turnId, { type: "agentMessage", phase: "final_answer", text });
        return;
      }
      if (message.method !== "turn/completed") return;
      const final = params?.turn?.id ? finalItems.get(params.turn.id) : undefined;
      const receipt = final && params?.threadId === task.thread_id
        ? { ...message, params: { ...params, turn: { ...params.turn, items: [final] } } } : message;
      if (!task.turn_id) { if (pending.length < 16) pending.push(receipt); }
      else recordTurnCompleted(database, task.task_id, receipt);
    },
  });
  let interrupted = false;
  const onSignal = () => { interrupted = true; };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  try {
    await client.initialize(true);
    // Never retry a turn/start whose response may have been lost.
    if (task.phase !== "claimed") throw new Error("Task already dispatched; read history for recovery");
    const started = await client.request("thread/start", {
      cwd: options.cwd, sandbox: "workspace-write", approvalPolicy: "never",
      approvalsReviewer: "auto_review", historyMode: "legacy", threadSource: "kurami_managed",
      config: { "sandbox_workspace_write.network_access": true,
        "sandbox_workspace_write.writable_roots": [isolated, common] },
    }) as { thread?: { id?: string } };
    const threadId = started.thread?.id;
    if (typeof threadId !== "string" || !threadId) throw new Error("Missing thread identity");
    database.exec("BEGIN IMMEDIATE");
    try {
      checkOwner();
      database.prepare("UPDATE run_codex_tasks SET thread_id=?,phase='thread_bound' WHERE task_id=? AND phase='claimed'")
        .run(threadId,task.task_id);
      database.prepare("UPDATE run_resources SET codex_thread_id=? WHERE run_id=? AND tmux_session_name=?")
        .run(threadId,task.run_id,task.session_name);
      if (task.kind === "ci_repair") database.prepare("UPDATE run_ci_repair_attempts SET codex_thread_id=? WHERE attempt_id=?").run(threadId,task.context_id);
      if (task.kind === "review_fix") database.prepare("UPDATE run_review_fix_rounds SET codex_thread_id=? WHERE round_id=?").run(threadId,task.context_id);
      database.exec("COMMIT");
    } catch(error) { database.exec("ROLLBACK"); throw error; }
    task.thread_id = threadId;
    await client.request("thread/name/set", { threadId, name: options.title });
    checkOwner();
    if (owner().stop_reason || taskForSession(database,task.session_name)?.stop_requested || interrupted) return;
    database.prepare("UPDATE run_codex_tasks SET phase='starting_turn' WHERE task_id=?").run(task.task_id);
    const result = await client.request("turn/start", {
      threadId, clientUserMessageId: task.task_id, input: [{ type:"text",text:options.prompt }],
      sandboxPolicy: { type:"workspaceWrite", writableRoots:[options.cwd,isolated,common],
        networkAccess:true, excludeTmpdirEnvVar:false, excludeSlashTmp:false },
      approvalPolicy:"never", approvalsReviewer:"auto_review",
    }) as { turn?: { id?: string } };
    if (typeof result.turn?.id !== "string" || !result.turn.id) throw new Error("Missing turn identity");
    task.turn_id = result.turn.id;
    database.prepare("UPDATE run_codex_tasks SET turn_id=?,phase='running' WHERE task_id=?").run(task.turn_id,task.task_id);
    for (const message of pending) recordTurnCompleted(database,task.task_id,message);
    const deadline = Date.parse(task.created_at) + options.timeoutMs;
    while (!taskForSession(database,task.session_name)?.turn_status) {
      checkOwner();
      const current = taskForSession(database,task.session_name)!;
      if (interaction || interrupted || owner().stop_reason || current.stop_requested || Date.now() >= deadline) {
        const code = interaction ? "permission_request_denied" :
          current.stop_requested === "timeout" || Date.now() >= deadline ? "runtime_budget_exceeded" : "protocol_cancelled";
        markTaskFailure(database,task.task_id,code);
        await client.request("turn/interrupt", { threadId,turnId:task.turn_id });
        await client.waitForNotification((message) => message.method === "turn/completed" &&
          (message.params as { threadId?: string; turn?: {id?: string} })?.threadId === threadId &&
          (message.params as { turn?: {id?: string} })?.turn?.id === task.turn_id, 10_000);
        break;
      }
      // Lifecycle is event driven. Poll only the local cancellation fence.
      client.assertConnected();
      await delay(250);
    }
  } catch (error) {
    options.onError?.(error);
    markTaskFailure(database,task.task_id,interaction ? "permission_request_denied" : "protocol_disconnect_or_ambiguous_dispatch");
  } finally {
    process.removeListener("SIGTERM",onSignal); process.removeListener("SIGINT",onSignal);
    await client.shutdown();
    database.prepare("UPDATE run_codex_tasks SET stopped_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE task_id=?").run(task.task_id);
  }
}

if (import.meta.main) {
  process.umask(0o077);
  const home = process.env.KURAMI_HOME!;
  const database = new DatabaseSync(resolve(home,"state/orchestrator.db"), { timeout:5_000 });
  database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  try {
    const task = database.prepare("SELECT * FROM run_codex_tasks WHERE task_id=?").get(process.env.HERMES_CODEX_TASK_ID!) as ProtocolTask;
    if (!task || task.released_at) throw new Error("Missing exact managed task claim");
    const promptPath = process.env.HERMES_INITIAL_PROMPT_FILE!;
    if (statSync(promptPath).mode & 0o077) throw new Error("Prompt permissions are too broad");
    const prompt = Buffer.from(readFileSync(promptPath,"utf8"),"base64").toString("utf8");
    unlinkSync(promptPath);
    const config = JSON.parse(process.env.HERMES_CODEX_TASK_OPTIONS!) as { title:string; timeoutMs:number };
    await executeManagedTask(database,task, { codexBin:process.env.CODEX_BIN!,cwd:process.env.HERMES_WORKTREE_PATH!,
      canonicalRepository:process.env.HERMES_CANONICAL_REPOSITORY!,prompt,...config });
  } finally { database.close(); }
}
