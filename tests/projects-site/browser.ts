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
    await open("/");
    for (const theme of ["light", "dark"]) {
      await devtools.evaluate(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('[data-theme-toggle]').click()`);
      await delay(250);
      await audit();
      if (width === 1280 && theme === "light") {
        const shot = await devtools.call<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        writeFileSync(resolve(out, "projects-overview.png"), Buffer.from(shot.data,"base64"));
      }
      await devtools.evaluate("document.querySelector('[data-item-link]').click()");
      await wait("!!document.querySelector('#project-details')");
      assert.equal(await devtools.evaluate("document.activeElement.id"), "project-details");
      await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
      await wait("!document.querySelector('[data-projects-refresh]').hasAttribute('aria-busy')");
      assert.equal(await devtools.evaluate("document.activeElement.id"), "project-details", "background refresh preserves panel focus");
      await devtools.evaluate("document.querySelector('.projects-run-actions').open=true");
      await audit();
      if (width === 1280 && theme === "light") {
        await devtools.evaluate("scrollTo(0,0)");
        const shot = await devtools.call<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        writeFileSync(resolve(out, "projects-desktop.png"), Buffer.from(shot.data, "base64"));
      }
      if (width === 390 && theme === "dark") {
        await devtools.evaluate("scrollTo(0,0)");
        const shot = await devtools.call<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        writeFileSync(resolve(out, "projects-mobile.png"), Buffer.from(shot.data, "base64"));
      }
      await devtools.evaluate("document.querySelector('[data-item-close]').click()");
      await wait("!document.querySelector('#project-details')");
    }
  }
  await devtools.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await open("/");
  await devtools.evaluate("const search=document.querySelector('input[name=q]');search.value='ПоИСКа';search.dispatchEvent(new Event('input'))");
  assert.equal(await devtools.evaluate("document.querySelector('[data-visible-count]').textContent"), "1");
  await devtools.evaluate("document.querySelector('[data-projects-refresh]').click()");
  await wait("!document.querySelector('[data-projects-refresh]').hasAttribute('aria-busy')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-visible-count]').textContent"), "1", "refresh preserves search");
  await open("/?project=beta&view=attention");
  assert.equal(await devtools.evaluate("document.querySelector('.projects-table tbody').children.length"), 1);
  await open("/?project=unknown");
  assert.match(await devtools.evaluate<string>("document.querySelector('#projects-dashboard').textContent"), /Подходящих задач нет/);
  await open("/");
  await devtools.evaluate("document.querySelector('[data-item-link]').click()");
  await wait("!!document.querySelector('[data-review-run]')");
  failReview = true;
  await devtools.evaluate("document.querySelector('[data-review-run]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('недоступно')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-review-run]').disabled"),false);
  failReview = false;
  await devtools.evaluate("document.querySelector('[data-review-run]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('поставлено в очередь')");
  assert.equal(requestKeys.length,2); assert.equal(requestKeys[0],requestKeys[1],"retry retains its durable request identity");
  assert.equal(await devtools.evaluate("document.querySelector('[data-review-run]').disabled"),true);
  assert.match(await devtools.evaluate<string>("document.querySelector('#project-details').textContent"),/В очереди/);
  await audit();
  await devtools.evaluate("const field=document.querySelector('[data-status-form] select');field.value='Done';field.dispatchEvent(new Event('change',{bubbles:true}));field.focus()");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-submit]').disabled"),false);
  assert.match(await devtools.evaluate<string>("document.querySelector('[data-status-note]').textContent"),/условия завершения/);
  await devtools.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await wait("!document.querySelector('[data-projects-refresh]').hasAttribute('aria-busy')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').value"),"Done","background refresh preserves unsent status choice");
  assert.equal(await devtools.evaluate("document.activeElement.name"),"target");
  statusConflict = true;
  await devtools.evaluate("document.querySelector('[data-status-submit]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('Статус изменился')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').value"),"Done");
  statusConflict = false;
  await devtools.evaluate("document.querySelector('[data-status-submit]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('Ждём синхронизации')");
  assert.equal(statusKeys.length,2);
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').disabled"),true);
  assert.match(await devtools.evaluate<string>("document.querySelector('.projects-table tbody tr').textContent"),/Human Review/);
  await audit();
  statusSynced = true;
  await devtools.evaluate("document.querySelector('[data-projects-refresh]').click()");
  await wait("!document.querySelector('[data-projects-refresh]').hasAttribute('aria-busy')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').value"),"Done");
  assert.equal(await devtools.evaluate("document.querySelector('[data-status-form] select').disabled"),false);
  assert.match(await devtools.evaluate<string>("document.querySelector('.projects-table tbody tr').textContent"),/Done/);
  await devtools.evaluate("document.querySelector('.projects-run-actions').open=true");
  failAction=true;
  await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('Действие временно недоступно')");
  assert.equal(await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').disabled"),false);
  failAction=false;
  await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('поставлено в очередь Kurami')");
  assert.equal(actionKeys.length,2);
  assert.equal(await devtools.evaluate("document.querySelector('[data-run-action=preview_start]').disabled"),true);
  assert.match(await devtools.evaluate<string>("document.querySelector('.projects-run-actions').textContent"),/В очереди/);
  cancellation=true;
  await devtools.evaluate("document.querySelector('[data-projects-refresh]').click()");
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
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('поставлено в очередь Kurami')");
  assert.equal(actionKeys.length,3);
  await audit();
  unavailable = true;
  await devtools.evaluate("document.querySelector('[data-projects-refresh]').click()");
  await wait("document.querySelector('[data-refresh-status]').textContent.includes('Не удалось')");
  assert.equal(await devtools.evaluate("document.querySelector('.projects-table tbody').children.length"), 5, "failed refresh preserves the last snapshot");
  await audit();
} finally {
  await browser.close();
  await new Promise<void>(done => server.close(() => done()));
}
console.log("Projects browser: owner overview, task panel, focus, filters, search, failed refresh and mobile/dark accessibility verified");
