import {closeSync,fstatSync,openSync,readSync,realpathSync} from "node:fs";
import {isAbsolute,resolve,sep} from "node:path";
import {StringDecoder} from "node:string_decoder";
import {DatabaseSync} from "node:sqlite";
type Window={used_percent:number;window_minutes:number;resets_at:number};
type RateLimits={primary:Window|null;secondary:Window|null};
export type UsageEvent={at:number;input:number;cached:number;output:number;total:number;model:string|null;cacheWrite:number|null;requestInput:number|null};
type UsageTotals={input:number;cached:number;output:number;total:number;cacheWrite:number|null};
export type LimitObservation={date:string;windowMinutes:number;usedPercent:number;at:number};
type FileCache={size:number;mtimeMs:number;ino:number;pending:string;events:UsageEvent[];recordEvents:UsageEvent[];activity:{at:number;event:string}[];previousTotals:UsageTotals|null;currentModel:string|null;limit:{at:number;limits:CodexLimit[]}|null;limitDays:Map<string,LimitObservation>;lastSeen:number};
type TokenCounts={input_tokens?:number;cached_input_tokens?:number;cache_write_input_tokens?:number;output_tokens?:number;total_tokens?:number};

export type CodexLimit={name:string;usedPercent:number;remainingPercent:number;windowMinutes:number;resetsAt:string;observedAt:string};

const fileCache=new Map<string,FileCache>();
const dayFormatter=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Vilnius",year:"numeric",month:"2-digit",day:"2-digit"});
export function localDay(at:number):string {
  const parts=dayFormatter.formatToParts(at);
  return ["year","month","day"].map(type=>parts.find(part=>part.type===type)!.value).join("-");
}

function isWindow(value:unknown):value is Window {
  if(!value||typeof value!=="object")return false;
  const window=value as Partial<Window>;
  return typeof window.used_percent==="number"&&Number.isFinite(window.used_percent)&&window.used_percent>=0&&window.used_percent<=100&&
    typeof window.window_minutes==="number"&&window.window_minutes>0&&Number.isFinite(window.window_minutes)&&
    typeof window.resets_at==="number"&&Number.isFinite(window.resets_at)&&window.resets_at>0;
}

function parseLine(line:string,cache:FileCache):void {
  if(!line.includes('"token_usage_record"')&&!line.includes('"token_count"')&&!line.includes('"turn_context"')&&!line.includes('"session_meta"')&&!line.includes('"task_started"')&&!line.includes('"task_complete"')&&!line.includes('"turn_aborted"'))return;
  try {
    const record=JSON.parse(line) as {timestamp?:string;type?:string;payload?:{type?:string;model?:string;usage?:TokenCounts;info?:{total_token_usage?:TokenCounts;last_token_usage?:TokenCounts};rate_limits?:RateLimits}};
    const at=Date.parse(record.timestamp??"");
    if(!Number.isFinite(at))return;
    if(record.type==="turn_context"||record.type==="session_meta"){
      cache.currentModel=typeof record.payload?.model==="string"&&/^[A-Za-z0-9._/-]{1,120}$/.test(record.payload.model)?record.payload.model:null;
      return;
    }
    const model=typeof record.payload?.model==="string"&&/^[A-Za-z0-9._/-]{1,120}$/.test(record.payload.model)?record.payload.model:cache.currentModel;
    if(record.type==="event_msg"&&["task_started","task_complete","turn_aborted"].includes(record.payload?.type??"")){
      cache.activity.push({at,event:record.payload!.type!});if(cache.activity.length>20)cache.activity.shift();return;
    }
    if(record.type==="token_usage_record"){
      const usage=record.payload?.usage;
      if(!usage||!Number.isSafeInteger(usage.input_tokens)||!Number.isSafeInteger(usage.output_tokens))return;
      const input=usage.input_tokens!,output=usage.output_tokens!;
      if(input<0||output<0)return;
      const cached=Number.isSafeInteger(usage.cached_input_tokens)&&usage.cached_input_tokens!>=0?Math.min(input,usage.cached_input_tokens!):0;
      const write=usage.cache_write_input_tokens;
      const cacheWrite=Number.isSafeInteger(write)&&write!>=0&&cached+write!<=input?write!:null;
      cache.recordEvents.push({at,input,cached,output,total:input+output,model,cacheWrite,requestInput:input});
    } else if(record.type==="event_msg"&&record.payload?.type==="token_count"){
      const usage=record.payload.info?.total_token_usage;
      if(usage&&Number.isSafeInteger(usage.input_tokens)&&Number.isSafeInteger(usage.output_tokens)){
        const input=usage.input_tokens!,output=usage.output_tokens!;
        const cached=Number.isSafeInteger(usage.cached_input_tokens)?usage.cached_input_tokens!:0;
        const total=input+output;
        if(input>=0&&output>=0&&cached>=0&&cached<=input){
          const previous=cache.previousTotals;
          const reset=previous&&(input<previous.input||output<previous.output||cached<previous.cached);
          const write=usage.cache_write_input_tokens;
          const cacheWrite=Number.isSafeInteger(write)&&write!>=0&&cached+write!<=input?write!:null;
          const base=previous&&!reset?previous:{input:0,cached:0,output:0,total:0,cacheWrite:0};
          if(total>base.total){
            const deltaInput=input-base.input,deltaOutput=output-base.output,deltaCached=cached-base.cached;
            const deltaWrite=cacheWrite!==null&&base.cacheWrite!==null&&cacheWrite>=base.cacheWrite&&deltaCached+cacheWrite-base.cacheWrite<=deltaInput?cacheWrite-base.cacheWrite:null;
            const last=record.payload.info?.last_token_usage;
            const requestInput=last?.input_tokens===deltaInput&&last?.output_tokens===deltaOutput?deltaInput:null;
            cache.events.push({at,input:deltaInput,cached:deltaCached,output:deltaOutput,total:total-base.total,model,cacheWrite:deltaWrite,requestInput});
          }
          cache.previousTotals={input,cached,output,total,cacheWrite};
        }
      }
      const rate=record.payload.rate_limits;
      if(!rate)return;
      const limits:CodexLimit[]=[];
      for(const [name,window] of [["primary",rate.primary],["secondary",rate.secondary]] as const){
        if(!isWindow(window))continue;
        const date=localDay(at),key=`${date}:${window.window_minutes}:${window.used_percent}`;
        const previous=cache.limitDays.get(key);
        if(!previous||at<previous.at)cache.limitDays.set(key,{date,windowMinutes:window.window_minutes,usedPercent:window.used_percent,at});
        limits.push({name,usedPercent:window.used_percent,remainingPercent:Math.max(0,100-window.used_percent),
          windowMinutes:window.window_minutes,resetsAt:new Date(window.resets_at*1000).toISOString(),observedAt:new Date(at).toISOString()});
      }
      if(limits.length&&(!cache.limit||at>=cache.limit.at))cache.limit={at,limits};
    }
  } catch {return;}
}

