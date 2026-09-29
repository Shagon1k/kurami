import assert from "node:assert/strict";
import {calculateReview,calendarMonth,reportPeriod,parseReviewInput,inputDigest,validateReviewDraft,type ReviewInput,type ReviewDraft} from "../../src/briefing/investment-review/model.ts";
import {parseEcbUSD,standaloneReportHtml} from "../../src/briefing/investment-review/cli.ts";
import {THEME_RUNTIME_JS} from "../../src/ui-library/runtime/theme.ts";
import {renderInvestmentReview,investmentAdviceLabels} from "../../src/briefing/investment-review/render.ts";
import {REVIEW_LEARNING_SCRIPT} from "../../src/briefing/investment-review/learning-note.ts";
import {runInNewContext} from "node:vm";
import {renderKuramiComment,KURAMI_COMMENT_STYLES} from "../../src/briefing/ui/components/kurami-comment.ts";
import {extractSecFacts,collectIssuerEvidence,mergeCollectedEvidence} from "../../src/briefing/investment-review/collect.ts";
import {acceptReview,loadReview,reviewFreshness} from "../../src/briefing/investment-review/store.ts";
import {renderReviewPanel} from "../../src/briefing/investment-review/panel.ts";
import {primaryPacket,mergePrimaryEvidence} from "../../src/briefing/investment-review/primary-evidence.ts";
import {createHash} from "node:crypto";
import {applyVuaa,buildFundSnapshot} from "../../src/briefing/investment-review/vanguard.ts";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {assets,source,input,draft} from "../fixtures/briefing/investment-review.ts";
import {tmpdir} from "node:os";
import {join} from "node:path";
const m=calculateReview(input);assert.equal(m.totalEUR,200);assert.equal(m.rows[0]!.weight,50);assert.equal(m.overlap[0]!.totalWeight,55);assert.equal(m.remainingTrades,null);assert.equal(m.remainingNewMoneyEUR,null);assert.equal(m.personalReturn,null);assert.equal(m.stress[0]!.remainingEUR,140);
assert.deepEqual(calendarMonth("2028-02-29"),{start:"2028-02-01",endExclusive:"2028-03-01"});
assert.deepEqual(reportPeriod("monthly","2028-03-01"),{start:"2028-02-01",endExclusive:"2028-03-01"});
assert.deepEqual(reportPeriod("monthly","2026-01-01"),{start:"2025-12-01",endExclusive:"2026-01-01"});
assert.deepEqual(reportPeriod("weekly","2026-09-20"),{start:"2026-09-13",endExclusive:"2026-09-20"});
assert.throws(()=>calendarMonth("2026-02-29"));
const known=structuredClone(input);known.baseline.unknowns={currentMonthExecutedTrades:4,currentMonthNewContributionsEUR:175};assert.equal(calculateReview(known).remainingTrades,1);assert.equal(calculateReview(known).remainingNewMoneyEUR,25);
known.baseline.asOfLocalDate="2026-08-18";assert.equal(calculateReview(known).remainingTrades,null);assert(calculateReview(known).requiresPositionConfirmation);
const missing=structuredClone(input);missing.market.data.series[0]!.points=[];missing.market.data.series[0]!.state="unavailable";assert.equal(calculateReview(missing).totalEUR,null);assert(calculateReview(missing).rows.every(r=>r.weight===null));
const fundInput=structuredClone(input);
const fundIsin="IE00BFMXXD54",stockIsin="US67066G1040";
fundInput.baseline.positions=[{symbol:"NVDA",isin:stockIsin,quantity:"2"},{symbol:"VUAA",isin:fundIsin,quantity:"5"}];
for(const a of [...fundInput.market.data.policy.assets,...fundInput.market.data.series.map(s=>s.asset)]){
  a.id=a.kind==="stock"?"NVDA":"VUAA";a.isin=a.kind==="stock"?stockIsin:fundIsin;a.symbol=a.id+(a.kind==="stock"?".US":".XETRA");
}
fundInput.market.data.policy.benchmark="VUAA";fundInput.facts.forEach(f=>f.symbol=f.symbol==="AAA"?"NVDA":"VUAA");
fundInput.fundHoldings={...fundInput.fundHoldings!,fundSymbol:"VUAA",fundIsin,weights:{NVDA:10}};
const fundRows=Array.from({length:500},(_,n)=>({issuerName:n===0?"NVIDIA Corp":"Other "+n,securityLongDescription:"Example",ticker:n===0?"NVDA":"X"+n,
  marketValuePercentage:n===0?8:92/499,securityType:"EQ.STOCK",effectiveDate:"2026-08-31",sedol1:"S"+n}));
