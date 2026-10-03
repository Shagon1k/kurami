import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync,mkdirSync,renameSync,lstatSync,existsSync,copyFileSync} from "node:fs";
import {resolve,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {resolveKuramiHome} from "../core/kurami-home.ts";
import {HUB_STYLES} from "../hub/styles.ts";
import {PROJECTS_STYLES} from "../projects-site/styles.ts";
import {THEME_RUNTIME_JS} from "../ui-library/runtime/theme.ts";
import {WEB_CLIENT_JS} from "./presentation.ts";
import {WEB_ORIGIN} from "./routes.ts";
import {assertDocsSourceMatchesDeployment} from "../human-docs/changelog.ts";

export type ReleaseOperations={assertSource:(sha:string)=>void;build:()=>void;restart:()=>void;verify:()=>Promise<Record<string,unknown>>;persist:(manifest:ReleaseManifest)=>void};
export type ReleaseManifest={status:"succeeded";appSha:string;verifiedAt:string;evidence:Record<string,unknown>};
/** Only the controller's successful verification step can publish a deployment assertion. */
export async function executeWebRelease(sha:string,ops:ReleaseOperations):Promise<ReleaseManifest> {
  if(!/^[a-f0-9]{40}$/.test(sha))throw new Error("Release requires an explicit full commit SHA");
  ops.assertSource(sha);ops.build();ops.assertSource(sha);ops.restart();
  const evidence=await ops.verify();ops.assertSource(sha);
  const manifest:ReleaseManifest={status:"succeeded",appSha:sha,verifiedAt:new Date().toISOString(),evidence};
  ops.persist(manifest);return manifest;
}

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const services=["kurami-hub","kurami-projects","kurami-briefing","kurami-human-docs","kurami-web"];
function productionOperations(manifestPath:string):ReleaseOperations {
  const run=(command:string,args:string[])=>execFileSync(command,args,{cwd:root,encoding:"utf8",timeout:180000});
  const show=(name:string)=>{
    const values=run("systemctl",["--user","show",name,"-p","ActiveState","-p","NRestarts","-p","InvocationID","-p","MainPID"]).trim().split("\n");
    return Object.fromEntries(values.map(line=>{const n=line.indexOf("=");return [line.slice(0,n),line.slice(n+1)];}));
  };
  let previous:Record<string,string>={};
  return {
    assertSource(sha){
      if(run("git",["rev-parse","HEAD"]).trim()!==run("git",["rev-parse","origin/main"]).trim())throw new Error("Release requires main to match origin/main");
      if(run("git",["branch","--show-current"]).trim()!=="main")throw new Error("Release requires main");
      run("git",["merge-base","--is-ancestor",sha,"HEAD"]);
      // A later Docs-only classification commit is allowed; newer application code is not.
      assertDocsSourceMatchesDeployment(sha);
      const newer=run("git",["diff","--name-only",`${sha}..HEAD`]).trim();
      if(newer&&newer.split("\n").some(path=>path!=="src/human-docs/changelog.json"))throw new Error("Only a Changelog classification may follow the approved application SHA");
    },
    build(){
      // Bind the assertion to these installed units, not merely to any listener on the ports.
      const entries=["src/hub/server.ts","src/projects-site/server.ts","dist/briefing/server.js","src/human-docs/server.ts","src/web/server.ts"];
      for(const [index,name]of services.entries())if(!run("systemctl",["--user","show",name,"-p","ExecStart","--value"]).includes(root+"/"+entries[index]))throw new Error("Installed web unit uses a different checkout: "+name);
      run("npm",["run","briefing:build"]);
      const compiled=readFileSync(resolve(root,"dist/briefing/server.js"),"utf8");
      if(!compiled.includes("mountResponse")||!compiled.includes("WEB_CLIENT_JS"))throw new Error("Compiled Digest misses unified presentation");
    },
    restart(){
      previous=Object.fromEntries(services.map(name=>[name,show(name).InvocationID!]));
      // Invalidate the old success before starting a new deployment; keep its evidence.
      const directory=dirname(manifestPath);mkdirSync(directory,{recursive:true,mode:0o700});
      if(lstatSync(directory).isSymbolicLink())throw new Error("Manifest directory must not be a symlink");
      if(existsSync(manifestPath)){
        if(lstatSync(manifestPath).isSymbolicLink())throw new Error("Manifest must not be a symlink");
        copyFileSync(manifestPath,manifestPath+".previous-"+randomUUID());
      }
      writeFileSync(manifestPath,JSON.stringify({status:"pending",startedAt:new Date().toISOString()}),{mode:0o600});
      run("systemctl",["--user","restart",...services]);
    },
    async verify(){
      const get=async(url:string)=>{
        for(let attempt=0;attempt<20;attempt++){
          try{const response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(5000)});if(response.status===200)return await response.text();}catch{}
          await new Promise(resolve=>setTimeout(resolve,300));
        }throw new Error("Web readiness failed: "+url);
      };
      let pages=0;
      for(const lang of ["en","ru"])for(const [port,paths]of [[8800,[`/${lang}/`]],[8777,[`/?lang=${lang}`]],[8787,[`/${lang}/`,`/${lang}/cinema`,`/${lang}/weekly`,`/${lang}/stocks`]],[8799,[`/${lang}/`,`/${lang}/ui-library/`,`/${lang}/changelog/`]]] as const){
        for(const path of paths){const html=await get(`http://127.0.0.1:${port}${path}`);if(!html.includes("data-mobile-navigation="))throw new Error("Backend returned a non-app page");pages++;}
      }
      const docsRoot=resolve(resolveKuramiHome(dirname(root)),"state/human-docs/release");
      const docsBuild=JSON.parse(readFileSync(resolve(docsRoot,"build.json"),"utf8"));
      if(docsBuild.mode!=="release"||!docsBuild.webMount)throw new Error("Published Docs is not a mounted release");
      const equal=async(url:string,expected:string)=>{if(await get(url)!==expected)throw new Error("Published asset bytes do not match release source: "+url);};
      await equal("http://127.0.0.1:8800/assets/hub.css",HUB_STYLES);
      await equal("http://127.0.0.1:8777/assets/projects.css",PROJECTS_STYLES);
      await equal("http://127.0.0.1:8799/assets/docs.css",readFileSync(resolve(docsRoot,"assets/docs.css"),"utf8"));
      for(const port of [8800,8777,8799])await equal(`http://127.0.0.1:${port}/assets/theme.js`,WEB_CLIENT_JS+THEME_RUNTIME_JS);
      const {THEME_RUNTIME_JS:compiledTheme}=await import(resolve(root,"dist/ui-library/runtime/theme.js"));
      await equal("http://127.0.0.1:8787/assets/theme.js",compiledTheme);
      if(await get("http://127.0.0.1:8888/health")!==JSON.stringify({ok:true}))throw new Error("Gateway health failed");
      const denied=await fetch("http://127.0.0.1:8888/en/",{redirect:"manual",signal:AbortSignal.timeout(10000)});
      if(denied.status!==403)throw new Error("Unsigned gateway entry was not denied");
      const edge=await fetch(WEB_ORIGIN+"/en/",{redirect:"manual",signal:AbortSignal.timeout(15000)});
      if(edge.status!==302||!new URL(edge.headers.get("location")??"/",WEB_ORIGIN).hostname.endsWith(".cloudflareaccess.com"))throw new Error("Anonymous public entry was not gated by Access");
      const units=Object.fromEntries(services.map(name=>[name,show(name)]));
      for(const name of services)if(units[name]!.ActiveState!=="active"||units[name]!.NRestarts!=="0"||units[name]!.MainPID==="0"||!units[name]!.InvocationID||units[name]!.InvocationID===previous[name])throw new Error("Web service did not start cleanly: "+name);
      return {sourceHead:run("git",["rev-parse","HEAD"]).trim(),nativePages:pages,assetByteChecks:7,docsArtifactSha:docsBuild.docsSha,units,anonymousEdge:"Access redirect",unsignedGateway:403,ownerActionsExecuted:[],authenticatedOwnerBrowser:false};
    },
    persist(manifest){
      const directory=dirname(manifestPath);mkdirSync(directory,{recursive:true,mode:0o700});
      if(lstatSync(directory).isSymbolicLink())throw new Error("Manifest directory must not be a symlink");
      const temporary=manifestPath+".tmp-"+randomUUID();
      writeFileSync(temporary,JSON.stringify(manifest,null,2)+"\n",{mode:0o600,flag:"wx"});renameSync(temporary,manifestPath);
    },
  };
}

if(import.meta.main){
  const args=process.argv.slice(2);
  if(args.length!==1||!/^--sha=[a-f0-9]{40}$/.test(args[0]!))throw new Error("Owner-approved release only: web:release -- --sha=<full approved commit SHA>");
  const home=resolveKuramiHome(dirname(root)),path=resolve(home,"state/web/deployment.json");
  if(path.startsWith(root+sep))throw new Error("Deployment assertion must stay outside the source checkout");
  const manifest=await executeWebRelease(args[0]!.slice(6),productionOperations(path));
  console.log(JSON.stringify({status:manifest.status,appSha:manifest.appSha,manifestPath:path,docsPublication:"separate app-bound build and promotion required"}));
}