export function scanFile(path:string,codexHome:string):FileCache|null {
  if(!isAbsolute(path))return null;
  const allowed=[resolve(codexHome,"sessions")+sep,resolve(codexHome,"archived_sessions")+sep];
  let fd:number|undefined;
  try {
    const actual=realpathSync(path);
    if(!allowed.some(prefix=>actual.startsWith(prefix)))return null;
    fd=openSync(actual,"r");
    const stat=fstatSync(fd);
    const previous=fileCache.get(actual);
    if(previous&&previous.size===stat.size&&previous.mtimeMs===stat.mtimeMs&&previous.ino===stat.ino){previous.lastSeen=Date.now();return previous;}
    const appended=previous&&previous.ino===stat.ino&&previous.size<stat.size;
    const cache:FileCache=appended?previous:{size:0,mtimeMs:0,ino:stat.ino,pending:"",events:[],recordEvents:[],activity:[],previousTotals:null,currentModel:null,limit:null,limitDays:new Map(),lastSeen:Date.now()};
    let position=appended?cache.size:0;
    const buffer=Buffer.alloc(64*1024);
    const decoder=new StringDecoder("utf8");
    while(position<stat.size){
      const length=readSync(fd,buffer,0,Math.min(buffer.length,stat.size-position),position);
      if(!length)break;
      position+=length;
      const parts=(cache.pending+decoder.write(buffer.subarray(0,length))).split("\n");
      cache.pending=parts.pop()??"";
      for(const line of parts)parseLine(line,cache);
      if(cache.pending.length>1_000_000)cache.pending="";
    }
    cache.pending+=decoder.end();
    cache.size=position;cache.mtimeMs=stat.mtimeMs;cache.ino=stat.ino;cache.lastSeen=Date.now();
    fileCache.set(actual,cache);
    return cache;
  } catch {return null;}
  finally {if(fd!==undefined)closeSync(fd);}
}


export type ThreadUsage={tokens:number|null;observed:boolean};
export function readThreadUsage(home:string,ids:readonly string[],until:Date):Map<string,ThreadUsage> {
  const result=new Map<string,ThreadUsage>();
  let db:DatabaseSync|undefined;
  try {
    db=new DatabaseSync(resolve(home,"state_5.sqlite"),{readOnly:true,timeout:1000});
    const query=db.prepare("SELECT rollout_path FROM threads WHERE id=?");
    for(const id of new Set(ids)){
      const row=query.get(id) as {rollout_path:string|null}|undefined;
      const file=row?.rollout_path?scanFile(row.rollout_path,home):null;
      const events=file?(file.events.length?file.events:file.recordEvents):[];
      const eligible=events.filter(event=>event.at<=until.getTime());
      result.set(id,{tokens:eligible.length?eligible.reduce((sum,event)=>sum+event.total,0):null,observed:eligible.length>0});
    }
  }catch{for(const id of ids)result.set(id,{tokens:null,observed:false});}
  finally{db?.close();}
  return result;
}
export function pruneUsageCache():void {
  for(const [path,cached] of fileCache)if(Date.now()-cached.lastSeen>86_400_000)fileCache.delete(path);
}
