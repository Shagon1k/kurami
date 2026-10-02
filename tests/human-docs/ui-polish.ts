import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {allPages} from "../../src/human-docs/content.ts";
import {sectionLabels} from "../../src/human-docs/content/site.ts";
import {renderArticle,renderChangelog,renderNotFound} from "../../src/human-docs/render.ts";
import {screenshotDimensions} from "../../src/human-docs/screenshot-dimensions.ts";
import {projectDocument} from "../../src/web/presentation.ts";

const owner=allPages.find(page=>page.slug==="owner-controls")!;
const reference=allPages.find(page=>page.slug==="data-stores")!;
assert.deepEqual(screenshotDimensions("shot-run-timeline.png"),{width:548,height:716});
assert.throws(()=>screenshotDimensions("../shot-run-timeline.png"),/Invalid screenshot file/);
const temporary=mkdtempSync(join(tmpdir(),"kurami-docs-png-test-"));
try {
  const assets=join(temporary,"src/human-docs/assets");mkdirSync(assets,{recursive:true});
  writeFileSync(join(assets,"shot-invalid.png"),"not a PNG");
  assert.throws(()=>screenshotDimensions("shot-invalid.png",temporary),/Invalid screenshot PNG/);
  assert.throws(()=>screenshotDimensions("shot-missing.png",temporary),/ENOENT/);
  const dimensions=Buffer.alloc(33);Buffer.from("89504e470d0a1a0a","hex").copy(dimensions);dimensions.writeUInt32BE(13,8);dimensions.write("IHDR",12);dimensions.writeUInt32BE(10001,16);dimensions.writeUInt32BE(20,20);
  writeFileSync(join(assets,"shot-invalid.png"),dimensions);
  assert.throws(()=>screenshotDimensions("shot-invalid.png",temporary),/Invalid screenshot dimensions/);
} finally {rmSync(temporary,{recursive:true,force:true});}
for(const lang of ["en","ru"] as const){
  const html=renderArticle(owner,lang).html;
  assert.match(html,/<img[^>]*shot-run-timeline\.png[^>]*width="548" height="716"[^>]*loading="lazy"/);
  assert.match(html,/<details class="disclosure disclosure--boxed disclosure--inline side-mobile"/);
  assert.ok(html.includes(`${sectionLabels[owner.section][lang]} · ${owner.navTitle[lang]}`));
  assert.ok(html.includes('class="side-mobile__list"'));
  assert.ok(html.includes('disclosure__chevron'));
  const referenceHtml=renderArticle(reference,lang).html;
  assert.ok(referenceHtml.includes('class="disclosure disclosure--boxed disclosure--inline toc-mobile"'),"two-section reference retains compact TOC");
  assert.ok(referenceHtml.includes('class="toc"'));
  assert.ok(referenceHtml.indexOf('toc-mobile')<referenceHtml.indexOf('<div class="prose">'));
  const sha="a".repeat(40),changelog=renderChangelog(lang,[],undefined,true,sha);
  assert.ok(changelog.includes('class="changelog-version"'));
  assert.ok(changelog.includes(`title="${sha}"`));
  assert.ok(!changelog.includes('/commit/'),"docs-only version does not fabricate application entries");
  assert.ok(!renderChangelog(lang,[],undefined,false,sha).includes('class="changelog-version"'),"preview does not claim a published docs version");
  const missing=renderNotFound(lang),mounted=projectDocument(missing,"docs",lang);
  assert.ok(missing.includes(lang==="en"?"Page not found":"Страница не найдена"));
  assert.ok(missing.includes(`href="/${lang}/"`));
  assert.ok(mounted.includes(`href="/${lang}/docs/"`));
  assert.ok(mounted.includes('href="/_apps/docs/assets/docs.css"'));
  assert.ok(!mounted.includes('href="https://docs.shagon1k.win'));
}
assert.throws(()=>renderChangelog("en",[],undefined,true,"not-a-version"),/Invalid documentation revision/);
console.log("Docs UI polish: reserved screenshots, compact TOC/menus, truthful version and native/mounted 404 shells verified");
