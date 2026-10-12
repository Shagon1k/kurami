// Disposable real-Git regression: no network, services, production paths or application deploy.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,readFileSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {syncDocsCheckout} from "../src/human-docs/approval/checkout-sync.ts";
import {withDeployLock} from "../src/system/deploy/lock.ts";
import {deploy} from "../src/system/deploy/deploy.ts";
const root=mkdtempSync(join(tmpdir(),"kurami-docs-sync-"));
const originalPath=process.env.PATH;
const realGit=execFileSync("which",["git"],{encoding:"utf8"}).trim();
const repo="fixture/docs-sync",url=`https://github.com/${repo}.git`;
const git=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const write=(cwd:string,path:string,text:string)=>{mkdirSync(dirname(join(cwd,path)),{recursive:true});writeFileSync(join(cwd,path),text);};
try {
  const remote=join(root,"remote.git"),source=join(root,"source");
  git(root,"init","-q","--bare",remote);git(root,"init","-q","-b","main",source);
  git(source,"config","user.name","Fixture");git(source,"config","user.email","fixture@example.invalid");
  const page="src/human-docs/content/pages/platform/hub.en.md";
  const commit=(path:string,text:string)=>{write(source,path,text);git(source,"add",".");git(source,"commit","-qm","fixture");return git(source,"rev-parse","HEAD");};
  const base=commit(page,"base\n");git(source,"remote","add","origin",remote);git(source,"push","-q","origin","main");
  let count=0;
  const fixture=()=>{
    const app=join(root,`app-${++count}`),home=join(root,`home-${count}`);
    git(root,"clone","-q","-b","main",remote,app);
    git(app,"remote","set-url","origin",url);

    return {app,home,repo,target:base};
  };
  // Create base-only checkout before publishing objects; fetch must not advance tracking refs.
  const first=fixture(),tracking=git(first.app,"rev-parse","origin/main");
  const target=commit(page,"published docs\n");git(source,"push","-q","origin","main");
  const later=commit("src/human-docs/build.ts","runtime after publication\n");git(source,"push","-q","origin","main");
  const promoted={...first,target};
  // Substitute only fetch transport; every guard, graph/path check and ff is real Git.
  const bin=join(root,"bin");mkdirSync(bin);
  writeFileSync(join(bin,"git"),`#!/bin/sh\nif [ "$3" = merge ] && [ "$KURAMI_SYNC_FAIL_MERGE" = 1 ]; then exit 1; fi\nif [ "$3" = log ] && [ -n "$KURAMI_SYNC_MUTATE" ]; then printf 'owner work' > "$KURAMI_SYNC_MUTATE"; fi\nif [ "$3" = fetch ]; then exec "${realGit}" -c "url.${remote}.insteadOf=${url}" "$@"; fi\nexec "${realGit}" "$@"\n`);
  chmodSync(join(bin,"git"),0o755);process.env.PATH=`${bin}:${originalPath}`;
  const ok=await syncDocsCheckout(promoted);
  assert.equal(ok.status,"synced",ok.reason??"");assert.equal(ok.from,base);assert.equal(ok.head,target);
  assert.equal(git(first.app,"rev-parse","origin/main"),tracking,"fetch did not update tracking refs");
  assert.notEqual(git(first.app,"rev-parse","HEAD"),later,"never activates newer main");
  assert.equal((await syncDocsCheckout(promoted)).status,"already_at_target");
  // Each refusal preserves exact HEAD and owner data.
  const blocked=async(options:ReturnType<typeof fixture>,reason:RegExp)=>{
    const before=git(options.app,"rev-parse","HEAD");
    const outcome=await syncDocsCheckout({...options,target});
    assert.equal(outcome.status,"blocked");assert.match(outcome.reason!,reason);
    assert.equal(git(options.app,"rev-parse","HEAD"),before);return outcome;
  };
  const dirty=fixture();write(dirty.app,page,"owner edit\n");await blocked(dirty,/tracked or untracked/);assert.equal(readFileSync(join(dirty.app,page),"utf8"),"owner edit\n");
  const untracked=fixture();write(untracked.app,"owner.txt","keep\n");await blocked(untracked,/tracked or untracked/);assert.equal(readFileSync(join(untracked.app,"owner.txt"),"utf8"),"keep\n");
  const branch=fixture();git(branch.app,"checkout","-qb","other");await blocked(branch,/not on main/);
  const detached=fixture();git(detached.app,"checkout","-q","--detach");await blocked(detached,/symbolic-ref/);
  const wrong=fixture();git(wrong.app,"remote","set-url","origin","https://github.com/other/repo.git");await blocked(wrong,/origin/);
  const ahead=fixture();await blocked(ahead,/ahead of or divergent/);
  const divergent=fixture();git(divergent.app,"checkout","-q","--detach",base);git(divergent.app,"branch","-f","main",base);git(divergent.app,"checkout","-q","main");
  git(divergent.app,"config","user.name","Fixture");git(divergent.app,"config","user.email","fixture@example.invalid");
  write(divergent.app,page,"divergent\n");git(divergent.app,"add",".");git(divergent.app,"commit","-qm","diverge");await blocked(divergent,/ahead of or divergent/);
  const runtime=fixture();git(runtime.app,"checkout","-q","--detach",base);git(runtime.app,"branch","-f","main",base);git(runtime.app,"checkout","-q","main");
  assert.equal((await syncDocsCheckout({...runtime,target:later})).status,"blocked","runtime under docs directory is blocked");
  git(source,"revert","--no-edit",later);const reverted=git(source,"rev-parse","HEAD");git(source,"push","-q","origin","main");
  const revertedResult=await syncDocsCheckout({...runtime,target:reverted});assert.equal(revertedResult.status,"blocked");assert.match(revertedResult.reason!,/non-docs paths/);assert.equal(git(runtime.app,"rev-parse","HEAD"),base);
  assert.equal((await syncDocsCheckout({...runtime,target:"f".repeat(40)})).status,"blocked","missing object fetch failure leaves HEAD unchanged");
  process.env.KURAMI_SYNC_FAIL_MERGE="1";
  try {const failure=await syncDocsCheckout({...runtime,target});assert.equal(failure.status,"blocked");assert.equal(failure.head,base);}
  finally {delete process.env.KURAMI_SYNC_FAIL_MERGE;}
  process.env.KURAMI_SYNC_MUTATE=join(runtime.app,"owner-during-validation.txt");
  try {await blocked(runtime,/tracked or untracked/);assert.equal(readFileSync(process.env.KURAMI_SYNC_MUTATE,"utf8"),"owner work");}
  finally {delete process.env.KURAMI_SYNC_MUTATE;}
  await withDeployLock(first.home,async()=>{
    const lock=join(first.home,"state/deploy/lock"),owner=readFileSync(lock,"utf8");
    assert.equal((await syncDocsCheckout(promoted)).status,"blocked","idempotent sync respects deploy lock too");
    await assert.rejects(deploy({app:first.app,home:first.home,run:async()=>{throw new Error("must not execute");},drift:async()=>[]},target,"fixture"),/Another release/);
    assert.equal(readFileSync(lock,"utf8"),owner,"contender must not remove owner's lock");
  });
  const stale=fixture();write(stale.home,"state/deploy/lock","");await blocked(stale,/deploy lock/);assert.equal(readFileSync(join(stale.home,"state/deploy/lock"),"utf8"),"");
  console.log(JSON.stringify({ok:true,docsCheckoutSync:"exact promoted ff + scoped fetch, idempotence, dirty/untracked, branch/detached/origin, ahead/divergent, runtime/reverted interval, shared deploy-lock contention"}));
} finally {process.env.PATH=originalPath;rmSync(root,{recursive:true,force:true});}
