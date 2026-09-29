// Joint Digest + Docs screenshots in light/dark at phone and desktop widths.
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
  writeFileSync(join(served,"digest/daily.html"),syntheticDaily());
  writeFileSync(join(served,"digest/stocks.html"),syntheticStocksEmpty());
  cpSync(join(brandAssets,"kurami-fox-transparent.png"),join(served,"assets/kurami-fox.png"));
  cpSync(join(brandAssets,"kurami-favicon.svg"),join(served,"favicon.svg"));
  return served;
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
    for(const [name,path] of Object.entries(pages))for(const width of widths)for(const theme of themes){
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
      await devtools.call("Page.navigate",{url:`http://127.0.0.1:${port}${path}`});
      await devtools.evaluate(`new Promise(done=>document.readyState==='complete'?done():addEventListener('load',done,{once:true}))`);
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
  if(!compare){console.log(JSON.stringify({ok:true,screenshots:Object.keys(manifest).length,out:output}));return;}
  const baseline=JSON.parse(readFileSync(resolve(compare,"manifest.json"),"utf8")) as Record<string,string>;
  const changed=Object.keys({...baseline,...manifest}).filter(file=>baseline[file]!==manifest[file]).sort();
  console.log(JSON.stringify({ok:!changed.length,screenshots:Object.keys(manifest).length,changed,out:output}));
  if(changed.length)process.exitCode=1;
}

await main();
