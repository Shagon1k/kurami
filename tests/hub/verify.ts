import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {appendFileSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {request} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {collectHubSnapshot} from "../../src/hub/snapshot.ts";
import {createHubServer} from "../../src/hub/server.ts";
import {renderHubPage,renderHubDashboard,ideasReminder} from "../../src/hub/render.ts";
import {compactNumber} from "../../src/hub/format.ts";
import {createProjectStore} from "./project-store.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";

const home=mkdtempSync(join(tmpdir(),"kurami-hub-test-"));
for(const [remaining,tone]of [[20.1,'neutral'],[20,'warning'],[0.1,'warning'],[0,'failure']] as const){
  const fixture=syntheticHubSnapshot();fixture.codex.limits[0]!.remainingPercent=remaining;
  assert.match(renderHubDashboard(fixture),new RegExp(`<article class="limit" data-tone="${tone}"`));
}
// Project colours: the project table and the activity feed carry each project's hue (the left bar).
{
  const fixture=syntheticHubSnapshot(),page=renderHubDashboard(fixture),first=fixture.projects[0]!;
  assert.ok(first.color,"fixture projects have a hue");
  assert.match(page,new RegExp(`<tr class="project-row project-color--${first.color}">`),"project table row");
  // Phones read the table as cards: the library stack layout, each figure with its column label.
  assert.match(page,/<div class="table table--stack project-table"/,"the project table stacks on phones");
  assert.match(page,/<td><span class="table__label" aria-hidden="true">Commits<\/span>/,"each figure keeps its column label");
  assert.match(page,new RegExp(`<li class="work-item project-color--${first.color}"[^>]*data-work-project="${first.key}"`),"activity item");
  assert.match(page,/<li class="work-item" [^>]*data-work-project="kurami"/,"Kurami's own work has no project hue");
}
// Ideas reminder: only when open ideas exist and none was touched for a week; it links to the pool in Projects.
{
  const fixture=syntheticHubSnapshot();fixture.generatedAt="2026-10-20T10:00:00Z";
  assert.equal(ideasReminder({...fixture,ideas:null},"ru"),"","no pool, no line");
  assert.equal(ideasReminder({...fixture,ideas:{open:0,touchedAt:"2026-10-01T10:00:00Z"}},"ru"),"","no open ideas, no line");
  assert.equal(ideasReminder({...fixture,ideas:{open:3,touchedAt:"2026-10-15T10:00:00Z"}},"ru"),"","touched this week, no line");
  assert.match(ideasReminder({...fixture,ideas:{open:3,touchedAt:"2026-10-11T09:00:00Z"}},"ru"),/<a class="hub__pulse-ideas" href="[^"]*projects\/#projects-ideas">3 идеи без движения 9 дн\.<\/a>/);
  assert.match(ideasReminder({...fixture,ideas:{open:1,touchedAt:"2026-10-01T10:00:00Z"}},"en"),/1 idea untouched for 19 days/);
  assert.match(renderHubDashboard({...fixture,ideas:{open:5,touchedAt:"2026-10-01T10:00:00Z"}},"ru"),/class="hub__pulse"[^>]*>.*5 идей без движения 19 дн\./,"the line sits in the pulse");
}
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
  createProjectStore(db);
  db.exec(`INSERT INTO project_items VALUES('pickflick','item1','Backlog',1),('pickflick','item2','Human Review',1),('pickflick','item3','Done',0);
    INSERT INTO runs VALUES('run1','pickflick',1,'Shagon1k/PickFlick','item1','running','2026-09-29T20:59:00Z'),('run2','pickflick',2,'Shagon1k/PickFlick','item2','waiting_human','2026-09-29T20:59:00Z');
    INSERT INTO run_ci_snapshots(run_id,aggregate_state) VALUES('run1','passed');
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
  assert.equal(snapshot.codex.periods?.[7].cached,300);
  assert.equal(snapshot.codex.periods?.[7].output,300);
  assert.equal(snapshot.codex.periods?.[7].sessions,1);
  assert.deepEqual(snapshot.codex.periods?.[7].models,[{name:"gpt-6-sol",sessions:1}]);
  assert.equal(snapshot.codex.coverage,"complete");
  assert.equal(snapshot.codex.limits[0]?.remainingPercent,63);
  assert.equal(snapshot.codex.limits[1]?.windowMinutes,10080);
  appendFileSync(rollout,JSON.stringify({timestamp:"2026-09-29T21:01:00Z",type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{input_tokens:790,cached_input_tokens:320,output_tokens:310,total_tokens:1100}}}})+"\n");
  const incremental=collectHubSnapshot({home,appRepository:join(home,"missing"),codexHome,now:new Date("2026-09-29T21:02:00Z")});
  assert.equal(incremental.codex.tokens7,1100,"appended log usage is counted once");
  assert.equal(incremental.codex.cached30,520);
  const stale=collectHubSnapshot({home,appRepository:join(home,"missing"),codexHome,now:new Date("2026-09-29T21:20:00Z")});
  assert.equal(stale.projects[0]?.poll.state,"stale");
  // The managed source copy can have a stale local main and a current origin/main.
  {
    const gitHome=join(home,"git-history"),repo=join(gitHome,"repo");
    mkdirSync(join(gitHome,"config"),{recursive:true});mkdirSync(repo);
    const git=(args:string[],at="2026-09-01T12:00:00Z")=>execFileSync("git",["-C",repo,...args],{
      encoding:"utf8",env:{...process.env,GIT_AUTHOR_DATE:at,GIT_COMMITTER_DATE:at},stdio:["ignore","pipe","pipe"],
    }).trim();
    git(["init","--initial-branch=main"]);
    git(["config","user.name","Hub fixture"]);git(["config","user.email","hub@example.invalid"]);
    git(["-c","core.hooksPath=/dev/null","-c","commit.gpgSign=false","commit","--allow-empty","-m","Old local main"]);
    const localHead=git(["rev-parse","main"]);
    git(["checkout","-b","agent-work"]);
    git(["-c","core.hooksPath=/dev/null","-c","commit.gpgSign=false","commit","--allow-empty","-m","Merged work"],"2026-09-28T12:00:00Z");
    git(["update-ref","refs/remotes/origin/main","HEAD"]);
    git(["-c","core.hooksPath=/dev/null","-c","commit.gpgSign=false","commit","--allow-empty","-m","Unmerged work"],"2026-09-29T12:00:00Z");
    writeFileSync(join(gitHome,"config/projects.yaml"),readFileSync(join(home,"config/projects.yaml"),"utf8").replace("/does/not/exist",repo));
    const collect=()=>collectHubSnapshot({home:gitHome,appRepository:join(home,"missing"),codexHome,now:new Date("2026-09-29T21:00:00Z")});
    const current=collect();
    assert.deepEqual(current.projects[0]!.git,{commits7:1,commits30:2,latestAt:"2026-09-28T12:00:00+00:00",state:"available"},"published base history wins over stale main and unmerged branches");
    assert.equal(current.commitRepositories!.pickflick!.slice(-7).reduce((sum,day)=>sum+day.count,0),1,"the filtered chart agrees with the project count");
    assert.equal(git(["rev-parse","main"]),localHead,"collecting statistics never advances the local branch");
    git(["update-ref","-d","refs/remotes/origin/main"]);
    assert.deepEqual(collect().projects[0]!.git,{commits7:0,commits30:1,latestAt:"2026-09-01T12:00:00+00:00",state:"available"},"a repository without the remote base ref still uses its local branch");
  }
  const page=renderHubPage(snapshot,"ru");
  assert.match(page,/Kurami Hub/);
  assert.match(page,/37% использовано/);
  assert.match(page,/63% осталось/);
  assert.match(page,/Git · нет данных/,"missing Git data is not rendered as a zero trend");
  assert.doesNotMatch(page,/Твоя система|Источник ещё не подключён|Это активность в Git/);
  assert.match(page,/manifest.webmanifest/);
  assert.match(page,/class="site-switcher"/);
  assert.match(page,/href="https:\/\/kurami\.shagon1k\.win\/ru\/docs\/"[^>]*>Docs<\/a>/);
  assert.match(page,/href="\/en\/" aria-label="Переключить на английский" hreflang="en">EN<\/a>/);
  assert.doesNotMatch(page,/class="section links"|aria-label="Ресурсы"/);
  assert.doesNotMatch(page,/\/does\/not\/exist/,"local paths never reach the page");
  const english=renderHubPage(snapshot,"en");
  assert.match(english,/<html lang="en"/);
  assert.match(english,/<h1 class="sr-only">Kurami Hub<\/h1>/);
  assert.doesNotMatch(english,/>Overview</);
  assert.doesNotMatch(english,/>Breakdown</);
  assert.match(english,/>Cached input</);
  assert.match(english,/>Output</);
  assert.match(english,/data-period-key="global" data-period-days="30" aria-pressed="true"/);
  assert.equal((english.match(/class="period-switch"/g)??[]).length,1,"only the sticky header contains a period selector");
  assert.match(english,/title="1,000" aria-label="1,000">1K</);
  assert.equal(compactNumber(3812400),"3.8M");
  assert.equal(compactNumber(1426830000),"1.4B");
  assert.equal(compactNumber(999999),"1M");
  assert.equal(compactNumber(null),"—");
  assert.match(english,/>63% left<\/strong>/);
  assert.match(english,/href="\/ru\/" aria-label="Switch to Russian" hreflang="ru">RU<\/a>/);
  assert.match(english,/href="https:\/\/kurami\.shagon1k\.win\/en\/docs\/"[^>]*>Docs<\/a>/);
  assert.match(english,/href="https:\/\/kurami\.shagon1k\.win\/en\/" aria-current="location">Hub<\/a>/);
  assert.doesNotMatch(english,/Обзор|Лимиты|Коммиты|нет данных|Сброс/);
  const hiddenModel=syntheticHubSnapshot();
  hiddenModel.codex.periods![30].modelUsage!.push({...hiddenModel.codex.periods![30].modelUsage![0]!,name:"codex-auto-review"});
  const hiddenPage=renderHubPage(hiddenModel,"en");
  assert.doesNotMatch(hiddenPage,/codex-auto-review/);
  assert.match(hiddenPage,/>14.3M</,"hiding a model does not remove overall token totals");
  const weekly=syntheticHubSnapshot();
  weekly.codex.limitUsage!.at(-1)!.windows[300]=90;
  const weeklyPage=renderHubDashboard(weekly,"en");
  assert.doesNotMatch(weeklyPage,/>5h</,"retired windows in historical logs are not a live account series");
  assert.doesNotMatch(weeklyPage,/>5 hours</);
  assert.match(weeklyPage,/>7d</);
  const hour={...weekly.codex.limits[0]!,windowMinutes:60};
  weekly.codex.account!.limits=[hour];weekly.codex.limits=[hour];
  weekly.codex.limitUsage!.at(-1)!.windows[60]=25;
  const hourPage=renderHubDashboard(weekly,"en");
  assert.match(hourPage,/class="limit-history__legend"><span data-series="0">1h<\/span><\/div>/,"only the observed active window appears in the legend");
  const attention=syntheticHubSnapshot();
  attention.operations!.alerts=attention.operations!.alerts.map(alert=>({...alert,project:"pickflick",itemId:"item &33"}));
  for(const lang of ["en","ru"] as const){
    const dashboard=renderHubDashboard(attention,lang);
    assert.match(dashboard,new RegExp(`href="https://kurami\\.shagon1k\\.win/${lang}/projects/\\?project=pickflick&amp;item=item%20%2633"`));
    assert.match(dashboard,/PR #123/);
    const keys=[...dashboard.matchAll(/data-disclosure-key="([^"]+)"/g)].map(match=>match[1]);
    assert.equal(new Set(keys).size,keys.length,"all Hub disclosures have distinct restoration keys, including periods and raw events");
  }
  // Pulse line: quiet with no alerts; otherwise how many need attention, plus work in progress and the owner's queue.
  const quiet=syntheticHubSnapshot();quiet.operations!.alerts=[];quiet.totals={...quiet.totals,working:2,attention:1};
  assert.match(renderHubDashboard(quiet,"ru"),/<p class="hub__pulse" data-state="quiet"><span>Всё спокойно<\/span><span>2 в работе<\/span><span>1 ждёт тебя<\/span><\/p>/);
  quiet.totals={...quiet.totals,working:0,attention:0,review:0};
  assert.match(renderHubDashboard(quiet,"en"),/<p class="hub__pulse" data-state="quiet"><span>All quiet<\/span><\/p>/);
  assert.match(renderHubDashboard(attention,"en"),/<p class="hub__pulse" data-state="attention"><span>\d+ needs? attention<\/span>/);
  const unnamed=syntheticHubSnapshot();
  unnamed.operations!.activity=[{id:"unknown",group:"codex:abcdefgh-1234",sessionId:"abcdefgh-1234",source:"Codex",agent:"Codex",at:unnamed.generatedAt,subject:" ",event:"session_started"}];
  assert.match(renderHubDashboard(unnamed,"en"),/Untitled session · abcdefgh/);
  assert.match(renderHubDashboard(unnamed,"ru"),/Сессия без названия · abcdefgh/);

  // Release drift arrives from the background check and shows as one "Release" problem with every item.
  const drifting=createHubServer({snapshot:()=>snapshot,releaseDrift:{latest:[{code:"checkout_behind",ru:"Рабочая версия позади main на 2 коммита",en:"The live version is 2 commits behind main"},{code:"service_stale",ru:"Не перезапущены после выкладки: hub",en:"Not restarted after the update: hub"}]}});
  await new Promise<void>(done=>drifting.listen(0,"127.0.0.1",done));
  try{
    const fragment=await (await fetch(`http://127.0.0.1:${(drifting.address() as {port:number}).port}/api/fragment?lang=en`)).text();
    assert.match(fragment,/Release · The live version is 2 commits behind main/);
    assert.match(fragment,/Release · Not restarted after the update: hub/,"every drift item is listed, not only the first");
    assert.match(fragment,/Release the changes/);
  }finally{drifting.close();}

  const pending=createHubServer({snapshot:()=>snapshot,releaseDrift:{latest:[
    {code:"checkout_dirty",ru:"В рабочей версии есть незакоммиченные правки",en:"The live version has uncommitted changes"},
    {code:"service_stale",ru:"Не перезапущены после выкладки: briefing",en:"Not restarted after the update: briefing"},
    {code:"hermes_copy_stale",ru:"Hermes: не синхронизированы навыки",en:"Hermes: skills not synchronized"},
    {code:"checkout_behind",ru:"Рабочая версия позади main на 2 коммита",en:"The live version is 2 commits behind main"},
  ]}});
  await new Promise<void>(done=>pending.listen(0,"127.0.0.1",done));
  try{
    const url=`http://127.0.0.1:${(pending.address() as {port:number}).port}/api/fragment`;
    const en=await (await fetch(`${url}?lang=en`)).text();
    assert.match(en,/Release · Changes await the next release/);
    assert.match(en,/Release · The live version is 2 commits behind main/,"remote drift remains visible while changes are pending");
    assert.doesNotMatch(en,/Not restarted after the update: briefing|Hermes: skills not synchronized/,"pending release steps do not become extra dashboard warnings");
    const ru=await (await fetch(`${url}?lang=ru`)).text();
    assert.match(ru,/Есть изменения для следующего релиза/);
  }finally{pending.close();}

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
    assert.equal(homePage.status,302);
    assert.equal(homePage.headers.location,"/en/");
    assert.equal(homePage.headers["cache-control"],"no-store");
    assert.equal((await get("/index.html")).headers.location,"/en/");
    assert.match((await get("/ru/")).body,/<html lang="ru"/);
    assert.match((await get("/en/")).body,/<html lang="en"/);
    assert.equal((await get("/en")).headers.location,"/en/");
    assert.equal((await get("/ru")).headers.location,"/ru/");
    assert.equal((await get("/api/fragment")).status,200);
    assert.match((await get("/api/fragment")).body,/<h1 class="sr-only">Kurami Hub<\/h1>/);
    assert.match((await get("/api/fragment?lang=ru")).body,/>Токены</);
    assert.match((await get("/api/fragment?lang=en")).body,/>Tokens</);
    assert.match((await get("/en/offline.html")).body,/<h1>Offline<\/h1>/);
    assert.equal((await get("/offline.html")).headers.location,"/en/offline.html");
    assert.equal((await get("/ru/offline.html")).status,200);
    assert.equal((await get("/manifest.webmanifest")).headers.location,"/en/manifest.webmanifest");
    const manifest=await get("/ru/manifest.webmanifest");
    assert.equal(manifest.status,200);
    assert.deepEqual(JSON.parse(manifest.body).icons,[{src:"/assets/fox.png",sizes:"512x512",type:"image/png",purpose:"any"}]);
    assert.equal(JSON.parse(manifest.body).lang,"ru");
    const enManifest=JSON.parse((await get("/en/manifest.webmanifest")).body);
    assert.equal(enManifest.lang,"en");assert.equal(enManifest.start_url,"/en/");
    assert.equal((await get("/assets/fox.webp")).headers["content-type"],"image/webp");
    assert.equal((await get("/sw.js")).status,200);
    const assetPage=(await get("/en/")).body;
    for(const path of ["hub.css","hub.js"]){
      const versioned=assetPage.match(new RegExp(`/assets/${path.replace(".","\\.")}\\?v=[a-f0-9]{16}`))?.[0];
      assert(versioned,"HTML uses a content-versioned "+path);
      assert.equal((await get(versioned)).status,200);
    }
    assert.equal((await get("/assets/theme.js")).headers["cache-control"],"private, no-cache");
    assert.equal((await get("/assets/hub.css","HEAD")).body,"");
    assert.equal((await get("/state/orchestrator.db")).status,404);
    assert.equal((await get("/", "POST")).status,405);
    assert.equal((await get("/health")).body,'{"ok":true}');
  } finally {server.close();}
} finally {rmSync(home,{recursive:true,force:true});}
console.log("Hub snapshot, rendering, PWA assets and HTTP boundary verified");
