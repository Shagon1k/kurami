import {createHash} from "node:crypto";
import {dayShift,parseStocksSnapshot,type StocksSnapshot} from "../stocks/model.ts";

export type PortfolioBaseline={version:1;asOfLocalDate:string;timezone:"Europe/Vilnius";positions:Array<{symbol:string;isin:string;quantity:string}>;unknowns:{currentMonthExecutedTrades:number|null;currentMonthNewContributionsEUR:number|null}};
export type ReviewSource={id:string;title:string;url:string;asOfDate:string;retrievedAt:string};
export type ReviewFact={id:string;symbol:string;sourceId:string;statement:string};
export type ReviewCandidate={symbol:string;name:string;exchange:string;identitySourceId:string};
export type ReviewInput={version:1;asOfDate:string;mode:"trial"|"weekly"|"monthly";baseline:PortfolioBaseline;market:StocksSnapshot;
  fx:{date:string;usdPerEUR:number;sourceId:string};sources:ReviewSource[];facts:ReviewFact[];candidates?:ReviewCandidate[];
  researchCoverage?:Array<{symbol:string;state:"fresh"|"retained";note:string}>;
  fundHoldings?:{fundSymbol:string;fundIsin:string;asOfDate:string;sourceId:string;weights:Record<string,number>}};
