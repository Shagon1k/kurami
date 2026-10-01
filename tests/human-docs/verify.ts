import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,readdirSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {allPages,pages,homePage} from "../../src/human-docs/content.ts";
import {aliases,legacyRoutes,sections} from "../../src/human-docs/content/site.ts";
import {assertContent,walk,type HumanDocsPage} from "../../src/human-docs/content/schema.ts";
import {parseBlocks,renderInline,type Block} from "../../src/human-docs/markdown.ts";
import {renderDiagram,diagramSkeleton} from "../../src/human-docs/diagrams/kit.ts";
import {inlineDiagram} from "../../src/ui-library/foundations/diagram.ts";
import {changesForDeployedSha,readDeploymentManifest,assertDocsSourceMatchesDeployment,onlyDocsPackageScriptsChanged,onlyDocsWorkflowChanged} from "../../src/human-docs/changelog.ts";
import {renderAlias,renderArticle,renderChangelog,renderHome,resolveSlug} from "../../src/human-docs/render.ts";
import {DOCS_STYLES} from "../../src/human-docs/styles.ts";
import {assertSyntheticFixture,syntheticDailyHtml} from "../../src/human-docs/fixtures/synthetic-daily.ts";
import {evaluateDocsImpact} from "./impact.ts";
import {routeFor} from "../../src/human-docs/tools/verify-access.ts";

const releaseFixture=resolve("/tmp/kurami-docs-release-fixture");
for(const path of ["build.json","unified/en/index.html","unified/ru/access/index.html","unified/assets/docs.css"])assert.equal(routeFor(releaseFixture,join(releaseFixture,path)),undefined);
assert.equal(routeFor(releaseFixture,join(releaseFixture,"en/index.html")),"/en/");
assert.equal(routeFor(releaseFixture,join(releaseFixture,"ru/access/index.html")),"/ru/access/");
assert.equal(routeFor(releaseFixture,join(releaseFixture,"assets/docs.css")),"/assets/docs.css");

const productChange=["src/briefing/weekly/lifecycle.ts"];
assert.match(evaluateDocsImpact(productChange,"").join(" "),/Docs-Impact/);
assert.match(evaluateDocsImpact(productChange,"Docs-Impact: none\nDocs-Reason: moved code").join(" "),/specific/);
assert.deepEqual(evaluateDocsImpact(productChange,"Docs-Impact: none\nDocs-Reason: Pure module extraction with no intended change to Weekly behavior."),[]);
assert.match(evaluateDocsImpact(productChange,"Docs-Impact: updated\nChangelog-EN: Weekly retries failed counters.\nChangelog-RU: Weekly повторяет запись счётчиков.").join(" "),/digest/);
assert.deepEqual(evaluateDocsImpact([...productChange,"src/human-docs/content/pages/digest/weekly.ru.md"],"Docs-Impact: updated\nChangelog-EN: Weekly retries failed counters.\nChangelog-RU: Weekly повторяет запись счётчиков."),[]);
assert.match(evaluateDocsImpact(["src/orchestrator/runtime/controller.ts","src/briefing/weekly/lifecycle.ts","src/human-docs/content/pages/projects/run-lifecycle.en.md"],"Docs-Impact: updated\nChangelog-EN: Runs and Weekly changed.\nChangelog-RU: Изменены запуски и Weekly.").join(" "),/digest/);
assert.deepEqual(evaluateDocsImpact(["src/human-docs/styles.ts"],""),[]);
assert.deepEqual(evaluateDocsImpact([".github/workflows/regression.yml"],""),[]);
assert.equal(onlyDocsPackageScriptsChanged({scripts:{check:"tsc"}},{scripts:{check:"tsc","docs:preview":"node build.ts","test:docs:browser":"node browser.ts"}}),true);
assert.equal(onlyDocsPackageScriptsChanged({scripts:{"test:docs":"node old.ts",check:"tsc"}},{scripts:{"test:docs":"node new.ts",check:"tsc"}}),true);
assert.equal(onlyDocsPackageScriptsChanged({scripts:{"test:product":"node old.ts",check:"tsc"}},{scripts:{"test:product":"node new.ts",check:"tsc"}}),false);
assert.equal(onlyDocsPackageScriptsChanged({scripts:{check:"tsc"}},{scripts:{check:"tsc --noEmit","docs:preview":"node build.ts"}}),false);
assert.equal(onlyDocsPackageScriptsChanged({scripts:{check:"tsc"},dependencies:{foo:"1"}},{scripts:{check:"tsc"},dependencies:{foo:"2"}}),false);
const regressionWorkflow="      - run: npm ci\n      - run: npm test";
const withDocsGate="      - run: npm ci\n      - if: github.event_name == 'pull_request'\n        run: node tests/human-docs/impact.ts\n      - run: npm test";
assert.equal(onlyDocsWorkflowChanged(regressionWorkflow,withDocsGate),true);
assert.equal(onlyDocsWorkflowChanged(regressionWorkflow,withDocsGate.replace("npm test","npm run check")),false);

