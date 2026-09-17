import type {StockAsset,StocksConfig} from "./config.ts";
import {parseStocksConfig} from "./config.ts";
export type StockPoint={date:string;close:number;adjusted:number};
export type StockSeries={asset:StockAsset;points:StockPoint[];fetchedAt:string|null;state:"ready"|"stale"|"unavailable";issue?:string};
export type StocksSnapshot={version:1;state:"ready"|"partial"|"failed";capturedAt:string;data:{provider:"eodhd";policy:StocksConfig;series:StockSeries[];issue?:string}};
export type StockQuote={asset:StockAsset;date:string|null;price:number|null;day:number|null;week:number|null;month:number|null;state:StockSeries["state"]};
export type StocksBrief={version:1;state:"ready"|"partial"|"failed";capturedAt:string;data:{provider:"eodhd";benchmark:string;threshold:number;quotes:StockQuote[]}};
export const dayShift=(date:string,days:number)=>new Date(Date.parse(date+"T12:00:00Z")+days*86400000).toISOString().slice(0,10);
export const marketDate=(at:string,timezone:string)=>new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(at));
export function parseStockPoints(value:unknown,from:string,to:string):StockPoint[] {
  if(!Array.isArray(value)||value.length<1||value.length>370)throw new Error("invalid_price_history");
  const points=value.map(item=>{
    const date=item?.date;
    if(typeof date!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||date<from||date>to
      ||dayShift(date,0)!==date||!Number.isFinite(item.close)||item.close<=0||item.close>1e9
      ||!Number.isFinite(item.adjusted_close??item.adjusted)||(item.adjusted_close??item.adjusted)<=0||(item.adjusted_close??item.adjusted)>1e9)throw new Error("invalid_price_history");
    return {date,close:Number(item.close),adjusted:Number(item.adjusted_close??item.adjusted)};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  if(new Set(points.map(p=>p.date)).size!==points.length)throw new Error("duplicate_price_date");
  return points;
}
export function parseStocksSnapshot(value:unknown):StocksSnapshot {
  const snapshot=value as StocksSnapshot,policy=parseStocksConfig(snapshot?.data?.policy);
  if(snapshot?.version!==1||snapshot.data?.provider!=="eodhd"||policy.error||!policy.enabled||!Number.isFinite(Date.parse(snapshot.capturedAt))
    ||!["ready","partial","failed"].includes(snapshot.state)||!Array.isArray(snapshot.data.series)||snapshot.data.series.length!==policy.assets.length)throw new Error("invalid_stock_snapshot");
  const series=snapshot.data.series.map((s,index)=>{
    const asset=policy.assets[index]!;
    if(s.asset?.id!==asset.id||s.asset.isin!==asset.isin||s.asset.currency!==asset.currency
      ||!["ready","stale","unavailable"].includes(s.state)||!Array.isArray(s.points)
      ||(s.fetchedAt!==null&&!Number.isFinite(Date.parse(s.fetchedAt))))throw new Error("invalid_stock_series");
    const points=s.points.length?parseStockPoints(s.points,asset.listedFrom??"1900-01-01",marketDate(snapshot.capturedAt,asset.timezone)):[];
    if(s.state==="ready"&&(!points.length||!s.fetchedAt))throw new Error("missing_stock_history");
    return {asset,points,state:s.state,fetchedAt:s.fetchedAt,...(typeof s.issue==="string"?{issue:s.issue.slice(0,80)}:{})};
  });
  return {...snapshot,data:{...snapshot.data,policy,series}};
}
export function stockQuote(series:StockSeries,at:string):StockQuote {
  const last=series.points.at(-1);
  const change=(point:StockPoint|undefined)=>last&&point?(last.adjusted/point.adjusted-1)*100:null;
  const previous=(days:number)=>last?series.points.findLast(p=>p.date<=dayShift(last.date,-days)):undefined;
  const stale=last && (last.date<dayShift(marketDate(at,series.asset.timezone),-7)
    ||!series.fetchedAt||Date.parse(at)-Date.parse(series.fetchedAt)>48*3600000);
  return {asset:series.asset,date:last?.date??null,price:last?.close??null,
    day:change(series.points.at(-2)),week:change(previous(7)),month:change(previous(30)),
    state:!last?"unavailable":stale?"stale":series.state};
}
export function stocksBrief(snapshot:StocksSnapshot|null,config:StocksConfig,at:string):StocksBrief {
  const quotes=config.assets.map(asset=>{
    const series=snapshot?.data.series.find(s=>s.asset.id===asset.id&&s.asset.isin===asset.isin);
    return stockQuote(series??{asset,points:[],state:"unavailable",fetchedAt:null},at);
  });
  const ready=quotes.filter(q=>q.state==="ready").length;
  return {version:1,state:ready===quotes.length?"ready":ready?"partial":"failed",capturedAt:at,
    data:{provider:"eodhd",benchmark:config.benchmark,threshold:config.moveThresholdPercent,quotes}};
}
