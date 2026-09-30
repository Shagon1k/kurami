import {AppServerClient} from "../orchestrator/integrations/codex/app-server.ts";
import type {CodexLimit} from "./codex.ts";

export class CodexAccountClient {
  private client:AppServerClient|null=null;
  private ready:Promise<void>|null=null;
  private binary:string;
  constructor(binary=process.env.CODEX_BIN??"/home/shagon1k/.local/bin/codex"){this.binary=binary;}
  private connect():Promise<void> {
    if(this.ready)return this.ready;
    this.client=new AppServerClient(this.binary);
    this.ready=this.client.initialize().catch(error=>{this.close();throw error;});
    return this.ready;
  }
  async call(method:string,params:unknown={}):Promise<any> {
    try{await this.connect();return await this.client!.request(method,params);}
    catch(error){this.close();throw error;}
  }
  close():void {
    const client=this.client;this.client=null;this.ready=null;client?.close();
  }
}

export type CodexAccountSnapshot={state:"live"|"unavailable";resetCredits:number|null;observedAt:string|null;limits:CodexLimit[]};
export function accountSnapshot(response:any,now=new Date()):CodexAccountSnapshot {
  const rate=response?.rateLimitsByLimitId?.codex??response?.rateLimits;
  const limits:CodexLimit[]=[];
  for(const name of ["primary","secondary"]){
    const window=rate?.[name];
    if(!window||!Number.isFinite(window.usedPercent)||window.usedPercent<0||window.usedPercent>100||!Number.isFinite(window.resetsAt)||!Number.isFinite(window.windowDurationMins)||window.windowDurationMins<=0)continue;
    limits.push({name,usedPercent:window.usedPercent,remainingPercent:100-window.usedPercent,windowMinutes:window.windowDurationMins,
      resetsAt:new Date(window.resetsAt*1000).toISOString(),observedAt:now.toISOString()});
  }
  const count=response?.rateLimitResetCredits?.availableCount;
  return {state:"live",resetCredits:Number.isInteger(count)&&count>=0?count:null,observedAt:now.toISOString(),limits};
}
export const codexAccount=new CodexAccountClient();
export async function readCodexAccount():Promise<CodexAccountSnapshot> {
  try{return accountSnapshot(await codexAccount.call("account/rateLimits/read"));}
  catch{return {state:"unavailable",resetCredits:null,observedAt:null,limits:[]};}
}
