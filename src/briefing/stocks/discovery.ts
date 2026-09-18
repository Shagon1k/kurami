import type {DatabaseSync} from "node:sqlite";
import {loadAddonSnapshot,upsertAddonSnapshot,openBriefingDatabase,type BriefingPaths} from "../store.ts";
import type {BriefingAddonEnvelope} from "../model.ts";
import {nodeHttpFetch} from "../providers/node-http-fetch.ts";
import type {FetchLike} from "../providers/common.ts";
import {loadStocksCache,stockCredential} from "./collector.ts";
import type {StocksConfig} from "./config.ts";
import {dayShift,marketDate} from "./model.ts";
import {discoveryCandidates,discoverySession,verifyDiscoveryHistory,repeatAllowed,parseDiscoverySnapshot,type DiscoverySnapshot,type DiscoveryCard} from "./discovery-model.ts";

export function loadDiscovery(db:DatabaseSync):DiscoverySnapshot|null {
  try{const row=loadAddonSnapshot(db,"stocks-discovery");return row?parseDiscoverySnapshot(row.envelope):null;}catch{return null;}
}
export function storeDiscovery(db:DatabaseSync,snapshot:DiscoverySnapshot):void {
  parseDiscoverySnapshot(snapshot);
  const ownTransaction=!db.isTransaction;
  if(ownTransaction)db.exec("BEGIN IMMEDIATE");
  try{
    upsertAddonSnapshot(db,"stocks-discovery",snapshot as unknown as BriefingAddonEnvelope);
    if(snapshot.state!=="failed")for(const card of snapshot.data.cards)
      db.prepare("INSERT INTO stocks_discovery_seen(symbol,session_date,day_change) VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET session_date=excluded.session_date,day_change=excluded.day_change").run(card.symbol,card.date,card.day);
    db.prepare("DELETE FROM stocks_discovery_seen WHERE session_date<?").run(dayShift(snapshot.capturedAt.slice(0,10),-14));
    if(ownTransaction)db.exec("COMMIT");
  }catch(error){if(ownTransaction)db.exec("ROLLBACK");throw error;}
}
export async function refreshStocksDiscovery(config:StocksConfig,enabled:boolean,paths:BriefingPaths,options:{at?:Date;fetchImpl?:FetchLike}={}) {
  if(!enabled||!config.enabled)return {state:"disabled"};
  const at=options.at??new Date(),date=at.toISOString().slice(0,10);
  if(at.getUTCHours()<5)return {state:"not_due"};
  const db=openBriefingDatabase(paths);
  try {
    const watchlist=db.prepare("SELECT state FROM stocks_refresh_days WHERE utc_date=?").get(date);
    if(watchlist?.state!=="complete")return {state:"watchlist_first"};
    const claim=db.prepare("INSERT OR IGNORE INTO stocks_discovery_days(utc_date,state,started_at) VALUES(?,'running',?)").run(date,at.toISOString());
    if(claim.changes!==1)return {state:"already_attempted"};
    const previous=loadDiscovery(db);
    let eodCalls=0,avCalls=0,checked=0;
    try {
      const eodKey=await stockCredential(paths),avKey=await stockCredential(paths,"ALPHAVANTAGE_API_KEY");
      const fetchImpl=options.fetchImpl??nodeHttpFetch;
      const request=async(url:URL)=>{
        const response=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw Error("provider_failure");
        const text=await response.text();if(text.length>12_000_000)throw Error("response_too_large");
        return JSON.parse(text);
      };
      const usageUrl=new URL("https://eodhd.com/api/user");usageUrl.searchParams.set("api_token",eodKey);usageUrl.searchParams.set("fmt","json");
      const account=await request(usageUrl),used=account.apiRequestsDate===date?account.apiRequests:0;
      if(account.subscriptionType!=="free"||account.dailyRateLimit!==20||!Number.isSafeInteger(used)||used<0||used>=18)throw Error("base_quota_unavailable");
      const maximum=Math.min(4,18-used);
      const eod=async(path:string,params:Record<string,string>={})=>{
        if(eodCalls>=maximum)throw Error("base_quota_exhausted");
        eodCalls++;db.prepare("UPDATE stocks_discovery_days SET eod_calls=? WHERE utc_date=?").run(eodCalls,date);
        const url=new URL("/api/"+path,"https://eodhd.com");for(const[k,v]of Object.entries({...params,fmt:"json",api_token:eodKey}))url.searchParams.set(k,v);
        return request(url);
      };
      avCalls=1;db.prepare("UPDATE stocks_discovery_days SET av_calls=1 WHERE utc_date=?").run(date);
      const url=new URL("https://www.alphavantage.co/query");url.searchParams.set("function","TOP_GAINERS_LOSERS");url.searchParams.set("apikey",avKey);
      const av=await request(url),session=discoverySession(av,marketDate(at.toISOString(),"America/New_York"));
      const cached=loadStocksCache(db),latestUS=cached?.data.series.filter(s=>s.asset.exchange==="US").flatMap(s=>s.points.at(-1)?.date??[]).sort().at(-1);
      if(!latestUS||session!==latestUS)throw Error("source_session_mismatch");
      // A weekend/holiday keeps the same dated selection, without spending histories again.
      if(previous?.data.sessionDate===session&&["ready","empty"].includes(previous.state)){
        const updated={...previous,capturedAt:at.toISOString()};storeDiscovery(db,updated);
        db.prepare("UPDATE stocks_discovery_days SET state=? WHERE utc_date=?").run(updated.state==="ready"?"complete":"empty",date);
        return {state:updated.state,cards:updated.data.cards.length,eodCalls,avCalls,reused:true};
      }
      if(maximum<2)throw Error("history_budget_unavailable");
      const catalog=await eod("exchange-symbol-list/US");
      const seenRows=db.prepare("SELECT symbol,session_date,day_change FROM stocks_discovery_seen").all() as Array<{symbol:string;session_date:string;day_change:number}>;
      const seen=new Map(seenRows.map(r=>[r.symbol,r]));
      const candidates=discoveryCandidates(av,catalog,new Set(config.assets.map(a=>a.id)))
        .filter(c=>repeatAllowed(c.symbol,c.day,session,seen)).slice(0,Math.min(3,maximum-1));
      const cards:DiscoveryCard[]=[];let failures=0;
      for(const candidate of candidates){
        checked++;
        try{
          const history=await eod("eod/"+candidate.symbol+".US",{period:"d",from:dayShift(session,-100),to:session});
          const card=verifyDiscoveryHistory(candidate,history,session);if(card)cards.push(card);
        }catch{failures++;}
      }
      const snapshot:DiscoverySnapshot={version:1,state:failures?"partial":cards.length?"ready":"empty",capturedAt:at.toISOString(),data:{sessionDate:session,cards,checked,...(failures?{issue:"history_unavailable"}:{})}};
      storeDiscovery(db,snapshot);
      db.prepare("UPDATE stocks_discovery_days SET state=? WHERE utc_date=?").run(snapshot.state==="ready"?"complete":snapshot.state,date);
      db.prepare("DELETE FROM stocks_discovery_days WHERE utc_date<?").run(dayShift(date,-31));
      return {state:snapshot.state,cards:cards.length,eodCalls,avCalls};
    }catch{
      const failed:DiscoverySnapshot={version:1,state:"failed",capturedAt:at.toISOString(),data:previous?{...previous.data,issue:"discovery_refresh_failed"}:{sessionDate:dayShift(date,-1),cards:[],checked,issue:"discovery_refresh_failed"}};
      storeDiscovery(db,failed);
      db.prepare("UPDATE stocks_discovery_days SET state='failed',error_code='discovery_refresh_failed' WHERE utc_date=?").run(date);
      return {state:"failed",eodCalls,avCalls};
    }
  }finally{db.close();}
}
/** Strict optional boundary; never prevent other Poller participants from finishing. */
export async function refreshStocksDiscoverySafely(...args:Parameters<typeof refreshStocksDiscovery>){
  try{return await refreshStocksDiscovery(...args);}catch{return {state:"failed"};}
}
