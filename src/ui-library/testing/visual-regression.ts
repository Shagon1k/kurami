// Joint Digest + Docs browser regression: theme runtime behaviour on both sites, then screenshots
// in light/dark at phone and desktop widths, optionally compared with a baseline run.
// Usage: node src/ui-library/testing/visual-regression.ts --out=<dir> [--compare=<baseline dir>] [/absolute/path/to/chromium]
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {cpSync,existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {isAbsolute,join,resolve,sep} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {findBrowser,launchBrowser} from "./devtools.ts";
import {syntheticDaily,syntheticStocksEmpty} from "./fixtures.ts";
import {changedShare,decodePng} from "./png.ts";
import {injectRuntime} from "../../briefing/server.ts";
import type {Devtools} from "./devtools.ts";

const root=resolve(import.meta.dirname,"../../..");
const brandAssets=resolve(root,"integrations/hermes/skills/kurami-ui-preview-language/assets");
const widths=[390,1280] as const;
const themes=["light","dark"] as const;
const pages:Record<string,string>={
  "digest-daily":"/digest/daily.html",
  "digest-stocks-empty":"/digest/stocks.html",
  "docs-home-en":"/en/",
  "docs-overview-ru":"/ru/what-is-kurami/",
  "docs-state-table-en":"/en/reading-state/",
  "docs-run-diagram-ru":"/ru/run-lifecycle/",
  "docs-changelog-en":"/en/changelog/",
};
const types:Record<string,string>={html:"text/html; charset=utf-8",css:"text/css",js:"text/javascript",svg:"image/svg+xml",png:"image/png",woff2:"font/woff2"};

function site():string {
  execFileSync(process.execPath,[resolve(root,"src/human-docs/build.ts"),"--preview"],{cwd:root,stdio:"ignore"});
  const served=mkdtempSync(join(tmpdir(),"kurami-ui-site-"));
  cpSync(resolve(root,"dist/human-docs"),served,{recursive:true});
  // Docs cite the source commit; pin it so screenshots compare across commits.
  const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  for(const entry of readdirSync(served,{recursive:true,encoding:"utf8"}))if(entry.endsWith(".html")){
    const path=join(served,entry);
    writeFileSync(path,readFileSync(path,"utf8").replaceAll(head,"0".repeat(40)).replaceAll(head.slice(0,12),"0".repeat(12)).replaceAll(head.slice(0,7),"0".repeat(7)));
  }
  mkdirSync(join(served,"digest"),{recursive:true});
  // Digest pages pass through the same serve-time injection as production.
  writeFileSync(join(served,"digest/daily.html"),injectRuntime(syntheticDaily()));
  writeFileSync(join(served,"digest/stocks.html"),injectRuntime(syntheticStocksEmpty()));
  cpSync(join(brandAssets,"kurami-fox-transparent.png"),join(served,"assets/kurami-fox.png"));
  cpSync(join(brandAssets,"kurami-favicon.svg"),join(served,"favicon.svg"));
  return served;
}

async function open(devtools:Devtools,url:string):Promise<void> {
  await devtools.call("Page.navigate",{url});
  await devtools.evaluate(`new Promise(done=>document.readyState==='complete'?done():addEventListener('load',done,{once:true}))`);
}

type ThemeState={theme:string;pressed:string|null;icon:string|null;stored:string|null;color:string|null;inHead:boolean};
const themeState=`({theme:document.documentElement.dataset.theme,pressed:document.querySelector('[data-theme-toggle]')?.getAttribute('aria-pressed')??null,icon:document.querySelector('[data-theme-icon]')?.textContent??null,stored:localStorage.getItem('kurami-theme'),color:document.querySelector('meta[name="theme-color"]')?.getAttribute('content')??null,inHead:Boolean(document.head.querySelector('script[src="/assets/theme.js"]'))})`;

/** The system theme applies on first visit, the switch persists a choice, and a stored choice beats the system. */
async function checkThemeRuntime(devtools:Devtools,base:string,path:string):Promise<void> {
  const expect=(state:ThemeState,theme:string,stored:string|null,step:string)=>{
    const want={theme,pressed:String(theme==="dark"),icon:theme==="dark"?"☀":"◐",stored,color:theme==="dark"?"#0a0a0a":"#fbfbf8",inHead:true};
    if(JSON.stringify(state)!==JSON.stringify(want))throw new Error(`Theme runtime ${path} ${step}: ${JSON.stringify(state)} expected ${JSON.stringify(want)}`);
  };
  await open(devtools,`${base}${path}`);
  await devtools.evaluate(`localStorage.clear()`);
  await devtools.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"dark"}]});
  await open(devtools,`${base}${path}`);
  expect(await devtools.evaluate<ThemeState>(themeState),"dark",null,"system dark");
  await devtools.evaluate(`document.querySelector('[data-theme-toggle]').click()`);
  expect(await devtools.evaluate<ThemeState>(themeState),"light","light","switch to light");
  await open(devtools,`${base}${path}`);
  expect(await devtools.evaluate<ThemeState>(themeState),"light","light","stored beats system");
  await devtools.evaluate(`localStorage.clear()`);
  await devtools.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"light"}]});
  await open(devtools,`${base}${path}`);
  expect(await devtools.evaluate<ThemeState>(themeState),"light",null,"system light");
  await devtools.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"dark"}]});
  await delay(100);
  expect(await devtools.evaluate<ThemeState>(themeState),"dark",null,"live system change");
  await devtools.evaluate(`localStorage.clear()`);
  await devtools.call("Emulation.setEmulatedMedia",{features:[]});
}

