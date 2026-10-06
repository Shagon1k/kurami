// Development resources: defaults, guarded apply, stale panels, the slice unit and systemd calls, ensure on
// first use, and the kurami-dev-run wrapper's nested passthrough. systemd is a recording fake.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";

const home=mkdtempSync(resolve(tmpdir(),"kurami-dev-resources-"));
const units=resolve(home,"units"),calls=resolve(home,"systemctl.log"),systemctl=resolve(home,"systemctl");
writeFileSync(systemctl,`#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\n`,{mode:0o700});
Object.assign(process.env,{KURAMI_HOME:home,KURAMI_SYSTEMD_USER_DIR:units,KURAMI_SYSTEMCTL:systemctl});
const {runDevResourcesCli,readDevResources,devResourcesStatePath,devSliceUnitPath,validDevResources,sliceProperties,DEV_DEFAULTS,serverCores}=await import("../src/system/dev-resources/dev-resources.ts");
const app=resolve(import.meta.dirname,"..");
try{
  assert.deepEqual(DEV_DEFAULTS,{cores:4,testJobs:2,memoryGiB:0},"defaults: half the server, two test jobs, no memory cap");
  assert.deepEqual(readDevResources(devResourcesStatePath(home)),DEV_DEFAULTS,"defaults before the owner applies anything");
  assert.ok(validDevResources({cores:1,testJobs:1,memoryGiB:0},8)&&!validDevResources({cores:2,testJobs:3,memoryGiB:0},8)&&!validDevResources({cores:9,testJobs:1,memoryGiB:0},8)&&!validDevResources({cores:2,testJobs:1,memoryGiB:5},8));
  assert.deepEqual(sliceProperties({cores:3,testJobs:2,memoryGiB:12}),["CPUQuota=300%","CPUWeight=20","MemoryMax=12G"]);
  assert.deepEqual(sliceProperties({cores:4,testJobs:2,memoryGiB:0}),["CPUQuota=400%","CPUWeight=20","MemoryMax=infinity"]);

  const status=await runDevResourcesCli(["status"]);
  assert.equal(status.revision,0);assert.equal(status.cores,4);assert.equal(status.serverCores,serverCores());
  assert.equal(existsSync(devSliceUnitPath()),false,"status changes nothing");

  const ensured=await runDevResourcesCli(["ensure"]);
  assert.equal(ensured.action,"ensured");
  assert.match(readFileSync(devSliceUnitPath(),"utf8"),/\[Slice\]\nCPUQuota=400%\nCPUWeight=20\nMemoryMax=infinity\n$/,"first use writes the slice with the defaults");
  assert.deepEqual(readFileSync(calls,"utf8").trim().split("\n"),["--user daemon-reload","--user set-property --runtime kurami-dev.slice CPUQuota=400% CPUWeight=20 MemoryMax=infinity"]);
  assert.equal((await runDevResourcesCli(["ensure"])).action,"status","an existing slice is left alone");

  const apply=(cores:number,jobs:number,memory:number,revision:number,actor="42")=>runDevResourcesCli(["apply","--cores",String(cores),"--test-jobs",String(jobs),"--memory-gib",String(memory),"--expected-revision",String(revision),"--actor-id",actor]);
  await assert.rejects(apply(2,3,0,0),/Invalid limits/,"test jobs cannot exceed cores");
  await assert.rejects(apply(serverCores()+1,1,0,0),/Invalid limits/,"no more cores than the server has");
  await assert.rejects(apply(2,1,0,0,"x"),/Invalid actor ID/);
  const applied=await apply(Math.min(3,serverCores()),1,8,0);
  assert.equal(applied.action,"applied");assert.equal(applied.revision,1);assert.equal(applied.testJobs,1);
  assert.match(readFileSync(devSliceUnitPath(),"utf8"),new RegExp(`CPUQuota=${Math.min(3,serverCores())*100}%\\nCPUWeight=20\\nMemoryMax=8G`));
  assert.match(readFileSync(calls,"utf8"),/set-property --runtime kurami-dev\.slice CPUQuota=\d+% CPUWeight=20 MemoryMax=8G\n$/,"the running slice gets the new limits at once");
  assert.equal(statSync(devResourcesStatePath(home)).mode&0o777,0o600,"state is private");
  assert.deepEqual(readDevResources(devResourcesStatePath(home)),{cores:Math.min(3,serverCores()),testJobs:1,memoryGiB:8});
  await assert.rejects(apply(2,1,0,0),/changed since this panel opened/);
  assert.equal((await apply(Math.min(3,serverCores()),1,8,1)).action,"unchanged");

  writeFileSync(systemctl,"#!/bin/sh\nexit 1\n",{mode:0o700});
  await assert.rejects(apply(1,1,0,1),/systemd did not accept/,"a systemd failure leaves the applied state as it was");
  assert.equal(readDevResources(devResourcesStatePath(home)).cores,Math.min(3,serverCores()));
  assert.match(readFileSync(devSliceUnitPath(),"utf8"),/MemoryMax=8G/,"and the unit file goes back to the applied limits");

  // The wrapper: nested development work runs as is; a missing command is a usage error.
  assert.equal(execFileSync(resolve(app,"bin/kurami-dev-run"),["printf","%s","inside"],{env:{...process.env,KURAMI_DEV_SLICE:"1"},encoding:"utf8"}),"inside");
  assert.throws(()=>execFileSync(resolve(app,"bin/kurami-dev-run"),[],{stdio:"ignore"}),"no command");
  console.log(JSON.stringify({ok:true,devResources:"defaults, guarded apply, stale revision, slice unit, live systemd limits, ensure, failure keeps state, wrapper"}));
}finally{rmSync(home,{recursive:true,force:true});}
