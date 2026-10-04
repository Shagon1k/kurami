import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { requestProjectStatus, type StatusInput } from "../../src/projects-site/status.ts";
import { githubProjectFields, type ProjectFieldClient, type ProjectFieldSnapshot, type ProjectFieldWrite } from "../../src/orchestrator/integrations/github/project-fields.ts";
import { collectProjectsSnapshot } from "../../src/projects-site/snapshot.ts";
import { ProjectsActionError } from "../../src/projects-site/actions.ts";
import { createProjectsServer } from "../../src/projects-site/server.ts";

const home = mkdtempSync(join(tmpdir(),"kurami-project-status-site-"));
const app = resolve(import.meta.dirname,"../..");
const at = "2026-10-01T09:00:00.000Z";
let instant = new Date(at);
let readFailure = false; let mutationFailure = false; let applyBeforeFailure = false; let concurrentAfterWrite = false;
let mutations: ProjectFieldWrite[] = []; let reads = 0;
let readGate: Promise<void> | null = null;
const statuses = { backlog:"Backlog",active:"Doing",review:"Review",done:"Done",deferred:"Later" };
const config = { version:1,projects:{ alpha:{owner:"Example",project_number:1,status_field:"Status",repository:"Example/Alpha",statuses} } };
mkdirSync(join(home,"state")); mkdirSync(join(home,"config")); mkdirSync(join(home,"bin"));
writeFileSync(join(home,"config/projects.yaml"),JSON.stringify(config));
const database = new DatabaseSync(join(home,"state/orchestrator.db")); database.exec("PRAGMA foreign_keys=ON");
const migrations = resolve(app,"migrations");
const remoteTemplate: ProjectFieldSnapshot = { projectId:"PVT_project",fieldId:"PVTSSF_field",itemId:"PVTI_item",itemProjectId:"PVT_project",archived:false,
  kind:"Issue",repository:"Example/Alpha",status:"Backlog",optionId:"opt_backlog",updatedAt:at,options:Object.entries(statuses).map(([role,name])=>({id:"opt_"+role,name})) };
