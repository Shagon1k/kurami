import type {StatusRequestState} from "./status-state.ts";
import {tr,type Language} from "./i18n.ts";

type Tone = "info" | "warning" | "success";
type Presentation = {message:string;tone:Tone};
export const STATUS_PRESENTATION = {
  checking:{message:"Checking the current status in GitHub.",tone:"info"},
  writing:{message:"Saving status in GitHub.",tone:"info"},
  awaiting_sync:{message:"GitHub updated. Waiting for Kurami sync.",tone:"info"},
  synced:{message:"Status synced.",tone:"success"},
  conflict:{message:"Status changed in GitHub. Check the current state.",tone:"warning"},
  failed:{message:"Status change is unconfirmed. You can retry.",tone:"warning"},
  uncertain:{message:"The write is unconfirmed. Check its result before another change.",tone:"warning"},
  pr_pending:{message:"GitHub is processing this PR action.",tone:"info"},
  stale:{message:"Wait for fresh sync data.",tone:"warning"},
  unsupported:{message:"Project status field is not configured.",tone:"warning"},
  unavailable:{message:"Status changes are not available yet.",tone:"warning"},
} satisfies Record<StatusRequestState | "pr_pending" | "stale" | "unsupported" | "unavailable",Presentation>;

export function statusPresentation(state:string):Presentation | undefined {
  return Object.hasOwn(STATUS_PRESENTATION,state)?STATUS_PRESENTATION[state as keyof typeof STATUS_PRESENTATION]:undefined;
}
export function browserStatusPresentation(lang:Language) {
  return Object.fromEntries(Object.entries(STATUS_PRESENTATION).map(([state,value])=>[state,{...value,message:tr(value.message,lang)}]));
}
