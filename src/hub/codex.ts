import {closeSync,fstatSync,openSync,readSync,realpathSync} from "node:fs";
import {homedir} from "node:os";
import {isAbsolute,join,resolve,sep} from "node:path";
import {StringDecoder} from "node:string_decoder";
import {DatabaseSync} from "node:sqlite";

type ThreadRow={created_at:number;updated_at:number;model:string|null;rollout_path:string|null};
type Window={used_percent:number;window_minutes:number;resets_at:number};
type RateLimits={primary:Window|null;secondary:Window|null};
type UsageEvent={at:number;input:number;cached:number;output:number;total:number};
type UsageTotals={input:number;cached:number;output:number;total:number};
type FileCache={size:number;mtimeMs:number;ino:number;pending:string;events:UsageEvent[];recordEvents:UsageEvent[];previousTotals:UsageTotals|null;limit:{at:number;limits:CodexLimit[]}|null;lastSeen:number};

export type CodexLimit={name:string;usedPercent:number;remainingPercent:number;windowMinutes:number;resetsAt:string;observedAt:string};
export type CodexSnapshot={
  state:"available"|"unavailable";
  tokens7:number|null;tokens30:number|null;cached30:number|null;output30:number|null;
  sessions30:number|null;models:{name:string;sessions:number}[];
  limits:CodexLimit[];updatedAt:string|null;
  coverage:"complete"|"partial"|"unavailable";
};

const fileCache=new Map<string,FileCache>();
const unavailable:CodexSnapshot={state:"unavailable",tokens7:null,tokens30:null,cached30:null,output30:null,sessions30:null,models:[],limits:[],updatedAt:null,coverage:"unavailable"};

function isWindow(value:unknown):value is Window {
  if(!value||typeof value!=="object")return false;
  const window=value as Partial<Window>;
  return typeof window.used_percent==="number"&&Number.isFinite(window.used_percent)&&window.used_percent>=0&&window.used_percent<=100&&
    typeof window.window_minutes==="number"&&window.window_minutes>0&&Number.isFinite(window.window_minutes)&&
    typeof window.resets_at==="number"&&Number.isFinite(window.resets_at)&&window.resets_at>0;
}

function parseLine(line:string,cache:FileCache):void {
  if(!line.includes('"token_usage_record"')&&!line.includes('"token_count"'))return;
  try {
    const record=JSON.parse(line) as {timestamp?:string;type?:string;payload?:{type?:string;usage?:{input_tokens?:number;cached_input_tokens?:number;output_tokens?:number;total_tokens?:number};info?:{total_token_usage?:{input_tokens?:number;cached_input_tokens?:number;output_tokens?:number;total_tokens?:number}};rate_limits?:RateLimits}};
    const at=Date.parse(record.timestamp??"");
    if(!Number.isFinite(at))return;
    if(record.type==="token_usage_record"){
      const usage=record.payload?.usage;
      if(!usage||!Number.isSafeInteger(usage.input_tokens)||!Number.isSafeInteger(usage.output_tokens))return;
      const input=usage.input_tokens!,output=usage.output_tokens!;
      if(input<0||output<0)return;
      const cached=Number.isSafeInteger(usage.cached_input_tokens)&&usage.cached_input_tokens!>=0?Math.min(input,usage.cached_input_tokens!):0;
      cache.recordEvents.push({at,input,cached,output,total:input+output});
    } else if(record.type==="event_msg"&&record.payload?.type==="token_count"){
      const usage=record.payload.info?.total_token_usage;
      if(usage&&Number.isSafeInteger(usage.input_tokens)&&Number.isSafeInteger(usage.output_tokens)){
        const input=usage.input_tokens!,output=usage.output_tokens!;
        const cached=Number.isSafeInteger(usage.cached_input_tokens)?usage.cached_input_tokens!:0;
        const total=input+output;
        if(input>=0&&output>=0&&cached>=0&&cached<=input){
          const previous=cache.previousTotals;
          const reset=previous&&(input<previous.input||output<previous.output||cached<previous.cached);
          const base=previous&&!reset?previous:{input:0,cached:0,output:0,total:0};
          if(total>base.total)cache.events.push({at,input:input-base.input,cached:cached-base.cached,output:output-base.output,total:total-base.total});
          cache.previousTotals={input,cached,output,total};
        }
      }
      const rate=record.payload.rate_limits;
      if(!rate)return;
      const limits:CodexLimit[]=[];
      for(const [name,window] of [["primary",rate.primary],["secondary",rate.secondary]] as const){
        if(!isWindow(window))continue;
        limits.push({name,usedPercent:window.used_percent,remainingPercent:Math.max(0,100-window.used_percent),
          windowMinutes:window.window_minutes,resetsAt:new Date(window.resets_at*1000).toISOString(),observedAt:new Date(at).toISOString()});
      }
      if(limits.length&&(!cache.limit||at>=cache.limit.at))cache.limit={at,limits};
    }
  } catch {return;}
}