async function main(){
  const args=process.argv.slice(2);
  const out=args.find(arg=>arg.startsWith("--out="))?.slice(6);
  const compare=args.find(arg=>arg.startsWith("--compare="))?.slice(10);
  if(!out)throw new Error("Usage: visual-regression.ts --out=<dir> [--compare=<baseline dir>] [/absolute/path/to/chromium]");
  const output=resolve(out);
  rmSync(output,{recursive:true,force:true});
  mkdirSync(output,{recursive:true});
  const served=site();
  const server=createServer((request,response)=>{
    const raw=new URL(request.url??"/","http://127.0.0.1").pathname;
    const path=resolve(served,`.${decodeURIComponent(raw)}`,raw.endsWith("/")?"index.html":"");
    if(!path.startsWith(`${served}${sep}`)||!existsSync(path)){response.writeHead(404).end();return;}
    response.writeHead(200,{"content-type":types[path.split(".").at(-1)??""]??"application/octet-stream"}).end(readFileSync(path));
  });
  await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
  const port=(server.address() as {port:number}).port;
  const {devtools,close}=await launchBrowser(findBrowser(args.find(arg=>isAbsolute(arg))));
  const manifest:Record<string,string>={};
  try{
    await devtools.call("Page.enable");
    for(const path of ["/digest/daily.html","/en/reading-state/"])await checkThemeRuntime(devtools,`http://127.0.0.1:${port}`,path);
    for(const [name,path] of Object.entries(pages))for(const width of widths)for(const theme of themes){
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
      await open(devtools,`http://127.0.0.1:${port}${path}`);
      await devtools.evaluate(`(()=>{const style=document.createElement('style');style.textContent='*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';document.head.append(style);document.documentElement.dataset.theme=${JSON.stringify(theme)};return document.fonts.ready.then(()=>true)})()`);
      await delay(150);
      const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
      const file=`${name}-${width}-${theme}.png`;
      const png=Buffer.from(shot.data,"base64");
      writeFileSync(join(output,file),png);
      manifest[file]=createHash("sha256").update(png).digest("hex");
    }
  }finally{close();server.close();rmSync(served,{recursive:true,force:true});}
  writeFileSync(join(output,"manifest.json"),JSON.stringify(manifest,null,2));
  if(!compare){console.log(JSON.stringify({ok:true,themeRuntime:"verified",screenshots:Object.keys(manifest).length,out:output}));return;}
  const baseline=JSON.parse(readFileSync(resolve(compare,"manifest.json"),"utf8")) as Record<string,string>;
  const changed:Record<string,string>={};
  for(const file of Object.keys({...baseline,...manifest}).sort()){
    if(baseline[file]===manifest[file])continue;
    const before=resolve(compare,file),after=join(output,file);
    changed[file]=existsSync(before)&&existsSync(after)?`${(changedShare(decodePng(readFileSync(before)),decodePng(readFileSync(after)))*100).toFixed(2)}% pixels`:"missing";
  }
  console.log(JSON.stringify({ok:!Object.keys(changed).length,screenshots:Object.keys(manifest).length,changed,out:output},null,1));
  if(Object.keys(changed).length)process.exitCode=1;
}

await main();
