import {createHash} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {setTimeout as pause} from "node:timers/promises";
import {nodeHttpFetch} from "../providers/node-http-fetch.ts";
import {dateOnly,parseReviewInput,type ReviewInput} from "./model.ts";
import type {ReviewFact,ReviewSource} from "./model.ts";

type SecDatum={start?:string;end:string;val:number;accn:string;form:string;filed:string};
type SecFacts={cik:number;entityName:string;facts:Record<string,Record<string,{units:Record<string,SecDatum[]>}>>};
export type ResearchTarget={symbol:string;namePattern:string};
export type CollectedEvidence={version:1;asOfDate:string;retrievedAt:string;sources:ReviewSource[];facts:ReviewFact[];
  coverage:Array<{symbol:string;state:"ready"|"partial"|"unavailable";reason:string;latestPeriodEnd:string|null}>;requests:number};
/** Refresh only this adapter's facts; never re-date retained issuer research. */
export function mergeCollectedEvidence(input:ReviewInput,collected:CollectedEvidence){
  parseReviewInput(input);
  if(collected?.version!==1||!dateOnly(collected.asOfDate)||collected.asOfDate<input.asOfDate
    ||!Array.isArray(collected.facts)||!Array.isArray(collected.sources)||!Array.isArray(collected.coverage)
    ||collected.coverage.length>15||new Set(collected.coverage.map(c=>c.symbol)).size!==collected.coverage.length
    ||collected.coverage.some(c=>!["ready","partial","unavailable"].includes(c.state)))throw Error("Invalid collected evidence");
  const freshSymbols=new Set(collected.coverage.filter(c=>c.state==="ready").map(c=>c.symbol));
  const replacementIds=new Set(collected.facts.map(f=>f.id));
  const facts=[...input.facts.filter(f=>!replacementIds.has(f.id)),...collected.facts];
  const used=new Set(facts.map(f=>f.sourceId));used.add(input.fx.sourceId);
  if(input.fundHoldings)used.add(input.fundHoldings.sourceId);
  input.candidates?.forEach(c=>used.add(c.identitySourceId));
  const sources=[...new Map([...input.sources,...collected.sources].map(s=>[s.id,s])).values()].filter(s=>used.has(s.id));
  const symbols=[...input.baseline.positions.map(p=>p.symbol),...input.candidates?.map(c=>c.symbol)??[]];
  const combined:ReviewInput={...input,asOfDate:collected.asOfDate,sources,facts,researchCoverage:symbols.map(symbol=>({
    symbol,state:freshSymbols.has(symbol)?"fresh":"retained",
    note:freshSymbols.has(symbol)?"Свежие стандартные показатели SEC; не проверка всех новостей.":"Автосбор неполный или не применим. Сохранённые источники оставлены с прежними датами; подтверждённый ISIN не меняется."
  }))};
  parseReviewInput(combined);
  // Ready for snapshot: it supplies a new dated ECB rate separately.
  return {sources:sources.filter(s=>s.id!==input.fx.sourceId),facts,
    fundHoldings:input.fundHoldings,candidates:input.candidates,researchCoverage:combined.researchCoverage};
}
const metrics=[
  {id:"revenue",label:"Выручка",tags:["RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","Revenues","SalesRevenueNet","Revenue"]},
  {id:"net-income",label:"Чистая прибыль (отрицательное значение — убыток)",tags:["NetIncomeLoss","ProfitLoss"]},
  {id:"cash",label:"Деньги и денежные эквиваленты на дату",tags:["CashAndCashEquivalentsAtCarryingValue","CashAndCashEquivalents"]}
] as const;
const eligible=(d:SecDatum,date:string)=>dateOnly(d.end)&&d.end<=date&&dateOnly(d.filed)&&d.filed<=date&&Number.isFinite(d.val)
  &&/^(10-Q|10-K|20-F|6-K)(\/A)?$/.test(d.form)&&/^\d{10}-\d{2}-\d{6}$/.test(d.accn)
  &&(!d.start||dateOnly(d.start)&&d.start<=d.end);

