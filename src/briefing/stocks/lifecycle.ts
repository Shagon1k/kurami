import type {DatabaseSync} from "node:sqlite";
import type {BriefingPayload,BriefingAddonEnvelope} from "../model.ts";
import type {StocksConfig} from "./config.ts";
import {loadStocksCache} from "./collector.ts";
import {stocksBrief} from "./model.ts";

/** Cache-only boundary: no network or model call in the publication critical path. */
export function attachStocksBrief(database:DatabaseSync,payload:BriefingPayload,config:StocksConfig,at:string):void {
  if(!config.enabled||payload.edition.type!=="daily"||payload.addons.stocks)return;
  const cache=loadStocksCache(database);
  if(cache)cache.data.series=cache.data.series.map(series=>({...series,points:series.points.filter(point=>point.date<payload.edition.localDate)}));
  payload.addons.stocks=stocksBrief(cache,config,at) as unknown as BriefingAddonEnvelope;
}
