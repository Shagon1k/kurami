import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import type {IncomingMessage} from "node:http";
import {WebAccess} from "../../src/web/access.ts";
import {ProjectsAccess} from "../../src/projects-site/access.ts";
import {HubAccess} from "../../src/hub/access.ts";
import {ACCESS_KEYS_TIMEOUT_MS,AccessVerificationUnavailableError,fetchAccessKeys} from "../../src/web/access-keys.ts";

const keys=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...keys.publicKey.export({format:"jwk"}),kid:"fixture-key"};
const team="https://fixture.cloudflareaccess.com";
const original=globalThis.fetch;
globalThis.fetch=(async(input)=>{assert.equal(String(input),team+"/cdn-cgi/access/certs");return new Response(JSON.stringify({keys:[jwk]}));}) as typeof fetch;
try{
  const access=new WebAccess({KURAMI_WEB_ACCESS_TEAM:team,KURAMI_WEB_ACCESS_AUDIENCE:"owner-aud",KURAMI_WEB_OWNER_EMAIL:"owner@example.test",KURAMI_WEB_DOCS_AUDIENCE:"docs-aud"});
  function request(claims:Record<string,unknown>={}):IncomingMessage {
    const now=Math.floor(Date.now()/1000);
    const header=Buffer.from(JSON.stringify({alg:"RS256",kid:jwk.kid})).toString("base64url");
    const payload=Buffer.from(JSON.stringify({iss:team,aud:["owner-aud"],type:"app",email:"owner@example.test",sub:"fixture-owner",nbf:now-30,exp:now+600,...claims})).toString("base64url");
    const signed=header+"."+payload;const signature=sign("RSA-SHA256",Buffer.from(signed),keys.privateKey).toString("base64url");
    return {method:"GET",headers:{"cf-access-jwt-assertion":signed+"."+signature}} as unknown as IncomingMessage;
  }
  for(const app of ["hub","digest","projects","docs"] as const)assert.deepEqual(await access.authorize(request(),app),{actor:"fixture-owner",scope:"owner"});
  const service=request({aud:["docs-aud"],type:"service",email:undefined,sub:"fixture-reader"});
  assert.deepEqual(await access.authorize(service,"docs"),{actor:"fixture-reader",scope:"docs-reader"});
  for(const app of ["hub","digest","projects"] as const)assert.equal(await access.authorize(service,app),null);
  service.method="POST";assert.equal(await access.authorize(service,"docs"),null);
  for(const claims of [{email:"other@example.test"},{aud:["foreign-aud"]},{exp:1},{iss:"https://foreign.cloudflareaccess.com"},{type:"service"}])assert.equal(await access.authorize(request(claims),"hub"),null);
  const tampered=request();tampered.headers["cf-access-jwt-assertion"]=String(tampered.headers["cf-access-jwt-assertion"]).slice(0,-10)+"tampered";
  assert.equal(await access.authorize(tampered,"hub"),null);
  const policyAccess=new WebAccess({KURAMI_WEB_ACCESS_TEAM:team,KURAMI_WEB_ACCESS_AUDIENCE:"owner-aud",KURAMI_WEB_DOCS_AUDIENCE:"docs-aud"});
  for(const app of ["hub","digest","projects","docs"] as const)assert.deepEqual(await policyAccess.authorize(request({email:"policy-owner@example.test"}),app),{actor:"fixture-owner",scope:"owner"});
  for(const claims of [{email:undefined},{email:""},{type:"service"},{aud:["docs-aud"]},{aud:["foreign-aud"]},{exp:1},{nbf:Math.floor(Date.now()/1000)+60},{iss:"https://foreign.cloudflareaccess.com"}])assert.equal(await policyAccess.authorize(request(claims),"hub"),null);
  assert.equal(await policyAccess.authorize(tampered,"hub"),null);
  service.method="GET";assert.deepEqual(await policyAccess.authorize(service,"docs"),{actor:"fixture-reader",scope:"docs-reader"});
  for(const app of ["hub","digest","projects"] as const)assert.equal(await policyAccess.authorize(service,app),null);
  assert.equal(await new WebAccess({}).authorize(request(),"hub"),null);
  const success=(async()=>new Response(JSON.stringify({keys:[jwk]}))) as typeof fetch;
  const options={team,audience:"owner-aud",ownerEmail:"owner@example.test"};
  for(const failure of [
    (async()=>{throw new DOMException("fixture network detail","TimeoutError");}) as typeof fetch,
    (async()=>new Response("fixture upstream detail",{status:503})) as typeof fetch,
    (async()=>new Response("not JSON")) as typeof fetch,
    (async()=>new Response(JSON.stringify({keys:"invalid"}))) as typeof fetch,
    (async()=>new Response(JSON.stringify({keys:Array(17).fill(jwk)}))) as typeof fetch,
    (async()=>new Response(" ".repeat(65_537))) as typeof fetch,
  ]){
    await assert.rejects(new ProjectsAccess({...options,fetchKeys:failure}).authorize(request()),AccessVerificationUnavailableError);
    await assert.rejects(new HubAccess(team,"docs-aud",failure).authorize(service),AccessVerificationUnavailableError);
  }
  let calls=0;
  const recovering=new ProjectsAccess({...options,fetchKeys:(async()=>{
    calls++;if(calls===1)throw new Error("fixture network detail");return success(team);
  }) as typeof fetch});
  await assert.rejects(recovering.authorize(request()),AccessVerificationUnavailableError);
  assert.equal(await recovering.authorize(request()),"fixture-owner","a failed key fetch can recover without restarting");
  assert.equal(calls,2);
  calls=0;
  const unavailable=(async()=>{calls++;throw new Error("fixture private network detail");}) as typeof fetch;
  const failClosed=new ProjectsAccess({...options,fetchKeys:unavailable});
  assert.equal(await failClosed.authorize({headers:{}}),null);
  assert.equal(await failClosed.authorize({headers:{"cf-access-jwt-assertion":"malformed"}}),null);
  for(const claims of [{exp:1},{aud:["foreign-aud"]},{email:"other@example.test"}])assert.equal(await failClosed.authorize(request(claims)),null);
  assert.equal(calls,0,"invalid claims do not depend on the key endpoint");
  globalThis.fetch=unavailable;
  await assert.rejects(new WebAccess({KURAMI_WEB_ACCESS_TEAM:team,KURAMI_WEB_ACCESS_AUDIENCE:"owner-aud",KURAMI_WEB_DOCS_AUDIENCE:"docs-aud"}).authorize(request(),"docs"),AccessVerificationUnavailableError,"owner verification failure does not fall back to reader access");
  globalThis.fetch=success;
  let clock=Date.now(),refreshes=0;
  const expiring=new ProjectsAccess({...options,now:()=>clock,fetchKeys:(async()=>{
    refreshes++;if(refreshes>1)throw new Error("fixture network detail");return success(team);
  }) as typeof fetch});
  const longLived=request({exp:Math.floor(clock/1000)+7_200});
  assert.equal(await expiring.authorize(longLived),"fixture-owner");clock+=3_600_001;
  await assert.rejects(expiring.authorize(longLived),AccessVerificationUnavailableError,"expired key cache is not a verification bypass");
  let concurrentFetches=0;
  const concurrent=new ProjectsAccess({...options,fetchKeys:(async()=>{
    concurrentFetches++;await new Promise(resolve=>setTimeout(resolve,10));return success(team);
  }) as typeof fetch});
  assert.deepEqual(await Promise.all([concurrent.authorize(request()),concurrent.authorize(request())]),["fixture-owner","fixture-owner"]);
  assert.equal(concurrentFetches,1,"concurrent owner requests share the public-key fetch");
  clock=Date.now();
  const expiresWhileFetching=new ProjectsAccess({...options,now:()=>clock,fetchKeys:(async()=>{clock+=2_000;return success(team);}) as typeof fetch});
  assert.equal(await expiresWhileFetching.authorize(request({exp:Math.floor(clock/1000)+1})),null,"waiting for keys does not extend token validity");
  assert.equal(ACCESS_KEYS_TIMEOUT_MS,15_000);
  const delayed=(async(_input,init)=>new Promise<Response>((resolve,reject)=>{
    const signal=init?.signal;assert(signal);assert.equal(init?.redirect,"error");
    const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve(new Response(JSON.stringify({keys:[jwk]})));},5_300);
    function abort(){clearTimeout(timer);reject(signal!.reason);}
    signal.addEventListener("abort",abort,{once:true});
  })) as typeof fetch;
  assert.equal(await new ProjectsAccess({...options,fetchKeys:delayed}).authorize(request()),"fixture-owner","a 5.3-second key response still verifies the signature");
  assert.deepEqual(await fetchAccessKeys(team,success),[jwk]);
  console.log("Unified Access: signed policy identity, optional owner allowlist, issuer/audience/expiry validation and read-only Docs service isolation verified");
}finally{globalThis.fetch=original;}
