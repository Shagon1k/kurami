import {createHash} from "node:crypto";
import {open,realpath} from "node:fs/promises";
import {resolve,sep} from "node:path";
import {usageCounts,type TokenCounts,type UsageEvent} from "../../../core/codex-usage.ts";
import {API_RATE_DATE,API_RATE_SOURCE,estimateApiEquivalent} from "../../../core/api-equivalent.ts";

export type UsageModel={model:string|null;input:number;cached:number;output:number;usd:number|null;unpriced:number;uncertain:number};
type Totals=NonNullable<ReturnType<typeof usageCounts>>;
type Stream={models:UsageModel[];events:number;first:number|null;last:number|null};
type Turn={id:string;start:number|null;end:number|null;outcome:"completed"|"cancelled"|null};
export type UsageSnapshot={attempts:number|null;elapsedMs:number|null;outcome:"completed"|"failed"|"cancelled"|null;models:UsageModel[];events:number;first:number|null;last:number|null;partial:boolean;rateDate:string;rateSource:string;parserVersion:number};
export type Checkpoint={parserVersion:number;offset:number;ino:number;prefix:string;prefixBytes:number;mtime:number;size:number;model:string|null;previous:Totals|null;counterReset:boolean;cumulative:Stream;records:Stream;partial:boolean;skipLine:boolean;identity:boolean;from:number;until:number|null;mismatch:boolean;turns:Turn[]};
export const USAGE_PARSER_VERSION=1;
const empty=():Stream=>({models:[],events:0,first:null,last:null});
const validModel=(model:unknown):string|null=>typeof model==="string"&&/^[A-Za-z0-9._/-]{1,120}$/.test(model)?model:null;

function add(stream:Stream,event:UsageEvent):void {
  let row=stream.models.find(row=>row.model===event.model);
  if(!row){row={model:event.model,input:0,cached:0,output:0,usd:null,unpriced:0,uncertain:0};stream.models.push(row);}
  if(![row.input+event.input,row.cached+event.cached,row.output+event.output].every(Number.isSafeInteger))throw new Error("usage_counter_overflow");
  row.input+=event.input;row.cached+=event.cached;row.output+=event.output;
  const price=estimateApiEquivalent(event);
  if(price){row.usd=(row.usd??0)+price.usd;if(price.uncertain)row.uncertain+=event.total;}
  else row.unpriced+=event.total;
  stream.events++;stream.first??=event.at;stream.last=event.at;
}

function parse(line:string,state:Checkpoint,threadId:string):void {
  if(!/"(?:token_count|token_usage_record|turn_context|session_meta|task_started|task_complete|turn_aborted)"/.test(line))return;
  try {
    const record=JSON.parse(line),payload=record.payload??{};
    const at=Date.parse(record.timestamp);
    if(record.type==="event_msg"&&["task_started","task_complete","turn_aborted"].includes(payload.type)){
      if(!Number.isFinite(at)||at<state.from||state.until!==null&&at>state.until)return;
      const id=typeof payload.turn_id==="string"&&/^[A-Za-z0-9_-]{1,120}$/.test(payload.turn_id)?payload.turn_id:null;
      if(!id)return;
      let turn=state.turns.find(turn=>turn.id===id);
      if(!turn){turn={id,start:null,end:null,outcome:null};if(state.turns.length>=1000){state.partial=true;return;}state.turns.push(turn);}
      if(payload.type==="task_started")turn.start??=at;
      else {turn.end=at;turn.outcome=payload.type==="task_complete"?"completed":"cancelled";}
      return;
    }
    if(record.type==="session_meta"){
      if(payload.id!==threadId){state.partial=true;state.mismatch=true;}
      else state.identity=true;
      state.model=validModel(payload.model)??state.model;
      return;
    }
    if(record.type==="turn_context"){state.model=validModel(payload.model);return;}
    if(record.type!=="token_usage_record"&&!(record.type==="event_msg"&&payload.type==="token_count"))return;
    const cumulative=record.type==="event_msg";
    const raw=cumulative?payload.info?.total_token_usage:payload.usage;
    // Rate-limit-only events are not usage evidence.
    if(!raw)return;
    const counts=usageCounts(raw as TokenCounts);
    if(!counts||!Number.isFinite(at)){state.partial=true;return;}
    let delta=counts;
    let requestInput:number|null=counts.input;
    if(cumulative){
      if(state.counterReset)return;
      const previous=state.previous;
      const last=usageCounts(payload.info?.last_token_usage);
      if(previous){
        if(counts.input<previous.input||counts.cached<previous.cached||counts.output<previous.output){
          // A reset cannot establish whether the new counter overlaps earlier requests.
          state.partial=true;state.counterReset=true;return;
        }
        delta={input:counts.input-previous.input,cached:counts.cached-previous.cached,output:counts.output-previous.output,
          total:counts.total-previous.total,cacheWrite:counts.cacheWrite!==null&&previous.cacheWrite!==null?counts.cacheWrite-previous.cacheWrite:null};
        if(delta.cached>delta.input||delta.cacheWrite!==null&&(delta.cacheWrite<0||delta.cached+delta.cacheWrite>delta.input)){
          state.partial=true;state.previous=counts;return;
        }
      } else if(!last||last.input!==counts.input||last.cached!==counts.cached||last.output!==counts.output){
        state.partial=true;
        // Truncated/resumed logs may begin with a lifetime total. Count only the last proven request.
        if(last&&last.input<=counts.input&&last.output<=counts.output)delta=last;
        else {state.previous=counts;return;}
      }
      requestInput=last&&last.input===delta.input&&last.output===delta.output?last.input:null;
      state.previous=counts;
    }
    if(at<state.from||state.until!==null&&at>state.until)return;
    if(delta.total===0)return; // Duplicate cumulative notification.
    add(cumulative?state.cumulative:state.records,{...delta,at,model:cumulative&&requestInput===null?null:validModel(payload.model)??state.model,requestInput});
  }catch{state.partial=true;}
}

