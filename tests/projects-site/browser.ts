import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ProjectsActionError } from "../../src/projects-site/actions.ts";
import { createProjectsServer } from "../../src/projects-site/server.ts";
import { findBrowser, launchBrowser } from "../../src/ui-library/testing/devtools.ts";
import { AUDIT_EXPRESSION, inventoryExpression } from "../../src/ui-library/testing/audit.ts";
import { syntheticProjectsSnapshot } from "./fixture.ts";
import {RUN_ACTIONS} from "../../src/projects-site/run-actions.ts";

let unavailable = false;
let dense=false;
let previewReady=false;
let semanticNotes=false;
let reviewFixScenario:string|null=null;
let runNotesScenario:string|null=null;
let previewStopOnly=false;
let previewReviewScenario=false,previewReviewed=false,previewNewHead=false;
let startScenario:"off"|"idle"|"checking"|"sync"|"admission"|"starting"|"running"|"blocked"="off",startKey="",startWrites=0;
let startWriteGate:Promise<void>|null=null;
let ciScenario:"normal"|"failed"|"mixed"|"new-head"="normal";
let prScenario:"off"|"ready"|"merge"|"all-methods"|"blocked"|"pending"|"syncing"|"unavailable"="off";
let prWrites:{action:string;method:string|null;confirmed:boolean;key:string}[]=[];
let prReadGate:Promise<void>|null=null;
let statusRequest: {state:"awaiting_sync";target:string;from:string;key:string} | null = null; let statusSynced = false; let statusConflict = false; const statusKeys: string[] = [];
let accepted = false; let failReview = false; const requestKeys: string[] = [];
let failAction=false,actionAccepted=false,cancellation=false,discarded=false;const actionKeys:string[]=[];
const serverOptions = { snapshot: () => {
  if (unavailable) throw new Error("fixture failure");
  const snapshot = syntheticProjectsSnapshot();
  if(semanticNotes){const item=snapshot.items[0]!;item.review={...item.review,state:'ready',critical:1,important:2,suggestions:3};item.preview.state='running';item.preview.expiresAt=new Date(Date.now()+1800000).toISOString();}
  if(prScenario!=="off")snapshot.items[0]!.prControlsEnabled=true;
  if(ciScenario!=="normal"){
    const ci=snapshot.items[0]!.ci;
    if(ciScenario==="new-head")ci.head="fedcba9876543210";
    else {
      ci.state=ciScenario==="failed"?"failed":"unknown";
      ci.tone=ciScenario==="failed"?"failure":"neutral";
      const mixedStates=["passed","pending","unknown","missing","passed","passed"] as const;
      ci.checks=ci.checks!.map((check,index)=>({...check,state:ciScenario==="failed"?(index===1||index===5?"failed":"passed"):mixedStates[index]!,detailsUrl:ciScenario==="mixed"&&index===3?null:check.detailsUrl}));
    }
  }
  if(previewReady){const item=snapshot.items[0]!;item.links.preview='https://preview.example.test/';item.preview.expiresAt='2026-10-04T10:00:00Z';item.runActions!.actions=[{action:'preview_stop',label:'Remove preview',enabled:true,confirmation:null,hint:null,state:null}];}
  if (accepted) { snapshot.items[0]!.review.state = "queued"; snapshot.items[0]!.review.tone = "neutral"; snapshot.items[0]!.aiReview = { enabled: false, reason: "pending", head: "abcdef0123456789" }; }
  if (statusRequest) {
    if (statusSynced) snapshot.items[0]!.status = statusRequest.target;
    else snapshot.items[0]!.statusChange = { ...snapshot.items[0]!.statusChange!, enabled: false, reason: "pending", request: {...statusRequest,checkAvailable:false} };
  }
  if(actionAccepted) snapshot.items[0]!.runActions!.actions=snapshot.items[0]!.runActions!.actions.map(action=>action.action==="preview_start"?{...action,enabled:false,state:"pending"}:action);
  if(cancellation) snapshot.items[0]!.runActions!.actions=[{action:"take_control",label:"Продолжить в Codex",enabled:true,confirmation:null,hint:null,state:null},{action:"discard_local",label:"Удалить локальную работу",enabled:!discarded,confirmation:"Удалить сохранённую локальную работу? Это действие нельзя отменить.",hint:null,state:discarded?"pending":null}];
  if(reviewFixScenario){
    const item=snapshot.items[0]!;item.stage="preview_ready";item.detail="Preview is running and ready to open.";item.reviewFix={state:reviewFixScenario,round:1};item.aiReview={enabled:false,reason:"unstable",head:item.ci.head};
    item.runActions!.actions=[{action:"review_fix",label:"Fix review findings",enabled:false,confirmation:null,hint:null,state:"pending"},{action:"stop",label:"Cancel run",enabled:true,confirmation:null,hint:null,state:null}];
  }
  if(runNotesScenario){
    const item=snapshot.items[0]!,labels:Record<string,string>={preview_stop:'Remove preview',review_fix:'Fix review findings',ci_repair:'Fix CI',preview_start:'Start preview',preview_reviewed:'Preview reviewed',take_control:'Continue in Codex',recover_managed_task:'Recover managed task',stop:'Cancel run',discard_local:'Discard local work',discard_published:'Discard published work'};
    item.links.preview='https://preview.example.test/';item.aiReview={enabled:false,reason:'unstable',head:item.ci.head};item.reviewFix={state:'succeeded',round:1};
    item.runActions!.actions=RUN_ACTIONS.map(action=>({action,label:labels[action]!,enabled:false,state:runNotesScenario,hint:null,confirmation:null}));
    if(previewStopOnly){item.runActions!.actions=item.runActions!.actions.filter(action=>['preview_stop','stop','take_control'].includes(action.action));item.preview.state='outdated';item.preview.tone='warning';item.preview.head=item.review.head;}
  }
  if(dense)for(let index=0;index<80;index++)snapshot.items.push({...snapshot.items[3]!,id:`bulk-${index}`,number:100+index,title:`Additional task ${index}`});
  if(previewReviewScenario){const item=snapshot.items[0]!;item.preview={state:previewNewHead?'outdated':'running',tone:previewNewHead?'warning':'success',head:'abcdef0123456789',expiresAt:'2030-01-01T00:00:00Z',reviewed:previewReviewed};item.ci.head=previewNewHead?'fedcba9876543210':item.preview.head;item.links.preview='https://preview.example.test/';item.runActions!.actions=previewReviewed?[]:[{action:'preview_reviewed',label:'Превью проверено',enabled:true,confirmation:null,hint:null,state:null}];}
  if(startScenario!=="off") {
    const item=snapshot.items.find(item=>item.id==="item-15")!,statuses=snapshot.projects[0]!.statuses;
    item.status=["idle","checking","sync"].includes(startScenario)?statuses.backlog:statuses.active;
    item.statusChange={enabled:startScenario==="idle"||["running","blocked"].includes(startScenario),reason:["checking","sync"].includes(startScenario)?"pending":"eligible",choices:Object.values(statuses).map(value=>({value,label:value,hint:""}))};
    if(startScenario==="checking"||startScenario==="sync")item.statusChange.request={state:startScenario==="checking"?"checking":"awaiting_sync",target:statuses.active,from:statuses.backlog,key:startKey,checkAvailable:false};
    const messages={checking:"Checking the task in GitHub before starting.",sync:"Start requested. Waiting for Kurami to observe the status change.",admission:"Task accepted. Waiting for workspace preparation.",starting:"Kurami is preparing the workspace and agent session.",blocked:"Task start is blocked by work limits. Return it to Backlog and retry when capacity is available."};
    const states={checking:"checking",sync:"awaiting_sync",admission:"awaiting_admission",starting:"starting",blocked:"blocked"} as const;
    if(startScenario in states){const phase=startScenario as keyof typeof states;item.taskStart={state:states[phase],message:messages[phase]};}
    if(["admission","starting","running"].includes(startScenario)){item.runId="new-start";item.runState=startScenario==="admission"?"admission_pending":startScenario;}
    if(startScenario==="blocked"){item.runId="rejected-start";item.runState="rejected";}
  }
  return snapshot;
}, cacheMs: 0, authorize: async () => "fixture-owner", origin: "", review: (value: unknown) => {
  const input = value as { head: string; key: string };
  assert.equal(input.head,"abcdef0123456789"); requestKeys.push(input.key);
  if (failReview) throw new ProjectsActionError(503,"Ревью временно недоступно.");
  accepted = true; return { state: "created" as const, requestId: "fixture", requestState: "pending" };
} };
const completeOptions = { ...serverOptions, prCacheMs:0,runAction:(value:unknown)=>{
  const input=value as {action:string;key:string;confirmed:boolean};actionKeys.push(input.key);
  if(input.action==='preview_reviewed'){assert.equal(input.confirmed,false);previewReviewed=true;return {state:'created' as const,requestId:'fixture-reviewed',requestState:'applied'};}
  if(input.action==="discard_local") {assert.equal(input.confirmed,true);discarded=true;}
  else {assert.equal(input.action,"preview_start");assert.equal(input.confirmed,false);if(failAction) throw new ProjectsActionError(503,"Действие временно недоступно.");actionAccepted=true;}
  return {state:"created" as const,requestId:"fixture-action",requestState:"pending"};
},prInspect:async()=>{
  if(prReadGate)await prReadGate;
  if(prScenario==="unavailable")throw new ProjectsActionError(503,"PR actions are temporarily unavailable.");
  return {action:prScenario==="syncing"?null:prScenario==="ready"?"ready" as const:"merge" as const,enabled:!["blocked","syncing"].includes(prScenario),reason:prScenario==="syncing"?"A status change is still synchronizing.":prScenario==="blocked"?"GitHub requirements block merging.":"",head:"a".repeat(40),fingerprint:"f".repeat(64),methods:(prScenario==="all-methods"?["squash","rebase","merge"]:["squash","rebase"]) as ("squash"|"rebase"|"merge")[],number:20,base:"main"};
},prAction:async(value:unknown)=>{
  const input=value as {action:string;method:string|null;confirmed:boolean;key:string};prWrites.push(input);assert.equal(input.confirmed,true);
  prScenario=input.action==="ready"?"merge":"pending";
  return {state:input.action==="ready"?"applied" as const:"pending" as const,requestId:"fixture-pr"};
},statusChange: async (value: unknown) => {
  const input = value as {from:string;target:string;key:string;itemId:string};
  if(input.itemId==="item-15") {
    assert.equal(input.from,"Backlog");assert.equal(input.target,"In progress");
    startWrites++;startKey=input.key;startScenario="checking";
    await startWriteGate;startScenario="sync";
    return {state:"awaiting_sync" as const,requestId:"start-fixture",target:input.target};
  }
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
async function chooseMode(mode:string):Promise<void>{
  await devtools.evaluate(`document.querySelector('[data-mode-choice="${mode}"]').click();document.querySelector('[data-theme-panel][popover]')?.hidePopover()`);
}
async function pointerClick(selector:string):Promise<void> {
  const point=await devtools.evaluate<{x:number;y:number}>(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});button.scrollIntoView({behavior:'instant',block:'nearest'});const r=button.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await devtools.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await devtools.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
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
  if(!process.argv.includes("--pr-only")) {
  for (const width of [320, 390, 1280]) {
    await devtools.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:width<600});
    await open("/");
    for (const theme of ["light", "dark"]) {
      await chooseMode(theme);
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
      if(width===1280){
        const before=await devtools.evaluate<number>('history.length');
        await devtools.evaluate("document.querySelector('.projects-your-move [data-item-link]').click()");
        await wait("!!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
        await devtools.evaluate("document.querySelector('.projects-your-move [data-item-link]').click();document.querySelector('.projects-your-move [data-item-link]').click()");
        assert.equal(await devtools.evaluate('history.length'),before+1,'reopening the same task does not add history entries');
        assert.equal(await devtools.evaluate("getComputedStyle(document.querySelector('.projects-table .pill')).whiteSpace"),'nowrap');
        await devtools.evaluate('history.back()');await wait("!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
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
      assert.equal(await devtools.evaluate("document.querySelector('.projects-ci-details').open"),false,"successful checks start collapsed; closing remains saved on return");
      await devtools.evaluate("(()=>{const summary=document.querySelector('.projects-ci-details summary');summary.click();summary.focus({preventScroll:true})})()");
      assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-ci-checks li').length"),6);
      assert.equal(await devtools.evaluate("document.querySelector('.projects-ci-checks a').getAttribute('href')"),"https://github.com/Example/Alpha/actions/runs/100/job/200#step:2:1");
      await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
      await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
      assert.equal(await devtools.evaluate("document.querySelector('.projects-ci-details').open&&document.activeElement===document.querySelector('.projects-ci-details summary')"),true,"refresh preserves disclosure and keyboard focus");
      assert.equal(await devtools.evaluate("[...document.querySelectorAll('.projects-ci-checks a')].every(a=>a.getBoundingClientRect().width<=a.parentElement.getBoundingClientRect().width)"),true,"long check names fit the detail panel");
      assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-ci-checks a svg,.projects-ci-result').length"),0,"CI links have no repeated arrows or second-line status");
      assert.equal(await devtools.evaluate("[...document.querySelectorAll('.projects-ci-check')].every(row=>{const text=row.querySelector('.projects-ci-check-content').getBoundingClientRect(),mark=row.querySelector('.projects-ci-mark').getBoundingClientRect(),box=row.getBoundingClientRect();return mark.left>=text.right&&Math.abs(mark.right-box.right)<1&&Math.abs(mark.top+mark.height/2-box.top-box.height/2)<1})"),true,"CI result icons align at the right edge and vertical center");
      assert.equal(await devtools.evaluate("[...document.querySelectorAll('.projects-ci-checks .button__label--truncate')].every(label=>getComputedStyle(label).whiteSpace==='nowrap'&&getComputedStyle(label).textOverflow==='ellipsis'&&label.getBoundingClientRect().height<22)"),true,"CI labels remain one line");
      if(width===320){
        await devtools.evaluate("(()=>{const label=document.querySelector('.projects-ci-checks .button__label--truncate');window.ciLabelOriginal=label.textContent;label.textContent+=' — an intentionally long workflow check name that must stay on one line'})()");
        assert.equal(await devtools.evaluate("(()=>{const label=document.querySelector('.projects-ci-checks .button__label--truncate');return label.scrollWidth>label.clientWidth&&label.getBoundingClientRect().height<22})()"),true,"long names really truncate rather than overflow");
        await devtools.evaluate("document.querySelector('.projects-ci-checks .button__label--truncate').textContent=window.ciLabelOriginal");
      }
      await audit();
      if(theme==='light'){
        await devtools.evaluate("document.querySelector('.projects-ci-details').scrollIntoView({block:'center',behavior:'instant'})");
        const ciShot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
        writeFileSync(resolve(out,`projects-ci-${width}.png`),Buffer.from(ciShot.data,"base64"));
      }
      await devtools.evaluate("document.querySelector('.projects-ci-details summary').click();document.querySelector('#project-details').focus({preventScroll:true})");
      const density=await devtools.evaluate<{reviewHeight:number;reviewWidth:number;groupWidth:number;pillHeight:number;sortIcon:number;actionWidths:boolean}>(`(() => {
        const review=document.querySelector('[data-review-run]'), group=review.closest('.projects-action-pair');
        return {reviewHeight:review.getBoundingClientRect().height,reviewWidth:review.getBoundingClientRect().width,groupWidth:group.getBoundingClientRect().width,pillHeight:document.querySelector('.projects-detail .pill').getBoundingClientRect().height,sortIcon:parseFloat(getComputedStyle(document.querySelector('[data-sort] .button__svg')).width),actionWidths:[...document.querySelectorAll('[data-run-action]')].every(button=>{const pair=button.closest('.projects-action-pair'),columns=pair.children.length,expected=(pair.getBoundingClientRect().width-parseFloat(getComputedStyle(pair).columnGap)*(columns-1))/columns;return Math.abs(button.getBoundingClientRect().width-expected)<1;})};
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
  for(const width of [320,390,1280]){
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    ciScenario="failed";
    await open('/?item=item-12');
    await devtools.evaluate("if(document.documentElement.dataset.theme!=='light')document.querySelector('[data-theme-toggle]').click()");
    await delay(250);
    assert.equal(await devtools.evaluate("document.querySelector('.projects-ci-details').open"),true,"failed CI automatically shows job details");
    assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-ci-mark--failure').length"),2);
    await audit();
    await devtools.evaluate("document.querySelector('.projects-ci-details').scrollIntoView({block:'center',behavior:'instant'})");
    const failedShot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    writeFileSync(resolve(out,`projects-ci-failed-${width}.png`),Buffer.from(failedShot.data,"base64"));
    await devtools.evaluate("document.querySelector('.projects-ci-checks a').focus({preventScroll:true});document.dispatchEvent(new Event('visibilitychange'))");
    await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
    assert.equal(await devtools.evaluate("document.activeElement.getAttribute('href')"),"https://github.com/Example/Alpha/actions/runs/100/job/200#step:2:1","job link keeps focus across refresh");
    ciScenario="mixed";
    await open('/?item=item-12');
    assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-ci-checks a').length"),5,"missing check has no invented navigation");
    assert.match(await devtools.evaluate<string>("[...document.querySelectorAll('.projects-ci-check')].map(row=>row.title).join(' · ')"),/Pending[\s\S]*Unknown[\s\S]*Check not reported/);
    await audit();
    ciScenario="new-head";
    await devtools.evaluate("document.querySelector('.projects-ci-details summary').focus({preventScroll:true});document.dispatchEvent(new Event('visibilitychange'))");
    await wait("document.querySelector('.projects-ci-details').dataset.disclosureKey.endsWith('fedcba9876543210')");
    assert.equal(await devtools.evaluate("document.querySelector('.projects-ci-details').open"),false,"new commit resets to its own successful-check default");
    assert.equal(await devtools.evaluate("document.activeElement===document.querySelector('.projects-ci-details summary')"),true,"new commit keeps focus on the check disclosure");
  }
  ciScenario="normal";
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
  await wait("Math.abs(document.querySelector('#project-details').getBoundingClientRect().x)<1");
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
  assert.equal(await devtools.evaluate("document.querySelector('[data-toast-region]').hidden"),true,"successful refresh clears only its stale refresh failure");
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
  await devtools.call("Emulation.setDeviceMetricsOverride",{width:390,height:1000,deviceScaleFactor:1,mobile:true});
  await open("/");
  assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr:not([hidden])').length"),10);
  await devtools.evaluate("document.querySelector('[data-show-more-tasks]').click()");
  assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr:not([hidden])').length"),20);
  await devtools.evaluate('window.kuramiRefresh()');
  assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr:not([hidden])').length"),20,'refresh preserves revealed rows');
  await devtools.evaluate("const input=document.querySelector('input[name=q]');input.value='Additional task 79';input.dispatchEvent(new Event('input'))");
  assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr:not([hidden])').length"),1,'search finds tasks beyond the revealed page');
  assert.equal(await devtools.evaluate("document.querySelector('[data-tasks-more]').hidden"),true);
  await devtools.evaluate("document.querySelector('input[name=q]').value='';document.querySelector('input[name=q]').dispatchEvent(new Event('input'))");
  assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr:not([hidden])').length"),10,'changing the query resets the page size');
  await devtools.call("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
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
  await wait("document.querySelector('[data-toast-message]').textContent.includes('queued in Kurami') && document.querySelector('[data-run-action=discard_local]')?.disabled && !document.querySelector('#projects-dashboard').dataset.refreshing");
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
  assert.equal(await devtools.evaluate("testRegion.querySelector('[data-toast-message] img')===null"),true);
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
  }
  cancellation=discarded=accepted=false;statusRequest=null;ciScenario="normal";
  for(const width of [320,390,1280]) {
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    for(const theme of ["light","dark"]) {
      prScenario="merge";await open('/?item=item-12');await wait("!!document.querySelector('[data-pr-action]')");
      await chooseMode(theme);
      await delay(250);
      assert.equal(await devtools.evaluate("(()=>{const cancel=document.querySelector('[data-run-action=stop]'),pr=document.querySelector('[data-pr-action]');return cancel.closest('.projects-action-pair')===pr.closest('.projects-action-pair')&&Math.abs(cancel.getBoundingClientRect().height-pr.getBoundingClientRect().height)<1})()"),true,"cancel and PR action pair have equal heights");
      await audit();
      await devtools.evaluate("document.querySelector('[data-pr-action]').scrollIntoView({block:'nearest',behavior:'instant'})");
      const before=await devtools.evaluate("document.querySelector('[data-pr-action]').getBoundingClientRect().top");
      await devtools.evaluate("document.querySelector('[data-pr-action]').click()");
      assert.equal(await devtools.evaluate("document.activeElement.dataset.prMethod"),'squash');
      assert.deepEqual(await devtools.evaluate("[...document.querySelectorAll('[data-pr-method]')].map(option=>option.dataset.prMethod)"),['squash','rebase']);
      assert.equal(await devtools.evaluate("document.querySelector('select[name=merge-method]')"),null,"no additional select in the card");
      assert.equal(prWrites.length,0,"opening method menu performs no write");
      assert.equal(await devtools.evaluate("document.querySelector('[data-pr-action]').getBoundingClientRect().top"),before,"popup never changes the card layout");
      await audit();
      await devtools.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
      assert.equal(await devtools.evaluate("document.activeElement.dataset.prMethod"),'rebase');
      await devtools.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))");
      assert.equal(await devtools.evaluate("document.activeElement.dataset.prMethod"),'squash');
      if(width===390&&theme==='light'){
        await pointerClick('[data-pr-action]');
        assert.equal(await devtools.evaluate("document.querySelector('.projects-pr-popover .ui-popover').matches(':popover-open')"),false,"repeat physical click closes the menu instead of reopening it after light-dismiss");
        await pointerClick('[data-pr-action]');
        assert.equal(await devtools.evaluate("document.querySelector('.projects-pr-popover .ui-popover').matches(':popover-open')"),true);
        await pointerClick('[data-pr-method=squash]');
        await pointerClick('[data-pr-dismiss]');
        assert.equal(await devtools.evaluate("document.querySelector('.projects-pr-popover .ui-popover').matches(':popover-open')"),false,"Cancel closes the confirmation without a write");
        await pointerClick('[data-pr-action]');
        await devtools.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:2,y:500});
        await devtools.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:2,y:500});
        assert.equal(await devtools.evaluate("document.querySelector('.projects-pr-popover .ui-popover').matches(':popover-open')"),false,"outside click closes the menu");
        assert.equal(await devtools.evaluate("document.querySelector('[data-pr-action]').getAttribute('aria-expanded')"),'false');
        await pointerClick('[data-pr-action]');
        await devtools.evaluate("document.querySelector('[data-run-action=stop]').focus({preventScroll:true})");
        assert.equal(await devtools.evaluate("document.querySelector('.projects-pr-popover .ui-popover').matches(':popover-open')"),false,"keyboard focus outside closes the menu without stealing focus");
        assert.equal(await devtools.evaluate("document.activeElement.dataset.runAction"),'stop');
        await pointerClick('[data-pr-action]');
        assert.equal(await devtools.evaluate("document.querySelector('[data-pr-confirmation]').hidden"),true,"reopening returns to methods, not a previous confirmation");
      }
      await devtools.evaluate("document.querySelector('[data-pr-method=rebase]').click()");
      assert.equal(prWrites.length,0,"selecting a merge method still requires confirmation");
      assert.equal(await devtools.evaluate("document.activeElement.hasAttribute('data-pr-confirm')"),true);
      assert.equal(await devtools.evaluate("document.querySelector('[data-pr-confirm]').textContent"),'Rebase and merge');
      await audit();
      if(theme==='light'){
        await wait("(()=>{const panel=document.querySelector('.projects-pr-popover .ui-popover').getBoundingClientRect();return panel.height>50&&panel.bottom<=innerHeight&&panel.top>=0&&panel.left>=0&&panel.right<=innerWidth})()");
        await delay(80);
        const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(out,`projects-pr-merge-${width}.png`),Buffer.from(shot.data,'base64'));
      }
      await devtools.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      assert.equal(await devtools.evaluate("document.querySelector('.projects-pr-popover .ui-popover').matches(':popover-open')"),false);
      assert.equal(await devtools.evaluate("document.activeElement.hasAttribute('data-pr-action')"),true);
    }
  }
  prScenario="ready";await open('/?item=item-12&lang=ru');await wait("document.querySelector('[data-pr-action]')?.dataset.prAction==='ready'");
  assert.equal(await devtools.evaluate("document.querySelector('[data-pr-action]').textContent"),'Готово к проверке');
  await devtools.evaluate("document.querySelector('[data-pr-action]').click()");assert.equal(prWrites.length,0);
  await devtools.evaluate("document.querySelector('[data-pr-confirm]').click()");await wait("document.querySelector('[data-pr-action]')?.dataset.prAction==='merge'");
  assert.equal(prWrites.length,1);assert.equal(prWrites[0]!.action,'ready');assert.equal(prWrites[0]!.method,null);
  await devtools.evaluate("document.querySelector('[data-pr-action]').click();document.querySelector('[data-pr-method=rebase]').click();document.querySelector('[data-pr-confirm]').click()");
  await wait("!document.querySelector('#projects-dashboard').dataset.refreshing&&document.querySelector('[data-toast-message]')?.textContent.includes('GitHub')");
  assert.equal(prWrites.length,2);assert.equal(prWrites[1]!.method,'rebase');
  prScenario="blocked";await open('/?item=item-12');await wait("document.querySelector('[data-pr-action]')?.disabled===true");
  assert.equal(await devtools.evaluate("document.querySelector('[data-pr-slot]').textContent.includes('GitHub requirements')"),true);
  assert.equal(prWrites.length,2);
  prScenario="merge";await devtools.call("Emulation.setDeviceMetricsOverride",{width:320,height:700,deviceScaleFactor:1,mobile:true});
  await open('/?item=item-12&lang=ru');await wait("document.querySelector('[data-pr-action]')?.dataset.prAction==='merge'");
  await pointerClick('[data-pr-action]');await pointerClick('[data-pr-method=rebase]');
  await audit();
  assert.equal(await devtools.evaluate("document.querySelector('[data-pr-confirm]').textContent"),'Смержить через Rebase');
  assert.equal(await devtools.evaluate("(()=>{const a=document.querySelector('[data-pr-confirm]').getBoundingClientRect(),b=document.querySelector('[data-pr-dismiss]').getBoundingClientRect();return Math.abs(a.top-b.top)<1})()"),true,"Russian confirmation buttons remain a single row at 320px");
  const ruShot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(out,'projects-pr-merge-ru-320.png'),Buffer.from(ruShot.data,'base64'));
  await devtools.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await devtools.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await devtools.evaluate("document.querySelector('.projects-pr-popover .ui-popover').matches(':popover-open')"),false,"real Escape closes only the PR popup");
  assert.equal(await devtools.evaluate("!!document.querySelector('#project-details')&&document.activeElement.hasAttribute('data-pr-action')"),true);
  assert.equal(prWrites.length,2);
  for(const lang of ['ru','en']) {
    prScenario="all-methods";await open(`/?item=item-12&lang=${lang}`);await wait("document.querySelectorAll('[data-pr-method]').length===3");
    const labels=lang==='ru'?{squash:'Смержить через Squash',rebase:'Смержить через Rebase',merge:'Создать merge-коммит'}:{squash:'Squash and merge',rebase:'Rebase and merge',merge:'Create merge commit'};
    for(const [method,label] of Object.entries(labels)) {
      await pointerClick('[data-pr-action]');await pointerClick(`[data-pr-method=${method}]`);
      assert.equal(await devtools.evaluate("document.querySelector('[data-pr-confirm]').textContent"),label);
      assert.equal(await devtools.evaluate("document.querySelector('[data-pr-action]').dataset.prMethodValue"),method,"label changes do not change the selected API method");
      assert.equal(await devtools.evaluate("(()=>{const a=document.querySelector('[data-pr-confirm]').getBoundingClientRect(),b=document.querySelector('[data-pr-dismiss]').getBoundingClientRect();return Math.abs(a.top-b.top)<1})()"),true,"all confirmation labels keep one button row at 320px");
      await audit();await pointerClick('[data-pr-dismiss]');
    }
  }
  assert.equal(prWrites.length,2,"checking labels never writes a PR");
  for(const width of [320,390,1280])for(const lang of ['en','ru'])for(const theme of ['light','dark'])for(const scenario of ['syncing','unavailable','ready','merge','blocked'] as const){
    prScenario=scenario;
    let releasePr!:()=>void;prReadGate=new Promise<void>(done=>{releasePr=done});
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await open(`/?item=item-12&lang=${lang}`);
    const before=await devtools.evaluate<number[]>("(()=>{const cancel=document.querySelector('[data-run-action=stop]').getBoundingClientRect(),pr=document.querySelector('[data-pr-slot] button').getBoundingClientRect();return [cancel.width,pr.width]})()");
    releasePr();prReadGate=null;
    await wait(["syncing","unavailable","blocked"].includes(scenario)?"!!document.querySelector('[data-pr-slot] > .projects-run-action-meta > .projects-action-note')":"!!document.querySelector('[data-pr-action]:not(:disabled)')");
    const after=await devtools.evaluate<number[]>("(()=>{const cancel=document.querySelector('[data-run-action=stop]').getBoundingClientRect(),pr=document.querySelector('[data-pr-slot] button').getBoundingClientRect();return [cancel.width,pr.width]})()");
    assert.deepEqual(after,before,'loading, unavailable and available PR controls preserve both button widths');
    await chooseMode(theme);
    await delay(250);
    if(['syncing','unavailable','blocked'].includes(scenario))assert.equal(await devtools.evaluate("(()=>{const cancel=document.querySelector('[data-run-action=stop]').getBoundingClientRect(),slot=document.querySelector('[data-pr-slot]'),button=slot.querySelector('button'),pr=button.getBoundingClientRect(),note=slot.querySelector('.projects-action-note').getBoundingClientRect(),row=slot.closest('.projects-action-pair').getBoundingClientRect();return button.disabled&&Math.abs(cancel.width-pr.width)<1&&Math.abs(cancel.top-pr.top)<1&&Math.abs(cancel.height-pr.height)<1&&Math.abs(note.width-row.width)<1&&note.top>=cancel.bottom&&Math.abs(note.left-cancel.left)<1})()"),true,'disabled PR control keeps its half-width slot; explanation spans the row: '+width+' '+lang+' '+scenario);
    await devtools.evaluate("document.querySelector('.projects-ci-details summary').scrollIntoView({block:'center',behavior:'instant'})");
    assert.equal(await devtools.evaluate("(()=>{const details=document.querySelector('.projects-ci-details'),summary=details.querySelector('summary');return Math.abs(details.getBoundingClientRect().width-summary.getBoundingClientRect().width)<1})()"),true,"Checks target fills the evidence width");
    const wasOpen=await devtools.evaluate<boolean>("document.querySelector('.projects-ci-details').open");
    const point=await devtools.evaluate<{x:number;y:number}>("(()=>{const r=document.querySelector('.projects-ci-details summary').getBoundingClientRect();return {x:r.right-4,y:r.top+r.height/2}})()");
    await devtools.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await devtools.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    assert.equal(await devtools.evaluate("document.querySelector('.projects-ci-details').open"),!wasOpen,"clicking the far-right edge toggles Checks");
    await audit();
    if(width===390&&lang==='en'&&scenario==='syncing'){
      await devtools.evaluate("document.querySelector('[data-run-action=stop]').scrollIntoView({block:'center',behavior:'instant'})");
      const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(out,`projects-pr-note-${theme}-390.png`),Buffer.from(shot.data,'base64'));
    }
  }
  assert.equal(prWrites.length,2,"reading blocked PR explanations never writes a PR");
  semanticNotes=true;prScenario='off';ciScenario='normal';previewReady=false;cancellation=false;accepted=false;statusRequest=null;actionAccepted=false;
  for(const lang of ['en','ru'])for(const theme of ['light','dark']){
    await devtools.call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
    await open(`/?item=item-12&lang=${lang}`);
    await chooseMode(theme);await delay(200);
    assert.equal(await devtools.evaluate("document.querySelector('.projects-findings [data-note-tone=failure]').textContent.startsWith('1 ')"),true,'critical finding has a separate severity accent');
    assert.equal(await devtools.evaluate("document.querySelector('[data-preview-expiry]').dataset.noteTone"),'warning','live preview expiry has a last-hour caution');
    await audit();
    if(lang==='en'){const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(out,`projects-semantic-notes-${theme}.png`),Buffer.from(shot.data,'base64'));}
  }
  for(const width of [320,390,1280])for(const lang of ['en','ru'])for(const state of ['queued','running','waiting_ci','resolving']){
    reviewFixScenario=state;prScenario='syncing';
    await devtools.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<620});
    await open(`/?item=item-12&lang=${lang}`);
    await wait("!!document.querySelector('[data-pr-slot] > .projects-run-action-meta > .projects-action-note')");
    assert.equal(await devtools.evaluate(`document.querySelector('[data-review-fix-state]').dataset.reviewFixState`),state);
    assert.equal(await devtools.evaluate(`!document.querySelector('#project-details [data-review-run]')&&!document.querySelector('#project-details .projects-context')`),true,'active fix removes stale preview context and duplicate unavailable review');
    assert.equal(await devtools.evaluate(`(()=>{const detail=document.querySelector('#project-details'),note=detail.querySelector('[data-review-fix-state]'),row=note.closest('.projects-evidence-row'),fix=detail.querySelector('[data-run-action=review_fix]');return note.getBoundingClientRect().width===row.clientWidth-24&&fix.getBoundingClientRect().width===fix.closest('.projects-action-pair').getBoundingClientRect().width&&![...detail.querySelectorAll('.projects-run-action-meta p')].some(p=>['Queued','В очереди'].includes(p.textContent))&&[...detail.querySelectorAll('.projects-evidence-heading')].every(h=>h.scrollWidth<=h.clientWidth);})()`),true,'progress fills its evidence row; no orphan Queued or overlapping header');
    await audit();
    if(width===390&&lang==='en'&&state==='queued'){
      await devtools.evaluate(`document.querySelector('[data-review-fix-state]').scrollIntoView({block:'center',behavior:'instant'})`);
      const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(out,'projects-review-fix-queued.png'),Buffer.from(shot.data,'base64'));
    }
  }
  reviewFixScenario=null;
  for(const width of [320,390,1280])for(const lang of ['en','ru'])for(const theme of ['light','dark'])for(const state of ['pending','processing','failed','rejected']){
    runNotesScenario=state;
    await devtools.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<620});
    await open(`/?item=item-12&lang=${lang}`);
    await wait("!!document.querySelector('[data-pr-slot] > .projects-run-action-meta > .projects-action-note')");
    await chooseMode(theme);await delay(250);
    assert.equal(await devtools.evaluate(`(()=>{const notes=[...document.querySelectorAll('[data-run-action-state]')];return notes.length===${RUN_ACTIONS.length}&&notes.every(note=>{const pair=note.closest('.projects-action-pair'),buttons=[...pair.children].map(slot=>slot.firstElementChild),r=note.getBoundingClientRect(),p=pair.getBoundingClientRect();return note.dataset.requestState===${JSON.stringify(state)}&&note.textContent.includes(' · ')&&Math.abs(r.left-p.left)<1&&Math.abs(r.width-p.width)<1&&buttons.every(button=>r.top>=button.getBoundingClientRect().bottom)&&buttons.every(button=>Math.abs(button.getBoundingClientRect().top-buttons[0].getBoundingClientRect().top)<1&&Math.abs(button.getBoundingClientRect().height-buttons[0].getBoundingClientRect().height)<1);})&&[...document.querySelectorAll('.projects-action-pair')].every(pair=>{const visible=[...pair.querySelectorAll('.projects-run-action-meta')].filter(meta=>meta.getBoundingClientRect().height);return visible.every((meta,index)=>index===0||meta.getBoundingClientRect().top>=visible[index-1].getBoundingClientRect().bottom);});})()`),true,'every action note spans its pair without button-column artifacts or overlapping messages');
    await audit();
    if(width===390&&lang==='en'&&state==='pending'&&theme==='light'){
      await devtools.evaluate(`document.querySelector('[data-run-action=preview_stop]').scrollIntoView({block:'center',behavior:'instant'})`);
      const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(out,'projects-preview-stop-pending.png'),Buffer.from(shot.data,'base64'));
    }
  }
  previewStopOnly=true;runNotesScenario='pending';
  for(const width of [320,390,1280])for(const lang of ['en','ru'])for(const theme of ['light','dark']){
    await devtools.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<620});await open(`/?item=item-12&lang=${lang}`);
    await chooseMode(theme);await delay(250);
    assert.equal(await devtools.evaluate(`(()=>{const button=document.querySelector('[data-run-action=preview_stop]'),note=document.querySelector('[data-run-action-state=preview_stop]'),pair=button.closest('.projects-action-pair'),open=pair.querySelector('a'),r=note.getBoundingClientRect(),p=pair.getBoundingClientRect(),b=button.getBoundingClientRect(),a=open.getBoundingClientRect();return button.disabled&&pair.children.length===2&&Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1&&Math.abs(a.top-b.top)<1&&r.top>=b.bottom&&Math.abs(r.left-p.left)<1&&Math.abs(r.width-p.width)<1&&note.textContent.includes(' · ');})()`),true,'Open preview and pending Remove preview keep an equal button pair with one shared full-width status');
    await audit();
    if(width===390&&lang==='en'&&theme==='light'){await devtools.evaluate(`document.querySelector('[data-run-action=preview_stop]').scrollIntoView({block:'center',behavior:'instant'})`);const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(out,'projects-preview-stop-pending.png'),Buffer.from(shot.data,'base64'));}
  }
  previewReviewScenario=true;runNotesScenario=null;previewStopOnly=false;semanticNotes=false;reviewFixScenario=null;
  prScenario='off';previewReady=false;accepted=false;cancellation=false;actionAccepted=false;statusRequest=null;
  for(const width of [320,390,1280])for(const lang of ['en','ru'])for(const theme of ['light','dark']){
    previewReviewed=false;previewNewHead=false;
    await devtools.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<620});
    await open(`/?item=item-12&lang=${lang}`);
    await chooseMode(theme);await delay(200);
    assert.equal(await devtools.evaluate("!!document.querySelector('[data-preview-review]')"),false);
    await pointerClick('[data-run-action=preview_reviewed]');
    await wait("!!document.querySelector('[data-preview-review=current]')");
    assert.equal(await devtools.evaluate("!!document.querySelector('[data-run-action=preview_reviewed]')"),false);
    await audit();await open(`/?item=item-12&lang=${lang}`);
    await wait("!!document.querySelector('[data-preview-review=current]')");
    if(width===390&&lang==='ru'&&theme==='light'){await devtools.evaluate("document.querySelector('[data-preview-review]').scrollIntoView({block:'center',behavior:'instant'})");const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(out,'projects-preview-reviewed.png'),Buffer.from(shot.data,'base64'));}
    previewNewHead=true;await open(`/?item=item-12&lang=${lang}`);
    await wait("!!document.querySelector('[data-preview-review=outdated]')");await audit();
    assert.equal(await devtools.evaluate("!!document.querySelector('[data-preview-review=current]')"),false);
  }
  previewReviewScenario=false;
  for(const width of [320,390,1280])for(const lang of ['en','ru'])for(const theme of ['light','dark']){
    startScenario='idle';startKey='';startWrites=0;
    let releaseStart!:()=>void;startWriteGate=new Promise<void>(resolve=>{releaseStart=resolve;});
    await devtools.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<620});
    await open(`/?item=item-15&lang=${lang}`);
    await chooseMode(theme);await delay(150);
    assert.equal(await devtools.evaluate("!!document.querySelector('[data-start-task] select')"),false);
    assert.equal(await devtools.evaluate("document.querySelector('[data-status-submit]').disabled"),false);
    assert.ok(await devtools.evaluate("(()=>{const form=document.querySelector('[data-start-task]'),button=form.querySelector('[data-status-submit]');return Math.abs(form.getBoundingClientRect().width-button.getBoundingClientRect().width)<1;})()"),'single Start work button fills its row');
    await pointerClick('[data-status-submit]');
    await wait("document.querySelector('[data-status-submit]').getAttribute('aria-busy')==='true'");
    await devtools.evaluate("document.querySelector('[data-status-submit]').click()");
    await delay(100);assert.equal(startWrites,1,'double clicking starts one status request');
    releaseStart();startWriteGate=null;
    await wait("!!document.querySelector('[data-start-state=awaiting_sync]')");
    assert.equal(await devtools.evaluate("document.querySelector('[data-status-submit]').disabled"),true);
    await audit();await open(`/?item=item-15&lang=${lang}`);
    assert.equal(await devtools.evaluate("document.querySelector('[data-start-task]').dataset.key"),startKey,'reload keeps the same durable start identity');
    assert.equal(await devtools.evaluate("!!document.querySelector('[data-start-state=awaiting_sync]')"),true);
    if(width===390&&lang==='ru'&&theme==='light'){const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(out,'projects-task-start-waiting.png'),Buffer.from(shot.data,'base64'));}
    for(const phase of ['admission','starting','running','blocked'] as const){
      startScenario=phase;await open(`/?item=item-15&lang=${lang}`);await audit();
      if(phase==='running'||phase==='blocked')assert.equal(await devtools.evaluate("!!document.querySelector('[data-status-form] select')"),true);
      else assert.equal(await devtools.evaluate("document.querySelector('[data-status-submit]').disabled"),true);
      if(phase==='blocked')assert.equal(await devtools.evaluate("document.querySelector('[data-status-note]').hidden"),false,'admission refusal stays visible and leaves status controls available');
    }
    assert.equal(startWrites,1,'refreshing and phase changes never start another request');
  }
  for(const lang of ['en','ru']){
    startScenario='idle';startWrites=0;
    await devtools.call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
    await open(`/?item=item-15&lang=${lang}`);
    await devtools.evaluate("window.beforeUpgradeFetch=fetch;window.fetch=(...args)=>beforeUpgradeFetch(...args).then(response=>{if(!String(args[0]).includes('/api/fragment'))return response;const headers=new Headers(response.headers);headers.set('X-Kurami-Projects-Version','new-server-generation');return new Response(response.body,{status:response.status,headers});})");
    startScenario='sync';startKey='upgrade-fixture';
    await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    await wait("document.querySelector('[data-toast-region]').dataset.tone==='warning'&&!document.querySelector('#projects-dashboard').dataset.refreshing");
    assert.equal(await devtools.evaluate("document.querySelector('[data-start-task]').dataset.startState"),'idle','different-generation fragment never replaces the old card');
    assert.equal(await devtools.evaluate("document.querySelector('[data-status-submit]').disabled"),true);
    assert.match(await devtools.evaluate<string>("document.querySelector('[data-toast-message]').textContent"),lang==='ru'?/Перезагрузите/:/Reload/);
    await devtools.evaluate("document.querySelector('[data-status-submit]').click()");assert.equal(startWrites,0);
    await devtools.evaluate("window.fetch=beforeUpgradeFetch");startScenario='idle';
    await open(`/?item=item-15&lang=${lang}`);
    assert.equal(await devtools.evaluate("document.querySelector('[data-status-submit]').disabled"),false,'full reload restores the current generation');
    await devtools.evaluate("window.savedRefreshFetch=fetch;window.fetch=(...args)=>String(args[0]).includes('/api/fragment')?Promise.reject(new Error('fixture offline')):savedRefreshFetch(...args);document.dispatchEvent(new Event('visibilitychange'))");
    await wait("document.querySelector('[data-toast-region]').dataset.tone==='failure'&&!document.querySelector('#projects-dashboard').dataset.refreshing");
    await devtools.evaluate("window.fetch=savedRefreshFetch;document.dispatchEvent(new Event('visibilitychange'))");
    await wait("document.querySelector('[data-toast-region]').hidden&&!document.querySelector('#projects-dashboard').dataset.refreshing");
    await audit();assert.equal(startWrites,0,'refresh recovery never starts the task');
  }
} finally {
  await browser.close();
  await new Promise<void>(done => server.close(() => done()));
}
console.log("Projects browser: owner overview, task panel, focus, filters, search, failed refresh and mobile/dark accessibility verified");
