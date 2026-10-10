import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {createHubServer} from "../../src/hub/server.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";
import {findBrowser,launchBrowser} from "../../src/ui-library/testing/devtools.ts";
import {AUDIT_EXPRESSION,inventoryExpression} from "../../src/ui-library/testing/audit.ts";
import {HubControlError} from "../../src/hub/controls.ts";

const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,"127.0.0.1",done));
const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()));
const base=`http://127.0.0.1:${port}`;const actions:string[]=[];let codexModel="gpt-6-sol",codexEffort:string|null="high";
let lastModelPayload:Record<string,unknown>={};
let failRead=false,failWrite=false,writeGate:Promise<void>|null=null;
const settings={version:1,max_llm_running_global:2,ai_triage_daily:5,max_active_global:4,max_previews_global:3,max_preview_builds_global:1,preview_ttl_hours:24,project_wip:{pickflick:2}};
const server=createHubServer({snapshot:syntheticHubSnapshot,authorize:async()=>"synthetic-owner",controlOrigin:base,
  controls:{execute:async(action,payload={})=>{
    if(failRead&&["models","settings","server","appearance","composio-check"].includes(action))throw new HubControlError("stale_settings");
    if(action==="models")return {models:[{value:"gpt-6-sol",label:"Sol",efforts:["medium","high","xhigh"],defaultEffort:"high"},{value:"gpt-6-astra",label:"Astra",efforts:["medium","high"],defaultEffort:"high"},{value:"no-default",label:"No default",efforts:["low"],defaultEffort:"invalid"},{value:"no-levels",label:"No levels",efforts:[]}],hermes:"gpt-6-sol",hermesProvider:"openai-codex",codex:codexModel,codexEffort,codexVersion:"user:browser"};
    if(action==="settings")return {settings:{revision:1,settings,idle:{idle:true}}};
    if(action==="server")return {health:{revision:1,intervalMinutes:20,allowedIntervals:[5,10,12,15,20,30,60]},devResources:{revision:0,cores:4,testJobs:2,memoryGiB:0,serverCores:8,memoryChoices:[0,8,12,16]},release:{head:"a".repeat(40),remote:"b".repeat(40),tested:null,rollbackTo:"c".repeat(40),drift:[{code:"checkout_behind",ru:"Рабочая версия позади main на 2 коммита",en:"The live version is 2 commits behind main"}],last:{action:"deploy",status:"succeeded",to:"a".repeat(40),startedAt:"2026-09-16T09:00:00Z",steps:[{name:"Move checkout",status:"done"},{name:"Digest build",status:"skipped"}],notes:[]}}};
    if(action==="appearance")return {appearance:{revision:0,theme:"paper",mode:null,themes:{paper:["light","dark"],neon:["light","dark"]}}};
    if(action==="composio-check")return {contours:[{contour:"broad",ok:true,tools:3,diff:[],warnings:[]},{contour:"read",ok:true,tools:7,diff:[],warnings:[]},{contour:"automation",ok:true,tools:1,diff:[],warnings:[]}]};
    if(writeGate)await writeGate;
    if(failWrite)throw new HubControlError("command_failed");
    actions.push(action);if(action==="model-apply"){lastModelPayload=payload;codexModel=String(payload.model);codexEffort=payload.effort as string|null;}
    return {ok:true,action:"applied",outcome:action==="codex-reset"?"reset":undefined};
  }}});
