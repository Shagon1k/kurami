// Hub default appearance: status, guarded apply, stale panels and theme/mode rules; the gateway cookie value.
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";

const home=mkdtempSync(resolve(tmpdir(),"kurami-appearance-"));
process.env.KURAMI_HOME=home;
const {runAppearanceSettingsCli,readAppearanceDefault,appearanceStatePath,appearanceThemes,validAppearance}=await import("../src/system/appearance/appearance-settings.ts");
try{
  assert.deepEqual(appearanceThemes,{paper:["light","dark"],neon:["dark"]});
  assert.ok(validAppearance("neon","dark")&&!validAppearance("neon","light")&&!validAppearance("matrix","dark")&&!validAppearance("paper","system"));
  const status=await runAppearanceSettingsCli(["status"]);
  assert.equal(status.revision,0);assert.equal(status.theme,"paper");assert.equal(status.mode,null);
  assert.equal(readAppearanceDefault(appearanceStatePath(home)),null,"no default before the owner picks one");
  await assert.rejects(runAppearanceSettingsCli(["apply","--theme","neon","--mode","light","--expected-revision","0","--actor-id","42"]),/mode that theme does not have/);
  await assert.rejects(runAppearanceSettingsCli(["apply","--theme","neon","--mode","dark","--expected-revision","0","--actor-id","x"]),/Invalid actor ID/);
  const applied=await runAppearanceSettingsCli(["apply","--theme","neon","--mode","dark","--expected-revision","0","--actor-id","42"]);
  assert.equal(applied.action,"applied");assert.equal(applied.revision,1);
  assert.equal(readAppearanceDefault(appearanceStatePath(home)),"neon.dark");
  assert.equal(statSync(appearanceStatePath(home)).mode&0o777,0o600,"state is private");
  await assert.rejects(runAppearanceSettingsCli(["apply","--theme","paper","--mode","light","--expected-revision","0","--actor-id","42"]),/changed since this panel opened/);
  const same=await runAppearanceSettingsCli(["apply","--theme","neon","--mode","dark","--expected-revision","1","--actor-id","42"]);
  assert.equal(same.action,"unchanged");assert.equal(same.revision,1);
  await runAppearanceSettingsCli(["apply","--theme","paper","--mode","light","--expected-revision","1","--actor-id","42"]);
  assert.equal(readAppearanceDefault(appearanceStatePath(home)),"paper.light");
  assert.equal(JSON.parse(readFileSync(appearanceStatePath(home),"utf8")).actorId,"42");
  console.log(JSON.stringify({ok:true,appearance:"status, guarded apply, stale revision, theme modes, private state, cookie value"}));
}finally{rmSync(home,{recursive:true,force:true});}
