import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {THEME_RUNTIME_JS} from "../../src/ui-library/runtime/theme.ts";
import {syntheticCharts} from "../../src/ui-library/testing/charts.ts";
import {findBrowser,launchBrowser} from "../../src/ui-library/testing/devtools.ts";
import {AUDIT_EXPRESSION,inventoryExpression} from "../../src/ui-library/testing/audit.ts";

const root=resolve(import.meta.dirname,"../..");
const output=resolve(root,"dist/charts-browser");mkdirSync(output,{recursive:true});
const server=createServer((request,response)=>{
  const path=new URL(request.url??"/","http://localhost").pathname;
  if(path==="/assets/theme.js"){response.writeHead(200,{"content-type":"text/javascript"}).end(THEME_RUNTIME_JS);return;}
  if(path.startsWith("/assets/")) {
    const name=path.slice(8);
    if(!/^[\w.-]+$/.test(name)){response.writeHead(404).end();return;}
    const directory=name.endsWith(".woff2")?"fonts":"brand";
    try {const body=readFileSync(resolve(root,"src/ui-library/assets",directory,name));response.writeHead(200,{"content-type":name.endsWith(".woff2")?"font/woff2":"image/webp"}).end(body);}catch {response.writeHead(404).end();}
    return;
  }
  response.writeHead(200,{"content-type":"text/html; charset=utf-8"}).end(syntheticCharts(path==="/en/"?"en":"ru"));
});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const port=(server.address() as {port:number}).port;
const {devtools,close}=await launchBrowser(findBrowser());
async function wait(expression:string){for(let attempt=0;attempt<100;attempt++){if(await devtools.evaluate<boolean>(expression))return;await delay(50);}throw new Error("Timed out: "+expression);}
try {
  for(const lang of ["ru","en"])for(const width of [320,390,1280])for(const theme of ["light","dark"]) {
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await devtools.call("Page.navigate",{url:`http://127.0.0.1:${port}/${lang}/`});
    await wait("document.readyState==='complete' && document.querySelectorAll('[data-chart-mounted]').length===5");
    await devtools.evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}||document.querySelector('[data-theme-toggle]').click()`);
    await devtools.evaluate("document.fonts.ready");
    assert.equal(await devtools.evaluate("document.documentElement.dataset.theme"),theme);
    await delay(100);
    assert.deepEqual(await devtools.evaluate(AUDIT_EXPRESSION),[],`${lang}/${width}/${theme}`);
    assert.deepEqual(await devtools.evaluate(inventoryExpression()),[]);
    assert.equal(await devtools.evaluate("(()=>{const plot=document.querySelector('#showcase-compact-title').closest('[data-chart]').querySelector('[data-chart-plot]');return Math.abs(plot.querySelector('svg').viewBox.baseVal.width-plot.clientWidth)<1})()"),true,"embedded geometry fits its parent");
    if(width===1280&&lang==="ru") {
      const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
      writeFileSync(resolve(output,`charts-${theme}.png`),Buffer.from(shot.data,"base64"));
      const clip=await devtools.evaluate("(()=>{const a=document.querySelector('#showcase-trend-title').closest('[data-chart]').getBoundingClientRect(),b=document.querySelector('#showcase-bars-title').closest('[data-chart]').getBoundingClientRect();return {x:a.x+scrollX,y:a.y+scrollY,width:a.width,height:b.bottom-a.top,scale:1}})()");
      const preview=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,clip});
      writeFileSync(resolve(output,`charts-${theme}-preview.png`),Buffer.from(preview.data,"base64"));
    }
    await devtools.evaluate("document.querySelector('#showcase-trend-title').closest('[data-chart]').querySelector('[data-chart-point]').focus()");
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-trend-tooltip').hidden"),false);
    await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",key:"ArrowRight",code:"ArrowRight"});
    assert.equal(await devtools.evaluate("document.activeElement.dataset.chartIndex"),"1");
    await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",key:"ArrowDown",code:"ArrowDown"});
    assert.equal(await devtools.evaluate("document.activeElement.dataset.chartSeries"),"1");
    await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape"});
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-trend-tooltip').hidden"),true);
    await devtools.evaluate("const r=document.querySelector('#showcase-trend-title').closest('[data-chart]');r.querySelector('[data-chart-zoom-in]').click();r.querySelector('[data-chart-key]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-trend-title').closest('[data-chart]').querySelector('[data-chart-window]').textContent"),"6 / 7");
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-trend-title').closest('[data-chart]').querySelector('[data-chart-series=\"0\"]')"),null);
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-bars-title').closest('[data-chart]').querySelector('[data-chart-window]').textContent"),"7 / 7","chart state stays local");
    await devtools.evaluate("document.querySelector('#showcase-trend-title').closest('[data-chart]').querySelectorAll('[data-chart-key][aria-pressed=true]').forEach(b=>b.click())");
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-trend-title').closest('[data-chart]').querySelector('[data-chart-empty]').hidden"),false);
    await devtools.evaluate("document.querySelector('#showcase-trend-title').closest('[data-chart]').querySelector('[data-chart-key]').click()");
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-trend-title').closest('[data-chart]').querySelector('[data-chart-empty]').hidden"),true);
    await devtools.evaluate("document.querySelector('#showcase-bars-title').closest('[data-chart]').dispatchEvent(new CustomEvent('kurami:chart-update',{detail:{values:[[1,null,0,-2,5,6,7]]}}))");
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-bars-title').closest('[data-chart]').querySelectorAll('[data-chart-point]').length"),6);
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-bars-title').closest('[data-chart]').querySelector('tbody tr:nth-child(2) td').textContent"),"—");
    await devtools.evaluate("document.querySelector('#showcase-bars-title').closest('[data-chart]').dispatchEvent(new CustomEvent('kurami:chart-update',{detail:{values:[[NaN]]}}))");
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-bars-title').closest('[data-chart]').querySelectorAll('[data-chart-point]').length"),6,"invalid update preserves prior chart");
    const before=await devtools.evaluate("document.querySelector('#showcase-bars-title').closest('[data-chart]').querySelector('svg').outerHTML");
    await devtools.evaluate("document.dispatchEvent(new Event('kurami:charts-mount'))");
    assert.equal(await devtools.evaluate("document.querySelector('#showcase-bars-title').closest('[data-chart]').querySelector('svg').outerHTML"),before,"mounting twice preserves state");
  }
  await devtools.call("Emulation.setScriptExecutionDisabled",{value:true});
  await devtools.call("Page.navigate",{url:`http://127.0.0.1:${port}/ru/`});
  await delay(200);
  await devtools.call("Emulation.setScriptExecutionDisabled",{value:false});
  assert.equal(await devtools.evaluate("document.querySelectorAll('[data-chart-mounted]').length"),0);
  assert.equal(await devtools.evaluate("document.querySelectorAll('[data-chart-point]').length>0"),true,"server-rendered charts work without scripts");
  assert.equal(await devtools.evaluate("document.querySelector('#showcase-bars-title').closest('[data-chart]').querySelectorAll('tbody tr').length"),7);
  console.log(JSON.stringify({ok:true,combinations:12,verified:"themes, mobile, keyboard, legend, zoom, updates, tables, no-JS",screenshots:output}));
} finally {await close();await new Promise<void>(done=>server.close(()=>done()));}
