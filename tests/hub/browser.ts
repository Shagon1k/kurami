import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {createHubServer} from "../../src/hub/server.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";
import {findBrowser,launchBrowser} from "../../src/ui-library/testing/devtools.ts";
import {AUDIT_EXPRESSION,inventoryExpression} from "../../src/ui-library/testing/audit.ts";

const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,"127.0.0.1",done));
const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()));
const base=`http://127.0.0.1:${port}`;const actions:string[]=[];let codexModel="gpt-6-sol";
const settings={version:1,max_llm_running_global:2,ai_triage_daily:5,max_active_global:4,max_previews_global:3,max_preview_builds_global:1,preview_ttl_hours:24,project_wip:{pickflick:2}};
const server=createHubServer({snapshot:syntheticHubSnapshot,authorize:async()=>"synthetic-owner",controlOrigin:base,
  controls:{execute:async(action,payload={})=>{
    if(action==="models")return {models:[{value:"gpt-6-sol",label:"Sol"},{value:"gpt-6-astra",label:"Astra"}],hermes:"gpt-6-sol",hermesProvider:"openai-codex",codex:codexModel,codexEffort:"high"};
    if(action==="settings")return {settings:{revision:1,settings,idle:{idle:true}},health:{revision:1,intervalMinutes:20,allowedIntervals:[5,10,12,15,20,30,60]}};
    if(action==="composio-check")return {contours:[{contour:"read",ok:true,tools:10,diff:[],warnings:[]}]};
    actions.push(action);if(action==="model-apply")codexModel=String(payload.model);
    return {ok:true,action:"applied",outcome:action==="codex-reset"?"reset":undefined};
  }}});
