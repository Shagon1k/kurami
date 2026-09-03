import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ProviderError } from "./common.ts";
import { nodeHttpFetch } from "./node-http-fetch.ts";

export const COMPOSIO_READ_TOOLS = [
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
  "GOOGLECALENDAR_EVENTS_LIST",
  "YOUTUBE_GET_VIDEO_DETAILS_BATCH",
  "YOUTUBE_LIST_CHANNELS",
  "YOUTUBE_LIST_CHANNEL_VIDEOS",
  "YOUTUBE_SEARCH_YOU_TUBE",
] as const;

export type ComposioReadTool = typeof COMPOSIO_READ_TOOLS[number];

export type ComposioToolCaller = (
  name: ComposioReadTool,
  arguments_: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTextPayload(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new ProviderError(
      "composio_invalid_payload",
      "Composio returned a non-JSON tool payload",
    );
  }
}

/**
 * Extracts only the MCP result envelope. It deliberately does not recursively
 * inspect arbitrary tool data, because mail and calendar text is untrusted.
 */
export function extractComposioPayload(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (isRecord(value.structuredContent)) return value.structuredContent;
  if (!Array.isArray(value.content)) return value;
  for (const entry of value.content) {
    if (!isRecord(entry) || entry.type !== "text" || typeof entry.text !== "string") continue;
    return parseTextPayload(entry.text);
  }
  throw new ProviderError("composio_empty_payload", "Composio returned no structured payload");
}

export type ComposioReadConnection = {
  mcpUrl: string;
  apiKey: string;
  clientName?: string;
};

export function composioReadConnectionFromEnvironment(
  environment: NodeJS.ProcessEnv,
): ComposioReadConnection {
  const mcpUrl = environment.COMPOSIO_READ_MCP_URL?.trim();
  const apiKey = environment.COMPOSIO_READ_API_KEY?.trim();
  if (!mcpUrl || !apiKey) {
    throw new ProviderError(
      "composio_read_environment_missing",
      "Restricted Composio read runtime is unavailable",
    );
  }
  return { mcpUrl, apiKey };
}

function validateConnection(connection: ComposioReadConnection): URL {
  if (!connection.apiKey.trim()) {
    throw new ProviderError("composio_missing_api_key", "Composio read API key is missing");
  }
  let url: URL;
  try {
    url = new URL(connection.mcpUrl);
  } catch {
    throw new ProviderError("composio_invalid_url", "Composio read MCP URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ProviderError(
      "composio_unsafe_url",
      "Composio read MCP URL must be credential-free HTTPS",
    );
  }
  return url;
}

/**
 * Creates a narrow leaf-tool caller. Retry and timeout policy belong to the
 * provider so pagination failures can be reported as partial results.
 */
export function createComposioReadToolCaller(
  connection: ComposioReadConnection,
): ComposioToolCaller {
  const url = validateConnection(connection);
  const allowed = new Set<string>(COMPOSIO_READ_TOOLS);
  const restrictedFetch: typeof fetch = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== url.origin) {
      throw new ProviderError(
        "composio_cross_origin_request",
        "Composio transport attempted a cross-origin request",
      );
    }
    return nodeHttpFetch(input, { ...init, redirect: "error" });
  };
  return async (name, arguments_, signal) => {
    if (!allowed.has(name)) {
      throw new ProviderError("composio_tool_denied", "Requested Composio tool is not allowlisted");
    }
    const client = new Client({
      name: connection.clientName?.trim() || "kurami-digest-central-poller",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { "x-api-key": connection.apiKey } },
      fetch: restrictedFetch,
    });
    let aborted = false;
    const abort = (): void => {
      aborted = true;
      void client.close().catch(() => undefined);
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) {
        throw new ProviderError("provider_timeout", "Provider request timed out", true);
      }
      await client.connect(transport);
      if (aborted) throw new ProviderError("provider_timeout", "Provider request timed out", true);
      const response = await client.callTool({ name, arguments: arguments_ });
      if (response.isError) {
        throw new ProviderError(
          "composio_tool_error",
          "Composio read tool rejected the request",
          true,
        );
      }
      return extractComposioPayload(response);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (aborted || signal?.aborted) {
        throw new ProviderError("provider_timeout", "Provider request timed out", true);
      }
      throw new ProviderError("composio_transport_error", "Composio read transport failed", true);
    } finally {
      signal?.removeEventListener("abort", abort);
      await client.close().catch(() => undefined);
    }
  };
}
