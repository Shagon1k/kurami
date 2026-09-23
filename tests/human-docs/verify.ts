import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {pages} from "../../src/human-docs/content.ts";
import {changesForDeployedSha,readDeploymentManifest,assertDocsSourceMatchesDeployment} from "../../src/human-docs/changelog.ts";
import {renderArticle,renderChangelog,renderHome} from "../../src/human-docs/render.ts";

const root=resolve(import.meta.dirname,"../..");
assert.ok(pages.length>=14);
const slugs=new Set(pages.map(p=>p.slug));
assert.equal(slugs.size,pages.length);
for(const page of pages){
  for(const lang of ["en","ru"] as const){
    assert.ok(page.title[lang]&&page.summary[lang]&&page.blocks.every(block=>block[lang]));
    const html=renderArticle(page,lang);
    assert.match(html,new RegExp(`<html lang="${lang}"`));
    assert.ok(html.includes(`/${lang}/${page.slug}/`));
    assert.ok(html.includes(`/${lang==="en"?"ru":"en"}/${page.slug}/`));
    assert.ok(!html.includes("data-visual="),`Unrendered visual in ${page.slug}`);
  }
}
for(const lang of ["en","ru"] as const){
  const html=renderHome(lang);
  assert.ok(html.includes("system-map__branches"));
  assert.ok(html.includes("/assets/theme.js"));
  assert.ok(!renderChangelog(lang,[]).includes("github.com/Shagon1k/kurami/commit/"));
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
  assert.ok(renderChangelog("en",changes,"596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26").includes("review stage requires"));
  assert.ok(renderChangelog("ru",changesForDeployedSha("596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26","ru"),"596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26").includes("Изменения подтверждены"));
  assert.ok(renderChangelog("en",[],undefined,true).includes("Docs are published; no verified application deployment"));
  assert.ok(renderChangelog("ru",[],undefined,true).includes("Документация опубликована"));
  const built=resolve(root,"dist/human-docs");
  if(existsSync(built)) {
    const metadata=JSON.parse(readFileSync(join(built,"build.json"),"utf8")) as {mode:string;revision:string|null;docsSha?:string|null};
    assert.ok(["preview","release"].includes(metadata.mode));
    if(metadata.mode==="preview") assert.ok(metadata.docsSha==null);
    else assert.match(metadata.docsSha??"",/^[0-9a-f]{40}$/);
    if(!metadata.revision)assert.ok(!readFileSync(join(built,"en/changelog/index.html"),"utf8").includes("review stage requires"));
  }
} finally {rmSync(scratch,{recursive:true,force:true});}
console.log(`Verified ${pages.length} bilingual docs pages, shared map, preview honesty and curated release gate`);
