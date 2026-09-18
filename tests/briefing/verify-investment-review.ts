import assert from "node:assert/strict";
import {calculateReview,calendarMonth,reportPeriod,parseReviewInput,inputDigest,validateReviewDraft,type ReviewInput,type ReviewDraft} from "../../src/briefing/investment-review/model.ts";
import {parseEcbUSD} from "../../src/briefing/investment-review/cli.ts";
import {renderInvestmentReview} from "../../src/briefing/investment-review/render.ts";
import {REVIEW_LEARNING_SCRIPT} from "../../src/briefing/investment-review/learning-note.ts";
import {runInNewContext} from "node:vm";
const assets=[{id:"AAA",symbol:"AAA.US",isin:"US1234567890",name:"Example stock",currency:"USD" as const,exchange:"US" as const,timezone:"America/New_York",kind:"stock" as const},
  {id:"FUND",symbol:"FUND.XETRA",isin:"IE1234567890",name:"Example fund",currency:"EUR" as const,exchange:"XETRA" as const,timezone:"Europe/Berlin",kind:"etf" as const}];
const source={id:"issuer",title:"Test issuer",url:"https://issuer.example/report",asOfDate:"2026-08-31",retrievedAt:"2026-09-18T06:00:00Z"};
const input:ReviewInput={version:1,asOfDate:"2026-09-18",mode:"trial",baseline:{version:1,asOfLocalDate:"2026-09-18",timezone:"Europe/Vilnius",positions:[{symbol:"AAA",isin:assets[0]!.isin,quantity:"2"},{symbol:"FUND",isin:assets[1]!.isin,quantity:"5"}],unknowns:{currentMonthExecutedTrades:null,currentMonthNewContributionsEUR:null}},
  market:{version:1,state:"ready",capturedAt:"2026-09-18T06:00:00Z",data:{provider:"eodhd",policy:{enabled:true,assets,benchmark:"FUND",moveThresholdPercent:2},series:assets.map((asset,index)=>({asset,state:"ready",fetchedAt:"2026-09-18T06:00:00Z",points:[{date:"2026-09-17",close:index?20:100,adjusted:index?20:100}]}))}},
  fx:{date:"2026-09-17",usdPerEUR:2,sourceId:"ecb"},sources:[source,{...source,id:"ecb",title:"FX",url:"https://www.ecb.europa.eu/example",asOfDate:"2026-09-17"}],facts:[{id:"aaa-fact",symbol:"AAA",sourceId:"issuer",statement:"Example factual input"},{id:"fund-fact",symbol:"FUND",sourceId:"issuer",statement:"Example fund input"}],fundHoldings:{fundSymbol:"FUND",fundIsin:assets[1]!.isin,asOfDate:"2026-08-31",sourceId:"issuer",weights:{AAA:10}}};