const fundSnapshot=buildFundSnapshot([{data:{funds:[{profile:{fundFullName:"Vanguard S&P 500 UCITS ETF (USD) Accumulating",fundCurrency:"USD"}}],
  borHoldings:[{holdings:{items:fundRows,totalHoldings:500,lastItemKey:null}}]}}],"2026-09-18");
const applied=applyVuaa(fundInput,{state:"ready",snapshot:fundSnapshot,reason:"Test"});
assert.equal(calculateReview(applied).totalEUR,200);assert.deepEqual(applied.fundHoldings!.weights,{NVDA:8});
assert.equal(Object.hasOwn(applied.fundHoldings!.weights,"MRK"),false,"Unconfirmed exposure is not fabricated as zero");
const retainedInput=applyVuaa(fundInput,{state:"retained",snapshot:fundSnapshot,reason:"Unavailable"});
assert.equal(retainedInput.fundHoldings!.asOfDate,"2026-08-31");assert.equal(retainedInput.researchCoverage![0]!.state,"retained");
const mismatch=structuredClone(input);mismatch.baseline.positions[0]!.isin="US0000000000";assert.equal(calculateReview(mismatch).totalEUR,null);
const stale=structuredClone(input);stale.market.data.series[0]!.points[0]!.date="2026-08-01";assert.equal(calculateReview(stale).totalEUR,null);
const staleFund=structuredClone(input);staleFund.fundHoldings!.asOfDate="2026-06-30";
assert.equal(calculateReview(staleFund).fundHoldingsUsable,false);assert.deepEqual(calculateReview(staleFund).overlap,[]);
const future=structuredClone(input);future.sources[0]!.asOfDate="2026-09-19";assert.throws(()=>parseReviewInput(future));
const bad=structuredClone(input);bad.baseline.positions.push(bad.baseline.positions[0]!);assert.throws(()=>parseReviewInput(bad));
assert.equal(validateReviewDraft(input,draft),draft);
assert(renderInvestmentReview(staleFund,{...draft,inputDigest:inputDigest(staleFund)}).includes("пересечения не рассчитаны"));
const withIdea=structuredClone(input);
withIdea.candidates=[{symbol:"BBB",name:"<Example candidate>",exchange:"EXAMPLE",identitySourceId:"issuer"}];
withIdea.facts.push({id:"bbb-fact",symbol:"BBB",sourceId:"issuer",statement:"Candidate evidence"});
assert.equal(calculateReview(withIdea).totalEUR,m.totalEUR);
assert.deepEqual(calculateReview(withIdea).rows,m.rows,"Candidates do not change holdings or weights");
const ideaDraft={...structuredClone(draft),inputDigest:inputDigest(withIdea),ideas:[{symbol:"BBB",factIds:["bbb-fact"],rationale:"Why",portfolioMeaning:"Fit",counterargument:"Risk",alternative:"Existing fund or no purchase",valuationGap:"No valuation",revisitWhen:"Next filing"}]};
assert.equal(validateReviewDraft(withIdea,ideaDraft),ideaDraft);
const ideaHtml=renderInvestmentReview(withIdea,ideaDraft);
const standalone=await standaloneReportHtml(renderInvestmentReview(input,draft));
assert.doesNotMatch(standalone,/(?:src|href)="\/(?!\/)|url\("\/assets\//,"standalone report has no site-relative assets");
assert.match(standalone,/url\("data:font\/woff2;base64,/);
assert.ok(standalone.indexOf(THEME_RUNTIME_JS)>0&&standalone.indexOf(THEME_RUNTIME_JS)<standalone.indexOf("</head>"),"theme runtime runs in head");
assert(ideaHtml.includes("&lt;Example candidate&gt;"));assert(!ideaHtml.includes("<Example candidate>"));
assert(ideaHtml.includes("Альтернатива:"));assert(ideaHtml.includes("Чего не хватает для покупки:"));
assert(!ideaHtml.includes('class="review-position review-idea" open'));
for(const ideas of [
  [{...ideaDraft.ideas[0],symbol:"AAA"}],
  [{...ideaDraft.ideas[0],factIds:["aaa-fact"]}],
  [{...ideaDraft.ideas[0],factIds:[]}],
  [{...ideaDraft.ideas[0],quantity:1}],
  [...ideaDraft.ideas,...ideaDraft.ideas],
  Array.from({length:3},()=>ideaDraft.ideas[0])
])assert.throws(()=>validateReviewDraft(withIdea,{...ideaDraft,ideas}));
assert.throws(()=>parseReviewInput({...withIdea,candidates:[{...withIdea.candidates![0],symbol:"AAA"}]}));
assert.throws(()=>parseReviewInput({...withIdea,candidates:[{...withIdea.candidates![0],identitySourceId:"missing"}]}));
assert.throws(()=>validateReviewDraft(input,ideaDraft),"Draft binds to the exact candidate/evidence packet");
assert.throws(()=>validateReviewDraft(input,{...draft,inputDigest:"wrong"}));
assert.throws(()=>validateReviewDraft(input,{...draft,proposedOrders:[{symbol:"AAA",eur:100}]}));
const unsupported=structuredClone(draft);unsupported.positions[0]!.factIds=["fund-fact"];assert.throws(()=>validateReviewDraft(input,unsupported));
const supportedOverlap=structuredClone(draft);supportedOverlap.positions[0]!.factIds.push("fund-fact");validateReviewDraft(input,supportedOverlap);
const inventedReference=structuredClone(draft);inventedReference.learningNotes[0]!.reference.url="https://www.sec.gov/invented";assert.throws(()=>validateReviewDraft(input,inventedReference));
const unsafe=structuredClone(draft);unsafe.summary=['<script>alert(1)</script>'];const html=renderInvestmentReview(input,unsafe);assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert(!html.includes('<script>alert(1)'));
assert(html.includes("Остаток сделок: неизвестен"));assert(html.includes("Приватный пробный обзор"));
const comments=[...html.matchAll(/<aside\b[^>]*data-kurami-comment[\s\S]*?<\/aside>/g)].map(m=>m[0]);
assert.equal(comments.length,draft.positions.length+2);
assert(comments.every(c=>c.includes("Курами:")&&c.includes("🦊")));
assert(comments.some(c=>c.includes("Совет:")));
assert(html.includes("Недостаточно данных для совета"));assert(!html.includes("Что рассмотреть"));assert(!/бумаг/i.test(html));
assert.deepEqual(Object.values(investmentAdviceLabels),["Недостаточно данных для совета","Оставить без изменений","Пока не увеличивать позицию","Дождаться конкретного события","Рассмотреть докупку","Рассмотреть частичную продажу","Рассмотреть полную продажу","Анализ ещё не проведён"]);
const unexplained=structuredClone(draft);unexplained.positions[0]!.blockingInfo=null;assert.throws(()=>validateReviewDraft(input,unexplained));
for(const action of ["maintain","no-add","wait"] as const){const d=structuredClone(draft);d.positions[0]!.action=action;d.positions[0]!.blockingInfo=null;validateReviewDraft(input,d);}
assert(comments.every(c=>!c.includes("<table")&&!c.includes("Example factual input")&&!c.includes("review-learning-note")));
assert.equal(renderKuramiComment({}),"");
assert(renderKuramiComment({items:["<script>bad</script>"],ordered:true}).includes("<ol><li>&lt;script&gt;"));
assert(!renderKuramiComment({headline:'<img src=x onerror=1>'}).includes('<img'));
assert(KURAMI_COMMENT_STYLES.includes("var(--surface-panel)"));assert(!KURAMI_COMMENT_STYLES.includes("var(--accent-primary)"));
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
const secRow={start:"2026-04-01",end:"2026-06-30",val:123,accn:"0000000001-26-000001",form:"10-Q",filed:"2026-08-01"};
const sec={cik:1,entityName:"Example Inc",facts:{"us-gaap":{
  RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[{...secRow,end:"2022-06-30",start:"2022-04-01",filed:"2022-08-01",val:1}]}},
  Revenues:{units:{USD:[secRow,{...secRow,end:"2026-09-30",filed:"2026-10-01",val:999}]}},
  NetIncomeLoss:{units:{USD:[{...secRow,val:-10}]}},
  CashAndCashEquivalentsAtCarryingValue:{units:{USD:[{end:"2026-06-30",val:500,accn:secRow.accn,form:"10-Q",filed:secRow.filed}]}}
}}};
const extracted=extractSecFacts(sec,{symbol:"AAA",namePattern:"Example"},"2026-09-18","2026-09-18T06:00:00Z");
assert.equal(extracted.facts.length,3);assert(extracted.facts[0]!.statement.includes("123 USD"));
assert(extracted.facts[0]!.statement.includes("2026-04-01 — 2026-06-30"));assert(!extracted.facts.some(f=>f.statement.includes("999")));
assert.equal(extracted.sources.length,1);assert(extracted.sources[0]!.url.endsWith("-index.html"));
assert.throws(()=>extractSecFacts(sec,{symbol:"AAA",namePattern:"Other"},"2026-09-18","2026-09-18T06:00:00Z"));
assert.equal(extractSecFacts(sec,{symbol:"SOFI",namePattern:"Example"},"2026-09-18","2026-09-18T06:00:00Z").facts.length,2,"Do not call partial bank customer revenue total revenue");
const conflict=structuredClone(sec);conflict.facts["us-gaap"].Revenues.units.USD.push({...secRow,val:124});
assert.equal(extractSecFacts(conflict,{symbol:"AAA",namePattern:"Example"},"2026-09-18","2026-09-18T06:00:00Z").facts.length,2);
let requests=0;
const fakeFetch=(async(url:unknown,init:RequestInit)=>{requests++;assert.equal(init.redirect,"error");return new Response(JSON.stringify(requests===1?{"0":{cik_str:1,ticker:"AAA",title:"Example Inc"}}:sec));}) as typeof fetch;
const collected=await collectIssuerEvidence([{symbol:"AAA",namePattern:"Example"}],"2026-09-18",fakeFetch);
assert.equal(collected.requests,2);assert.equal(collected.coverage[0]!.state,"ready");
const merged=mergeCollectedEvidence(input,collected);
assert.equal(merged.sources.find(s=>s.id==="issuer")!.asOfDate,source.asOfDate);
assert(merged.facts.some(f=>f.id==="aaa-fact"),"Retained primary evidence survives collection");
assert(merged.facts.some(f=>f.id==="sec-aaa-revenue"));
assert.equal(merged.researchCoverage!.find(c=>c.symbol==="FUND")!.state,"retained");
assert.equal(merged.sources.some(s=>s.id==="ecb"),false,"Snapshot supplies its newly dated FX source");
const primaryText="Example Inc reported second-quarter revenue of USD 123 million and an operating loss of USD 2 million. The reporting period ended June 30, 2026.";
const primaryCollection={version:1 as const,asOfDate:input.asOfDate,requests:4,coverage:[],
  documents:[{id:"primary-aaa-test",symbol:"AAA",title:"Example issuer report",url:"https://www.sec.gov/Archives/edgar/data/1/report.htm",
    filedAt:"2026-08-01",retrievedAt:"2026-09-18T06:00:00Z",contentDigest:createHash("sha256").update(primaryText).digest("hex"),text:primaryText,truncated:false}]};
primaryPacket(primaryCollection);
const extraction={version:2,collectionDigest:createHash("sha256").update(JSON.stringify(primaryCollection)).digest("hex"),
  items:[{documentId:"primary-aaa-test",symbol:"AAA",facts:[{statement:"Компания сообщила выручку USD 123 млн за второй квартал 2026.",kind:"reported",evidenceIds:["p001"]}]}]};
assert.throws(()=>mergePrimaryEvidence(input,primaryCollection,extraction,false));
const withPrimary=mergePrimaryEvidence(input,primaryCollection,extraction,true);
assert.equal(calculateReview(withPrimary).totalEUR,m.totalEUR);
assert(!withPrimary.facts.some(f=>f.id==="aaa-fact"),"Reviewed issuer facts replace older narrative for that issuer");
assert(withPrimary.facts.some(f=>f.id==="fund-fact"),"Unrelated fund evidence stays intact");
assert(withPrimary.facts.some(f=>f.id==="primary-aaa-test-1"));
assert.equal(withPrimary.researchCoverage!.find(c=>c.symbol==="AAA")!.state,"primary");
assert.equal(mergePrimaryEvidence(withPrimary,primaryCollection,extraction,true).facts.length,withPrimary.facts.length,"Repeat collection does not accumulate duplicate primary facts");
const directory=await mkdtemp(join(tmpdir(),"kurami-review-store-"));
try{
  const week={...structuredClone(input),mode:"weekly" as const},weekDraft={...structuredClone(draft),inputDigest:inputDigest(week)};
  const saved=await acceptReview(directory,week,weekDraft,"2026-09-18T06:00:00Z");
  assert.equal((await loadReview(directory,"weekly"))!.id,saved.id);assert.equal(await loadReview(directory,"monthly"),null);
  await assert.rejects(()=>acceptReview(directory,input,draft),"Trial cannot silently become weekly");
  await assert.rejects(()=>acceptReview(directory,week,{...weekDraft,inputDigest:"bad"}));
  assert.equal((await loadReview(directory,"weekly"))!.id,saved.id);
  assert.equal((await acceptReview(directory,week,weekDraft)).id,saved.id);
  const month={...structuredClone(input),mode:"monthly" as const},monthDraft={...structuredClone(draft),inputDigest:inputDigest(month)};
  const savedMonth=await acceptReview(directory,month,monthDraft,"2026-09-18T06:00:00Z");
  assert.equal((await loadReview(directory,"weekly"))!.id,saved.id);
  assert.equal((await loadReview(directory,"monthly"))!.id,savedMonth.id);
  assert(reviewFreshness(saved,"2026-10-18T06:00:00Z",input.baseline).stale);
  assert(reviewFreshness(saved,"2026-09-18T06:00:00Z").needsConfirmation);
  const changed=structuredClone(input.baseline);changed.positions[0]!.quantity="3";
  assert(reviewFreshness(saved,"2026-09-18T06:00:00Z",changed).changedHoldings);
  const panel=renderReviewPanel([saved,savedMonth],"2026-09-18T06:00:00Z",input.baseline);
  assert(panel.startsWith('<details class="investment-review"><summary><h2>Обзор портфеля</h2>'));
  assert(!panel.includes(saved.draft.headline),"Editorial headline does not add a second disclosure title");
  assert(panel.includes("Неделя"));assert(panel.includes("Месяц"));assert(!panel.includes(" open"));
  const single=renderReviewPanel([saved],"2026-09-18T06:00:00Z",input.baseline);
  assert(!single.includes('class="investment-review__period"'),"Single report opens with the main heading, no redundant nesting");
  assert(!single.includes("Пробный обзор"));assert(single.includes("18 сентября"));
  assert(panel.includes('id="weekly-learn-overlap"'));assert(panel.includes('id="monthly-learn-overlap"'));
  assert.equal(renderReviewPanel([],"2026-09-18T06:00:00Z"),"");
  assert(JSON.parse(await readFile(join(directory,"latest-weekly.json"),"utf8")).id===saved.id);
}finally{await rm(directory,{recursive:true,force:true});}
console.log("SEC periods/aliases/identity/partial banks, separate accepted slots, failed-update preservation, freshness and compact reader verified.");
