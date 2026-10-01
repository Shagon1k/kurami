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
let statusRequest: {state:"awaiting_sync";target:string;from:string;key:string} | null = null; let statusSynced = false; let statusConflict = false; const statusKeys: string[] = [];
let accepted = false; let failReview = false; const requestKeys: string[] = [];
let failAction=false,actionAccepted=false,cancellation=false,discarded=false;const actionKeys:string[]=[];
const serverOptions = { snapshot: () => {
  if (unavailable) throw new Error("fixture failure");
  const snapshot = syntheticProjectsSnapshot();
  if (accepted) { snapshot.items[0]!.review.state = "queued"; snapshot.items[0]!.review.tone = "neutral"; snapshot.items[0]!.aiReview = { enabled: false, reason: "pending", head: "abcdef0123456789" }; }
  if (statusRequest) {
    if (statusSynced) snapshot.items[0]!.status = statusRequest.target;
    else snapshot.items[0]!.statusChange = { ...snapshot.items[0]!.statusChange!, enabled: false, reason: "pending", request: {...statusRequest,checkAvailable:false} };
  }
  if(actionAccepted) snapshot.items[0]!.runActions!.actions=snapshot.items[0]!.runActions!.actions.map(action=>action.action==="preview_start"?{...action,enabled:false,state:"pending"}:action);
  if(cancellation) snapshot.items[0]!.runActions!.actions=[{action:"discard_local",label:"Удалить локальную работу",enabled:!discarded,confirmation:"Удалить сохранённую локальную работу? Это действие нельзя отменить.",hint:null,state:discarded?"pending":null}];
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
async function wait(expression: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) { if (await devtools.evaluate<boolean>(expression)) return; await delay(50); }
  throw new Error("Timed out: " + expression);
}
async function open(path: string): Promise<void> {
  await devtools.call("Page.navigate", { url: base + path });
  await wait("document.readyState==='complete' && !!document.querySelector('#projects-dashboard')");
  await devtools.evaluate("document.fonts.ready");
}
async function audit(): Promise<void> {
  assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION), []);
  assert.deepEqual(await devtools.evaluate(inventoryExpression()), []);
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
      await devtools.evaluate("document.querySelector('[data-active-toggle]').click()");
      await wait("location.search.includes('active=1') && !document.querySelector('#projects-dashboard').dataset.refreshing");
      assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr').length"),3);
      assert.equal(await devtools.evaluate("document.querySelector('[data-active-toggle]').getAttribute('aria-pressed')"),"true");
      await audit();
      await devtools.evaluate("document.querySelector('[data-active-toggle]').click()");
      await wait("!location.search.includes('active=1') && !document.querySelector('#projects-dashboard').dataset.refreshing");
      assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr').length"),6);
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
        assert.equal(await devtools.evaluate("document.querySelector('#project-details').getBoundingClientRect().width"),width);
      }

      await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
      await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
      assert.equal(await devtools.evaluate("document.activeElement.id"), "project-details", "background refresh preserves panel focus");
      await audit();
      const density=await devtools.evaluate<{reviewHeight:number;reviewWidth:number;groupWidth:number;pillHeight:number;sortIcon:number;actionWidths:boolean}>(`(() => {
        const review=document.querySelector('[data-review-run]'), group=review.parentElement;
        return {reviewHeight:review.getBoundingClientRect().height,reviewWidth:review.getBoundingClientRect().width,groupWidth:group.getBoundingClientRect().width,pillHeight:document.querySelector('.projects-detail .pill').getBoundingClientRect().height,sortIcon:parseFloat(getComputedStyle(document.querySelector('[data-sort] .button__svg')).width),actionWidths:[...document.querySelectorAll('[data-run-action]')].every(button=>Math.abs(button.getBoundingClientRect().width-button.parentElement.getBoundingClientRect().width)<1)};
      })()`);
      assert.equal(density.reviewHeight,36,"standard action height");
      assert.ok(Math.abs(density.reviewWidth-density.groupWidth)<1,"review action fills its group");
      assert.ok(density.pillHeight<=23,"compact status pills");
      assert.equal(density.sortIcon,14,"small sorting icon");
      assert.ok(density.actionWidths,"run actions fill their groups");
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
  await devtools.call("Emulation.setDeviceMetricsOverride",{width:390,height:780,deviceScaleFactor:1,mobile:true});
  await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:true});
  await open("/");
  await devtools.evaluate("document.querySelector('[data-item-link]').click()");
  await wait("!!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  const detailSwipeY=await devtools.evaluate<number>("document.querySelector('#project-details h2').getBoundingClientRect().top+8");
  await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:90,y:detailSwipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:280,y:detailSwipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await wait("!document.querySelector('#project-details') && !document.body.classList.contains('projects-mobile-detail-open')");
  const swipeY=await devtools.evaluate<number>("document.querySelector('.projects-task-meta').getBoundingClientRect().top+8");
  await devtools.call("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:290,y:swipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:90,y:swipeY}]});
  await devtools.call("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await wait("!!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  await devtools.evaluate("history.back()");
  await wait("!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  await devtools.evaluate("history.forward()");
  await wait("!!document.querySelector('#project-details') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  failReview=true;
  await devtools.evaluate("document.querySelector('[data-review-run]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('unavailable')");
  assert.equal(await devtools.evaluate("!!document.querySelector('[data-refresh-status]').closest('#project-details')"),true,"mobile action failures are visible inside the dialog");
  assert.equal(await devtools.evaluate("!!document.querySelector('[data-refresh-status]').closest('[inert]')"),false);
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
  await devtools.evaluate("const toggle=document.querySelector('[data-active-toggle]');toggle.focus();toggle.click()");
  await wait("location.search.includes('active=1') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.activeElement.hasAttribute('data-active-toggle')"),true,"toggle retains keyboard focus after replacement");
  await devtools.evaluate("const search=document.querySelector('input[name=q]');search.value='SEARCH';search.dispatchEvent(new Event('input'));document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelector('[data-visible-count]').textContent"),"1","active filter combines with search after background refresh");
  assert.equal(await devtools.evaluate("new URL(document.querySelector('[data-language-link]').href).searchParams.get('active')"),"1");
  await devtools.evaluate("document.querySelector('[data-project-tabs] a[href*=beta]').click()");
  await wait("location.search.includes('project=beta') && !document.querySelector('#projects-dashboard').dataset.refreshing");
  assert.equal(await devtools.evaluate("document.querySelectorAll('.projects-table tbody tr').length"),1,"project changes keep the active filter");
  assert.equal(await devtools.evaluate("document.querySelector('[data-visible-count]').textContent"),"0","no search match in active project shows zero");
  await open("/?active=1&lang=ru");
  assert.equal(await devtools.evaluate("document.querySelector('[data-active-toggle]').textContent"),"Только активные");
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
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('unavailable')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-review-run]').disabled"),false);
  failReview = false;
  await devtools.evaluate("document.querySelector('[data-review-run]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('AI Review queued')");
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
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('Status changed')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').value"),"Done");
  statusConflict = false;
  await devtools.evaluate("document.querySelector('[data-status-submit]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('Waiting for Kurami sync')");
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
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('action is temporarily unavailable')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').disabled"),false);
  failAction=false;
  await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('queued in Kurami')");
  assert.equal(actionKeys.length,2);
  assert.equal(await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').disabled"),true);
  assert.match(await devtools.evaluate<string>("document.querySelector('[data-run-action=preview_start]').closest('.projects-run-actions').textContent"),/Queued/);
  cancellation=true;
  await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!!document.querySelector('[data-run-action=discard_local]')");
  await devtools.evaluate("document.querySelector('[data-run-action=discard_local]').click()");
  assert.equal(actionKeys.length,2,"opening destructive confirmation never writes");
  assert.equal(await devtools.evaluate("document.activeElement.hasAttribute('data-run-confirm')"),true);
  await devtools.evaluate("document.querySelector('[data-run-confirm-panel] p').click();document.dispatchEvent(new Event('visibilitychange'))");
  assert.equal(actionKeys.length,2,"explanatory text is not a confirmation control");
  assert.equal(await devtools.evaluate("document.querySelector('[data-run-confirm-panel]').hidden"),false,"confirmation pauses background replacement");
  await devtools.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.equal(await devtools.evaluate("document.querySelector('[data-run-confirm-panel]').hidden"),true);
  assert.equal(actionKeys.length,2);
  await devtools.evaluate("document.querySelector('[data-run-action=discard_local]').click();document.querySelector('[data-run-confirm]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('queued in Kurami')");
  assert.equal(actionKeys.length,3);
  await audit();
  unavailable = true;
  await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('Refresh failed')");
  assert.equal(await devtools.evaluate("document.querySelector('.projects-table tbody').children.length"), 6, "failed refresh preserves the last snapshot");
  await audit();
} finally {
  await browser.close();
  await new Promise<void>(done => server.close(() => done()));
}
console.log("Projects browser: owner overview, task panel, focus, filters, search, failed refresh and mobile/dark accessibility verified");
