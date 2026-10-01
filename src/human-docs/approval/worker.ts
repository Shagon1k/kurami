// Docs proposal worker, run every minute by a Hermes no_agent job (see run-docs-approval.sh).
// It turns the Monday draft into a PR and a #updates card, applies discussion remarks, publishes on the
// owner's click, and cleans up. It never deploys application code: the release is a docs-only build.
import {spawnSync} from "node:child_process";
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,statSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename,dirname,resolve} from "node:path";
import {changedPages,disallowedPaths,parseSummary,type PageChange,type ProposalSummary} from "./policy.ts";
import {docsStateDir,kuramiHome,ProposalStore,type ProposalRow} from "./store.ts";
import {pruneReleaseCopies} from "./releases.ts";
import {ownerId} from "./discord.ts";
import {surfaceFor,type Surface} from "./surface.ts";

process.umask(0o077);

const SUMMARY_SETTLE_MS=2*60_000;
const DRAFT_TIMEOUT_MS=4*60*60_000;
const REVISION_TIMEOUT_MS=25*60_000;

export type WorkerConfig={
  home:string;
  sourceClone:string;
  /** owner/name on GitHub; derived from the source clone's origin when absent. */
  repo?:string;
  releaseRoot:string;
  appRoot:string;
  docsUrl:string;
  service:string;
  node:string;
  gh:string;
  codex:string;
  systemctl:string;
  now:()=>Date;
};

export function defaultConfig():WorkerConfig {
  const home=kuramiHome();
  const state=docsStateDir(home);
  return {
    home,
    sourceClone:process.env.KURAMI_DOCS_SOURCE_CLONE??resolve(state,"audit-source"),
    releaseRoot:state,
    appRoot:resolve(import.meta.dirname,"../../.."),
    docsUrl:(process.env.KURAMI_DOCS_SMOKE_URL??"http://127.0.0.1:8799").replace(/\/$/,""),
    service:"kurami-human-docs",
    node:process.execPath,
    gh:process.env.KURAMI_GH_BIN??"gh",
    codex:process.env.KURAMI_CODEX_BIN??"codex",
    systemctl:process.env.KURAMI_SYSTEMCTL_BIN??"systemctl",
    now:()=>new Date(),
  };
}

class ChecksFailed extends Error {}

type RunOptions={cwd?:string;timeoutMs?:number;input?:string;env?:NodeJS.ProcessEnv;allowFailure?:boolean};

function run(command:string,args:string[],options:RunOptions={}):{status:number;stdout:string;stderr:string} {
  const result=spawnSync(command,args,{
    cwd:options.cwd,input:options.input,encoding:"utf8",timeout:options.timeoutMs??120_000,
    env:{...process.env,GIT_TERMINAL_PROMPT:"0",...options.env},maxBuffer:32*1024*1024,
  });
  const status=result.status??1;
  if(status!==0&&!options.allowFailure){
    const detail=(result.stderr||result.stdout||result.error?.message||"").trim().split("\n").slice(-6).join(" ");
    throw new Error(`${command} ${args[0]??""} failed: ${detail.slice(0,400)}`);
  }
  return {status,stdout:result.stdout??"",stderr:result.stderr??""};
}

const git=(cwd:string,...args:string[])=>run("git",["-c","core.hooksPath=/dev/null",...args],{cwd}).stdout.trim();

function repoSlug(config:WorkerConfig):string {
  if(config.repo)return config.repo;
  const url=git(config.sourceClone,"remote","get-url","origin");
  const match=/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url);
  if(!match)throw new Error("Docs source clone origin is not a GitHub repository");
  return match[1];
}

function changedPaths(worktree:string):string[] {
  const output=run("git",["status","--porcelain=v1","-z","--untracked-files=all"],{cwd:worktree}).stdout;
  const paths:string[]=[];
  const entries=output.split("\0").filter(Boolean);
  for(let index=0;index<entries.length;index+=1){
    const entry=entries[index];
    paths.push(entry.slice(3));
    if(entry[0]==="R"||entry[0]==="C")index+=1;
  }
  return [...new Set(paths)];
}