let remote = structuredClone(remoteTemplate);
const github: ProjectFieldClient = {
  async read(input) { reads++; assert.equal(input.owner,"Example"); assert.equal(input.number,1); assert.equal(input.fieldName,"Status"); assert.equal(input.itemId,"PVTI_item"); if(readGate) await readGate; if(readFailure) throw new Error("fixture auth failure with private details"); return structuredClone(remote); },
  async write(input) {
    mutations.push(input); assert.equal(input.itemId,"PVTI_item"); assert.equal(input.projectId,"PVT_project"); assert.equal(input.fieldId,"PVTSSF_field");
    if(!mutationFailure || applyBeforeFailure) { remote.optionId=input.optionId; remote.status=remote.options.find(option=>option.id===input.optionId)!.name; }
    if(concurrentAfterWrite) { remote.status="Review"; remote.optionId="opt_review"; }
    if(mutationFailure) throw new Error("fixture transport timeout with private details");
  },
};
const options = {home,now:()=>instant,github};
const input = (target="Doing"): StatusInput => ({project:"alpha",itemId:"PVTI_item",from:"Backlog",target,observedAt:at,key:randomUUID()});
function itemState() { return database.prepare("SELECT * FROM project_items ORDER BY project,item_id").all(); }
function reset() {
  database.exec("DELETE FROM project_status_requests; DELETE FROM project_events; UPDATE project_items SET status='Backlog',present=1,content_type='Issue',repository='Example/Alpha'");
  database.prepare("UPDATE project_items SET last_seen_at=?").run(at); database.prepare("UPDATE project_poll_state SET last_captured_at=?,last_attempt_state='succeeded'").run(at);
  instant=new Date(at); remote=structuredClone(remoteTemplate); mutations=[]; reads=0; readFailure=mutationFailure=applyBeforeFailure=concurrentAfterWrite=false;
}
async function reject(value: StatusInput, pattern: RegExp) {
  await assert.rejects(requestProjectStatus(value,"owner",options),error=>error instanceof ProjectsActionError && pattern.test(error.message));
  assert.equal(mutations.length,0);
}
try {
  for(const file of readdirSync(migrations).filter(name=>/^\d+_.*\.sql$/.test(name) && name < "034_").sort()) database.exec(readFileSync(join(migrations,file),"utf8"));
  database.prepare("INSERT INTO project_items(project,item_id,content_id,content_type,repository,issue_number,title,url,status,present,first_seen_at,last_seen_at) VALUES('alpha','PVTI_item','issue12','Issue','Example/Alpha',12,'Fixture','https://github.com/Example/Alpha/issues/12','Backlog',1,?,?)").run(at,at);
  database.prepare("INSERT INTO project_poll_state(project,initialized_at,last_captured_at,item_count,last_attempt_state) VALUES('alpha',?,?,1,'succeeded')").run(at,at);
  const initial = itemState();
  assert.equal(collectProjectsSnapshot({home,now:instant,statusEnabled:true}).available,true);
  assert.equal(collectProjectsSnapshot({home,now:instant,statusEnabled:true}).items[0]!.statusChange?.reason,"unavailable","missing migration does not break inspection");
  database.exec(readFileSync(join(migrations,"034_project_status_requests.sql"),"utf8"));
  assert.deepEqual(itemState(),initial,"schema 34 preserves existing items"); assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);
  const original = input();
  const result = await requestProjectStatus(original,"owner",options);
  assert.equal(result.state,"awaiting_sync"); assert.equal(mutations.length,1); assert.equal(mutations[0]!.optionId,"opt_active");
  assert.deepEqual(itemState(),initial,"web writes never update the poller's item snapshot");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM project_events").get()!.n,0,"web writes never synthesize or suppress controller events");
  const snapshot = collectProjectsSnapshot({home,now:instant,statusEnabled:true});
  assert.equal(snapshot.items[0]!.status,"Backlog"); assert.equal(snapshot.items[0]!.statusChange?.request?.target,"Doing"); assert.equal(snapshot.items[0]!.statusChange?.enabled,false);
  assert.equal((await requestProjectStatus(original,"owner",options)).requestId,result.requestId);
  assert.equal((await requestProjectStatus(input(),"owner",options)).requestId,result.requestId);
  assert.equal(mutations.length,1,"nonce retry and two renders produce one mutation");
  await assert.rejects(requestProjectStatus(input("Done"),"owner",options),/Предыдущее/);
  assert.equal(mutations.length,1);

  // Exercise the unmodified normal poller against a synthetic GitHub response.
  const responsePath=join(home,"remote.json"); const pollGh=join(home,"bin/gh");
  writeFileSync(pollGh,`#!${process.execPath}\nimport {readFileSync} from 'node:fs';process.stdout.write(readFileSync(process.env.FIXTURE_REMOTE,'utf8'));\n`,{mode:0o700});
  writeFileSync(responsePath,JSON.stringify({data:{user:{projectV2:{items:{nodes:[{id:"PVTI_item",type:"ISSUE",fieldValueByName:{name:"Doing"},content:{__typename:"Issue",id:"issue12",number:12,title:"Fixture",url:"https://github.com/Example/Alpha/issues/12",state:"OPEN",body:"Description",labels:{nodes:[]},repository:{nameWithOwner:"Example/Alpha"}}}],pageInfo:{hasNextPage:false,endCursor:null}}}}}}));
  const poll=()=>execFileSync(process.execPath,[resolve(app,"src/orchestrator/projects/poll-projects.ts")],{env:{...process.env,KURAMI_HOME:home,POLLER_PROJECT:"alpha",POLLER_QUIET:"1",FIXTURE_REMOTE:responsePath,PATH:join(home,"bin")+":"+process.env.PATH},stdio:["ignore","pipe","pipe"]});
  poll(); poll();
  assert.equal(database.prepare("SELECT status FROM project_items").get()!.status,"Doing");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM project_events WHERE from_status='Backlog' AND to_status='Doing'").get()!.n,1,"the normal poller observes the transition exactly once");
  assert.equal(collectProjectsSnapshot({home,now:new Date(),statusEnabled:true}).items[0]!.statusChange?.enabled,true);
  assert.equal((await requestProjectStatus(original,"owner",options)).state,"synced"); assert.equal(mutations.length,1);
  assert.equal(database.prepare("SELECT actor_subject FROM project_status_requests").get()!.actor_subject,"owner");

  reset(); let releaseRead!: () => void;
  readGate = new Promise<void>(resolve => { releaseRead=resolve; });
  const firstRequest = requestProjectStatus(input(),"owner",options);
  const concurrentRequest = await requestProjectStatus(input(),"owner",options);
  assert.equal(concurrentRequest.state,"checking"); assert.equal(reads,1); assert.equal(mutations.length,0);
  releaseRead(); readGate=null;
  assert.equal((await firstRequest).requestId,concurrentRequest.requestId);
  assert.equal(mutations.length,1,"simultaneous requests share one durable claim and one external write");

  reset(); remote.status="Review"; remote.optionId="opt_review";
  assert.equal((await requestProjectStatus(input(),"owner",options)).state,"conflict"); assert.equal(mutations.length,0,"live divergence blocks an overwrite");
  assert.equal(collectProjectsSnapshot({home,now:instant,statusEnabled:true}).items[0]!.statusChange?.request?.state,"conflict","a recent conflict is visible");
  instant=new Date(Date.parse(at)+130000);
  database.prepare("UPDATE project_poll_state SET last_captured_at=?").run(instant.toISOString());
  assert.equal(collectProjectsSnapshot({home,now:instant,statusEnabled:true}).items[0]!.statusChange?.request?.state,"conflict","time alone cannot hide a conflict");
  database.prepare("UPDATE project_items SET status='Review',last_seen_at=?").run(instant.toISOString());
  assert.equal(collectProjectsSnapshot({home,now:instant,statusEnabled:true}).items[0]!.statusChange?.request,undefined,"a fresh later observation clears an old conflict notice");
  assert.equal(database.prepare("SELECT request_state FROM project_status_requests").get()!.request_state,"conflict","hiding an old notice preserves its receipt");
  database.exec("UPDATE project_status_requests SET request_state='uncertain'");
  const uncertain=collectProjectsSnapshot({home,now:instant,statusEnabled:true}).items[0]!.statusChange!;
  assert.equal(uncertain.request?.state,"uncertain");assert.equal(uncertain.enabled,false,"an unconfirmed write never clears on time or a later status alone");
  reset(); remote.status="Doing"; remote.optionId="opt_active";
  assert.equal((await requestProjectStatus(input(),"owner",options)).state,"awaiting_sync"); assert.equal(mutations.length,0,"an already applied target is read without rewriting");
  reset(); remote.itemProjectId="another-project";
  assert.equal((await requestProjectStatus(input(),"owner",options)).state,"conflict"); assert.equal(mutations.length,0);
  reset(); remote.repository="Example/Private";
  assert.equal((await requestProjectStatus(input(),"owner",options)).state,"conflict"); assert.equal(mutations.length,0);
  reset(); remote.archived=true;
  assert.equal((await requestProjectStatus(input(),"owner",options)).state,"conflict"); assert.equal(mutations.length,0);
  reset(); remote.options=remote.options.filter(option=>option.name!=="Doing");
  assert.equal((await requestProjectStatus(input(),"owner",options)).state,"conflict"); assert.equal(mutations.length,0);
  reset(); concurrentAfterWrite=true;
  assert.equal((await requestProjectStatus(input(),"owner",options)).state,"conflict"); assert.equal(mutations.length,1,"a later external edit is displayed and is never rolled back");
  reset(); readFailure=true;
  assert.equal((await requestProjectStatus(input(),"owner",options)).state,"failed"); assert.equal(mutations.length,0);
  reset(); mutationFailure=true; applyBeforeFailure=true;
  const uncertainInput=input(); assert.equal((await requestProjectStatus(uncertainInput,"owner",options)).state,"uncertain");
  assert.equal((await requestProjectStatus(uncertainInput,"owner",options)).state,"uncertain"); assert.equal(mutations.length,1);
  instant=new Date(Date.parse(at)+31_000);
  assert.equal((await requestProjectStatus(uncertainInput,"owner",options)).state,"awaiting_sync"); assert.equal(mutations.length,1,"lost replies are reconciled by reads without a second write");
  reset(); mutationFailure=true;
  const failedInput=input(); await requestProjectStatus(failedInput,"owner",options); instant=new Date(Date.parse(at)+31_000);
  assert.equal((await requestProjectStatus(failedInput,"owner",options)).state,"failed"); assert.equal(mutations.length,1);
  assert.equal((await requestProjectStatus(failedInput,"owner",options)).state,"failed"); assert.equal(mutations.length,1,"completed failed nonce cannot be replayed");
  reset(); database.exec("UPDATE project_items SET status='Review'"); await reject(input(),/Статус изменился/);
  reset(); database.exec("UPDATE project_poll_state SET last_attempt_state='failed'"); await reject(input(),/Синхронизация/);
  reset(); database.exec("UPDATE project_items SET present=0"); await reject(input(),/Карточка/);
  reset(); await reject({...input(),target:"Arbitrary"},/Статусы/); await reject({...input(),itemId:["PVTI_item"] as unknown as string},/Некорректный/);
  reset(); instant=new Date(Date.parse(at)+121_000); await reject(input(),/Синхронизация/);
  reset(); database.exec("UPDATE project_items SET content_type='DraftIssue',repository=NULL"); remote.kind="DraftIssue"; remote.repository=null;
  assert.equal((await requestProjectStatus(input(),"owner",options)).state,"awaiting_sync","draft management remains possible without a run");

  let authorized=false; let outbound=0;
  const server=createProjectsServer({authorize:async()=>authorized?"owner":null,snapshot:()=>collectProjectsSnapshot({home,now:instant}),statusChange:async()=>{outbound++;return {state:"awaiting_sync",requestId:"fixture",target:"Doing"};}});
  await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const headers={Origin:"https://projects.shagon1k.win","Content-Type":"application/json"};
  const post=(extra:Record<string,string>={},body=JSON.stringify(input()))=>fetch(base+"/api/status",{method:"POST",headers:{...headers,...extra},body});
  try {
    assert.equal((await post()).status,403); authorized=true;
    assert.equal((await post({Origin:"https://evil.example"})).status,403);
    assert.equal((await post({"Content-Type":"text/plain"})).status,403);
    assert.equal((await post({"Sec-Fetch-Site":"cross-site"})).status,403);
    assert.equal((await post({},"not json")).status,400); assert.equal((await post({},"x".repeat(5000))).status,413);
    assert.equal(outbound,0); assert.equal((await post()).status,202); assert.equal(outbound,1);
  } finally { await new Promise<void>(done=>server.close(()=>done())); }

  // Verify the concrete CLI transport against GraphQL-shaped fixtures, including echo identity.
  const transportGh=join(home,"bin/transport-gh"); const transportResponse=join(home,"transport.json");
  writeFileSync(transportGh,`#!${process.execPath}\nimport {readFileSync} from 'node:fs';const args=process.argv.slice(2);const variable=name=>args.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);const query=variable('query');if(query.includes('mutation ProjectsStatus'))process.stdout.write(JSON.stringify({data:{updateProjectV2ItemFieldValue:{clientMutationId:variable('mutationId'),projectV2Item:{id:variable('item')}}}}));else process.stdout.write(readFileSync(process.env.FIXTURE_TRANSPORT,'utf8'));\n`,{mode:0o700});
  const oldGh=process.env.KURAMI_GH_BIN; process.env.KURAMI_GH_BIN=transportGh; process.env.FIXTURE_TRANSPORT=transportResponse;
  try {
    writeFileSync(transportResponse,JSON.stringify({data:{user:{projectV2:{id:"PVT_project",field:{id:"PVTSSF_field",options:remoteTemplate.options}}},node:{id:"PVTI_item",isArchived:false,updatedAt:at,project:{id:"PVT_project"},content:{__typename:"Issue",repository:{nameWithOwner:"Example/Alpha"}},fieldValueByName:{name:"Backlog",optionId:"opt_backlog",field:{id:"PVTSSF_field"}}}}}));
    assert.deepEqual(await githubProjectFields.read({owner:"Example",number:1,fieldName:"Status",itemId:"PVTI_item"}),remoteTemplate);
    await githubProjectFields.write({projectId:"PVT_project",fieldId:"PVTSSF_field",itemId:"PVTI_item",optionId:"opt_active",mutationId:"fixture"});
    const inconsistent=JSON.parse(readFileSync(transportResponse,"utf8"));
    inconsistent.data.node.fieldValueByName.optionId="opt_done";
    writeFileSync(transportResponse,JSON.stringify(inconsistent));
    await assert.rejects(githubProjectFields.read({owner:"Example",number:1,fieldName:"Status",itemId:"PVTI_item"}),/identity unavailable/);
    writeFileSync(transportResponse,JSON.stringify({errors:[{message:"private GitHub detail"}],data:{}}));
    await assert.rejects(githubProjectFields.read({owner:"Example",number:1,fieldName:"Status",itemId:"PVTI_item"}),/unavailable/);
  } finally { if(oldGh===undefined) delete process.env.KURAMI_GH_BIN; else process.env.KURAMI_GH_BIN=oldGh; delete process.env.FIXTURE_TRANSPORT; }
} finally { database.close();rmSync(home,{recursive:true,force:true}); }
console.log("Projects status: guarded GitHub writes, durable retries, uncertain recovery, normal poller exactly once, conflicts, drafts, CLI transport and owner/CSRF boundaries verified");
