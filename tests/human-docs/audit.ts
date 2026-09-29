import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {chmodSync,mkdirSync,mkdtempSync,rmSync,unlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {collectDocsAudit} from "../../src/human-docs/automation/audit.ts";
import {isDocsAuditWindow} from "../../src/human-docs/automation/cron-payload.ts";

assert.equal(isDocsAuditWindow(new Date("2026-01-05T04:00:00Z")),true);
assert.equal(isDocsAuditWindow(new Date("2026-01-05T03:00:00Z")),false);
assert.equal(isDocsAuditWindow(new Date("2026-07-06T03:00:00Z")),true);
assert.equal(isDocsAuditWindow(new Date("2026-07-06T04:00:00Z")),false);
assert.equal(isDocsAuditWindow(new Date("2026-07-07T03:00:00Z")),false);

const repo=mkdtempSync(join(tmpdir(),"kurami-docs-audit-"));
const git=(...args:string[])=>execFileSync("git",args,{cwd:repo,encoding:"utf8"}).trim();
const commit=(name:string,body:string)=>{
  writeFileSync(join(repo,name),body);
  git("add",name);
  execFileSync("git",["-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm",`fixture ${name}`],{cwd:repo});
  return git("rev-parse","HEAD");
};

try {
  git("init","-q","-b","main");
  const baseline=commit("base.txt","base");
  const product=commit("src.txt","changed product");
  const docs=commit("docs.txt","changed docs");
  const ledgerPath=join(repo,"ledger.json");
  const docsBuildPath=join(repo,"build.json");
  const deploymentManifestPath=join(repo,"deployment.json");
  writeFileSync(ledgerPath,JSON.stringify({baseline,commits:{[product]:{category:"fixed",en:"Fixed",ru:"Исправлено"}}}));
  writeFileSync(docsBuildPath,JSON.stringify({mode:"release",docsSha:baseline,revision:null}));
  writeFileSync(deploymentManifestPath,JSON.stringify({status:"succeeded",appSha:product}));
  const options={repo,sourceRef:"HEAD",ledgerPath,docsBuildPath,deploymentManifestPath};
  const result=collectDocsAudit(options);
  assert.equal(result.sourceSha,docs);
  assert.equal(result.baselineSha,baseline);
  assert.equal(result.docsReleaseSha,baseline);
  assert.equal(result.verifiedAppSha,product);
  assert.equal(result.sourceDirty,true); // Untracked local markers are visible but never read as source changes.
  assert.deepEqual(result.changedPaths,["docs.txt","src.txt"]);
  assert.deepEqual(result.commitsSinceDocsRelease.map(change=>[change.sha,change.deployed]),[[product,true],[docs,false]]);
  assert.deepEqual(result.unclassifiedShas,[docs]);
  assert.doesNotMatch(JSON.stringify(result),/fixture src\.txt|test@example\.invalid/);
  assert.deepEqual(collectDocsAudit({...options,docsBuildPath:undefined,deploymentManifestPath:undefined}).commitsSinceDocsRelease.map(change=>change.deployed),[null,null]);
  writeFileSync(deploymentManifestPath,JSON.stringify({status:"failed",appSha:product}));
  assert.throws(()=>collectDocsAudit(options),/Invalid successful-deployment manifest/);
  writeFileSync(docsBuildPath,JSON.stringify({mode:"preview",docsSha:baseline}));
  assert.throws(()=>collectDocsAudit({...options,deploymentManifestPath:undefined}),/Invalid promoted docs release marker/);
  assert.throws(()=>collectDocsAudit({...options,sourceRef:"--upload-pack=bad",docsBuildPath:undefined,deploymentManifestPath:undefined}),/Unsafe Git ref/);
  console.log("Docs audit: release watermarks, deployment boundary and unclassified commits verified");
} finally {rmSync(repo,{recursive:true,force:true});}

const wrapperFixture=mkdtempSync(join(tmpdir(),"kurami-docs-wrapper-"));
const runGit=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"}).trim();
const wrapper=join(import.meta.dirname,"../../src/human-docs/automation/hermes-wrapper.sh");
try {
  const remote=join(wrapperFixture,"remote.git");
  const seed=join(wrapperFixture,"seed");
  const auditClone=join(wrapperFixture,"audit");
  const bin=join(wrapperFixture,"bin");
  mkdirSync(seed);
  mkdirSync(bin);
  runGit(wrapperFixture,"init","-q","--bare","-b","main",remote);
  runGit(seed,"init","-q","-b","main");
  writeFileSync(join(seed,"initial.txt"),"initial");
  runGit(seed,"add","initial.txt");
  runGit(seed,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","initial");
  runGit(seed,"remote","add","origin",remote);
  runGit(seed,"push","-q","-u","origin","main");
  runGit(wrapperFixture,"clone","-q",remote,auditClone);

  const dateStub=join(bin,"date");
  const nodeStub=join(bin,"node");
  const setDate=(value:string)=>writeFileSync(dateStub,`#!/bin/sh\nprintf '%s\\n' '${value}'\n`);
  setDate("105");
  writeFileSync(nodeStub,"#!/bin/sh\nprintf '%s\\n' '{\"wakeAgent\":true}'\n");
  chmodSync(dateStub,0o755);
  chmodSync(nodeStub,0o755);
  const env={...process.env,PATH:`${bin}:${process.env.PATH}`,KURAMI_DOCS_AUDIT_CHECKOUT:auditClone};
  const runWrapper=()=>execFileSync("bash",[wrapper],{env,encoding:"utf8"}).trim();
  assert.equal(runWrapper(),'{"wakeAgent":false}');

  setDate("106");
  assert.throws(runWrapper,/dedicated marked clone/);
  writeFileSync(join(auditClone,".git","kurami-docs-audit"),"kurami-docs-audit-v1\n");
  writeFileSync(join(auditClone,"dirty.txt"),"not committed");
  assert.throws(runWrapper,/must be clean/);
  unlinkSync(join(auditClone,"dirty.txt"));
  runGit(auditClone,"switch","-q","-c","feature");
  assert.throws(runWrapper,/must be on main/);
  runGit(auditClone,"switch","-q","main");

  writeFileSync(join(seed,"later.txt"),"later");
  runGit(seed,"add","later.txt");
  runGit(seed,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","later");
  runGit(seed,"push","-q","origin","main");
  assert.notEqual(runGit(auditClone,"rev-parse","HEAD"),runGit(seed,"rev-parse","HEAD"));
  assert.equal(runWrapper(),'{"wakeAgent":true}');
  assert.equal(runGit(auditClone,"rev-parse","HEAD"),runGit(seed,"rev-parse","HEAD"));
  writeFileSync(join(auditClone,"local-only.txt"),"local only");
  runGit(auditClone,"add","local-only.txt");
  runGit(auditClone,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","local only");
  assert.throws(runWrapper,/must exactly match origin\/main/);
  console.log("Docs wrapper: off-tick skip, clone guard and fast-forward verified");
} finally {rmSync(wrapperFixture,{recursive:true,force:true});}
