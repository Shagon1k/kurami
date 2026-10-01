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
  for(const path of ["ru/index.html","en/index.html","en/changelog/index.html","assets/docs.css","assets/fox.webp","assets/shot-project-board.png","assets/diagram-run-lifecycle-1-en.svg","assets/diagram-run-lifecycle-1-ru.svg"]){
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
      ["/assets/fox.webp",200,"fixture:assets/fox.webp"],
      ["/assets/shot-project-board.png",200,"fixture:assets/shot-project-board.png"],
      ["/assets/diagram-run-lifecycle-1-en.svg",200,"fixture:assets/diagram-run-lifecycle-1-en.svg"],
      ["/assets/diagram-run-lifecycle-1-ru.svg",200,"fixture:assets/diagram-run-lifecycle-1-ru.svg"],
      ["/assets/diagrams/../build.json",404,""],
      ["/assets/other/x.svg",404,""],
      ["/build.json",404,""],
      ["/%2e%2e/build.json",404,""],
      ["/ru/missing/",404,""],
      ["/src/human-docs/content.ts",404,""],
    ] as const){
      const response=await fetch(base+path);
      assert.equal(response.status,status,path);
      if(body)assert.equal(await response.text(),body);
    }
    const mountedHeaders={"x-kurami-web-app":"docs"};
    assert.equal((await fetch(base+"/en/",{headers:mountedHeaders})).status,503,"old release cannot serve incorrectly rooted mounted HTML");
    const head=await fetch(base+"/ru/",{method:"HEAD"});
    assert.equal(head.status,200);
    assert.equal(await head.text(),"");
    const fox=await fetch(base+"/assets/fox.webp");
    assert.equal(fox.headers.get("content-type"),"image/webp");
    assert.equal((await fetch(base+"/ru/",{method:"POST"})).status,405);
  } finally {server.close();await once(server,"close");}
  mkdirSync(join(root,"unified/en"),{recursive:true});
  const immutable='<html><head></head><body><a href="/en/docs/">Mounted fixture</a></body></html>';
  writeFileSync(join(root,"unified/en/index.html"),immutable);
  writeFileSync(join(root,"build.json"),JSON.stringify({mode:"release",revision:null,docsSha:revision,webMount:true}));
  const mounted=createDocsServer(root);mounted.listen(0,"127.0.0.1");await once(mounted,"listening");
  try {
    const base=`http://127.0.0.1:${(mounted.address() as {port:number}).port}`;
    const response=await fetch(base+"/en/",{headers:{"x-kurami-web-app":"docs"}});
    assert.equal(await response.text(),immutable,"published mounted bytes are served without rewrite");
    assert.equal(response.headers.get("content-length"),String(Buffer.byteLength(immutable)));
    assert.equal(await(await fetch(base+"/en/")).text(),"fixture:en/index.html","native artifacts remain separate");
  } finally {mounted.close();await once(mounted,"close");}
  console.log("Docs origin: release-only gate, routes, assets and method restrictions verified");
} finally {rmSync(root,{recursive:true,force:true});}
