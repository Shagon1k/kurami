import assert from "node:assert/strict";
import {appendFileSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from "node:fs";
import {request} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {collectHubSnapshot} from "../../src/hub/snapshot.ts";
import {createHubServer} from "../../src/hub/server.ts";
import {renderHubPage} from "../../src/hub/render.ts";

const home=mkdtempSync(join(tmpdir(),"kurami-hub-test-"));
try {
  mkdirSync(join(home,"config"));mkdirSync(join(home,"state"));
  writeFileSync(join(home,"config/projects.yaml"),`version: 1
projects:
  pickflick:
    owner: Shagon1k
    project_number: 3
    repository: Shagon1k/PickFlick
    statuses: {backlog: Backlog, active: In progress, review: Human Review, done: Done, deferred: Deferred}
    workspace: {canonical_repository: /does/not/exist, base_branch: main}
`);
  const db=new DatabaseSync(join(home,"state/orchestrator.db"));
  db.exec(`CREATE TABLE project_items(project TEXT,status TEXT,present INTEGER);
    CREATE TABLE runs(run_id TEXT,project TEXT,state TEXT);
    CREATE TABLE run_ci_snapshots(run_id TEXT,aggregate_state TEXT);
    CREATE TABLE project_poll_state(project TEXT,last_captured_at TEXT,last_attempt_state TEXT);
    INSERT INTO project_items VALUES('pickflick','Backlog',1),('pickflick','Human Review',1),('pickflick','Done',0);
    INSERT INTO runs VALUES('run1','pickflick','running'),('run2','pickflick','waiting_human');
    INSERT INTO run_ci_snapshots VALUES('run1','passed');
    INSERT INTO project_poll_state VALUES('pickflick','2026-09-29T20:59:00Z','succeeded');`);
  db.close();
  const codexHome=join(home,"codex");
  mkdirSync(join(codexHome,"sessions"),{recursive:true});
  const rollout=join(codexHome,"sessions","rollout-test.jsonl");
  const olderRollout=join(codexHome,"sessions","rollout-older.jsonl");
  writeFileSync(rollout,[
    JSON.stringify({timestamp:"2026-09-28T10:30:00Z",type:"token_usage_record",payload:{usage:{input_tokens:700,cached_input_tokens:300,output_tokens:300,total_tokens:1000}}}),
    JSON.stringify({timestamp:"2026-09-28T10:30:01Z",type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{input_tokens:700,cached_input_tokens:300,output_tokens:300,total_tokens:1000}}}}),
    JSON.stringify({timestamp:"2026-09-29T20:59:00Z",type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{input_tokens:700,cached_input_tokens:300,output_tokens:300,total_tokens:1000}},rate_limits:{limit_id:"codex",primary:{used_percent:37,window_minutes:300,resets_at:1790726400},secondary:{used_percent:55,window_minutes:10080,resets_at:1791093664}}}}),
  ].join("\n")+"\n");
  writeFileSync(olderRollout,[
    JSON.stringify({timestamp:"2026-09-10T10:30:00Z",type:"token_usage_record",payload:{usage:{input_tokens:400,cached_input_tokens:200,output_tokens:100,total_tokens:500}}}),
    JSON.stringify({timestamp:"2026-09-10T10:30:01Z",type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{input_tokens:400,cached_input_tokens:200,output_tokens:100,total_tokens:500}}}}),
  ].join("\n")+"\n");
  const codexDb=new DatabaseSync(join(codexHome,"state_5.sqlite"));
  codexDb.exec("CREATE TABLE threads(created_at INTEGER,updated_at INTEGER,tokens_used INTEGER,model TEXT,rollout_path TEXT)");
  codexDb.prepare("INSERT INTO threads VALUES(?,?,?,?,?)").run(Date.parse("2026-09-28T10:00:00Z")/1000,Date.parse("2026-09-29T20:59:00Z")/1000,1000,"gpt-6-sol",rollout);
  codexDb.prepare("INSERT INTO threads VALUES(?,?,?,?,?)").run(Date.parse("2026-09-10T10:00:00Z")/1000,Date.parse("2026-09-10T11:00:00Z")/1000,500,"gpt-6-luna",olderRollout);
  codexDb.close();
  const snapshot=collectHubSnapshot({home,appRepository:join(home,"missing"),codexHome,now:new Date("2026-09-29T21:00:00Z")});
  assert.equal(snapshot.sources.orchestrator,"available");
  assert.equal(snapshot.sources.git,"unavailable");
  assert.equal(snapshot.projects[0]?.board?.review,1);
  assert.equal(snapshot.projects[0]?.board?.done,0,"absent Project items are excluded");
  assert.equal(snapshot.projects[0]?.runs?.working,1);
  assert.equal(snapshot.projects[0]?.runs?.attention,1);
  assert.equal(snapshot.projects[0]?.poll.state,"fresh");
  assert.equal(snapshot.projects[1]?.managed,false,"Kurami is not an orchestrator project");
  assert.equal(snapshot.weeks.length,12);
  assert.equal(snapshot.codex.tokens7,1000);
  assert.equal(snapshot.codex.tokens30,1500);
  assert.equal(snapshot.codex.cached30,500);
  assert.equal(snapshot.codex.output30,400);
  assert.equal(snapshot.codex.sessions30,2);
  assert.equal(snapshot.codex.coverage,"complete");
  assert.equal(snapshot.codex.limits[0]?.remainingPercent,63);
  assert.equal(snapshot.codex.limits[1]?.windowMinutes,10080);
  appendFileSync(rollout,JSON.stringify({timestamp:"2026-09-29T21:01:00Z",type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{input_tokens:790,cached_input_tokens:320,output_tokens:310,total_tokens:1100}}}})+"\n");
  const incremental=collectHubSnapshot({home,appRepository:join(home,"missing"),codexHome,now:new Date("2026-09-29T21:02:00Z")});
  assert.equal(incremental.codex.tokens7,1100,"appended log usage is counted once");
  assert.equal(incremental.codex.cached30,520);
  const stale=collectHubSnapshot({home,appRepository:join(home,"missing"),codexHome,now:new Date("2026-09-29T21:20:00Z")});
  assert.equal(stale.projects[0]?.poll.state,"stale");
  const page=renderHubPage(snapshot);
  assert.match(page,/Kurami Hub/);
  assert.match(page,/37% использовано/);
  assert.match(page,/63% осталось/);
  assert.match(page,/Git · нет данных/,"missing Git data is not rendered as a zero trend");
  assert.doesNotMatch(page,/Твоя система|Источник ещё не подключён|Это активность в Git/);
  assert.match(page,/manifest.webmanifest/);
  assert.doesNotMatch(page,/\/does\/not\/exist/,"local paths never reach the page");

  const server=createHubServer({snapshot:()=>snapshot});
  await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
  const port=(server.address() as {port:number}).port;
  async function get(path:string,method="GET"){
    return new Promise<{status:number;body:string;headers:Record<string,string|string[]|undefined>}>((done,reject)=>{
      const req=request({hostname:"127.0.0.1",port,path,method},response=>{
        const chunks:Buffer[]=[];response.on("data",chunk=>chunks.push(chunk));response.on("end",()=>done({status:response.statusCode??0,body:Buffer.concat(chunks).toString(),headers:response.headers}));
      });req.on("error",reject);req.end();
    });
  }
  try {
    const homePage=await get("/");
    assert.equal(homePage.status,200);
    assert.equal(homePage.headers["cache-control"],"no-store");
    assert.match(homePage.body,/PickFlick/);
    assert.equal((await get("/api/fragment")).status,200);
    assert.equal((await get("/manifest.webmanifest")).status,200);
    assert.equal((await get("/sw.js")).status,200);
    assert.equal((await get("/assets/hub.css","HEAD")).body,"");
    assert.equal((await get("/state/orchestrator.db")).status,404);
    assert.equal((await get("/", "POST")).status,405);
    assert.equal((await get("/health")).body,'{"ok":true}');
  } finally {server.close();}
} finally {rmSync(home,{recursive:true,force:true});}
console.log("Hub snapshot, rendering, PWA assets and HTTP boundary verified");
