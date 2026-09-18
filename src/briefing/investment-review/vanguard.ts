import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {nodeHttpFetch} from "../providers/node-http-fetch.ts";
import {dateOnly,parseReviewInput,FUND_HOLDINGS_MAX_AGE_DAYS,type ReviewInput} from "./model.ts";
export const VUAA_URL="https://global.vanguard.com/de-de/investment-products/etf/equities/9694/sp-500-ucits-etf-usd-accumulating";
const ENDPOINT="https://global.vanguard.com/gpx/graphql";
const ISIN="IE00BFMXXD54";
export const FUND_MAX_AGE_DAYS=FUND_HOLDINGS_MAX_AGE_DAYS;
// Observed public read-only query used by Vanguard's own anonymous product page.
const QUERY="query FundsHoldingsQuery($portIds:[String!],$lastItemKey:String){funds(portIds:$portIds){profile{fundFullName fundCurrency}} borHoldings(portIds:$portIds){holdings(limit:1500,lastItemKey:$lastItemKey){items{issuerName securityLongDescription marketValuePercentage ticker securityType effectiveDate sedol1} totalHoldings lastItemKey}}}";
type Row={issuerName:string|null;securityLongDescription:string;marketValuePercentage:number;ticker:string|null;securityType:string;effectiveDate:string;sedol1:string|null};
type Page={errors?:unknown;data?:{funds:Array<{profile:{fundFullName:string;fundCurrency:string}}>;borHoldings:Array<{holdings:{items:Row[];totalHoldings:number;lastItemKey:string|null}}>}};
export type FundSnapshot={version:1;fundSymbol:"VUAA";fundIsin:string;asOfDate:string;retrievedAt:string;sourceUrl:string;
  scope:"full-published-holdings";totalRows:number;excludedRows:number;equityWeightPercent:number;rows:Row[];contentDigest:string};
