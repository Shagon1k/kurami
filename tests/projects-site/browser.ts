import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ProjectsActionError } from "../../src/projects-site/actions.ts";
import { createProjectsServer } from "../../src/projects-site/server.ts";
import { findBrowser, launchBrowser } from "../../src/ui-library/testing/devtools.ts";
import { AUDIT_EXPRESSION, inventoryExpression } from "../../src/ui-library/testing/audit.ts";
import { syntheticProjectsSnapshot } from "./fixture.ts";

let unavailable = false;
let dense=false;
let previewReady=false;
let statusRequest: {state:"awaiting_sync";target:string;from:string;key:string} | null = null; let statusSynced = false; let statusConflict = false; const statusKeys: string[] = [];
let accepted = false; let failReview = false; const requestKeys: string[] = [];
let failAction=false,actionAccepted=false,cancellation=false,discarded=false;const actionKeys:string[]=[];
const serverOptions = { snapshot: () => {
  if (unavailable) throw new Error("fixture failure");
  const snapshot = syntheticProjectsSnapshot();
  if(previewReady){const item=snapshot.items[0]!;item.links.preview='https://preview.example.test/';item.preview.expiresAt='2026-10-04T10:00:00Z';item.runActions!.actions=[{action:'preview_stop',label:'Remove preview',enabled:true,confirmation:null,hint:null,state:null}];}
  if (accepted) { snapshot.items[0]!.review.state = "queued"; snapshot.items[0]!.review.tone = "neutral"; snapshot.items[0]!.aiReview = { enabled: false, reason: "pending", head: "abcdef0123456789" }; }
  if (statusRequest) {
    if (statusSynced) snapshot.items[0]!.status = statusRequest.target;
    else snapshot.items[0]!.statusChange = { ...snapshot.items[0]!.statusChange!, enabled: false, reason: "pending", request: {...statusRequest,checkAvailable:false} };
  }
  if(actionAccepted) snapshot.items[0]!.runActions!.actions=snapshot.items[0]!.runActions!.actions.map(action=>action.action==="preview_start"?{...action,enabled:false,state:"pending"}:action);
  if(cancellation) snapshot.items[0]!.runActions!.actions=[{action:"take_control",label:"Продолжить в Codex",enabled:true,confirmation:null,hint:null,state:null},{action:"discard_local",label:"Удалить локальную работу",enabled:!discarded,confirmation:"Удалить сохранённую локальную работу? Это действие нельзя отменить.",hint:null,state:discarded?"pending":null}];
  if(dense)for(let index=0;index<80;index++)snapshot.items.push({...snapshot.items[3]!,id:`bulk-${index}`,number:100+index,title:`Additional task ${index}`});
  return snapshot;
}, cacheMs: 0, authorize: async () => "fixture-owner", origin: "", review: (value: unknown) => {
  const input = value as { head: string; key: string };
  assert.equal(input.head,"abcdef0123456789"); requestKeys.push(input.key);
  if (failReview) throw new ProjectsActionError(503,"Ревью временно недоступно.");
  accepted = true; return { state: "created" as const, requestId: "fixture", requestState: "pending" };
} };
const completeOptions = { ...serverOptions, runAction:(value:unknown)=>{
  const input=value as {action:string;key:string;confirmed:boolean};actionKeys.push(input.key);
  if(input.action==="discard_local") {assert.equal(input.confirmed,true);discarded=true;}
  else {assert.equal(input.action,"preview_start");assert.equal(input.confirmed,false);if(failAction) throw new ProjectsActionError(503,"Действие временно недоступно.");actionAccepted=true;}
  return {state:"created" as const,requestId:"fixture-action",requestState:"pending"};
},statusChange: async (value: unknown) => {
  const input = value as {from:string;target:string;key:string;itemId:string};
  assert.equal(input.from,"Human Review"); assert.equal(input.itemId,"item-12"); assert.equal(input.target,"Done");
  statusKeys.push(input.key);
  if (statusConflict) throw new ProjectsActionError(409,"Статус изменился. Обновите страницу.");
  statusRequest = {state:"awaiting_sync",target:input.target,from:input.from,key:input.key};
  return {state:"awaiting_sync" as const,requestId:"fixture-status",target:input.target};
} };
const server = createProjectsServer(completeOptions);
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
completeOptions.origin = base;
const browser = await launchBrowser(findBrowser());
const { devtools } = browser;
const out = resolve(import.meta.dirname, "../../dist/projects-browser");
mkdirSync(out, { recursive: true });
async function wait(expression: string, allowCached=false): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) { if (await devtools.evaluate<boolean>(`(${expression}) && !document.querySelector('#projects-dashboard')?.dataset.transitioning && (${allowCached} || !document.querySelector('[data-cached-view]')) && !document.querySelector('#project-details')?.getAnimations().some(animation=>animation.playState==='running')`)) return; await delay(50); }
  throw new Error("Timed out: " + expression);
}
async function open(path: string): Promise<void> {
  await devtools.call("Page.navigate", { url: base + path });
  await wait("document.readyState==='complete' && !!document.querySelector('#projects-dashboard')");
  await devtools.evaluate("document.fonts.ready");
}
async function mobileOverview(): Promise<void> {
  const layout=await devtools.evaluate<{sameRow:boolean;withinViewport:boolean;hiddenLabels:boolean;rowFillsFrame:boolean;contentInset:boolean;accessibleNames:boolean}>(`(() => {
    const active=document.querySelector('[data-task-filter=active]'), attention=document.querySelector('[data-task-filter=attention]'), sync=document.querySelector('[data-sync-trigger]');
    const a=active.getBoundingClientRect(), b=attention.getBoundingClientRect(), c=sync.getBoundingClientRect();
    const frame=document.querySelector('.projects-table-frame').getBoundingClientRect(), row=document.querySelector('.projects-row--attention').getBoundingClientRect(), text=document.querySelector('.projects-row--attention .projects-task').getBoundingClientRect();
    return {sameRow:Math.abs(a.top-b.top)<1&&Math.abs(a.top-c.top)<1,withinViewport:a.left>=0&&b.right<=c.left&&c.right<=innerWidth,hiddenLabels:[active,attention].every(button=>getComputedStyle(button.querySelector('.button__label--full')).display==='none'),rowFillsFrame:Math.abs(row.left-frame.left-1)<1&&Math.abs(row.right-frame.right+1)<1,contentInset:text.left-row.left>=16&&row.right-text.right>=16,accessibleNames:[active,attention,sync].every(button=>button.getAttribute('aria-label').length>3)};
  })()`);
  assert.ok(layout.sameRow&&layout.withinViewport,"mobile filters and Sync share a row without overflow");
  assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('[data-visible-count]').closest('p')).display"),"none","total task count does not take a separate mobile row");
  assert.ok(layout.hiddenLabels&&layout.accessibleNames,"compact filters retain full accessible names");
  assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.projects-sync-indicator')).display"),"block","mobile Sync keeps its freshness indicator");
  assert.equal(await devtools.evaluate("document.querySelector('.projects-sync-indicator').classList.contains('projects-sync-indicator--delayed')"),true);
  assert.match(await devtools.evaluate<string>("document.querySelector('[data-sync-trigger]').getAttribute('aria-label')"),/Delayed|С задержкой/);
  assert.ok(layout.rowFillsFrame&&layout.contentInset,"mobile row backgrounds fill the frame with inset content");
}
async function audit(): Promise<void> {
  assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION), []);
  assert.deepEqual(await devtools.evaluate(inventoryExpression()), []);
}
async function panelHistory():Promise<void>{
  await wait(`!document.querySelector('#projects-dashboard').dataset.refreshing`);
  await devtools.evaluate(`window.panelPops=0;window.panelListener=()=>panelPops++;addEventListener('popstate',panelListener);window.panelDashboard=document.querySelector('#projects-dashboard');window.panelUrl=location.href;document.querySelector('[data-mobile-menu="apps"]').click();window.panelLength=history.length;window.panelToken=history.state.__kuramiMobilePanel.token;document.querySelector('[data-mobile-menu="search"]').click()`);
  await wait(`document.querySelector('#mobile-menu-search').matches(':popover-open')`);
  assert.equal(await devtools.evaluate(`history.length===panelLength&&history.state.__kuramiMobilePanel.token===panelToken`),true,'switching panels reuses the one panel entry');
  await devtools.evaluate(`history.back()`);
  await wait(`!history.state?.__kuramiMobilePanel&&!document.querySelector('.mobile-navigation .ui-popover:popover-open')`);
  const panelBack=await devtools.evaluate<{same:boolean;url:string;base:string;refreshing:string;state:unknown}>(`({same:document.querySelector('#projects-dashboard')===panelDashboard,url:location.href,base:panelUrl,refreshing:document.querySelector('#projects-dashboard').dataset.refreshing,state:history.state,pops:panelPops})`);
  assert.ok(panelBack.same&&panelBack.url===panelBack.base&&!panelBack.refreshing,'panel Back must not refresh or change the Projects route: '+JSON.stringify(panelBack));
  await devtools.evaluate(`history.forward()`);await wait(`document.querySelector('#mobile-menu-search').matches(':popover-open')`);
  assert.equal(await devtools.evaluate(`document.querySelector('#projects-dashboard')===panelDashboard`),true,'panel Forward preserves the table');
  await devtools.evaluate(`(()=>{window.panelTable=document.querySelector('.projects-table');const input=document.querySelector('input[name=q]');input.value='search';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(30);
  await devtools.evaluate(`document.querySelector('[data-mobile-menu="more"]').click()`);await wait(`document.querySelector('#mobile-menu-more').matches(':popover-open')`);
  await devtools.evaluate(`history.back()`);await wait(`!history.state?.__kuramiMobilePanel`);
  assert.equal(await devtools.evaluate(`new URL(location.href).searchParams.get('q')==='search'&&document.querySelector('.projects-table')===panelTable`),true,'Back closes Search without undoing its query or refreshing the table');
  await devtools.evaluate(`document.querySelector('[data-mobile-menu="search"]').click()`);await wait(`document.querySelector('#mobile-menu-search').matches(':popover-open')`);
  await devtools.evaluate(`(()=>{const input=document.querySelector('input[name=q]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(30);
  assert.equal(await devtools.evaluate(`new URL(location.href).searchParams.has('q')`),false,'clearing Search updates its route');
  await devtools.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await wait(`!history.state?.__kuramiMobilePanel`);await delay(50);
  await devtools.evaluate(`document.querySelector('[data-mobile-menu="apps"]').click()`);await delay(240);
  const point=await devtools.evaluate<{x:number;y:number}>(`(()=>{const link=document.querySelector('[data-item-link]');link.scrollIntoView({behavior:'instant',block:'start'});const r=link.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await devtools.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await devtools.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  await wait(`!!document.querySelector('#project-details')&&!history.state?.__kuramiMobilePanel`);
  assert.equal(await devtools.evaluate(`history.state.projectsDetail`),true,'outside task click runs after consuming panel history');
  await devtools.evaluate(`history.back()`);await wait(`!document.querySelector('#project-details')`);
  const taskBack=await devtools.evaluate<{url:string;base:string;state:unknown}>(`({url:location.href,base:panelUrl,state:history.state})`);
  assert.equal(taskBack.url,taskBack.base,'next Back closes the task, not a stale panel: '+JSON.stringify(taskBack));
  await devtools.evaluate(`removeEventListener('popstate',panelListener)`);
}
try {
  await devtools.call("Page.enable");
  for (const width of [320, 390, 1280]) {
    await devtools.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:width<600});
    await open("/");
    for (const theme of ["light", "dark"]) {
      await devtools.evaluate(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('[data-theme-toggle]').click()`);
      await delay(250);
      await audit();
      if(width<600)await mobileOverview();
      if(width<600&&theme==='light')await panelHistory();
      assert.equal(await devtools.evaluate("document.querySelector('[data-task-filter=active]').textContent"),"3 active","counter matches the full active selection including review");
      assert.equal(await devtools.evaluate("document.querySelector('[data-task-filter=attention]').textContent"),"2 need you");
      await devtools.evaluate("document.querySelector('[data-task-filter=active]').click()");
      await wait("location.search.includes('active=1') && !document.querySelector('#projects-dashboard').dataset.refreshing");
      assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr').length"),3);
      assert.equal(await devtools.evaluate("document.querySelector('[data-task-filter=active]').getAttribute('aria-pressed')"),"true");
      await audit();
      await devtools.evaluate("document.querySelector('[data-task-filter=active]').click()");
      await wait("!location.search.includes('active=1') && !document.querySelector('#projects-dashboard').dataset.refreshing");
      assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr').length"),6);
      await devtools.evaluate("document.querySelector('[data-task-filter=attention]').click()");
      await wait("location.search.includes('attention=1') && !document.querySelector('#projects-dashboard').dataset.refreshing");
      assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr').length"),2);
      assert.equal(await devtools.evaluate("document.querySelector('[data-task-filter=attention]').getAttribute('aria-pressed')"),"true");
      await audit();
      if(theme==='light'){
        const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
        writeFileSync(resolve(out,`projects-attention-${width}.png`),Buffer.from(shot.data,"base64"));
      }
      await devtools.evaluate("document.querySelector('[data-task-filter=active]').click()");
      await wait("location.search.includes('active=1') && !location.search.includes('attention=1') && !document.querySelector('#projects-dashboard').dataset.refreshing");
      assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr').length"),3);
      assert.equal(await devtools.evaluate("document.querySelector('[data-task-filter=attention]').getAttribute('aria-pressed')"),"false");
      await devtools.evaluate("document.querySelector('[data-task-filter=active]').click()");
      await wait("!location.search.includes('active=1') && !document.querySelector('#projects-dashboard').dataset.refreshing");
      assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-checks .pill,.projects-stage .pill,.projects-sync-list .pill').length"),0,"parameter values do not use pills");
      assert.equal(await devtools.evaluate("document.querySelector('[data-language-link]').classList.contains('button--icon')"),true,"same square language control as Hub and Docs");
      if (width === 1280 && theme === "light") {
        const shot = await devtools.call<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        writeFileSync(resolve(out, "projects-overview.png"), Buffer.from(shot.data,"base64"));
      }
      await devtools.evaluate("document.querySelector('[data-item-link]').click()");
      await wait("!!document.querySelector('#project-details')");
      assert.equal(await devtools.evaluate("document.activeElement.id"), "project-details");
      if(width<600){
        assert.equal(await devtools.evaluate("document.querySelector('#project-details').getAttribute('aria-modal')"),"true");
        assert.equal(await devtools.evaluate("document.querySelector('[data-site-header]').inert"),true);
        assert.ok(Math.abs(await devtools.evaluate<number>("document.querySelector('#project-details').getBoundingClientRect().width")-width)<.1);
      }

      await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
      await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
      assert.equal(await devtools.evaluate("document.activeElement.id"), "project-details", "background refresh preserves panel focus");
      await audit();
      const density=await devtools.evaluate<{reviewHeight:number;reviewWidth:number;groupWidth:number;pillHeight:number;sortIcon:number;actionWidths:boolean}>(`(() => {
        const review=document.querySelector('[data-review-run]'), group=review.parentElement;
        return {reviewHeight:review.getBoundingClientRect().height,reviewWidth:review.getBoundingClientRect().width,groupWidth:group.getBoundingClientRect().width,pillHeight:document.querySelector('.projects-detail .pill').getBoundingClientRect().height,sortIcon:parseFloat(getComputedStyle(document.querySelector('[data-sort] .button__svg')).width),actionWidths:[...document.querySelectorAll('[data-run-action]')].every(button=>Math.abs(button.getBoundingClientRect().width-button.parentElement.getBoundingClientRect().width)<1)};
      })()`);
      assert.ok(density.reviewHeight>=32&&density.reviewHeight<=36,"compact actions retain coarse-pointer targets");
      assert.ok(density.reviewWidth<=density.groupWidth,"contextual review fits within its check row");
      assert.ok(density.pillHeight<=23,"compact status pills");
      assert.equal(density.sortIcon,14,"small sorting icon");
      assert.ok(density.actionWidths,"run actions fill their groups");
      assert.equal(await devtools.evaluate("document.querySelector('[data-status-form]').closest('details')"),null,"status editor is always visible");
      assert.equal(await devtools.evaluate("[...document.querySelectorAll('.projects-links a')].every(link=>link.classList.contains('button--subtle'))"),true,"resources have visible button surfaces");
      assert.equal(await devtools.evaluate("[...document.querySelectorAll('.projects-run-actions h3')].length"),0,"bottom actions have no redundant Work/Cleanup headings");
      assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-evidence .pill').length"),0,"evidence values do not use pills");
      if(width===1280)assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.projects-table thead th:last-child')).verticalAlign"),"middle");
      if (width === 1280 && theme === "light") {
        await devtools.evaluate("scrollTo(0,0)");
        const shot = await devtools.call<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        writeFileSync(resolve(out, "projects-desktop.png"), Buffer.from(shot.data, "base64"));
      }
      if (width === 390 && theme === "dark") {
        await devtools.evaluate("scrollTo(0,0)");
        const shot = await devtools.call<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(resolve(out, "projects-mobile.png"), Buffer.from(shot.data, "base64"));
      }
      await devtools.evaluate("document.querySelector('[data-item-close]').click()");
      await wait("!document.querySelector('#project-details') && !document.body.classList.contains('projects-mobile-detail-open')");
    }
  }
  previewReady=true;
  for(const width of [320,390,1280,1600]) {
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await open('/?item=item-12');
    const paired=await devtools.evaluate<boolean>("(()=>{const link=document.querySelector('.projects-evidence a[href=\"https://preview.example.test/\"]'),remove=document.querySelector('[data-run-action=preview_stop]'),a=link.getBoundingClientRect(),b=remove.getBoundingClientRect(),row=link.closest('.projects-action-grid').getBoundingClientRect();return Math.abs(a.top-b.top)<1&&Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1&&a.right<=b.left&&Math.abs(b.right-row.right)<1&&!!link.querySelector('svg')})()");
    assert.ok(paired,'Open preview and Remove preview are equal-width buttons on one row at '+width);
    if(width>=1280){const panelWidth=await devtools.evaluate<number>("document.querySelector('#project-details').getBoundingClientRect().width");assert.ok(panelWidth>=380&&panelWidth<=420,'large-screen detail has a modest responsive width');}
    await audit();
    const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(resolve(out,`projects-preview-pair-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  previewReady=false;
  for(const width of [320,390]) {
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:true});
    await open("/?lang=ru&attention=1");
    await mobileOverview();
    await audit();
    const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
    writeFileSync(resolve(out,`projects-attention-ru-${width}.png`),Buffer.from(shot.data,"base64"));
  }
  await devtools.call("Emulation.setDeviceMetricsOverride",{width:390,height:780,deviceScaleFactor:1,mobile:true});
  await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:true});
  await open("/");
  await devtools.evaluate("document.querySelector('[data-item-link]').click()");
  await wait("!!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  const detailSwipeY=await devtools.evaluate<number>("document.querySelector('#project-details h2').getBoundingClientRect().top+8");
  await devtools.evaluate("window.normalFetch=fetch;window.holdFragments=true;window.releaseFragment=null;window.fetch=(...args)=>normalFetch(...args).then(response=>holdFragments&&String(args[0]).includes('/api/fragment')?new Promise(resolve=>window.releaseFragment=()=>resolve(response)):response);document.dispatchEvent(new Event('visibilitychange'));window.dragPanel=document.querySelector('#project-details')");
  await wait("typeof releaseFragment==='function'");
  await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:90,y:detailSwipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:150,y:detailSwipeY}]});
  assert.ok(await devtools.evaluate<boolean>("document.querySelector('#project-details').getBoundingClientRect().x>40"),"detail tracks the finger before release");
  await devtools.evaluate("holdFragments=false;releaseFragment()");await delay(180);
  assert.equal(await devtools.evaluate("document.querySelector('#project-details')===dragPanel"),true,"in-flight poll cannot replace a dragged panel");
  await devtools.call("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await wait("!!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.ok(Math.abs(await devtools.evaluate<number>("document.querySelector('#project-details').getBoundingClientRect().x"))<1,"short swipe settles back to the original position");
  await devtools.evaluate("window.fetch=normalFetch");
  await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:90,y:detailSwipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:280,y:detailSwipeY}]});
  assert.ok(await devtools.evaluate<boolean>("document.querySelector('#project-details').getBoundingClientRect().x>150"),"close follows the finger continuously");
  await devtools.evaluate("window.exitFrames=[];window.exitPanel=document.querySelector('#project-details');window.originalBack=history.back.bind(history);history.back=()=>setTimeout(originalBack,100);requestAnimationFrame(function sample(){if(!exitPanel.isConnected)return;if(exitPanel.dataset.exited)exitFrames.push(exitPanel.getBoundingClientRect().x);requestAnimationFrame(sample)})");
  await devtools.call("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await wait("!document.querySelector('#project-details') && !document.body.classList.contains('projects-mobile-detail-open')");
  assert.equal(await devtools.evaluate("exitFrames.length>0&&exitFrames.every(x=>x>=innerWidth-1)"),true,"exited detail never flashes back onscreen before replacement");
  await devtools.evaluate("history.back=originalBack");
  const swipeY=await devtools.evaluate<number>("document.querySelector('.projects-task-meta').getBoundingClientRect().top+8");
  await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:290,y:swipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:90,y:swipeY}]});
  await devtools.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const opening=await devtools.evaluate<{found:boolean;inert:boolean;x:number;transform:string}>("(()=>{const panel=document.querySelector('.projects-detail[data-dragging]');return {found:!!panel,inert:panel?.inert??false,x:panel?.getBoundingClientRect().x??-1,transform:panel?.style.transform??''}})()");
  assert.ok(opening.found&&opening.inert&&opening.x>0&&opening.x<250,"opening reveals an inert adjacent panel before release: "+JSON.stringify(opening));
  await devtools.call("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await wait("!!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  const savedScroll=await devtools.evaluate<number>("(()=>{const panel=document.querySelector('#project-details');panel.scrollTop=180;return panel.scrollTop})()");
  assert.ok(savedScroll>0,"fixture detail can scroll");
  await devtools.evaluate("history.back()");
  await wait("!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  await devtools.evaluate("window.entryScrolls=[];window.watchEntry=true;requestAnimationFrame(function sample(){if(!watchEntry)return;const panel=document.querySelector('#project-details');if(panel)entryScrolls.push(panel.scrollTop);requestAnimationFrame(sample)})");
  await devtools.evaluate("history.forward()");
  await wait("!!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  await devtools.evaluate("watchEntry=false");
  assert.equal(await devtools.evaluate(`entryScrolls.length>0&&entryScrolls.every(top=>Math.abs(top-${savedScroll})<1)`),true,"restored scroll is applied before every visible entry frame");
  await devtools.evaluate("document.querySelector('#project-details').scrollTop=0");
  await devtools.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:90,y:detailSwipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:140,y:detailSwipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});
  assert.ok(Math.abs(await devtools.evaluate<number>("document.querySelector('#project-details').getBoundingClientRect().x"))<1,"pointer cancellation removes the partial translation");
  await devtools.call("Emulation.setEmulatedMedia",{features:[]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:90,y:detailSwipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:95,y:detailSwipeY+70}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  assert.equal(await devtools.evaluate("!!document.querySelector('#project-details')&&!document.querySelector('[data-dragging]')"),true,"vertical scrolling is not a navigation drag");
  await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{id:0,x:90,y:detailSwipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{id:0,x:140,y:detailSwipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{id:0,x:140,y:detailSwipeY},{id:1,x:190,y:detailSwipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  assert.equal(await devtools.evaluate("!!document.querySelector('#project-details')&&!document.querySelector('[data-dragging]')"),true,"a second touch cancels navigation");
  await devtools.evaluate("document.querySelector('[data-item-close]').click()");
  await wait("!document.querySelector('#project-details')&&!document.querySelector('#projects-dashboard').dataset.refreshing");
  await devtools.evaluate("window.fetch=(...args)=>String(args[0]).includes('/api/fragment')?Promise.reject(new Error('offline')):normalFetch(...args);document.querySelector('[data-item-link]').click()");
  await wait("document.querySelector('[data-cached-view]')?.textContent.includes('refresh failed')&&!document.querySelector('#projects-dashboard').dataset.refreshing",true);
  assert.equal(await devtools.evaluate("[...document.querySelectorAll('#project-details [data-run-action],#project-details [data-review-run],#project-details [data-status-submit],#project-details select')].every(control=>control.disabled)"),true,"offline cached details never authorize writes");
  await devtools.evaluate("window.fetch=normalFetch;document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!!document.querySelector('#project-details')&&!document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelector('[data-review-run]').disabled"),false,"a fresh response restores server-authorized controls");
  failReview=true;
  await devtools.evaluate("document.querySelector('[data-review-run]').click()");
  await wait("document.querySelector('[data-toast-message]').textContent.includes('unavailable')");
  assert.equal(await devtools.evaluate("!!document.querySelector('[data-toast-message]').closest('#project-details')"),true,"mobile action failures are visible inside the dialog");
  assert.equal(await devtools.evaluate("!!document.querySelector('[data-toast-message]').closest('[inert]')"),false);
  assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('[data-toast-region]')).position"),"fixed");
  assert.equal(await devtools.evaluate("(()=>{const r=document.querySelector('[data-toast-region]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.bottom>=innerHeight-24;})()"),true,"mobile toast sits within the bottom-right safe area");
  await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.match(await devtools.evaluate<string>("document.querySelector('[data-toast-message]').textContent"),/unavailable/,"refresh retains action feedback");
  await devtools.evaluate("document.querySelector('[data-toast-dismiss]').focus();document.activeElement.click()");
  assert.equal(await devtools.evaluate("document.querySelector('[data-toast-region]').hidden"),true);
  assert.equal(await devtools.evaluate("document.activeElement.id"),"project-details","dismiss restores focus inside the mobile dialog");
  failReview=false;requestKeys.length=0;
  await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape"});
  await wait("!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:false});
  await devtools.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  dense=true;
  await open("/");
  const bounds=await devtools.evaluate<{height:number;scrollHeight:number;bottom:number}>("(()=>{const table=document.querySelector('.projects-table');return {height:table.clientHeight,scrollHeight:table.scrollHeight,bottom:table.getBoundingClientRect().bottom}})()");
  assert.ok(bounds.scrollHeight>bounds.height&&bounds.bottom<=1000-16,"large desktop table stays within the viewport");
  await devtools.evaluate("document.querySelector('.projects-table').scrollTop=400;document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelector('.projects-table').scrollTop"),400,"background updates preserve table position");
  dense=false;
  await open("/?lang=ru");
  assert.equal(await devtools.evaluate("document.documentElement.lang"),"ru");
  assert.match(await devtools.evaluate<string>("document.querySelector('.projects-search').textContent"),/Поиск задач/);
  await open("/");
  assert.equal(await devtools.evaluate("document.documentElement.lang"),"en");
  await devtools.evaluate("const toggle=document.querySelector('[data-task-filter=active]');toggle.focus();toggle.click()");
  await wait("location.search.includes('active=1') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.activeElement.getAttribute('data-task-filter')==='active'"),true,"toggle retains keyboard focus after replacement");
  await devtools.evaluate("const search=document.querySelector('input[name=q]');search.value='SEARCH';search.dispatchEvent(new Event('input'));document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelector('[data-visible-count]').textContent"),"1","active filter combines with search after background refresh");
  assert.equal(await devtools.evaluate("new URL(document.querySelector('[data-language-link]').href).searchParams.get('active')"),"1");
  await devtools.evaluate("document.querySelector('[data-project-tabs] a[href*=beta]').click()");
  await wait("location.search.includes('project=beta') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr').length"),1,"project changes keep the active filter");
  assert.equal(await devtools.evaluate("document.querySelector('[data-visible-count]').textContent"),"0","no search match in active project shows zero");
  await open("/?attention=1&project=beta&lang=ru");
  assert.equal(await devtools.evaluate("document.querySelector('[data-task-filter=attention]').textContent"),"1 ждут вас");
  assert.equal(await devtools.evaluate("document.querySelector('[data-task-filter=active]').textContent"),"1 в работе","scoped active and attention counts use their actual selections");
  assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr').length"),1);
  await open("/?active=1&lang=ru");
  assert.equal(await devtools.evaluate("document.querySelector('[data-task-filter=active]').textContent"),"3 в работе");
  assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr').length"),3,"direct links retain the active view");
  await open("/");
  await devtools.evaluate("document.querySelector('[data-sync-trigger]').click()");
  await wait("document.querySelector('#projects-sync-popover').matches(':popover-open')");
  const syncBounds=await devtools.evaluate<{x:number;right:number}>("(()=>{const r=document.querySelector('#projects-sync-popover').getBoundingClientRect();return {x:r.x,right:r.right}})()");
  assert.ok(syncBounds.x>=0&&syncBounds.right<=1280);
  await audit();
  await devtools.evaluate("document.querySelector('#projects-sync-popover').hidePopover()");
  await devtools.evaluate("document.querySelector('[data-sort=status]').click()");
  await wait("location.search.includes('sort=status') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelector('th[aria-sort=ascending]').textContent"),"Status");
  await devtools.evaluate("document.querySelector('[data-sort=status]').click()");
  await wait("location.search.includes('dir=desc') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelector('th[aria-sort=descending]').textContent"),"Status");
  await devtools.evaluate("document.querySelector('[data-project-tabs] a[href*=beta]').click()");
  await wait("location.search.includes('project=beta') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelector('.projects-table tbody').children.length"),2);
  await open("/");
  await devtools.evaluate("const search=document.querySelector('input[name=q]');search.value='SEARCH';search.dispatchEvent(new Event('input'))");
  assert.equal(await devtools.evaluate("document.querySelector('[data-visible-count]').textContent"), "1");
  await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelector('[data-visible-count]').textContent"), "1", "refresh preserves search");
  await open("/?project=beta");
  assert.equal(await devtools.evaluate("document.querySelector('.projects-table tbody').children.length"), 2);
  await open("/?project=unknown");
  assert.match(await devtools.evaluate<string>("document.querySelector('#projects-dashboard').textContent"), /No matching tasks/);
  await open("/");
  await devtools.evaluate("document.querySelector('[data-item-link]').click()");
  await wait("!!document.querySelector('[data-review-run]')");
  failReview = true;
  await devtools.evaluate("document.querySelector('[data-review-run]').click()");
  await wait("document.querySelector('[data-toast-message]').textContent.includes('unavailable')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-review-run]').disabled"),false);
  failReview = false;
  await devtools.evaluate("document.querySelector('[data-review-run]').click()");
  await wait("document.querySelector('[data-toast-message]').textContent.includes('AI Review queued')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-toast-region]').dataset.tone"),"success");
  assert.equal(await devtools.evaluate("(()=>{const r=document.querySelector('[data-toast-region]').getBoundingClientRect();return r.right>=innerWidth-24&&r.bottom>=innerHeight-24;})()"),true,"desktop toast is bottom-right");
  assert.equal(requestKeys.length,2); assert.equal(requestKeys[0],requestKeys[1],"retry retains its durable request identity");
  assert.equal(await devtools.evaluate("document.querySelector('[data-review-run]').disabled"),true);
  assert.match(await devtools.evaluate<string>("document.querySelector('#project-details').textContent"),/Queued/);
  await audit();
  await devtools.evaluate("const field=document.querySelector('[data-status-form] select');field.value='Done';field.dispatchEvent(new Event('change',{bubbles:true}));field.focus()");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-submit]').disabled"),false);
  assert.match(await devtools.evaluate<string>("document.querySelector('[data-status-note]').textContent"),/completion requirements/);
  await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').value"),"Done","background refresh preserves unsent status choice");
  assert.equal(await devtools.evaluate("document.activeElement.name"),"target");
  statusConflict = true;
  await devtools.evaluate("document.querySelector('[data-status-submit]').click()");
  await wait("document.querySelector('[data-toast-message]').textContent.includes('Status changed')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').value"),"Done");
  statusConflict = false;
  await devtools.evaluate("document.querySelector('[data-status-submit]').click()");
  await wait("document.querySelector('[data-toast-message]').textContent.includes('Waiting for Kurami sync')");
  assert.equal(statusKeys.length,2);
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').disabled"),true);
  assert.match(await devtools.evaluate<string>("document.querySelector('.projects-table tbody tr').textContent"),/Human Review/);
  await audit();
  statusSynced = true;
  await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').value"),"Done");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').disabled"),false);
  assert.match(await devtools.evaluate<string>("document.querySelector('.projects-table tbody tr').textContent"),/Done/);
  failAction=true;
  await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').click()");
  await wait("document.querySelector('[data-toast-message]').textContent.includes('action is temporarily unavailable')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').disabled"),false);
  failAction=false;
  await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').click()");
  await wait("document.querySelector('[data-toast-message]').textContent.includes('queued in Kurami')");
  assert.equal(actionKeys.length,2);
  assert.equal(await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').disabled"),true);
  assert.match(await devtools.evaluate<string>("document.querySelector('[data-run-action=preview_start]').closest('.projects-evidence-row').textContent"),/Queued/);
  cancellation=true;
  await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!!document.querySelector('[data-run-action=discard_local]')");
  await devtools.evaluate("document.querySelector('[data-run-action=discard_local]').click()");
  assert.equal(actionKeys.length,2,"opening destructive confirmation never writes");
  assert.equal(await devtools.evaluate("(()=>{const panel=document.querySelector('[data-run-confirm-panel]'),grid=panel.closest('.projects-action-grid'),buttons=panel.querySelector('.projects-confirm-buttons'),last=buttons.lastElementChild;return Math.abs(panel.getBoundingClientRect().width-grid.getBoundingClientRect().width)<1&&Math.abs(last.getBoundingClientRect().right-buttons.getBoundingClientRect().right)<1&&!panel.closest('.projects-run-action')})()"),true,"deletion confirmation spans the action grid and aligns controls right");
  assert.equal(await devtools.evaluate("document.activeElement.hasAttribute('data-run-confirm')"),true);
  await devtools.evaluate("document.querySelector('[data-run-confirm-panel] p').click();document.dispatchEvent(new Event('visibilitychange'))");
  assert.equal(actionKeys.length,2,"explanatory text is not a confirmation control");
  assert.equal(await devtools.evaluate("document.querySelector('[data-run-confirm-panel]').hidden"),false,"confirmation pauses background replacement");
  await devtools.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.equal(await devtools.evaluate("document.querySelector('[data-run-confirm-panel]').hidden"),true);
  assert.equal(actionKeys.length,2);
  await devtools.evaluate("document.querySelector('[data-run-action=discard_local]').click();document.querySelector('[data-run-confirm]').click()");
  await wait("document.querySelector('[data-toast-message]').textContent.includes('queued in Kurami')");
  assert.equal(actionKeys.length,3);
  await audit();
  unavailable = true;
  await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await wait("document.querySelector('[data-toast-message]').textContent.includes('Refresh failed')");
  assert.equal(await devtools.evaluate("document.querySelector('.projects-table tbody').children.length"), 6, "failed refresh preserves the last snapshot");
  await audit();
  // Exercise the shared controller independently of Projects action/refresh state.
  unavailable=false;await open('/');
  await devtools.evaluate("window.testRegion=document.querySelector('[data-toast-region]').cloneNode(true);document.body.append(testRegion);window.testToast=createKuramiToast(testRegion,()=>document.querySelector('input[name=q]'));testToast.show('<img src=x onerror=alert(1)>',{tone:'warning'});");
  assert.equal(await devtools.evaluate("testRegion.querySelector('[data-toast-message]').textContent"),'<img src=x onerror=alert(1)>',"message is text, never HTML");
  assert.equal(await devtools.evaluate("testRegion.querySelector('img')"),null);
  await delay(250);
  assert.equal(await devtools.evaluate("testRegion.hidden"),false,"warnings persist without a timer");
  await devtools.evaluate("testToast.show('Timed',{tone:'success',duration:200});testRegion.querySelector('button').focus()");
  await delay(300);
  assert.equal(await devtools.evaluate("testRegion.hidden"),false,"focus pauses expiry");
  await devtools.evaluate("document.querySelector('input[name=q]').focus()");
  await wait("testRegion.hidden");
  await devtools.evaluate("testToast.show('Old',{duration:200})");await delay(100);
  await devtools.evaluate("testToast.show('New',{duration:500})");await delay(250);
  assert.equal(await devtools.evaluate("testRegion.hidden"),false,"old timer cannot dismiss a newer notice");
  await wait("testRegion.hidden");
  await devtools.evaluate("testToast.show('Hover',{duration:200});testRegion.dispatchEvent(new PointerEvent('pointerenter'))");await delay(300);
  assert.equal(await devtools.evaluate("testRegion.hidden"),false,"hover pauses expiry");
  await devtools.evaluate("testRegion.dispatchEvent(new PointerEvent('pointerleave'))");await wait("testRegion.hidden");
  await devtools.evaluate("testToast.show('Dismiss me',{duration:0});testRegion.querySelector('button').focus();document.activeElement.click()");
  assert.equal(await devtools.evaluate("document.activeElement.name"),'q',"dismiss returns focus without leaving it on a hidden button");
  await devtools.evaluate("testRegion.remove()");
} finally {
  await browser.close();
  await new Promise<void>(done => server.close(() => done()));
}
console.log("Projects browser: owner overview, task panel, focus, filters, search, failed refresh and mobile/dark accessibility verified");
