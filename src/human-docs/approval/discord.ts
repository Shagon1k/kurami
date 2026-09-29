// Minimal Discord REST transport for docs proposals. The channel ID stays in Hermes configuration:
// the card goes to the same channel the weekly docs audit delivers to.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import type {DiscordObject} from "../../discord/ui.ts";

export const DOCS_AUDIT_JOB="kurami-docs-freshness";

function apiBase():string {
  return (process.env.DISCORD_API_BASE??"https://discord.com/api/v10").replace(/\/$/,"");
}

export function hermesHome():string {
  return resolve(process.env.HERMES_HOME??"/home/shagon1k/_hermes/_core");
}

function envValue(key:string):string|undefined {
  const scoped=process.env[key]?.trim();
  if(scoped)return scoped;
  for(const raw of readFileSync(resolve(hermesHome(),".env"),"utf8").split(/\r?\n/)){
    const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(raw.trim());
    if(!match||match[1]!==key)continue;
    const value=match[2].trim().replace(/^(['"])(.*)\1$/,"$2");
    return value||undefined;
  }
  return undefined;
}

export function updatesChannelId():string {
  const scoped=process.env.KURAMI_DOCS_UPDATES_CHANNEL?.trim();
  if(scoped&&/^\d+$/.test(scoped))return scoped;
  const file=JSON.parse(readFileSync(resolve(hermesHome(),"cron/jobs.json"),"utf8")) as {jobs?:Array<{name?:string;deliver?:string}>}|Array<{name?:string;deliver?:string}>;
  const jobs=Array.isArray(file)?file:file.jobs??[];
  const matches=jobs.filter(job=>job.name===DOCS_AUDIT_JOB);
  const target=/^discord:(\d+)$/.exec(matches.length===1?matches[0].deliver??"":"");
  if(!target)throw new Error(`The ${DOCS_AUDIT_JOB} job must deliver to exactly one Discord channel`);
  return target[1];
}

export function ownerId():string {
  const owners=(envValue("DISCORD_ALLOWED_USERS")??"").split(/[\s,]+/).filter(Boolean);
  if(owners.length!==1||!/^\d+$/.test(owners[0]))throw new Error("Docs approval requires exactly one numeric allowed Discord owner");
  return owners[0];
}

export type DiscordMessage={id:string;content:string;author:{id:string;bot?:boolean}};

export class DiscordClient {
  readonly #token:string;
  constructor(token=envValue("DISCORD_BOT_TOKEN")){
    if(!token)throw new Error("DISCORD_BOT_TOKEN is unavailable");
    this.#token=token;
  }

  async request(method:string,path:string,payload?:DiscordObject,timeoutMs=8000):Promise<unknown> {
    for(let attempt=0;attempt<3;attempt+=1){
      const response=await fetch(`${apiBase()}${path}`,{
        method,
        headers:{authorization:`Bot ${this.#token}`,...(payload?{"content-type":"application/json"}:{})},
        body:payload?JSON.stringify(payload):undefined,
        signal:AbortSignal.timeout(timeoutMs),
      });
      if(response.status===429){
        const body=await response.json() as {retry_after?:number};
        await new Promise(done=>setTimeout(done,Math.min(Math.max(Number(body.retry_after??1),0.1),5)*1000));
        continue;
      }
      if(response.status>=500&&attempt<2){await new Promise(done=>setTimeout(done,250*(attempt+1)));continue;}
      if(!response.ok)throw new Error(`Discord ${method} failed: HTTP ${response.status} ${(await response.text()).slice(0,200)}`);
      return response.status===204?{}:await response.json();
    }
    throw new Error(`Discord ${method} exhausted bounded retries`);
  }

  async post(channelId:string,payload:DiscordObject):Promise<string> {
    const message=await this.request("POST",`/channels/${channelId}/messages`,payload) as {id?:string};
    if(!message.id)throw new Error("Discord did not return a message ID");
    return message.id;
  }

  async edit(channelId:string,messageId:string,payload:DiscordObject):Promise<void> {
    await this.request("PATCH",`/channels/${channelId}/messages/${messageId}`,payload);
  }

  /** Messages after a snowflake, oldest first. */
  async messagesAfter(channelId:string,after:string|null):Promise<DiscordMessage[]> {
    const query=after?`?after=${after}&limit=100`:"?limit=100";
    const messages=await this.request("GET",`/channels/${channelId}/messages${query}`) as DiscordMessage[];
    return [...messages].sort((left,right)=>BigInt(left.id)<BigInt(right.id)?-1:1);
  }
}
