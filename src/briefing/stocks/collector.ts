import {readFile,lstat} from "node:fs/promises";
import {resolve} from "node:path";
import type {DatabaseSync} from "node:sqlite";
import {briefingPaths,initializeBriefingStore,openBriefingDatabase,loadAddonSnapshot,upsertAddonSnapshot,type BriefingPaths} from "../store.ts";
import type {BriefingAddonEnvelope} from "../model.ts";
import {loadBriefingRuntimeConfig} from "../runtime-config.ts";
import {nodeHttpFetch} from "../providers/node-http-fetch.ts";
import type {FetchLike} from "../providers/common.ts";
import type {StocksConfig,StockAsset} from "./config.ts";
import {parseStocksSnapshot,parseStockPoints,dayShift,marketDate,type StocksSnapshot,type StockSeries} from "./model.ts";

class StockError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.code=code;}
}
export function loadStocksCache(database:DatabaseSync):StocksSnapshot|null {
  try {const row=loadAddonSnapshot(database,"stocks");return row?parseStocksSnapshot(row.envelope):null;}
  catch {return null;}
}
async function credential(paths:BriefingPaths):Promise<string> {
  const path=resolve(paths.home,"config/stocks.env"),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw new StockError("credential_permissions");
  const text=await readFile(path,"utf8");
  const matches=[...text.matchAll(/^\s*EODHD_API_TOKEN\s*=\s*(.*?)\s*$/gm)];
  if(matches.length!==1)throw new StockError("credential_missing");
  let key=matches[0]![1]!;
  if((key.startsWith('"')&&key.endsWith('"'))||(key.startsWith("'")&&key.endsWith("'")))key=key.slice(1,-1);
  if(!key||/\s/.test(key)||key.length>256)throw new StockError("credential_invalid");
  return key;
}
function sameIdentity(asset:StockAsset,value:Record<string,unknown>):boolean {
  return Boolean(value) && value.Code===asset.id && value.Currency===asset.currency && (value.Isin??value.ISIN)===asset.isin
    && (asset.exchange==="US"||value.Exchange===asset.exchange);
}
export async function refreshStocksCache(config:StocksConfig,paths:BriefingPaths,options:{at?:Date;fetchImpl?:FetchLike}={}) {
  if(!config.enabled)return {state:"disabled",requests:0};
  const at=options.at??new Date(),date=at.toISOString().slice(0,10);
  if(at.getUTCHours()<5)return {state:"not_due",requests:0};
  const database=openBriefingDatabase(paths);
  const previous=loadStocksCache(database);
  const claim=database.prepare("INSERT OR IGNORE INTO stocks_refresh_days(utc_date,state,started_at) VALUES(?,'running',?)").run(date,at.toISOString());
  if(claim.changes!==1){database.close();return {state:"already_attempted",requests:0};}
  let requests=0,issue:string|undefined,series:StockSeries[]=[];
  const fallback=(asset:StockAsset,code:string):StockSeries=>{
    const old=previous?.data.series.find(s=>s.asset.id===asset.id&&s.asset.isin===asset.isin&&s.asset.currency===asset.currency);
    const points=old?.points.filter(p=>p.date>=dayShift(date,-365))??[];
    return {asset,points,fetchedAt:old?.fetchedAt??null,
      state:points.length?"stale":"unavailable",issue:code};
  };
  try {
    const key=await credential(paths),fetchImpl=options.fetchImpl??nodeHttpFetch;
    let maximumRequests=18;
    async function get(path:string,params:Record<string,string>={}):Promise<unknown> {
      if(requests>=maximumRequests)throw new StockError("daily_budget_exhausted");
      requests++;
      database.prepare("UPDATE stocks_refresh_days SET requests=? WHERE utc_date=?").run(requests,date);
      const url=new URL("/api/"+path,"https://eodhd.com");
      for(const[k,v]of Object.entries({...params,api_token:key,fmt:"json"}))url.searchParams.set(k,v);
      try {
        const response=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(8000)});
        if(response.status===401)throw new StockError("authentication_rejected");
        if(response.status===403)throw new StockError("free_access_denied");
        if(response.status===429||response.status===402)throw new StockError("daily_budget_exhausted");
        if(!response.ok)throw new StockError("provider_http_failure");
        const text=await response.text();
        if(text.length>12_000_000)throw new StockError("provider_response_too_large");
        return JSON.parse(text);
      }catch(error){throw error instanceof StockError?error:new StockError("provider_unavailable");}
    }
    const account=await get("user") as Record<string,unknown>;
    if(account.subscriptionType!=="free"||account.dailyRateLimit!==20)throw new StockError("free_plan_required");
    const used=account.apiRequestsDate===date?account.apiRequests:0;
    if(typeof used!=="number"||!Number.isSafeInteger(used)||used<0)throw new StockError("quota_unconfirmed");
    // Never count purchased/welcome extraLimit. Reserve only the base 20/day.
    maximumRequests=Math.min(18,1+20-used);
    const international=[...new Set(config.assets.filter(a=>a.exchange!=="US").map(a=>a.isin))];
    const needsUS=config.assets.some(a=>a.exchange==="US");
    if(maximumRequests-requests<config.assets.length+international.length+Number(needsUS))throw new StockError("insufficient_free_quota");
    const us=needsUS?await get("exchange-symbol-list/US"):[];
    const funds:unknown[]=[];
    for(const isin of international) {
      const matches=await get("search/"+isin,{type:"etf",limit:"30"});
      if(!Array.isArray(matches))throw new StockError("identity_catalog_unavailable");
      funds.push(...matches);
    }
    if(!Array.isArray(us)||!Array.isArray(funds))throw new StockError("identity_catalog_unavailable");
    let cursor=0;
    series=new Array(config.assets.length);
    await Promise.all(Array.from({length:3},async()=>{
      while(cursor<config.assets.length) {
        const index=cursor++,asset=config.assets[index]!;
        const catalog=asset.exchange==="US"?us:funds;
        if(!catalog.some(row=>sameIdentity(asset,row))){series[index]=fallback(asset,"identity_mismatch");continue;}
        const today=marketDate(at.toISOString(),asset.timezone),to=dayShift(today,-1);
        const from=[dayShift(today,-364),asset.listedFrom??"1900-01-01"].sort().at(-1)!;
        try {
          const data=await get("eod/"+asset.symbol,{period:"d",from,to});
          const points=parseStockPoints(data,from,to);
          series[index]={asset,points,fetchedAt:at.toISOString(),state:points.at(-1)!.date<dayShift(today,-7)?"stale":"ready",
            ...(points.at(-1)!.date<dayShift(today,-7)?{issue:"old_session"}:{})};
        }catch(error){series[index]=fallback(asset,error instanceof StockError?error.code:"invalid_history");}
      }
    }));
  } catch(error) {
    issue=error instanceof StockError?error.code:"collector_unavailable";
    series=config.assets.map(asset=>fallback(asset,issue!));
  }
  try {
    const ready=series.filter(s=>s.state==="ready").length;
    const snapshot=parseStocksSnapshot({version:1,state:ready===series.length?"ready":ready?"partial":"failed",capturedAt:at.toISOString(),
      data:{provider:"eodhd",policy:config,series,...(issue?{issue}:{})}});
    upsertAddonSnapshot(database,"stocks",snapshot as unknown as BriefingAddonEnvelope);
    database.prepare("UPDATE stocks_refresh_days SET state=?,finished_at=?,error_code=? WHERE utc_date=?")
      .run(snapshot.state==="ready"?"complete":snapshot.state==="partial"?"partial":"failed",new Date().toISOString(),issue??null,date);
    database.prepare("DELETE FROM stocks_refresh_days WHERE utc_date<?").run(dayShift(date,-31));
    return {state:snapshot.state,requests,ready,total:series.length,...(issue?{issue}:{})};
  } finally {database.close();}
}

/** Optional boundary: no provider error or missing credential may block Daily. */
export async function refreshStocksSafely(config:StocksConfig,paths:BriefingPaths,options:{at?:Date;fetchImpl?:FetchLike}={}) {
  try {return await refreshStocksCache(config,paths,options);}
  catch {console.warn("Stocks cache refresh failed; Daily continues");return {state:"failed",issue:"stocks_refresh_failed",requests:0};}
}

if(import.meta.main){
  if(process.argv.slice(2).join(" ")!=="--apply")throw new Error("Explicit --apply required");
  const paths=briefingPaths();await initializeBriefingStore(paths);
  const config=await loadBriefingRuntimeConfig(paths);
  console.log(JSON.stringify(await refreshStocksSafely(config.stocks,paths)));
}