// Docs styles use theme roles: diagrams scroll inside their frame on phones, small accent labels use the AA accent-text role.
assert.match(DOCS_STYLES,/\.figure__scroll \{ overflow-x: auto;/);
assert.match(DOCS_STYLES,/:root \{[^}]*--text-accent: #c71410;/);
for(const lang of ["en","ru"] as const)for(const theme of ["light","dark"] as const){
  const fixture=syntheticDailyHtml(lang,theme);
  assert.doesNotThrow(()=>assertSyntheticFixture(fixture));
  assert.ok(fixture.includes(`lang="${lang}" data-theme="${theme}"`));
}
assert.throws(()=>assertSyntheticFixture('<html data-synthetic="true"><script src="https://example.org"></script></html>'),/network-isolated/);

// Markdown subset: strict, no raw HTML, nested blocks by fence length.
assert.throws(()=>parseBlocks("<div>x</div>","t"),/raw HTML/);
assert.throws(()=>parseBlocks("# Title","t"),/## to ####/);
assert.throws(()=>parseBlocks(":::note\nopen","t"),/unclosed/);
assert.throws(()=>parseBlocks("| a | b |\n|---|---|\n| 1 |","t"),/cells/);
const nested=parseBlocks("::::example T\n:::steps\n- **A** — one\n- **B** — two\n:::\n::::\n","t");
assert.equal(nested[0]!.type,"container");
assert.equal((nested[0] as Extract<Block,{type:"container"}>).body[0]!.type,"container");
const list=parseBlocks("- one\n  - nested\n- two","t")[0] as Extract<Block,{type:"list"}>;
assert.equal(list.items.length,2);
assert.equal(list.items[0]![1]!.type,"list");
assert.deepEqual(parseBlocks('::shot{file="shot-x.png" size="card" alt="A" caption="C"}',"t")[0],{type:"leaf",name:"shot",attrs:{file:"shot-x.png",size:"card",alt:"A",caption:"C"}});
const link=(target:string)=>({href:`/x/${target}`});
assert.equal(renderInline("a <b> **c** *d* `e<f>` [g](h)",link),'a &lt;b&gt; <strong>c</strong> <em>d</em> <code>e&lt;f&gt;</code> <a href="/x/h">g</a>');
assert.throws(()=>renderInline("**open",link),/Unbalanced/);

// Diagram kit: every engine renders inside the palette, too-wide pictures fail, EN/RU parity is by ids.
const graph=renderDiagram('kind: graph\ndesc: A small test graph with two nodes and a store.\nnode a "A" owner\nnode b "B" store\nnode c "C" fail\ngroup g "G" a b\nedge a -> b "writes"\nedge b -> c dashed');
const sequence=renderDiagram('kind: sequence\ndesc: Two actors exchange two messages for the test.\nactor a "A" owner\nactor b "B" external\nmsg a -> b "ask"\nself b "work"\nmsg b -> a "answer" accent');
const timeline=renderDiagram('kind: timeline\ndesc: A test day with one span and one point in a lane.\nlane l "Lane"\nspan l 06:00-07:00 "Build"\nat l 09:00 "Notify" accent\nevery l 60m "tick" from 00:30');
for(const diagram of [graph,sequence,timeline]){
  assert.doesNotThrow(()=>inlineDiagram(diagram.svg,{id:"t",label:"t"}),"diagram stays in the palette");
  assert.ok(diagram.width>0&&diagram.width<=980);
  assert.equal(JSON.parse(diagram.excalidraw).type,"excalidraw");
  assert.doesNotMatch(diagram.svg,/<script|\son[a-z]+=/);
}
assert.throws(()=>renderDiagram('kind: graph\ndesc: Nine wide nodes in one row must be rejected as too wide.\n'+Array.from({length:9},(_,i)=>`node n${i} "A rather long node label ${i}" at ${i},0`).join("\n")),/px wide/);
assert.throws(()=>renderDiagram('kind: graph\ndesc: short'),/desc/);
assert.throws(()=>renderDiagram('kind: graph\ndesc: An edge to a node that does not exist.\nnode a "A"\nedge a -> b'),/unknown node b/);
assert.equal(diagramSkeleton('kind: graph\ndesc: Same ids in both languages here.\nnode a "Ты"\nnode b "Б"'),diagramSkeleton('kind: graph\ndesc: Same ids in both languages here.\nnode b "B"\nnode a "You"'));

// Content: every page valid, structured the same in both languages, reachable from the menu.
const root=resolve(import.meta.dirname,"../..");
assert.doesNotThrow(()=>assertContent(allPages,root));
assert.ok(homePage,"home page exists");
assert.ok(pages.length>=60,`expected the layered site, found ${pages.length} pages`);
for(const section of sections){
  const start=pages.filter(page=>page.section===section&&page.group==="start");
  if(section!=="reference")assert.equal(start.length,1,`${section} has exactly one overview page`);
}
for(const route of legacyRoutes)assert.ok(resolveSlug(route),`published route ${route} still resolves`);
for(const [from,to] of Object.entries(aliases)){
  assert.ok(!pages.some(page=>page.slug===from),`alias ${from} does not shadow a page`);
  assert.ok(pages.some(page=>page.slug===to),`alias ${from} → ${to} exists`);
}
const count=(page:HumanDocsPage,lang:"en"|"ru",test:(block:Block)=>boolean)=>{let n=0;walk(page.blocks[lang],block=>{if(test(block))n++;});return n;};
const container=(name:string)=>(block:Block)=>block.type==="container"&&block.name===name;
const diagram=(block:Block)=>block.type==="code"&&block.lang==="diagram";
for(const page of pages)for(const lang of ["en","ru"] as const){
  if(page.group==="internals"){
    assert.equal(count(page,lang,container("glance")),1,`${page.slug}/${lang}: an internals page starts with one glance block`);
    assert.ok(count(page,lang,diagram)>=1,`${page.slug}/${lang}: an internals page has a diagram`);
    assert.equal(count(page,lang,container("code-map")),1,`${page.slug}/${lang}: an internals page ends with a code map`);
  }
  if(page.group==="start"){
    assert.equal(count(page,lang,container("glance")),1,`${page.slug}/${lang}: an overview has a glance block`);
    assert.ok(count(page,lang,diagram)>=1,`${page.slug}/${lang}: an overview has a diagram`);
    assert.ok(count(page,lang,container("cards"))>=1,`${page.slug}/${lang}: an overview links deeper`);
  }
  assert.ok(count(page,lang,container("guarantees"))<=1,`${page.slug}/${lang}: guarantees appear once at most`);
  assert.ok(count(page,lang,block=>block.type==="leaf"&&block.name==="shot")<=2,`${page.slug}/${lang}: at most two screenshots`);
  if(page.group!=="guide")assert.equal(count(page,lang,block=>block.type==="leaf"&&block.name==="shot"),0,`${page.slug}/${lang}: screenshots belong to guide pages`);
}
// Privacy: no personal names, home paths, places or long numeric identifiers in reader copy.
for(const file of readdirSync(resolve(root,"src/human-docs/content/pages"),{recursive:true,encoding:"utf8"}).filter(file=>file.endsWith(".md"))){
  const text=readFileSync(resolve(root,"src/human-docs/content/pages",file),"utf8");
  assert.doesNotMatch(text,/\bAlex\b|Л[её]ш[а-яё]*|Vilnius|Вильнюс|\/home\/|ahurynovich|\b\d{15,20}\b|Схема поведения, не реальный API|Conceptual rule, not a callable API/i,`${file} contains private or placeholder copy`);
}
const validRoutes=new Set(["/en/","/ru/","/en/changelog/","/ru/changelog/",...[...pages.map(page=>page.slug),...Object.keys(aliases)].flatMap(slug=>[`/en/${slug}/`,`/ru/${slug}/`])]);
const assertInternalLinks=(html:string,where:string)=>{
  for(const match of html.matchAll(/<a [^>]*href="([^"]+)"/g))if(match[1]!.startsWith("/")&&!match[1]!.startsWith("/assets/"))assert.ok(validRoutes.has(match[1]!.replace(/#.*$/,"")),`Unknown internal docs route ${match[1]} in ${where}`);
  assert.doesNotMatch(html,/href="#missing-/,`${where} links to a page that does not exist`);
};
for(const page of pages)for(const lang of ["en","ru"] as const){
  const {html}=renderArticle(page,lang,{root});
  assert.match(html,new RegExp(`<html lang="${lang}"`));
  assert.ok(html.includes(`href="/${lang==="en"?"ru":"en"}/${page.slug}/"`),`${page.slug}/${lang} links its translation`);
  assert.ok(html.includes(`class="eyebrow page-eyebrow"`)&&/\d+ (min read|мин чтения)/.test(html),`${page.slug}/${lang} shows its depth and reading time`);
  assertInternalLinks(html,`${page.slug}/${lang}`);
  const sidebar=html.match(/<nav class="side"[^>]*>([\s\S]*?)<\/nav>/)?.[1]??"";
  for(const other of pages.filter(other=>other.section!==page.section))assert.ok(!sidebar.includes(`href="/${lang}/${other.slug}/"`),`${page.slug}: side menu shows only its own section`);
}
for(const lang of ["en","ru"] as const){
  const {html}=renderHome(lang,{root});
  assertInternalLinks(html,`home/${lang}`);
  assert.ok(html.includes("/assets/theme.js")&&html.includes('class="site-nav"')&&html.includes('data-theme-toggle'));
  assert.ok(html.includes('class="site-switcher"')&&html.includes(`href="https://kurami.shagon1k.win/${lang}/"`),"the header links the unified Kurami apps");
  assert.ok(html.includes(`href="https://kurami.shagon1k.win/${lang}/docs/" aria-current="location"`),"the switcher marks docs as current");
  assert.ok(html.includes('id="main" class="container page" tabindex="-1"'));
  for(const [from,to] of Object.entries(aliases)){
    const alias=renderAlias(lang,from,to);
    assert.ok(alias.includes(`<meta http-equiv="refresh" content="0; url=/${lang}/${to}/">`),`alias ${from} redirects`);
  }
  const emptyChangelog=renderChangelog(lang,[]);
  assert.ok(!emptyChangelog.includes("github.com/Shagon1k/kurami/commit/"));
  assert.ok(emptyChangelog.includes(lang==="ru"?"намеренно оставляет changelog приложения пустым":"deliberately leaves the application changelog empty"));
  const previewStatus=lang==="ru"?"Версия развёртывания не указана":"No deployment revision was supplied";
  const changelogArticle=emptyChangelog.slice(emptyChangelog.indexOf("<article"),emptyChangelog.indexOf("</article>"));
  assert.equal(changelogArticle.split(previewStatus).length-1,1);
  assertInternalLinks(emptyChangelog,`changelog/${lang}`);
}
const slugs={has:(slug:string)=>Boolean(resolveSlug(slug))};
const scratch=mkdtempSync(join(tmpdir(),"kurami-docs-test-"));
try {
  const manifest=join(scratch,"deployment.json");
  const sha=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  writeFileSync(manifest,JSON.stringify({status:"succeeded",appSha:sha}));
  assert.equal(readDeploymentManifest(manifest),sha);
  if(execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim())assert.throws(()=>assertDocsSourceMatchesDeployment(sha),/clean working tree/);
  writeFileSync(manifest,JSON.stringify({status:"failed",appSha:sha}));
  assert.throws(()=>readDeploymentManifest(manifest),/status=succeeded/);
  assert.throws(()=>changesForDeployedSha("596c877","en"),/40-character/);
  const changes=changesForDeployedSha("596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26","en");
  assert.equal(changes.length,3);
  assert.ok(changes.every(c=>slugs.has(c.page!)));
  const publishedDocsChanges=changesForDeployedSha("095b03fb0f40bf39b914fef13dfec4c1b8348f7b","en");
  assert.equal(publishedDocsChanges.length,7);
  assert.ok(publishedDocsChanges.some(c=>c.sha==="847a7248193d708f07886b02d4e397995624c75b"&&c.category==="new"));
  assert.ok(publishedDocsChanges.every(c=>!c.page||slugs.has(c.page)));
  const classifiedThroughHandoff=changesForDeployedSha("f06f8eb0c5c9857f8d0dd0fa14c172a215c04304","en");
  assert.equal(classifiedThroughHandoff.length,7);
  assert.ok(classifiedThroughHandoff.every(c=>c.sha!=="f06f8eb0c5c9857f8d0dd0fa14c172a215c04304"));
  const classifiedThroughAudit=changesForDeployedSha("6ae670a12f7224a4386677ef5dac8c2e07793b3f","en");
  const classifiedThroughAuditRu=changesForDeployedSha("6ae670a12f7224a4386677ef5dac8c2e07793b3f","ru");
  assert.equal(classifiedThroughAudit.length,15);
  assert.equal(classifiedThroughAuditRu.length,15);
  assert.deepEqual(classifiedThroughAudit.map(change=>change.sha),classifiedThroughAuditRu.map(change=>change.sha));
  assert.ok(classifiedThroughAudit.some(change=>change.sha==="94cfd0091a78ec6712f3e0794ceb4a21c2a03fbf"&&change.page==="weekly"));
  assert.ok(classifiedThroughAudit.every(change=>!change.page||slugs.has(change.page)));
  assert.ok(renderChangelog("en",publishedDocsChanges,"095b03fb0f40bf39b914fef13dfec4c1b8348f7b").includes("private bilingual Kurami documentation site"));
  assert.ok(renderChangelog("en",publishedDocsChanges,"095b03fb0f40bf39b914fef13dfec4c1b8348f7b").includes("List dates are commit days, not deployment days."));
  assert.ok(renderChangelog("ru",changesForDeployedSha("095b03fb0f40bf39b914fef13dfec4c1b8348f7b","ru"),"095b03fb0f40bf39b914fef13dfec4c1b8348f7b").includes("двуязычный сайт документации"));
  assert.ok(renderChangelog("ru",changesForDeployedSha("095b03fb0f40bf39b914fef13dfec4c1b8348f7b","ru"),"095b03fb0f40bf39b914fef13dfec4c1b8348f7b").includes("Даты в списке — дни коммитов, не дни развёртывания."));
  assert.ok(renderChangelog("en",changes,"596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26").includes("review stage requires"));
  assert.ok(renderChangelog("ru",changesForDeployedSha("596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26","ru"),"596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26").includes("Изменения подтверждены"));
  assert.ok(renderChangelog("en",[],undefined,true).includes("Docs are published; no verified application deployment"));
  assert.ok(renderChangelog("ru",[],undefined,true).includes("Документация опубликована"));
  const built=resolve(root,"dist/human-docs");
  if(existsSync(built)) {
    assert.ok(!existsSync(join(built,"index.html")),"Root must redirect on the origin, not render a choice page");
    const metadata=JSON.parse(readFileSync(join(built,"build.json"),"utf8")) as {mode:string;revision:string|null;docsSha?:string|null};
    assert.ok(["preview","release"].includes(metadata.mode));
    if(metadata.mode==="preview") assert.ok(metadata.docsSha==null);
    else assert.match(metadata.docsSha??"",/^[0-9a-f]{40}$/);
    if(!metadata.revision)assert.ok(!readFileSync(join(built,"en/changelog/index.html"),"utf8").includes("review stage requires"));
  }
} finally {rmSync(scratch,{recursive:true,force:true});}
console.log(`Verified ${pages.length} bilingual docs pages, Markdown subset, diagram kit, legacy routes, privacy and curated release gate`);
