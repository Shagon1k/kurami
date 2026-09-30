import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createProjectsServer } from "../../src/projects-site/server.ts";
import { findBrowser, launchBrowser } from "../../src/ui-library/testing/devtools.ts";
import { AUDIT_EXPRESSION, inventoryExpression } from "../../src/ui-library/testing/audit.ts";
import { syntheticProjectsSnapshot } from "./fixture.ts";

let unavailable = false;
const server = createProjectsServer({ snapshot: () => { if (unavailable) throw new Error("fixture failure"); return syntheticProjectsSnapshot(); }, cacheMs: 0, authorize: async () => "fixture-owner" });
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
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
      await devtools.evaluate("document.querySelector('[data-item-link]').click()");
      await wait("!!document.querySelector('#project-details')");
      assert.equal(await devtools.evaluate("document.activeElement.id"), "project-details");
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
