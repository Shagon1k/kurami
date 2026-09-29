import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {isAbsolute,join,resolve,sep} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {pages} from "../../src/human-docs/content.ts";

const root=resolve(import.meta.dirname,"../..");
const previewRoot=resolve(root,"dist/human-docs");
const widths=[390,800,1280] as const;
const locales=["en","ru"] as const;
const themes=["light","dark"] as const;

function previewServer(){
  return createServer((request,response)=>{
    const raw=new URL(request.url??"/","http://127.0.0.1").pathname;
    const path=resolve(previewRoot,`.${decodeURIComponent(raw)}`,raw.endsWith("/")?"index.html":"");
    if(!path.startsWith(`${previewRoot}${sep}`)){response.writeHead(403).end();return;}
    try{
      const body=readFileSync(path);
      const type=path.endsWith(".html")?"text/html; charset=utf-8":path.endsWith(".css")?"text/css":path.endsWith(".js")?"text/javascript":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".woff2")?"font/woff2":"application/octet-stream";
      response.writeHead(200,{"content-type":type}).end(body);
    }catch{response.writeHead(404).end();}
  });
}

async function debuggerTarget(port:number):Promise<string>{
  for(let attempt=0;attempt<100;attempt++){
    try{
      const result=await fetch(`http://127.0.0.1:${port}/json/list`);
      const list=await result.json() as Array<{type:string;webSocketDebuggerUrl?:string}>;
      const target=list.find(item=>item.type==="page"&&item.webSocketDebuggerUrl);
      if(target?.webSocketDebuggerUrl)return target.webSocketDebuggerUrl;
    }catch{}
    await delay(100);
  }
  throw new Error("Local headless browser did not expose a page target");
}

class Devtools {
  private id=0;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  private socket:WebSocket;
  constructor(socket:WebSocket){
    this.socket=socket;
    socket.addEventListener("message",event=>{
      const message=JSON.parse(String(event.data)) as {id?:number;result?:unknown;error?:{message:string}};
      if(!message.id)return;
      const pending=this.pending.get(message.id);
      if(!pending)return;
      this.pending.delete(message.id);
      if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result);
    });
  }
  call<T=any>(method:string,params:Record<string,unknown>={}):Promise<T>{
    const id=++this.id;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}));});
  }
  async evaluate<T>(expression:string):Promise<T>{
    const result=await this.call<{result:{value:T}}>("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    return result.result.value;
  }
  close(){this.socket.close();}
}

async function pressEnter(devtools:Devtools){
  const key={key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:"\r",unmodifiedText:"\r"};
  await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",...key});
  await devtools.call("Input.dispatchKeyEvent",{type:"keyUp",...key});
  await delay(50);
}

async function pressTab(devtools:Devtools){
  const key={key:"Tab",code:"Tab",windowsVirtualKeyCode:9,nativeVirtualKeyCode:9};
  await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",...key});
  await devtools.call("Input.dispatchKeyEvent",{type:"keyUp",...key});
  await delay(50);
}

