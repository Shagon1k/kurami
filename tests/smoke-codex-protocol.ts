// Real installed Codex harness + a local Responses fixture: no OpenAI/GitHub credentials or writes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { executeManagedTask } from "../src/orchestrator/integrations/codex/managed-worker.ts";
import { AppServerClient } from "../src/orchestrator/integrations/codex/app-server.ts";
import { taskForSession, recordTurnCompleted } from "../src/orchestrator/integrations/codex/task-store.ts";
import { protocolRepository } from "./fixtures/protocol-repository.ts";

const f=protocolRepository();
let requests=0;
const server=createServer((request,response)=>{
  assert.equal(request.headers.authorization,undefined,"Smoke provider must receive no credential");
  let body="";
  request.on("data",(chunk)=>body+=chunk);
  request.on("end",()=>{
    const input=JSON.parse(body);assert.equal(input.model,"local-smoke");requests++;
    const item={id:"msg_smoke",type:"message",status:"completed",role:"assistant",phase:"final_answer",
      content:[{type:"output_text",text:"Local protocol smoke completed.",annotations:[]}]};
    const result={id:"resp_smoke",object:"response",created_at:1,status:"completed",
      output:[item],usage:{input_tokens:10,output_tokens:5,total_tokens:15}};
    response.writeHead(200,{"content-type":"text/event-stream"});
    for(const event of [
      {type:"response.created",response:{...result,status:"in_progress",output:[]}},
      {type:"response.output_item.added",output_index:0,item:{...item,status:"in_progress",content:[]}},
      {type:"response.content_part.added",item_id:item.id,output_index:0,content_index:0,part:{type:"output_text",text:"",annotations:[]}},
      {type:"response.output_text.delta",item_id:item.id,output_index:0,content_index:0,delta:item.content[0]!.text},
      {type:"response.output_text.done",item_id:item.id,output_index:0,content_index:0,text:item.content[0]!.text},
      {type:"response.content_part.done",item_id:item.id,output_index:0,content_index:0,part:item.content[0]},
      {type:"response.output_item.done",output_index:0,item},
      {type:"response.completed",response:result},
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
});
await new Promise<void>((done)=>server.listen(0,"127.0.0.1",done));
try {
  const port=(server.address() as {port:number}).port;
  const home=resolve(f.root,"codex-home");mkdirSync(home);
  writeFileSync(resolve(home,"config.toml"),`model="local-smoke"
model_provider="smoke"
model_reasoning_effort="low"
[model_providers.smoke]
name="Local smoke"
base_url="http://127.0.0.1:${port}/v1"
wire_api="responses"
requires_openai_auth=false
supports_websockets=false
`,{mode:0o600});
  const bin=process.env.PROTOCOL_SMOKE_CODEX_BIN || execFileSync("which",["codex"],{encoding:"utf8"}).trim();
  const version=execFileSync(bin,["--version"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  // Deliberately construct a minimal environment, with no inherited GitHub or Codex credentials.
  const environment={PATH:process.env.PATH,HOME:f.root,CODEX_HOME:home};
  await executeManagedTask(f.database,f.task,{codexBin:bin,cwd:f.worktree,canonicalRepository:f.canonical,
    prompt:"Reply with a short statement. Do not use tools or change any files.",title:"Local protocol smoke",
    timeoutMs:30_000,environment,onError:(error)=>{process.stderr.write(String(error)+"\n");}});
  const task=taskForSession(f.database,f.task.session_name)!;
  assert.equal(task.turn_status,"completed",JSON.stringify(task));
  assert.equal(task.failure_code,null,JSON.stringify(task));assert.ok(task.stopped_at);
  assert.ok(requests>0);
  assert.equal(task.final_summary,"Local protocol smoke completed.","Real app-server final_answer is durably retained");
  const client=new AppServerClient(bin,{environment,rejectServerRequests:true});
  try {
    await client.initialize();
    const history=await client.request("thread/read",{threadId:task.thread_id,includeTurns:true}) as {
      thread:{id:string;turns:Array<{id:string;status:string}>};
    };
    assert.equal(history.thread.id,task.thread_id);
    const turn=history.thread.turns.find((turn)=>turn.id===task.turn_id);
    assert.equal(turn?.status,"completed");
    recordTurnCompleted(f.database,task.task_id,{method:"turn/completed",params:{threadId:task.thread_id,turn}});
    assert.equal((f.database.prepare("SELECT COUNT(*) n FROM run_codex_task_events").get() as {n:number}).n,1);
  } finally {await client.shutdown();}
  assert.equal(execFileSync("git",["-C",f.worktree,"status","--porcelain"],{encoding:"utf8"}),"");
  assert.equal(execFileSync("git",["-C",f.worktree,"remote"],{encoding:"utf8"}),"");
  process.stdout.write(JSON.stringify({ok:true,version,realAppServer:true,localProvider:true,
    exactThreadTurn:true,completed:true,historyReplay:true,githubWrites:0,credentialsUsed:false})+"\n");
} finally {
  await new Promise<void>((done)=>server.close(()=>done()));
  f.database.close();rmSync(f.root,{recursive:true,force:true});
}
