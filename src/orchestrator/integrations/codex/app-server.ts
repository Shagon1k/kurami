import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { reviewerAppEnvironmentKeys } from "../github/app-auth.ts";
import { isSecretEnvironmentName } from "../../security/prompt-safety.ts";

type RpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type RpcNotification = {
  method?: string;
  params?: unknown;
};

type RpcServerRequest = {
  id?: number | string;
  method?: string;
  params?: unknown;
};

type ThreadSummary = {
  id: string;
  cwd?: string;
  name?: string | null;
  createdAt?: number;
  status?: {
    type?: string;
    activeFlags?: string[];
  };
};

type ThreadListResult = {
  data?: ThreadSummary[];
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type ThreadSyncResult = {
  threadId: string | null;
  previousName: string | null;
  currentName: string | null;
  renamed: boolean;
};

export type ThreadArchiveResult = {
  threadId: string;
  archived: true;
};

export function detachedCodexEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result = { ...environment };
  for (const name of Object.keys(result)) {
    if (isSecretEnvironmentName(name)) delete result[name];
  }
  for (const name of reviewerAppEnvironmentKeys) delete result[name];
  return result;
}

class AppServerClient {
  readonly #child;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #stderr: string[] = [];
  readonly #notifications: RpcNotification[] = [];
  readonly #notificationListeners = new Set<(message: RpcNotification) => void>();
  readonly #fatalListeners = new Set<(error: Error) => void>();
  readonly #rejectServerRequests: boolean;
  #fatalError: Error | null = null;
  #nextId = 1;