/** Drop changes outside the docs allowlist; the card says what was dropped. */
function discardDisallowed(worktree:string):string[] {
  const dropped=disallowedPaths(changedPaths(worktree));
  for(const path of dropped){
    const tracked=run("git",["ls-files","--error-unmatch","--",path],{cwd:worktree,allowFailure:true}).status===0;
    if(tracked)run("git",["checkout","HEAD","--",path],{cwd:worktree});
    else rmSync(resolve(worktree,path),{force:true,recursive:true});
  }
  return dropped;
}

/** Agents are told not to commit; if one did, fold its commits back into the working tree for checking. */
function uncommitSince(worktree:string,sha:string):void {
  if(git(worktree,"rev-parse","HEAD")!==sha)run("git",["reset","--soft","--quiet",sha],{cwd:worktree});
}

function resetToHead(worktree:string):void {
  run("git",["reset","--hard","--quiet","HEAD"],{cwd:worktree});
  run("git",["clean","-fdq"],{cwd:worktree});
}

function runChecks(config:WorkerConfig,worktree:string):void {
  const result=run(config.node,["tests/human-docs/verify.ts"],{cwd:worktree,timeoutMs:5*60_000,allowFailure:true});
  if(result.status!==0){
    const tail=(result.stderr||result.stdout).trim().split("\n").slice(-4).join(" ");
    throw new ChecksFailed(`docs tests failed: ${tail.slice(0,300)}`);
  }
}

function pageDigest(config:WorkerConfig,root:string):Record<string,{title:string;hash:string}> {
  return JSON.parse(run(config.node,[resolve(config.appRoot,"src/human-docs/approval/pages.ts"),root],{timeoutMs:60_000}).stdout);
}

function pagesAgainstBase(config:WorkerConfig,row:ProposalRow):PageChange[] {
  const base=mkdtempSync(resolve(tmpdir(),"kurami-docs-base-"));
  rmSync(base,{recursive:true,force:true});
  git(config.sourceClone,"worktree","add","--detach","--quiet",base,row.base_sha);
  try{return changedPages(pageDigest(config,base),pageDigest(config,row.draft_path));}
  finally{run("git",["worktree","remove","--force",base],{cwd:config.sourceClone,allowFailure:true});rmSync(base,{recursive:true,force:true});}
}

function prBody(summary:ProposalSummary,pages:PageChange[]):string {
  return [
    summary.summaryEn,
    "",
    summary.summaryRu,
    "",
    ...pages.map(page=>`- \`${page.slug}\` — ${page.change}`),
    "",
    "Prepared by the weekly docs audit. Published only from the owner's #updates card.",
    "",
    "Docs-Impact: updated",
    "UI-Library: used",
    "UI-Reason: Page copy only; renderer and components are unchanged.",
  ].join("\n");
}

type Landed="nochange"|"landed";

/** Validate, commit, push and open (or update) the PR. Throws ChecksFailed with changes left in place. */
function land(config:WorkerConfig,store:ProposalStore,row:ProposalRow,summary:ProposalSummary,message:string):{result:Landed;dropped:string[]} {
  const dropped=discardDisallowed(row.draft_path);
  if(!changedPaths(row.draft_path).length)return {result:"nochange",dropped};
  runChecks(config,row.draft_path);
  const pages=pagesAgainstBase(config,row);
  run("git",["add","-A"],{cwd:row.draft_path});
  run("git",["-c","core.hooksPath=/dev/null","commit","--quiet","-m",message],{cwd:row.draft_path});
  run("git",["-c","core.hooksPath=/dev/null","push","--quiet","-u","origin",`HEAD:refs/heads/${row.branch}`],{cwd:row.draft_path,timeoutMs:120_000});
  const head=git(row.draft_path,"rev-parse","HEAD");
  const slug=repoSlug(config);
  let prNumber=row.pr_number,prUrl=row.pr_url;
  if(!prNumber){
    const day=new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Vilnius",day:"2-digit",month:"2-digit"}).format(new Date(row.created_at));
    prUrl=run(config.gh,["pr","create","--repo",slug,"--base","main","--head",row.branch,"--title",`docs(human-docs): weekly proposal ${day}`,"--body",prBody(summary,pages)],{cwd:row.draft_path}).stdout.trim().split("\n").pop()!;
    const match=/\/pull\/(\d+)$/.exec(prUrl);
    if(!match)throw new Error("gh did not return a pull request URL");
    prNumber=Number(match[1]);
  } else {
    run(config.gh,["pr","edit",String(prNumber),"--repo",slug,"--body",prBody(summary,pages)],{cwd:row.draft_path});
  }
  store.update(row.proposal_id,{head_sha:head,pr_number:prNumber,pr_url:prUrl,pages_json:JSON.stringify(pages),summary_ru:summary.summaryRu,summary_en:summary.summaryEn});
  store.event(row.proposal_id,"landed",{head,prNumber,dropped});
  return {result:"landed",dropped};
}

