import assert from "node:assert/strict";
import {canStartTask,taskStartProgress,type ActivationEvent} from "../../src/projects-site/task-start.ts";
import {projectStageLabel} from "../../src/projects-site/model.ts";
import {renderProjectsPage} from "../../src/projects-site/render.ts";
import {syntheticProjectsSnapshot} from "./fixture.ts";
const snapshot=syntheticProjectsSnapshot(),item=snapshot.items.find(item=>item.number===15)!,project=snapshot.projects[0]!;
item.statusChange={enabled:true,reason:"eligible",choices:Object.values(project.statuses).map(value=>({value,label:value,hint:""}))};
const request={request_id:"start",project:item.project,item_id:item.id,from_status:"Backlog",to_status:"In progress",request_state:"awaiting_sync" as const,client_key:"same-key",updated_at:snapshot.generatedAt};
const event:ActivationEvent={project:item.project,item_id:item.id,event_id:"activation",from_status:"Backlog",to_status:"In progress",observed_at:snapshot.generatedAt,processing_state:"pending",processing_note:null};
assert.equal(canStartTask(item,project),true);
for(const kind of ["DraftIssue","PullRequest"]){assert.equal(canStartTask({...item,kind},project),false);assert.equal(taskStartProgress({...item,kind},project,request,"awaiting_sync",event,null,null),undefined);}
assert.equal(canStartTask({...item,runId:"old",runState:"failed"},project),false,"failed runs remain live in admission policy");
assert.equal(canStartTask({...item,runId:"old",runState:"archived"},project),true);
assert.equal(taskStartProgress(item,project,request,"awaiting_sync",undefined,null,null)?.state,"awaiting_sync");
assert.equal(taskStartProgress(item,project,request,"uncertain",undefined,null,null)?.state,"uncertain");
assert.equal(taskStartProgress(item,project,request,"failed",undefined,null,null)?.state,"failed");
item.status="In progress";
assert.equal(taskStartProgress(item,project,request,"synced",event,null,null)?.state,"awaiting_admission");
assert.equal(taskStartProgress(item,project,undefined,null,undefined,null,null)?.state,"blocked","an unexplained active status does not trap the owner in endless waiting");
assert.equal(taskStartProgress({...item,runId:"old",runState:"archived"},project,request,"synced",event,"older-event",null)?.state,"awaiting_admission");
assert.equal(taskStartProgress({...item,runId:"old",runState:"archived"},project,request,"synced",{...event,observed_at:"2026-09-01T00:00:00Z"},"activation",null)?.state,"awaiting_sync","a historical admission cannot satisfy a new start intent");
assert.equal(taskStartProgress({...item,runId:"existing",runState:"running"},project,undefined,null,{...event,processing_state:"ignored",processing_note:"Live run already exists: existing"},"older-event",null),undefined,"existing execution is not mislabeled as a failed task start");
assert.equal(taskStartProgress(item,project,request,"synced",{...event,processing_state:"ignored",processing_note:"Issue description is empty"},null,null)?.state,"blocked");
for(const [runState,state] of [["admission_pending","awaiting_admission"],["starting","starting"],["rejected","blocked"],["running",undefined]] as const){
  const progress=taskStartProgress({...item,runId:"new",runState},project,request,"synced",event,"activation","WIP limit reached: global 2/2");
  assert.equal(progress?.state,state);
  if(runState==="rejected")assert.match(progress!.message,/work limits/);
}
for(const lang of ["en","ru"] as const) {
  item.status="Backlog";delete item.taskStart;
  const html=renderProjectsPage(snapshot,new URLSearchParams({lang,item:item.id}));
  assert.match(html,/data-start-task/);assert.match(html,lang==="ru"?/Начать работу/:/Start work/);
  assert.match(html,/projects\.css\?v=[a-f0-9]{16}/);assert.match(html,/projects\.js\?v=[a-f0-9]{16}/);
  assert.match(html,lang==="ru"?/Запустить задачу в Kurami\./:/Start this task in Kurami\./);
  const form=html.match(/<form[^>]*data-start-task[^>]*>[\s\S]*?<\/form>/)![0];assert.doesNotMatch(form,/<select/);assert.match(form,/data-target="In progress"/);
  item.taskStart={state:"awaiting_sync",message:"Start requested. Waiting for Kurami to observe the status change."};
  item.statusChange={...item.statusChange,enabled:false,reason:"pending",request:{state:"awaiting_sync",target:"In progress",from:"Backlog",key:"same-key",checkAvailable:false}};
  const pending=renderProjectsPage(snapshot,new URLSearchParams({lang,item:item.id}));
  assert.match(pending,/data-start-state="awaiting_sync"/);assert.match(pending,/data-key="same-key"/);
  assert.equal(projectStageLabel(item,lang),lang==="ru"?"Ждём синхронизации запуска":"Waiting for start sync");
  item.statusChange={...item.statusChange,enabled:true,reason:"eligible",request:undefined};
}
delete item.taskStart;
item.statusChange={...item.statusChange,enabled:false,reason:"pending",request:{state:"awaiting_sync",target:"Done",from:"Backlog",key:"other-key",checkAvailable:false}};
const otherPending=renderProjectsPage(snapshot,new URLSearchParams({item:item.id})).match(/<form[^>]*data-status-form[^>]*>[\s\S]*?<\/form>/)![0];
assert.doesNotMatch(otherPending,/data-start-task/);assert.match(otherPending,/<select/);assert.match(otherPending,/data-target="Done"/);
item.statusChange={...item.statusChange,reason:"stale",request:undefined};
const stale=renderProjectsPage(snapshot,new URLSearchParams({item:item.id})).match(/<form[^>]*data-start-task[^>]*>[\s\S]*?<\/form>/)![0];
assert.match(stale,/data-note-tone="warning"/);
item.statusChange={...item.statusChange,enabled:true,reason:"eligible"};
project.statuses.active="Doing";
const configured=renderProjectsPage(snapshot,new URLSearchParams({item:item.id})).match(/<form[^>]*data-start-task[^>]*>[\s\S]*?<\/form>/)![0];
assert.match(configured,/data-target="Doing"/);assert.doesNotMatch(configured,/In progress/);
console.log("Task start: one-click Backlog control, durable phases, admission failures, exact activation identity and safe unavailable states verified");
