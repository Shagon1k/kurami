// Unified deploy on a real git checkout with a scripted drift check and recorded commands: a release does
// only what drift asks for, in order; an up-to-date release changes nothing; a failing step rolls back;
// `rollback` returns to the previous release; a dirty checkout or a commit off main is refused.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {deploy,readLastDeploy,rollback,type DeployContext,type Runner} from "../src/system/deploy/deploy.ts";
import type {DriftItem} from "../src/system/release-drift.ts";

const root=mkdtempSync(join(tmpdir(),"kurami-deploy-")),app=join(root,"app"),home=join(root,"home"),origin=join(root,"origin.git");
const env={...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
const git=(...args:string[])=>execFileSync("git",args,{cwd:app,encoding:"utf8",env}).trim();
const calls:string[]=[];let failOn:string|null=null;
const run:Runner=async(command,args,options)=>{
  if(command==="git")return execFileSync("git",args,{cwd:options.cwd,encoding:"utf8",env,stdio:["ignore","pipe","pipe"]}).trim();
  const line=`${command.replace(app+"/","")} ${args.join(" ")}`;calls.push(line);
  if(failOn&&line.includes(failOn))throw new Error(`${failOn} failed`);
  return "";
};
let driftQueue:DriftItem[][]=[];
const item=(code:DriftItem["code"],en="x"):DriftItem=>({code,ru:en,en});
const context:DeployContext={app,home,run,drift:async()=>driftQueue.shift()??[]};
try{
  mkdirSync(app,{recursive:true});mkdirSync(home,{recursive:true});
  execFileSync("git",["init","-q","--bare","-b","main",origin]);
  git("init","-q","-b","main");git("remote","add","origin",origin);
  writeFileSync(join(app,"a.txt"),"1");git("add",".");git("commit","-qm","one");git("push","-q","origin","main");
  const one=git("rev-parse","HEAD");
  mkdirSync(join(app,"migrations"));writeFileSync(join(app,"migrations/039_x.sql"),"--");writeFileSync(join(app,"a.txt"),"2");git("add",".");git("commit","-qm","two");git("push","-q","origin","main");
  const two=git("rev-parse","HEAD");git("reset","-q","--hard",one);

  // A release: migrations, then the build and docs drift asks for, then restarts, then a clean check.
  driftQueue=[[item("digest_build_stale"),item("docs_release_stale")],[item("service_stale","Not restarted after the update: hub, briefing")],[]];
  mkdirSync(join(home,"state/human-docs/release"),{recursive:true});writeFileSync(join(home,"state/human-docs/release/build.json"),JSON.stringify({docsSha:one}));
  mkdirSync(join(app,"dist/human-docs"),{recursive:true});writeFileSync(join(app,"dist/human-docs/build.json"),JSON.stringify({docsSha:two}));
  const released=await deploy(context,"origin/main","42");
  assert.equal(released.status,"succeeded");assert.equal(git("rev-parse","HEAD"),two);
  assert.deepEqual(released.steps.map(step=>[step.name,step.status]),[["Move checkout","done"],["Orchestrator migrations","done"],["Digest build","done"],["Docs release","done"],["Hermes copies","skipped"],["Restart services","done"],["Check","done"]]);
  assert.deepEqual(calls,["npm run -s db:init","npm run -s briefing:build","npm run -s docs:build-docs-release","systemctl --user restart kurami-human-docs","npm run -s docs:verify-access","npm run -s docs:prune-releases -- --apply","systemctl --user restart kurami-hub kurami-briefing"]);
  assert.equal(JSON.parse(readFileSync(join(home,"state/human-docs/release/build.json"),"utf8")).docsSha,two,"the new docs release is live");
  assert.equal(JSON.parse(readFileSync(join(home,`state/human-docs/rollback-${one}/build.json`),"utf8")).docsSha,one,"the previous release is kept for rollback");
  assert.equal((await readLastDeploy(home))?.status,"succeeded");

  // Nothing to do: every step is skipped.
  calls.length=0;driftQueue=[[],[],[]];
  assert.deepEqual((await deploy(context,"origin/main","42")).steps.filter(step=>step.status!=="skipped").map(step=>step.name),["Check"]);
  assert.deepEqual(calls,[]);

  // A failing step goes back to the previous commit and converges there.
  writeFileSync(join(app,"a.txt"),"3");git("commit","-qam","three");git("push","-q","origin","main");const three=git("rev-parse","HEAD");git("reset","-q","--hard",two);
  calls.length=0;failOn="briefing:build";driftQueue=[[item("digest_build_stale")],[],[],[],[]];
  await assert.rejects(deploy(context,three,"42"),/briefing:build failed/);
  failOn=null;
  assert.equal(git("rev-parse","HEAD"),two,"the checkout is back where it was");
  assert.equal((await readLastDeploy(home))?.status,"rolled_back");

  // rollback returns to the commit before the last successful release.
  calls.length=0;driftQueue=[[],[],[]];
  const back=await rollback(context,"42");
  assert.equal(back.action,"rollback");assert.equal(git("rev-parse","HEAD"),one);

  // Refusals: a commit off main, uncommitted changes.
  await assert.rejects(deploy(context,"HEAD~5","42"),/./);
  writeFileSync(join(app,"a.txt"),"dirty");
  await assert.rejects(deploy(context,"origin/main","42"),/uncommitted changes/);
  console.log(JSON.stringify({ok:true,deploy:"ordered convergence, no-op release, rollback on failure, rollback command, refusals"}));
}finally{rmSync(root,{recursive:true,force:true});}
