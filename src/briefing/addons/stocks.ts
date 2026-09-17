import type {BriefingAddon} from "./types.ts";
import {renderStocksTeaser} from "../stocks/render.ts";
export const stocksAddon:BriefingAddon={
  id:"stocks",failurePolicy:"isolate",enabled:payload=>Boolean(payload.addons.stocks),
  sections:[{slot:"after-main",order:5,render:renderStocksTeaser}],
};
