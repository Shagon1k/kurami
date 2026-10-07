import {language,sourceText,type Language} from "./i18n.ts";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fontFiles } from "../ui-library/foundations/fonts.ts";
import { THEME_RUNTIME_JS } from "../ui-library/runtime/theme.ts";
import {AccessVerificationUnavailableError,accessUnavailableMessage} from "../web/access-keys.ts";
import { collectProjectsSnapshot } from "./snapshot.ts";
import { renderProjectsDashboard, renderProjectsPage,renderProjectPrControl } from "./render.ts";
import { PROJECTS_STYLES } from "./styles.ts";
import type { ProjectsSnapshot } from "./model.ts";
import { requestProjectsReview, ProjectsActionError, type ReviewResult } from "./actions.ts";
import { requestProjectStatus, type StatusResult } from "./status.ts";
import { requestProjectRunAction } from "./run-actions.ts";
import {inspectProjectPr,requestProjectPr,type PrActionView,type PrActionResult} from "./pr-actions.ts";
import {isMountedRequest,mountResponse,WEB_CLIENT_JS} from "../web/presentation.ts";
import {PROJECTS_CLIENT_VERSION,PROJECTS_CLIENT_JS} from "./client-version.ts";
import {WebAccess} from "../web/access.ts";
import {WEB_ORIGIN} from "../web/routes.ts";

const assetRoot = resolve(import.meta.dirname, "../ui-library/assets");
const assets = new Map<string, { body: Buffer | string; type: string }>([
  ["/assets/projects.css", { body: PROJECTS_STYLES, type: "text/css; charset=utf-8" }],
  ["/assets/projects.js", { body: PROJECTS_CLIENT_JS, type: "text/javascript; charset=utf-8" }],
  ["/assets/theme.js", { body: WEB_CLIENT_JS+THEME_RUNTIME_JS, type: "text/javascript; charset=utf-8" }],
  ["/assets/kurami-fox.webp", { body: readFileSync(resolve(assetRoot, "brand/kurami-fox-header.webp")), type: "image/webp" }],
  ["/assets/favicon.svg", { body: readFileSync(resolve(assetRoot, "brand/kurami-favicon.svg")), type: "image/svg+xml" }],
]);
for (const font of fontFiles) assets.set(`/assets/${font.file}`, { body: readFileSync(resolve(assetRoot, "fonts", font.file)), type: "font/woff2" });

