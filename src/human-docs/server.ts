import {createServer, type Server} from "node:http";
import {readFileSync, statSync, createReadStream} from "node:fs";
import {dirname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const types: Record<string,string> = {
  ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml",
  ".png":"image/png", ".woff2":"font/woff2",
};

export function createDocsServer(root: string): Server {
  const base = resolve(root);
  const build = JSON.parse(readFileSync(resolve(base,"build.json"),"utf8")) as {mode?:string;revision?:string|null;docsSha?:string|null};
  if(build.mode!=="release" || !/^[0-9a-f]{40}$/.test(build.docsSha??"") ||
    (build.revision!=null && !/^[0-9a-f]{40}$/.test(build.revision))) {
    throw new Error("Refusing to serve docs without a clean release build");
  }
  return createServer((request,response)=>{
    response.setHeader("X-Content-Type-Options","nosniff");
    response.setHeader("Cache-Control","no-store");
    response.setHeader("Referrer-Policy","no-referrer");
    if(request.method!=="GET"&&request.method!=="HEAD") {response.writeHead(405,{Allow:"GET, HEAD"}).end();return;}
    let pathname: string;
    try { pathname=decodeURIComponent(new URL(request.url??"/","http://localhost").pathname); }
    catch {response.writeHead(400).end();return;}
    if(pathname==="/"||pathname==="/index.html") {response.writeHead(302,{Location:"/en/"}).end();return;}
    // Only generated public routes/assets; never expose build metadata or source paths.
    if(!/^\/(?:|(?:en|ru)\/(?:|(?:[a-z0-9-]+\/)*)(?:index\.html)?|assets\/(?:diagrams\/)?[a-z0-9-]+\.(?:css|js|svg|png|woff2))$/.test(pathname)) {
      response.writeHead(404).end();return;
    }
    const relative=pathname.endsWith("/")?`${pathname}index.html`:pathname;
    const target=resolve(base,`.${relative}`);
    if(!target.startsWith(base+sep)) {response.writeHead(404).end();return;}
    const extension=target.slice(target.lastIndexOf("."));
    const type=types[extension];
    if(!type) {response.writeHead(404).end();return;}
    try {
      const stat=statSync(target);
      if(!stat.isFile()) throw new Error("not a file");
      response.writeHead(200,{"Content-Type":type,"Content-Length":stat.size});
      if(request.method==="HEAD")response.end();
      else createReadStream(target).on("error",()=>response.destroy()).pipe(response);
    } catch {response.writeHead(404).end();}
  });
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=process.env.DOCS_ROOT??resolve(dirname(fileURLToPath(import.meta.url)),"../../dist/human-docs");
  const port=Number(process.env.DOCS_PORT??8799);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid DOCS_PORT");
  createDocsServer(root).listen(port,"127.0.0.1",()=>console.log(`Kurami docs origin listening on 127.0.0.1:${port}`));
}
