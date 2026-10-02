import assert from "node:assert/strict";
import {findBrowser,launchBrowser} from "../../src/ui-library/testing/devtools.ts";
import {AUDIT_EXPRESSION,CONTRAST_REVIEW_EXPRESSION} from "../../src/ui-library/testing/audit.ts";
import {checkImageBackedContrast} from "../../src/ui-library/testing/contrast-pixels.ts";

const {devtools,close}=await launchBrowser(findBrowser());
try {
  await devtools.call("Emulation.setDeviceMetricsOverride",{width:390,height:900,deviceScaleFactor:1,mobile:true});
  await devtools.evaluate(`document.documentElement.innerHTML='<head><style>body{background:white;color:black}.gradient{background:linear-gradient(120deg,#111,#531510);color:white;padding:20px}.solid{background:white;color:#aaa}.covered{background:white;color:black}</style></head><body><p class="solid">Low solid contrast</p><div class="gradient"><p>Gradient text</p><p class="covered">Opaque child</p></div></body>'`);
  const issues=await devtools.evaluate<string[]>(AUDIT_EXPRESSION);
  assert.equal(issues.filter(issue=>issue.startsWith("Low text contrast")).length,1,"solid contrast failures remain failures");
  const pending=await devtools.evaluate<Array<{element:string}>>(CONTRAST_REVIEW_EXPRESSION);
  assert.equal(pending.length,1,"opaque child is measured against its own surface, not the gradient");
  const pixels=await checkImageBackedContrast(devtools);
  assert.equal(pixels[0]!.status,"pixel-bound-passed");
  assert(pixels[0]!.minimum!>4.5,"real gradient background has adequate contrast");
  assert.equal(await devtools.evaluate("document.querySelector('.gradient p').style.cssText"),"","pixel sampling restores inline styles");
  await devtools.evaluate("document.querySelector('.gradient').style.background='linear-gradient(120deg,#fff,#ddd)'");
  await devtools.evaluate(AUDIT_EXPRESSION);
  assert.equal((await checkImageBackedContrast(devtools))[0]!.status,"manual-review-required","a light gradient is not certified by deferral");
  console.log("Contrast audit: solid failures, gradient pixel bounds, opaque children, manual-review separation and style restoration verified");
} finally {await close();}
