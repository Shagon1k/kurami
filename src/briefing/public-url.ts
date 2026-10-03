import {WEB_ORIGIN,publicAppUrl,type WebLanguage} from "../web/routes.ts";

/** Notification/report links share the same locale and mounted route as the web UI. */
export function publicDigestUrl(path:string,language:WebLanguage="ru",environment:NodeJS.ProcessEnv=process.env):string {
  const configured=environment.BRIEFING_PUBLIC_BASE_URL?.trim();
  const base=configured?new URL(configured):new URL(WEB_ORIGIN);
  if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash)throw new Error("Digest public base must be a credential-free HTTPS URL");
  if(base.origin===WEB_ORIGIN||base.hostname==="digest.shagon1k.win")return WEB_ORIGIN+publicAppUrl(path,"digest",language);
  if(!path.startsWith("/")||path.startsWith("//"))throw new Error("Expected a local Digest path");
  return base.href.replace(/\/$/,"")+path;
}
