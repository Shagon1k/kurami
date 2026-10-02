import assert from "node:assert/strict";
import {createServer,type IncomingMessage,type Server} from "node:http";
import {once} from "node:events";
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {createWebServer} from "../../src/web/server.ts";
import {createHubServer} from "../../src/hub/server.ts";
import {createProjectsServer} from "../../src/projects-site/server.ts";
import {briefingPaths,openBriefingDatabase,upsertAddonSnapshot} from "../../src/briefing/store.ts";
import {parseBriefingPayload,type BriefingAddonEnvelope} from "../../src/briefing/model.ts";
import {buildWeeklyReview} from "../../src/briefing/weekly/build.ts";
import {setSection} from "../../src/briefing/addons/envelopes.ts";
import {parseStocksConfig} from "../../src/briefing/stocks/config.ts";
import {renderBriefingPage} from "../../src/briefing/ui/render-page.ts";
import {createDocsServer} from "../../src/human-docs/server.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";
import {syntheticProjectsSnapshot} from "../projects-site/fixture.ts";
import {findBrowser,launchBrowser} from "../../src/ui-library/testing/devtools.ts";
import {AUDIT_EXPRESSION} from "../../src/ui-library/testing/audit.ts";
import {PWA_MANIFEST_ICONS} from "../../src/web/icons.ts";
import {kuramiTheme} from "../../src/ui-library/themes/kurami.ts";