function withDropNote(summary:ProposalSummary,dropped:string[]):ProposalSummary {
  if(!dropped.length)return summary;
  const list=dropped.slice(0,4).map(path=>`\`${path}\``).join(", ");
  return {summaryRu:`${summary.summaryRu}\n\nОтброшены правки вне документации: ${list}.`,summaryEn:`${summary.summaryEn}\n-# Dropped changes outside the docs allowlist: ${list}.`};
}

const FALLBACK_SUMMARY:ProposalSummary={
  summaryRu:"Аудит не оставил описания черновика. Смотри его отчёт в #updates и изменения в PR.",
  summaryEn:"The audit left no draft summary. See its report in this channel and the PR diff.",
};

async function finalizeDraft(config:WorkerConfig,store:ProposalStore,surface:Surface,row:ProposalRow):Promise<void> {
  const now=config.now().getTime();
  const summaryReady=existsSync(row.summary_path)&&now-statSync(row.summary_path).mtimeMs>=SUMMARY_SETTLE_MS;
  const timedOut=now-Date.parse(row.created_at)>=DRAFT_TIMEOUT_MS;
  if(!summaryReady&&!timedOut)return;
  if(!existsSync(row.draft_path))throw new Error("the draft is missing on disk");
  uncommitSince(row.draft_path,row.base_sha);
  if(!changedPaths(row.draft_path).length){
    store.update(row.proposal_id,{state:"empty"},["drafting"]);
    store.event(row.proposal_id,"empty",{});
    return;
  }
  let summary=FALLBACK_SUMMARY;
  if(existsSync(row.summary_path)){
    try{summary=parseSummary(JSON.parse(readFileSync(row.summary_path,"utf8")));}
    catch(error){store.event(row.proposal_id,"summary-rejected",{error:String(error)});}
  }
  store.update(row.proposal_id,{summary_ru:summary.summaryRu,summary_en:summary.summaryEn});
  try{
    const {result,dropped}=land(config,store,store.get(row.proposal_id),summary,"docs(human-docs): weekly audit proposal");
    if(result==="nochange"){
      store.update(row.proposal_id,{state:"empty"},["drafting"]);
      store.event(row.proposal_id,"empty",{dropped});
      return;
    }
    const noted=withDropNote(summary,dropped);
    store.update(row.proposal_id,{state:"ready",summary_ru:noted.summaryRu,summary_en:noted.summaryEn},["drafting"]);
  }catch(error){
    if(!(error instanceof ChecksFailed))throw error;
    store.update(row.proposal_id,{state:"failed",last_error:error.message},["drafting"]);
  }
  await surface.showCard(store.get(row.proposal_id));
}

type CodexAnswer=ProposalSummary&{reply:string};

