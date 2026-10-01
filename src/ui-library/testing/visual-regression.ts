// Joint Digest + Docs browser regression. Checks the theme runtime, then audits every Docs route and
// every Digest page fixture in light/dark at phone and desktop widths (accessibility and component
// inventory), and screenshots a representative set, optionally compared with a baseline run.
// Usage: node src/ui-library/testing/visual-regression.ts --out=<dir> [--compare=<baseline dir>] [/absolute/path/to/chromium]
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {cpSync,existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {isAbsolute,join,resolve,sep} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {findBrowser,launchBrowser} from "./devtools.ts";
import {librarySubsite,syntheticDaily,syntheticHub,syntheticInvestmentReview,syntheticLegacyCinema,syntheticStocksEmpty,syntheticWeeklyEmpty,syntheticProjects} from "./fixtures.ts";
import {syntheticCharts} from "./charts.ts";
import {PROJECTS_STYLES} from "../../projects-site/styles.ts";
import {HUB_CLIENT_JS} from "../../hub/assets.ts";
import {HUB_STYLES} from "../../hub/styles.ts";
import {changedShare,decodePng} from "./png.ts";
import {AUDIT_EXPRESSION,inventoryExpression} from "./audit.ts";
import {pages as docsPages} from "../../human-docs/content.ts";
import {injectRuntime} from "../../briefing/server.ts";
import type {Devtools} from "./devtools.ts";

const root=resolve(import.meta.dirname,"../../..");
const brandAssets=resolve(root,"src/ui-library/assets/brand");
const widths=[390,1280] as const;
const themes=["light","dark"] as const;
// Screenshots: a representative set. The audit covers these plus every Docs route in both languages.
const pages:Record<string,string>={
  "digest-daily":"/digest/daily.html",
  "digest-stocks-empty":"/digest/stocks.html",
  "digest-weekly-empty":"/digest/weekly.html",
  "digest-investment-review":"/digest/review.html",
  "library-charts":"/lab/charts.html",
  "library-charts-en":"/lab/charts-en.html",
  "library-subsite":"/lab/index.html",
  "hub-home":"/hub/index.html",
  "hub-home-en":"/hub/en.html",
  "projects-home":"/projects/index.html",
  "docs-home-en":"/en/",
  "docs-overview-ru":"/ru/what-is-kurami/",
  "docs-reference-table-en":"/en/data-stores/",
  "docs-run-diagram-ru":"/ru/run-lifecycle/",
  "docs-changelog-en":"/en/changelog/",
};
const types:Record<string,string>={html:"text/html; charset=utf-8",css:"text/css",js:"text/javascript",svg:"image/svg+xml",png:"image/png",webp:"image/webp",woff2:"font/woff2"};

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
  writeFileSync(join(served,"digest/cinema-legacy.html"),injectRuntime(syntheticLegacyCinema()));
  writeFileSync(join(served,"digest/stocks.html"),injectRuntime(syntheticStocksEmpty()));
  writeFileSync(join(served,"digest/weekly.html"),injectRuntime(syntheticWeeklyEmpty()));
  writeFileSync(join(served,"digest/review.html"),injectRuntime(syntheticInvestmentReview()));
  mkdirSync(join(served,"lab"),{recursive:true});
  writeFileSync(join(served,"lab/index.html"),librarySubsite());
  writeFileSync(join(served,"lab/charts.html"),syntheticCharts());
  writeFileSync(join(served,"lab/charts-en.html"),syntheticCharts("en"));
  mkdirSync(join(served,"hub"),{recursive:true});
  writeFileSync(join(served,"hub/index.html"),syntheticHub());
  writeFileSync(join(served,"hub/en.html"),syntheticHub("en"));
  writeFileSync(join(served,"assets/hub.css"),HUB_STYLES);
  mkdirSync(join(served,"projects"),{recursive:true});
  writeFileSync(join(served,"projects/index.html"),syntheticProjects());
  writeFileSync(join(served,"assets/projects.css"),PROJECTS_STYLES);
  cpSync(join(root,"src/projects-site/client.js"),join(served,"assets/projects.js"));
  writeFileSync(join(served,"assets/hub.js"),HUB_CLIENT_JS);
  cpSync(join(brandAssets,"kurami-fox-header.webp"),join(served,"assets/kurami-fox.webp"));
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

async function checkSiteSwitcher(devtools:Devtools,base:string):Promise<void> {
  for(const [path,current] of [["/digest/daily.html","Digest"],["/digest/cinema-legacy.html","Digest"],["/en/","Docs"],["/hub/index.html","Hub"],["/hub/en.html","Hub"]] as const)for(const width of [320,390,1280]){
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await open(devtools,`${base}${path}`);
    const state=await devtools.evaluate<{links:string[];current:string|null;projects:string|null;projectsHref:string|null;open:boolean;overflow:number;left:number;right:number}>(`(() => {
      const menu=document.querySelector('.site-switcher');
      menu.querySelector('summary').click();
      const nav=menu.querySelector('nav'),rect=nav.getBoundingClientRect();
      const projects=[...nav.querySelectorAll('.site-nav__link')].find(link=>link.textContent.trim().startsWith('Projects'));
      return {links:[...nav.querySelectorAll('a')].map(link=>link.textContent.trim()),current:nav.querySelector('[aria-current]')?.textContent.trim()??null,projects:projects?.getAttribute('aria-disabled')??null,projectsHref:projects?.getAttribute('href')??null,open:menu.open,overflow:document.documentElement.scrollWidth-innerWidth,left:rect.left,right:rect.right};
    })()`);
    const projectsHref=`https://projects.shagon1k.win/${path==="/en/"||path==="/hub/en.html"?"":"?lang=ru"}`;
    if(JSON.stringify(state.links)!==JSON.stringify(["Hub","Digest","Docs","Projects","Hermes","Dokploy"])||state.current!==current||state.projects!==null||state.projectsHref!==projectsHref||!state.open||state.overflow>1||state.left<0||state.right>width+1)throw new Error(`Site switcher ${path} at ${width}px: ${JSON.stringify(state)}`);
  }
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
  const audit:Record<string,string[]>={};
  let auditedCount=0;
  try{
    await devtools.call("Page.enable");
    for(const path of ["/digest/daily.html","/en/state-and-truth/","/lab/index.html","/hub/index.html"])await checkThemeRuntime(devtools,`http://127.0.0.1:${port}`,path);
    await checkSiteSwitcher(devtools,`http://127.0.0.1:${port}`);
    const audited:Record<string,string>={...pages};
    for(const lang of ["en","ru"])for(const route of ["","changelog",...docsPages.map(page=>page.slug)])audited[`docs-${lang}-${route||"home"}`]??=`/${lang}/${route?route+"/":""}`;
    for(const [name,path] of Object.entries(audited))if(!Object.values(pages).includes(path)||name in pages)for(const width of widths)for(const theme of themes){
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
      await open(devtools,`http://127.0.0.1:${port}${path}`);
      await devtools.evaluate(`(()=>{const style=document.createElement('style');style.textContent='*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';document.head.append(style);if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('[data-theme-toggle]').click();return document.fonts.ready.then(()=>true)})()`);
      await delay(150);
      const issues=[...await devtools.evaluate<string[]>(AUDIT_EXPRESSION),...await devtools.evaluate<string[]>(inventoryExpression())];
      auditedCount++;
      if(issues.length)audit[`${name}-${width}-${theme}`]=issues;
      if(!(name in pages))continue;
      const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
      const file=`${name}-${width}-${theme}.png`;
      const png=Buffer.from(shot.data,"base64");
      writeFileSync(join(output,file),png);
      manifest[file]=createHash("sha256").update(png).digest("hex");
    }
  }finally{await close();server.close();rmSync(served,{recursive:true,force:true});}
  writeFileSync(join(output,"manifest.json"),JSON.stringify(manifest,null,2));
  if(Object.keys(audit).length){console.log(JSON.stringify({ok:false,audit},null,1));process.exitCode=1;return;}
  if(!compare){console.log(JSON.stringify({ok:true,themeRuntime:"verified",audited:auditedCount,screenshots:Object.keys(manifest).length,out:output}));return;}
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
