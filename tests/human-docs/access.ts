import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync,symlinkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {verifyDocsAccess,mountedReleaseFiles,readOwnerSession} from "../../src/human-docs/tools/verify-access.ts";
import {existingDeploymentManifest} from "../../src/human-docs/deployment.ts";
const root=mkdtempSync(join(tmpdir(),"kurami-mounted-access-")),origin="https://kurami.shagon1k.win";
try{
  assert.equal(existingDeploymentManifest(root),undefined);
  mkdirSync(join(root,"state/web"),{recursive:true});
  const controller=join(root,"state/web/deployment.json");
  writeFileSync(controller,JSON.stringify({status:"pending"}),{mode:0o600});assert.throws(()=>existingDeploymentManifest(root),/succeeded/);
  writeFileSync(controller,JSON.stringify({status:"succeeded",appSha:"a".repeat(40)}));assert.equal(existingDeploymentManifest(root),controller);
  for(const path of ["en","ru","assets","unified/en","unified/ru","unified/assets","errors"])mkdirSync(join(root,path),{recursive:true});
  writeFileSync(join(root,"build.json"),JSON.stringify({mode:"release",docsSha:"a".repeat(40),webMount:true}));
  for(const path of ["en/index.html","ru/index.html","assets/docs.css","assets/theme.js","errors/en.html"])writeFileSync(join(root,path),"native "+path);
  for(const path of ["en/index.html","ru/index.html","assets/docs.css"])writeFileSync(join(root,"unified",path),"mounted "+path);
  const mapped=mountedReleaseFiles(root);assert.equal(mapped.length,4);
  assert.equal(mapped.find(item=>item.nativeRoute==="/ru/")!.publicRoute,"/ru/docs/");
  assert.equal(mapped.find(item=>item.nativeRoute==="/assets/docs.css")!.publicRoute,"/_apps/docs/assets/docs.css");
  const session=join(root,"owner.json");writeFileSync(session,JSON.stringify({origin,authorization:"fake.fixture.signature"}),{mode:0o600});
  const fetcher=(async(url,options)=>{
    const target=new URL(String(url));assert.equal(options!.redirect,"manual");
    const headers=new Headers(options!.headers);assert.ok(!headers.has("CF-Access-Client-Secret"));
    if(target.origin===origin&&!headers.has("Cookie"))return new Response(null,{status:302,headers:{location:"https://fixture.cloudflareaccess.com/login"}});
    if(headers.has("Cookie")){assert.equal(target.origin,origin);assert.equal(headers.get("Cookie"),"CF_Authorization=fake.fixture.signature");}
    else {assert.equal(target.origin,"http://127.0.0.1:8799");assert.equal(headers.get("x-kurami-web-app"),"docs");}
    const item=mapped.find(item=>(target.origin===origin?item.publicRoute:item.nativeRoute)===target.pathname)!;
    return new Response(readFileSync(item.file),{status:200});
  }) as typeof fetch;
  const local=await verifyDocsAccess({release:root,fetcher});assert.equal(local.authenticatedEdge,"not checked; requires private owner session");assert.equal(local.byteCheckBoundary,"mounted loopback origin");
  const edge=await verifyDocsAccess({release:root,ownerSessionPath:session,fetcher});assert.equal(edge.authenticatedEdge,"verified");
  await assert.rejects(verifyDocsAccess({release:root,site:"https://foreign.example",fetcher}),/restricted/);
  chmodSync(session,0o644);assert.throws(()=>readOwnerSession(session,origin),/private regular/);chmodSync(session,0o600);
  writeFileSync(session,JSON.stringify({origin:"https://foreign.example",authorization:"fake.fixture.signature"}));assert.throws(()=>readOwnerSession(session,origin),/single Access/);
  const linked=join(root,"linked.json");symlinkSync(session,linked);assert.throws(()=>readOwnerSession(linked,origin),/private regular/);
  rmSync(linked);
  await assert.rejects(verifyDocsAccess({release:root,fetcher:(async()=>new Response("public",{status:200})) as typeof fetch}),/Access login/);
  console.log("Docs unified verifier: mounted bytes, anonymous gate, exact-origin owner cookie, no service token, permissions and honest evidence boundaries verified");
}finally{rmSync(root,{recursive:true,force:true});}
