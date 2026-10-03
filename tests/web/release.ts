import assert from "node:assert/strict";
import {executeWebRelease,type ReleaseOperations} from "../../src/web/release.ts";
const sha="a".repeat(40),events:string[]=[];
const operations=():ReleaseOperations=>({assertSource:expected=>{assert.equal(expected,sha);events.push("source");},build:()=>{events.push("build");},restart:()=>{events.push("restart");},verify:async()=>{events.push("verify");return {fixture:true};},persist:manifest=>{events.push("persist");assert.equal(manifest.appSha,sha);assert.equal(manifest.status,"succeeded");}});
await assert.rejects(executeWebRelease("HEAD",operations()),/explicit full/);assert.equal(events.length,0);
await executeWebRelease(sha,operations());assert.deepEqual(events,["source","build","source","restart","verify","source","persist"]);
for(const failing of ["assertSource","build","restart","verify"] as const){events.length=0;const ops=operations();ops[failing]=(()=>{throw new Error("fixture failure");}) as never;await assert.rejects(executeWebRelease(sha,ops),/fixture failure/);assert.ok(!events.includes("persist"));}
events.length=0;const changed=operations();let reads=0;changed.assertSource=()=>{if(++reads===3)throw new Error("source drift");};await assert.rejects(executeWebRelease(sha,changed),/source drift/);assert.ok(!events.includes("persist"));
console.log("Web release: explicit approved SHA, ordered build/restart/read verification and no success assertion on failure or source drift verified");
