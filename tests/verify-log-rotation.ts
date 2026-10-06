// Size-based log rotation: small logs stay, large ones become <name>.1 replacing the previous copy.
import assert from "node:assert/strict";
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {rotateIfLarge} from "../src/core/log-rotation.ts";

const home=mkdtempSync(join(tmpdir(),"kurami-log-rotation-")),log=join(home,"x.jsonl");
try{
  assert.equal(await rotateIfLarge(join(home,"missing.log"),10),false,"a missing log is not an error");
  writeFileSync(log,"small");
  assert.equal(await rotateIfLarge(log,10),false);assert.equal(readFileSync(log,"utf8"),"small");
  writeFileSync(`${log}.1`,"older");writeFileSync(log,"x".repeat(20));
  assert.equal(await rotateIfLarge(log,10),true);
  assert.equal(existsSync(log),false,"writing starts a fresh file");
  assert.equal(readFileSync(`${log}.1`,"utf8"),"x".repeat(20),"the previous copy is replaced");
  console.log(JSON.stringify({ok:true,logRotation:"small kept, large rotated, previous copy replaced"}));
}finally{rmSync(home,{recursive:true,force:true});}
