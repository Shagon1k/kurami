// Release drift on a synthetic checkout: behind main, uncommitted changes, services and the Digest build
// that miss a change they depend on (and not one they do not), unreleased docs; checks that cannot run
// are skipped. systemd is a fake that reports chosen start times.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,rmSync,utimesSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {checkReleaseDrift} from "../src/system/release-drift.ts";

const root=mkdtempSync(join(tmpdir(),"kurami-release-drift-")),app=join(root,"app"),home=join(root,"home"),origin=join(root,"origin.git"),bin=join(root,"bin");
let clock=Math.floor(Date.now()/1000)-100_000;
const git=(...args:string[])=>execFileSync("git",args,{cwd:app,encoding:"utf8",env:{...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t",GIT_AUTHOR_DATE:`@${clock}`,GIT_COMMITTER_DATE:`@${clock}`}}).trim();
/** Moves the clock: commits and reflog entries get this time. */
const at=(seconds:number)=>{clock=seconds;return seconds*1000;};
const write=(path:string,content:string)=>{mkdirSync(join(app,path,".."),{recursive:true});writeFileSync(join(app,path),content);};
const starts:Record<string,number>={};
const fakeSystemctl=()=>writeFileSync(join(bin,"systemctl"),`#!/bin/sh\ncase "$3" in\n${Object.entries(starts).map(([unit,at])=>`  ${unit}) echo "@${Math.floor(at/1000)}";;`).join("\n")}\n  *) echo "";;\nesac\n`,{mode:0o755});
const codes=async()=>(await checkReleaseDrift({app,home})).map(item=>item.code).sort();
try{
  mkdirSync(app,{recursive:true});mkdirSync(home,{recursive:true});mkdirSync(bin);
  execFileSync("git",["init","-q","--bare","-b","main",origin]);
  git("init","-q","-b","main");git("remote","add","origin",origin);
  write("src/hub/server.ts",'import "./view.ts";\n');write("src/hub/view.ts","export const v=1;\n");
  write("src/web/server.ts","export const w=1;\n");write("src/projects-site/server.ts","export const p=1;\n");
  write("src/briefing/server.ts",'import "./page.ts";\n');write("src/briefing/page.ts","export const page=1;\n");
  write("src/human-docs/build.ts",'import "./content.ts";\n');write("src/human-docs/content.ts","export const c=1;\n");
  write(".gitignore","dist/\n");
  const t0=Math.floor(Date.now()/1000)-100_000;
  at(t0);git("add",".");git("commit","-qm","base");git("push","-q","origin","main");git("branch","-u","origin/main");
  const base=git("rev-parse","HEAD");
  process.env.PATH=`${bin}:${process.env.PATH}`;
  // Services started after the base commit; the Digest build was made before them.
  for(const unit of ["kurami-hub","kurami-web","kurami-projects","kurami-briefing"])starts[unit]=(t0+100)*1000;
  fakeSystemctl();
  mkdirSync(join(app,"dist/briefing"),{recursive:true});writeFileSync(join(app,"dist/briefing/server.js"),"");
  utimesSync(join(app,"dist/briefing/server.js"),t0+50,t0+50);
  mkdirSync(join(home,"state/human-docs/release"),{recursive:true});writeFileSync(join(home,"state/human-docs/release/build.json"),JSON.stringify({docsSha:base}));
  assert.deepEqual(await codes(),[],"everything matches main");

  // A Hub-only change pulled after the services started: only Hub is stale.
  write("src/hub/view.ts","export const v=2;\n");at(t0+200);git("commit","-qam","hub");git("push","-q","origin","main");
  assert.deepEqual((await checkReleaseDrift({app,home})).map(item=>[item.code,item.en]),[["service_stale","Not restarted after the update: hub"]],"only the service whose code changed is stale");
  starts["kurami-hub"]=(t0+300)*1000;fakeSystemctl();
  assert.deepEqual(await codes(),[],"a restart clears it");

  // Digest: a change to what it compiles makes the build stale; docs: a change to their sources.
  write("src/briefing/page.ts","export const page=2;\n");write("src/human-docs/content.ts","export const c=2;\n");at(t0+400);git("commit","-qam","briefing and docs");git("push","-q","origin","main");
  assert.deepEqual(await codes(),["digest_build_stale","docs_release_stale"]);
  // Rebuilt after the service started: the service must restart to run the new build.
  utimesSync(join(app,"dist/briefing/server.js"),t0+500,t0+500);
  writeFileSync(join(home,"state/human-docs/release/build.json"),JSON.stringify({docsSha:git("rev-parse","HEAD")}));
  assert.deepEqual((await checkReleaseDrift({app,home})).map(item=>[item.code,item.en]),[["service_stale","Not restarted after the update: briefing"]]);
  starts["kurami-briefing"]=(t0+600)*1000;fakeSystemctl();
  assert.deepEqual(await codes(),[]);

  // Behind main and uncommitted work.
  const other=join(root,"other");execFileSync("git",["clone","-q",origin,other]);
  execFileSync("git",["-c","user.name=t","-c","user.email=t@t","commit","-q","--allow-empty","-m","remote"],{cwd:other});execFileSync("git",["push","-q","origin","main"],{cwd:other});
  git("fetch","-q");
  write("src/web/server.ts","export const w=2;\n");
  const drift=await checkReleaseDrift({app,home});
  assert.deepEqual(drift.map(item=>item.code).sort(),["checkout_behind","checkout_dirty"]);
  assert.equal(drift.find(item=>item.code==="checkout_behind")?.ru,"Рабочая версия позади main на 1 коммит");
  assert.deepEqual(await checkReleaseDrift({app:join(root,"missing"),home}),[],"a checkout that cannot be read reports nothing");
  console.log(JSON.stringify({ok:true,releaseDrift:"behind, dirty, stale services by closure, Digest build, docs release, unreadable checkout skipped"}));
}finally{rmSync(root,{recursive:true,force:true});}
