import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {once} from "node:events";
import {resourceAudit} from "./fixtures/resource-audit.ts";
import {readResourceAudit,resourceAuditPending,acknowledgeResourceAudit} from "../src/system/maintenance/resource-audit.ts";
import {renderResourceAuditPage} from "../src/hub/resource-audit.ts";
import {collectHubOperations} from "../src/hub/operations.ts";
import {createHubServer} from "../src/hub/server.ts";
import {syntheticHubSnapshot} from "../src/ui-library/testing/fixtures.ts";

const home=mkdtempSync(join(tmpdir(),"kurami-resource-audit-test-"));
mkdirSync(join(home,"state/resource-audit"),{recursive:true});
const report=join(home,"state/resource-audit/latest.json");
writeFileSync(report,JSON.stringify(resourceAudit));
const server=createHubServer({home,snapshot:syntheticHubSnapshot,authorize:async request=>request.headers["x-test-owner"]==="yes"?"owner":null});
try{
  assert.equal(readResourceAudit(home)?.id,resourceAudit.id);
  assert(resourceAuditPending(home,resourceAudit));
  assert(collectHubOperations(home,home,home,new Date()).alerts.some(x=>x.code==="resource_audit"));
  acknowledgeResourceAudit(home,resourceAudit.id,"owner");
  assert(!resourceAuditPending(home,resourceAudit));
  assert.equal(readFileSync(report,"utf8"),JSON.stringify(resourceAudit),"acknowledgement never changes or deletes the report");
  const newer={...resourceAudit,id:"resource-"+"b".repeat(32)};writeFileSync(report,JSON.stringify(newer));
  assert(resourceAuditPending(home,newer));
  assert.throws(()=>acknowledgeResourceAudit(home,resourceAudit.id,"owner"),/stale_audit/);
  assert(resourceAuditPending(home,newer),"an old acknowledgement cannot suppress a newer report");
  for(const lang of ["ru","en"] as const){
    const html=renderResourceAuditPage({...newer,analysis:{ru:'<script>alert("x")</script>',en:'<script>alert("x")</script>'}},home,lang,"token");
    assert(!html.includes('<script>alert("x")</script>'));assert(html.includes("&lt;script&gt;"));
    assert(html.includes(lang==="ru"?"Отметить рассмотренным":"Mark as reviewed"));
  }
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  assert.equal((await fetch(base+"/ru/resource-audit")).status,403);
  const page=await fetch(base+"/ru/resource-audit",{headers:{"x-test-owner":"yes"}});
  assert.equal(page.status,200);const html=await page.text();
  const token=html.match(/name="hub-control-token" content="([^"]+)"/)![1]!;
  const cookie=page.headers.get("set-cookie")!.split(";")[0]!;
  const headers={"x-test-owner":"yes","content-type":"application/json","cookie":cookie,"x-hub-control-token":token,"origin":"https://kurami.shagon1k.win"};
  const post=(payload:unknown,h:Record<string,string>=headers)=>fetch(base+"/api/resource-audit",{method:"POST",headers:h,body:JSON.stringify(payload)});
  assert.equal((await post({action:"acknowledge",id:newer.id},{...headers,"x-test-owner":"no"})).status,403);
  assert.equal((await post({action:"acknowledge",id:newer.id},{...headers,origin:"https://evil.test"})).status,403);
  assert.equal((await post({action:"acknowledge",id:newer.id},{...headers,"x-hub-control-token":"wrong"})).status,403);
  assert.equal((await post({action:"cleanup",id:newer.id})).status,400,"no cleanup action exists");
  assert.equal((await post({action:"acknowledge",id:resourceAudit.id})).status,409);
  assert.equal((await post({action:"acknowledge",id:newer.id})).status,200);
  assert(!resourceAuditPending(home,newer));assert.equal(readFileSync(report,"utf8"),JSON.stringify(newer));
  writeFileSync(report,"{}");assert.equal(readResourceAudit(home),null);
}finally{server.close();rmSync(home,{recursive:true,force:true});}
console.log("Resource audit: persistent notices, stale acknowledgements, escaped bilingual pages, owner/CSRF gates and absence of cleanup actions verified");
