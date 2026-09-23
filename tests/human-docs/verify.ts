import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {pages} from "../../src/human-docs/content.ts";
import {changesForDeployedSha,readDeploymentManifest,assertDocsSourceMatchesDeployment} from "../../src/human-docs/changelog.ts";
import {renderArticle,renderChangelog,renderHome} from "../../src/human-docs/render.ts";
import {DOCS_STYLES} from "../../src/human-docs/styles.ts";

// Keep diagram connectors between cards and reserve space below prose maps.
assert.match(DOCS_STYLES,/\.architecture-map__path \{[^}]*gap: 24px/);
assert.match(DOCS_STYLES,/\.block \.system-map \{ margin-bottom: 24px; \}/);
// Small labels on the light section background need the docs-specific AA text color.
assert.match(DOCS_STYLES,/:root \{ --docs-signal-text: #c71410; \}/);

const root=resolve(import.meta.dirname,"../..");
assert.equal(pages.length,17);
const slugs=new Set(pages.map(p=>p.slug));
assert.equal(slugs.size,pages.length);
const validRoutes=new Set(["/en/","/ru/","/en/changelog/","/ru/changelog/",...pages.flatMap(page=>[`/en/${page.slug}/`,`/ru/${page.slug}/`])]);
const assertInternalLinks=(html:string)=>{
  for(const match of html.matchAll(/<a [^>]*href="([^"]+)"/g)){
    if(match[1].startsWith("/"))assert.ok(validRoutes.has(match[1]),`Unknown internal docs route: ${match[1]}`);
  }
};
for(const page of pages){
  for(const lang of ["en","ru"] as const){
    assert.ok(page.title[lang]&&page.navTitle?.[lang]&&page.summary[lang]&&page.blocks.every(block=>block[lang]));
    assert.doesNotMatch(JSON.stringify({title:page.title[lang],navTitle:page.navTitle[lang],summary:page.summary[lang],blocks:page.blocks.map(b=>b[lang])}),/\bAlex\b|Л[её]ш[а-яё]*|09:00|10:00|Вильнюс|Vilnius|Схема поведения, не реальный API|Conceptual rule, not a callable API/i);
    const html=renderArticle(page,lang);
    assert.match(html,new RegExp(`<html lang="${lang}"`));
    assert.ok(html.includes(`/${lang}/${page.slug}/`));
    assert.ok(html.includes(`/${lang==="en"?"ru":"en"}/${page.slug}/`));
    assert.ok(!html.includes("data-visual="),`Unrendered visual in ${page.slug}`);
    assert.equal((html.match(/<figure class=/g)??[]).length+(html.match(/<div class="visual">/g)??[]).length,1,`${page.slug}/${lang} must have one purposeful visual`);
    assertInternalLinks(html);
    if(page.slug==="daily-lifecycle"||page.slug==="project-orchestrator"){
      assert.match(html,/<figure class="architecture-map">[\s\S]*?<ol class="architecture-map__path">/);
      assert.equal((html.match(/class="architecture-map__outcomes"/g)??[]).length,1);
      assert.ok(html.includes(page.slug==="daily-lifecycle"?"docs/daily-briefing-runtime.md":"docs/technical-reference.md"));
      assert.ok(html.includes(page.slug==="daily-lifecycle"?(lang==="ru"?"Обновляемые поля":"Refreshable fields"):(lang==="ru"?"Безопасная остановка":"Safe stop")));
    }
    if(page.slug==="who-does-what"){
      assert.match(html,/<figure class="roles-map">/);
      assert.equal((html.match(/class="roles-map__card"/g)??[]).length,3);
      for(const role of ["Hermes",lang==="ru"?"Курами":"Kurami","Codex"])assert.ok(html.includes(role));
    }
    if(page.slug==="reading-state"){
      assert.match(html,/<figure class="state-legend">/);
      assert.equal((html.match(/<dt>/g)??[]).length,6);
      assert.ok(html.includes(lang==="ru"?"Ждёт владельца":"Awaiting owner"));
    }
    if(page.slug==="what-is-kurami"||page.slug==="system-map"){
      assert.match(html,/<figure class="system-map">/);
      assert.equal((html.match(/class="system-map__path"/g)??[]).length,2);
      assert.equal((html.match(/class="system-map__products"/g)??[]).length,1);
      assert.ok(html.includes(lang==="ru"?"Решение владельца":"Owner decision"));
    }
    if(page.slug==="daily"||page.slug==="weekly-cinema"||page.slug==="stocks-review"){
      assert.match(html,/<figure class="comparison-map">/);
      assert.equal((html.match(/class="comparison-map__card"/g)??[]).length,2);
    }
    if(page.slug==="for-me"){
      assert.match(html,/<figure class="order-map">/);
      assert.equal((html.match(/class="order-map__column"/g)??[]).length,2);
      assert.ok(html.includes(lang==="ru"?"десяти активных реакций":"ten active reactions"));
    }
    if(page.slug==="project-admission"){
      assert.match(html,/<figure class="admission-map">/);
      assert.equal((html.match(/class="admission-map__status"/g)??[]).length,1);
      assert.equal((html.match(/class="admission-map__gates"/g)??[]).length,1);
      for(const status of ["PASS","WARN","FAIL"])assert.ok(html.includes(status));
      assert.equal((html.match(/<li><span class="folio">0[1-4]<\/span>/g)??[]).length,4);
    }
    if(page.slug==="run-lifecycle"){
      assert.equal((html.match(/class="flow__step"/g)??[]).length,6);
      assert.ok(html.includes(lang==="ru"?"Только после точного доказательства очистки":"Only after exact cleanup proof"));
    }
    if(page.slug==="engineering-evidence"){
      assert.match(html,/<figure class="project-cards">/);
      assert.equal((html.match(/class="project-cards__card"/g)??[]).length,3);
      assert.ok(html.includes(lang==="ru"?"Не является deploy":"Is not a deployment"));
    }
    if(page.slug==="owner-controls"){
      assert.match(html,/<figure class="project-cards controls-map">/);
      assert.equal((html.match(/class="project-cards__card"/g)??[]).length,4);
      assert.ok(html.includes(lang==="ru"?"Нажатие создаёт проверяемое намерение":"A click records verifiable intent"));
    }
    if(page.slug==="health"){
      assert.match(html,/<figure class="health-map">/);
      assert.equal((html.match(/<li><span class="folio">0[1-3]<\/span>/g)??[]).length,3);
      assert.equal((html.match(/class="health-map__outcomes"/g)??[]).length,1);
      assert.ok(html.includes(lang==="ru"?"Обычная проверка ничего не очищает":"ordinary health check neither cleans up"));
    }
    if(page.slug==="recovery"){
      assert.match(html,/<figure class="recovery-matrix">/);
      assert.equal((html.match(/class="recovery-matrix__row"/g)??[]).length,4);
      assert.ok(html.includes("Codex sessions"));
      assert.ok(html.includes(lang==="ru"?"Один локальный зашифрованный файл":"A local encrypted file alone"));
    }
    if(page.slug==="automation-boundaries"){
      assert.match(html,/<figure class="boundary-map">/);
      assert.equal((html.match(/class="boundary-map__card"/g)??[]).length,3);
      assert.ok(html.includes(lang==="ru"?"недоверенными данными":"untrusted data"));
    }
  }
}
for(const lang of ["en","ru"] as const){
  const html=renderHome(lang);
  assert.ok(html.includes("system-map__paths"));
  assert.equal((html.match(/class="system-map__path"/g)??[]).length,2);
  assert.ok(html.includes(lang==="ru"?"Решение владельца":"Owner decision"));
  assert.ok(html.includes("/assets/theme.js"));
  assert.ok(html.includes('class="mobile-menu"'));
  assert.ok(html.includes('class="topnav"'));
  const emptyChangelog=renderChangelog(lang,[]);
  assert.ok(!emptyChangelog.includes("github.com/Shagon1k/kurami/commit/"));
  assert.ok(emptyChangelog.includes(lang==="ru"?"намеренно оставляет changelog приложения пустым":"deliberately leaves the application changelog empty"));
  const previewStatus=lang==="ru"?"Версия развёртывания не указана":"No deployment revision was supplied";
  const changelogArticle=emptyChangelog.slice(emptyChangelog.indexOf("<article"),emptyChangelog.indexOf("</article>"));
  assert.equal(changelogArticle.split(previewStatus).length-1,1);
  assertInternalLinks(html);
  assertInternalLinks(emptyChangelog);
}
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
  assert.ok(renderChangelog("en",publishedDocsChanges,"095b03fb0f40bf39b914fef13dfec4c1b8348f7b").includes("private bilingual Kurami documentation site"));
  assert.ok(renderChangelog("ru",changesForDeployedSha("095b03fb0f40bf39b914fef13dfec4c1b8348f7b","ru"),"095b03fb0f40bf39b914fef13dfec4c1b8348f7b").includes("двуязычный сайт документации"));
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
console.log(`Verified ${pages.length} bilingual docs pages, shared map, preview honesty and curated release gate`);