function scanFile(path:string,codexHome:string):FileCache|null {
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
    const cache:FileCache=appended?previous:{size:0,mtimeMs:0,ino:stat.ino,pending:"",events:[],recordEvents:[],previousTotals:null,limit:null,lastSeen:Date.now()};
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

export function collectCodexSnapshot(options:{home?:string;now?:Date}={}):CodexSnapshot {
  const home=options.home??process.env.HUB_CODEX_HOME??process.env.CODEX_HOME??join(homedir(),".codex");
  const now=options.now??new Date();
  let db:DatabaseSync|undefined;
  try {
    db=new DatabaseSync(resolve(home,"state_5.sqlite"),{readOnly:true,timeout:1_000});
    const cutoff7=now.getTime()-7*86_400_000;
    const cutoff30=now.getTime()-30*86_400_000;
    const rows=db.prepare("SELECT created_at,updated_at,model,rollout_path FROM threads WHERE updated_at>=? AND updated_at<=? ORDER BY updated_at DESC LIMIT 3000").all(Math.floor(cutoff30/1000),Math.floor(now.getTime()/1000)) as ThreadRow[];
    const sessions=rows.filter(row=>row.created_at*1000>=cutoff30);
    const modelCounts=new Map<string,number>();
    for(const row of sessions)if(row.model)modelCounts.set(row.model,(modelCounts.get(row.model)??0)+1);
    const models=[...modelCounts].map(([name,count])=>({name,sessions:count})).sort((a,b)=>b.sessions-a.sessions||a.name.localeCompare(b.name)).slice(0,5);
    let total7=0,total30=0,cached30=0,output30=0,scanned=0,missing=0,foundEvents=0;
    let newest:{at:number;limits:CodexLimit[]}|null=null;
    for(const row of rows){
      const file=row.rollout_path?scanFile(row.rollout_path,home):null;
      if(!file){missing++;continue;}
      scanned++;
      const events=file.events.length?file.events:file.recordEvents;
      if(!events.length&&row.created_at*1000>=cutoff30)missing++;
      for(const event of events){
        if(event.at<cutoff30||event.at>now.getTime())continue;
        foundEvents++;
        total30+=event.total;cached30+=event.cached;output30+=event.output;
        if(event.at>=cutoff7)total7+=event.total;
      }
      if(file.limit&&(!newest||file.limit.at>newest.at))newest=file.limit;
    }
    const latest=rows.length?new Date(Math.max(...rows.map(row=>row.updated_at))*1000).toISOString():null;
    const hasUsage=scanned>0&&foundEvents>0;
    for(const [path,cached] of fileCache)if(Date.now()-cached.lastSeen>86_400_000)fileCache.delete(path);
    return {state:"available",tokens7:hasUsage?total7:null,tokens30:hasUsage?total30:null,cached30:hasUsage?cached30:null,output30:hasUsage?output30:null,
      sessions30:sessions.length,models,limits:newest?.limits.filter(limit=>Date.parse(limit.resetsAt)>now.getTime())??[],updatedAt:latest,
      coverage:hasUsage?(missing||rows.length===3000?"partial":"complete"):"unavailable"};
  } catch {return {...unavailable};}
  finally {db?.close();}
}
