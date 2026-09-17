import type {BriefingAddon} from "./types.ts";
import {parseWeeklyConfig} from "../weekly/config.ts";
import {isSunday} from "../weekly/model.ts";
import {renderWeeklyTeaser} from "../weekly/render.ts";

export const weeklyAddon:BriefingAddon={
  id:"weekly",failurePolicy:"isolate",enabled:payload=>Boolean(payload.addons.weekly),
  derive(payload,context) {
    if(payload.edition.type!=="daily")return null;
    const settings=context.settings?.weekly??payload.addons.weekly?.data.policy;
    const config=parseWeeklyConfig(settings);
    if(!config.enabled)return null;
    const review=isSunday(payload.edition.localDate)?payload.addons.weekly?.data.review:undefined;
    return {version:1,state:review?"ready":"empty",capturedAt:context.at,data:{policy:config,...(review?{review}:{})}};
  },
  sections:[{slot:"after-main",order:20,render:renderWeeklyTeaser}],
};
