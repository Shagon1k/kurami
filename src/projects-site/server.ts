import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fontFiles } from "../ui-library/foundations/fonts.ts";
import { THEME_RUNTIME_JS } from "../ui-library/runtime/theme.ts";
import { ProjectsAccess } from "./access.ts";
import { collectProjectsSnapshot } from "./snapshot.ts";
import { renderProjectsDashboard, renderProjectsPage } from "./render.ts";
import { PROJECTS_STYLES } from "./styles.ts";
import type { ProjectsSnapshot } from "./model.ts";
import { requestProjectsReview, ProjectsActionError, type ReviewResult } from "./actions.ts";

const assetRoot = resolve(import.meta.dirname, "../ui-library/assets");
const assets = new Map<string, { body: Buffer | string; type: string }>([
  ["/assets/projects.css", { body: PROJECTS_STYLES, type: "text/css; charset=utf-8" }],
  ["/assets/projects.js", { body: readFileSync(resolve(import.meta.dirname, "client.js")), type: "text/javascript; charset=utf-8" }],
  ["/assets/theme.js", { body: THEME_RUNTIME_JS, type: "text/javascript; charset=utf-8" }],
  ["/assets/kurami-fox.webp", { body: readFileSync(resolve(assetRoot, "brand/kurami-fox-header.webp")), type: "image/webp" }],
  ["/assets/favicon.svg", { body: readFileSync(resolve(assetRoot, "brand/kurami-favicon.svg")), type: "image/svg+xml" }],
]);
for (const font of fontFiles) assets.set(`/assets/${font.file}`, { body: readFileSync(resolve(assetRoot, "fonts", font.file)), type: "font/woff2" });

export function createProjectsServer(options: {
  snapshot?: () => ProjectsSnapshot;
  authorize?: (request: IncomingMessage) => Promise<string | null>;
  cacheMs?: number;
  review?: (input: unknown, actor: string) => ReviewResult;
  origin?: string;
} = {}): Server {
  const access = new ProjectsAccess({ team: process.env.PROJECTS_ACCESS_TEAM ?? "", audience: process.env.PROJECTS_ACCESS_AUDIENCE ?? "", ownerEmail: process.env.PROJECTS_OWNER_EMAIL ?? "" });
  const authorize = options.authorize ?? (request => access.authorize(request));
  const snapshot = options.snapshot ?? collectProjectsSnapshot;
  const review = options.review ?? (process.env.PROJECTS_CONTROLS_ENABLED === "1" ? requestProjectsReview : null);
  let cached: { at: number; value: ProjectsSnapshot } | null = null;
  function current(): ProjectsSnapshot {
    const now = Date.now();
    if (cached && now - cached.at < (options.cacheMs ?? 5_000)) return cached.value;
    const value = snapshot();
    cached = { at: now, value };
    return value;
  }
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status: number, type: string, body: Buffer | string) => {
      response.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    const reviewRoute = request.method === "POST" && request.url === "/api/ai-review" && review;
    if (request.method !== "GET" && request.method !== "HEAD" && !reviewRoute) {
      response.setHeader("Allow", "GET, HEAD");
      send(405, "text/plain; charset=utf-8", "Method not allowed"); return;
    }
    if ((request.url?.length ?? 0) > 4_096) { send(414, "text/plain; charset=utf-8", "Request too large"); return; }
    let url: URL;
    try { url = new URL(request.url ?? "/", "http://localhost"); }
    catch { send(400, "text/plain; charset=utf-8", "Invalid URL"); return; }
    if (url.pathname === "/health") { send(200, "application/json; charset=utf-8", '{"ok":true}'); return; }
    if (url.pathname === "/robots.txt") { send(200, "text/plain; charset=utf-8", "User-agent: *\nDisallow: /\n"); return; }
    const identity = await authorize(request).catch(() => null);
    if (!identity) { send(403, "text/plain; charset=utf-8", "Доступ разрешён только владельцу через Cloudflare Access."); return; }
    if (reviewRoute && review) {
      if (request.headers.origin !== (options.origin ?? "https://projects.shagon1k.win") ||
        request.headers["content-type"] !== "application/json" ||
        request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") {
        send(403, "application/json", JSON.stringify({ error: "Запрос разрешён только со страницы Projects." })); return;
      }
      try {
        const body = await new Promise<string>((done, reject) => {
          let size = 0; const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 4096) reject(new ProjectsActionError(413, "Запрос слишком большой.")); else chunks.push(chunk); });
          request.on("end", () => done(Buffer.concat(chunks).toString("utf8"))); request.on("error", reject);
        });
        let input: unknown;
        try { input = JSON.parse(body); } catch { throw new ProjectsActionError(400, "Некорректный запрос."); }
        const result = review(input, identity); cached = null;
        send(result.state === "created" ? 202 : 200, "application/json; charset=utf-8", JSON.stringify(result));
      } catch (error) {
        send(error instanceof ProjectsActionError ? error.status : 503, "application/json; charset=utf-8",
          JSON.stringify({ error: error instanceof ProjectsActionError ? error.message : "AI Review временно недоступно." }));
      }
      return;
    }
    try {
      if (url.pathname === "/") send(200, "text/html; charset=utf-8", renderProjectsPage(current(), url.searchParams));
      else if (url.pathname === "/api/fragment") send(200, "text/html; charset=utf-8", renderProjectsDashboard(current(), url.searchParams));
      else {
        const asset = assets.get(url.pathname);
        if (asset) send(200, asset.type, asset.body);
        else send(404, "text/plain; charset=utf-8", "Not found");
      }
    } catch { send(503, "text/plain; charset=utf-8", "Projects временно недоступен."); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PROJECTS_PORT ?? 8777);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PROJECTS_PORT");
  createProjectsServer().listen(port, "127.0.0.1", () => console.log(`Kurami Projects listening on 127.0.0.1:${port}`));
}
