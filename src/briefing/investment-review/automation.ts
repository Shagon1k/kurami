import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {lstat,mkdir,readFile,readdir,rename,rm,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {resolveKuramiHome} from "../../core/kurami-home.ts";
import {dayShift} from "../stocks/model.ts";
import {dateOnly,calculateReview,parseReviewInput,validateReviewDraft,type PortfolioBaseline,type ReviewInput} from "./model.ts";
import {prepareReviewRun,finishSources} from "./run.ts";
import {primaryCheckPacket,primaryEvidence,validatePrimaryCheck} from "./primary-evidence.ts";
import {acceptReview,loadReview,type StoredReview} from "./store.ts";
import type {ResearchTarget} from "./collect.ts";
import type {PrimaryCollection} from "./primary.ts";

const TIMEZONE="Europe/Vilnius";
const MAX_SYNTHESIS_CALLS=3;
const SYNTHESIS_TIMEOUT_MS=5*60_000;

type AttemptOutcome="running"|"accepted"|"skipped"|"rejected"|"failed";
export type WeeklyAutomationState={version:1;updatedAt:string;
  lastAttempt:{localDate:string;startedAt:string;finishedAt:string|null;outcome:AttemptOutcome;reason:string;runDirectory:string|null;reviewId:string|null};
  lastSuccess:{localDate:string;reviewId:string;acceptedAt:string}|null};
export type WeeklyAutomationReceipt={version:1;command:"run"|"dry-run"|"inspect";timezone:typeof TIMEZONE;localDate:string;isSunday:boolean;
  outcome:"accepted"|"skipped"|"rejected"|"failed"|"would-run"|"blocked";reason:string;baselinePath:string|null;
  baselineDate:string|null;runDirectory:string|null;reviewId:string|null;previousReviewId:string|null;synthesisCalls:number;statePath:string};

type Synthesize=(packetPath:string,outputDirectory:string)=>Promise<void>;
export type WeeklyAutomationDependencies={
  now:()=>Date;
  prepare:typeof prepareReviewRun;
  finish:typeof finishSources;
  synthesize:Synthesize;
  accept:typeof acceptReview;
  load:typeof loadReview;
};
export type WeeklyAutomationOptions={baselinePath?:string;targetsPath?:string;portfolioDirectory?:string;hermesRepository?:string;python?:string};

const readJson=async(path:string,max=3_000_000)=>{
  const stat=await lstat(path);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size>max)throw Error("Unsafe or oversized automation input");
  return JSON.parse(await readFile(path,"utf8")) as unknown;
};
const readPrivateJson=async(path:string,max=3_000_000)=>{
  const stat=await lstat(path);
  if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o077)||stat.size>max)throw Error("Expected a private regular file");
  return JSON.parse(await readFile(path,"utf8")) as unknown;
};
async function writePrivate(path:string,value:unknown){
  await writeFile(path,JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});
}
async function ensurePrivateDirectory(path:string){
  await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);
  if(stat.isSymbolicLink()||!stat.isDirectory()||(stat.mode&0o077))throw Error("Unsafe automation state directory");
}
async function writeState(path:string,value:WeeklyAutomationState){
  const temporary=join(resolve(path,".."),"automation-state-"+randomUUID()+".json");
  await writePrivate(temporary,value);
  try{await rename(temporary,path);}finally{await rm(temporary,{force:true});}
}
function localClock(at:Date){
  if(!Number.isFinite(at.getTime()))throw Error("Invalid automation clock");
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"}).formatToParts(at);
  const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(p=>p.type===type)?.value??"";
  const localDate=`${part("year")}-${part("month")}-${part("day")}`;
  if(!dateOnly(localDate))throw Error("Cannot determine local automation date");
  return {localDate,isSunday:part("weekday")==="Sun"};
}
function baselineSummary(value:unknown):{baseline:PortfolioBaseline;date:string}{
  const b=value as PortfolioBaseline;
  if(b?.version!==1||!dateOnly(b.asOfLocalDate)||b.timezone!==TIMEZONE||!Array.isArray(b.positions)||!b.positions.length||b.positions.length>50
    ||new Set(b.positions.map(p=>p.symbol)).size!==b.positions.length||b.positions.some(p=>!/^[A-Z][A-Z0-9.-]{0,15}$/.test(p.symbol)
      ||!/^[A-Z]{2}[A-Z0-9]{10}$/.test(p.isin)||typeof p.quantity!=="string"||!/^\d+(?:\.\d{1,8})?$/.test(p.quantity)||Number(p.quantity)<=0||Number(p.quantity)>1e9)
    ||!b.unknowns||!(b.unknowns.currentMonthExecutedTrades===null||Number.isSafeInteger(b.unknowns.currentMonthExecutedTrades)&&b.unknowns.currentMonthExecutedTrades>=0)
    ||!(b.unknowns.currentMonthNewContributionsEUR===null||Number.isFinite(b.unknowns.currentMonthNewContributionsEUR)&&b.unknowns.currentMonthNewContributionsEUR>=0))throw Error("Invalid portfolio baseline");
  return {baseline:b,date:b.asOfLocalDate};
}
async function resolveBaseline(portfolioDirectory:string,explicit:string|undefined){
  if(explicit){
    const path=resolve(explicit),summary=baselineSummary(await readPrivateJson(path));
    return {path,...summary};
  }
  const names=(await readdir(portfolioDirectory)).filter(name=>/^baseline-[A-Za-z0-9._-]+\.json$/.test(name));
  if(!names.length)throw Error("No private portfolio baseline found");
  const choices=await Promise.all(names.map(async name=>{
    const path=join(portfolioDirectory,name),summary=baselineSummary(await readPrivateJson(path));
    return {path,name,...summary};
  }));
  choices.sort((a,b)=>b.date.localeCompare(a.date)||b.name.localeCompare(a.name));
  return choices[0]!;
}
function parseTargets(value:unknown,baseline:PortfolioBaseline):ResearchTarget[]{
  if(!Array.isArray(value)||!value.length||value.length>15)throw Error("Invalid investment-review target registry");
  const targets=value as ResearchTarget[];
  if(new Set(targets.map(t=>t.symbol)).size!==targets.length||targets.some(t=>!/^[A-Z][A-Z0-9.-]{0,15}$/.test(t.symbol)
    ||typeof t.namePattern!=="string"||t.namePattern.length<3||t.namePattern.length>100))throw Error("Invalid investment-review target registry");
  const held=baseline.positions.filter(p=>p.symbol!=="VUAA").map(p=>p.symbol);
  if(held.some(symbol=>!targets.some(t=>t.symbol===symbol)))throw Error("Issuer registry does not cover current positions");
  return targets;
}
async function firstExisting(paths:string[]){
  for(const path of paths)try{const stat=await lstat(path);if(stat.isFile()&&!stat.isSymbolicLink())return path;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  throw Error("Investment-review target registry not found");
}
function parseState(value:unknown):WeeklyAutomationState{
  const s=value as WeeklyAutomationState,a=s?.lastAttempt,u=s?.lastSuccess;
  if(s?.version!==1||!Number.isFinite(Date.parse(s.updatedAt))||!a||!dateOnly(a.localDate)||!Number.isFinite(Date.parse(a.startedAt))
    ||!(a.finishedAt===null||Number.isFinite(Date.parse(a.finishedAt)))||!["running","accepted","skipped","rejected","failed"].includes(a.outcome)
    ||typeof a.reason!=="string"||!(a.runDirectory===null||typeof a.runDirectory==="string")||!(a.reviewId===null||/^[a-f0-9]{64}$/.test(a.reviewId))
    ||!(u===null||dateOnly(u.localDate)&&/^[a-f0-9]{64}$/.test(u.reviewId)&&Number.isFinite(Date.parse(u.acceptedAt))))throw Error("Invalid weekly automation state");
  return s;
}
async function loadState(path:string):Promise<WeeklyAutomationState|null>{
  try{return parseState(await readPrivateJson(path));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
}
function successFromReview(review:StoredReview|null,state:WeeklyAutomationState|null){
  const stored=state?.lastSuccess??null;
  if(!review)return stored;
  const current={localDate:review.input.asOfDate,reviewId:review.id,acceptedAt:review.acceptedAt};
  return !stored||current.localDate>=stored.localDate?current:stored;
}
function stateFor(previous:WeeklyAutomationState|null,at:string,attempt:WeeklyAutomationState["lastAttempt"],success=previous?.lastSuccess??null):WeeklyAutomationState{
  return {version:1,updatedAt:at,lastAttempt:attempt,lastSuccess:success};
}
function assertReadyInput(value:unknown,localDate:string):ReviewInput{
  const input=parseReviewInput(value);
  if(input.mode!=="weekly"||input.asOfDate!==localDate)throw Error("Prepared input is not this weekly review");
  const metrics=calculateReview(input);
  if(!metrics.complete)throw Error("Current quote snapshot is incomplete");
  if(metrics.requiresPositionConfirmation)throw Error("Current positions cannot be confirmed");
  if(input.baseline.positions.some(p=>p.symbol==="VUAA")&&!metrics.fundHoldingsUsable)throw Error("Fund evidence is incomplete");
  const coverage=new Map(input.researchCoverage?.map(row=>[row.symbol,row.state]));
  if(input.baseline.positions.some(p=>!["fresh","primary"].includes(coverage.get(p.symbol)??"")))throw Error("Position evidence is incomplete");
  if(input.baseline.positions.some(p=>!input.facts.some(f=>f.symbol===p.symbol)))throw Error("Position evidence is incomplete");
  return input;
}
function receipt(command:WeeklyAutomationReceipt["command"],clock:ReturnType<typeof localClock>,statePath:string,values:Partial<WeeklyAutomationReceipt>):WeeklyAutomationReceipt{
  return {version:1,command,timezone:TIMEZONE,...clock,outcome:"blocked",reason:"unknown",baselinePath:null,baselineDate:null,runDirectory:null,
    reviewId:null,previousReviewId:null,synthesisCalls:0,statePath,...values};
}
function errorText(error:unknown){return (error instanceof Error?error.message:"Unknown automation failure").slice(0,300);}
function failureReason(stage:string,error:unknown){
  const message=errorText(error);
  if(/quote snapshot is incomplete/i.test(message))return "quotes-incomplete";
  if(/positions cannot be confirmed|baseline.*stale/i.test(message))return "positions-unconfirmed";
  if(/evidence|fund source|issuer registry|primary source|Vanguard/i.test(message))return "evidence-incomplete";
  if(stage.includes("synthesis"))return "synthesis-failed";
  if(stage==="validation")return "validation-failed";
  return stage+"-failed";
}
async function defaultSynthesize(packetPath:string,outputDirectory:string,options:{python:string;hermesRepository:string}){
  const runner=resolve(import.meta.dirname,"../../../bin/investment-review-trial.py");
  await new Promise<void>((resolvePromise,reject)=>{
    execFile(options.python,["-B",runner,"--hermes-repo",options.hermesRepository,"--packet",packetPath,"--output",outputDirectory],
      {timeout:SYNTHESIS_TIMEOUT_MS,maxBuffer:1_000_000},error=>error?reject(Error("Tool-free synthesis process failed")):resolvePromise());
  });
}
function runtimeOptions(options:WeeklyAutomationOptions){
  const home=resolveKuramiHome(resolve(import.meta.dirname,"../../../..")),stateDirectory=join(home,"state/briefing"),portfolioDirectory=resolve(options.portfolioDirectory??join(stateDirectory,"portfolio"));
  const hermesRepository=resolve(options.hermesRepository??process.env.HERMES_REPOSITORY??resolve(home,"../_core/hermes-agent"));
  // Hermes' repository venv is the default runtime, not the host's system Python.
  // The trial imports Hermes internals and cannot run under a bare interpreter.
  const bundledPython=join(hermesRepository,"venv/bin/python");
  const python=options.python??process.env.HERMES_PYTHON??(existsSync(bundledPython)?bundledPython:"python3");
  return {paths:{home,stateDirectory},portfolioDirectory,statePath:join(portfolioDirectory,"weekly-automation.json"),lockPath:join(portfolioDirectory,"weekly-automation.lock"),
    reviewsDirectory:join(portfolioDirectory,"reviews"),runsDirectory:join(portfolioDirectory,"weekly-runs"),hermesRepository,python};
}

export async function inspectWeeklyInvestmentReview(command:"dry-run"|"inspect",options:WeeklyAutomationOptions={},at=new Date()):Promise<WeeklyAutomationReceipt>{
  const runtime=runtimeOptions(options),clock=localClock(at);
  let state:WeeklyAutomationState|null=null,previous:StoredReview|null=null;
  try{state=await loadState(runtime.statePath);}catch(error){return receipt(command,clock,runtime.statePath,{outcome:"blocked",reason:"invalid-run-state:"+errorText(error)});}
  try{previous=await loadReview(runtime.reviewsDirectory,"weekly");}catch(error){return receipt(command,clock,runtime.statePath,{outcome:"blocked",reason:"invalid-accepted-review:"+errorText(error)});}
  const common={previousReviewId:previous?.id??null,reviewId:state?.lastSuccess?.reviewId??previous?.id??null};
  if(command==="inspect"){
    const outcome=state?.lastAttempt.outcome==="running"?"blocked":state?.lastAttempt.outcome??"would-run";
    return receipt(command,clock,runtime.statePath,{...common,outcome,reason:state?.lastAttempt.reason??"no-attempt-recorded",
      runDirectory:state?.lastAttempt.runDirectory??null});
  }
  if(!clock.isSunday)return receipt(command,clock,runtime.statePath,{...common,outcome:"skipped",reason:"not-sunday"});
  if(state?.lastAttempt.localDate===clock.localDate)return receipt(command,clock,runtime.statePath,{...common,outcome:"skipped",reason:"already-attempted-today",runDirectory:state.lastAttempt.runDirectory});
  if(previous?.input.asOfDate===clock.localDate)return receipt(command,clock,runtime.statePath,{...common,outcome:"skipped",reason:"weekly-review-already-accepted"});
  try{
    const selected=await resolveBaseline(runtime.portfolioDirectory,options.baselinePath);
    if(selected.date>clock.localDate||selected.date<dayShift(clock.localDate,-30))return receipt(command,clock,runtime.statePath,{...common,outcome:"blocked",reason:"positions-unconfirmed",baselinePath:selected.path,baselineDate:selected.date});
    const targetsPath=options.targetsPath?resolve(options.targetsPath):await firstExisting([join(runtime.paths.home,"config/investment-review-targets.json"),resolve(import.meta.dirname,"../../../deploy/config/investment-review-targets.json")]);
    parseTargets(await readJson(targetsPath),selected.baseline);
    return receipt(command,clock,runtime.statePath,{...common,outcome:"would-run",reason:"eligible",baselinePath:selected.path,baselineDate:selected.date,
      runDirectory:join(runtime.runsDirectory,clock.localDate)});
  }catch(error){return receipt(command,clock,runtime.statePath,{...common,outcome:"blocked",reason:"preflight-failed:"+errorText(error)});}
}

export async function runWeeklyInvestmentReview(options:WeeklyAutomationOptions={},overrides:Partial<WeeklyAutomationDependencies>={}):Promise<WeeklyAutomationReceipt>{
  const runtime=runtimeOptions(options),now=(overrides.now??(()=>new Date()))(),clock=localClock(now),startedAt=now.toISOString();
  await ensurePrivateDirectory(runtime.portfolioDirectory);
  let lock=false;
  try{
    try{await writeFile(runtime.lockPath,JSON.stringify({localDate:clock.localDate,startedAt})+"\n",{mode:0o600,flag:"wx"});lock=true;}
    catch(error){if((error as NodeJS.ErrnoException).code==="EEXIST")return receipt("run",clock,runtime.statePath,{outcome:"skipped",reason:"automation-locked"});throw error;}
    let state=await loadState(runtime.statePath),previous=await (overrides.load??loadReview)(runtime.reviewsDirectory,"weekly"),lastSuccess=successFromReview(previous,state);
    const common={previousReviewId:previous?.id??null,reviewId:lastSuccess?.reviewId??null};
    if(!clock.isSunday){
      const attempt={localDate:clock.localDate,startedAt,finishedAt:startedAt,outcome:"skipped" as const,reason:"not-sunday",runDirectory:null,reviewId:null};
      await writeState(runtime.statePath,stateFor(state,startedAt,attempt,lastSuccess));
      return receipt("run",clock,runtime.statePath,{...common,outcome:"skipped",reason:"not-sunday"});
    }
    if(state?.lastAttempt.localDate===clock.localDate)return receipt("run",clock,runtime.statePath,{...common,outcome:"skipped",reason:"already-attempted-today",runDirectory:state.lastAttempt.runDirectory});
    if(previous?.input.asOfDate===clock.localDate){
      const attempt={localDate:clock.localDate,startedAt,finishedAt:startedAt,outcome:"skipped" as const,reason:"weekly-review-already-accepted",runDirectory:null,reviewId:previous.id};
      await writeState(runtime.statePath,stateFor(state,startedAt,attempt,lastSuccess));
      return receipt("run",clock,runtime.statePath,{...common,reviewId:previous.id,outcome:"skipped",reason:"weekly-review-already-accepted"});
    }
    let selected:Awaited<ReturnType<typeof resolveBaseline>>,targets:ResearchTarget[];
    try{
      selected=await resolveBaseline(runtime.portfolioDirectory,options.baselinePath);
      if(selected.date>clock.localDate||selected.date<dayShift(clock.localDate,-30))throw Error("Portfolio baseline is stale or future dated; current positions cannot be confirmed");
      const targetsPath=options.targetsPath?resolve(options.targetsPath):await firstExisting([join(runtime.paths.home,"config/investment-review-targets.json"),resolve(import.meta.dirname,"../../../deploy/config/investment-review-targets.json")]);
      targets=parseTargets(await readJson(targetsPath),selected.baseline);
    }catch(error){
      const reason=failureReason("preflight",error),attempt={localDate:clock.localDate,startedAt,finishedAt:new Date().toISOString(),outcome:"rejected" as const,reason,runDirectory:null,reviewId:null};
      await writeState(runtime.statePath,stateFor(state,attempt.finishedAt!,attempt,lastSuccess));
      return receipt("run",clock,runtime.statePath,{...common,outcome:"rejected",reason,baselinePath:options.baselinePath?resolve(options.baselinePath):null});
    }
    const runDirectory=join(runtime.runsDirectory,clock.localDate);
    await ensurePrivateDirectory(runtime.runsDirectory);
    let stage="collection",synthesisCalls=0;
    const running={localDate:clock.localDate,startedAt,finishedAt:null,outcome:"running" as const,reason:"in-progress",runDirectory,reviewId:null};
    await writeState(runtime.statePath,stateFor(state,startedAt,running,lastSuccess));
    state=stateFor(state,startedAt,running,lastSuccess);
    const synthesize=overrides.synthesize??((packet,output)=>defaultSynthesize(packet,output,{python:runtime.python,hermesRepository:runtime.hermesRepository}));
    try{
      const prepared=await (overrides.prepare??prepareReviewRun)(clock.localDate,selected.path,targets,runDirectory,"weekly");
      if(prepared.stage==="extraction-ready"){
        stage="primary-extraction-synthesis";synthesisCalls++;if(synthesisCalls>MAX_SYNTHESIS_CALLS)throw Error("Synthesis call budget exceeded");
        const extractionDirectory=join(runDirectory,"primary-extraction");
        await synthesize(join(runDirectory,"extraction-packet.json"),extractionDirectory);
        const extractionPath=join(extractionDirectory,"draft.json"),collection=await readJson(join(runDirectory,"primary.json")) as PrimaryCollection,extraction=await readJson(extractionPath);
        const evidence=primaryEvidence(collection,extraction);
        if(evidence.coverage.some(row=>row.state!=="extracted"))throw Error("Primary evidence is incomplete");
        stage="primary-check-synthesis";
        await writePrivate(join(runDirectory,"check-packet.json"),primaryCheckPacket(collection,extraction));
        synthesisCalls++;if(synthesisCalls>MAX_SYNTHESIS_CALLS)throw Error("Synthesis call budget exceeded");
        const checkDirectory=join(runDirectory,"primary-check");
        await synthesize(join(runDirectory,"check-packet.json"),checkDirectory);
        validatePrimaryCheck(collection,extraction,await readJson(join(checkDirectory,"draft.json")));
        stage="evidence";
        await (overrides.finish??finishSources)(runDirectory,extractionPath,true);
      }else if(prepared.stage!=="draft-ready")throw Error("Collection did not produce a draft packet");
      stage="evidence";
      const input=assertReadyInput(await readJson(join(runDirectory,"input.json")),clock.localDate);
      stage="review-synthesis";synthesisCalls++;if(synthesisCalls>MAX_SYNTHESIS_CALLS)throw Error("Synthesis call budget exceeded");
      const reviewDirectory=join(runDirectory,"review-synthesis");
      await synthesize(join(runDirectory,"draft-packet.json"),reviewDirectory);
      stage="validation";
      const draft=validateReviewDraft(input,await readJson(join(reviewDirectory,"draft.json")));
      stage="acceptance";
      const saved=await (overrides.accept??acceptReview)(runtime.reviewsDirectory,input,draft,now.toISOString());
      const finishedAt=new Date().toISOString(),success={localDate:clock.localDate,reviewId:saved.id,acceptedAt:saved.acceptedAt};
      const attempt={localDate:clock.localDate,startedAt,finishedAt,outcome:"accepted" as const,reason:"accepted",runDirectory,reviewId:saved.id};
      await writeState(runtime.statePath,stateFor(state,finishedAt,attempt,success));
      return receipt("run",clock,runtime.statePath,{outcome:"accepted",reason:"accepted",baselinePath:selected.path,baselineDate:selected.date,runDirectory,
        reviewId:saved.id,previousReviewId:previous?.id??null,synthesisCalls});
    }catch(error){
      const reason=failureReason(stage,error),finishedAt=new Date().toISOString(),outcome=stage==="validation"||reason.includes("incomplete")||reason==="positions-unconfirmed"?"rejected" as const:"failed" as const;
      const attempt={localDate:clock.localDate,startedAt,finishedAt,outcome,reason,runDirectory,reviewId:null};
      await writeState(runtime.statePath,stateFor(state,finishedAt,attempt,lastSuccess));
      return receipt("run",clock,runtime.statePath,{outcome,reason:reason+":"+errorText(error),baselinePath:selected.path,baselineDate:selected.date,runDirectory,
        reviewId:lastSuccess?.reviewId??null,previousReviewId:previous?.id??null,synthesisCalls});
    }
  }catch(error){
    return receipt("run",clock,runtime.statePath,{outcome:"failed",reason:"state-failed:"+errorText(error)});
  }finally{if(lock)await rm(runtime.lockPath,{force:true});}
}

function parseCli(args:string[]){
  const [command,...rest]=args;if(!["run","dry-run","inspect"].includes(command??""))throw Error("Use run, dry-run or inspect");
  const flags=new Map<string,string>();
  for(let index=0;index<rest.length;index+=2){const key=rest[index],value=rest[index+1];if(!key?.startsWith("--")||!value||flags.has(key))throw Error("Invalid automation arguments");flags.set(key,value);}
  const allowed=new Set(["--baseline","--targets","--hermes-repo","--python",...(command==="run"?[]:["--now"])]);
  if([...flags.keys()].some(key=>!allowed.has(key)))throw Error("Unknown automation argument");
  const options:WeeklyAutomationOptions={baselinePath:flags.get("--baseline"),targetsPath:flags.get("--targets"),hermesRepository:flags.get("--hermes-repo"),python:flags.get("--python")};
  return {command:command as "run"|"dry-run"|"inspect",options,now:flags.has("--now")?new Date(flags.get("--now")!):new Date()};
}
if(import.meta.main){
  try{
    const cli=parseCli(process.argv.slice(2));
    const result=cli.command==="run"?await runWeeklyInvestmentReview(cli.options):await inspectWeeklyInvestmentReview(cli.command,cli.options,cli.now);
    console.log(JSON.stringify(result));
    if(result.outcome==="failed"||result.outcome==="rejected"||result.outcome==="blocked")process.exitCode=1;
  }catch(error){console.log(JSON.stringify({version:1,command:process.argv[2]??null,outcome:"failed",reason:errorText(error)}));process.exitCode=1;}
}
