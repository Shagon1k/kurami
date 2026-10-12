import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createProjectsServer } from "../../src/projects-site/server.ts";
import { findBrowser, launchBrowser } from "../../src/ui-library/testing/devtools.ts";
import { AUDIT_EXPRESSION, inventoryExpression } from "../../src/ui-library/testing/audit.ts";
import { syntheticStoppedWriterSnapshot } from "./fixture.ts";

let report: string | null=null;
let writes=0;
const server=createProjectsServer({snapshot:()=>syntheticStoppedWriterSnapshot(report),cacheMs:0,authorize:async()=>"fixture-owner",origin:"",
  runAction:()=>{writes++;throw new Error("This browser fixture must not request an action");}});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const address=server.address();assert.ok(address&&typeof address==="object");
const base=`http://127.0.0.1:${address.port}`;
const browser=await launchBrowser(findBrowser()),{devtools}=browser;
const out=resolve(import.meta.dirname,"../../dist/projects-writer-stop");mkdirSync(out,{recursive:true});
async function wait(expression:string){
  for(let i=0;i<100;i++){if(await devtools.evaluate<boolean>(expression))return;await delay(50);}
  throw new Error(`Timed out: ${expression}`);
}
try{
  await devtools.call("Page.enable");
  for(const width of [320,390,1280])for(const lang of ["en","ru"])for(const theme of ["paper","neon"]){
    report=null;
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await devtools.call("Page.navigate",{url:`${base}/?item=item-12&lang=${lang}`});
    await wait("document.readyState==='complete'&&!!document.querySelector('.projects-writer-stop')");
    await devtools.evaluate("document.fonts.ready");
    await devtools.evaluate(`document.querySelector('[data-theme-choice="${theme}"]').click();document.querySelector('[data-mode-choice="${theme==="neon"?"dark":"light"}"]').click();document.querySelector('[data-theme-panel]')?.hidePopover()`);
    await delay(250);
    const view=await devtools.evaluate<{label:string;href:string;text:string;collapsed:boolean;fits:boolean;noReviews:boolean}>(`(()=>{
      const panel=document.querySelector('#project-details'),link=panel.querySelector('[data-codex-session]'),details=panel.querySelector('details[data-disclosure-key^="writer-stop:"]'),box=link.getBoundingClientRect();
      return{geometry:{width:box.width,height:box.height,left:box.left,right:box.right,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth},label:link.textContent.trim(),href:link.href,text:panel.innerText,collapsed:!details.open,fits:box.width>=44&&box.height>=44&&box.left>=0&&box.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth,noReviews:!panel.querySelector('[data-review-result], [data-review-run]')};
    })()`);
    assert.equal(view.label,lang==="ru"?"Открыть сессию Codex":"Open Codex session");
    assert.equal(view.href,"https://go.shagon1k.win/codex/threads/00000001-0000-4000-8000-000000000001");
    assert.ok(view.collapsed&&view.fits&&view.noReviews,JSON.stringify(view));
    assert.doesNotMatch(view.text,/https:\/\/go\.|Writer final summary unavailable|Unverified|Не подтверждено/);
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[]);
    assert.deepEqual(await devtools.evaluate(inventoryExpression()),[]);
    const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    writeFileSync(resolve(out,`writer-stop-${width}-${lang}-${theme}.png`),Buffer.from(shot.data,"base64"));
    await devtools.evaluate("document.querySelector('details[data-disclosure-key^=\"writer-stop:\"] summary').click()");
    assert.equal(await devtools.evaluate("document.querySelector('details[data-disclosure-key^=\"writer-stop:\"]').open"),true);
    assert.equal(writes,0,"Opening diagnostics cannot hand off or restart work");
  }
  report="Writer report (not delivery proof): "+"Controlled fixture diagnostic. ".repeat(20)+"No commit or PR was created.";
  await devtools.call("Page.navigate",{url:`${base}/?item=item-12`});
  await wait("document.readyState==='complete'&&!!document.querySelector('.projects-writer-report')");
  assert.equal(await devtools.evaluate("document.querySelector('.projects-writer-report').textContent"),report);
  console.log(JSON.stringify({ok:true,viewports:3,languages:2,themes:2,namedSessionLink:true,collapsedDiagnostics:true,noPhantomChecks:true,actionWrites:writes,screenshots:out}));
}finally{
  await browser.close();
  await new Promise<void>(done=>server.close(()=>done()));
}