const root=resolve(import.meta.dirname,"../.."),temporary=mkdtempSync(join(tmpdir(),"kurami-web-browser-"));
const output=join(root,"dist/web-browser");mkdirSync(output,{recursive:true});
const servers:Server[]=[];
async function listen(server:Server,port=0){servers.push(server);server.listen(port,"127.0.0.1");await once(server,"listening");return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
const allocator=createServer();allocator.listen(0,"127.0.0.1");await once(allocator,"listening");const port=(allocator.address() as {port:number}).port;allocator.close();await once(allocator,"close");
const origin=`http://127.0.0.1:${port}`;
// Model Access's browser cookie boundary without real credentials or a public manifest.
let latinRequests=0;
const authorizeFixture=async(request:IncomingMessage)=>{
  if(request.url==="/assets/onest-latin.woff2")latinRequests++;
  return request.headers.cookie?.split(/;\s*/).includes("fixture-access=owner")?{actor:"fixture-owner",scope:"owner" as const}:null;
};
let browser:Awaited<ReturnType<typeof launchBrowser>>|undefined;
try{
  // Production runs compiled Digest, not its TS entry point. Exercise that exact boundary.
  execFileSync("npm",["run","briefing:build"],{cwd:root,stdio:"pipe"});
  const compiledDigest=new URL("../../dist/briefing/server.js",import.meta.url).href;
  const {createBriefingServer}=await import(compiledDigest) as typeof import("../../src/briefing/server.ts");
  execFileSync(process.execPath,[join(root,"src/human-docs/build.ts"),"--preview"],{cwd:root,stdio:"ignore"});
  const docsRoot=join(temporary,"docs");cpSync(join(root,"dist/human-docs"),docsRoot,{recursive:true});
  // A synthetic release gate exists only in this temporary fixture, never in a deployment artifact.
  const metadata=JSON.parse(readFileSync(join(docsRoot,"build.json"),"utf8"));
  writeFileSync(join(docsRoot,"build.json"),JSON.stringify({...metadata,mode:"release",revision:null,docsSha:"a".repeat(40)}));
  const hub=await listen(createHubServer({snapshot:()=>{const snapshot=syntheticHubSnapshot();snapshot.codex.coverage="partial";return snapshot;},authorize:async()=>"fixture-owner",controlOrigin:origin,
    controls:{execute:async action=>{if(action!=="models")throw new Error("Fixture does not allow mutations");return {models:[{value:"gpt-6-sol",label:"Sol"}],hermes:"gpt-6-sol",hermesProvider:"openai-codex",codex:"gpt-6-sol",codexEffort:"high"};}}}));
  const projects=await listen(createProjectsServer({snapshot:syntheticProjectsSnapshot,authorize:async()=>"fixture-owner",origin}));
  const digestPaths=briefingPaths({KURAMI_HOME:join(temporary,"digest"),BRIEFING_MIGRATIONS_DIR:join(root,"migrations/briefing")});
  const digest=await listen(await createBriefingServer(digestPaths,{mailActionExecutor:null,weekly:true,stocks:true}));
  const digestDb=openBriefingDatabase(digestPaths);mkdirSync(digestPaths.previewDirectory,{recursive:true});
  cpSync(join(root,"src/ui-library/assets/brand/kurami-fox-header.webp"),join(digestPaths.mediaDirectory,"fixture.webp"));
  for(const type of ["daily","cinema"] as const){
    const at="2026-10-01T07:00:00Z",date=at.slice(0,10),id=type+":"+date;
    const payload=parseBriefingPayload({schemaVersion:1,formatVersion:3,edition:{id,type,localDate:date,timezone:"Europe/Vilnius",generatedAt:at,status:"complete",retentionUntil:"2099-01-01T00:00:00Z"},hero:{title:"Synthetic edition"},dataQuality:{state:"ready"},addons:{}});
    if(type==="daily")setSection(payload,"news",{state:"ready",pageSize:10,items:[{id:"fixture-story",fingerprint:"fixture-story",headline:"Synthetic story",summary:"Synthetic summary",details:["Fixture details"],en:{headline:"Synthetic story",summary:"Synthetic summary",details:["Fixture details"]},topics:[{id:"technology",label:"Technology"},{id:"testing",label:"Testing"}],media:[{id:"fixture-image",kind:"image",src:"/media/fixture.webp",alt:"Synthetic image",mimeType:"image/webp"}],sources:[{sourceKey:"telegram:fixture",itemIds:["1"],provider:"telegram",sourceLabel:"Fixture",url:"https://example.org/story"}]}]});
    if(type==="daily")setSection(payload,"mail",{state:"ready",count:1,items:[{id:"fixture-mail",provider:"gmail",providerItemId:"fixture-message",class:"GENERAL",subject:"Synthetic inbox message"}]});
    parseBriefingPayload(payload);
    writeFileSync(join(digestPaths.previewDirectory,type+".html"),renderBriefingPage(payload));
    digestDb.prepare(`INSERT INTO editions(id,edition_type,local_date,timezone,state,payload_json,html_path,content_digest,preview_enabled,is_current,prepared_at,published_at,retention_until,updated_at) VALUES(?,?,?,'Europe/Vilnius','complete',?,?, 'fixture',1,1,?,?,'2099-01-01T00:00:00Z',?)`).run(id,type,date,JSON.stringify(payload),"pages/preview/"+type+".html",at,at,at);
  }
  const review=buildWeeklyReview(digestDb,"2026-09-27","Europe/Vilnius","2026-09-27T07:00:00Z");
  review.state="partial";review.data.coverage.news=1;review.data.days[0]!.stories=1;
  upsertAddonSnapshot(digestDb,"weekly",review as unknown as BriefingAddonEnvelope);
  const policy=parseStocksConfig({enabled:true,benchmark:"DEMO",moveThresholdPercent:2,assets:[{id:"DEMO",symbol:"DEMO.US",name:"Synthetic stock",isin:"US0000000000",currency:"USD",exchange:"US",timezone:"UTC",kind:"stock"}]});
  assert.equal(policy.enabled,true);
  upsertAddonSnapshot(digestDb,"stocks",{version:1,state:"ready",capturedAt:"2026-10-01T07:00:00Z",data:{provider:"eodhd",policy,series:[{asset:policy.assets[0],points:[{date:"2026-09-30",close:100,adjusted:100}],fetchedAt:"2026-10-01T07:00:00Z",state:"ready"}]}});
  digestDb.close();
  const docs=await listen(createDocsServer(docsRoot));
  await listen(createWebServer({upstreams:{hub,projects,digest,docs},origin,authorize:authorizeFixture}),port);
  browser=await launchBrowser(findBrowser());const {devtools}=browser;
  const cookie=await devtools.call<{success:boolean}>("Network.setCookie",{name:"fixture-access",value:"owner",url:origin,httpOnly:true,sameSite:"Lax"});
  assert.equal(cookie.success,true,"synthetic owner cookie is set");
  async function wait(expression:string){for(let attempt=0;attempt<100;attempt++){if(await devtools.evaluate<boolean>(expression))return;await delay(50);}throw new Error("Browser timeout: "+expression);}
  async function open(path:string){await devtools.evaluate("document.documentElement.dataset.webNavigation='previous'");await devtools.call("Page.navigate",{url:origin+path});try{await wait("document.documentElement.dataset.webNavigation!=='previous' && document.readyState==='complete' && !!document.getElementById('kurami-web-context')");}catch(error){throw new Error(path+": "+await devtools.evaluate("document.body.innerText.slice(0,250)"),{cause:error});}await devtools.evaluate("document.fonts.ready");}
  let checked=0;
  await open("/en/");
  const firstManifest=await devtools.call<{data:string;errors:unknown[]}>("Page.getAppManifest");
  assert.deepEqual(firstManifest.errors,[],"authenticated Chrome must fetch the Hub manifest without an anonymous Access failure");
  assert.equal(JSON.parse(firstManifest.data).scope,"/");
  const installability=await devtools.call<{installabilityErrors:unknown[]}>("Page.getInstallabilityErrors");
  assert.deepEqual(installability.installabilityErrors,[],"Chrome's installability checks pass behind cookie-protected Access");
  assert.deepEqual(JSON.parse(firstManifest.data).icons,PWA_MANIFEST_ICONS);
  const iconChecks=await devtools.evaluate<Array<{purpose:string;size:number;width:number;height:number;opaque:boolean;cornerAlpha:number;coverage:number;radius:number}>>(`(async()=>{
    const bg=${JSON.stringify(kuramiTheme.light.colors["surface-page"])};const rgb=[1,3,5].map(i=>parseInt(bg.slice(i,i+2),16));const results=[];
    for(const asset of ${JSON.stringify(PWA_MANIFEST_ICONS)}){
      const image=new Image();image.src=asset.src;await image.decode();const size=parseInt(asset.sizes);
      const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const context=canvas.getContext('2d');context.drawImage(image,0,0);
      const pixels=context.getImageData(0,0,size,size).data;let opaque=true,left=size,right=-1,top=size,bottom=-1,radius=0;
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const i=(y*size+x)*4;opaque=opaque&&pixels[i+3]===255;
        const foreground=asset.purpose==='any'?pixels[i+3]>8:rgb.some((value,channel)=>Math.abs(pixels[i+channel]-value)>8);
        if(foreground){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);radius=Math.max(radius,Math.hypot(x+0.5-size/2,y+0.5-size/2)/size);}
      }
      results.push({purpose:asset.purpose,size,width:image.naturalWidth,height:image.naturalHeight,opaque,cornerAlpha:pixels[3],coverage:Math.max(right-left+1,bottom-top+1)/size,radius});
    }
    return results;
  })()`);
  for(const icon of iconChecks){
    assert.equal(icon.width,icon.size);assert.equal(icon.height,icon.size);
    if(icon.purpose==="maskable"){
      assert.equal(icon.opaque,true,"adaptive exports fill the launcher plate");
      assert(icon.radius<=0.4,"all visible artwork fits the circular safe zone");
      assert(icon.coverage>0.65&&icon.coverage<0.8,"adaptive mark fills its safe area, without extra inset padding");
    }else{
      assert.equal(icon.cornerAlpha,0,"splash/install artwork remains transparent");
      assert(icon.coverage>0.9&&icon.coverage<0.94,"transparent mark has only a small outer margin");
    }
  }
  for(const lang of ["en","ru"] as const)for(const width of [320,390,1280])for(const path of [`/${lang}/`,`/${lang}/digest/`,`/${lang}/digest/cinema/`,`/${lang}/digest/weekly/`,`/${lang}/digest/stocks/`,`/${lang}/projects/?project=alpha`,`/${lang}/docs/`,`/${lang}/docs/run-lifecycle/`]){
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await open(path);
    assert.equal(await devtools.evaluate("document.documentElement.lang"),lang,path);
    assert.equal(await devtools.evaluate("document.querySelectorAll('link[rel=manifest]').length"),1,path);
    assert.equal(await devtools.evaluate("document.querySelector('link[rel=manifest]').crossOrigin"),"use-credentials",path+" credentialed manifest");
    assert.equal(await devtools.evaluate("document.querySelectorAll('.site-footer').length"),1,path+" one common footer");
    assert.equal(await devtools.evaluate("!!document.querySelector('.site-footer').closest('main')"),false,path+" page footer is outside main");
    assert.deepEqual(await devtools.evaluate("[...document.querySelectorAll('.site-switcher a')].map(link=>link.textContent)"),["Hub","Digest","Projects","Docs","Hermes↗","Dokploy↗"],path+" app order");
    if(path===`/${lang}/digest/`){
      assert.equal(await devtools.evaluate("!!document.querySelector('[data-mail-section] .mail-actions [data-mail-archive]')"),true,path+" mail archive action survives runtime injection");
      assert.match(await devtools.evaluate<string>("document.querySelector('[data-mail-archive]').textContent"),lang==="en"?/Read and archive/:/Прочитать и архивировать/);
      await devtools.evaluate("document.querySelector('[data-mail-select]').click()");
      assert.equal(await devtools.evaluate("document.querySelector('[data-mail-archive]').disabled"),false,path+" selecting mail enables archive without submitting it");
    }
    assert.equal(await devtools.evaluate("document.querySelector('.site-brand__fox').naturalWidth>0"),true,path+" fox loaded");
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],path+" "+width);
    assert.equal(await devtools.evaluate("document.documentElement.scrollWidth>innerWidth+1"),false,path+" overflow");
    assert.equal(await devtools.evaluate("(() => {const name=document.querySelector('.site-brand__name').getBoundingClientRect(),actions=document.querySelector('.site-actions').getBoundingClientRect();return name.right<=actions.left+1;})()"),true,path+" brand does not overlap controls");
    assert.equal(await devtools.evaluate("(() => {const date=document.querySelector('.site-brand__meta');return !date||date.getBoundingClientRect().right<=document.querySelector('.site-actions').getBoundingClientRect().left+1;})()"),true,path+" date does not overlap controls");
    if(path===`/${lang}/`){
      assert.equal(await devtools.evaluate("(() => {const labels=[...document.querySelectorAll('[data-period-panel=commits]:not([hidden]) .chart__labels:last-child text')].slice(0,-1).map(label=>label.getBoundingClientRect());return labels.every((label,index)=>!index||label.left>=labels[index-1].right+1);})()"),true,path+" commit dates remain separate");
      assert.equal(await devtools.evaluate("(() => {const mark=document.querySelector('[data-period-panel=commits]:not([hidden]) .stat-card__marked');const text=document.createRange();text.selectNodeContents(mark);return text.getClientRects().length<=3&&getComputedStyle(mark).whiteSpace==='nowrap';})()"),true,path+" partial marker stays attached");
    }
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('.site-switcher a:not([target])')].every(link=>link.origin===location.origin&&link.pathname.startsWith('/'+document.documentElement.lang+'/'))"),true,path+" same-origin apps");
    assert.equal(await devtools.evaluate("performance.getEntriesByType('resource').filter(entry=>entry.name.startsWith(location.origin)&&entry.responseStatus>=400).length"),0,path+" failed resource");
    if(lang==="en"&&width===390){const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});writeFileSync(join(output,path.replace(/\W+/g,"-")+".png"),Buffer.from(shot.data,"base64"));}
    checked++;
  }
  assert.equal(latinRequests,1,"all four apps reuse one cached Onest Latin asset across views and reloads");
  // Follow actual links, not just directly addressed routes; include cold HTTP caches.
  await devtools.call("Network.clearBrowserCache");
  await open("/en/digest/");
  assert.equal(await devtools.evaluate("document.fonts.check('16px Onest')"),true,"Digest fonts loaded on first cold open");
  await devtools.evaluate("document.querySelector('.story-cover').scrollIntoView()");
  await wait("document.querySelector('.story-cover img').naturalWidth>0");
  const heights=await devtools.evaluate<number[]>("[...document.querySelectorAll('.news-story__actions .button')].map(button=>button.getBoundingClientRect().height)");
  assert(heights.length>=4&&Math.max(...heights)-Math.min(...heights)<=1,"Read, source and reactions share one control height");
  const widths=await devtools.evaluate<number[]>("[...document.querySelectorAll('.news-story__actions .button--icon')].map(button=>button.getBoundingClientRect().width)");
  assert(widths.length===3&&Math.max(...widths)-Math.min(...widths)<=1,"source and reaction buttons fill equal mobile columns");
  await devtools.evaluate("document.querySelector('[data-media-lightbox]').click()");
  await wait("document.querySelector('[data-media-dialog]').open&&document.querySelector('[data-media-dialog-image]').naturalWidth>0");
  assert.equal(await devtools.evaluate("new URL(document.querySelector('[data-media-dialog-image]').src).pathname"),"/_apps/digest/media/fixture.webp","lightbox also uses the mounted media route");
  await devtools.evaluate("document.querySelector('[data-media-close] .button__svg path').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await wait("!document.querySelector('[data-media-dialog]').open");
  for(const section of ["cinema","weekly","stocks"]){
    const expected="/en/digest/"+section;
    assert.equal(await devtools.evaluate(`document.querySelector('[data-site-navigation] a[href="${expected}"]')?.origin`),origin,section+" navigation link is available");
    await devtools.evaluate(`document.querySelector('[data-site-navigation] a[href="${expected}"]').click()`);
    await wait(`location.pathname==='${expected}'&&document.readyState==='complete'&&document.querySelector('[data-site-section="${section}"]')!==null`);
    await devtools.evaluate("document.fonts.ready");
    assert.equal(await devtools.evaluate("document.querySelector('.site-brand__fox').naturalWidth>0"),true,section+" cold linked page assets");
  }
  for(const app of ["docs","projects","hub","digest"]){
    const expected=app==="hub"?"/en/":"/en/"+app+"/";
    await devtools.evaluate(`document.querySelector('.site-switcher a[href="${expected}"]').click()`);
    await wait(`location.pathname==='${expected}'&&document.readyState==='complete'&&!!document.getElementById('kurami-web-context')`);
    assert.equal(await devtools.evaluate("location.origin"),origin,app+" clicked Apps stays in the PWA origin");
    const result=await devtools.call<{data:string}>("Page.getAppManifest");
    assert.equal(JSON.parse(result.data).id,"/",app+" retains one install identity");
  }
  await open("/en/");await devtools.evaluate("document.querySelector('[data-theme-toggle]').click()");
  const theme=await devtools.evaluate("document.documentElement.dataset.theme");
  for(const app of ["digest/","projects/","docs/",""]){await open("/en/"+app);assert.equal(await devtools.evaluate("document.documentElement.dataset.theme"),theme,"theme shares origin storage");}
  assert.equal(await devtools.evaluate("kuramiAppUrl('/api/fragment?lang=ru')"),"/_apps/hub/api/fragment?lang=ru");
  await devtools.evaluate("refreshHub(true)");assert.equal(await devtools.evaluate("document.querySelector('#hub-dashboard').hasAttribute('data-disconnected')"),false,"mounted refresh works");
  await devtools.evaluate("document.querySelector('[data-hub-control=models]').click()");await wait("!!document.querySelector('form[data-target=codex]')");
  assert.equal(await devtools.evaluate("document.querySelector('dialog').open"),true,"mounted read-only control configuration works");
  await open("/ru/projects/?project=alpha");
  await devtools.evaluate("document.querySelector('[data-item-link]').click()");try{await wait("!!document.querySelector('#project-details')");}catch(error){throw new Error(await devtools.evaluate("JSON.stringify({url:location.href,link:document.querySelector('[data-item-link]').href,status:document.querySelector('[data-toast-message]').textContent,api:kuramiAppUrl('/api/fragment?item=issue-1&lang=ru')})"),{cause:error});}
  assert.equal(await devtools.evaluate("location.pathname"),"/ru/projects/","task navigation remains mounted");
  assert.equal(await devtools.evaluate("document.documentElement.lang"),"ru","fragment keeps locale");
  assert.equal(await devtools.evaluate("document.querySelector('[data-language-link]').pathname"),"/en/projects/","language links use mounted paths after fragment navigation");
  assert.equal(await devtools.evaluate("new URL(document.querySelector('[data-language-link]').href).searchParams.get('item')"),await devtools.evaluate("new URL(location.href).searchParams.get('item')"),"language keeps selected task");
  await devtools.call("Page.reload",{ignoreCache:false});await wait("document.readyState==='complete' && !!document.querySelector('#project-details')");
  assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.ui-icon')).stroke"),await devtools.evaluate("getComputedStyle(document.querySelector('.ui-icon')).color"),"icons stay styled after ordinary reload");
  await wait("!!navigator.serviceWorker.controller");
  assert.equal(await devtools.evaluate("navigator.serviceWorker.controller.scriptURL"),origin+"/sw.js");
  const manifest=await devtools.call<{url:string;data:string;errors:unknown[]}>("Page.getAppManifest");
  assert.deepEqual(manifest.errors,[],"Chrome parses the unified manifest");
  assert.equal(manifest.url,origin+"/manifest.webmanifest");
  assert.equal(JSON.parse(manifest.data).scope,"/");
  const caches=await devtools.evaluate<string[]>("caches.keys()");assert.equal(caches.some(key=>key.startsWith("kurami-web-")),false,"private pages are not cached");
  const gateway=servers.pop()!;gateway.close();gateway.closeAllConnections();await once(gateway,"close");
  await devtools.evaluate("document.documentElement.dataset.webNavigation='previous'");
  await devtools.call("Page.navigate",{url:origin+"/ru/"});await wait("document.body?.innerText.includes('Нет связи')");
  assert.equal(await devtools.evaluate("!!document.querySelector('#hub-dashboard')"),false,"offline never restores a private dashboard");
  await listen(createWebServer({upstreams:{hub,projects,digest,docs},origin,authorize:authorizeFixture}),port);
  await open("/en/");assert.equal(await devtools.evaluate("!!document.querySelector('#hub-dashboard')"),true,"online recovery works");
  console.log(`Unified browser: ${checked} mounted EN/RU views at 320/390/1280px; theme, APIs, control reads, Projects detail/reload and one root worker verified; ${output}`);
}finally{
  await browser?.close();for(const server of servers.reverse()){server.close();server.closeAllConnections();await once(server,"close");}rmSync(temporary,{recursive:true,force:true});
}
