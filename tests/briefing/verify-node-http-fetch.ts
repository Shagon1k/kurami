import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { nodeHttpFetch } from "../../src/briefing/providers/node-http-fetch.ts";

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/redirect") {
    response.writeHead(302, { location: "/get" });
    response.end();
    return;
  }
  if (url.pathname === "/delay") {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    }, 250);
    return;
  }
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    response.writeHead(url.pathname === "/post" ? 201 : 200, {
      "content-type": "application/json",
      "x-runtime-check": "bounded-http",
    });
    response.end(JSON.stringify({
      method: request.method,
      body: Buffer.concat(chunks).toString("utf8"),
      acceptEncoding: request.headers["accept-encoding"],
      custom: request.headers["x-custom"],
    }));
  });
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;

try {
  const get = await nodeHttpFetch(`${base}/get`, {
    headers: { "x-custom": "one" },
    redirect: "error",
  });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("x-runtime-check"), "bounded-http");
  assert.deepEqual(await get.json(), {
    method: "GET",
    body: "",
    acceptEncoding: "identity",
    custom: "one",
  });

  const post = await nodeHttpFetch(new Request(`${base}/post`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-custom": "base" },
    body: JSON.stringify({ ok: true }),
  }), {
    headers: { "x-custom": "override" },
  });
  assert.equal(post.status, 201);
  assert.deepEqual(await post.json(), {
    method: "POST",
    body: JSON.stringify({ ok: true }),
    acceptEncoding: "identity",
    custom: "override",
  });

  await assert.rejects(
    nodeHttpFetch(`${base}/redirect`, { redirect: "error" }),
    /Redirects are not allowed/u,
  );

  const controller = new AbortController();
  const delayed = nodeHttpFetch(`${base}/delay`, { signal: controller.signal });
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(delayed, (error: unknown) =>
    error instanceof Error && error.name === "AbortError");
} finally {
  server.close();
  await once(server, "close");
}

process.stdout.write("bounded Node HTTP transport verified\n");
