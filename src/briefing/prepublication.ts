import { section } from "./addons/envelopes.ts";
import { applyLiveAddons, LIVE_ADDONS } from "./addons/live.ts";
import { refreshDerivedAddons } from "./addons/derived.ts";
import { refreshDataQuality } from "./addons/quality.ts";
import { briefingAddonEnabled, parseBriefingPayload } from "./model.ts";
import { loadBriefingAttempt } from "./run-attempt.ts";
import { briefingPaths, loadEdition, openBriefingDatabase, refreshPublishedEdition } from "./store.ts";
import { loadBriefingRuntimeConfig } from "./runtime-config.ts";
import { collectDynamicBriefingSnapshot } from "./providers/dynamic-snapshot.ts";
import { composioReadConnectionFromEnvironment, createComposioReadToolCaller } from "./providers/composio-mcp.ts";
import { renderBriefingPage } from "./ui/render-page.ts";
import {attachWeeklyReview} from "./weekly/lifecycle.ts";
import {isSunday} from "./weekly/model.ts";
import {attachStocksBrief} from "./stocks/lifecycle.ts";
import {loadSenderRules} from "./mail-learning.ts";

export async function refreshBeforePublication(editionId:string, attemptId:string, environment:NodeJS.ProcessEnv=process.env,
  collect:typeof collectDynamicBriefingSnapshot=collectDynamicBriefingSnapshot, now=()=>new Date()) {
  const paths=briefingPaths(environment), config=await loadBriefingRuntimeConfig(paths,environment);
  const database=openBriefingDatabase(paths);
  let row, payload;
  try {
    const attempt=loadBriefingAttempt(database,attemptId);
    row=loadEdition(database,{id:editionId});
    if(attempt?.editionId!==editionId || attempt.state!=="media-ready" || row?.state!=="prepared") {
      throw new Error("Live prepublication refresh requires a matching media-ready prepared edition");
    }
    payload=parseBriefingPayload(JSON.parse(row.payload_json));
  } finally {database.close();}
  const at=now();
  const enabled=Object.fromEntries(LIVE_ADDONS.map(addon=>[addon.id,config.addons[addon.id] && briefingAddonEnabled(payload,addon.id)]));
  const old=LIVE_ADDONS.some(addon=>{
    if(!enabled[addon.id])return false;
    const timestamp=Date.parse(String(section(payload,addon.id).fetchedAt??""));
    return !Number.isFinite(timestamp) || timestamp>at.getTime() || at.getTime()-timestamp>15*60_000;
  });
  const weekly=config.weekly.enabled&&isSunday(payload.edition.localDate);
  const stocks=config.stocks.enabled&&!payload.addons.stocks;
  if(!old&&!weekly&&!stocks)return {updated:false,reason:"live_data_fresh"};
  if(old) {
    const snapshot=await collect({
    getCaller:()=>createComposioReadToolCaller(composioReadConnectionFromEnvironment(environment)),
    enabled, includeTomorrow:config.signals.enabled && config.signals.rules.earlyTomorrow,
    gmailPageSize:config.gmailPageSize,gmailQuery:config.gmailQuery,calendars:config.calendars,
    localDate:payload.edition.localDate,timeZone:config.timeZone,weatherLocation:config.weatherLocation,
    retry:{attempts:2,timeoutMs:12_000,initialDelayMs:300,maximumDelayMs:1000},
    });
    applyLiveAddons(payload,snapshot,{refreshedAt:now().toISOString(),enabled,senderRules:loadSenderRules(paths.databasePath)});
  }
  const refreshedAt=now().toISOString();
  refreshDerivedAddons(payload,{at:refreshedAt,settings:{signals:config.signals,weekly:config.weekly}});
  if(weekly) {
    const history=openBriefingDatabase(paths);
    try {attachWeeklyReview(history,payload,config.weekly,refreshedAt);}
    catch {console.warn("Weekly add-on preparation failed; Daily continues");}
    finally {history.close();}
  }
  if(stocks) {
    const cache=openBriefingDatabase(paths);
    try {attachStocksBrief(cache,payload,config.stocks,refreshedAt);}
    catch {console.warn("Stocks snapshot unavailable; Daily continues");}
    finally {cache.close();}
  }
  refreshDataQuality(payload,payload.live?.refreshedAt??refreshedAt);
  const validated=parseBriefingPayload(payload);
  await refreshPublishedEdition(validated,renderBriefingPage(validated),row.content_digest,paths,{prepared:true});
  return {updated:true,state:payload.live?.state,refreshedAt};
}
