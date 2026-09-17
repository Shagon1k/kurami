import {readFile} from "node:fs/promises";
import {briefingPaths,initializeBriefingStore,openBriefingDatabase,upsertAddonSnapshot,type BriefingPaths} from "../store.ts";
import {loadBriefingRuntimeConfig} from "../runtime-config.ts";
import type {StocksConfig} from "./config.ts";
import type {BriefingAddonEnvelope} from "../model.ts";
import {parseStockPoints,parseStocksSnapshot,dayShift,marketDate} from "./model.ts";

/** Operator bootstrap from the already-paid-for-by-free-quota feasibility probe. */
export async function importStocksProbe(path:string,config:StocksConfig,paths:BriefingPaths,at=new Date()) {
  const encoded=await readFile(path,"utf8");
  if(encoded.length>4_000_000)throw new Error("Probe file too large");
  const report=JSON.parse(encoded);
  if(!config.enabled||report.finalQuota?.subscriptionType!=="free"||report.finalQuota.dailyRateLimit!==20
    ||!Number.isInteger(report.finalQuota.apiRequests)||report.finalQuota.apiRequests>18||report.finalQuota.apiRequests<0
    ||!Array.isArray(report.history)||!Number.isFinite(Date.parse(report.checkedAt))
    ||report.finalQuota.apiRequestsDate!==report.checkedAt.slice(0,10)
    ||Date.parse(report.checkedAt)>at.getTime()||at.getTime()-Date.parse(report.checkedAt)>72*3600000)throw new Error("Invalid or stale stock probe");
  const series=config.assets.map(asset=>{
    const metadata=(asset.exchange==="US"?report.catalog?.items:report.vuaa?.items)?.find((row:Record<string,unknown>)=>
      row.Code===asset.id&&(row.Isin??row.ISIN)===asset.isin&&row.Currency===asset.currency&&(asset.exchange==="US"||row.Exchange===asset.exchange));
    const rows=report.history.filter((row:Record<string,unknown>)=>row.symbol===asset.symbol);
    if(!metadata||rows.length!==1||!rows[0].ok||rows[0].status!==200||rows[0].currency!==asset.currency)throw new Error("Unverified probe identity");
    const today=marketDate(report.checkedAt,asset.timezone),to=dayShift(today,-1),from=[dayShift(today,-364),asset.listedFrom??"1900-01-01"].sort().at(-1)!;
    return {asset,points:parseStockPoints(rows[0].data,from,to),fetchedAt:report.checkedAt,state:"ready" as const};
  });
  const snapshot=parseStocksSnapshot({version:1,state:"ready",capturedAt:report.checkedAt,data:{provider:"eodhd",policy:config,series}});
  const db=openBriefingDatabase(paths);
  try {
    db.exec("BEGIN IMMEDIATE");
    if(db.prepare("SELECT 1 FROM addon_snapshots WHERE addon_id='stocks'").get())throw new Error("Stocks cache already exists");
    upsertAddonSnapshot(db,"stocks",snapshot as unknown as BriefingAddonEnvelope);
    db.prepare("INSERT INTO stocks_refresh_days(utc_date,state,requests,started_at,finished_at) VALUES(?,'complete',?,?,?)")
      .run(report.finalQuota.apiRequestsDate,report.finalQuota.apiRequests,report.checkedAt,report.checkedAt);
    db.exec("COMMIT");
    return {imported:series.length,networkRequests:0,asOf:series.map(s=>s.points.at(-1)!.date)};
  }catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}
  finally {db.close();}
}
if(import.meta.main){
  if(process.argv[2]!=="--file"||!process.argv[3]||process.argv.length!==4)throw new Error("Usage: import-probe --file <verified-report.json>");
  const paths=briefingPaths();await initializeBriefingStore(paths);
  const config=await loadBriefingRuntimeConfig(paths);
  console.log(JSON.stringify(await importStocksProbe(process.argv[3],config.stocks,paths)));
}
