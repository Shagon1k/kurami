import {dayShift,parseStockPoints,type StockPoint} from "./model.ts";
export type DiscoveryCandidate={symbol:string;name:string;isin:string;price:number;day:number;volume:number};
export type DiscoveryCard=DiscoveryCandidate&{date:string;week:number|null;month:number|null;relativeVolume:number;points:StockPoint[]};
export type DiscoverySnapshot={version:1;state:"ready"|"empty"|"partial"|"failed";capturedAt:string;data:{sessionDate:string;cards:DiscoveryCard[];checked:number;issue?:string}};
export const validDate=(date:unknown):date is string=>typeof date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&dayShift(date,0)===date;
const number=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n);
export function discoverySession(value:unknown,today:string):string {
  const data=value as {last_updated?:unknown},date=String(data?.last_updated??"").slice(0,10);
  if(!validDate(date)||date>=today||date<dayShift(today,-4))throw Error("discovery_session_invalid");
  return date;
}
/** Price × volume is only a turnover proxy, not measured dollar volume. */
export function discoveryCandidates(value:unknown,catalog:unknown,owned:Set<string>):DiscoveryCandidate[] {
  if(!Array.isArray(catalog))throw Error("discovery_catalog_invalid");
  const data=value as Record<string,unknown>,seen=new Set<string>(),result:DiscoveryCandidate[]=[];
  for(const group of ["top_gainers","top_losers","most_actively_traded"]){
    const rows=data?.[group];if(!Array.isArray(rows)||rows.length>100)throw Error("discovery_response_invalid");
    for(const row of rows){
      const symbol=row?.ticker,price=Number(row?.price),day=Number(String(row?.change_percentage).replace(/%$/,"")),volume=Number(row?.volume);
      if(typeof symbol!=="string"||!/^[A-Z][A-Z0-9.-]{0,12}$/.test(symbol)||seen.has(symbol)||owned.has(symbol))continue;
      seen.add(symbol);
      if(![price,day,volume].every(number)||price<5||volume<=0||price*volume<20_000_000||Math.abs(day)<3||Math.abs(day)>30)continue;
      const rows=catalog.filter(r=>r?.Code===symbol&&r.Currency==="USD"&&r.Type==="Common Stock"
        &&["NYSE","NASDAQ","NYSE ARCA","NYSE MKT","NYSE American"].includes(r.Exchange)
        &&typeof r.Isin==="string"&&/^[A-Z]{2}[A-Z0-9]{10}$/.test(r.Isin)&&typeof r.Name==="string"&&r.Name.length<=150
        &&!/warrant|preferred|\bunits?\b|\betf\b|leverag|daily.*\d[xX]/i.test(r.Name));
      if(rows.length===1)result.push({symbol,name:rows[0].Name,isin:rows[0].Isin,price,day,volume});
    }
  }
  return result.sort((a,b)=>Math.abs(b.day)-Math.abs(a.day)||a.symbol.localeCompare(b.symbol));
}
export function verifyDiscoveryHistory(candidate:DiscoveryCandidate,value:unknown,date:string):DiscoveryCard|null {
  const points=parseStockPoints(value,dayShift(date,-100),date);
  if(points.length<21||points.at(-1)!.date!==date)return null;
  const last=points.at(-1)!,previous=points.at(-2)!;
  const day=(last.adjusted/previous.adjusted-1)*100,rawDay=(last.close/previous.close-1)*100;
  if(Math.abs(last.close/candidate.price-1)>.005||Math.abs(rawDay-candidate.day)>.5||Math.abs(rawDay-day)>.5
    ||Math.abs(day)<3||Math.abs(day)>30)return null;
  const raw=new Map((value as Array<{date:string;volume:number}>).map(r=>[r.date,r.volume]));
  const volumes=points.slice(-21,-1).map(p=>raw.get(p.date));
  const volume=raw.get(date);
  if(!number(volume)||volume<=0||volumes.some(v=>!number(v)||v<=0)||Math.abs(volume/candidate.volume-1)>.1)return null;
  const average=volumes.reduce<number>((sum,v)=>sum+v!,0)/20,relativeVolume=volume/average;
  if(relativeVolume<1.5)return null;
  const change=(days:number)=>{const prior=points.findLast(p=>p.date<=dayShift(date,-days));return prior?(last.adjusted/prior.adjusted-1)*100:null;};
  return {...candidate,price:last.close,day,volume,date,week:change(7),month:change(30),relativeVolume,points:points.filter(p=>p.date>=dayShift(date,-30))};
}
export function repeatAllowed(symbol:string,day:number,date:string,seen:Map<string,{session_date:string;day_change:number}>):boolean {
  const previous=seen.get(symbol);
  if(!previous||previous.session_date<dayShift(date,-3))return true;
  if(previous.session_date>=date)return false;
  return Math.sign(day)!==Math.sign(previous.day_change)||(Math.abs(day)>=Math.abs(previous.day_change)*1.5&&Math.abs(day)-Math.abs(previous.day_change)>=3);
}
export function parseDiscoverySnapshot(value:unknown):DiscoverySnapshot {
  const s=value as DiscoverySnapshot;
  if(s?.version!==1||!["ready","empty","partial","failed"].includes(s.state)||!Number.isFinite(Date.parse(s.capturedAt))
    ||!validDate(s.data?.sessionDate)||!Array.isArray(s.data.cards)||s.data.cards.length>3
    ||!Number.isInteger(s.data.checked)||s.data.checked<s.data.cards.length||s.data.checked>3
    ||(s.state==="empty"&&s.data.cards.length>0))throw Error("invalid_discovery_snapshot");
  const ids=new Set<string>();
  for(const c of s.data.cards){
    if(!/^[A-Z][A-Z0-9.-]{0,12}$/.test(c.symbol)||ids.has(c.symbol)||typeof c.name!=="string"||!c.name||c.name.length>150
      ||!/^([A-Z]{2})[A-Z0-9]{10}$/.test(c.isin)||c.date!==s.data.sessionDate
      ||![c.price,c.day,c.volume,c.relativeVolume].every(number)||c.price<5||c.volume<=0||c.price*c.volume<20_000_000
      ||Math.abs(c.day)<3||Math.abs(c.day)>30||c.relativeVolume<1.5
      ||![c.week,c.month].every(v=>v===null||number(v))||!Array.isArray(c.points))throw Error("invalid_discovery_card");
    if(c.points.length)parseStockPoints(c.points,dayShift(c.date,-30),c.date);
    ids.add(c.symbol);
  }
  return s;
}