  constructor(codexBin: string, options: { rejectServerRequests?: boolean } = {}) {
    this.#rejectServerRequests = options.rejectServerRequests ?? false;
    // The worker owns GitHub App authentication around the detached review.
    // Do not expose tokens, app identity, or the private-key path to Codex.
    this.#child = spawn(codexBin, ["app-server", "--listen", "stdio://"], {
      env: detachedCodexEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#handleLine(line));
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk: string) => {
      this.#stderr.push(chunk);
      if (this.#stderr.join("").length > 8_000) this.#stderr.shift();
    });
    this.#child.on("exit", (code, signal) => {
      const details = this.#stderr.join("").trim();
      const error = new Error(
        `Codex app-server exited before completing requests: code=${code ?? "none"}, signal=${signal ?? "none"}${details ? `; ${details}` : ""}`,
      );
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.#pending.clear();
    });
  }

  #handleLine(line: string): void {
    let message: RpcResponse & RpcNotification & RpcServerRequest;
    try {
      message = JSON.parse(line) as RpcResponse;
    } catch {
      return;
    }
    if (message.id !== undefined && message.method) {
      if (!this.#rejectServerRequests) return;
      const approvalMethods = new Set([
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "execCommandApproval",
        "applyPatchApproval",
      ]);
      if (approvalMethods.has(message.method)) {
        this.#send({ id: message.id, result: { decision: "decline" } });
      } else if (message.method === "mcpServer/elicitation/request") {
        this.#send({
          id: message.id,
          result: { action: "decline", content: null },
        });
      } else if (message.method === "item/tool/requestUserInput") {
        this.#send({ id: message.id, result: { answers: {} } });
      } else {
        this.#send({
          id: message.id,
          error: {
            code: -32601,
            message: "Detached reviews do not accept interactive requests",
          },
        });
      }
      this.#recordFatal(
        new Error(
          `Detached Codex review requested forbidden interaction: ${message.method}`,
        ),
      );
      return;
    }
    if (typeof message.id !== "number") {
      if (!message.method) return;
      this.#notifications.push(message);
      if (this.#notifications.length > 200) this.#notifications.shift();
      for (const listener of this.#notificationListeners) listener(message);
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        new Error(
          `Codex app-server RPC failed${message.error.code ? ` (${message.error.code})` : ""}: ${message.error.message ?? "unknown error"}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  #recordFatal(error: Error): void {
    if (this.#fatalError) return;
    this.#fatalError = error;
    for (const listener of this.#fatalListeners) listener(error);
  }

  #send(message: unknown): void {
    if (!this.#child.stdin.writable) {
      throw new Error("Codex app-server stdin is not writable");
    }
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    const id = this.#nextId;
    this.#nextId += 1;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, 10_000);
      this.#pending.set(id, { resolve, reject, timer });
    });
    this.#send({ method, id, params });
    return promise;
  }

  notify(method: string, params: unknown = {}): void {
    this.#send({ method, params });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "kurami_orchestrator",
        title: "Kurami Dev Orchestrator",
        version: "1.0.0",
      },
    });
    this.notify("initialized", {});
  }

  async waitForNotification(
    predicate: (message: RpcNotification) => boolean,
    timeoutMs: number,
  ): Promise<RpcNotification> {
    if (this.#fatalError) throw this.#fatalError;
    const existing = this.#notifications.find(predicate);
    if (existing) return existing;
    return await new Promise<RpcNotification>((resolveWait, rejectWait) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        this.#notificationListeners.delete(listener);
        this.#fatalListeners.delete(fatalListener);
      };
      const listener = (message: RpcNotification): void => {
        if (!predicate(message)) return;
        cleanup();
        resolveWait(message);
      };
      const fatalListener = (error: Error): void => {
        cleanup();
        rejectWait(error);
      };
      const timer = setTimeout(() => {
        cleanup();
        rejectWait(new Error("Codex review turn timed out"));
      }, timeoutMs);
      this.#notificationListeners.add(listener);
      this.#fatalListeners.add(fatalListener);
    });
  }

  close(): void {
    this.#child.stdin.end();
    this.#child.kill("SIGTERM");
  }
}

type ReviewTurn = {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error?: { message?: string } | null;
  items?: Array<
    | { type: "exitedReviewMode"; review: string }
    | { type: "agentMessage"; text: string }
    | { type: string }
  >;
};

type ThreadStartResponse = { thread?: { id?: string } };
type ReviewStartResponse = {
  turn?: ReviewTurn;
  reviewThreadId?: string;
};

export type DetachedReviewResult = {
  parentThreadId: string;
  reviewThreadId: string;
  turnId: string;
  review: string;
};

export async function runDetachedReview(
  codexBin: string,
  options: {
    cwd: string;
    title: string;
    instructions: string;
    timeoutMs?: number;
    onStarted?: (reviewThreadId: string, turnId: string) => void;
  },
): Promise<DetachedReviewResult> {
  const client = new AppServerClient(codexBin, { rejectServerRequests: true });
  let parentThreadId: string | null = null;
  let reviewThreadId: string | null = null;
  try {
    await client.initialize();
    const started = (await client.request("thread/start", {
      cwd: options.cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      approvalsReviewer: "auto_review",
      threadSource: "kurami_ai_review",
    })) as ThreadStartResponse;
    parentThreadId = started.thread?.id ?? null;
    if (!parentThreadId) throw new Error("Codex returned no review parent thread ID");
    await client.request("thread/name/set", {
      threadId: parentThreadId,
      name: `${options.title} · review bootstrap`,
    });
    const reviewStarted = (await client.request("review/start", {
      threadId: parentThreadId,
      target: { type: "custom", instructions: options.instructions },
      delivery: "detached",
    })) as ReviewStartResponse;
    reviewThreadId = reviewStarted.reviewThreadId ?? null;
    const turnId = reviewStarted.turn?.id;
    if (!reviewThreadId || !turnId)
      throw new Error("Codex returned no detached review task identity");
    await client.request("thread/name/set", {
      threadId: reviewThreadId,
      name: options.title,
    });
    options.onStarted?.(reviewThreadId, turnId);
    const notification = await client.waitForNotification((message) => {
      if (message.method !== "turn/completed") return false;
      const params = message.params as
        | { threadId?: string; turn?: { id?: string } }
        | undefined;
      return params?.threadId === reviewThreadId && params.turn?.id === turnId;
    }, options.timeoutMs ?? 30 * 60 * 1_000);
    const turn = (notification.params as { turn: ReviewTurn }).turn;
    if (turn.status !== "completed")
      throw new Error(
        `Codex review did not complete: ${turn.status}${turn.error?.message ? ` (${turn.error.message})` : ""}`,
      );
    const review =
      turn.items
        ?.filter(
          (item): item is { type: "exitedReviewMode"; review: string } =>
            item.type === "exitedReviewMode" && "review" in item,
        )
        .at(-1)?.review ??
      turn.items
        ?.filter(
          (item): item is { type: "agentMessage"; text: string } =>
            item.type === "agentMessage" && "text" in item,
        )
        .at(-1)?.text;
    if (!review?.trim()) throw new Error("Codex review returned no result");
    return {
      parentThreadId,
      reviewThreadId,
      turnId,
      review: review.trim(),
    };
  } finally {
    for (const threadId of [reviewThreadId, parentThreadId]) {
      if (!threadId) continue;
      try {
        await client.request("thread/archive", { threadId });
      } catch {
        // Review state remains authoritative; a later retention sweep can retry.
      }
    }
    client.close();
  }
}

export async function findAndNameThread(
  codexBin: string,
  cwd: string,
  desiredName: string,
): Promise<ThreadSyncResult> {
  const client = new AppServerClient(codexBin);
  try {
    await client.initialize();
    const response = (await client.request("thread/list", {
      cwd,
      sourceKinds: ["cli"],
      archived: false,
      limit: 10,
      sortKey: "created_at",
      sortDirection: "desc",
    })) as ThreadListResult;
    const thread = response.data?.find(
      (candidate) => !candidate.cwd || candidate.cwd === cwd,
    );
    if (!thread) {
      return {
        threadId: null,
        previousName: null,
        currentName: null,
        renamed: false,
      };
    }
    const previousName = thread.name ?? null;
    if (previousName !== desiredName) {
      await client.request("thread/name/set", {
        threadId: thread.id,
        name: desiredName,
      });
    }
    return {
      threadId: thread.id,
      previousName,
      currentName: desiredName,
      renamed: previousName !== desiredName,
    };
  } finally {
    client.close();
  }
}

export async function archiveThread(
  codexBin: string,
  threadId: string,
): Promise<ThreadArchiveResult> {
  const client = new AppServerClient(codexBin);
  try {
    await client.initialize();
    await client.request("thread/archive", { threadId });
    return { threadId, archived: true };
  } finally {
    client.close();
  }
}