const m=calculateReview(input);assert.equal(m.totalEUR,200);assert.equal(m.rows[0]!.weight,50);assert.equal(m.overlap[0]!.totalWeight,55);assert.equal(m.remainingTrades,null);assert.equal(m.remainingNewMoneyEUR,null);assert.equal(m.personalReturn,null);assert.equal(m.stress[0]!.remainingEUR,140);
assert.deepEqual(calendarMonth("2028-02-29"),{start:"2028-02-01",endExclusive:"2028-03-01"});
assert.deepEqual(reportPeriod("monthly","2028-03-01"),{start:"2028-02-01",endExclusive:"2028-03-01"});
assert.deepEqual(reportPeriod("monthly","2026-01-01"),{start:"2025-12-01",endExclusive:"2026-01-01"});
assert.deepEqual(reportPeriod("weekly","2026-09-20"),{start:"2026-09-13",endExclusive:"2026-09-20"});
assert.throws(()=>calendarMonth("2026-02-29"));
const known=structuredClone(input);known.baseline.unknowns={currentMonthExecutedTrades:4,currentMonthNewContributionsEUR:175};assert.equal(calculateReview(known).remainingTrades,1);assert.equal(calculateReview(known).remainingNewMoneyEUR,25);
known.baseline.asOfLocalDate="2026-08-18";assert.equal(calculateReview(known).remainingTrades,null);assert(calculateReview(known).requiresPositionConfirmation);
const missing=structuredClone(input);missing.market.data.series[0]!.points=[];missing.market.data.series[0]!.state="unavailable";assert.equal(calculateReview(missing).totalEUR,null);assert(calculateReview(missing).rows.every(r=>r.weight===null));
const mismatch=structuredClone(input);mismatch.baseline.positions[0]!.isin="US0000000000";assert.equal(calculateReview(mismatch).totalEUR,null);
const stale=structuredClone(input);stale.market.data.series[0]!.points[0]!.date="2026-08-01";assert.equal(calculateReview(stale).totalEUR,null);
const future=structuredClone(input);future.sources[0]!.asOfDate="2026-09-19";assert.throws(()=>parseReviewInput(future));
const bad=structuredClone(input);bad.baseline.positions.push(bad.baseline.positions[0]!);assert.throws(()=>parseReviewInput(bad));
const draft:ReviewDraft={version:2,inputDigest:inputDigest(input),headline:"Пробный обзор",summary:["Проверяем структуру"],positions:input.baseline.positions.map(p=>({symbol:p.symbol,action:"review",factIds:[p.symbol==="AAA"?"aaa-fact":"fund-fact"],rationale:"Вывод",portfolioMeaning:"Связь с портфелем",counterargument:"Контраргумент",revisitWhen:"Условие пересмотра",learningIds:["overlap"]})),learningNotes:[{id:"overlap",term:"Пересечение вложений",explanation:"Объяснение",example:"Пример из отчёта",limitation:"Граница вывода",reference:{title:"Источник",url:"https://www.investor.gov/"}}],nextSteps:["Проверить данные"],proposedOrders:[]};
assert.equal(validateReviewDraft(input,draft),draft);
assert.throws(()=>validateReviewDraft(input,{...draft,inputDigest:"wrong"}));
assert.throws(()=>validateReviewDraft(input,{...draft,proposedOrders:[{symbol:"AAA",eur:100}]}));
const unsupported=structuredClone(draft);unsupported.positions[0]!.factIds=["fund-fact"];assert.throws(()=>validateReviewDraft(input,unsupported));
const unsafe=structuredClone(draft);unsafe.summary=['<script>alert(1)</script>'];const html=renderInvestmentReview(input,unsafe);assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert(!html.includes('<script>alert(1)'));
assert(html.includes("Остаток сделок: неизвестен"));assert(html.includes("Приватный пробный обзор"));
assert(html.includes("Для твоего портфеля:"));assert(html.includes('href="#learn-overlap"'));
assert.equal((html.match(/id="learn-overlap"/g)??[]).length,1,"One shared learning note, not repeated per position");
assert(!html.includes('id="learn-overlap" open'));assert(html.includes("Чего из этого не следует:"));
assert.throws(()=>validateReviewDraft(input,{...draft,version:1}));
assert.throws(()=>validateReviewDraft(input,{...draft,learningNotes:[...draft.learningNotes,...draft.learningNotes]}));
const missingLesson=structuredClone(draft);missingLesson.positions[0]!.learningIds=["missing"];assert.throws(()=>validateReviewDraft(input,missingLesson));
const unsafeLesson=structuredClone(draft);unsafeLesson.learningNotes[0]!.reference.url="javascript:alert(1)";assert.throws(()=>validateReviewDraft(input,unsafeLesson));
const excess=structuredClone(draft);excess.learningNotes=Array.from({length:4},(_,i)=>({...draft.learningNotes[0]!,id:"note-"+i}));assert.throws(()=>validateReviewDraft(input,excess));
const teaching=structuredClone(draft);teaching.learningNotes[0]!.example="<img src=x onerror=alert(1)>";assert(renderInvestmentReview(input,teaching).includes("&lt;img"));
let focused=false,click=()=>{};
class Lesson {open=false;querySelector(){return {focus:()=>{focused=true;}};}}
const lesson=new Lesson();
runInNewContext(REVIEW_LEARNING_SCRIPT,{HTMLDetailsElement:Lesson,document:{getElementById:(id:string)=>id==="learn-overlap"?lesson:null,querySelectorAll:()=>[{hash:"#learn-overlap",addEventListener:(_type:string,handler:()=>void)=>{click=handler;}}]}});
click();assert(lesson.open);assert(focused);
assert.equal(parseEcbUSD('<Cube time="2026-09-17"><Cube currency="USD" rate="1.1481"/></Cube>',"2026-09-17"),1.1481);
assert.throws(()=>parseEcbUSD('<Cube time="2026-09-16"><Cube currency="USD" rate="1.1481"/></Cube>',"2026-09-17"));
console.log("Investment review: calendar months, FX direction, complete/missing valuations, overlap, private draft binding, unknown allowances and no-order boundary verified.");
