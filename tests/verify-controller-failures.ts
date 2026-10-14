// Controller failure ledger: waits vs errors, backoff after five failures, success resets, stuck after
// three hours, stale records forgotten, private atomic state.
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ControllerFailureLedger,backoffMinutes,failureKind,isStuck,readControllerFailures} from "../src/orchestrator/runtime/controller-failures.ts";

const home=mkdtempSync(join(tmpdir(),"kurami-controller-failures-")),path=join(home,"state/controller-failures.json");
const plan={runId:"r_1",project:"pickflick",issueNumber:35,action:"park"};
const at=(minutes:number)=>new Date(Date.UTC(2026,9,6,12,0)+minutes*60_000);
try{
  assert.equal(failureKind("Codex turn is still active; handoff is not safe yet"),"wait");
  assert.equal(failureKind("Exact protocol turn has not completed successfully with a process stop receipt"),"wait");
  assert.equal(failureKind("database is locked"),"error");
  assert.deepEqual([1,2,3,4,5,6,7,8,9,10,11].map(backoffMinutes),[0,0,0,0,0,2,4,8,16,30,30],"five free retries, then doubling up to 30 minutes");

  let ledger=new ControllerFailureLedger(path,at(0));
  assert.equal(ledger.backingOff(plan),null,"nothing recorded, nothing skipped");
  for(let n=0;n<5;n++)ledger.recordFailure(plan,"Codex turn is still active");
  assert.equal(ledger.backingOff(plan),null,"the first five failures retry at once");
  const sixth=ledger.recordFailure(plan,"Codex turn is still active");
  assert.equal(sixth.count,6);assert.equal(sixth.kind,"wait");assert.equal(sixth.nextAt,at(2).toISOString());
  assert.ok(ledger.backingOff(plan),"the sixth failure backs off");
  await ledger.save();
  assert.equal(statSync(path).mode&0o777,0o600,"the ledger is private");

  ledger=new ControllerFailureLedger(path,at(1));
  assert.ok(ledger.backingOff(plan),"backoff survives between cycles");
  ledger=new ControllerFailureLedger(path,at(3));
  assert.equal(ledger.backingOff(plan),null,"after the pause the action runs again");
  assert.equal(readControllerFailures(path)["r_1:park"]!.firstAt,at(0).toISOString());
  assert.equal(isStuck(readControllerFailures(path)["r_1:park"]!,at(179)),false);
  assert.equal(isStuck(readControllerFailures(path)["r_1:park"]!,at(180)),true,"three hours of failures is stuck");
  ledger.recordSuccess(plan);await ledger.save();
  assert.deepEqual(readControllerFailures(path),{},"a success forgets the run");

  ledger=new ControllerFailureLedger(path,at(0));
  ledger.recordFailure({...plan,action:"release"},"unmerged work");
  ledger.recordFailure({...plan,action:"resume_stop"},"cancellation recovery refused");
  ledger.recordFailure({...plan,runId:"r_active"},"still active");
  await ledger.save();
  ledger=new ControllerFailureLedger(path,at(2));
  ledger.recordFailure({...plan,action:"project_backlog"},"writeback failed");
  ledger.forgetResolved([{run_id:"r_1",settled_at:at(1).toISOString()}]);
  await ledger.save();
  assert.deepEqual(Object.keys(readControllerFailures(path)).sort(),["r_1:project_backlog","r_active:park"],"clear old release/recovery errors, preserve later follow-up and active-run failures");
  ledger.forgetResolved([{run_id:"r_active",settled_at:null}]);
  assert.ok(ledger.failures["r_active:park"],"unknown completion time is not proof of resolution");
  ledger=new ControllerFailureLedger(path,at(0));ledger.recordFailure({...plan,runId:"r_gone"},"boom");await ledger.save();
  ledger=new ControllerFailureLedger(path,at(6*60+3));ledger.forgetStale();await ledger.save();
  assert.deepEqual(readControllerFailures(path),{},"a run no plan touched for six hours is forgotten");
  console.log(JSON.stringify({ok:true,controllerFailures:"waits vs errors, backoff, reset, stuck, forgetting, private state"}));
}finally{rmSync(home,{recursive:true,force:true});}