async function checkKeyboard(devtools:Devtools,navScreenshotPath?:string){
  await devtools.call("Page.bringToFront");
  await devtools.call("Emulation.setFocusEmulationEnabled",{enabled:true});
  const skip=await devtools.evaluate<boolean>(`(()=>{const target=document.querySelector('.skip-link');target?.focus();return document.activeElement===target&&target?.getAttribute('href')==='#main'})()`);
  if(!skip)throw new Error("Skip link cannot take focus or has no main target");
  await pressEnter(devtools);
  const skipped=await devtools.evaluate<boolean>(`document.activeElement?.id==='main'`);
  if(!skipped)throw new Error("Skip link did not focus main content");
  await pressTab(devtools);
  const first=await devtools.evaluate<boolean>(`document.querySelector('.side-mobile > summary')?document.activeElement===document.querySelector('.side-mobile > summary'):document.activeElement===document.querySelector('.route')`);
  if(!first)throw new Error("Tab from skipped main did not reach the first content control");
  for(const selector of [".mobile-menu > summary",".side-mobile > summary",".article details > summary"]){
    const exists=await devtools.evaluate<boolean>(`document.querySelector(${JSON.stringify(selector)})!==null`);
    if(!exists){
      if(selector===".article details > summary"&&await devtools.evaluate<boolean>(`document.querySelector('[data-page]')!==null`))throw new Error("Article has no keyboard disclosure");
      continue;
    }
    const focused=await devtools.evaluate<boolean>(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});if(!target)return false;target.focus();return document.activeElement===target})()`);
    if(!focused)throw new Error(`Keyboard target cannot take focus: ${selector}`);
    await pressEnter(devtools);
    const opened=await devtools.evaluate<boolean>(`document.querySelector(${JSON.stringify(selector)})?.parentElement?.open===true`);
    if(!opened)throw new Error(`Enter did not open ${selector}`);
    if(selector===".side-mobile > summary"){
      const navigation=await devtools.evaluate<{groups:number;overflow:boolean}>(`({groups:document.querySelectorAll('.side-mobile .side-group').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1})`);
      if(navigation.groups!==4||navigation.overflow)throw new Error(`Grouped mobile navigation failed: ${JSON.stringify(navigation)}`);
      if(navScreenshotPath){const capture=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});writeFileSync(navScreenshotPath,Buffer.from(capture.data,"base64"));}
    }
    await pressEnter(devtools);
  }
  const focused=await devtools.evaluate<boolean>(`(()=>{const target=document.querySelector('[data-theme-toggle]');if(!target)return false;target.focus();return document.activeElement===target})()`);
  if(!focused)throw new Error("Theme switch cannot take focus");
  await pressEnter(devtools);
  const changed=await devtools.evaluate<boolean>(`document.documentElement.dataset.theme==='dark'&&document.querySelector('[data-theme-toggle]')?.getAttribute('aria-pressed')==='true'`);
  if(!changed)throw new Error("Enter did not switch the theme");
  await devtools.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  const reduced=await devtools.evaluate<boolean>(`getComputedStyle(document.documentElement).scrollBehavior==='auto'`);
  await devtools.call("Emulation.setEmulatedMedia",{features:[]});
  if(!reduced)throw new Error("Reduced motion did not disable smooth scrolling");
}

async function auditAccessibility(devtools:Devtools,context:string){
  const issues=await devtools.evaluate<string[]>(`(()=>{
    const issues=[];
    const visible=element=>{const style=getComputedStyle(element),box=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&box.width>0&&box.height>0};
    const names=new Set();
    for(const nav of document.querySelectorAll('nav'))if(visible(nav)){const name=nav.getAttribute('aria-label')?.trim();if(!name)issues.push('Unnamed navigation');else if(names.has(name))issues.push('Duplicate navigation name: '+name);else names.add(name)}
    if(document.querySelectorAll('h1').length!==1)issues.push('Expected one h1');
    for(const heading of document.querySelectorAll('h1,h2,h3'))if(!heading.textContent?.trim())issues.push('Empty heading');
    for(const image of document.images)if(!image.hasAttribute('alt'))issues.push('Image without alt');
    for(const table of document.querySelectorAll('table'))if(!table.querySelector('caption')?.textContent?.trim())issues.push('Table without caption');
    for(const control of document.querySelectorAll('a[href],button,summary'))if(visible(control)){
      const name=control.getAttribute('aria-label')?.trim()||control.textContent?.trim();
      if(!name)issues.push('Unnamed '+control.tagName.toLowerCase());
      if(control.getAttribute('aria-current')==='page'&&new URL(control.getAttribute('href'),location.href).pathname!==location.pathname)issues.push('False current-page link: '+control.getAttribute('href'));
    }
    if(!document.querySelector('main#main[tabindex="-1"]')||document.querySelector('.skip-link')?.getAttribute('href')!=='#main')issues.push('Missing skip target');
    const theme=document.querySelector('[data-theme-toggle]');
    if(theme?.getAttribute('aria-pressed')!==String(document.documentElement.dataset.theme==='dark'))issues.push('Theme state not exposed');
    const color=raw=>{const match=raw.match(/^rgba?\\(([^)]+)\\)$/);if(!match)return null;const parts=match[1].split(/[ ,/]+/).filter(Boolean).map(Number);return parts.length>=3&&parts.slice(0,3).every(Number.isFinite)?parts:null};
    const luminance=rgb=>rgb.slice(0,3).map(value=>{const v=value/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    for(const element of document.querySelectorAll('body *')){
      if(!visible(element)||!Array.from(element.childNodes).some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent?.trim()))continue;
      if(element.closest('thead')&&getComputedStyle(element.closest('thead')).clipPath!=='none')continue;
      const style=getComputedStyle(element),foreground=color(style.color);if(!foreground)continue;
      let background=null,ancestor=element;
      while(ancestor&&!background){const candidate=color(getComputedStyle(ancestor).backgroundColor);if(candidate&&(candidate[3]===undefined||candidate[3]>=.99))background=candidate;ancestor=ancestor.parentElement}
      if(!background)continue;
      const a=luminance(foreground),b=luminance(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      const large=parseFloat(style.fontSize)>=24||parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700;
      if(ratio<(large?2.95:4.45))issues.push('Low text contrast '+ratio.toFixed(2)+': '+element.tagName.toLowerCase()+'.'+String(element.className).slice(0,30));
      if(issues.length>=12)break;
    }
    return issues;
  })()`);
  if(issues.length)throw new Error(`Accessibility audit failed ${context}: ${issues.join("; ")}`);
}

async function main(){
  const routeArg=process.argv.slice(2).find(arg=>arg.startsWith("--routes="));
  const all=process.argv.includes("--all");
  const a11y=process.argv.includes("--a11y");
  const routes=all?["home",...pages.map(page=>page.slug),"changelog"]:(routeArg?.slice("--routes=".length)??"daily,daily-addons,daily-lifecycle").split(",");
  const browserPath=process.argv.slice(2).find(arg=>isAbsolute(arg));
  if(!browserPath||all&&Boolean(routeArg)||!routes.length||routes.some(route=>!route))throw new Error("Usage: node tests/human-docs/browser-preview.ts [--all | --routes=slug,slug,...] /absolute/path/to/headless-browser");
  for(const slug of routes)if(slug!=="home"&&slug!=="changelog"&&!pages.some(page=>page.slug===slug))throw new Error(`Missing docs route ${slug}`);
  const screenshotRoutes=[routes[0],routes[Math.min(1,routes.length-1)],routes[Math.min(2,routes.length-1)]];
  const screenshots=new Set([`en/${screenshotRoutes[0]}/light/390`,`ru/${screenshotRoutes[1]}/dark/390`,`en/${screenshotRoutes[2]}/dark/1280`,`ru/${screenshotRoutes[2]}/light/390`]);
  const keyboardSlug=routes.find(slug=>pages.some(page=>page.slug===slug));
  const server=previewServer();
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();
  if(!address||typeof address==="string")throw new Error("Preview server did not bind a local port");
  const origin=`http://127.0.0.1:${address.port}`;
  const temp=mkdtempSync(join(tmpdir(),"kurami-docs-browser-"));
  const browser=spawn(browserPath,["--headless","--no-sandbox","--disable-gpu","--disable-background-networking","--disable-dev-shm-usage","--remote-debugging-address=127.0.0.1","--remote-debugging-port=0",`--user-data-dir=${join(temp,"profile")}`,"about:blank"],{stdio:["ignore","ignore","pipe"]});
  let debugPort:number|undefined;
  browser.stderr.on("data",chunk=>{const match=String(chunk).match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);if(match)debugPort=Number(match[1]);});
  let devtools:Devtools|undefined;
  try{
    for(let i=0;i<100&&!debugPort;i++)await delay(100);
    if(!debugPort)throw new Error("Local headless browser did not start DevTools");
    const socket=new WebSocket(await debuggerTarget(debugPort));
    await new Promise<void>((resolve,reject)=>{socket.addEventListener("open",()=>resolve(),{once:true});socket.addEventListener("error",()=>reject(new Error("DevTools WebSocket failed")),{once:true});});
    devtools=new Devtools(socket);
    await devtools.call("Page.enable");
    await devtools.call("Runtime.enable");
    const output=resolve(root,"dist/human-docs-browser-qa");
    mkdirSync(output,{recursive:true});
    let checked=0;
    for(const slug of routes)for(const locale of locales)for(const width of widths)for(const theme of themes){
      const url=`${origin}/${locale}/${slug==="home"?"":`${slug}/`}`;
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<580});
      await devtools.call("Page.navigate",{url});
      let ready=false;
      for(let attempt=0;attempt<100;attempt++){
        ready=await devtools.evaluate<boolean>(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'`).catch(()=>false);
        if(ready)break;
        await delay(50);
      }
      if(!ready)throw new Error(`Page did not load: ${locale}/${slug} at ${width}px`);
      await devtools.evaluate(`document.fonts.ready.then(()=>{if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('[data-theme-toggle]')?.click();return true})`);
      const state=await devtools.evaluate<{width:number;content:number;theme:string;lang:string;broken:number}>(`({width:document.documentElement.clientWidth,content:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,lang:document.documentElement.lang,broken:[...document.images].filter(image=>!image.complete||image.naturalWidth===0).length})`);
      if(state.content>state.width+1||state.theme!==theme||state.lang!==locale||state.broken)throw new Error(`Browser QA failed ${locale}/${slug} ${width}px ${theme}: ${JSON.stringify(state)}`);
      if(a11y)await auditAccessibility(devtools,`${locale}/${slug} ${width}px ${theme}`);
      if(slug==="changelog"){
        const claims=await devtools.evaluate<boolean>(`document.querySelector('.changes a[href*="/commit/"]')!==null`);
        if(claims)throw new Error(`Unpublished preview has application commit links: ${locale}/${slug}`);
      }
      const key=`${locale}/${slug}/${theme}/${width}`;
      if(screenshots.has(key)){
        const capture=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
        writeFileSync(join(output,`${slug}-${locale}-${theme}-${width}.png`),Buffer.from(capture.data,"base64"));
      }
      if(a11y&&width===390&&theme==="light")await checkKeyboard(devtools,key===`en/${keyboardSlug}/light/390`?join(output,`${keyboardSlug}-en-light-390-navigation.png`):undefined);
      else if(key===`en/${keyboardSlug}/light/390`)await checkKeyboard(devtools,join(output,`${keyboardSlug}-en-light-390-navigation.png`));
      checked++;
    }
    console.log(`Browser QA passed ${checked} local docs route/locale/width/theme combinations; representative screenshots in ${output}`);
  }finally{
    devtools?.close();
    const browserExit=browser.exitCode!==null||browser.signalCode!==null?Promise.resolve():new Promise<void>(resolve=>browser.once("exit",()=>resolve()));
    browser.kill("SIGTERM");
    await Promise.race([browserExit,delay(3000)]);
    if(browser.exitCode===null&&browser.signalCode===null){browser.kill("SIGKILL");await browserExit;}
    server.close();
    rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}

await main();