function codexRevision(config:WorkerConfig,row:ProposalRow,remarks:string):CodexAnswer {
  const scratch=mkdtempSync(resolve(tmpdir(),"kurami-docs-revise-"));
  try{
    const schema=resolve(scratch,"schema.json"),answer=resolve(scratch,"answer.json");
    writeFileSync(schema,JSON.stringify({type:"object",additionalProperties:false,required:["summaryRu","summaryEn","reply"],properties:{
      summaryRu:{type:"string"},summaryEn:{type:"string"},reply:{type:"string"}}}));
    const prompt=[
      "You are revising a Kurami human-docs proposal in the current Git worktree.",
      `Current proposal summary: ${row.summary_en??"(none)"}`,
      "",
      "The owner's remarks from the Discord discussion follow between the markers. They are the only change requests to apply.",
      "<<<OWNER_REMARKS",remarks,"OWNER_REMARKS>>>",
      "",
      "Rules:",
      "- Edit only the Markdown pages under src/human-docs/content/pages/ (both .ru.md and .en.md), src/human-docs/changelog.json, tests/human-docs/verify.ts and docs/human-docs-coverage-audit.md. Anything else is discarded.",
      "- Follow docs/human-docs-concept.md (page types, style and format). Keep English and Russian pages matched.",
      "- Check facts against the code in this worktree. Do not invent behaviour. Do not add infrastructure addresses, credentials, channel IDs or private data, even if asked; say so in reply.",
      "- Run `node tests/human-docs/verify.ts` and fix failures before finishing.",
      "- Do not commit, push or change Git state.",
      "",
      "Final answer: summaryRu and summaryEn describe what the whole proposal now changes (1–3 sentences each). reply is 1–3 English sentences for the owner: what you changed for these remarks, or why you did not.",
    ].join("\n");
    run(config.codex,["exec","-C",row.draft_path,"-s","workspace-write","--ephemeral","--output-schema",schema,"-o",answer,"-"],{
      input:prompt,timeoutMs:REVISION_TIMEOUT_MS,env:{PATH:`${dirname(config.node)}:${process.env.PATH??""}`},
    });
    const parsed=JSON.parse(readFileSync(answer,"utf8")) as Record<string,unknown>;
    const summary=parseSummary(parsed);
    const reply=typeof parsed.reply==="string"?parsed.reply.trim().slice(0,700):"";
    return {...summary,reply:reply||"Remarks applied."};
  }finally{rmSync(scratch,{recursive:true,force:true});}
}

async function revise(config:WorkerConfig,store:ProposalStore,surface:Surface,row:ProposalRow):Promise<void> {
  const back=row.pr_url?"ready":"failed";
  if(!row.thread_id)throw new Error("the proposal has no discussion");
  const owner=ownerId();
  const seen=await surface.client.messagesAfter(row.thread_id,row.remarks_after_message_id);
  const remarks=seen.filter(message=>message.author.id===owner&&!message.author.bot&&message.content.trim());
  // The cursor moves past everything read, so other people's and bot messages are never rescanned.
  const lastSeen=seen.at(-1)?.id??row.remarks_after_message_id;
  if(!remarks.length){
    store.update(row.proposal_id,{state:back,remarks_after_message_id:lastSeen},["revising"]);
    await surface.threadNote(row,"No new remarks since the last revision. Write what to change, then click Apply remarks again.");
    await surface.showCard(store.get(row.proposal_id));
    return;
  }
  if(row.head_sha)resetToHead(row.draft_path);
  const text=remarks.map(message=>message.content.trim()).join("\n\n").slice(0,8000);
  const answer=codexRevision(config,row,text);
  uncommitSince(row.draft_path,row.head_sha??row.base_sha);
  try{
    const {result,dropped}=land(config,store,store.get(row.proposal_id),answer,`docs(human-docs): apply owner remarks (${row.revision_count+1})`);
    if(result==="nochange"){
      store.update(row.proposal_id,{state:back,remarks_after_message_id:lastSeen},["revising"]);
      await surface.threadNote(row,`The agent changed nothing. ${answer.reply}`);
    } else {
      const noted=withDropNote(answer,dropped);
      store.update(row.proposal_id,{state:"ready",last_error:null,revision_count:row.revision_count+1,remarks_after_message_id:lastSeen,summary_ru:noted.summaryRu,summary_en:noted.summaryEn},["revising"]);
      await surface.threadNote(row,`Done, the branch is updated. ${answer.reply}`);
    }
  }catch(error){
    if(!(error instanceof ChecksFailed))throw error;
    if(row.head_sha)resetToHead(row.draft_path);
    store.update(row.proposal_id,{state:back,remarks_after_message_id:lastSeen,...(back==="failed"?{last_error:error.message}:{})},["revising"]);
    await surface.threadNote(row,`The edits failed the checks and were reverted (${error.message}). Clarify the remarks and click Apply remarks again.`);
  }
  await surface.showCard(store.get(row.proposal_id));
}

async function smoke(config:WorkerConfig):Promise<void> {
  const routes=["/en/","/ru/what-is-kurami/"];
  for(let attempt=0;attempt<20;attempt+=1){
    try{
      const statuses=await Promise.all(routes.map(async route=>(await fetch(`${config.docsUrl}${route}`,{signal:AbortSignal.timeout(2000)})).status));
      if(statuses.every(status=>status===200))return;
    }catch{/* server still starting */}
    await new Promise(done=>setTimeout(done,500));
  }
  throw new Error("the docs site did not answer after the restart");
}

