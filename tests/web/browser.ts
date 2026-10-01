import assert from "node:assert/strict";
import {createServer,type Server} from "node:http";
import {once} from "node:events";
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {createWebServer} from "../../src/web/server.ts";
import {createHubServer} from "../../src/hub/server.ts";
import {createProjectsServer} from "../../src/projects-site/server.ts";
import {createBriefingServer} from "../../src/briefing/server.ts";
import {briefingPaths,openBriefingDatabase} from "../../src/briefing/store.ts";
import {parseBriefingPayload} from "../../src/briefing/model.ts";
import {renderBriefingPage} from "../../src/briefing/ui/render-page.ts";
import {createDocsServer} from "../../src/human-docs/server.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";
import {syntheticProjectsSnapshot} from "../projects-site/fixture.ts";
import {findBrowser,launchBrowser} from "../../src/ui-library/testing/devtools.ts";
import {AUDIT_EXPRESSION} from "../../src/ui-library/testing/audit.ts";

const root=resolve(import.meta.dirname,"../.."),temporary=mkdtempSync(join(tmpdir(),"kurami-web-browser-"));
const output=join(root,"dist/web-browser");mkdirSync(output,{recursive:true});
const servers:Server[]=[];
async function listen(server:Server,port=0){servers.push(server);server.listen(port,"127.0.0.1");await once(server,"listening");return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
const allocator=createServer();allocator.listen(0,"127.0.0.1");await once(allocator,"listening");const port=(allocator.address() as {port:number}).port;allocator.close();await once(allocator,"close");
const origin=`http://127.0.0.1:${port}`;
let browser:Awaited<ReturnType<typeof launchBrowser>>|undefined;
try{
  execFileSync(process.execPath,[join(root,"src/human-docs/build.ts"),"--preview"],{cwd:root,stdio:"ignore"});
  const docsRoot=join(temporary,"docs");cpSync(join(root,"dist/human-docs"),docsRoot,{recursive:true});
  // A synthetic release gate exists only in this temporary fixture, never in a deployment artifact.
  const metadata=JSON.parse(readFileSync(join(docsRoot,"build.json"),"utf8"));
  writeFileSync(join(docsRoot,"build.json"),JSON.stringify({...metadata,mode:"release",revision:null,docsSha:"a".repeat(40)}));
  const hub=await listen(createHubServer({snapshot:syntheticHubSnapshot,authorize:async()=>"fixture-owner",controlOrigin:origin,
    controls:{execute:async action=>{if(action!=="models")throw new Error("Fixture does not allow mutations");return {models:[{value:"gpt-6-sol",label:"Sol"}],hermes:"gpt-6-sol",hermesProvider:"openai-codex",codex:"gpt-6-sol",codexEffort:"high"};}}}));
  const projects=await listen(createProjectsServer({snapshot:syntheticProjectsSnapshot,authorize:async()=>"fixture-owner",origin}));
  const digestPaths=briefingPaths({KURAMI_HOME:join(temporary,"digest"),BRIEFING_MIGRATIONS_DIR:join(root,"migrations/briefing")});
  const digest=await listen(await createBriefingServer(digestPaths,{mailActionExecutor:null,weekly:true,stocks:true}));
  const digestDb=openBriefingDatabase(digestPaths);mkdirSync(digestPaths.previewDirectory,{recursive:true});
  for(const type of ["daily","cinema"] as const){
    const at="2026-10-01T07:00:00Z",date=at.slice(0,10),id=type+":"+date;
    const payload=parseBriefingPayload({schemaVersion:1,formatVersion:3,edition:{id,type,localDate:date,timezone:"Europe/Vilnius",generatedAt:at,status:"complete",retentionUntil:"2099-01-01T00:00:00Z"},hero:{title:"Synthetic edition"},dataQuality:{state:"ready"},addons:{}});
    writeFileSync(join(digestPaths.previewDirectory,type+".html"),renderBriefingPage(payload));
    digestDb.prepare(`INSERT INTO editions(id,edition_type,local_date,timezone,state,payload_json,html_path,content_digest,preview_enabled,is_current,prepared_at,published_at,retention_until,updated_at) VALUES(?,?,?,'Europe/Vilnius','complete',?,?, 'fixture',1,1,?,?,'2099-01-01T00:00:00Z',?)`).run(id,type,date,JSON.stringify(payload),"pages/preview/"+type+".html",at,at,at);
  }
  digestDb.close();
  const docs=await listen(createDocsServer(docsRoot));
  await listen(createWebServer({upstreams:{hub,projects,digest,docs},origin,authorize:async()=>({actor:"fixture-owner",scope:"owner"})}),port);
  browser=await launchBrowser(findBrowser());const {devtools}=browser;
  async function wait(expression:string){for(let attempt=0;attempt<100;attempt++){if(await devtools.evaluate<boolean>(expression))return;await delay(50);}throw new Error("Browser timeout: "+expression);}
  async function open(path:string){await devtools.evaluate("document.documentElement.dataset.webNavigation='previous'");await devtools.call("Page.navigate",{url:origin+path});try{await wait("document.documentElement.dataset.webNavigation!=='previous' && document.readyState==='complete' && !!document.getElementById('kurami-web-context')");}catch(error){throw new Error(path+": "+await devtools.evaluate("document.body.innerText.slice(0,250)"),{cause:error});}await devtools.evaluate("document.fonts.ready");}
  let checked=0;
  for(const lang of ["en","ru"] as const)for(const width of [320,390,1280])for(const path of [`/${lang}/`,`/${lang}/digest/`,`/${lang}/digest/cinema/`,`/${lang}/digest/weekly/`,`/${lang}/digest/stocks/`,`/${lang}/projects/?project=alpha`,`/${lang}/docs/`,`/${lang}/docs/run-lifecycle/`]){
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await open(path);
    assert.equal(await devtools.evaluate("document.documentElement.lang"),lang,path);
    assert.equal(await devtools.evaluate("document.querySelectorAll('link[rel=manifest]').length"),1,path);
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],path+" "+width);
    assert.equal(await devtools.evaluate("document.documentElement.scrollWidth>innerWidth+1"),false,path+" overflow");
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('.site-switcher a:not([target])')].every(link=>link.origin===location.origin&&link.pathname.startsWith('/'+document.documentElement.lang+'/'))"),true,path+" same-origin apps");
    assert.equal(await devtools.evaluate("performance.getEntriesByType('resource').filter(entry=>entry.name.startsWith(location.origin)&&entry.responseStatus>=400).length"),0,path+" failed resource");
    if(lang==="en"&&width===390){const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});writeFileSync(join(output,path.replace(/\W+/g,"-")+".png"),Buffer.from(shot.data,"base64"));}
    checked++;
  }
  await open("/en/");await devtools.evaluate("document.querySelector('[data-theme-toggle]').click()");
  const theme=await devtools.evaluate("document.documentElement.dataset.theme");
  for(const app of ["digest/","projects/","docs/",""]){await open("/en/"+app);assert.equal(await devtools.evaluate("document.documentElement.dataset.theme"),theme,"theme shares origin storage");}
  assert.equal(await devtools.evaluate("kuramiAppUrl('/api/fragment?lang=ru')"),"/_apps/hub/api/fragment?lang=ru");
  await devtools.evaluate("refreshHub(true)");assert.equal(await devtools.evaluate("document.querySelector('#hub-dashboard').hasAttribute('data-disconnected')"),false,"mounted refresh works");
  await devtools.evaluate("document.querySelector('[data-hub-control=models]').click()");await wait("!!document.querySelector('form[data-target=codex]')");
  assert.equal(await devtools.evaluate("document.querySelector('dialog').open"),true,"mounted read-only control configuration works");
  await open("/ru/projects/?project=alpha");
  await devtools.evaluate("document.querySelector('[data-item-link]').click()");try{await wait("!!document.querySelector('#project-details')");}catch(error){throw new Error(await devtools.evaluate("JSON.stringify({url:location.href,link:document.querySelector('[data-item-link]').href,status:document.querySelector('[data-refresh-status]').textContent,api:kuramiAppUrl('/api/fragment?item=issue-1&lang=ru')})"),{cause:error});}
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
  await listen(createWebServer({upstreams:{hub,projects,digest,docs},origin,authorize:async()=>({actor:"fixture-owner",scope:"owner"})}),port);
  await open("/en/");assert.equal(await devtools.evaluate("!!document.querySelector('#hub-dashboard')"),true,"online recovery works");
  console.log(`Unified browser: ${checked} mounted EN/RU views at 320/390/1280px; theme, APIs, control reads, Projects detail/reload and one root worker verified; ${output}`);
}finally{
  await browser?.close();for(const server of servers.reverse()){server.close();server.closeAllConnections();await once(server,"close");}rmSync(temporary,{recursive:true,force:true});
}
