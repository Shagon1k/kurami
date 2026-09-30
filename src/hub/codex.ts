import {homedir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {scanFile,pruneUsageCache,type CodexLimit} from "../core/codex-usage.ts";
export type {CodexLimit} from "../core/codex-usage.ts";
import type {CodexAccountSnapshot} from "./codex-account.ts";
import {summarizeModelUsage,type ModelUsage,type ApiEquivalent,type UsageSample} from "../core/api-equivalent.ts";
import {dailyLimitHistory,type LimitDay} from "./limit-history.ts";
import type {LimitObservation} from "../core/codex-usage.ts";

type ThreadRow={created_at:number;updated_at:number;model:string|null;rollout_path:string|null};
export type CodexSnapshot={
  state:"available"|"unavailable";
  tokens7:number|null;tokens30:number|null;cached30:number|null;output30:number|null;
  sessions30:number|null;models:{name:string;sessions:number}[];
  limits:CodexLimit[];updatedAt:string|null;
  coverage:"complete"|"partial"|"unavailable";
  account?:CodexAccountSnapshot;
  limitHistory?:LimitDay[];
  periods?:Record<7|30,{tokens:number|null;cached:number|null;output:number|null;sessions:number;models:{name:string;sessions:number}[];modelUsage?:ModelUsage[];equivalent?:ApiEquivalent}>;
};

const unavailable:CodexSnapshot={state:"unavailable",tokens7:null,tokens30:null,cached30:null,output30:null,sessions30:null,models:[],limits:[],updatedAt:null,coverage:"unavailable"};

export function collectCodexActivity(home:string,now:Date):{id:string;at:string;source:string;subject:string;event:string;sessionId:string;group:string;agent:string}[] {
  let db:DatabaseSync|undefined;
  try {
    db=new DatabaseSync(resolve(home,"state_5.sqlite"),{readOnly:true,timeout:500});
    const cutoff=now.getTime()-7*86400_000;
    const rows=db.prepare("SELECT id,title,name,rollout_path FROM threads WHERE updated_at>=? ORDER BY updated_at DESC LIMIT 100").all(cutoff/1000) as {id:string;title:string;name:string|null;rollout_path:string|null}[];
    return rows.flatMap(row=>{
      const cache=row.rollout_path?scanFile(row.rollout_path,home):null;
      return (cache?.activity??[]).filter(event=>event.at>=cutoff&&event.at<=now.getTime()).map(event=>({id:`codex-turn-${row.id}-${event.at}-${event.event}`,sessionId:row.id,group:`codex:${row.id}`,agent:"Codex",at:new Date(event.at).toISOString(),source:"Codex",subject:(row.name||row.title||"").slice(0,120),event:event.event}));
    }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,400);
  }catch{return [];}
  finally{db?.close();}
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
    let total7=0,total30=0,cached7=0,output7=0,cached30=0,output30=0,scanned=0,missing=0,foundEvents=0;
    let newest:{at:number;limits:CodexLimit[]}|null=null;
    const samples:UsageSample[]=[];
    const limitsByDay:LimitObservation[]=[];
    for(const row of rows){
      const file=row.rollout_path?scanFile(row.rollout_path,home):null;
      if(!file){missing++;continue;}
      scanned++;
      limitsByDay.push(...[...file.limitDays.values()].filter(sample=>sample.at>=cutoff30&&sample.at<=now.getTime()));
      const events=file.events.length?file.events:file.recordEvents;
      if(!events.length&&row.created_at*1000>=cutoff30)missing++;
      for(const event of events){
        if(event.at<cutoff30||event.at>now.getTime())continue;
        foundEvents++;
        samples.push({event,session:row.rollout_path!});
        total30+=event.total;cached30+=event.cached;output30+=event.output;
        if(event.at>=cutoff7){total7+=event.total;cached7+=event.cached;output7+=event.output;}
      }
      if(file.limit&&(!newest||file.limit.at>newest.at))newest=file.limit;
    }
    const latest=rows.length?new Date(Math.max(...rows.map(row=>row.updated_at))*1000).toISOString():null;
    const hasUsage=scanned>0&&foundEvents>0;
    pruneUsageCache();
    return {state:"available",tokens7:hasUsage?total7:null,tokens30:hasUsage?total30:null,cached30:hasUsage?cached30:null,output30:hasUsage?output30:null,
      sessions30:sessions.length,models,limits:newest?.limits.filter(limit=>Date.parse(limit.resetsAt)>now.getTime())??[],limitHistory:dailyLimitHistory(limitsByDay,now),updatedAt:latest,
      coverage:hasUsage?(missing||rows.length===3000?"partial":"complete"):"unavailable",
      periods:Object.fromEntries(([7,30] as const).map(days=>{
        const selected=sessions.filter(row=>row.created_at*1000>=now.getTime()-days*86_400_000);
        const counts=new Map<string,number>();
        for(const row of selected)if(row.model)counts.set(row.model,(counts.get(row.model)??0)+1);
        const usage=summarizeModelUsage(samples.filter(sample=>sample.event.at>=now.getTime()-days*86_400_000));
        return [days,{tokens:hasUsage?(days===7?total7:total30):null,cached:hasUsage?(days===7?cached7:cached30):null,
          output:hasUsage?(days===7?output7:output30):null,sessions:selected.length,
          models:[...counts].map(([name,sessions])=>({name,sessions})).sort((a,b)=>b.sessions-a.sessions||a.name.localeCompare(b.name)).slice(0,5),
          modelUsage:usage.models,equivalent:usage.equivalent}];
      })) as NonNullable<CodexSnapshot["periods"]>};
  } catch {return {...unavailable};}
  finally {db?.close();}
}