await new Promise<void>(done=>server.listen(port,"127.0.0.1",done));
const browser=await launchBrowser(findBrowser());const {devtools}=browser;
const output=resolve(import.meta.dirname,"../../dist/hub-browser");mkdirSync(output,{recursive:true});
async function wait(expression:string){for(let attempt=0;attempt<100;attempt++){if(await devtools.evaluate<boolean>(expression))return;await delay(100);}throw new Error("Browser condition timed out: "+expression);}
async function screenshot(name:string,selector?:string){
  if(!selector){await devtools.evaluate("window.scrollTo(0,0)");await delay(80);}
  const clip=selector?await devtools.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()`):undefined;
  const result=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,...(clip?{clip}:{})});writeFileSync(resolve(output,name+".png"),Buffer.from(result.data,"base64"));
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
    assert.equal(await devtools.evaluate("document.querySelectorAll('.activity-list > [data-work-id]:not([hidden])').length"),5,"five work items are always visible");
    assert.equal(await devtools.evaluate("document.querySelectorAll('.problem').length"),1,"CI and review are one problem object");
    assert.equal(await devtools.evaluate("document.querySelector('.problem__reasons').children.length"),2);
    assert.equal(await devtools.evaluate("document.querySelector('.limit-history__legend').textContent"),"7d","Pro-style weekly-only account has no phantom 5h series");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=limits]:not([hidden]) table thead tr').children.length"),2);
    assert.equal(await devtools.evaluate("document.querySelector('.work-item__meta').textContent.includes('Running')"),lang==="en","ending a Codex turn does not complete the task");
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('#hub-dashboard [data-hub-control]')].every(el=>getComputedStyle(el).borderTopStyle==='solid' && getComputedStyle(el).borderTopColor!=='rgba(0, 0, 0, 0)' && el.getBoundingClientRect().height>=(el.classList.contains('button--compact')&&!matchMedia('(pointer: coarse)').matches?32:44))"),true,"dashboard controls have visible borders and appropriate touch targets");
    assert.equal(await devtools.evaluate("document.querySelector('[data-hub-control=codex-reset]').classList.contains('button--subtle') && document.querySelector('[data-hub-control=codex-reset]').getBoundingClientRect().height===32"),true,"Reset uses a compact, understated button on desktop");
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
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=commits]:not([hidden]) .project-table td:nth-child(4)').textContent"),"14");
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
    await devtools.evaluate("document.querySelector('.usage > summary').click();document.querySelector('[data-period-key=global][data-period-days=\"7\"]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=usage]:not([hidden]) .metric__value').textContent"),"6");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-panel=usage]:not([hidden]) .usage-coverage').textContent"),lang==="en"?"Logs 5/6":"Логи 5/6");
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"expanded Usage and selected period are accessible");
    if(lang==="en")await screenshot("hub-usage",".usage");
    const menuActions=actions.length;
    await devtools.evaluate("document.querySelector('header [data-hub-control=menu]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('#hub-controls-popover').matches(':popover-open')"),true);
    assert.equal(await devtools.evaluate("document.querySelector('dialog').open"),false,"Controls first opens a popover, not a modal");
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('#hub-controls-popover button')].every(button=>button.textContent.trim().length>0)"),true,"popover actions have visible labels beside icons");
    assert.equal(await devtools.evaluate("document.querySelector('header [data-hub-control=menu]').getAttribute('aria-expanded')"),"true");
    if(lang==="en")await screenshot("hub-controls","#hub-controls-popover");
    assert.equal(actions.length,menuActions,"opening the Controls menu does not mutate state");
    await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
    await devtools.call("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
    await wait("!document.querySelector('#hub-controls-popover').matches(':popover-open')");
    assert.equal(await devtools.evaluate("document.activeElement.dataset.hubControl"),"menu","Escape restores focus to the header");
    await devtools.evaluate("document.querySelector('header [data-hub-control=menu]').click();document.querySelector('[data-hub-control=models]').click()");await wait("!!document.querySelector('form[data-target=codex]')");
    assert.equal(await devtools.evaluate("document.querySelector('dialog').open"),true);
    assert.equal(await devtools.evaluate("document.querySelector('#hub-controls-popover').matches(':popover-open')"),false);
    await devtools.evaluate("document.querySelector('dialog [data-hub-control=menu]').click()");
    await wait("document.querySelector('#hub-controls-popover').matches(':popover-open') && !document.querySelector('dialog').open");
    await delay(80);
    assert.equal(await devtools.evaluate("document.activeElement.dataset.hubControl"),"models","Back keeps focus inside the reopened popover");
    await devtools.evaluate("document.querySelector('[data-hub-control=models]').click()");await wait("!!document.querySelector('form[data-target=codex]')");
    await devtools.evaluate("document.querySelector('form[data-target=codex] select').value='gpt-6-astra';document.querySelector('form[data-target=codex]').requestSubmit()");
    const before=actions.length;assert.equal(await devtools.evaluate("document.querySelector('#hub-control-confirm').hidden"),false);
    await delay(100);assert.equal(actions.length,before,"opening confirmation never applies a model");
    if(lang==="en"){
      await devtools.evaluate("document.querySelector('[data-hub-confirm]').click()");await wait("document.querySelector('#hub-control-result').textContent==='Applied'");
      await wait("!document.querySelector('[data-hub-confirm]').hasAttribute('aria-busy')");
      assert.equal(actions.at(-1),"model-apply");
      assert.equal(await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"7\"]').getAttribute('aria-pressed')"),"true","refresh preserves period selection");
      assert.equal(await devtools.evaluate("document.querySelector('.usage').open"),true,"refresh preserves open Usage");
      assert.equal(await devtools.evaluate("document.querySelector('.activity-list > [data-work-id]:not([hidden]) .work-events').open"),true,"refresh preserves the selected work item's events");
      assert.equal(await devtools.evaluate("[...document.querySelectorAll('.work-events[open]')].length"),1,"identical disclosure labels do not open unrelated work items");
      assert.equal(await devtools.evaluate("document.querySelector('[name=commit-repository][value=pickflick]').checked"),true,"refresh preserves repository selection");
    }else await devtools.evaluate("document.querySelector('[data-hub-cancel]').click()");
    await devtools.evaluate("document.querySelector('[data-dialog-close]').click()");
    await devtools.evaluate("document.querySelector('[data-hub-control=codex-reset]').click()");
    assert.equal(actions.length,before+(lang==="en"?1:0),"reset waits for confirmation");
    await devtools.evaluate("document.querySelector('[data-hub-cancel]').click()");
    await devtools.evaluate("document.querySelector('header [data-hub-control=menu]').click();document.querySelector('[data-hub-control=settings]').click()");await wait("!!document.querySelector('[data-hub-submit=settings-apply]')");
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('dialog button')].every(el=>!el.classList.contains('button--quiet'))"),true,"dialog actions look like buttons");
    for(const width of [320,390,1280]){
      await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:width<500,maxTouchPoints:1});
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<500});
      assert.equal(await devtools.evaluate("document.querySelector('[data-hub-control=codex-reset]').getBoundingClientRect().height"),width<500?44:32,"compact Reset keeps a full touch target on phones");
      assert.equal(await devtools.evaluate("[...document.querySelectorAll('[data-period-key]')].filter(el=>el.getBoundingClientRect().width).every(el=>el.getBoundingClientRect().height >= (matchMedia('(pointer: coarse)').matches?44:32))"),true,"period selectors retain touch targets");
      assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],`dialog audit ${lang} ${width}`);
      assert.deepEqual(await devtools.evaluate(inventoryExpression()),[]);
      const bounds=await devtools.evaluate<{width:number;scroll:number;client:number}>("({width:document.querySelector('dialog').getBoundingClientRect().width,scroll:document.querySelector('dialog').scrollWidth,client:document.querySelector('dialog').clientWidth})");
      assert(bounds.width<=width&&bounds.scroll<=bounds.client+1,"settings dialog fits the viewport");
    }
    if(lang==="en")await screenshot("hub-settings");
    await devtools.evaluate("document.querySelector('[data-dialog-close]').click()");
    for(const width of [320,390,768,1280]){
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<500});
      await devtools.evaluate("window.scrollTo(0,0);document.querySelector('header [data-hub-control=menu]').click()");
      const rect=await devtools.evaluate<{left:number;right:number;top:number;bottom:number}>("(()=>{const r=document.querySelector('#hub-controls-popover').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()");
      assert(rect.left>=0&&rect.right<=width+1&&rect.top>=0&&rect.bottom<=1000,"Controls popover fits "+width);
      assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],`popover ${lang} ${width}`);
      await devtools.evaluate("hideControls()");
    }
    await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
    await devtools.call("Emulation.setDeviceMetricsOverride",{width:390,height:1000,deviceScaleFactor:1,mobile:true});
    if(lang==="en"){await screenshot("hub-phone");await screenshot("hub-header-phone","header");await screenshot("hub-summary-phone",".overview-grid");}
    await devtools.evaluate("window.scrollTo(0,document.body.scrollHeight/2)");
    const periodBounds=await devtools.evaluate<{top:number;bottom:number}>("(()=>{const r=document.querySelector('.period-switch').getBoundingClientRect();return {top:r.top,bottom:r.bottom}})()");
    assert(periodBounds.top>=0&&periodBounds.bottom<200,"global period remains available while scrolling");
    await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"30\"]').click()");
    assert.equal(await devtools.evaluate("[...document.querySelectorAll('[data-period-panel]:not([hidden])')].every(panel=>panel.dataset.periodDays==='30')"),true,"global period updates every panel from the sticky header");
    await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"7\"]').click()");
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
    await devtools.call("Page.reload",{});await wait("document.readyState==='complete' && !!document.querySelector('.codex-grid')");
    assert.equal(await devtools.evaluate("document.querySelector('[data-period-key=global][data-period-days=\"7\"]').getAttribute('aria-pressed')"),"true","ordinary reload preserves the global period");
    await delay(250);
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],"open site navigation has readable theme colours");
    await devtools.evaluate("document.querySelector('.site-switcher > summary').click()");
  }
}finally{await browser.close();await new Promise<void>(done=>server.close(()=>done()));}
console.log(`Hub browser verified EN/RU, 320–1280px, equal-height panels, disclosures and confirmed actions; screenshots: ${output}`);
