// Check the published docs behind Cloudflare Access against the promoted local release.
// Usage: node src/human-docs/tools/verify-access.ts [--site=https://docs.shagon1k.win]
// 1. Without credentials the edge must redirect to Cloudflare Access (pages and assets).
// 2. With the Access service token every page and asset must be byte-identical to state/human-docs/release.
// Byte equality ties the public site to a release the repository's own checks already rendered,
// so this needs no browser and does not depend on page markup.
import {createHash} from "node:crypto";
import {readdirSync,readFileSync,statSync} from "node:fs";
import {join,relative,resolve} from "node:path";
import {resolveKuramiHome} from "../../core/kurami-home.ts";

const USER_AGENT="kurami-docs-verify/1";

type Credentials={client_id:string;client_secret:string};

function files(root:string):string[] {
  return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{
    const path=join(root,entry.name);
    return entry.isDirectory()?files(path):[path];
  });
}

/** Public URL path for a release file, or undefined for files the server never serves. */
export function routeFor(release:string,file:string):string|undefined {
  const path=`/${relative(release,file).split("\\").join("/")}`;
  if(path==="/build.json"||path.startsWith("/unified/"))return undefined;
  return path.endsWith("/index.html")?path.slice(0,-"index.html".length):path;
}

function sha256(data:Uint8Array):string {
  return createHash("sha256").update(data).digest("hex");
}

export function readCredentials(path:string):Credentials {
  const value=JSON.parse(readFileSync(path,"utf8")) as Record<string,unknown>;
  if(Object.keys(value).sort().join(",")!=="client_id,client_secret"||typeof value.client_id!=="string"||typeof value.client_secret!=="string")
    throw new Error("Access credentials must hold exactly client_id and client_secret");
  if((statSync(path).mode&0o077)!==0)throw new Error("Access credentials file permissions are too broad");
  return value as Credentials;
}

async function get(site:string,route:string,credentials?:Credentials):Promise<Response> {
  const url=new URL(route,site);
  if(url.origin!==new URL(site).origin)throw new Error(`Refusing to send a request outside ${site}`);
  return fetch(url,{
    redirect:"manual",
    signal:AbortSignal.timeout(15_000),
    headers:{"user-agent":USER_AGENT,...(credentials?{"CF-Access-Client-Id":credentials.client_id,"CF-Access-Client-Secret":credentials.client_secret}:{})},
  });
}

async function inBatches<T,R>(items:T[],size:number,work:(item:T)=>Promise<R>):Promise<R[]> {
  const results:R[]=[];
  for(let index=0;index<items.length;index+=size)results.push(...await Promise.all(items.slice(index,index+size).map(work)));
  return results;
}

if(import.meta.main){
  const site=(process.argv.find(arg=>arg.startsWith("--site="))?.slice(7)??"https://docs.shagon1k.win").replace(/\/$/,"");
  if(!site.startsWith("https://"))throw new Error("The docs site must be an https:// origin");
  const state=resolve(resolveKuramiHome("/home/shagon1k/_hermes/_kurami"),"state/human-docs");
  const release=resolve(state,"release");
  const build=JSON.parse(readFileSync(resolve(release,"build.json"),"utf8")) as {docsSha?:string;mode?:string};
  if(build.mode!=="release")throw new Error("The promoted folder is not a release build");
  const credentials=readCredentials(resolve(state,"access-client.json"));
  const local=files(release).map(file=>({file,route:routeFor(release,file)})).filter((item):item is {file:string;route:string}=>Boolean(item.route));

  // Anonymous requests must stop at Access, for pages and for assets.
  for(const route of ["/en/","/ru/",local.find(item=>item.route.startsWith("/assets/"))!.route]){
    const response=await get(site,route);
    const location=response.headers.get("location")??"";
    if(response.status<300||response.status>=400||!new URL(location,site).hostname.endsWith(".cloudflareaccess.com"))
      throw new Error(`${route}: anonymous request was not sent to Cloudflare Access (HTTP ${response.status})`);
  }

  const mismatches=(await inBatches(local,8,async({file,route})=>{
    const response=await get(site,route,credentials);
    if(response.status!==200)return `${route}: HTTP ${response.status}`;
    const served=new Uint8Array(await response.arrayBuffer());
    return sha256(served)===sha256(readFileSync(file))?undefined:`${route}: differs from the local release`;
  })).filter((value):value is string=>Boolean(value));
  if(mismatches.length){
    for(const mismatch of mismatches.slice(0,20))console.error(mismatch);
    throw new Error(`${mismatches.length} of ${local.length} files differ from the promoted release`);
  }
  console.log(JSON.stringify({ok:true,docsSha:build.docsSha,anonymous:"redirected to Cloudflare Access",authenticated:`${local.length} files byte-identical`}));
}
