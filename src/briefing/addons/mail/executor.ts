import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { nodeHttpFetch } from "../../providers/node-http-fetch.ts";

export type MailActionExecutor = (input: {
  actionId: string;
  messageIds: string[];
}) => Promise<{ receipt: unknown }>;

export const MAIL_AUTOMATION_MAX_ATTEMPTS = 3;
const MAIL_AUTOMATION_RETRY_DELAYS_MS = [300, 900] as const;
const DEFAULT_MAIL_AUTOMATION_TIMEOUT_MS = 10_000;

export type MailAutomationFailureKind =
  | "fetch_failed"
  | "timeout"
  | "connection"
  | "rate_limited"
  | "upstream_unavailable"
  | "provider_rejected"
  | "unknown";

function errorDetails(error: unknown, seen = new Set<unknown>()): string[] {
  if (error === null || error === undefined || seen.has(error)) return [];
  seen.add(error);
  const details: string[] = [];
  if (error instanceof Error) {
    details.push(error.name, error.message);
    const enrichedError = error as Error & { cause?: unknown; code?: unknown };
    if (typeof enrichedError.code === "string") details.push(enrichedError.code);
    const cause = enrichedError.cause;
    if (cause !== undefined) details.push(...errorDetails(cause, seen));
  } else if (typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; errors?: unknown };
    if (typeof candidate.code === "string") details.push(candidate.code);
    if (typeof candidate.message === "string") details.push(candidate.message);
    if (Array.isArray(candidate.errors)) {
      for (const nested of candidate.errors) details.push(...errorDetails(nested, seen));
    }
  } else {
    details.push(String(error));
  }
  return details;
}

export function mailAutomationFailureKind(error: unknown): MailAutomationFailureKind {
  const details = errorDetails(error).join(" ").toLowerCase();
  if (details.includes("gmail provider rejected")) return "provider_rejected";
  if (details.includes("fetch failed")) return "fetch_failed";
  if (/abort|timeout|timed out|etimedout/.test(details)) return "timeout";
  if (/econnreset|econnrefused|enotfound|eai_again|socket hang up|network/.test(details)) {
    return "connection";
  }
  if (/\b429\b|rate.?limit|resource exhausted/.test(details)) return "rate_limited";
  if (/\b5\d{2}\b|bad gateway|service unavailable|gateway timeout/.test(details)) {
    return "upstream_unavailable";
  }
  return "unknown";
}

function transientMailAutomationFailure(kind: MailAutomationFailureKind): boolean {
  return kind !== "provider_rejected" && kind !== "unknown";
}

function mailAutomationTimeout(environment: NodeJS.ProcessEnv): number {
  const configured = Number.parseInt(environment.COMPOSIO_AUTOMATION_TIMEOUT_MS ?? "", 10);
  if (!Number.isInteger(configured)) return DEFAULT_MAIL_AUTOMATION_TIMEOUT_MS;
  return Math.min(30_000, Math.max(1_000, configured));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

type MailAutomationProviderDecision = "accepted" | "rejected" | "unknown";

function mailAutomationRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mailAutomationErrorPresent(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function mailAutomationProviderDecision(
  value: unknown,
  depth = 0,
): MailAutomationProviderDecision {
  const payload = mailAutomationRecord(value);
  if (!payload) return "unknown";
  if (payload.successful === false || payload.ok === false || mailAutomationErrorPresent(payload.error)) {
    return "rejected";
  }
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  if (["error", "failed", "failure", "rejected"].includes(status)) return "rejected";
  const nested: MailAutomationProviderDecision[] = [];
  if (depth < 1) {
    for (const wrapper of ["result", "data"] as const) {
      if (payload[wrapper] === undefined) continue;
      nested.push(mailAutomationProviderDecision(payload[wrapper], depth + 1));
    }
  }
  if (nested.includes("rejected")) return "rejected";
  if (payload.successful === true || payload.ok === true
    || ["ok", "success", "successful", "complete", "completed"].includes(status)) {
    return "accepted";
  }
  if (nested.includes("accepted")) return "accepted";
  return "unknown";
}

function mailAutomationTextPayload(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Mutation responses must include an explicit positive provider acknowledgement.
 * Provider payloads are deliberately never included in thrown errors or receipts.
 */
export function assertComposioMailActionSucceeded(value: unknown): void {
  const response = mailAutomationRecord(value);
  if (!response || response.isError === true) {
    throw new Error("Gmail provider rejected the batch action");
  }
  const decisions: MailAutomationProviderDecision[] = [mailAutomationProviderDecision(response)];
  if (response.structuredContent !== undefined) {
    decisions.push(mailAutomationProviderDecision(response.structuredContent));
  }
  if (Array.isArray(response.content)) {
    for (const entry of response.content) {
      const block = mailAutomationRecord(entry);
      if (block?.type !== "text") continue;
      decisions.push(mailAutomationProviderDecision(mailAutomationTextPayload(block.text)));
    }
  }
  if (decisions.includes("rejected") || !decisions.includes("accepted")) {
    throw new Error("Gmail provider rejected the batch action");
  }
}

export function composioMailActionExecutor(environment: NodeJS.ProcessEnv): MailActionExecutor | null {
  const url = environment.COMPOSIO_AUTOMATION_MCP_URL?.trim();
  const apiKey = environment.COMPOSIO_AUTOMATION_API_KEY?.trim();
  if (!url || !apiKey) return null;
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return null;
  const timeoutMs = mailAutomationTimeout(environment);
  const restrictedFetch: typeof fetch = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== endpoint.origin) throw new Error("Composio automation cross-origin request denied");
    return nodeHttpFetch(input, { ...init, redirect: "error" });
  };
  return async ({ actionId, messageIds }) => {
    let lastError: unknown = new Error("Gmail automation failed before execution");
    for (let attempt = 1; attempt <= MAIL_AUTOMATION_MAX_ATTEMPTS; attempt += 1) {
      const client = new Client({ name: "kurami-briefing", version: "1.0.0" });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const transport = new StreamableHTTPClientTransport(endpoint, {
        requestInit: {
          headers: { "x-api-key": apiKey },
          signal: controller.signal,
        },
        fetch: restrictedFetch,
      });
      let phase: "connect" | "callTool" = "connect";
      try {
        await client.connect(transport);
        phase = "callTool";
        const response = await client.callTool({
          name: "GMAIL_BATCH_MODIFY_MESSAGES",
          arguments: {
            userId: "me",
            messageIds,
            addLabelIds: [],
            removeLabelIds: ["INBOX", "UNREAD"],
          },
        });
        assertComposioMailActionSucceeded(response);
        if (attempt > 1) {
          console.info(JSON.stringify({
            event: "briefing.mail_action_recovered",
            actionId,
            attempt,
            phase,
          }));
        }
        return {
          receipt: {
            actionId,
            provider: "composio-gmail",
            messageCount: messageIds.length,
            attempts: attempt,
            completedAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        lastError = error;
        const kind = mailAutomationFailureKind(error);
        const willRetry = transientMailAutomationFailure(kind) && attempt < MAIL_AUTOMATION_MAX_ATTEMPTS;
        console.warn(JSON.stringify({
          event: "briefing.mail_action_attempt_failed",
          actionId,
          attempt,
          maxAttempts: MAIL_AUTOMATION_MAX_ATTEMPTS,
          phase,
          kind,
          willRetry,
        }));
        if (!willRetry) throw error;
      } finally {
        clearTimeout(timeout);
        await client.close().catch(() => undefined);
      }
      await wait(MAIL_AUTOMATION_RETRY_DELAYS_MS[attempt - 1] ?? 0);
    }
    throw lastError;
  };
}
