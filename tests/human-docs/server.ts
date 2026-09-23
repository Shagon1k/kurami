import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {once} from "node:events";
import {createDocsServer} from "../../src/human-docs/server.ts";

const root=mkdtempSync(join(tmpdir(),"kurami-docs-origin-test-"));
const revision="a".repeat(40);
try {
  writeFileSync(join(root,"build.json"),JSON.stringify({mode:"preview",revision:null,docsSha:null}));
  assert.throws(()=>createDocsServer(root),/clean release build/);
  writeFileSync(join(root,"build.json"),JSON.stringify({mode:"release",revision:null,docsSha:revision}));
  assert.doesNotThrow(()=>createDocsServer(root));
  writeFileSync(join(root,"build.json"),JSON.stringify({mode:"release",revision,docsSha:revision}));
  for(const path of ["ru/index.html","en/index.html","en/changelog/index.html","assets/docs.css"]){
    const destination=join(root,path);
    mkdirSync(dirname(destination),{recursive:true});
    writeFileSync(destination,`fixture:${path}`);
  }
  const server=createDocsServer(root);
  server.listen(Number(process.env.DOCS_SMOKE_PORT??0),"127.0.0.1");
  await once(server,"listening");
  try {
    const address=server.address();
    assert.ok(address && typeof address!=="string");
    const base=`http://127.0.0.1:${address.port}`;
    for(const path of ["/","/index.html"]){
      const redirect=await fetch(base+path,{redirect:"manual"});
      assert.equal(redirect.status,302,path);
      assert.equal(redirect.headers.get("location"),"/en/");
    }
    const rootHead=await fetch(base+"/",{method:"HEAD",redirect:"manual"});
    assert.equal(rootHead.status,302);
    assert.equal(rootHead.headers.get("location"),"/en/");
    assert.equal(await rootHead.text(),"");
    assert.equal((await fetch(base+"/",{method:"POST",redirect:"manual"})).status,405);
    for(const [path,status,body] of [
      ["/en/",200,"fixture:en/index.html"],
      ["/ru/",200,"fixture:ru/index.html"],
      ["/en/changelog/",200,"fixture:en/changelog/index.html"],
      ["/assets/docs.css",200,"fixture:assets/docs.css"],
      ["/build.json",404,""],
      ["/%2e%2e/build.json",404,""],
      ["/ru/missing/",404,""],
      ["/src/human-docs/content.ts",404,""],
    ] as const){
      const response=await fetch(base+path);
      assert.equal(response.status,status,path);
      if(body)assert.equal(await response.text(),body);
    }
    const head=await fetch(base+"/ru/",{method:"HEAD"});
    assert.equal(head.status,200);
    assert.equal(await head.text(),"");
    assert.equal((await fetch(base+"/ru/",{method:"POST"})).status,405);
  } finally {server.close();await once(server,"close");}
  console.log("Docs origin: release-only gate, routes, assets and method restrictions verified");
} finally {rmSync(root,{recursive:true,force:true});}