/** Periods and units are preserved; no annualisation, ADR conversion or valuation. */
export function extractSecFacts(data:SecFacts,target:ResearchTarget,date:string,retrievedAt:string){
  if(!Number.isSafeInteger(data.cik)||data.cik<=0||!data.entityName.toLowerCase().includes(target.namePattern.toLowerCase()))throw Error("Issuer identity mismatch");
  const facts:ReviewFact[]=[],sources:ReviewSource[]=[],ends:string[]=[];
  for(const metric of metrics){
    const choices:Array<{datum:SecDatum;unit:string;tag:string}>=[];
    for(const taxonomy of ["us-gaap","ifrs-full"]){
      // A lender's customer-contract revenue excludes interest income.
      const tags=metric.id==="revenue"&&target.symbol==="SOFI"?["RevenuesNetOfInterestExpense"]:metric.tags;
      for(const tag of tags){
        const item=data.facts?.[taxonomy]?.[tag];
        if(!item)continue;
        for(const [unit,rows] of Object.entries(item.units)){
          if(!/^[A-Z]{3}$/.test(unit)||!Array.isArray(rows))continue;
          for(const datum of rows){
            if(!eligible(datum,date))continue;
            if((Date.parse(date)-Date.parse(datum.end))/86400000>150)continue;
            if(metric.id!=="cash"&&!datum.start)continue;
            if(metric.id==="cash"&&datum.start)continue;
            const duration=datum.start?(Date.parse(datum.end)-Date.parse(datum.start))/86400000:0;
            if(datum.start&&(duration<60||duration>380))continue;
            choices.push({datum,unit,tag:taxonomy+":"+tag});
          }
        }
      }
    }
    choices.sort((a,b)=>b.datum.end.localeCompare(a.datum.end)||b.datum.filed.localeCompare(a.datum.filed)
      ||(b.datum.start??"").localeCompare(a.datum.start??"")||a.unit.localeCompare(b.unit));
    const selected=choices[0];if(!selected)continue;
    const {datum:d,unit,tag}=selected,sourceId="sec-"+target.symbol.toLowerCase()+"-"+d.accn.replaceAll("-","");
    if(!sources.some(s=>s.id===sourceId))sources.push({id:sourceId,title:data.entityName+" · "+d.form,
      url:`https://www.sec.gov/Archives/edgar/data/${data.cik}/${d.accn.replaceAll("-","")}/${d.accn}-index.html`,
      asOfDate:d.filed,retrievedAt});
    // Never add aliases together; disagreeing candidates are missing evidence.
    const samePeriod=choices.filter(c=>c.datum.end===d.end&&c.datum.start===d.start&&c.datum.filed===d.filed);
    if(samePeriod.some(c=>c.unit!==unit||c.datum.val!==d.val))continue;
    facts.push({id:"sec-"+target.symbol.toLowerCase()+"-"+metric.id,symbol:target.symbol,sourceId,
      statement:`${metric.label}: ${d.val.toLocaleString("ru-RU")} ${unit}. ${d.start?"Период "+d.start+" — "+d.end:"На "+d.end}. Подано ${d.filed}; ${d.form}, ${tag}. Это показатель отчётности, не прогноз; периоды разных показателей могут различаться.`});
    ends.push(d.end);
  }
  return {facts,sources,latestPeriodEnd:ends.sort().at(-1)??null};
}

export async function collectIssuerEvidence(targets:ResearchTarget[],asOfDate:string,fetcher:typeof fetch=nodeHttpFetch):Promise<CollectedEvidence>{
  if(!dateOnly(asOfDate)||targets.length>15||!targets.length||new Set(targets.map(t=>t.symbol)).size!==targets.length
    ||targets.some(t=>!/^[A-Z][A-Z0-9.-]{0,15}$/.test(t.symbol)||!t.namePattern||t.namePattern.length>100))throw Error("Invalid research targets");
  const retrievedAt=new Date().toISOString(),result:CollectedEvidence={version:1,asOfDate,retrievedAt,sources:[],facts:[],coverage:[],requests:0};
  const read=async(url:string)=>{
    if(result.requests)await pause(150);
    result.requests++;
    const response=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(20000),
      headers:{"user-agent":"KuramiResearch/0.1 (+https://kurami.shagon1k.win; personal research)","accept":"application/json"}});
    if(!response.ok)throw Error("SEC HTTP "+response.status);
    const body=await response.text();if(body.length>20_000_000)throw Error("SEC document too large");return JSON.parse(body);
  };
  const index=await read("https://www.sec.gov/files/company_tickers.json") as Record<string,{cik_str:number;ticker:string;title:string}>;
  for(const target of targets){
    const matches=Object.values(index).filter(x=>x.ticker===target.symbol);
    try{
      if(matches.length!==1||!matches[0]!.title.toLowerCase().includes(target.namePattern.toLowerCase()))throw Error("Issuer identity unavailable");
      const cik=matches[0]!.cik_str;
      if(!Number.isSafeInteger(cik)||cik<=0)throw Error("Issuer identity unavailable");
      const data=await read("https://data.sec.gov/api/xbrl/companyfacts/CIK"+String(cik).padStart(10,"0")+".json") as SecFacts;
      if(data.cik!==cik)throw Error("Issuer identity mismatch");
      const extracted=extractSecFacts(data,target,asOfDate,retrievedAt);
      result.facts.push(...extracted.facts);result.sources.push(...extracted.sources);
      const age=extracted.latestPeriodEnd?(Date.parse(asOfDate)-Date.parse(extracted.latestPeriodEnd))/86400000:Infinity;
      result.coverage.push({symbol:target.symbol,state:extracted.facts.length>=3&&age<=150?"ready":"partial",
        reason:age>150?"Нет свежего отчётного периода":"Только стандартизированные показатели SEC; новости и прогнозы не проверены",latestPeriodEnd:extracted.latestPeriodEnd});
    }catch(error){result.coverage.push({symbol:target.symbol,state:"unavailable",
      reason:error instanceof Error&&error.message.startsWith("Issuer identity")?"Каталог SEC не подтвердил соответствие; требуется проверка адаптера, ранее подтверждённый ISIN не меняется":"Стандартные данные SEC недоступны; это не опровержение ранее проверенного эмитента",latestPeriodEnd:null});}
  }
  return result;
}

if(import.meta.main){
  const {readFile}=await import("node:fs/promises");
  const [targetsPath,date,output]=process.argv.slice(2);
  if(!targetsPath||!date||!output)throw Error("Usage: collect <public-targets.json> <as-of-date> <new-private-output.json>");
  const result=await collectIssuerEvidence(JSON.parse(await readFile(targetsPath,"utf8")),date);
  await writeFile(output,JSON.stringify(result,null,2)+"\n",{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({coverage:result.coverage,requests:result.requests,digest:createHash("sha256").update(JSON.stringify(result)).digest("hex")}));
}
