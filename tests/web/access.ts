import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import type {IncomingMessage} from "node:http";
import {WebAccess} from "../../src/web/access.ts";

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
  console.log("Unified Access: signed policy identity, optional owner allowlist, issuer/audience/expiry validation and read-only Docs service isolation verified");
}finally{globalThis.fetch=original;}
