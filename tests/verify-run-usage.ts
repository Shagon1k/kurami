import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,readFileSync,readdirSync,rmSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {collectRunUsage} from "../src/orchestrator/projects/usage/collector.ts";
import {readRunUsage} from "../src/orchestrator/projects/usage/read-model.ts";
import {collectProjectsSnapshot} from "../src/projects-site/snapshot.ts";
import {renderProjectsPage} from "../src/projects-site/render.ts";
import {renderRunUsage,renderUsageSummary} from "../src/projects-site/usage.ts";

const home=mkdtempSync(join(tmpdir(),"kurami-run-usage-"));
mkdirSync(join(home,"state"));
const db=new DatabaseSync(join(home,"state/orchestrator.db"));
const codexHome=join(home,"codex");mkdirSync(join(codexHome,"sessions"),{recursive:true});
const codex=new DatabaseSync(join(codexHome,"state_5.sqlite"));codex.exec("CREATE TABLE threads(id TEXT,rollout_path TEXT)");
const time="2026-11-01T00:00:00.000Z",end="2026-11-01T01:00:00.000Z";
let ticks=0,checks=0;
const equal=(a:unknown,b:unknown,message:string)=>{assert.deepEqual(a,b,message);checks++;};
try {
  for(const name of readdirSync(resolve("migrations")).filter(name=>name.endsWith(".sql")).sort())db.exec(readFileSync(resolve("migrations",name),"utf8"));
  function run(id:string,thread:string|null,state="failed"){
    db.prepare("INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json) VALUES(?,?,'p',?,'Issue','{}')").run(id,time,id);
    db.prepare(`INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,created_at,updated_at)
      VALUES(?,?,'p',?,?,'Example/Project',1,'autonomous',?,?,?)`).run(id,id,id,id,state,time,end);
    db.prepare("INSERT INTO run_resources(run_id,codex_thread_id,created_at) VALUES(?,?,?)").run(id,thread,time);
    db.prepare("INSERT INTO run_state_history(run_id,to_state,reason,occurred_at) VALUES(?,?,'fixture',?)").run(id,state,end);
  }
  function log(id:string,events:unknown[]){
    const path=join(codexHome,"sessions",id+".jsonl");
    writeFileSync(path,[{timestamp:time,type:"session_meta",payload:{id}},...events].map(event=>JSON.stringify(event)).join("\n")+"\n");
    codex.prepare("INSERT INTO threads VALUES(?,?)").run(id,path);return path;
  }
  const context=(model="gpt-5.3-codex")=>({timestamp:time,type:"turn_context",payload:{model}});
  const count=(input=100,cached=40,output=10,at="2026-11-01T00:30:00.000Z",last={input_tokens:input,cached_input_tokens:cached,output_tokens:output,cache_write_input_tokens:0})=>({timestamp:at,type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{input_tokens:input,cached_input_tokens:cached,output_tokens:output,cache_write_input_tokens:0,reasoning_output_tokens:7},last_token_usage:last}}});
  const tick=()=>collectRunUsage(db,{home:codexHome,now:new Date(Date.parse(end)+(++ticks)*3600_000),maxSessions:100,chunkBytes:2048});
  run("one","first");
  const first=log("first",[context(),count(),count(),{timestamp:time,type:"token_usage_record",payload:{usage:{input_tokens:100,cached_input_tokens:40,output_tokens:10}}}]);
  await tick();
  let value=readRunUsage(db,"one");
  equal([value.state,value.input,value.cached,value.output],["complete",100,40,10],"cumulative and request streams, reasoning and duplicate notifications counted once");
  equal(value.elapsedMs,3600_000,"elapsed uses durable lifecycle timestamps");
  assert.ok(Math.abs(value.usd!-.000252)<1e-10);checks++;
  await tick();equal(readRunUsage(db,"one"),{...value,checkedAt:readRunUsage(db,"one").checkedAt},"idempotent repeated collection");
  appendFileSync(first,JSON.stringify(count(150,50,20,undefined,{input_tokens:50,cached_input_tokens:10,output_tokens:10,cache_write_input_tokens:0}))+"\n");
  await tick();equal(readRunUsage(db,"one").input,150,"late appended cumulative delta");
  rmSync(first);await tick();value=readRunUsage(db,"one");
  equal([value.state,value.input],["partial",150],"durable totals survive source deletion");
  run("turns","resumed");
  const activity=(type:string,turn_id:string,timestamp:string)=>({timestamp,type:"event_msg",payload:{type,turn_id}});
  log("resumed",[context(),activity("task_started","t1","2026-11-01T00:01:00Z"),count(),activity("task_complete","t1","2026-11-01T00:31:00Z"),
    activity("task_started","t2","2026-11-01T00:32:00Z"),count(150,50,20,undefined,{input_tokens:50,cached_input_tokens:10,output_tokens:10,cache_write_input_tokens:0}),activity("turn_aborted","t2","2026-11-01T00:59:00Z")]);
  await tick();value=readRunUsage(db,"turns");
  equal([value.attempts,value.sessions[0]?.elapsedMs,value.sessions[0]?.outcome,value.input],[2,58*60_000,"cancelled",150],"resumed turns counted once each, session elapsed includes waiting, interruption retained");
  run("unknown","models","cancelled");log("models",[context(),count(),context("unknown-tariff"),count(150,50,20,undefined,{input_tokens:50,cached_input_tokens:10,output_tokens:10,cache_write_input_tokens:0})]);
  await tick();value=readRunUsage(db,"unknown");
  equal([value.models.length,value.unpriced,value.input],[2,60,150],"model changes retain known subtotal and missing tariff coverage");
  run("only-unknown","no-rate");log("no-rate",[context("no-tariff"),count()]);await tick();equal(readRunUsage(db,"only-unknown").usd,null,"unknown tariff never becomes zero USD");
  run("missing","absent");await tick();equal([readRunUsage(db,"missing").state,readRunUsage(db,"missing").input],["unavailable",null],"missing log is not zero");
  run("empty","empty-log");log("empty-log",[context()]);await tick();equal(readRunUsage(db,"empty").input,null,"no usage event is not zero");
  run("partial","partial-log");const partial=log("partial-log",[context(),count()]);appendFileSync(partial,'{"type":"event_msg"');await tick();equal(readRunUsage(db,"partial").state,"partial","partial trailing line remains incomplete");
  appendFileSync(partial,',"timestamp":"2026-11-01T00:35:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":150,"cached_input_tokens":50,"output_tokens":20},"last_token_usage":{"input_tokens":50,"cached_input_tokens":10,"output_tokens":10}}}}\n');
  await tick();equal(readRunUsage(db,"partial").input,150,"incomplete line resumes without loss or double count");
  run("shared-a","shared");log("shared",[context(),count()]);await tick();equal(readRunUsage(db,"shared-a").input,100,"sole binding counted");
  run("shared-b","shared");equal(readRunUsage(db,"shared-a").input,null,"shared identity excluded immediately, before bounded discovery catches up");await tick();equal([readRunUsage(db,"shared-a").input,readRunUsage(db,"shared-b").input],[null,null],"cross-run shared/resumed thread excluded from both, including stored totals");
  run("truncated","truncated-log");log("truncated-log",[context(),count(500,100,100,undefined,{input_tokens:50,cached_input_tokens:10,output_tokens:10,cache_write_input_tokens:0})]);await tick();
  equal([readRunUsage(db,"truncated").state,readRunUsage(db,"truncated").input],["partial",50],"first cumulative lifetime total cannot charge previous turns twice");
  run("reset","reset-log");log("reset-log",[context(),count(),count(50,10,5),count(100,20,10,undefined,{input_tokens:50,cached_input_tokens:10,output_tokens:5,cache_write_input_tokens:0})]);await tick();
  equal([readRunUsage(db,"reset").state,readRunUsage(db,"reset").input],["partial",100],"an ambiguous cumulative reset freezes that stream instead of counting possible replay twice");
  run("reprocess","replace");const replace=log("replace",[context(),count()]);await tick();
  writeFileSync(replace,[{timestamp:time,type:"session_meta",payload:{id:"replace"}},context(),count(200,80,20)].map(row=>JSON.stringify(row)).join("\n")+"\n");await tick();
  equal(readRunUsage(db,"reprocess").input,200,"replacement reprocesses instead of adding old totals");
  writeFileSync(replace,"");await tick();equal([readRunUsage(db,"reprocess").input,readRunUsage(db,"reprocess").state],[200,"partial"],"log truncation to empty preserves the last durable measurements");
  run("unfinished","unfinished-log");log("unfinished-log",[context(),activity("task_started","unfinished-turn",time),count()]);await tick();equal(readRunUsage(db,"unfinished").state,"partial","a missing terminal activity event is partial even with a final newline");
  run("tail","tail-log");log("tail-log",[context(),count(),{timestamp:time,type:"token_usage_record",payload:{usage:{input_tokens:200,cached_input_tokens:40,output_tokens:20}}}]);await tick();
  equal([readRunUsage(db,"tail").state,readRunUsage(db,"tail").input],["partial",100],"unpaired request tail cannot masquerade as complete cumulative coverage");
  run("identity","wrong-file");const wrong=log("wrong-file",[context(),count()]);writeFileSync(wrong,readFileSync(wrong,"utf8").replace('"id":"wrong-file"','"id":"other-thread"'));await tick();equal(readRunUsage(db,"identity").input,null,"source session identity must match thread binding");
  run("bad-count","bad-count-log");log("bad-count-log",[context(),count(10,20,1)]);await tick();equal(readRunUsage(db,"bad-count").input,null,"invalid cached subset rejected");
  run("window","window-log");log("window-log",[context(),count(100,40,10,"2026-10-31T23:00:00Z"),count(150,50,20,undefined,{input_tokens:50,cached_input_tokens:10,output_tokens:10,cache_write_input_tokens:0}),count(200,60,30,"2026-11-01T02:00:00Z")]);await tick();equal(readRunUsage(db,"window").input,50,"run timestamps fence prior and later thread activity");
  run("escape","escape");const outside=join(home,"outside.jsonl");writeFileSync(outside,"secret");symlinkSync(outside,join(codexHome,"sessions/escape.jsonl"));codex.prepare("INSERT INTO threads VALUES('escape',?)").run(join(codexHome,"sessions/escape.jsonl"));await tick();equal(readRunUsage(db,"escape").input,null,"symlink escapes rejected");
  run("bounded","large");log("large",[context(),...Array.from({length:50},(_,i)=>count((i+1)*100,(i+1)*40,(i+1)*10,undefined,{input_tokens:100,cached_input_tokens:40,output_tokens:10,cache_write_input_tokens:0}))]);
  const before=await collectRunUsage(db,{home:codexHome,now:new Date(Date.parse(end)+(++ticks)*3600_000),maxSessions:1,chunkBytes:2048});equal(before,1,"bounded sessions per tick");
  for(let i=0;i<30;i++)await tick();equal(readRunUsage(db,"bounded").input,5000,"durable cursor completes multi-chunk logs");
  // Reclassify an implementation alias when a technical identity becomes known.
  db.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name,thread_id,phase)
    VALUES('task','one','ci_repair','attempt','session','/tmp/fixture','fixture','first','terminal')`).run();
  await tick();equal(readRunUsage(db,"one").sessions[0]?.stage,"fix_ci","technical phase wins over resource/history alias");
  run("review-stage","review-impl");log("review-impl",[context(),count()]);log("review-worker",[context(),count()]);
  db.prepare("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state) VALUES('review-request','review-stage','ai_review','cli','review-request','applied')").run();
  db.prepare(`INSERT INTO run_ai_reviews(review_id,run_id,request_id,review_number,review_state,repository,pull_request_number,pull_request_url,base_ref,base_sha,head_sha,tmux_session_name,codex_thread_id,codex_turn_status,codex_turn_id)
    VALUES('review','review-stage','review-request',1,'failed','Example/Project',1,'https://github.com/Example/Project/pull/1','main','aaaaaaa','bbbbbbb','review-tmux','review-worker','failed','review-turn')`).run();
  log("fix-worker",[context(),count()]);
  db.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name,thread_id,phase,turn_id,turn_status)
    VALUES('fix-task','review-stage','review_fix','fix-round','fix-session','/tmp/fixture','fixture','fix-worker','terminal','fix-turn','completed')`).run();
  await tick();value=readRunUsage(db,"review-stage");
  equal(value.sessions.map(row=>row.stage).sort(),["fix_review","implementation","review"],"implementation, independent review and review-fix stages persisted separately");
  equal(value.sessions.find(row=>row.stage==="review")?.outcome,"failed","protocol failed review outcome retained independently of token availability");
  equal(value.input,300,"multiple stage sessions sum once");
  db.prepare("DELETE FROM run_usage_sessions WHERE run_id='review-stage' AND thread_id='review-worker'").run();
  equal(readRunUsage(db,"review-stage").state,"partial","undiscovered stage bindings keep a partially backfilled run incomplete");
  await tick();
  db.prepare("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state) VALUES('missing-request','review-stage','ai_review','cli','missing-request','applied')").run();
  db.prepare(`INSERT INTO run_ai_reviews(review_id,run_id,request_id,review_number,review_state,repository,pull_request_number,pull_request_url,base_ref,base_sha,head_sha,tmux_session_name)
    VALUES('missing-review','review-stage','missing-request',2,'failed','Example/Project',1,'https://github.com/Example/Project/pull/1','main','aaaaaaa','bbbbbbb','missing-review-tmux')`).run();
  equal([readRunUsage(db,"review-stage").state,readRunUsage(db,"review-stage").attempts],["partial",4],"failed attempt without a thread is counted and incomplete");
  value=readRunUsage(db,"unknown");
  for(const lang of ["en","ru"] as const){
    const html=renderRunUsage(value,lang);
    assert.match(html,lang==="ru"?/Использование и стоимость/:/Usage & cost/);assert.match(html,/Standard|стандартного/);assert.match(html,/\*/);assert.match(html,/data-disclosure-key="run-usage-models"/);
    assert.doesNotMatch(html,/state_5|rollout_path|checkpoint|<script/);checks+=5;
    assert.match(renderUsageSummary(value,lang),lang==="ru"?/эквивалента API/:/API-equivalent estimate/);checks++;
    assert.match(renderRunUsage(readRunUsage(db,"missing"),lang),/—/);checks++;
  }
  const unsafe=structuredClone(value);unsafe.models[0]!.model='<script>alert(1)</script>';
  assert.doesNotMatch(renderRunUsage(unsafe,"en"),/<script>/);checks++;
  const stored=db.prepare("SELECT checkpoint_json,snapshot_json FROM usage_sessions").all();
  assert.doesNotMatch(JSON.stringify(stored),/secret|rollout_path|token_count|last_token_usage/);checks++;
  mkdirSync(join(home,"config"));
  writeFileSync(join(home,"config/projects.yaml"),JSON.stringify({projects:{p:{owner:"Example",project_number:1,repository:"Example/Project",
    statuses:{backlog:"Todo",active:"Doing",review:"Review",done:"Done",deferred:"Later"},discord:{guild_id:"100",channel_id:"101"}}}}));
  db.prepare(`INSERT INTO project_items(project,item_id,content_type,repository,issue_number,title,url,status,present,first_seen_at,last_seen_at)
    VALUES('p','unknown','Issue','Example/Project',1,'Usage fixture','https://github.com/Example/Project/issues/1','Done',1,?,?)`).run(time,end);
  const dashboard=collectProjectsSnapshot({home,now:new Date(end),controlsEnabled:false,statusEnabled:false});
  equal([dashboard.available,dashboard.items[0]?.usage?.input,dashboard.items[0]?.usage?.unpriced],[true,150,60],"Projects read-only snapshot includes the collected usage and pricing gaps");
  for(const lang of ["en","ru"] as const){
    const page=renderProjectsPage(dashboard,new URLSearchParams(`item=unknown&remaining=0&lang=${lang}`));
    assert.match(page,/data-run-usage/);assert.match(page,/projects-usage-summary/);checks+=2;
  }
  const reopened=new DatabaseSync(join(home,"state/orchestrator.db"),{readOnly:true});
  equal(readRunUsage(reopened,"one").input,150,"a fresh read-only connection retains totals after source deletion");reopened.close();
  run("missing-start","missing-start-log");log("missing-start-log",[context(),activity("task_started","a",time),count(),activity("task_complete","a",end),activity("task_complete","b",end)]);
  await tick();equal(readRunUsage(db,"missing-start").sessions[0]?.elapsedMs,null,"missing start for any turn cannot produce a reliable session elapsed time");
  for(let i=0;i<101;i++)run(`aaa-invalid-${i}`,`invalid/${i}`);
  run("zzz-valid","valid-after-invalid");log("valid-after-invalid",[context(),count()]);await tick();
  equal(readRunUsage(db,"zzz-valid").input,100,"invalid identities cannot starve bounded discovery of valid sessions");
  const old=new DatabaseSync(":memory:");old.exec("CREATE TABLE runs(run_id TEXT,state TEXT,created_at TEXT,archived_at TEXT)");
  equal(readRunUsage(old,"no-run").state,"unavailable","old schema read remains unavailable without migration writes");old.close();
  console.log(`Run usage: ${checks} checks passed (durability, deduplication, late logs, boundaries, tariffs, UI and bounded reprocessing)`);
}finally{codex.close();db.close();rmSync(home,{recursive:true,force:true});}
