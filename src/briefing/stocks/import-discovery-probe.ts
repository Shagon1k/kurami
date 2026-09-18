import {readFile} from "node:fs/promises";
import {openBriefingDatabase,type BriefingPaths} from "../store.ts";
import type {StocksConfig} from "./config.ts";
import {storeDiscovery} from "./discovery.ts";
import {parseDiscoverySnapshot,type DiscoveryCard} from "./discovery-model.ts";

/** One-time operator import of the independently verified feasibility result; zero API calls. */
export async function importDiscoveryProbe(sourcePath:string,verifiedPath:string,config:StocksConfig,paths:BriefingPaths,at=new Date()) {
  const read=async(path:string)=>{const text=await readFile(path,"utf8");if(text.length>1_000_000)throw Error("probe_too_large");return JSON.parse(text);};
  const [source,verified]=await Promise.all([read(sourcePath),read(verifiedPath)]);
  if(!config.enabled||!Array.isArray(source.candidates)||!Array.isArray(verified.results)||verified.results.length>3
    ||!Number.isFinite(Date.parse(verified.checkedAt))||at.getTime()-Date.parse(verified.checkedAt)>48*3600000||Date.parse(verified.checkedAt)>at.getTime()
    ||source.checkedAt.slice(0,10)!==verified.checkedAt.slice(0,10)||verified.quota?.limit!==20||verified.quota.usedAfter>18
    ||verified.quota.usedAfter-verified.quota.usedBefore!==verified.results.length)throw Error("unverified_discovery_probe");
  const cards:DiscoveryCard[]=[];
  for(const row of verified.results){
    const candidate=source.candidates.find((c:{ticker:string})=>c.ticker===row.ticker);
    if(!candidate||candidate.isin!==row.isin||candidate.price!==row.price||!row.dateMatches||row.historyDate!==source.sessionDate
      ||!Number.isFinite(row.adjustedDay)||!Number.isFinite(row.rawDay)||!Number.isFinite(row.relativeVolume)
      ||Math.abs(row.priceDifferencePercent)>.5||Math.abs(row.rawDay-row.adjustedDay)>.5||Math.abs(row.day-row.adjustedDay)>.5
      ||row.historyPoints<21)throw Error("unverified_discovery_history");
    if(config.assets.some(a=>a.id===row.ticker)||Math.abs(row.adjustedDay)<3||Math.abs(row.adjustedDay)>30||row.relativeVolume<1.5)continue;
    cards.push({symbol:row.ticker,name:row.name,isin:row.isin,price:row.historyClose,day:row.adjustedDay,volume:row.volume,
      date:row.historyDate,week:row.week,month:row.month,relativeVolume:row.relativeVolume,points:[]});
  }
  const snapshot=parseDiscoverySnapshot({version:1,state:cards.length?"ready":"empty",capturedAt:verified.checkedAt,data:{sessionDate:source.sessionDate,cards,checked:verified.results.length}});
  const db=openBriefingDatabase(paths);
  try{
    db.exec("BEGIN IMMEDIATE");
    if(db.prepare("SELECT 1 FROM addon_snapshots WHERE addon_id='stocks-discovery'").get())throw Error("discovery_cache_exists");
    storeDiscovery(db,snapshot);
    db.prepare("INSERT INTO stocks_discovery_days(utc_date,state,eod_calls,av_calls,started_at) VALUES(?,'complete',?,1,?)")
      .run(verified.checkedAt.slice(0,10),1+verified.results.length,verified.checkedAt);
    db.exec("COMMIT");return {cards:cards.length,networkRequests:0,sessionDate:source.sessionDate};
  }catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}finally{db.close();}
}
