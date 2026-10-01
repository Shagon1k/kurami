// Author check for docs pages: parses, validates and renders pages in both languages, and can take
// screenshots so the author sees the page as a reader does.
// Usage: node src/human-docs/tools/check-pages.ts [slug ...] [--shots=/abs/dir] [--width=1280] [--strict-links]
// Without slugs every page is checked. Links to pages that do not exist yet are listed, not fatal,
// unless --strict-links is given.
import {createServer} from "node:http";
import {cpSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {dirname,resolve,sep} from "node:path";
process.env.KURAMI_DOCS_DRAFTS="1";
const {loadPages}=await import("../content.ts");
const {assertContent}=await import("../content/schema.ts");
const {renderArticle,renderHome}=await import("../render.ts");
import {DOCS_STYLES} from "../styles.ts";
import {fontFiles} from "../../ui-library/foundations/fonts.ts";
import {THEME_RUNTIME_JS} from "../../ui-library/runtime/theme.ts";

const root=resolve(import.meta.dirname,"../../..");
const args=process.argv.slice(2);
const option=(name:string)=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const wanted=args.filter(arg=>!arg.startsWith("--"));
const shots=option("shots"),width=Number(option("width")??"1280");
const missingLinks:string[]=[];
const errors:string[]=[];
const incomplete:string[]=[];
const all=loadPages(undefined,slug=>incomplete.push(slug));
for(const slug of incomplete)(wanted.includes(slug)?errors:[]).push(`${slug} needs both ${slug}.ru.md and ${slug}.en.md`);
try{assertContent(all,root);}catch(error){
  const message=(error as Error).message;
  if(/^Invalid next page/.test(message)&&!args.includes("--strict-links"))console.warn(`missing page (fine while others write): ${message}`);else errors.push(message);
}
const selected=wanted.length?all.filter(page=>wanted.includes(page.slug)):all;
for(const slug of wanted)if(!all.some(page=>page.slug===slug))errors.push(`No page ${slug} (expected content/pages/<section>/${slug}.ru.md and .en.md)`);
const files:[string,string][]=[];const diagrams:{id:string;svg:string}[]=[];
for(const page of selected)for(const lang of ["ru","en"] as const){
  try{
    const out=page.slug==="home"?renderHome(lang,{root,missingLinks:args.includes("--strict-links")?undefined:missingLinks}):renderArticle(page,lang,{root,missingLinks:args.includes("--strict-links")?undefined:missingLinks});
    files.push([page.slug==="home"?`${lang}/index.html`:`${lang}/${page.slug}/index.html`,out.html]);diagrams.push(...out.diagrams);
  }catch(error){errors.push(`${page.slug}/${lang}: ${(error as Error).message}`);}
}
for(const error of errors)console.error(`ERROR ${error}`);
for(const link of [...new Set(missingLinks)])console.warn(`missing page (fine while others write): ${link}`);
console.log(`${selected.length} page(s) checked, ${errors.length} error(s), ${diagrams.length} diagram(s)`);
if(shots&&files.length){
  mkdirSync(resolve(shots,"site/assets/diagrams"),{recursive:true});
  const site=resolve(shots,"site");
  for(const [path,html] of files){mkdirSync(dirname(resolve(site,path)),{recursive:true});writeFileSync(resolve(site,path),html);}
  for(const diagram of diagrams)writeFileSync(resolve(site,"assets/diagrams",`${diagram.id}.svg`),diagram.svg);
  writeFileSync(resolve(site,"assets/docs.css"),DOCS_STYLES);writeFileSync(resolve(site,"assets/theme.js"),THEME_RUNTIME_JS);
  for(const font of fontFiles)cpSync(resolve(root,"src/ui-library/assets/fonts",font.file),resolve(site,"assets",font.file));
  cpSync(resolve(root,"src/ui-library/assets/brand/kurami-fox-transparent.png"),resolve(site,"assets/fox.png"));
  cpSync(resolve(root,"src/ui-library/assets/brand/kurami-fox-header.webp"),resolve(site,"assets/fox.webp"));
  cpSync(resolve(root,"src/ui-library/assets/brand/kurami-favicon.svg"),resolve(site,"assets/favicon.svg"));
  for(const file of readdirSync(resolve(root,"src/human-docs/assets")))cpSync(resolve(root,"src/human-docs/assets",file),resolve(site,"assets",file));
  const server=createServer((request,response)=>{
    const raw=new URL(request.url??"/","http://127.0.0.1").pathname;
    const path=resolve(site,`.${decodeURIComponent(raw)}`,raw.endsWith("/")?"index.html":"");
    if(!path.startsWith(`${site}${sep}`)){response.writeHead(403).end();return;}
    try{const type=path.endsWith(".html")?"text/html; charset=utf-8":path.endsWith(".css")?"text/css":path.endsWith(".js")?"text/javascript":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".woff2")?"font/woff2":"image/png";response.writeHead(200,{"content-type":type}).end(readFileSync(path));}catch{response.writeHead(404).end();}
  });
  await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
  const port=(server.address() as {port:number}).port;
  const {findBrowser,launchBrowser}=await import("../../ui-library/testing/devtools.ts");
  const {devtools,close}=await launchBrowser(findBrowser());
  try{
    await devtools.call("Page.enable");
    for(const [path] of files){
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
      await devtools.call("Page.navigate",{url:`http://127.0.0.1:${port}/${path.replace(/index\.html$/,"")}`});
      await new Promise(done=>setTimeout(done,900));
      const height=await devtools.evaluate<number>("document.documentElement.scrollHeight");
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:Math.min(height,14000),deviceScaleFactor:1,mobile:width<600});
      await new Promise(done=>setTimeout(done,250));
      const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
      const name=`${path.replace(/\/index\.html$/,"").replace(/^(en|ru)\/?(.*)$/,(_m,lang,slug)=>`${slug||"home"}-${lang}`)}-${width}.png`;
      writeFileSync(resolve(shots,name),Buffer.from(shot.data,"base64"));
      console.log(`screenshot ${resolve(shots,name)} (${height}px tall)`);
    }
  }finally{try{close();}catch{}server.close();}
}
process.exitCode=errors.length?1:0;