function readDocsSha(dir:string):string|null {
  try{return (JSON.parse(readFileSync(resolve(dir,"build.json"),"utf8")) as {docsSha?:string}).docsSha??null;}catch{return null;}
}

/** Build a docs-only release from origin/main in a throwaway worktree, swap it in, keep the old one for rollback. */
export async function releaseDocs(config:WorkerConfig,mergedSha:string):Promise<{docsSha:string;rollbackDir:string}> {
  git(config.sourceClone,"fetch","--quiet","--no-tags","origin","refs/heads/main:refs/remotes/origin/main");
  const tip=git(config.sourceClone,"rev-parse","refs/remotes/origin/main");
  if(run("git",["merge-base","--is-ancestor",mergedSha,tip],{cwd:config.sourceClone,allowFailure:true}).status!==0)throw new Error("the merged commit is not on main");
  const stamp=config.now().toISOString().replace(/\D/g,"").slice(0,14);
  const build=resolve(config.releaseRoot,`build-${tip.slice(0,12)}-${stamp}`);
  git(config.sourceClone,"worktree","add","--detach","--quiet",build,tip);
  try{
    run(config.node,["src/human-docs/build.ts","--docs-release"],{cwd:build,timeoutMs:5*60_000});
    const output=resolve(build,"dist/human-docs");
    const info=JSON.parse(readFileSync(resolve(output,"build.json"),"utf8")) as {mode?:string;docsSha?:string;revision?:string|null};
    if(info.mode!=="release"||info.docsSha!==tip||info.revision!==null)throw new Error("the docs build produced an unexpected build.json");
    const stage=resolve(config.releaseRoot,`stage-${tip}`);
    rmSync(stage,{recursive:true,force:true});
    cpSync(output,stage,{recursive:true});
    const current=resolve(config.releaseRoot,"release");
    const previous=readDocsSha(current)??"unknown";
    let rollback=resolve(config.releaseRoot,`rollback-${previous}`);
    if(existsSync(rollback))rollback=`${rollback}-${stamp}`;
    const hadCurrent=existsSync(current);
    if(hadCurrent)renameSync(current,rollback);
    renameSync(stage,current);
    try{
      run(config.systemctl,["--user","restart",config.service],{timeoutMs:60_000});
      await smoke(config);
    }catch(error){
      renameSync(current,resolve(config.releaseRoot,`failed-${tip}-${stamp}`));
      if(hadCurrent)renameSync(rollback,current);
      run(config.systemctl,["--user","restart",config.service],{timeoutMs:60_000,allowFailure:true});
      throw new Error(`${error instanceof Error?error.message:String(error)}; the previous release was restored`);
    }
    // Older copies are only space: any of them can be rebuilt from its docs revision.
    try{pruneReleaseCopies(config.releaseRoot,{keep:3,now:config.now().getTime(),protect:[basename(rollback)]});}catch{/* next release retries */}
    return {docsSha:tip,rollbackDir:rollback};
  }finally{
    run("git",["worktree","remove","--force",build],{cwd:config.sourceClone,allowFailure:true});
    rmSync(build,{recursive:true,force:true});
  }
}

