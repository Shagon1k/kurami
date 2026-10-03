import {createHash} from "node:crypto";
import {readdirSync,readFileSync,lstatSync} from "node:fs";
import {join,relative,resolve} from "node:path";
import {resolveKuramiHome} from "../../core/kurami-home.ts";
import {WEB_ORIGIN,publicAppUrl} from "../../web/routes.ts";

/** Retained native route mapping; internal variants are not native routes. */
export function routeFor(release:string,file:string):string|undefined {
  const path=`/${relative(release,file).split("\\").join("/")}`;
  if(path==="/build.json"||path.startsWith("/unified/"))return undefined;
  return path.endsWith("/index.html")?path.slice(0,-"index.html".length):path;
}
function files(root:string):string[] {
  return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{
    if(entry.isSymbolicLink())throw new Error("Release must not contain symlinks");
    const path=join(root,entry.name);
    return entry.isDirectory()?files(path):[path];
  });
}
export function mountedReleaseFiles(release:string):{file:string;nativeRoute:string;publicRoute:string}[] {
  return files(release).flatMap(file=>{
    const path=relative(release,file).split("\\").join("/");
    if(!/^(?:(?:en|ru)\/(?:[a-z0-9-]+\/)*index\.html|assets\/[a-z0-9-]+\.(?:css|js|svg|png|webp|woff2))$/.test(path))return [];
    const nativeRoute=routeFor(release,file)!;
    const lang=path.startsWith("ru/")?"ru":"en";
    const selected=path.endsWith(".html")||path==="assets/docs.css"?join(release,"unified",path):file;
    if(!lstatSync(selected).isFile()||lstatSync(selected).isSymbolicLink())throw new Error("Missing regular mounted release file");
    return [{file:selected,nativeRoute,publicRoute:publicAppUrl(nativeRoute,"docs",lang)}];
  });
}
export function readOwnerSession(path:string,site:string):string {
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size>16384)throw new Error("Owner session must be a private regular file");
  const value=JSON.parse(readFileSync(path,"utf8")) as Record<string,unknown>;
  if(Object.keys(value).sort().join(",")!=="authorization,origin"||value.origin!==site||typeof value.authorization!=="string"||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(value.authorization))throw new Error("Owner session must contain origin and a single Access authorization token");
  return value.authorization;
}
type Options={release:string;site?:string;ownerSessionPath?:string;fetcher?:typeof fetch};
/** Report edge gating + origin bytes separately when no owner session is available. */
export async function verifyDocsAccess({release,site=WEB_ORIGIN,ownerSessionPath,fetcher=fetch}:Options) {
  if(site!==WEB_ORIGIN)throw new Error("Docs verification is restricted to the unified Kurami origin");
  const build=JSON.parse(readFileSync(join(release,"build.json"),"utf8")) as {mode?:string;docsSha?:string;webMount?:boolean};
  if(build.mode!=="release"||build.webMount!==true||!/^[a-f0-9]{40}$/.test(build.docsSha??""))throw new Error("Promoted Docs needs a mounted release build");
  const local=mountedReleaseFiles(release);
  const request=async(url:string,headers:Record<string,string>={})=>fetcher(url,{redirect:"manual",signal:AbortSignal.timeout(15000),headers:{"user-agent":"kurami-docs-verify/2",...headers}});
  for(const route of ["/en/docs/","/ru/docs/","/_apps/docs/assets/docs.css"]){
    const response=await request(site+route);
    const target=new URL(response.headers.get("location")??"/",site);
    if(response.status<300||response.status>=400||!target.hostname.endsWith(".cloudflareaccess.com"))throw new Error("Anonymous Docs request did not reach Access login");
  }
  const token=ownerSessionPath?readOwnerSession(ownerSessionPath,site):undefined;
  for(let index=0;index<local.length;index+=8)await Promise.all(local.slice(index,index+8).map(async item=>{
    const url=token?site+item.publicRoute:"http://127.0.0.1:8799"+item.nativeRoute;
    const response=await request(url,token?{Cookie:"CF_Authorization="+token}:{"x-kurami-web-app":"docs","x-kurami-web-lang":item.nativeRoute.startsWith("/ru/")?"ru":"en"});
    if(response.status!==200)throw new Error(`${item.publicRoute}: verification returned HTTP ${response.status}`);
    const hash=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
    if(hash(new Uint8Array(await response.arrayBuffer()))!==hash(readFileSync(item.file)))throw new Error(`${item.publicRoute}: bytes differ from promoted release`);
  }));
  return {ok:true,docsSha:build.docsSha,anonymous:"Cloudflare Access redirect",byteIdenticalFiles:local.length,byteCheckBoundary:token?"authenticated unified edge":"mounted loopback origin",authenticatedEdge:token?"verified":"not checked; requires private owner session",serviceTokenUsed:false};
}
if(import.meta.main){
  const values=new Map<string,string>();
  for(const arg of process.argv.slice(2)){const match=/^--(site|owner-session)=(.+)$/.exec(arg);if(!match||values.has(match[1]!))throw new Error("Use --owner-session=<private file> and optional --site=<unified origin>");values.set(match[1]!,match[2]!);}
  const release=resolve(resolveKuramiHome("/home/shagon1k/_hermes/_kurami"),"state/human-docs/release");
  console.log(JSON.stringify(await verifyDocsAccess({release,site:values.get("site"),ownerSessionPath:values.get("owner-session")})));
}