export type FundResult={state:"ready"|"retained"|"unavailable";snapshot:FundSnapshot|null;reason:string};
const hash=(x:unknown)=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
function meta(html:string,name:string){
  const result:string[]=[];
  for(const m of html.matchAll(/<meta\b[^>]*>/gi)){
    const n=m[0].match(/\bname=["']([^"']+)["']/i)?.[1],c=m[0].match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if(n===name&&c)result.push(c);
  }
  return result.length===1?result[0]:null;
}
export function verifyVuaaPage(html:string){
  if(meta(html,"isin")!==ISIN||meta(html,"ticker")!=="VUAA"||meta(html,"share-class")!=="Accumulating"||meta(html,"product-type")!=="ETF")throw Error("Vanguard share-class identity mismatch");
}
export function fundFresh(date:string,asOf:string){return dateOnly(date)&&dateOnly(asOf)&&date<=asOf&&(Date.parse(asOf)-Date.parse(date))/86400000<=FUND_MAX_AGE_DAYS;}
export function parseFundSnapshot(value:unknown):FundSnapshot{
  const s=value as FundSnapshot;
  if(s?.version!==1||s.fundIsin!==ISIN||s.fundSymbol!=="VUAA"||s.sourceUrl!==VUAA_URL||s.scope!=="full-published-holdings"
    ||!dateOnly(s.asOfDate)||!Number.isFinite(Date.parse(s.retrievedAt))||!Array.isArray(s.rows)||s.rows.length<450||s.rows.length>6000
    ||!Number.isSafeInteger(s.totalRows)||!Number.isSafeInteger(s.excludedRows)||s.excludedRows<0||s.totalRows!==s.rows.length+s.excludedRows
    ||!Number.isFinite(s.equityWeightPercent)||s.equityWeightPercent<95||s.equityWeightPercent>101)throw Error("Invalid fund snapshot");
  for(const r of s.rows)if(!/^EQ\.(STOCK|REIT)$/.test(r.securityType)||r.effectiveDate!==s.asOfDate
    ||!Number.isFinite(r.marketValuePercentage)||r.marketValuePercentage<0||r.marketValuePercentage>100
    ||typeof r.ticker!=="string"||typeof r.issuerName!=="string")throw Error("Invalid fund holding");
  const keys=s.rows.map(r=>r.sedol1||r.ticker+"|"+r.issuerName);
  if(new Set(keys).size!==keys.length||Math.abs(s.rows.reduce((n,r)=>n+r.marketValuePercentage,0)-s.equityWeightPercent)>1e-6)throw Error("Duplicate or unreconciled fund holdings");
  const {contentDigest,...body}=s;
  if(contentDigest!==hash({...body,retrievedAt:""}))throw Error("Fund snapshot digest mismatch");
  return s;
}
export function buildFundSnapshot(pages:Page[],asOfDate:string,retrievedAt=new Date().toISOString()):FundSnapshot{
  if(!dateOnly(asOfDate)||!pages.length||pages.length>4)throw Error("Invalid fund request");
  let rows:Row[]=[],total:number|null=null;const cursors=new Set<string>();
  for(const [index,p] of pages.entries()){
    if(p.errors||p.data?.funds?.length!==1||p.data?.borHoldings?.length!==1)throw Error("Invalid Vanguard response");
    const profile=p.data.funds[0]!.profile,h=p.data.borHoldings[0]!.holdings;
    if(!/^Vanguard S&P 500 UCITS ETF \(USD\) Accumulating$/.test(profile.fundFullName)||profile.fundCurrency!=="USD"
      ||!Array.isArray(h.items)||!Number.isSafeInteger(h.totalHoldings)||h.totalHoldings<450||h.totalHoldings>6000
      ||(total!==null&&total!==h.totalHoldings)||(!h.lastItemKey&&index!==pages.length-1))throw Error("Incomplete or wrong Vanguard fund");
    if(h.lastItemKey){if(cursors.has(h.lastItemKey))throw Error("Repeated fund cursor");cursors.add(h.lastItemKey);}
    total=h.totalHoldings;rows.push(...h.items);
  }
  if(pages.at(-1)!.data!.borHoldings[0]!.holdings.lastItemKey||rows.length!==total)throw Error("Incomplete fund holdings");
  const dates=new Set(rows.map(r=>r.effectiveDate));
  if(dates.size!==1||!fundFresh(rows[0]!.effectiveDate,asOfDate))throw Error("Stale, future or mixed fund dates");
  if(rows.some(r=>!Number.isFinite(r.marketValuePercentage)||Math.abs(r.marketValuePercentage)>100))throw Error("Invalid fund weight");
  const sum=rows.reduce((n,r)=>n+r.marketValuePercentage,0);if(sum<98||sum>102)throw Error("Fund weights do not reconcile");
  const equity=rows.filter(r=>/^EQ\.(STOCK|REIT)$/.test(r.securityType));
  const body={version:1 as const,fundSymbol:"VUAA" as const,fundIsin:ISIN,asOfDate:rows[0]!.effectiveDate,retrievedAt,sourceUrl:VUAA_URL,
    scope:"full-published-holdings" as const,totalRows:rows.length,excludedRows:rows.length-equity.length,
    equityWeightPercent:equity.reduce((n,r)=>n+r.marketValuePercentage,0),rows:equity};
  return parseFundSnapshot({...body,contentDigest:hash({...body,retrievedAt:""})});
}
export async function collectVuaa(asOfDate:string,previous?:FundSnapshot,fetcher:typeof fetch=nodeHttpFetch):Promise<FundResult>{
  if(previous)parseFundSnapshot(previous);
  try{
    const page=await fetcher(VUAA_URL,{redirect:"error",signal:AbortSignal.timeout(15000)});
    if(!page.ok)throw Error("Vanguard page unavailable");
    const html=await page.text();if(html.length>2_000_000)throw Error("Vanguard page too large");verifyVuaaPage(html);
    const pages:Page[]=[];let cursor:string|null=null;
    for(let n=0;n<4;n++){
      const response=await fetcher(ENDPOINT,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
        headers:{"content-type":"application/json","X-Consumer-ID":"de7"},
        body:JSON.stringify({query:QUERY,variables:{portIds:["9694"],lastItemKey:cursor}})});
      if(!response.ok)throw Error("Vanguard holdings unavailable");
      const text=await response.text();if(text.length>3_000_000)throw Error("Vanguard holdings too large");
      const p=JSON.parse(text) as Page;pages.push(p);cursor=p.data?.borHoldings?.[0]?.holdings?.lastItemKey??null;
      if(!cursor)break;
    }
    const snapshot=buildFundSnapshot(pages,asOfDate);
    if(previous&&snapshot.asOfDate<previous.asOfDate)throw Error("Older fund snapshot rejected");
    return {state:"ready",snapshot,reason:"Полный опубликованный список Vanguard; пересечения рассчитаны только по акциям."};
  }catch{
    return {state:previous?"retained":"unavailable",snapshot:previous??null,reason:"Состав Vanguard не обновлён; прежняя дата не меняется."};
  }
}
// Exact issuer aliases for held identities. No fuzzy mapping or inferred zeroes.
const identities:Record<string,{isin:string;names:string[]}>={
  NVDA:{isin:"US67066G1040",names:["NVIDIA Corp"]},MSFT:{isin:"US5949181045",names:["Microsoft Corp"]},
  AMZN:{isin:"US0231351067",names:["Amazon.com Inc"]},MRK:{isin:"US58933Y1055",names:["Merck & Co Inc"]},
  SOFI:{isin:"US83406F1021",names:["SoFi Technologies Inc"]},V:{isin:"US92826C8394",names:["Visa Inc"]}
};
export function applyVuaa(input:ReviewInput,result:FundResult):ReviewInput{
  parseReviewInput(input);
  if(!input.baseline.positions.some(p=>p.symbol==="VUAA"&&p.isin===ISIN))throw Error("VUAA identity not confirmed in baseline");
  const next=structuredClone(input),coverage=new Map(next.researchCoverage?.map(c=>[c.symbol,c]));
  if(!result.snapshot){
    coverage.set("VUAA",{symbol:"VUAA",state:"retained",note:result.reason});next.researchCoverage=[...coverage.values()];return next;
  }
  const s=parseFundSnapshot(result.snapshot),weights:Record<string,number>={};
  if(s.asOfDate>input.asOfDate||input.fundHoldings&&s.asOfDate<input.fundHoldings.asOfDate)throw Error("Fund snapshot date cannot replace the current input");
  for(const p of next.baseline.positions){
    const identity=identities[p.symbol];if(!identity||identity.isin!==p.isin)continue;
    const matches=s.rows.filter(r=>r.ticker===p.symbol&&identity.names.includes(r.issuerName!));
    if(matches.length===1&&matches[0]!.marketValuePercentage>0)weights[p.symbol]=matches[0]!.marketValuePercentage;
  }
  const sourceId="vanguard-vuaa-holdings";
  next.fundHoldings={fundSymbol:"VUAA",fundIsin:ISIN,asOfDate:s.asOfDate,sourceId,weights};
  next.sources=next.sources.filter(x=>x.id!==sourceId);
  next.sources.push({id:sourceId,title:"Vanguard — VUAA holdings (full published list)",url:VUAA_URL,asOfDate:s.asOfDate,retrievedAt:s.retrievedAt});
  next.facts=next.facts.filter(f=>f.symbol!=="VUAA");
  next.facts.push({id:"vuaa-identity",symbol:"VUAA",sourceId,statement:"Vanguard подтверждает VUAA, ISIN IE00BFMXXD54: S&P 500 UCITS ETF (USD) Accumulating. Это фонд, а не отдельная акция."},
    {id:"vuaa-holdings",symbol:"VUAA",sourceId,statement:"Состав Vanguard на "+s.asOfDate+": "+Object.entries(weights).map(([symbol,w])=>symbol+" "+w+"%").join(", ")+". Показаны подтверждённые пересечения; денежные позиции и производные инструменты не распределялись по компаниям."});
  coverage.set("VUAA",{symbol:"VUAA",state:result.state==="ready"?"primary":"retained",
    note:(result.state==="ready"?"Получен полный список Vanguard":"Сохранён прежний список Vanguard")+" на "+s.asOfDate+". Пересечения подтверждены по тикеру и имени; отсутствующие/неподтверждённые соответствия не превращаются в ноль."});
  next.researchCoverage=[...coverage.values()];
  const used=new Set(next.facts.map(f=>f.sourceId));used.add(next.fx.sourceId);used.add(sourceId);next.candidates?.forEach(c=>used.add(c.identitySourceId));
  next.sources=next.sources.filter(s=>used.has(s.id));
  return parseReviewInput(next);
}
if(import.meta.main){
  const [date,output,previousPath]=process.argv.slice(2);if(!date||!output)throw Error("Usage: vanguard <date> <new-output> [previous-result]");
  const previousResult=previousPath?JSON.parse(await readFile(previousPath,"utf8")) as FundResult:undefined;
  if(previousResult&&!["ready","retained","unavailable"].includes(previousResult.state))throw Error("Invalid previous fund result");
  const previous=previousResult?.snapshot?parseFundSnapshot(previousResult.snapshot):undefined;
  const result=await collectVuaa(date,previous);
  await writeFile(output,JSON.stringify(result,null,2)+"\n",{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({state:result.state,asOfDate:result.snapshot?.asOfDate,rows:result.snapshot?.rows.length,reason:result.reason}));
}
