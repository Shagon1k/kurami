import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

type RpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
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

class AppServerClient {
  readonly #child;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #stderr: string[] = [];
  #nextId = 1;

  constructor(codexBin: string) {
    this.#child = spawn(codexBin, ["app-server", "--listen", "stdio://"], {
      env: process.env,
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
    let message: RpcResponse;
    try {
      message = JSON.parse(line) as RpcResponse;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
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

  close(): void {
    this.#child.stdin.end();
    this.#child.kill("SIGTERM");
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