export const inputDigest=(input:ReviewInput)=>createHash("sha256").update(JSON.stringify(input)).digest("hex");
export function dateOnly(value:unknown):value is string{return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&dayShift(value,0)===value;}
export function calendarMonth(date:string){
  if(!dateOnly(date))throw Error("Invalid review date");
  const start=date.slice(0,7)+"-01",next=new Date(start+"T12:00:00Z");next.setUTCMonth(next.getUTCMonth()+1);
  return {start,endExclusive:next.toISOString().slice(0,10)};
}
export function reportPeriod(mode:ReviewInput["mode"],date:string){
  const month=calendarMonth(date);
  if(mode==="monthly")return {start:calendarMonth(dayShift(month.start,-1)).start,endExclusive:month.start};
  return {start:dayShift(date,-7),endExclusive:date};
}
export function parseReviewInput(value:unknown):ReviewInput {
  const i=value as ReviewInput;
  if(i?.version!==1||!dateOnly(i.asOfDate)||!["trial","weekly","monthly"].includes(i.mode)||i.baseline?.version!==1
    ||!dateOnly(i.baseline.asOfLocalDate)||i.baseline.asOfLocalDate>i.asOfDate||i.baseline.timezone!=="Europe/Vilnius"
    ||!Array.isArray(i.baseline.positions)||!i.baseline.positions.length||i.baseline.positions.length>50)throw Error("Invalid portfolio baseline");
  const ids=new Set<string>();
  for(const p of i.baseline.positions){
    if(!/^[A-Z][A-Z0-9.-]{0,15}$/.test(p.symbol)||ids.has(p.symbol)||!/^[A-Z]{2}[A-Z0-9]{10}$/.test(p.isin)
      ||typeof p.quantity!=="string"||!/^\d+(?:\.\d{1,8})?$/.test(p.quantity)||Number(p.quantity)<=0||Number(p.quantity)>1e9)throw Error("Invalid portfolio position");
    ids.add(p.symbol);
  }
  parseStocksSnapshot(i.market);
  if(Date.parse(i.market.capturedAt)>Date.parse(i.asOfDate+"T23:59:59Z"))throw Error("Future market snapshot");
  if(!Array.isArray(i.sources)||i.sources.length>40||!Array.isArray(i.facts)||i.facts.length>80)throw Error("Invalid evidence");
  const sources=new Set<string>();
  for(const s of i.sources){
    const url=new URL(s.url);
    if(!/^[a-z][a-z0-9-]{0,60}$/.test(s.id)||sources.has(s.id)||!s.title||s.title.length>200||url.protocol!=="https:"||url.username||url.password
      ||[...url.searchParams.keys()].some(k=>/^(api_token|apikey|api_key|access_token|token)$/i.test(k))
      ||!dateOnly(s.asOfDate)||s.asOfDate>i.asOfDate||!Number.isFinite(Date.parse(s.retrievedAt)))throw Error("Invalid evidence source");sources.add(s.id);
  }
  const factIds=new Set<string>();
  const researchIds=new Set(ids);
  if(i.candidates!==undefined){
    if(!Array.isArray(i.candidates)||i.candidates.length>2)throw Error("Invalid research candidates");
    for(const c of i.candidates){
      if(!c||!/^[A-Z][A-Z0-9.-]{0,15}$/.test(c.symbol)||researchIds.has(c.symbol)||typeof c.name!=="string"||!c.name.trim()||c.name.length>120
        ||typeof c.exchange!=="string"||!c.exchange.trim()||c.exchange.length>40||!sources.has(c.identitySourceId))throw Error("Invalid candidate identity");
      researchIds.add(c.symbol);
    }
  }
  for(const f of i.facts){if(!/^[a-z][a-z0-9-]{0,60}$/.test(f.id)||factIds.has(f.id)||!researchIds.has(f.symbol)||!sources.has(f.sourceId)||!f.statement||f.statement.length>1000)throw Error("Invalid evidence fact");factIds.add(f.id);}
  if(i.researchCoverage!==undefined&&(!Array.isArray(i.researchCoverage)||i.researchCoverage.length>52
    ||new Set(i.researchCoverage.map(c=>c.symbol)).size!==i.researchCoverage.length
    ||i.researchCoverage.some(c=>!researchIds.has(c.symbol)||!["fresh","retained"].includes(c.state)||typeof c.note!=="string"||!c.note||c.note.length>500)))throw Error("Invalid research coverage");
  if(!dateOnly(i.fx?.date)||i.fx.date>i.asOfDate||!Number.isFinite(i.fx.usdPerEUR)||i.fx.usdPerEUR<=0||!sources.has(i.fx.sourceId))throw Error("Invalid FX evidence");
  const h=i.fundHoldings;
  if(h&&(!dateOnly(h.asOfDate)||h.asOfDate>i.asOfDate||!sources.has(h.sourceId)||!i.baseline.positions.some(p=>p.symbol===h.fundSymbol&&p.isin===h.fundIsin)
    ||Object.entries(h.weights).some(([symbol,w])=>!ids.has(symbol)||!Number.isFinite(w)||w<0||w>100)||Object.values(h.weights).reduce((a,b)=>a+b,0)>100))throw Error("Invalid fund holdings evidence");
  const u=i.baseline.unknowns;
  if(!u||!(u.currentMonthExecutedTrades===null||Number.isSafeInteger(u.currentMonthExecutedTrades)&&u.currentMonthExecutedTrades>=0)
    ||!(u.currentMonthNewContributionsEUR===null||Number.isFinite(u.currentMonthNewContributionsEUR)&&u.currentMonthNewContributionsEUR>=0))throw Error("Invalid month usage");
  return i;
}
export function calculateReview(input:ReviewInput){
  const i=parseReviewInput(input),market=parseStocksSnapshot(i.market);
  const rows=i.baseline.positions.map(p=>{
    const s=market.data.series.find(s=>s.asset.id===p.symbol&&s.asset.isin===p.isin),last=s?.points.at(-1);
    const usable=Boolean(s&&last&&s.state==="ready"&&last.date<=i.asOfDate&&last.date>=dayShift(i.asOfDate,-4)
      &&i.fx.date===last.date&&Date.parse(s.fetchedAt!)<=Date.parse(i.asOfDate+"T23:59:59Z")
      &&Date.parse(i.asOfDate+"T00:00:00Z")-Date.parse(s.fetchedAt!)<=4*86400000);
    const valueEUR=usable?Number(p.quantity)*last!.close/(s!.asset.currency==="USD"?i.fx.usdPerEUR:1):null;
    return {...p,name:s?.asset.name??p.symbol,currency:s?.asset.currency??null,price:usable?last!.close:null,quoteDate:last?.date??null,valueEUR};
  });
  const complete=rows.every(r=>r.valueEUR!==null),totalEUR=complete?rows.reduce((sum,r)=>sum+r.valueEUR!,0):null;
  const weighted=rows.map(r=>({...r,weight:totalEUR?r.valueEUR!/totalEUR*100:null}));
  const fund=i.fundHoldings,heldFund=fund&&weighted.find(r=>r.symbol===fund.fundSymbol),fundValue=heldFund?.valueEUR;
  const overlap=totalEUR&&fund&&fundValue!=null?Object.entries(fund.weights).map(([symbol,weight])=>{
    const direct=weighted.find(r=>r.symbol===symbol)!;return {symbol,directWeight:direct.weight!,fundWeight:fundValue*weight/100/totalEUR*100,totalWeight:direct.weight!+fundValue*weight/100/totalEUR*100};
  }):[];
  const u=i.baseline.unknowns,usageCurrent=i.baseline.asOfLocalDate.slice(0,7)===i.asOfDate.slice(0,7);
  return {inputDigest:inputDigest(i),complete,totalEUR,rows:weighted,overlap,fundHoldingsDate:fund?.asOfDate??null,
    requiresPositionConfirmation:i.baseline.asOfLocalDate<dayShift(i.asOfDate,-30),period:reportPeriod(i.mode,i.asOfDate),tradeWindow:calendarMonth(i.asOfDate),
    remainingTrades:!usageCurrent||u.currentMonthExecutedTrades===null?null:Math.max(0,5-u.currentMonthExecutedTrades),
    remainingNewMoneyEUR:!usageCurrent||u.currentMonthNewContributionsEUR===null?null:Math.max(0,200-u.currentMonthNewContributionsEUR),
    stress:totalEUR?[.3,.5].map(drop=>({drop,lossEUR:totalEUR*drop,remainingEUR:totalEUR*(1-drop)})):[],
    personalReturn:null,costBasis:null,scenarios:totalEUR&&fundValue!=null?([100,200] as const).map(amount=>({newMoneyEUR:amount,fundSymbol:fund!.fundSymbol,fundWeightIfAdded:(fundValue+amount)/(totalEUR+amount)*100})):[]};
}
export type LearningNote={id:string;term:string;explanation:string;example:string;limitation:string;reference:{title:string;url:string}};
export const LEARNING_REFERENCE_URLS=[
  "https://www.investor.gov/introduction-investing/investing-basics/glossary/diversification",
  "https://www.sec.gov/about/reports-publications/investorpubsbegfinstmtguide"
];
export type ReviewIdea={symbol:string;factIds:string[];rationale:string;portfolioMeaning:string;counterargument:string;alternative:string;valuationGap:string;revisitWhen:string};
export type ReviewAction="review"|"maintain"|"no-add"|"wait"|"consider-add"|"consider-trim"|"consider-exit"|"not-assessed";
export type ReviewDraft={version:3;inputDigest:string;headline:string;summary:string[];positions:Array<{symbol:string;action:ReviewAction;adviceReason:string;blockingInfo:string|null;factIds:string[];rationale:string;portfolioMeaning:string;counterargument:string;revisitWhen:string;learningIds:string[]}>;learningNotes:LearningNote[];ideas?:ReviewIdea[];nextSteps:string[];proposedOrders:never[]};
export function validateReviewDraft(input:ReviewInput,value:unknown):ReviewDraft {
  const d=value as ReviewDraft,metrics=calculateReview(input),ids=new Set(input.baseline.positions.map(p=>p.symbol)),seen=new Set<string>(),facts=new Map(input.facts.map(f=>[f.id,f]));
  const text=(v:unknown,max=1600)=>typeof v==="string"&&v.length>0&&v.length<=max;
  if(d?.version!==3||d.inputDigest!==metrics.inputDigest||!text(d.headline,150)||!Array.isArray(d.summary)||d.summary.length<1||d.summary.length>3||!d.summary.every(v=>text(v))
    ||!Array.isArray(d.positions)||d.positions.length!==ids.size||!Array.isArray(d.nextSteps)||d.nextSteps.length>5||!d.nextSteps.every(v=>text(v))
    ||!Array.isArray(d.proposedOrders)||d.proposedOrders.length||!Array.isArray(d.learningNotes)||d.learningNotes.length>3)throw Error("Invalid review draft or execution proposal");
  const lessons=new Set<string>(),usedLessons=new Set<string>();
  for(const n of d.learningNotes){
    if(!n||typeof n.id!=="string"||!/^[a-z][a-z0-9-]{0,40}$/.test(n.id)||lessons.has(n.id)||!text(n.term,90)
      ||![n.explanation,n.example,n.limitation].every(v=>text(v,700))||!text(n.reference?.title,150)||!text(n.reference?.url,2048))throw Error("Invalid learning note");
    const url=new URL(n.reference.url);
    if(url.protocol!=="https:"||url.username||url.password||[...url.searchParams.keys()].some(k=>/^(api_token|apikey|api_key|access_token|token)$/i.test(k)))throw Error("Invalid learning reference");
    if(!LEARNING_REFERENCE_URLS.includes(n.reference.url)&&!input.sources.some(s=>s.url===n.reference.url))throw Error("Learning reference was not provided: "+n.id);
    lessons.add(n.id);
  }
  for(const p of d.positions){
    if(Array.isArray(p.learningIds)){
      const missing=p.learningIds.filter(id=>!lessons.has(id));
      if(missing.length)throw Error("Unknown learning note for "+p.symbol+": "+missing.join(", "));
    }
    if(!ids.has(p.symbol)||seen.has(p.symbol)||!["review","maintain","no-add","wait","consider-add","consider-trim","consider-exit","not-assessed"].includes(p.action)
      ||!text(p.adviceReason,300)||(p.action==="review"?!text(p.blockingInfo,400):p.blockingInfo!==null)
      ||!Array.isArray(p.factIds)||p.factIds.some(id=>{
        const f=facts.get(id),h=input.fundHoldings;
        return !f||(f.symbol!==p.symbol&&!(h&&p.symbol in h.weights&&f.symbol===h.fundSymbol&&f.sourceId===h.sourceId));
      })||![p.rationale,p.portfolioMeaning,p.counterargument,p.revisitWhen].every(v=>text(v))
      ||!Array.isArray(p.learningIds)||p.learningIds.length>2||new Set(p.learningIds).size!==p.learningIds.length||p.learningIds.some(id=>!lessons.has(id)))throw Error("Invalid position review");
    p.learningIds.forEach(id=>usedLessons.add(id));
    if(p.action!=="not-assessed"&&!p.factIds.some(id=>facts.get(id)?.symbol===p.symbol))throw Error("Assessment requires position-specific evidence");
    if(["consider-add","consider-trim","consider-exit"].includes(p.action)&&(!metrics.complete||metrics.requiresPositionConfirmation))throw Error("Action consideration requires current complete valuation");
    seen.add(p.symbol);
  }
  if(usedLessons.size!==lessons.size)throw Error("Learning notes must be tied to a reviewed position");
  if(d.ideas!==undefined){
    if(!Array.isArray(d.ideas)||d.ideas.length>2)throw Error("Invalid long-term ideas");
    const candidates=new Set(input.candidates?.map(c=>c.symbol)),ideaIds=new Set<string>();
    for(const idea of d.ideas){
      if(!idea||!candidates.has(idea.symbol)||ideaIds.has(idea.symbol)||!Array.isArray(idea.factIds)||!idea.factIds.length
        ||new Set(idea.factIds).size!==idea.factIds.length||idea.factIds.some(id=>facts.get(id)?.symbol!==idea.symbol)
        ||![idea.rationale,idea.portfolioMeaning,idea.counterargument,idea.alternative,idea.valuationGap,idea.revisitWhen].every(v=>text(v,900))
        ||Object.keys(idea).some(k=>!["symbol","factIds","rationale","portfolioMeaning","counterargument","alternative","valuationGap","revisitWhen"].includes(k)))throw Error("Invalid long-term idea");
      ideaIds.add(idea.symbol);
    }
  }
  return d;
}