export function createProjectsServer(options: {
  snapshot?: () => ProjectsSnapshot;
  authorize?: (request: IncomingMessage) => Promise<string | null>;
  cacheMs?: number;
  review?: (input: unknown, actor: string) => ReviewResult;
  statusChange?: (input: unknown, actor: string) => Promise<StatusResult>;
  runAction?: (input: unknown, actor: string) => ReviewResult;
  prInspect?: (project:string,itemId:string) => Promise<PrActionView>;
  prAction?: (input:unknown,actor:string) => Promise<PrActionResult>;
  prCacheMs?:number;
  origin?: string;
} = {}): Server {
  // Projects is reached only through the unified gateway; the old projects.* host is gone, so a request that
  // did not come through the gateway has no owner identity.
  const webAccess=new WebAccess();
  const authorize=options.authorize??(async(request:IncomingMessage)=>isMountedRequest(request,"projects")?(await webAccess.authorize(request,"projects"))?.actor??null:null);
  const snapshot = options.snapshot ?? collectProjectsSnapshot;
  const review = options.review ?? (process.env.PROJECTS_CONTROLS_ENABLED === "1" ? requestProjectsReview : null);
  const statusChange = options.statusChange ?? (process.env.PROJECTS_STATUS_ENABLED === "1" ? requestProjectStatus : null);
  const runAction = options.runAction ?? (process.env.PROJECTS_CONTROLS_ENABLED === "1" ? requestProjectRunAction : null);
  const prInspect=options.prInspect??(process.env.PROJECTS_CONTROLS_ENABLED==="1"?inspectProjectPr:null);
  const prAction=options.prAction??(process.env.PROJECTS_CONTROLS_ENABLED==="1"?requestProjectPr:null);
  const prCache=new Map<string,{at:number;value:Promise<PrActionView>}>();
  let cached: { at: number; value: ProjectsSnapshot } | null = null;
  function current(): ProjectsSnapshot {
    const now = Date.now();
    if (cached && now - cached.at < (options.cacheMs ?? 5_000)) return cached.value;
    const value = snapshot();
    cached = { at: now, value };
    return value;
  }
  return createServer(async (request, response) => {
    mountResponse(request,response,"projects");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Kurami-Projects-Version",PROJECTS_CLIENT_VERSION);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    let lang:Language=request.headers["accept-language"]?.toLowerCase().startsWith("ru")?"ru":"en";
    const send = (status: number, type: string, body: Buffer | string) => {
      if(typeof body==="string"&&type.startsWith("text/plain"))body=sourceText(body,lang);
      if(typeof body==="string"&&type.startsWith("application/json")) {
        try{const value=JSON.parse(body);if(typeof value.error==="string")body=JSON.stringify({...value,error:sourceText(value.error,lang)});}catch{}
      }
      response.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    const reviewRoute = request.method === "POST" && request.url === "/api/ai-review" && review;
    const statusRoute = request.method === "POST" && request.url === "/api/status" && statusChange;
    const runRoute = request.method === "POST" && request.url === "/api/run-action" && runAction;
    const prRoute=request.method==="POST"&&request.url==="/api/pr-action"&&prAction;
    if (request.method !== "GET" && request.method !== "HEAD" && !reviewRoute && !statusRoute && !runRoute&&!prRoute) {
      response.setHeader("Allow", "GET, HEAD");
      send(405, "text/plain; charset=utf-8", "Method not allowed"); return;
    }
    if ((request.url?.length ?? 0) > 4_096) { send(414, "text/plain; charset=utf-8", "Request too large"); return; }
    let url: URL;
    try { url = new URL(request.url ?? "/", "http://localhost"); }
    catch { send(400, "text/plain; charset=utf-8", "Invalid URL"); return; }
    if(request.method!=="POST")lang=language(url.searchParams);
    if (url.pathname === "/health") { send(200, "application/json; charset=utf-8", '{"ok":true}'); return; }
    if (url.pathname === "/robots.txt") { send(200, "text/plain; charset=utf-8", "User-agent: *\nDisallow: /\n"); return; }
    let identity:string|null;
    try{identity=await authorize(request);}catch(error){
      if(error instanceof AccessVerificationUnavailableError){response.setHeader("Retry-After","10");send(503,"text/plain; charset=utf-8",accessUnavailableMessage(lang));return;}
      identity=null;
    }
    if (!identity) { send(403, "text/plain; charset=utf-8", "Доступ разрешён только владельцу через Cloudflare Access."); return; }
    if (reviewRoute || statusRoute || runRoute||prRoute) {
      if (request.headers.origin !== (options.origin ?? WEB_ORIGIN) ||
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
        if(prRoute&&prAction) {
          const result=await prAction(input,identity);cached=null;prCache.clear();
          send(result.state==="applied"?200:["failed","conflict"].includes(result.state)?409:202,"application/json; charset=utf-8",JSON.stringify(result));
        } else if (statusRoute && statusChange) {
          const result = await statusChange(input, identity); cached = null;
          const code = result.state === "synced" ? 200 : result.state === "conflict" ? 409 : result.state === "failed" ? 503 : 202;
          send(code,"application/json; charset=utf-8",JSON.stringify(result));
        } else if (runRoute && runAction) {
          const result = runAction(input,identity); cached=null;prCache.clear();
          send(result.state === "created" ? 202 : 200,"application/json; charset=utf-8",JSON.stringify(result));
        } else if (review) {
          const result = review(input, identity); cached = null;
          send(result.state === "created" ? 202 : 200, "application/json; charset=utf-8", JSON.stringify(result));
        }
      } catch (error) {
        send(error instanceof ProjectsActionError ? error.status : 503, "application/json; charset=utf-8",
          JSON.stringify({ error: error instanceof ProjectsActionError ? error.message : prRoute?"PR actions are temporarily unavailable.":statusRoute ? "Изменение статуса временно недоступно." : runRoute ? "Действие временно недоступно." : "AI Review временно недоступно." }));
      }
      return;
    }
    try {
      if(url.pathname==="/api/pr-controls"&&prInspect) {
        const project=url.searchParams.get("project")??"",item=url.searchParams.get("item")??"";
        if(!/^[a-z0-9_-]{1,100}$/.test(project)||!item||item.length>200)throw new ProjectsActionError(400,"Invalid PR action or missing confirmation.");
        const key=JSON.stringify([identity,project,item]),previous=prCache.get(key);
        const value=previous&&Date.now()-previous.at<(options.prCacheMs??10_000)?previous.value:prInspect(project,item);
        if(value!==previous?.value){prCache.set(key,{at:Date.now(),value});while(prCache.size>32)prCache.delete(prCache.keys().next().value!);}
        send(200,"text/html; charset=utf-8",renderProjectPrControl(await value,lang));
      } else if (url.pathname === "/") send(200, "text/html; charset=utf-8", renderProjectsPage(current(), url.searchParams));
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
