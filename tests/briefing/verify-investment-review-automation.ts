import assert from "node:assert/strict";
import {mkdir,mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runWeeklyInvestmentReview,inspectWeeklyInvestmentReview,type WeeklyAutomationDependencies} from "../../src/briefing/investment-review/automation.ts";
import {inputDigest,type PortfolioBaseline,type ReviewDraft,type ReviewInput} from "../../src/briefing/investment-review/model.ts";
import {acceptReview,loadReview} from "../../src/briefing/investment-review/store.ts";
import {renderReviewPanel} from "../../src/briefing/investment-review/panel.ts";
import type {prepareReviewRun} from "../../src/briefing/investment-review/run.ts";

const dayBefore=(date:string,days:number)=>new Date(Date.parse(date+"T12:00:00Z")-days*86400000).toISOString().slice(0,10);
function baseline(date:string):PortfolioBaseline{return {version:1,asOfLocalDate:date,timezone:"Europe/Vilnius",positions:[
  {symbol:"AAA",isin:"US1234567890",quantity:"2"},{symbol:"VUAA",isin:"IE00BFMXXD54",quantity:"5"}
],unknowns:{currentMonthExecutedTrades:null,currentMonthNewContributionsEUR:null}};}
function input(date:string,base=baseline(date)):ReviewInput{
  const quote=dayBefore(date,2),retrieved=date+"T07:00:00Z";
  const assets=[{id:"AAA",symbol:"AAA.US",isin:"US1234567890",name:"Example stock",currency:"USD" as const,exchange:"US" as const,timezone:"America/New_York",kind:"stock" as const},
    {id:"VUAA",symbol:"VUAA.XETRA",isin:"IE00BFMXXD54",name:"Example fund",currency:"EUR" as const,exchange:"XETRA" as const,timezone:"Europe/Berlin",kind:"etf" as const}];
  return {version:1,asOfDate:date,mode:"weekly",baseline:base,
    market:{version:1,state:"ready",capturedAt:retrieved,data:{provider:"eodhd",policy:{enabled:true,assets,benchmark:"VUAA",moveThresholdPercent:2},
      series:assets.map((asset,index)=>({asset,state:"ready",fetchedAt:retrieved,points:[{date:quote,close:index?20:100,adjusted:index?20:100}]}))}},
    fx:{date:quote,usdPerEUR:2,sourceId:"ecb"},sources:[
      {id:"ecb",title:"ECB",url:"https://www.ecb.europa.eu/example",asOfDate:quote,retrievedAt:retrieved},
      {id:"issuer",title:"Issuer",url:"https://issuer.example/report",asOfDate:quote,retrievedAt:retrieved},
      {id:"vanguard",title:"Vanguard",url:"https://global.vanguard.com/example",asOfDate:quote,retrievedAt:retrieved}
    ],facts:[{id:"aaa-fact",symbol:"AAA",sourceId:"issuer",statement:"Example issuer fact"},
      {id:"vuaa-fact",symbol:"VUAA",sourceId:"vanguard",statement:"Example fund fact"}],
    researchCoverage:[{symbol:"AAA",state:"fresh",note:"Fresh SEC evidence"},{symbol:"VUAA",state:"primary",note:"Fresh Vanguard evidence"}],
    fundHoldings:{fundSymbol:"VUAA",fundIsin:"IE00BFMXXD54",asOfDate:quote,sourceId:"vanguard",weights:{AAA:10}}};
}
function draft(review:ReviewInput):ReviewDraft{return {version:3,inputDigest:inputDigest(review),headline:"Недельный обзор",summary:["Факты проверены"],
  positions:review.baseline.positions.map(position=>({symbol:position.symbol,action:"maintain",adviceReason:"Доступные факты не требуют изменения позиции",blockingInfo:null,
    factIds:[position.symbol==="AAA"?"aaa-fact":"vuaa-fact"],rationale:"Краткий вывод",portfolioMeaning:"Связь с портфелем",counterargument:"Факты могут измениться",
    revisitWhen:"После следующего отчёта",learningIds:[]})),learningNotes:[],nextSteps:["Подтвердить состав перед следующим обзором"],proposedOrders:[]};}

async function environment(date:string){
  const root=await mkdtemp(join(tmpdir(),"kurami-weekly-review-")),portfolio=join(root,"portfolio"),targets=join(root,"targets.json");
  await mkdir(portfolio,{mode:0o700});
  const baselinePath=join(portfolio,"baseline-"+date+".json");
  await writeFile(baselinePath,JSON.stringify(baseline(date)),{mode:0o600});
  await writeFile(targets,JSON.stringify([{symbol:"AAA",namePattern:"Example"}]),{mode:0o600});
  return {root,portfolio,targets,baselinePath};
}
function successfulDependencies(date:string,counters:{prepare:number;synthesize:number},behavior:"valid"|"invalid"|"throw"="valid"){
  let prepared:ReviewInput;
  const prepare=(async(runDate:string,baselinePath:string,_targets:unknown[],directory:string,mode:ReviewInput["mode"]="trial")=>{
    counters.prepare++;assert.equal(runDate,date);assert.equal(mode,"weekly");
    const base=JSON.parse(await readFile(baselinePath,"utf8")) as PortfolioBaseline;
    prepared=input(date,base);await mkdir(directory,{mode:0o700});
    await writeFile(join(directory,"input.json"),JSON.stringify(prepared),{mode:0o600});
    await writeFile(join(directory,"draft-packet.json"),JSON.stringify({prompt:"offline"}),{mode:0o600});
    return {stage:"draft-ready" as const,directory};
  }) as typeof prepareReviewRun;
  const synthesize=async(_packet:string,output:string)=>{
    counters.synthesize++;if(behavior==="throw")throw Error("offline synthesis failure");
    await mkdir(output,{mode:0o700});await writeFile(join(output,"draft.json"),JSON.stringify(behavior==="valid"?draft(prepared):{}),{mode:0o600});
  };
  return {now:()=>new Date(date+"T07:00:00Z"),prepare,synthesize} satisfies Partial<WeeklyAutomationDependencies>;
}

