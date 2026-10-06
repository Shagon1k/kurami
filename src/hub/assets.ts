import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {CHART_CLIENT_SCRIPT} from "../ui-library/components/charts/client.ts";
import {HUB_STYLES} from "./styles.ts";
import {WEB_CLIENT_JS} from "../web/presentation.ts";
import {PERIOD_CLIENT_SCRIPT} from "../ui-library/components/period-switch.ts";
import {TOAST_RUNTIME_JS} from "../ui-library/runtime/toast.ts";

export const HUB_CLIENT_JS=WEB_CLIENT_JS+CHART_CLIENT_SCRIPT+"\n"+PERIOD_CLIENT_SCRIPT+"\n"+TOAST_RUNTIME_JS+"\n"+readFileSync(new URL("./client.js",import.meta.url),"utf8");
export function versionedAsset(path:string,body:string):string {
  return `${path}?v=${createHash("sha256").update(body).digest("hex").slice(0,16)}`;
}
export const HUB_CSS_URL=versionedAsset("/assets/hub.css",HUB_STYLES);
export const HUB_CLIENT_URL=versionedAsset("/assets/hub.js",HUB_CLIENT_JS);
