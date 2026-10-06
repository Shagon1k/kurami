import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {PROJECTS_STYLES} from "./styles.ts";
import {WEB_CLIENT_JS} from "../web/presentation.ts";
import {TOAST_RUNTIME_JS} from "../ui-library/runtime/toast.ts";
import {PROJECT_ACTION_REQUEST_JS} from "./action-request.ts";

const client=WEB_CLIENT_JS+TOAST_RUNTIME_JS+PROJECT_ACTION_REQUEST_JS+readFileSync(new URL("./client.js",import.meta.url),"utf8");
// Pin the browser, stylesheet and fragment markup to one compatible server generation.
export const PROJECTS_CLIENT_VERSION=createHash("sha256").update(client).update(PROJECTS_STYLES).update(readFileSync(new URL("./render.ts",import.meta.url))).digest("hex").slice(0,16);
export const PROJECTS_CLIENT_JS=`const projectsClientVersion=${JSON.stringify(PROJECTS_CLIENT_VERSION)};\n`+client;