// Non-Sunday invocations do not enter collection or synthesis.
{
  const env=await environment("2026-09-19"),calls={prepare:0,synthesize:0};
  try{
    const result=await runWeeklyInvestmentReview({portfolioDirectory:env.portfolio,targetsPath:env.targets},successfulDependencies("2026-09-19",calls));
    assert.equal(result.outcome,"skipped");assert.equal(result.reason,"not-sunday");assert.deepEqual(calls,{prepare:0,synthesize:0});
  }finally{await rm(env.root,{recursive:true,force:true});}
}

// A successful Sunday is accepted once and immediately visible through the accepted-review panel.
{
  const date="2026-09-20",env=await environment(date),calls={prepare:0,synthesize:0};
  try{
    const options={portfolioDirectory:env.portfolio,targetsPath:env.targets},dependencies=successfulDependencies(date,calls);
    dependencies.now=()=>new Date("2026-09-19T22:30:00Z"); // Sunday 01:30 in Vilnius while UTC is still Saturday.
    const dry=await inspectWeeklyInvestmentReview("dry-run",options,new Date("2026-09-19T22:30:00Z"));
    assert.equal(dry.outcome,"would-run");assert.equal(dry.reason,"eligible");
    const first=await runWeeklyInvestmentReview(options,dependencies);
    assert.equal(first.outcome,"accepted");assert.equal(first.synthesisCalls,1);assert.equal(calls.prepare,1);
    const saved=await loadReview(join(env.portfolio,"reviews"),"weekly");assert(saved);assert.equal(saved.input.mode,"weekly");
    const panel=renderReviewPanel([saved],date+"T07:00:00Z",baseline(date));
    assert(panel.includes("Обзор портфеля"));assert(panel.includes("AAA"));assert(panel.includes("Факты проверены"));
    const repeated=await runWeeklyInvestmentReview(options,dependencies);
    assert.equal(repeated.outcome,"skipped");assert.equal(repeated.reason,"already-attempted-today");assert.equal(calls.prepare,1);
  }finally{await rm(env.root,{recursive:true,force:true});}
}

// An independently preexisting success suppresses collection even without automation state.
{
  const date="2026-09-20",env=await environment(date),calls={prepare:0,synthesize:0};
  try{
    const existing=input(date);await acceptReview(join(env.portfolio,"reviews"),existing,draft(existing),date+"T07:00:00Z");
    const result=await runWeeklyInvestmentReview({portfolioDirectory:env.portfolio,targetsPath:env.targets},successfulDependencies(date,calls));
    assert.equal(result.outcome,"skipped");assert.equal(result.reason,"weekly-review-already-accepted");assert.equal(calls.prepare,0);
  }finally{await rm(env.root,{recursive:true,force:true});}
}

async function preservationCase(behavior:"invalid"|"throw",expected:"rejected"|"failed"){
  const date="2026-09-20",env=await environment(date),calls={prepare:0,synthesize:0};
  try{
    const prior=input("2026-09-13"),saved=await acceptReview(join(env.portfolio,"reviews"),prior,draft(prior),"2026-09-13T07:00:00Z");
    const result=await runWeeklyInvestmentReview({portfolioDirectory:env.portfolio,targetsPath:env.targets},successfulDependencies(date,calls,behavior));
    assert.equal(result.outcome,expected);assert.equal((await loadReview(join(env.portfolio,"reviews"),"weekly"))!.id,saved.id);
    const state=JSON.parse(await readFile(join(env.portfolio,"weekly-automation.json"),"utf8"));
    assert.equal(state.lastSuccess.reviewId,saved.id);assert.equal(state.lastAttempt.outcome,expected);
  }finally{await rm(env.root,{recursive:true,force:true});}
}
await preservationCase("invalid","rejected");
await preservationCase("throw","failed");

// Stale holdings stop before providers or synthesis and leave a durable safe status.
{
  const date="2026-09-20",env=await environment("2026-08-20"),calls={prepare:0,synthesize:0};
  try{
    const result=await runWeeklyInvestmentReview({portfolioDirectory:env.portfolio,targetsPath:env.targets,baselinePath:env.baselinePath},successfulDependencies(date,calls));
    assert.equal(result.outcome,"rejected");assert.equal(result.reason,"positions-unconfirmed");assert.deepEqual(calls,{prepare:0,synthesize:0});
  }finally{await rm(env.root,{recursive:true,force:true});}
}

console.log("Weekly investment review automation: Sunday gate, atomic duplicate/preexisting success, safe failure preservation, and accepted panel visibility verified offline.");
