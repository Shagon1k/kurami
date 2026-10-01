import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {CHART_CLIENT_SCRIPT} from "../ui-library/components/charts/client.ts";
import {HUB_STYLES} from "./styles.ts";

export const HUB_CLIENT_JS=CHART_CLIENT_SCRIPT+"\n"+readFileSync(new URL("./client.js",import.meta.url),"utf8");
export function versionedAsset(path:string,body:string):string {
  return `${path}?v=${createHash("sha256").update(body).digest("hex").slice(0,16)}`;
}
export const HUB_CSS_URL=versionedAsset("/assets/hub.css",HUB_STYLES);
export const HUB_CLIENT_URL=versionedAsset("/assets/hub.js",HUB_CLIENT_JS);
