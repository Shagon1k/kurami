import { createHash } from "node:crypto";
import {
  ProviderError,
  providerIssue,
  retryOperation,
  type ProviderIssue,
  type ProviderResult,
  type RetryPolicy,
} from "./common.ts";
import {
  extractComposioPayload,
  type ComposioToolCaller,
} from "./composio-mcp.ts";

type JsonRecord = Record<string, unknown>;

export type MailClassification = "IMPORTANT" | "GENERAL";

export type NormalizedGmailMessage = {
  id: string;
  provider: "gmail";
  providerItemId: string;
  threadId: string | null;
  title: string;
  sender: string;
  summary: string;
  receivedAt: string;
  classification: MailClassification;
  labelIds: string[];
  externalUrl: string | null;
};

export type GmailSnapshot = {
  query: string;
  items: NormalizedGmailMessage[];
  unreadCount: number;
  pageCount: number;
};

export type GmailFetchOptions = {
  query: string;
  pageSize?: number;
  maximumPages?: number;
  retry?: Partial<RetryPolicy>;
  now?: () => Date;
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim()).filter(Boolean))]
    : [];
}

function boundedPlainText(value: unknown, maximum = 360): string {
  const plain = text(value)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
  if (plain.length <= maximum) return plain;
  return `${plain.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function isoTimestamp(value: unknown): string {
  let timestamp: number | string = typeof value === "number" || typeof value === "string"
    ? value
    : "";
  if (typeof timestamp === "string" && /^\d+$/u.test(timestamp)) timestamp = Number(timestamp);
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    if (timestamp < 100_000_000_000) timestamp *= 1_000;
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const parsed = new Date(String(timestamp));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  throw new ProviderError("gmail_invalid_timestamp", "Gmail message has no valid timestamp");
}

function safeUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function stableInternalId(providerItemId: string): string {
  return `mail_${createHash("sha256").update(`gmail:${providerItemId}`).digest("hex").slice(0, 20)}`;
}

function normalizeMessage(value: unknown): NormalizedGmailMessage | null {
  if (!isRecord(value)) return null;
  const providerItemId = text(value.messageId ?? value.id);
  if (!providerItemId) return null;
  const labelIds = strings(value.labelIds ?? value.label_ids).map((label) => label.toUpperCase());
  const title = boundedPlainText(value.subject, 220) || "Без темы";
  const sender = boundedPlainText(value.sender ?? value.from, 180) || "Неизвестный отправитель";
  const body = boundedPlainText(value.messageText ?? value.text ?? value.snippet, 420);
  return {
    id: stableInternalId(providerItemId),
    provider: "gmail",
    providerItemId,
    threadId: text(value.threadId ?? value.thread_id) || null,
    title,
    sender,
    summary: body,
    receivedAt: isoTimestamp(value.messageTimestamp ?? value.internalDate ?? value.date),
    classification: labelIds.includes("IMPORTANT") ? "IMPORTANT" : "GENERAL",
    labelIds,
    externalUrl: safeUrl(value.display_url ?? value.displayUrl),
  };
}

function unwrapEnvelope(value: unknown): { messages: unknown[]; nextPageToken: string } {
  const payload = extractComposioPayload(value);
  if (!isRecord(payload)) {
    throw new ProviderError("gmail_invalid_response", "Gmail provider returned an invalid response");
  }
  if (payload.successful === false) {
    throw new ProviderError("gmail_provider_error", "Gmail provider rejected the read request", true);
  }
  const data = isRecord(payload.data) ? payload.data : payload;
  const rawMessages = data.messages;
  if (rawMessages !== undefined && !Array.isArray(rawMessages)) {
    throw new ProviderError("gmail_invalid_messages", "Gmail provider returned an invalid message list");
  }
  return {
    messages: Array.isArray(rawMessages) ? rawMessages : [],
    nextPageToken: text(data.nextPageToken ?? data.next_page_token),
  };
}

function result(
  state: ProviderResult<GmailSnapshot>["state"],
  value: GmailSnapshot | null,
  fetchedAt: string,
  attempts: number,
  issues: ProviderIssue[],
): ProviderResult<GmailSnapshot> {
  return { state, value, fetchedAt, attempts, issues };
}

export async function fetchGmailSnapshot(
  caller: ComposioToolCaller,
  options: GmailFetchOptions,
): Promise<ProviderResult<GmailSnapshot>> {
  const query = options.query.trim();
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  if (!query) {
    return result(
      "failed",
      null,
      fetchedAt,
      0,
      [providerIssue(new ProviderError("gmail_query_missing", "Gmail query is required"))],
    );
  }
  const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize ?? 50)));
  const maximumPages = Math.min(100, Math.max(1, Math.trunc(options.maximumPages ?? 20)));
  const items = new Map<string, NormalizedGmailMessage>();
  const seenTokens = new Set<string>();
  const issues: ProviderIssue[] = [];
  let pageToken = "";
  let pageCount = 0;
  let attempts = 0;
  let exhausted = false;

  while (pageCount < maximumPages) {
    const arguments_: Record<string, unknown> = {
      query,
      user_id: "me",
      max_results: pageSize,
      include_payload: true,
      ids_only: false,
      verbose: true,
      include_spam_trash: false,
    };
    if (pageToken) arguments_.page_token = pageToken;
    const page = await retryOperation(
      (signal) => caller("GMAIL_FETCH_EMAILS", arguments_, signal).then(unwrapEnvelope),
      options.retry,
    );
    attempts += page.attempts;
    if (!page.ok) {
      issues.push(page.issue);
      break;
    }
    pageCount += 1;
    for (const raw of page.value.messages) {
      try {
        const normalized = normalizeMessage(raw);
        if (!normalized) {
          issues.push({
            code: "gmail_message_without_id",
            message: "Gmail message without a stable message ID was skipped",
            transient: false,
          });
          continue;
        }
        items.set(normalized.providerItemId, normalized);
      } catch (error) {
        issues.push(providerIssue(error, "gmail_normalization_error"));
      }
    }
    const next = page.value.nextPageToken;
    if (!next) {
      exhausted = true;
      break;
    }
    if (seenTokens.has(next) || next === pageToken) {
      issues.push({
        code: "gmail_pagination_loop",
        message: "Gmail pagination returned a repeated cursor",
        transient: false,
      });
      break;
    }
    seenTokens.add(next);
    pageToken = next;
  }
  if (!exhausted && pageCount >= maximumPages) {
    issues.push({
      code: "gmail_page_limit",
      message: "Gmail pagination reached its configured safety limit",
      transient: false,
    });
  }

  const normalizedItems = [...items.values()].sort((left, right) =>
    right.receivedAt.localeCompare(left.receivedAt));
  const snapshot: GmailSnapshot = {
    query,
    items: normalizedItems,
    unreadCount: normalizedItems.length,
    pageCount,
  };
  if (pageCount === 0 && issues.length > 0) return result("failed", null, fetchedAt, attempts, issues);
  if (issues.length > 0) return result("partial", snapshot, fetchedAt, attempts, issues);
  return result(normalizedItems.length === 0 ? "empty" : "ready", snapshot, fetchedAt, attempts, []);
}