await new Promise<void>(done=>server.listen(port,"127.0.0.1",done));
const browser=await launchBrowser(findBrowser());const {devtools}=browser;
const output=resolve(import.meta.dirname,"../../dist/hub-browser");mkdirSync(output,{recursive:true});
async function wait(expression:string){for(let attempt=0;attempt<100;attempt++){if(await devtools.evaluate<boolean>(expression))return;await delay(100);}throw new Error("Browser condition timed out: "+expression);}
async function screenshot(name:string,selector?:string){
  await devtools.evaluate("document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,0)");await delay(80);
  const clip=selector?await devtools.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()`):undefined;
  const result=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,...(clip?{clip}:{})});writeFileSync(resolve(output,name+".png"),Buffer.from(result.data,"base64"));
}
async function activityAlignment(){
  assert.equal(await devtools.evaluate("[...document.querySelectorAll('.work-item:not([hidden])')].every(item=>{const link=item.querySelector('.work-item__link a'),summary=item.querySelector('.work-events > summary');if(!link)return true;const a=link.getBoundingClientRect(),b=summary.getBoundingClientRect(),body=item.querySelector('.work-item__body').getBoundingClientRect();return innerWidth<=750?a.left>=body.right-1&&a.bottom<=b.top+1:Math.abs((a.top+a.bottom)-(b.top+b.bottom))<2&&a.right<=b.left+1;})"),true,"mobile links sit beside the title; desktop actions share a row");
  assert.equal(await devtools.evaluate("[...document.querySelectorAll('.health-cell')].every(cell=>getComputedStyle(cell).boxShadow!=='none')"),true,"health cards use the shared card shadow");
}
try {
  for(const lang of ["en","ru"]){
    await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:false});
    await devtools.call("Emulation.setDeviceMetricsOverride",{width:1280,height:1100,deviceScaleFactor:1,mobile:false});
    await devtools.call("Page.navigate",{url:base+`/${lang}/`});await wait("document.readyState==='complete' && !!document.querySelector('.codex-grid')");
    await devtools.evaluate("document.fonts.ready");
    assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('h1')).position"),"absolute","Overview is not visible");
    const heights=await devtools.evaluate<number[]>("[...document.querySelector('.codex-grid').children].map(el=>el.getBoundingClientRect().height)");
    assert(Math.max(...heights)-Math.min(...heights)<1,"Codex panels share one row height");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=tokens]:not([hidden]) .metric__value').title"),lang==="en"?"14,268,300":"3 812 400","30 days is the default; selections persist across languages");
    assert.equal(await devtools.evaluate("document.querySelector('.activity').tagName"),"SECTION");
    await activityAlignment();
    assert.equal(await devtools.evaluate("document.querySelectorAll('.activity-list > [data-work-id]:not([hidden])').length"),5,"five work items are always visible");
    assert.equal(await devtools.evaluate("document.querySelectorAll('.problem').length"),1,"CI and review are one problem object");
    assert.equal(await devtools.evaluate("document.querySelector('.problem__reasons').children.length"),2);
    assert.equal(await devtools.evaluate("document.querySelector('.limit-history__legend').textContent"),"7d","Pro-style weekly-only account has no phantom 5h series");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=limits]:not([hidden]) table thead tr').children.length"),2);
    assert.equal(await devtools.evaluate("document.querySelector('.work-item__meta').textContent.includes('Running')"),lang==="en","ending a Codex turn does not complete the task");
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('#hub-dashboard [data-hub-control]')].every(el=>getComputedStyle(el).borderTopStyle==='solid' && getComputedStyle(el).borderTopColor!=='rgba(0, 0, 0, 0)' && el.getBoundingClientRect().height>=(el.classList.contains('button--compact')&&!matchMedia('(pointer: coarse)').matches?32:36))"),true,"dashboard controls have visible borders and appropriate touch targets");
    assert.equal(await devtools.evaluate("document.querySelector('[data-hub-control=codex-reset]').classList.contains('button--warning') && document.querySelector('[data-hub-control=codex-reset]').getBoundingClientRect().height===32"),true,"Reset uses a compact caution button on desktop");
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[]);
    assert.deepEqual(await devtools.evaluate(inventoryExpression()),[]);
    assert.equal(await devtools.evaluate("document.querySelectorAll('.task-summary__cell').length"),3);
    assert.equal(await devtools.evaluate("document.querySelectorAll('.orchestrator-grid > div').length"),6);
    assert.equal(await devtools.evaluate("document.querySelectorAll('.repository-filters [data-selection-control]').length"),4);
    assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.activity-list > .work-item')).borderTopWidth"),"0px","log rows share one container, not widget borders");
    if(lang==="en"){await screenshot("hub-desktop");await screenshot("hub-summary",".overview-grid");await screenshot("hub-reset",".limits");await screenshot("hub-activity",".activity");await screenshot("hub-orchestrator",".orchestrator-state");}
    assert.equal(await devtools.evaluate("document.querySelectorAll('.period-switch').length"),1,"one global period control");
    await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"7\"]').click()");
    assert.equal(await devtools.evaluate("typeof setPeriod"),"function","period runtime loaded");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=tokens]:not([hidden]) .metric__value').textContent"),"3.8M");
    await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"7\"]').focus(); document.activeElement.click()");
    assert.equal(await devtools.evaluate("document.activeElement.getAttribute('aria-pressed')"),"true","period selection keeps keyboard focus");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=models]:not([hidden]) td').textContent"),"3M");
    assert.match(await devtools.evaluate<string>("document.querySelector('[data-period-panel=tokens]:not([hidden]) .token-cost strong').textContent"),/^\$/,"API equivalent has no tilde prefix");
    const positions=()=>devtools.evaluate<number[]>("['.token-totals','.token-breakdown','.reset-control','.limit-history'].map(selector=>{const el=document.querySelector(selector);return el.getBoundingClientRect().top-el.closest('.hub-panel').getBoundingClientRect().top;})");
    const beforeExpansion=await positions();
    await devtools.evaluate("document.querySelector('[data-period-panel=models]:not([hidden]) .model-breakdown > summary').click()");
    const afterExpansion=await positions();
    assert(beforeExpansion.every((position,index)=>Math.abs(position-afterExpansion[index]!)<1),"model expansion stretches left panels without moving their contents");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=models]:not([hidden]) .model-breakdown').open"),true);
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=models]:not([hidden]) .model-detail-table thead tr').children.length"),6);
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"per-model cache/input/output breakdown is accessible");
    if(lang==="en")await screenshot("hub-models",".models");
    await devtools.evaluate("document.querySelector('[data-period-panel=models]:not([hidden]) .model-breakdown > summary').click()");
    await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"7\"]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('.period-metric [data-period-days=\"7\"] .metric__value').textContent"),"29");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=commits]:not([hidden]) .project-table td:nth-child(4)').innerText.trim()"),"14","the visible figure (the column label is for phones)");
    assert.equal(await devtools.evaluate("document.querySelectorAll('[data-period-panel=commits][data-period-days=\"7\"] [data-chart-point]').length"),7);
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('[data-period-panel]:not([hidden])')].every(panel=>panel.dataset.periodDays==='7')"),true,"all statistics share one period");
    assert.equal(await devtools.evaluate("document.querySelector('.period-cost [data-period-days=\"7\"]').hidden"),false,"top cost uses the summary period");
    assert.equal(await devtools.evaluate("document.querySelectorAll('[name=commit-repository]:checked').length"),4);
    await devtools.evaluate("document.querySelector('[name=commit-repository][value=pickflick]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('.period-metric [data-period-days=\"7\"] .metric__value').textContent"),"15","repository selection recomputes totals");
    await devtools.evaluate("[...document.querySelectorAll('[name=commit-repository]:checked')].forEach(input=>input.click())");
    assert.equal(await devtools.evaluate("document.querySelector('.period-metric [data-period-days=\"7\"] .metric__value').textContent"),"0","empty repository selection is intentional zero");
    await devtools.evaluate("[...document.querySelectorAll('[name=commit-repository]')].forEach(input=>input.click())");
    await devtools.evaluate("const p=document.querySelector('[name=activity-project]');p.value='tailortales';p.dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await devtools.evaluate("document.querySelectorAll('.activity-list > [data-work-id]:not([hidden])').length"),5);
    assert.equal(await devtools.evaluate("document.querySelectorAll('.activity-more-list > [data-work-id]:not([hidden])').length"),1);
    await devtools.evaluate("const a=document.querySelector('[name=activity-agent]');a.value='Codex';a.dispatchEvent(new Event('change',{bubbles:true}))");
    assert.equal(await devtools.evaluate("document.querySelectorAll('.activity-list > [data-work-id]:not([hidden])').length"),4);
    assert.equal(await devtools.evaluate("document.querySelector('.activity-more').hidden"),true);
    await devtools.evaluate("[...document.querySelectorAll('.activity-filters select')].forEach(s=>{s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}))})");
    await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"7\"]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=limits]:not([hidden]) table tbody').children.length"),7);
    await devtools.evaluate("document.querySelector('.activity-list > [data-work-id]:not([hidden]) .work-events > summary').click()");
    await devtools.evaluate("document.querySelector('.activity-list > [data-work-id]:not([hidden]) .work-event-detail > details > summary').click()");
    assert.equal(await devtools.evaluate("document.querySelectorAll('.work-event-detail > details[open]').length"),1);
    await devtools.evaluate("refreshHub(true)");
    assert.equal(await devtools.evaluate("document.querySelectorAll('.work-event-detail > details[open]').length"),1,"refresh restores only the selected raw-events disclosure");
    await devtools.evaluate("document.querySelector('.usage > summary').click();document.querySelector('[data-period-key=global][data-period-days=\"7\"]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=usage]:not([hidden]) .metric__value').textContent"),"6");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=usage]:not([hidden]) .usage-coverage').textContent"),lang==="en"?"Logs 5/6":"Логи 5/6");
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"expanded Usage and selected period are accessible");
    if(lang==="en")await screenshot("hub-usage",".usage");
    const menuActions=actions.length;
    await devtools.evaluate("document.querySelector('.site-switcher > summary').click()");
    assert.equal(await devtools.evaluate("document.querySelector('.site-switcher').open"),true);
    assert.equal(await devtools.evaluate("document.querySelectorAll('[data-quick-capture]').length"),0,'Hub has no Projects quick task');
    const savedTheme=await devtools.evaluate<{theme:string;variant?:string}>("({theme:document.documentElement.dataset.theme,variant:document.documentElement.dataset.kuramiTheme})");
    for(const [variant,mode] of [['paper','light'],['paper','dark'],['neon','dark'],['neon','light']]){
      await devtools.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(mode)};document.documentElement.dataset.kuramiTheme=${JSON.stringify(variant)}`);
      const menuLayout=await devtools.evaluate<any>("(() => {const menu=document.querySelector('.site-switcher'),trigger=menu.querySelector('summary'),nav=menu.querySelector('nav'),t=trigger.getBoundingClientRect(),n=nav.getBoundingClientRect(),links=[...nav.querySelectorAll('a')].map(a=>a.getBoundingClientRect()),theme=document.querySelector('[data-theme-panel]');return {label:trigger.textContent.trim(),rightGap:n.right-t.right,topGap:n.top-t.bottom,left:n.left,stacked:links.every((r,i)=>!i||r.top>=links[i-1].bottom),surface:getComputedStyle(nav).backgroundColor===getComputedStyle(theme).backgroundColor,shadow:getComputedStyle(nav).boxShadow===getComputedStyle(theme).boxShadow,x:links[1].x+links[1].width/2,y:links[1].y+links[1].height/2};})()");
      assert.equal(menuLayout.label,lang==='en'?'Apps':'Приложения');assert.ok(Math.abs(menuLayout.rightGap)<=1);assert.ok(Math.abs(menuLayout.topGap-8)<=1);assert.ok(menuLayout.left>=0&&menuLayout.stacked&&menuLayout.surface&&menuLayout.shadow,JSON.stringify({variant,mode,menuLayout}));
      await devtools.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:menuLayout.x,y:menuLayout.y});
      await wait("document.querySelector('.site-switcher nav a:nth-child(2)').getAnimations().every(a=>a.playState!=='running')");
      const hover=await devtools.evaluate<any>("(() => {const link=document.querySelector('.site-switcher nav a:nth-child(2)'),probe=document.createElement('span');probe.style.background='color-mix(in srgb,var(--status-info) 10%,var(--surface-raised))';document.body.append(probe);const result={actual:getComputedStyle(link).backgroundColor,expected:getComputedStyle(probe).backgroundColor,hovered:link.matches(':hover')};probe.remove();return result;})()");
      assert.ok(hover.hovered&&hover.actual===hover.expected,`${variant} ${mode}: Apps link has blue hover ${JSON.stringify(hover)}`);
      if(lang==='en'){
        const clip=await devtools.evaluate<any>("(() => {const t=document.querySelector('.site-switcher > summary').getBoundingClientRect(),n=document.querySelector('.site-switcher > nav').getBoundingClientRect();return {x:n.left-8,y:t.top-8,width:n.width+16,height:n.bottom-t.top+16,scale:1};})()");
        const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',clip});writeFileSync(resolve(output,`hub-apps-${variant}-${mode}.png`),Buffer.from(shot.data,'base64'));
      }
    }
    await devtools.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(savedTheme.theme)};${savedTheme.variant?`document.documentElement.dataset.kuramiTheme=${JSON.stringify(savedTheme.variant)}`:"delete document.documentElement.dataset.kuramiTheme"}`);
    await devtools.call("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,x:4,y:400});
    await devtools.call("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,x:4,y:400});
    assert.equal(await devtools.evaluate("document.querySelector('.site-switcher').open"),false,"Apps closes on outside click");
    await devtools.evaluate("document.querySelector('.site-switcher > summary').click();document.querySelector('.site-switcher > summary').click()");
    assert.equal(await devtools.evaluate("document.querySelector('.site-switcher').open"),false,"Apps closes on repeat click");
    await devtools.evaluate("(innerWidth<=620?document.querySelector('[data-mobile-menu=controls]'):document.querySelector('header [data-hub-control=menu]')).click()");
    assert.equal(await devtools.evaluate("document.querySelector('#hub-controls-popover').matches(':popover-open')"),true);
    assert.equal(await devtools.evaluate("document.querySelector('dialog').open"),false,"Controls first opens a popover, not a modal");
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('#hub-controls-popover button')].every(button=>button.textContent.trim().length>0)"),true,"popover actions have visible labels beside icons");
    assert.equal(await devtools.evaluate("document.querySelector('header [data-hub-control=menu]').getAttribute('aria-expanded')"),"true");
    if(lang==="en")await screenshot("hub-controls","#hub-controls-popover");
    assert.equal(actions.length,menuActions,"opening the Controls menu does not mutate state");
    const menuPoint=await devtools.evaluate<{x:number;y:number}>("(()=>{const r=document.querySelector('header [data-hub-control=menu]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await devtools.call("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...menuPoint});
    await devtools.call("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...menuPoint});
    await wait("!document.querySelector('#hub-controls-popover').matches(':popover-open')");
    await devtools.evaluate("(innerWidth<=620?document.querySelector('[data-mobile-menu=controls]'):document.querySelector('header [data-hub-control=menu]')).click()");
    await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
    await devtools.call("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
    await wait("!document.querySelector('#hub-controls-popover').matches(':popover-open')");
    assert.equal(await devtools.evaluate("document.activeElement.dataset.hubControl"),"menu","Escape restores focus to the header");
    await devtools.evaluate("(innerWidth<=620?document.querySelector('[data-mobile-menu=controls]'):document.querySelector('header [data-hub-control=menu]')).click();document.querySelector('[data-hub-control=models]').click()");await wait("!!document.querySelector('form[data-target=codex]')");
    assert.equal(await devtools.evaluate("document.querySelector('dialog').open"),true);
    assert.equal(await devtools.evaluate("getComputedStyle(document.documentElement).overflowY==='hidden'&&getComputedStyle(document.body).overflowY==='hidden'"),true,"modal locks the page scroll, not just focus");
    const lockedScroll=await devtools.evaluate<number>("scrollY");
    await devtools.call("Input.dispatchMouseEvent",{type:"mouseWheel",x:4,y:450,deltaX:0,deltaY:250});
    await delay(100);
    assert.equal(await devtools.evaluate("scrollY"),lockedScroll,"wheel outside the modal cannot move the page");
    assert.equal(await devtools.evaluate("document.querySelector('#hub-controls-popover').matches(':popover-open')"),false);
    assert.equal(await devtools.evaluate("document.querySelector('#hub-control-dialog-title').textContent"),lang==='en'?'Models':'Модели');
    assert.equal(await devtools.evaluate("!!document.querySelector('dialog [data-hub-control=menu]')"),false,"modal does not contain an extra Back action");
    assert.equal(await devtools.evaluate("document.querySelectorAll('form[data-target=hermes] [name=effort]').length"),0);
    if(lang==='en'){
      const choose=async(name:string,value:string)=>devtools.evaluate(`(()=>{const input=document.querySelector('form[data-target=codex] [name=${name}]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      const effortValue=()=>devtools.evaluate<string>("document.querySelector('form[data-target=codex] [name=effort]').value");
      await choose('effort','medium');await choose('model','gpt-6-astra');
      assert.equal(await effortValue(),'medium','model transition preserves a supported choice');
      await choose('model','gpt-6-sol');await choose('effort','xhigh');await choose('model','gpt-6-astra');
      assert.equal(await effortValue(),'high','unsupported effort falls back to advertised default');
      assert.match(await devtools.evaluate<string>("document.querySelector('#codex-effort-status').textContent"),/xhigh.*high/);
      await choose('model','no-default');
      assert.equal(await effortValue(),'','invalid catalog default is never offered');
      assert.equal(await devtools.evaluate("document.querySelector('form[data-target=codex] button[type=submit]').disabled"),true);
      await choose('effort','low');
      assert.equal(await devtools.evaluate("document.querySelector('form[data-target=codex] button[type=submit]').disabled"),false);
      await choose('model','no-levels');
      assert.equal(await devtools.evaluate("document.querySelector('form[data-target=codex] [name=effort]').disabled"),true);
      assert.equal(await devtools.evaluate("document.querySelector('form[data-target=codex] button[type=submit]').disabled"),true,'no supported levels cannot save an explicit effort');
      await choose('model','gpt-6-sol');await choose('effort','medium');
      assert.equal(await devtools.evaluate("document.querySelector('form[data-target=codex] [name=effort]').closest('.form-field').dataset.dirty"),'true');
      for(const [theme,mode] of [['paper','light'],['neon','dark']]){
        for(const width of [390,1280]){
          await devtools.call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<500});
          await devtools.evaluate(`document.querySelector('[data-theme-choice=${theme}]').click();document.querySelector('[data-mode-choice=${mode}]').click()`);
          await delay(200);assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],`effort ${theme} ${width}`);
          assert.equal(await devtools.evaluate("document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth"),true);
          await screenshot(`hub-effort-${theme}-${width}`,'dialog');
        }
      }
      await devtools.evaluate("document.querySelector('[data-theme-choice=paper]').click();document.querySelector('[data-mode-choice=light]').click();document.querySelector('form[data-target=codex]').requestSubmit()");
      assert.equal(await devtools.evaluate("document.querySelector('#hub-confirm-changes tbody tr:last-child td:last-child').textContent"),'medium');
      await devtools.evaluate("document.querySelector('[data-hub-cancel]').click()");
      assert.equal(await effortValue(),'medium','cancel keeps the proposed effort without writing');
      await devtools.evaluate("document.querySelector('form[data-target=codex]').requestSubmit();document.querySelector('[data-hub-confirm]').click()");
      await wait("!document.querySelector('[data-hub-confirm]').hasAttribute('aria-busy') && !!document.querySelector('form[data-target=codex] [name=effort]')");
      assert.deepEqual(lastModelPayload,{action:'model-apply',confirm:true,target:'codex',model:'gpt-6-sol',expectedModel:'gpt-6-sol',expectedEffort:'high',expectedVersion:'user:browser',effort:'medium'},'effort-only save submits both values and the observed version');
      assert.equal(codexEffort,'medium');
      assert.equal(await effortValue(),'medium','reloaded control displays saved effort');
      codexEffort=null;
      await devtools.evaluate("loadControl('models')");
      assert.equal(await effortValue(),'','unset is not silently replaced by first option');
      await choose('model','no-levels');
      assert.equal(await devtools.evaluate("document.querySelector('form[data-target=codex] button[type=submit]').disabled"),false,'an unset effort can remain unset with no supported levels');
      await devtools.evaluate("document.querySelector('form[data-target=codex]').requestSubmit()");
      assert.equal(await devtools.evaluate("pending.payload.effort"),null,'disabled unset selector submits null explicitly');
      await devtools.evaluate("document.querySelector('[data-hub-cancel]').click()");
      codexEffort='medium';
      await devtools.evaluate("loadControl('models')");
    }
    const proposed=codexModel==='gpt-6-astra'?'gpt-6-sol':'gpt-6-astra';
    await devtools.evaluate(`document.querySelector('form[data-target=codex] select').value=${JSON.stringify(proposed)};document.querySelector('form[data-target=codex] select').dispatchEvent(new Event('change',{bubbles:true}))`);
    assert.equal(await devtools.evaluate("document.querySelector('form[data-target=codex] .form-field').dataset.dirty"),'true','changed model has an informational field accent');
    await devtools.evaluate("document.querySelector('form[data-target=codex]').requestSubmit()");
    assert.equal(await devtools.evaluate("document.querySelector('#hub-confirm-changes').hidden"),false,'confirmation shows a comparison table');
    assert.equal(await devtools.evaluate("document.querySelector('#hub-confirm-changes tbody tr td:last-child').textContent"),proposed,'proposed value appears in After column');
    await delay(200);assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],'comparison table contrast and accessibility');
    if(lang==='en')await screenshot('hub-model-confirmation','dialog');
    const before=actions.length;assert.equal(await devtools.evaluate("document.querySelector('#hub-control-confirm').hidden"),false);
    assert.equal(await devtools.evaluate("document.querySelector('[data-hub-confirm]').classList.contains('button--primary')"),true,"applying a model: Confirm is the one primary button");
    assert.equal(await devtools.evaluate("(()=>{const row=document.querySelector('#hub-control-confirm .dialog__actions'),cancel=row.querySelector('[data-hub-cancel]'),confirm=row.querySelector('[data-hub-confirm]'),r=row.getBoundingClientRect(),a=cancel.getBoundingClientRect(),b=confirm.getBoundingClientRect();return cancel.compareDocumentPosition(confirm)===Node.DOCUMENT_POSITION_FOLLOWING&&a.right<=b.left&&Math.abs(r.right-b.right)<1;})()"),true,"Cancel then Confirm align to the dialog's right edge");
    await delay(100);assert.equal(actions.length,before,"opening confirmation never applies a model");
    if(lang==="en"){
      await devtools.evaluate("document.querySelector('[data-hub-confirm]').click()");await wait("(()=>{const toast=document.querySelector('[data-toast-region]');return !toast.hidden&&toast.dataset.tone==='success'&&toast.querySelector('[data-toast-message]').textContent.startsWith('Saved · ')&&document.querySelector('#hub-control-result').textContent==='';})()");
      await wait("!document.querySelector('[data-hub-confirm]').hasAttribute('aria-busy')");
      assert.equal(actions.at(-1),"model-apply");
      assert.equal(await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"7\"]').getAttribute('aria-pressed')"),"true","refresh preserves period selection");
      assert.equal(await devtools.evaluate("document.querySelector('.usage').open"),true,"refresh preserves open Usage");
      assert.equal(await devtools.evaluate("document.querySelector('.activity-list > [data-work-id]:not([hidden]) .work-events').open"),true,"refresh preserves the selected work item's events");
      assert.equal(await devtools.evaluate("[...document.querySelectorAll('.work-events[open]')].length"),1,"identical disclosure labels do not open unrelated work items");
      assert.equal(await devtools.evaluate("document.querySelector('[name=commit-repository][value=pickflick]').checked"),true,"refresh preserves repository selection");
    }else await devtools.evaluate("document.querySelector('[data-hub-cancel]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('[data-dialog-close]').textContent.trim()"),"","close control is icon-only");
    assert.equal(await devtools.evaluate("document.querySelector('[data-dialog-close]').getAttribute('aria-label')"),lang==="en"?"Close":"Закрыть");
    await devtools.evaluate("document.querySelector('[data-dialog-close] .button__svg path').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    assert.equal(await devtools.evaluate("document.querySelector('dialog').open"),false,"clicking the close icon closes the dialog");
    assert.equal(await devtools.evaluate("getComputedStyle(document.documentElement).overflowY==='hidden'"),false,"closing the modal releases the page scroll");
    await devtools.evaluate("document.querySelector('[data-hub-control=restart]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('[data-hub-confirm]').classList.contains('button--warning')"),true,"restart confirmation uses caution, not danger");
    await delay(200);assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"restart caution contrast");
    if(lang==='en')await screenshot('hub-restart-accent','#hub-control-dialog');
    await devtools.evaluate("document.querySelector('[data-hub-cancel]').click()");
    await devtools.evaluate("document.querySelector('[data-hub-control=codex-reset]').click()");
    await delay(80);
    assert.equal(actions.length,before+(lang==="en"?1:0),"reset waits for confirmation");
    assert.equal(await devtools.evaluate("document.querySelector('[data-hub-confirm]').classList.contains('button--warning')&&!document.querySelector('[data-hub-confirm]').classList.contains('button--primary')"),true,"consuming a reset switches the confirmation to caution without a stale informational class");
    await devtools.evaluate("document.querySelector('[data-hub-cancel]').click()");
    await devtools.evaluate("(innerWidth<=620?document.querySelector('[data-mobile-menu=controls]'):document.querySelector('header [data-hub-control=menu]')).click();document.querySelector('[data-hub-control=settings]').click()");await wait("!!document.querySelector('[data-hub-submit=settings-apply]')");
    await devtools.evaluate("(()=>{const input=document.querySelector('[data-hub-submit=settings-apply] input');input.value=String(Number(input.defaultValue)+1);input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    assert.equal(await devtools.evaluate("document.querySelector('[data-hub-submit=settings-apply] .form-field').dataset.dirty"),'true');
    await delay(200);assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],'dirty field contrast');
    await devtools.evaluate("document.querySelector('[data-hub-submit=settings-apply]').requestSubmit()");
    assert.equal(await devtools.evaluate("document.querySelectorAll('#hub-confirm-changes tbody tr').length"),1,'confirmation lists only changed fields');
    await devtools.evaluate("document.querySelector('[data-hub-cancel]').click();(()=>{const input=document.querySelector('[data-hub-submit=settings-apply] input');input.value=input.defaultValue;input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    assert.equal(await devtools.evaluate("document.querySelector('[data-hub-submit=settings-apply] .form-field').dataset.dirty"),'false','returning a setting to its original value removes the accent');
    for(const [action,tone]of [['settings-reset','warning'],['settings-rollback','warning']]){
      await devtools.evaluate(`document.querySelector('[data-hub-control=${action}]').click()`);
      assert.equal(await devtools.evaluate(`document.querySelector('[data-hub-confirm]').classList.contains('button--${tone}')&&[...document.querySelector('[data-hub-confirm]').classList].filter(c=>['button--primary','button--info','button--warning','button--subtle','button--danger'].includes(c)).length===1`),true,'confirmation accent switches for '+action);
      await delay(200);assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],action+' accent contrast');
      await devtools.evaluate("document.querySelector('[data-hub-cancel]').click()");
    }
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('dialog button')].every(el=>!el.classList.contains('button--quiet'))"),true,"dialog actions look like buttons");
    for(const width of [320,390,1280]){
      await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:width<500,maxTouchPoints:1});
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<500});
      assert.equal(await devtools.evaluate("document.querySelector('[data-hub-control=codex-reset]').getBoundingClientRect().height"),width<500?36:32,"compact Reset uses the shared touch height on phones");
      assert.equal(await devtools.evaluate("[...document.querySelectorAll('[data-period-key]')].filter(el=>el.getBoundingClientRect().width).every(el=>el.getBoundingClientRect().height >= (matchMedia('(pointer: coarse)').matches?36:32))"),true,"period selectors retain touch targets");
      assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],`dialog audit ${lang} ${width}`);
      assert.deepEqual(await devtools.evaluate(inventoryExpression()),[]);
      const bounds=await devtools.evaluate<{width:number;scroll:number;client:number}>("({width:document.querySelector('dialog').getBoundingClientRect().width,scroll:document.querySelector('dialog').scrollWidth,client:document.querySelector('dialog').clientWidth})");
      assert(bounds.width<=width&&bounds.scroll<=bounds.client+1,"settings dialog fits the viewport");
    }
    if(lang==="en")await screenshot("hub-settings");
    await devtools.evaluate("document.querySelector('[data-dialog-close]').click()");
    // Server and Appearance have panels of their own; Settings keeps only the run limits.
    assert.equal(await devtools.evaluate("!document.querySelector('[data-hub-submit=health-apply],[data-hub-submit=appearance-apply]')"),true,"Settings holds only the run limits");
    await devtools.evaluate("(innerWidth<=620?document.querySelector('[data-mobile-menu=controls]'):document.querySelector('header [data-hub-control=menu]')).click();document.querySelector('[data-hub-control=server]').click()");await wait("!!document.querySelector('[data-hub-submit=dev-resources-apply]')");
    assert.equal(await devtools.evaluate("!!document.querySelector('[data-hub-submit=health-apply]')&&document.querySelectorAll('[data-hub-submit=dev-resources-apply] select').length===3"),true,"Server shows the health interval and the development limits");
    assert.equal(await devtools.evaluate("document.querySelector('[data-hub-submit=release-apply] button').disabled===false&&!!document.querySelector('[data-hub-submit=release-rollback]')&&document.querySelector('.release-drift').textContent.length>0"),true,"Server shows the release state, drift and both release actions");
    await devtools.evaluate("document.querySelector('[data-hub-submit=release-apply]').requestSubmit()");
    assert.equal(await devtools.evaluate("document.querySelectorAll('#hub-confirm-changes tbody tr').length"),1,"a release asks to confirm the exact version change");
    await devtools.evaluate("document.querySelector('[data-hub-cancel]').click()");
    await devtools.evaluate("(()=>{const form=document.querySelector('[data-hub-submit=dev-resources-apply]');form.elements.cores.value='2';form.elements.testJobs.value='3';form.requestSubmit();})()");
    assert.match(await devtools.evaluate<string>("document.querySelector('#hub-control-result').textContent"),/cannot exceed cores|не может быть больше ядер/,"test jobs above cores are refused before confirming");
    for(const width of [320,390,1280]){
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<500});
      assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],`server panel audit ${lang} ${width}`);
      const bounds=await devtools.evaluate<{width:number;scroll:number;client:number}>("({width:document.querySelector('dialog').getBoundingClientRect().width,scroll:document.querySelector('dialog').scrollWidth,client:document.querySelector('dialog').clientWidth})");
      assert(bounds.width<=width&&bounds.scroll<=bounds.client+1,`server dialog fits ${width}`);
    }
    if(lang==="en")await screenshot("hub-server");
    await devtools.evaluate("document.querySelector('[data-dialog-close]').click()");
    if(lang==="en"){await devtools.evaluate("document.querySelector('header [data-hub-control=menu]').click()");await delay(250);await screenshot("hub-controls-menu");await devtools.evaluate("document.querySelector('header [data-hub-control=menu]').click()");}
    await devtools.evaluate("(innerWidth<=620?document.querySelector('[data-mobile-menu=controls]'):document.querySelector('header [data-hub-control=menu]')).click();document.querySelector('[data-hub-control=appearance]').click()");await wait("!!document.querySelector('[data-hub-submit=appearance-apply]')");
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],`appearance panel audit ${lang}`);
    await devtools.evaluate("document.querySelector('[data-dialog-close]').click()");
    const beforeCheck=actions.length;
    await devtools.evaluate("(innerWidth<=620?document.querySelector('[data-mobile-menu=controls]'):document.querySelector('header [data-hub-control=menu]')).click();document.querySelector('[data-hub-control=composio-check]').click()");
    await wait("document.querySelectorAll('.composio-contour').length===3");
    assert.equal(await devtools.evaluate("document.querySelector('#hub-control-dialog-title').textContent"),lang==='en'?'Composio check':'Проверка Composio');
    assert.equal(await devtools.evaluate("!!document.querySelector('[data-hub-control=composio-apply]')"),false,"synchronized contours have no apply button");
    await devtools.evaluate("document.querySelector('#hub-control-content [data-hub-control=composio-check]').click()");
    await wait("document.querySelectorAll('.composio-contour').length===3");
    assert.equal(actions.length,beforeCheck,"checking Composio never applies settings");
    await devtools.call("Emulation.setDeviceMetricsOverride",{width:390,height:1000,deviceScaleFactor:1,mobile:true});
    assert.equal(await devtools.evaluate("document.querySelector('dialog').getBoundingClientRect().height<600"),true,"three synchronized contours fit a compact dialog");
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"Composio is readable on a phone");
    if(lang==='en')await screenshot('hub-composio','dialog');
    await devtools.evaluate("document.querySelector('[data-dialog-close]').click()");
    for(const width of [320,390,768,1280]){
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<500});
      await activityAlignment();
      await devtools.evaluate("window.scrollTo(0,0);(innerWidth<=620?document.querySelector('[data-mobile-menu=controls]'):document.querySelector('header [data-hub-control=menu]')).click()");
      const rect=await devtools.evaluate<{left:number;right:number;top:number;bottom:number}>("(()=>{const r=document.querySelector(innerWidth<=620?'#mobile-menu-controls':'#hub-controls-popover').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()");
      assert(rect.left>=0&&rect.right<=width+1&&rect.top>=0&&rect.bottom<=1000,"Controls popover fits "+width);
      assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],`popover ${lang} ${width}`);
      await devtools.evaluate("hideControls();document.querySelector('#mobile-menu-controls:popover-open [data-mobile-close]')?.click()");
    }
    await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
    await devtools.call("Emulation.setDeviceMetricsOverride",{width:390,height:1000,deviceScaleFactor:1,mobile:true});
    if(lang==="en"){await screenshot("hub-phone");await screenshot("hub-header-phone","header");await screenshot("hub-summary-phone",".overview-grid");}
    await devtools.evaluate("window.scrollTo(0,document.body.scrollHeight/2)");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-trigger]').getClientRects().length"),0,"no floating period bubble on mobile");
    assert.equal(await devtools.evaluate("document.querySelector('header').getBoundingClientRect().height<90"),true,"period does not add a mobile header row");
    await devtools.evaluate("document.querySelector('[data-mobile-menu=more]').click()");
    assert.equal(await devtools.evaluate("document.querySelectorAll('[data-mobile-slot=period] [data-period-days]').length"),2,"period choices live in Settings without duplicates");
    await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"30\"]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('#mobile-menu-more').matches(':popover-open')"),true,"changing period keeps Settings open");
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('[data-period-panel]:not([hidden])')].every(panel=>panel.dataset.periodDays==='30')"),true,"one Settings choice updates every history panel");
    await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"7\"]').click()");
    await devtools.evaluate("document.querySelector('[data-mobile-menu=more]').click()");
    await devtools.evaluate("document.querySelector('[data-period-panel=models]:not([hidden]) .model-breakdown > summary').click()");
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"expanded model detail fits the phone viewport");
    await devtools.evaluate("document.querySelector('[data-period-panel=models]:not([hidden]) .model-breakdown > summary').click()");
    await devtools.evaluate("document.querySelector('.activity-more > summary').click()");
    assert.equal(await devtools.evaluate("document.querySelector('.activity-more').open"),true);
    assert.equal(await devtools.evaluate("document.querySelectorAll('.activity-more-list > [data-work-id]:not([hidden])').length"),15);
    await devtools.evaluate("document.querySelector('[data-theme-toggle]').click()");
    await delay(250);
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[]);
    await devtools.evaluate("document.querySelector('.site-switcher > summary').click()");
    // Safe busy/failure coverage: no real executors, and the delayed write is rejected.
    for(const controlWidth of [320,1280]){
    await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:controlWidth<600,maxTouchPoints:1});
    await devtools.call("Emulation.setDeviceMetricsOverride",{width:controlWidth,height:1000,deviceScaleFactor:1,mobile:controlWidth<600});
    failRead=true;
    await devtools.evaluate("(innerWidth<=620?document.querySelector('[data-mobile-menu=controls]'):document.querySelector('header [data-hub-control=menu]')).click();document.querySelector('[data-hub-control=settings]').click()");
    await wait("document.querySelector('#hub-control-content').textContent.includes("+JSON.stringify(lang==="en"?"Values changed":"Данные изменились")+")");
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"failed control read remains readable");
    await screenshot(`hub-control-read-error-${lang}-${controlWidth}`,'dialog');
    await devtools.evaluate("document.querySelector('[data-dialog-close]').click()");
    failRead=false;failWrite=true;
    let releaseWrite!:()=>void;
    writeGate=new Promise<void>(done=>{releaseWrite=done;});
    const beforeFailure=actions.length;
    await devtools.evaluate("document.querySelector('[data-hub-control=codex-reset]').click()");
    await delay(80);
    const confirmPoint=await devtools.evaluate<{x:number;y:number}>("(()=>{const r=document.querySelector('[data-hub-confirm]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    // A trusted input grants browser user activation; programmatic .click() makes the native
    // close-watcher's Escape cancel event non-cancellable and is not a real user interaction.
    await devtools.call("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...confirmPoint});
    await devtools.call("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...confirmPoint});
    await wait("document.querySelector('[data-hub-confirm]').getAttribute('aria-busy')==='true'");
    await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await devtools.call("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    assert.equal(await devtools.evaluate("document.querySelector('dialog').open"),true,"pending action cannot be dismissed by Escape");
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"busy confirmation fits the phone");
    await screenshot(`hub-control-busy-${lang}-${controlWidth}`,'dialog');
    releaseWrite();writeGate=null;
    await wait("!document.querySelector('[data-hub-confirm]').hasAttribute('aria-busy') && document.querySelector('#hub-control-result').textContent.length>0");
    assert.equal(actions.length,beforeFailure,"failed mock reset performs no state change");
    assert.match(await devtools.evaluate<string>("document.querySelector('#hub-control-result').textContent"),lang==="en"?/Command rejected/:/Команда отклонена/);
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"failed write leaves the confirmation readable");
    await screenshot(`hub-control-write-error-${lang}-${controlWidth}`,'dialog');
    await devtools.evaluate("document.querySelector('[data-hub-cancel]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('dialog').open"),false);
    assert.equal(await devtools.evaluate("document.activeElement.dataset.hubControl"),"codex-reset","cancelling a failed action restores focus");
    failWrite=false;
    }
    await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
    await devtools.call("Emulation.setDeviceMetricsOverride",{width:390,height:1000,deviceScaleFactor:1,mobile:true});
    await devtools.call("Page.reload",{});await wait("document.readyState==='complete' && !!document.querySelector('.codex-grid')");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"7\"]').getAttribute('aria-pressed')"),"true","ordinary reload preserves the global period");
    await delay(250);
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"open site navigation has readable theme colours");
    await devtools.evaluate("document.querySelector('.site-switcher > summary').click()");
  }
}finally{await browser.close();await new Promise<void>(done=>server.close(()=>done()));}
console.log(`Hub browser verified EN/RU, 320–1280px, equal-height panels, disclosures and confirmed actions; screenshots: ${output}`);
