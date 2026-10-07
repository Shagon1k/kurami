import assert from "node:assert/strict";
import {generateKeyPairSync,randomUUID,sign} from "node:crypto";
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {IncomingMessage} from "node:http";
import {HubAccess} from "../../src/hub/access.ts";
import {accountSnapshot} from "../../src/hub/codex-account.ts";
import {createHubControls,HubControlError} from "../../src/hub/controls.ts";
import {createHubServer} from "../../src/hub/server.ts";
import {collectHubSnapshot} from "../../src/hub/snapshot.ts";
import {AppServerClient} from "../../src/orchestrator/integrations/codex/app-server.ts";
import {settingsSchema} from "../../src/orchestrator/settings/settings-schema.ts";
import {renderControlView} from "../../src/hub/control-view.ts";

const home=mkdtempSync(join(tmpdir(),"kurami-hub-controls-"));
try {
  const missingClient=new AppServerClient(join(home,"missing-codex"));
  try {
    await assert.rejects(()=>missingClient.initialize(),/ENOENT/);
    await assert.rejects(()=>missingClient.request("account/rateLimits/read"),/ENOENT/);
  }finally{missingClient.close();}
  mkdirSync(join(home,"config"));mkdirSync(join(home,"state"));mkdirSync(join(home,"hermes"));
  writeFileSync(join(home,"config/projects.yaml"),"projects: {}\n");
  writeFileSync(join(home,"hermes/config.yaml"),"model: {default: gpt-6-sol, provider: openai-codex}\n");
  const calls:{binary?:string;args?:string[];method?:string;params?:any}[]=[];
  const controls=createHubControls({home,hermesHome:join(home,"hermes"),run:async(binary,args)=>{calls.push({binary,args});return JSON.stringify({ok:true,action:"applied"});},rpc:async(method,params)=>{
    calls.push({method,params});
    if(method==="model/list")return {data:[{model:"gpt-6-sol",displayName:"Sol"},{model:"gpt-6-astra",displayName:"Astra"}]};
    if(method==="config/read")return {config:{model:"gpt-6-sol"},origins:{model:{version:"sha256:test"}}};
    if(method==="account/rateLimitResetCredit/consume")return {outcome:"alreadyRedeemed"};
    return {rateLimitResetCredits:{availableCount:2}};
  }});
  await assert.rejects(()=>controls.execute("model-apply",{target:"codex",model:"gpt-6-astra",expectedModel:"old"}),error=>error instanceof HubControlError&&error.code==="stale_settings");
  assert(!calls.some(call=>call.method?.includes("write")),"stale model panel cannot change config");
  await assert.rejects(()=>controls.execute("model-apply",{target:"codex",model:"$(anything)",expectedModel:"gpt-6-sol"}));
  await controls.execute("model-apply",{target:"codex",model:"gpt-6-astra",expectedModel:"gpt-6-sol"},"owner");
  const write=calls.find(call=>call.method==="config/value/write");
  assert.equal(write?.params.expectedVersion,"sha256:test");
  assert.equal(write?.params.value,"gpt-6-astra");
  const effortCalls:{method:string;params:any}[]=[];
  const effortControls=createHubControls({home,hermesHome:join(home,"hermes"),rpc:async(method,params)=>{
    effortCalls.push({method,params});
    if(method==="model/list")return {data:[{model:"gpt-6-astra",supportedReasoningEfforts:[{reasoningEffort:"high"}],defaultReasoningEffort:"high"}]};
    if(method==="config/read")return {config:{model:"gpt-6-sol",model_reasoning_effort:"xhigh"},origins:{model:{version:"sha256:effort"}}};
    return {};
  }});
  await effortControls.execute("model-apply",{target:"codex",model:"gpt-6-astra",expectedModel:"gpt-6-sol",expectedEffort:"xhigh"},"owner");
  assert.equal(effortCalls.at(-1)?.method,"config/batchWrite");
  assert.deepEqual(effortCalls.at(-1)?.params.edits.map((item:any)=>[item.keyPath,item.value]),[["model","gpt-6-astra"],["model_reasoning_effort","high"]]);
  await assert.rejects(()=>controls.execute("health-apply",{minutes:7,revision:1}));
  await assert.rejects(()=>controls.execute("appearance-apply",{theme:"neon",mode:"system",revision:0}),"only light and dark modes exist");
  await assert.rejects(()=>controls.execute("appearance-apply",{theme:"paper; rm",mode:"dark",revision:0}),"unknown themes are rejected");
  await assert.rejects(()=>controls.execute("appearance-apply",{theme:"paper",mode:"dark",mascot:"maybe",revision:0}),"the Kurami switch is on or off");
  await assert.rejects(()=>controls.execute("dev-resources-apply",{cores:2,testJobs:3,memoryGiB:0,revision:0}),"test jobs cannot exceed cores");
  await assert.rejects(()=>controls.execute("dev-resources-apply",{cores:"4; rm",testJobs:1,memoryGiB:0,revision:0}),"limits are integers");
  await assert.rejects(()=>controls.execute("dev-resources-apply",{cores:2,testJobs:1,memoryGiB:5,revision:0}),"memory is one of the offered caps");
  await assert.rejects(()=>controls.execute("settings-apply",{revision:1,settings:{max_llm_running_global:99}}));
  const settings={version:1,...Object.fromEntries(settingsSchema.fields.map(field=>[field.name,field.max])),project_wip:{pickflick:1}};
  for(const field of settingsSchema.fields){
    for(const value of [field.min-1,field.max+1,true])await assert.rejects(()=>controls.execute("settings-apply",{revision:1,settings:{...settings,[field.name]:value}}),error=>error instanceof HubControlError&&error.code==="invalid_request");
  }
  await controls.execute("settings-apply",{revision:1,settings},"owner");
  const settingsArgs=calls.at(-1)?.args!;
  for(const field of settingsSchema.fields)assert.equal(settingsArgs[settingsArgs.indexOf(field.flag)+1],String(field.max));
  const form=renderControlView("settings",{settings:{schema:settingsSchema,revision:1,settings,idle:{idle:true}},health:{revision:1,intervalMinutes:20,allowedIntervals:settingsSchema.health.allowedIntervals}},"en");
  for(const field of settingsSchema.fields){
    const input=form.match(new RegExp(`<input[^>]*name="${field.name}"[^>]*>`))?.[0];
    assert(input);assert(input.includes(`min="${field.min}"`));assert(input.includes(`max="${field.max}"`));
  }
  const contours=[
    {contour:"broad",ok:true,tools:3,diff:[],warnings:[],revision:"one"},
    {contour:"read",ok:true,tools:7,diff:[{field:"toolset",before:"<old>",after:"expected"}],warnings:["<warning>"],revision:"two"},
    {contour:"automation",ok:false,tools:0,diff:[],warnings:["Comparison unavailable"],revision:"three"},
  ];
  for(const lang of ["en","ru"] as const){
    const check=renderControlView("composio-check",{contours},lang);
    assert.equal((check.match(/data-hub-control="composio-apply"/g)??[]).length,1,"only a successful comparison with a diff offers Sync");
    assert.match(check,/data-contour="read"/);assert.match(check,/data-revision="two"/);
    assert.match(check,/&lt;old&gt;/);assert.match(check,/&lt;warning&gt;/);
    assert.equal((check.match(/<details[^>]* open/g)??[]).length,2,"diffs and failed comparisons expose details");
    assert.match(check,/data-hub-control="composio-check"/);
    assert(!check.includes("data-hub-back"));
  }
  await assert.rejects(()=>controls.execute("composio-apply",{contour:"broad; anything"}));
  await assert.rejects(()=>controls.execute("composio-apply",{contour:"read",revision:"stale"}),error=>error instanceof HubControlError&&error.code==="stale_settings");
  await controls.execute("restart",{},"owner");
  assert.deepEqual(calls.at(-1)?.args,["--user","kill","--kill-whom=main","--signal=SIGUSR1","hermes-gateway.service"]);
  const beforeReset=calls.length;
  await assert.rejects(()=>controls.execute("codex-reset",{idempotencyKey:""}));
  assert.equal(calls.length,beforeReset,"invalid redemption key makes no provider call");
  const key=randomUUID();await controls.execute("codex-reset",{idempotencyKey:key},"owner");
  assert.equal(calls.at(-2)?.method,"account/rateLimitResetCredit/consume");
  assert.equal(calls.at(-2)?.params.idempotencyKey,key);
  assert.equal(calls.at(-1)?.method,"account/rateLimits/read","redemption always refreshes limits");
  assert.match(readFileSync(join(home,"state/hub/control-audit.jsonl"),"utf8"),/"identity":"owner"/);
  assert.equal(accountSnapshot({rateLimitResetCredits:{availableCount:2},rateLimits:{primary:{usedPercent:37,windowDurationMins:300,resetsAt:1790810000}}}).limits[0]?.remainingPercent,63);
  assert.equal(accountSnapshot({}).resetCredits,null,"unknown reset count is not zero");

  const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
  const team="https://test.cloudflareaccess.com",audience="hub-audience";
  let keyFetches=0;
  const access=new HubAccess(team,audience,(async()=>{keyFetches++;return new Response(JSON.stringify({keys:[{...publicKey.export({format:"jwk"}),kid:"test-key"}]}));}) as typeof fetch);
  const now=Math.floor(Date.now()/1000);
  function jwt(overrides:Record<string,unknown>={}){
    const head=Buffer.from(JSON.stringify({alg:"RS256",kid:"test-key"})).toString("base64url");
    const body=Buffer.from(JSON.stringify({iss:team,aud:[audience],sub:"owner",nbf:now-10,exp:now+300,...overrides})).toString("base64url");
    const input=head+"."+body;return input+"."+sign("RSA-SHA256",Buffer.from(input),privateKey).toString("base64url");
  }
  const request=(token?:string)=>({headers:token?{"cf-access-jwt-assertion":token}:{}} as IncomingMessage);
  assert.equal(await access.authorize(request(jwt())),"owner");
  assert.equal(await access.authorize(request(jwt())),"owner");assert.equal(keyFetches,1);
  assert.equal(await access.authorize(request(jwt({exp:now-1}))),null);
  assert.equal(await access.authorize(request(jwt({aud:["another-site"]}))),null);
  assert.equal(await access.authorize(request(jwt({nbf:now+300}))),null);
  assert.equal(await access.authorize(request()),null);
  const valid=jwt();assert.equal(await access.authorize(request(valid.slice(0,-4)+"AAAA")),null);

  const snapshot=collectHubSnapshot({home,appRepository:join(home,"missing"),codexHome:join(home,"codex")});
  let mutations=0;
  const server=createHubServer({snapshot:()=>snapshot,controlOrigin:"https://hub.test",authorize:async request=>request.headers["x-test-owner"]==="yes"?"owner":null,
    controls:{execute:async(action,payload)=>{if(action==="models")return {models:[],codex:"Sol",hermes:"Sol",hermesProvider:"openai-codex"};mutations++;if(action==="appearance-apply")return {ok:true,action:"applied",theme:payload?.theme,mode:payload?.mode,mascot:payload?.mascot!=="off"};return {ok:true,action:"restart_requested"};}}});
  await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    const page=await fetch(origin+"/en/");const html=await page.text();
    const cookie=page.headers.get("set-cookie")!.split(";")[0]!;
    const token=html.match(/name="hub-control-token" content="([^"]+)"/)![1]!;
    const headers={"Content-Type":"application/json","Origin":"https://hub.test","Cookie":cookie,"X-Hub-Control-Token":token,"X-Test-Owner":"yes"};
    const post=(body:any,extra:Record<string,string>={})=>fetch(origin+"/api/controls",{method:"POST",headers:{...headers,...extra},body:JSON.stringify(body)});
    assert.equal((await fetch(origin+"/api/controls?action=models")).status,403);
    assert.equal((await post({action:"restart",confirm:true},{"X-Test-Owner":"no"})).status,403);
    assert.equal((await post({action:"restart",confirm:true},{Origin:"https://evil.test"})).status,403);
    assert.equal((await post({action:"restart",confirm:true},{"X-Hub-Control-Token":"wrong"})).status,403);
    assert.equal((await post({action:"restart"})).status,400);
    assert.equal((await post({action:"models",confirm:true})).status,400);
    assert.equal(mutations,0,"rejected requests cannot run a command");
    assert.equal((await post({action:"restart",confirm:true})).status,200);assert.equal(mutations,1);
    // The page applies a new default at once, so the response carries it; other actions do not.
    assert.deepEqual((await (await post({action:"appearance-apply",theme:"neon",mode:"dark",revision:0,confirm:true})).json()).appearance,{theme:"neon",mode:"dark",mascot:true});
    assert.deepEqual((await (await post({action:"appearance-apply",theme:"paper",mode:"light",mascot:"off",revision:1,confirm:true})).json()).appearance,{theme:"paper",mode:"light",mascot:false},"the Kurami switch comes back too, so the page hides her at once");
    assert.equal((await (await post({action:"restart",confirm:true})).json()).appearance,undefined);
    const models=await fetch(origin+"/api/controls?action=models",{headers:{"X-Test-Owner":"yes"}});
    assert.match((await models.json()).html,/data-hub-submit="model-apply"/);
  }finally{await new Promise<void>(done=>server.close(()=>done()));}
}finally{rmSync(home,{recursive:true,force:true});}
console.log("Hub controls: owner JWT, origin/CSRF, explicit confirmation, safe command boundaries and reset idempotency verified");
