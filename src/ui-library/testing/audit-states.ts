// Additional audit states use invented data and production renderers, never live collectors.
import {createHash} from "node:crypto";
import {withDigestLanguage,type DigestLanguage} from "../../briefing/i18n.ts";
import {renderStocksPage} from "../../briefing/stocks/render.ts";
import {parseDiscoverySnapshot,type DiscoverySnapshot} from "../../briefing/stocks/discovery-model.ts";
import {parseStoredReview,type StoredReview} from "../../briefing/investment-review/store.ts";
import {inputDigest} from "../../briefing/investment-review/model.ts";
import {input,draft} from "../../../tests/fixtures/briefing/investment-review.ts";
import {syntheticStocksSnapshot,syntheticCinemaFilled} from "./digest-filled.ts";
import {syntheticHubSnapshot} from "./fixtures.ts";
import {renderHubPage} from "../../hub/render.ts";
import {injectSiteNavigation} from "../../briefing/ui/components/site-header.ts";

const at="2026-09-20T07:00:00Z";

export function syntheticDiscovery(state:DiscoverySnapshot["state"]="ready"):DiscoverySnapshot {
  const series=syntheticStocksSnapshot().data.series[0]!;
  return parseDiscoverySnapshot({version:1,state,capturedAt:at,data:{sessionDate:"2026-09-19",checked:3,
    cards:state==="empty"?[]:Array.from({length:3},(_,index)=>({symbol:`AUDIT${index}`,isin:"US"+String(index+100).padStart(10,"0"),
      name:index===0?"Synthetic international company with a long descriptive name for narrow screens":`Synthetic Discovery Company ${index+1}`,
      price:110+index,day:index===1?-5.4:7.2,volume:1_000_000,relativeVolume:1.8+index,date:"2026-09-19",week:9.3,month:index===2?null:12.1,
      points:series.points.slice(-31),
    })),...(state==="failed"?{issue:"discovery_refresh_failed"}:state==="partial"?{issue:"history_unavailable"}:{})}});
}

export function syntheticStoredReview(mode:"weekly"|"monthly"):StoredReview {
  const reviewInput={...structuredClone(input),mode};
  const reviewDraft={...structuredClone(draft),inputDigest:inputDigest(reviewInput)};
  const id=createHash("sha256").update(JSON.stringify({input:reviewInput,draft:reviewDraft})).digest("hex");
  return parseStoredReview({version:1,id,acceptedAt:"2026-09-18T07:00:00Z",input:reviewInput,draft:reviewDraft});
}

export function syntheticStocksDiscovery(lang:DigestLanguage="ru",state:DiscoverySnapshot["state"]="ready"):string {
  const snapshot=syntheticStocksSnapshot();
  const logos=new Map([["DEMO:US0000000000","audit-loaded.org"],["DEMO1:US0000000001","audit-failed.org"],
    ["AUDIT0:US0000000100","audit-loaded.org"],["AUDIT1:US0000000101","audit-failed.org"]]);
  return withDigestLanguage(lang,()=>renderStocksPage(snapshot,new URLSearchParams("symbols=DEMO&period=3m"),at,syntheticDiscovery(state),logos,
    [syntheticStoredReview("weekly"),syntheticStoredReview("monthly")]));
}

/** A full synthetic retained edition, with an old header and no EN editorial copy. */
export function syntheticRetainedCinema(lang:DigestLanguage="ru"):string {
  const html=syntheticCinemaFilled(lang,true);
  const oldHeader='<header class="utility-header" data-utility-header data-site-section="cinema"><div class="utility-header__inner page-shell"><time class="utility-meta" datetime="2026-09-19">19 сентября 2026</time><nav data-site-navigation></nav><div class="utility-actions"></div></div></header>';
  const retained=html.replace(/<header class="site-header[\s\S]*?<\/header>/,oldHeader);
  return withDigestLanguage(lang,()=>injectSiteNavigation(retained,[{section:"daily"},{section:"cinema"},{section:"weekly"},{section:"stocks"}],"cinema",`/${lang}/cinema`));
}

export function syntheticHubUnavailable(lang:DigestLanguage="ru"):string {
  const snapshot=syntheticHubSnapshot();
  snapshot.sources={orchestrator:"unavailable",git:"unavailable"};
  snapshot.projects=[];snapshot.weeks=[];snapshot.commitDays=[];snapshot.commitRepositories={};
  snapshot.codex={...snapshot.codex,state:"unavailable",tokens7:null,tokens30:null,cached30:null,output30:null,sessions30:null,coverage:"unavailable",periods:undefined,limits:[],models:[],account:{state:"unavailable",resetCredits:null,observedAt:null,limits:[]}};
  snapshot.operations={health:null,healthStale:true,alerts:[],activity:[]};
  snapshot.usage=undefined;
  return renderHubPage(snapshot,lang);
}

export function syntheticHubLong(lang:DigestLanguage="ru"):string {
  const snapshot=syntheticHubSnapshot();
  const title="Synthetic task with a very long description / Задача с очень длинным названием и дополнительными уточнениями для проверки переносов";
  snapshot.operations!.alerts.forEach(alert=>{alert.title=title;alert.detail="Synthetic check with a long diagnostic description";});
  snapshot.operations!.activity.forEach(event=>{event.subject=title;});
  snapshot.codex.coverage="partial";
  snapshot.operations!.healthStale=true;
  return renderHubPage(snapshot,lang);
}