async function publish(config:WorkerConfig,store:ProposalStore,surface:Surface,row:ProposalRow):Promise<void> {
  let mergedSha=row.merged_sha;
  if(!mergedSha){
    try{
      if(!row.pr_number||!row.head_sha)throw new Error("the proposal has no PR");
      const slug=repoSlug(config);
      const view=()=>JSON.parse(run(config.gh,["pr","view",String(row.pr_number),"--repo",slug,"--json","state,headRefOid,files,mergeCommit"]).stdout) as {state:string;headRefOid:string;files:Array<{path:string}>;mergeCommit:{oid:string}|null};
      const before=view();
      if(before.headRefOid!==row.head_sha||row.requested_head_sha!==row.head_sha)throw new Error("the PR branch changed after the card was shown");
      const outside=disallowedPaths(before.files.map(file=>file.path));
      if(outside.length)throw new Error(`the PR changes files outside the docs: ${outside.slice(0,3).join(", ")}`);
      if(before.state==="OPEN")run(config.gh,["pr","merge",String(row.pr_number),"--repo",slug,"--squash","--match-head-commit",row.head_sha]);
      else if(before.state!=="MERGED")throw new Error("the PR was closed without a merge");
      const after=view();
      if(after.state!=="MERGED"||!after.mergeCommit?.oid)throw new Error("GitHub did not confirm the merge");
      mergedSha=after.mergeCommit.oid;
      store.update(row.proposal_id,{merged_sha:mergedSha});
      store.event(row.proposal_id,"merged",{mergedSha});
    }catch(error){
      store.update(row.proposal_id,{state:"ready",last_error:error instanceof Error?error.message:String(error)},["publishing"]);
      await surface.showCard(store.get(row.proposal_id));
      return;
    }
  }
  try{
    const {docsSha,rollbackDir}=await releaseDocs(config,mergedSha);
    store.update(row.proposal_id,{state:"published",published_docs_sha:docsSha,rollback_dir:rollbackDir,last_error:null},["publishing"]);
    store.event(row.proposal_id,"published",{docsSha,rollbackDir});
    run("git",["push","--quiet","origin","--delete",row.branch],{cwd:config.sourceClone,allowFailure:true});
  }catch(error){
    store.update(row.proposal_id,{state:"failed",last_error:error instanceof Error?error.message:String(error)},["publishing"]);
  }
  await surface.showCard(store.get(row.proposal_id));
}

async function cleanup(config:WorkerConfig,store:ProposalStore,surface:Surface,row:ProposalRow):Promise<void> {
  if(row.state==="rejected"&&row.pr_number){
    const slug=repoSlug(config);
    const state=JSON.parse(run(config.gh,["pr","view",String(row.pr_number),"--repo",slug,"--json","state"]).stdout) as {state:string};
    if(state.state==="OPEN")run(config.gh,["pr","close",String(row.pr_number),"--repo",slug,"--comment","Rejected by the owner from the #updates card."]);
  }
  run("git",["worktree","remove","--force",row.draft_path],{cwd:config.sourceClone,allowFailure:true});
  run("git",["branch","-D",row.branch],{cwd:config.sourceClone,allowFailure:true});
  rmSync(dirname(row.draft_path),{recursive:true,force:true});
  store.update(row.proposal_id,{cleaned_at:store.now()});
  store.event(row.proposal_id,"cleaned",{});
  // A rejected card may still show buttons if the refresh after the click was lost.
  if(row.card_message_id)await surface.showCard(store.get(row.proposal_id));
}

export async function tick(config:WorkerConfig,store:ProposalStore,surface:Surface):Promise<string[]> {
  const handled:string[]=[];
  const guarded=async(row:ProposalRow,step:(row:ProposalRow)=>Promise<void>)=>{
    try{await step(row);handled.push(`${row.proposal_id}:${row.state}`);}
    catch(error){
      const message=error instanceof Error?error.message:String(error);
      store.event(row.proposal_id,"worker-error",{state:row.state,message});
      const fresh=store.get(row.proposal_id);
      if(fresh.state===row.state&&row.state!=="publishing"){
        store.update(row.proposal_id,{state:"failed",last_error:message.slice(0,300)},[row.state]);
        try{await surface.showCard(store.get(row.proposal_id));}catch{/* next tick */}
      }
      handled.push(`${row.proposal_id}:error`);
    }
  };
  for(const row of store.inStates(["publishing"]))await guarded(row,current=>publish(config,store,surface,current));
  for(const row of store.inStates(["revising"]))await guarded(row,current=>revise(config,store,surface,current));
  for(const row of store.inStates(["drafting"]))await guarded(row,current=>finalizeDraft(config,store,surface,current));
  for(const row of store.needingCleanup(["published","rejected","empty"])){
    try{await cleanup(config,store,surface,row);}catch(error){store.event(row.proposal_id,"cleanup-error",{message:String(error)});}
  }
  return handled;
}

if(import.meta.main){
  if(process.argv[2]!=="tick")throw new Error("Usage: worker.ts tick");
  const config=defaultConfig();
  mkdirSync(config.releaseRoot,{recursive:true});
  const store=ProposalStore.open(config.home);
  try{
    const handled=await tick(config,store,surfaceFor(store));
    if(handled.length)process.stderr.write(`${JSON.stringify({handled})}\n`);
  }finally{store.close();}
}
