import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import type {AddressInfo} from "node:net";
import {cachedPortalVoice,configurePortalVoice,fallbackLines,portalVoice,soulPath,voiceDirectory,voiceKey,VOICE_TTL_MS,validateVoiceLines,writePortalVoice,type PresenceContext} from "../../src/portal-presence/voice.ts";
import {generatePortalVoice} from "../../src/portal-presence/worker.ts";
import {createHubServer} from "../../src/hub/server.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";
import {renderKuramiPresence} from "../../src/ui-library/components/kurami-mood.ts";

const root=mkdtempSync(join(tmpdir(),"kurami-voice-")),home=join(root,"home"),previous=process.env.KURAMI_HOME;
mkdirSync(home,{recursive:true});mkdirSync(dirname(soulPath(home)),{recursive:true});writeFileSync(soulPath(home),"Kurami speaks warmly and directly. Female first person in Russian.");
process.env.KURAMI_HOME=home;
let cleanup=()=>{};
try{
  for(const language of ["ru","en"] as const)for(const portal of ["hub","projects","docs","digest"] as const)for(const mood of ["idle","working","needs-decision","alert","found-problem","offline","asleep","done"] as const){
    const lines=fallbackLines({portal,mood,reason:"test"},language);
    assert.deepEqual(validateVoiceLines(lines,language),lines,"curated lines fit the same language, length and safety contract as generated lines");
  }
  const context:PresenceContext={portal:"hub",mood:"needs-decision",reason:"owner-attention",facts:{attention:1,working:0}};
  const reordered:PresenceContext={...context,facts:{working:0,attention:1}};
  const key=voiceKey(context,"ru",home);
  assert.equal(key,voiceKey(reordered,"ru",home),"fact order cannot invalidate the cache");
  assert.notEqual(key,voiceKey(context,"en",home),"language isolates generated lines");
  assert.notEqual(key,voiceKey({...context,facts:{attention:2,working:0}},"ru",home),"changed facts invalidate the cache");
  const starts:string[]=[];
  cleanup=configurePortalVoice(home,async(_home,key)=>{starts.push(key);});
  const first=portalVoice(context,"ru",home);portalVoice(context,"ru",home);
  assert.deepEqual(first.lines,fallbackLines(context,"ru"),"fallback is immediate before a generator is called");
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(starts,[key],"concurrent reads coalesce into one job");
  const request=JSON.parse(readFileSync(join(voiceDirectory(home),key+".request.json"),"utf8"));
  assert.equal(request.language,"ru");
  const lines=["Тут нужен твой взгляд. Как решишь — продолжим.","На этом шаге нужен ты. Давай выберем следующий шаг.","Дальше решаем вместе. Посмотри, что ждёт твоего ответа."];
  await generatePortalVoice(home,key,async prompt=>{
    assert.match(prompt,/Female first person in Russian/);
    assert.match(prompt,/Do not call tools/);
    assert.match(prompt,/If its character description differs from the examples, follow the current SOUL/);
    return {lines};
  });
  assert.deepEqual(portalVoice(context,"ru",home).lines,lines,"prepared lines are used on a later render");
  assert.equal(cachedPortalVoice(key,"en",home),null,"cache cannot leak into a different locale");
  assert.equal(cachedPortalVoice(key,"ru",home,Date.now()+VOICE_TTL_MS+100),null,"expired lines fall back");
  cleanup();cleanup=()=>{};
  const badKey=voiceKey({...context,reason:"another-context"},"ru",home);
  writeFileSync(join(voiceDirectory(home),badKey+".request.json"),JSON.stringify({...request,key:badKey,context:{...context,reason:"another-context"}}));
  await assert.rejects(generatePortalVoice(home,badKey,async()=>({lines:["Я закрыла две задачи и восстановила сервер.","<script>alert('x')</script>","Данные тут."]})),/Unsafe voice line/);
  assert.equal(cachedPortalVoice(badKey,"ru",home),null);
  const escaped=renderKuramiPresence({mood:"idle",key,speech:"<script>bad</script>",lines:["<script>bad</script>"]});
  assert.ok(!escaped.includes("<script>"),"speech and variant attributes are escaped");
  assert.ok(!escaped.includes("kurami-speaker"),"no repeated name label");
  const server=createHubServer({home,snapshot:syntheticHubSnapshot,authorize:async request=>request.headers['x-test-owner']==='yes'?"owner":null});
  await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
  try{
    const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal-voice?key=${key}&lang=ru`;
    assert.equal((await fetch(url)).status,403,"voice API requires owner access");
    const response=await fetch(url,{headers:{'x-test-owner':'yes'}});
    assert.equal(response.status,200);assert.deepEqual((await response.json()).lines,lines);
    assert.equal((await fetch(url+'&unused=1',{method:"POST",headers:{'x-test-owner':'yes'}})).status,405);
    assert.equal((await fetch(url.replace('lang=ru','lang=en'),{headers:{'x-test-owner':'yes'}})).status,204);
    const docs:PresenceContext={portal:"docs",mood:"welcome",reason:"docs-home"};
    const oldDocsKey=voiceKey(docs,"ru",home);
    writeFileSync(soulPath(home),"Kurami is warm, playful and sharp-witted. Her own taste matters.");
    const updatedKey=voiceKey(docs,"ru",home);
    assert.notEqual(updatedKey,oldDocsKey,"SOUL edits invalidate voice banks immediately, without a restart");
    const liveUrl=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/portal-voice?key=${oldDocsKey}&lang=ru&context=docs-home`;
    assert.equal((await fetch(liveUrl)).status,403,"live Docs voice still requires owner access");
    const fresh=await fetch(liveUrl,{headers:{'x-test-owner':'yes'}}).then(r=>r.json());
    assert.equal(fresh.key,updatedKey,"a static Docs page resolves the current SOUL version");
    assert.deepEqual(fresh.lines,fallbackLines(docs,"ru"),"the new version has immediate fallback lines");
    writePortalVoice(home,{key:updatedKey,context:docs,language:"ru",requestedAt:new Date().toISOString()},lines);
    assert.deepEqual((await fetch(liveUrl,{headers:{'x-test-owner':'yes'}}).then(r=>r.json())).lines,lines,"prepared voice arrives without rebuilding the static page");
    assert.equal((await fetch(liveUrl.replace('context=docs-home','context=unknown'),{headers:{'x-test-owner':'yes'}})).status,400);
  }finally{await new Promise<void>(done=>server.close(()=>done()));}
}finally{cleanup();if(previous===undefined)delete process.env.KURAMI_HOME;else process.env.KURAMI_HOME=previous;rmSync(root,{recursive:true,force:true});}
console.log(JSON.stringify({ok:true,portalVoice:"fallback, facts, locale, coalescing, worker, TTL, validation and authorized API"}));
