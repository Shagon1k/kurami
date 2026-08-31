import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const MAXIMUM_RESPONSE_BYTES = 32 * 1024 * 1024;

function abortError(): DOMException {
  return new DOMException("This operation was aborted", "AbortError");
}

async function bodyBuffer(body: BodyInit | null | undefined): Promise<Buffer | null> {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), "utf8");
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body instanceof ReadableStream) {
    return Buffer.from(await new Response(body).arrayBuffer());
  }
  throw new TypeError("Unsupported request body for bounded Node HTTP transport");
}

function responseHeaders(source: import("node:http").IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.append(name, value);
    }
  }
  return headers;
}

/**
 * A small buffered Fetch-compatible transport backed by node:http/https.
 *
 * Node 24's global fetch depends on WebAssembly and therefore cannot run in
 * Kurami's `--jitless` services. This transport deliberately supports the
 * finite JSON/SSE request-response shape used by Open-Meteo and MCP while
 * refusing non-HTTP protocols, automatic redirects, unbounded responses, and
 * unsupported streaming/form-data request bodies.
 */
export const nodeHttpFetch: typeof fetch = async (input, init = {}) => {
  const sourceRequest = input instanceof Request ? input : null;
  const url = new URL(sourceRequest?.url ?? String(input));
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Bounded Node HTTP transport requires HTTP or HTTPS");
  }
  const method = (init.method ?? sourceRequest?.method ?? "GET").toUpperCase();
  const headers = new Headers(sourceRequest?.headers);
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
  const signal = init.signal ?? sourceRequest?.signal;
  if (signal?.aborted) throw abortError();

  const body = init.body !== undefined
    ? await bodyBuffer(init.body)
    : sourceRequest?.body ? Buffer.from(await sourceRequest.arrayBuffer()) : null;
  if ((method === "GET" || method === "HEAD") && body !== null) {
    throw new TypeError(`${method} requests cannot include a body`);
  }
  if (body !== null && !headers.has("content-length")) {
    headers.set("content-length", String(body.byteLength));
  }
  const rawHeaders: Record<string, string> = {};
  headers.forEach((value, name) => {
    rawHeaders[name] = value;
  });

  return await new Promise<Response>((resolveResponse, rejectResponse) => {
    let settled = false;
    const settleReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      rejectResponse(error);
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method,
      headers: rawHeaders,
      signal: signal ?? undefined,
    }, (response) => {
      const status = response.statusCode ?? 500;
      if (status >= 300 && status < 400 && init.redirect === "error") {
        response.resume();
        settleReject(new TypeError("Redirects are not allowed"));
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      response.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += value.byteLength;
        if (received > MAXIMUM_RESPONSE_BYTES) {
          response.destroy();
          settleReject(new TypeError("HTTP response exceeded its bounded size"));
          return;
        }
        chunks.push(value);
      });
      response.once("aborted", () => settleReject(new TypeError("HTTP response was aborted")));
      response.once("error", settleReject);
      response.once("end", () => {
        if (settled) return;
        settled = true;
        const value = Buffer.concat(chunks);
        const noBody = method === "HEAD" || status === 204 || status === 205 || status === 304;
        resolveResponse(new Response(noBody ? null : value, {
          status,
          statusText: response.statusMessage,
          headers: responseHeaders(response.headers),
        }));
      });
    });
    request.once("error", (error) => {
      settleReject(signal?.aborted ? abortError() : error);
    });
    if (body !== null) request.end(body);
    else request.end();
  });
};