/** One bounded read. Checkpoints contain only counters, models and file metadata, never log text. */
export async function readUsageChunk(path:string,home:string,threadId:string,previous:Checkpoint|null,maxBytes:number,from=0,until:number|null=null):Promise<{checkpoint:Checkpoint;snapshot:UsageSnapshot;done:boolean}> {
  const actual=await realpath(path);
  if(!["sessions","archived_sessions"].some(dir=>actual.startsWith(resolve(home,dir)+sep)))throw new Error("usage_path_outside_sessions");
  const file=await open(actual,"r");
  try {
    const stat=await file.stat();
    if(!stat.isFile())throw new Error("usage_source_not_file");
    const prefixBytes=previous?.prefixBytes??Math.min(stat.size,4096);
    const prefixBuffer=Buffer.alloc(prefixBytes);
    await file.read(prefixBuffer,0,prefixBytes,0);
    const prefix=createHash("sha256").update(prefixBuffer).digest("hex");
    const changed=!previous||previous.parserVersion!==USAGE_PARSER_VERSION||previous.from!==from||previous.until!==until||previous.ino!==stat.ino||previous.prefix!==prefix||stat.size<previous.size||
      previous.size===stat.size&&previous.mtime!==stat.mtimeMs;
    const state:Checkpoint=changed?{parserVersion:USAGE_PARSER_VERSION,offset:0,ino:stat.ino,prefix,prefixBytes,mtime:stat.mtimeMs,size:stat.size,model:null,previous:null,
      counterReset:false,cumulative:empty(),records:empty(),partial:false,skipLine:false,identity:false,from,until,mismatch:false,turns:[]}:structuredClone(previous);
    state.size=stat.size;state.mtime=stat.mtimeMs;
    const buffer=Buffer.alloc(Math.min(maxBytes,Math.max(0,stat.size-state.offset)));
    const {bytesRead}=await file.read(buffer,0,buffer.length,state.offset);
    let start=0;
    for(let i=0;i<bytesRead;i++)if(buffer[i]===10){
      if(!state.skipLine)parse(buffer.subarray(start,i).toString("utf8"),state,threadId);
      state.skipLine=false;state.offset+=i+1-start;start=i+1;
    }
    // A line larger than the chunk cannot monopolize collection; discard it, with explicit partial coverage.
    if(start===0&&bytesRead===maxBytes){state.offset+=bytesRead;state.skipLine=true;state.partial=true;}
    if(state.mismatch)throw new Error("usage_thread_mismatch");
    const stream=state.cumulative.events?state.cumulative:state.records;
    const total=(stream:Stream,key:"input"|"cached"|"output")=>stream.models.reduce((sum,row)=>sum+row[key],0);
    const disagree=state.cumulative.events>0&&state.records.events>0&&(["input","cached","output"] as const).some(key=>total(state.cumulative,key)!==total(state.records,key));
    const done=state.offset===stat.size&&!state.skipLine;
    const starts=state.turns.flatMap(turn=>turn.start===null?[]:[turn.start]);
    const ends=state.turns.flatMap(turn=>turn.end===null?[]:[turn.end]);
    const elapsedMs=starts.length&&starts.length===state.turns.length&&ends.length===state.turns.length&&state.turns.every(turn=>turn.end!>=turn.start!)?Math.max(...ends)-Math.min(...starts):null;
    const outcome=state.turns.at(-1)?.outcome??null;
    const snapshot:UsageSnapshot={attempts:state.turns.length||null,elapsedMs,outcome,...(state.identity?stream:empty()),partial:state.partial||disagree||!state.identity||!done||state.turns.some(turn=>turn.end===null),
      rateDate:API_RATE_DATE,rateSource:API_RATE_SOURCE,parserVersion:USAGE_PARSER_VERSION};
    return {checkpoint:state,snapshot,done};
  }finally{await file.close();}
}
