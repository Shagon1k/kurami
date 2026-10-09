import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdirSync,writeFileSync} from "node:fs";
import {setTimeout as delay} from "node:timers/promises";
import {PROJECTS_STYLES} from "../../src/projects-site/styles.ts";
import {renderDocument} from "../../src/ui-library/patterns/page-shell.ts";
import {injectSiteNavigation,renderSiteHeader} from "../../src/briefing/ui/components/site-header.ts";
import {renderToastRegion} from "../../src/ui-library/components/toast.ts";
import {TOAST_RUNTIME_JS} from "../../src/ui-library/runtime/toast.ts";
import {THEME_RUNTIME_JS} from "../../src/ui-library/runtime/theme.ts";
import {kuramiMoodAssets} from "../../src/ui-library/components/kurami-mood.ts";
import {findBrowser,launchBrowser} from "../../src/ui-library/testing/devtools.ts";

const assets=new Map(kuramiMoodAssets().map(asset=>[asset.path,asset]));
const server=createServer((request,response)=>{
  const asset=assets.get(request.url!);if(asset){response.writeHead(200,{"content-type":asset.type}).end(asset.body);return;}
  if(request.url==="/assets/theme.js"){response.writeHead(200,{"content-type":"text/javascript"}).end(THEME_RUNTIME_JS);return;}
  const url=new URL(request.url!,"http://fixture.test"),lang=url.pathname==="/ru"?"ru":"en",legacy=url.searchParams.has("retained");
  const oldPullStyles=legacy?`.kurami-pull img { width:96px;height:96px; }.kurami-pull span { padding:2px 10px;border-radius:999px;background:var(--surface-raised); }.kurami-pull.is-ready span { color:var(--text-primary); }.kurami-pull.is-refreshing img { animation:kurami-pull-bob .9s infinite; }html[data-kurami-mascot="off"] .kurami-pull img { display:none; }@media(prefers-reduced-motion:reduce){.kurami-pull,.kurami-pull.is-refreshing img{transition:none;animation:none;}}`:"";
  let html=renderDocument({lang,title:"Mascot overlays",favicon:"/favicon.svg",footer:"",skipLabel:"Skip to content",styles:{inline:PROJECTS_STYLES+oldPullStyles},themeScript:true,header:legacy?renderSiteHeader({section:"daily"}):"",main:`<h1>Task with a long title for checking portrait placement</h1><p>Fixture page; no project actions are performed.</p>${renderToastRegion("Close",{kurami:true})}`,head:`<script>${TOAST_RUNTIME_JS}\ndocument.addEventListener('DOMContentLoaded',()=>{window.testToast=createKuramiToast(document.querySelector('[data-toast-region]'));window.refreshCalls=0;window.kuramiRefresh=()=>{window.refreshCalls++;return new Promise(resolve=>window.finishRefresh=resolve);};});</script>`});
  if(legacy)html=injectSiteNavigation(html,[],"daily");
  response.writeHead(200,{"content-type":"text/html; charset=utf-8"}).end(html);
});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser=await launchBrowser(findBrowser()),{devtools}=browser;
const output="/tmp/kurami-mascot-overlays";mkdirSync(output,{recursive:true});
try {
  await devtools.call("Page.enable");
  await devtools.call("Page.addScriptToEvaluateOnNewDocument",{source:`(()=>{const native=matchMedia;window.matchMedia=query=>['(display-mode: standalone)','(pointer: coarse)'].includes(query)?{matches:true,media:query,addEventListener(){},removeEventListener(){}}:native(query);})()`});
  let layouts=0;
  for(const width of [320,390,575,1280])for(const theme of ["light","dark","neon","neon-light"])for(const lang of ["ru","en"])for(const legacy of width===390?[false,true]:[false]){
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<620});
    await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
    await devtools.call("Page.navigate",{url:base+"/"+lang+(legacy?"?retained=1":"")});
    for(let n=0;n<100;n++){if(await devtools.evaluate("document.readyState==='complete'&&!!window.testToast"))break;await delay(30);}
    await devtools.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme==='dark'||theme==='neon'?'dark':'light')};document.documentElement.dataset.kuramiTheme=${JSON.stringify(theme.startsWith('neon')?'neon':'paper')};document.fonts.ready`);
    await devtools.evaluate(`testToast.show(${JSON.stringify(lang==='ru'?'PR влит. Минус одна забота.':'PR merged. One less thing to worry about.')},{tone:'success',celebrate:true,duration:0});`);await delay(600);
    const notice=await devtools.evaluate<any>(`(()=>{const t=document.querySelector('[data-toast-region]'),m=t.querySelector('[data-toast-message]').getBoundingClientRect(),p=t.querySelector('.kurami-mood__figure').getBoundingClientRect(),b=t.querySelector('[data-toast-dismiss]').getBoundingClientRect(),r=t.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,portraitRight:p.right,messageLeft:m.left,messageRight:m.right,buttonLeft:b.left,text:t.querySelector('[data-toast-message]').textContent}})()`);
    assert.ok(notice.left>=0&&notice.right<=width+1&&notice.bottom<=900);
    assert.ok(notice.portraitRight<notice.messageLeft,JSON.stringify({width,theme,lang,notice}));
    assert.ok(notice.messageRight<=notice.buttonLeft);
    await devtools.evaluate(`testToast.show(${JSON.stringify(lang==='ru'?'PR влит. Теперь можно вернуться к другим задачам; длинная реплика тоже должна полностью помещаться в уведомлении.':'PR merged. We can return to the other tasks now; a longer message must also remain fully readable in this notification.')},{tone:'success',celebrate:true,duration:0});`);await delay(600);
    assert.equal(await devtools.evaluate("document.documentElement.scrollWidth>innerWidth"),false);
    if(width===390&&theme==='neon'&&lang==='ru'&&!legacy){
      const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",clip:{x:0,y:650,width,height:250,scale:1}});writeFileSync(`${output}/toast.png`,Buffer.from(shot.data,"base64"));
    }
    await devtools.evaluate("document.documentElement.dataset.kuramiMascot='off'");
    assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.toast__kurami')).display"),"none");
    assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.toast__icon')).display"),"grid");
    await devtools.evaluate("document.documentElement.dataset.kuramiMascot='on';testToast.hide()");
    await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:width/2,y:200}]});
    await devtools.call("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:width/2,y:400}]});await delay(180);
    const pull=await devtools.evaluate<any>(`(()=>{const p=document.querySelector('.kurami-pull'),r=p?.getBoundingClientRect(),m=p?.querySelector('.kurami-mood__figure').getBoundingClientRect(),l=p?.querySelector('.kurami-pull__label').getBoundingClientRect();return p&&{ready:p.classList.contains('is-ready'),left:r.left,right:r.right,top:r.top,imageRight:m.right,labelLeft:l.left,gap:l.left-m.right,mood:p.querySelector('[data-kurami-mood]').dataset.kuramiMood}})()`);
    assert.ok(pull?.ready,JSON.stringify({width,theme,lang,pull}));
    assert.ok(pull.left>=0&&pull.right<=width+1&&pull.top>=0);
    assert.ok(pull.gap>=0&&pull.gap<=20,'portrait and label stay adjacent without overlap');
    assert.equal(pull.mood,"thinking");
    if(width===390&&theme==='neon'&&lang==='ru'&&!legacy){
      const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",clip:{x:0,y:0,width,height:190,scale:1}});writeFileSync(`${output}/pull.png`,Buffer.from(shot.data,"base64"));
    }
    await devtools.call("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await delay(60);
    assert.equal(await devtools.evaluate("window.refreshCalls"),1);
    assert.equal(await devtools.evaluate("document.querySelector('.kurami-pull [data-kurami-mood]').dataset.kuramiMood"),"working");
    await devtools.evaluate("finishRefresh()");await delay(60);
    assert.equal(await devtools.evaluate("!!document.querySelector('.kurami-pull')"),false);
    await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:width/2,y:200}]});
    await devtools.call("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:width/2,y:240}]});
    await devtools.call("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});await delay(40);
    assert.equal(await devtools.evaluate("!!document.querySelector('.kurami-pull')"),false,'cancelled pulls remove the portrait');
    assert.equal(await devtools.evaluate("window.refreshCalls"),1,'a cancelled pull never refreshes');
    layouts++;
  }
  await devtools.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  await devtools.evaluate("testToast.show('PR merged',{tone:'success',celebrate:true,duration:0})");
  assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.toast__kurami')).animationName"),"none");
  console.log(JSON.stringify({ok:true,layouts,checks:"toast text and dismiss remain clear; compact pull portrait and label; refreshed/cancelled lifecycle; mascot off; reduced motion",out:output}));
} finally {await browser.close();await new Promise<void>(done=>server.close(()=>done()));}
