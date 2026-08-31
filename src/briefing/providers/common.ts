import { nodeHttpFetch } from "./node-http-fetch.ts";

export type ProviderState = "ready" | "empty" | "partial" | "stale" | "failed";

export type ProviderIssue = {
  code: string;
  message: string;
  transient: boolean;
};

export type ProviderResult<T> = {
  state: ProviderState;
  value: T | null;
  fetchedAt: string;
  attempts: number;
  issues: ProviderIssue[];
};

export type RetryPolicy = {
  attempts: number;
  timeoutMs: number;
  initialDelayMs: number;
  maximumDelayMs: number;
};

export type OperationOutcome<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; issue: ProviderIssue; attempts: number };

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 3,
  timeoutMs: 8_000,
  initialDelayMs: 250,
  maximumDelayMs: 2_000,
};

const SAFE_CODE = /^[a-z][a-z0-9_]{1,79}$/u;

export class ProviderError extends Error {
  readonly code: string;
  readonly transient: boolean;

  constructor(code: string, message: string, transient = false) {
    super(message);
    this.name = "ProviderError";
    this.code = SAFE_CODE.test(code) ? code : "provider_error";
    this.transient = transient;
  }
}

function boundedMessage(value: string): string {
  return value
    .replace(/https?:\/\/\S+/giu, "[remote endpoint]")
    .replace(/authorization\s*[:=]\s*(?:bearer\s+)?\S+/giu, "credential=[redacted]")
    .replace(/(?:api[-_ ]?key|bearer|token)\s*[:=]?\s*\S+/giu, "credential=[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240) || "Provider request failed";
}

export function providerIssue(error: unknown, fallbackCode = "provider_error"): ProviderIssue {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      message: boundedMessage(error.message),
      transient: error.transient,
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return {
      code: "provider_timeout",
      message: "Provider request timed out",
      transient: true,
    };
  }
  return {
    code: SAFE_CODE.test(fallbackCode) ? fallbackCode : "provider_error",
    message: boundedMessage(error instanceof Error ? error.message : String(error)),
    transient: false,
  };
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function normalizeRetryPolicy(
  value: Partial<RetryPolicy> = {},
): RetryPolicy {
  const attempts = Math.min(5, positiveInteger(value.attempts ?? 0, DEFAULT_RETRY_POLICY.attempts));
  const timeoutMs = Math.min(
    60_000,
    positiveInteger(value.timeoutMs ?? 0, DEFAULT_RETRY_POLICY.timeoutMs),
  );
  const initialDelayMs = Math.min(
    10_000,
    positiveInteger(value.initialDelayMs ?? 0, DEFAULT_RETRY_POLICY.initialDelayMs),
  );
  const maximumDelayMs = Math.max(
    initialDelayMs,
    Math.min(
      30_000,
      positiveInteger(value.maximumDelayMs ?? 0, DEFAULT_RETRY_POLICY.maximumDelayMs),
    ),
  );
  return { attempts, timeoutMs, initialDelayMs, maximumDelayMs };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ProviderError("provider_timeout", "Provider request timed out", true));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function retryOperation<T>(
  operation: (signal: AbortSignal, attempt: number) => Promise<T>,
  options: Partial<RetryPolicy> = {},
): Promise<OperationOutcome<T>> {
  const policy = normalizeRetryPolicy(options);
  let lastIssue: ProviderIssue = {
    code: "provider_error",
    message: "Provider request failed",
    transient: false,
  };

  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    try {
      const value = await withTimeout(
        (signal) => operation(signal, attempt),
        policy.timeoutMs,
      );
      return { ok: true, value, attempts: attempt };
    } catch (error) {
      lastIssue = providerIssue(error);
      if (!lastIssue.transient || attempt >= policy.attempts) {
        return { ok: false, issue: lastIssue, attempts: attempt };
      }
      const wait = Math.min(
        policy.maximumDelayMs,
        policy.initialDelayMs * (2 ** (attempt - 1)),
      );
      await delay(wait);
    }
  }
  return { ok: false, issue: lastIssue, attempts: policy.attempts };
}

export async function fetchJson(
  url: URL,
  options: {
    fetchImpl?: FetchLike;
    retry?: Partial<RetryPolicy>;
    maximumBytes?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<OperationOutcome<unknown>> {
  const fetchImpl = options.fetchImpl ?? nodeHttpFetch;
  const maximumBytes = Math.min(
    8 * 1024 * 1024,
    Math.max(1_024, options.maximumBytes ?? 2 * 1024 * 1024),
  );
  return retryOperation(async (signal) => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "kurami-digest-central-poller/1.0",
          ...options.headers,
        },
        redirect: "error",
        signal,
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new ProviderError("provider_timeout", "Provider request timed out", true);
      }
      throw new ProviderError("provider_network_error", "Provider network request failed", true);
    }
    if (!response.ok) {
      const transient = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `provider_http_${response.status}`,
        `Provider returned HTTP ${response.status}`,
        transient,
      );
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumBytes) {
      throw new ProviderError("provider_response_too_large", "Provider response exceeded its size limit");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ProviderError("provider_invalid_json", "Provider returned invalid JSON");
    }
  }, options.retry);
}

export function failSoft<T>(
  outcome: OperationOutcome<T>,
  fetchedAt = new Date().toISOString(),
): ProviderResult<T> {
  if (outcome.ok) {
    return {
      state: "ready",
      value: outcome.value,
      fetchedAt,
      attempts: outcome.attempts,
      issues: [],
    };
  }
  return {
    state: "failed",
    value: null,
    fetchedAt,
    attempts: outcome.attempts,
    issues: [outcome.issue],
  };
}
