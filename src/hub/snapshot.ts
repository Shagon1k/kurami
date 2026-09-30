import {execFileSync} from "node:child_process";
import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {parse} from "yaml";
import {resolveKuramiHome} from "../core/kurami-home.ts";
import {collectCodexSnapshot,type CodexSnapshot} from "./codex.ts";

type ProjectConfig={
  owner:string;project_number:number;repository:string;
  statuses:{backlog:string;active:string;review:string;done:string;deferred:string};
  workspace:{canonical_repository:string;base_branch:string};
};
type Registry={projects:Record<string,ProjectConfig>};
type PollRow={project:string;last_captured_at:string;last_attempt_state:string|null};
type CountRow={project:string;status:string|null;n:number};
type RunRow={project:string;state:string;n:number};
type CiRow={project:string;aggregate_state:string;n:number};

export type Week={start:string;count:number};
export type HubProject={
  key:string;name:string;repository:string;boardUrl:string;
  managed:boolean;board:{backlog:number;active:number;review:number;done:number;deferred:number}|null;
  runs:{working:number;attention:number;ciFailed:number}|null;
  poll:{capturedAt:string|null;state:"fresh"|"stale"|"unavailable"};
  git:{commits7:number;commits30:number;latestAt:string|null;state:"available"|"unavailable"};
};
export type HubSnapshot={
  generatedAt:string;projects:HubProject[];weeks:Week[];
  codex:CodexSnapshot;
  totals:{working:number;review:number;attention:number;commits30:number};
  sources:{orchestrator:"available"|"unavailable";git:"available"|"partial"|"unavailable"};
};

const appRoot=resolve(import.meta.dirname,"../..");
const fallbackHome=resolve(appRoot,"..");
const displayNames:Record<string,string>={
  pickflick:"PickFlick",tailortales:"TailorTales","ahurynovich-cv":"AHurynovich-CV",
};

function validConfig(value:unknown):value is ProjectConfig {
  if(!value||typeof value!=="object")return false;
  const item=value as Partial<ProjectConfig>;
  return typeof item.owner==="string"&&Number.isInteger(item.project_number)&&
    typeof item.repository==="string"&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.repository)&&
    Boolean(item.statuses&&["backlog","active","review","done","deferred"].every(key=>typeof item.statuses?.[key as keyof ProjectConfig["statuses"]]==="string"))&&
    typeof item.workspace?.canonical_repository==="string"&&typeof item.workspace.base_branch==="string";
}

function registry(path:string):Record<string,ProjectConfig> {
  const raw=parse(readFileSync(path,"utf8")) as Registry;
  if(!raw||!raw.projects||typeof raw.projects!=="object"||!Object.values(raw.projects).every(validConfig))throw new Error("Invalid Hub project registry");
  return raw.projects;
}

function dateMs(value:string|null):number|null {
  if(!value)return null;
  const result=Date.parse(value);
  return Number.isFinite(result)?result:null;
}

function mondayUtc(date:Date):Date {
  const result=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  result.setUTCDate(result.getUTCDate()-((result.getUTCDay()+6)%7));
  return result;
}

function gitHistory(path:string,branch:string,now:Date):{dates:number[];latestAt:string|null;state:"available"|"unavailable"} {
  if(!existsSync(path)||!/^[A-Za-z0-9._/-]+$/.test(branch))return {dates:[],latestAt:null,state:"unavailable"};
  try {
    const latestAt=execFileSync("git",["-C",path,"log","-1","--format=%cI",branch],{encoding:"utf8",timeout:4_000}).trim()||null;
    const since=new Date(now.getTime()-91*86_400_000).toISOString();
    const output=execFileSync("git",["-C",path,"log",branch,`--since=${since}`,"--format=%cI"],{encoding:"utf8",timeout:4_000,maxBuffer:2_000_000});
    const dates=output.split("\n").map(dateMs).filter((value):value is number=>value!==null&&value<=now.getTime());
    return {dates,latestAt,state:"available"};
  } catch {return {dates:[],latestAt:null,state:"unavailable"};}
}

export function collectHubSnapshot(options:{home?:string;appRepository?:string;codexHome?:string;now?:Date}={}):HubSnapshot {
  const now=options.now??new Date();
  const home=options.home??resolveKuramiHome(fallbackHome);
  const config=registry(resolve(home,"config/projects.yaml"));
  const keys=Object.keys(config).sort((a,b)=>{
    const order=["pickflick","tailortales","ahurynovich-cv"];
    const ai=order.indexOf(a),bi=order.indexOf(b);
    return (ai<0?order.length:ai)-(bi<0?order.length:bi)||a.localeCompare(b);
  });
  const counts=new Map<string,Map<string,number>>();
  const runs=new Map<string,Map<string,number>>();
  const ci=new Map<string,Map<string,number>>();
  const polls=new Map<string,PollRow>();
  let orchestrator:"available"|"unavailable"="unavailable";
  const dbPath=resolve(home,"state/orchestrator.db");
  if(existsSync(dbPath)) {
    try {
      const db=new DatabaseSync(dbPath,{readOnly:true,timeout:1_000});
      try {
        for(const row of db.prepare("SELECT project,status,count(*) n FROM project_items WHERE present=1 GROUP BY project,status").all() as CountRow[]){
          const values=counts.get(row.project)??new Map();values.set(row.status??"",row.n);counts.set(row.project,values);
        }
        for(const row of db.prepare("SELECT project,state,count(*) n FROM runs GROUP BY project,state").all() as RunRow[]){
          const values=runs.get(row.project)??new Map();values.set(row.state,row.n);runs.set(row.project,values);
        }
        for(const row of db.prepare("SELECT runs.project project,ci.aggregate_state aggregate_state,count(*) n FROM run_ci_snapshots ci JOIN runs USING(run_id) GROUP BY runs.project,ci.aggregate_state").all() as CiRow[]){
          const values=ci.get(row.project)??new Map();values.set(row.aggregate_state,row.n);ci.set(row.project,values);
        }
        for(const row of db.prepare("SELECT project,last_captured_at,last_attempt_state FROM project_poll_state").all() as PollRow[])polls.set(row.project,row);
        orchestrator="available";
      } finally {db.close();}
    } catch {orchestrator="unavailable";}
  }
  const allDates:number[]=[];
  const projects:HubProject[]=keys.map(key=>{
    const item=config[key]!;
    const status=counts.get(key);
    const states=runs.get(key);
    const poll=polls.get(key);
    const capturedAt=poll?.last_captured_at??null;
    const capturedMs=dateMs(capturedAt);
    const pollState=orchestrator==="unavailable"||!poll?"unavailable":
      poll.last_attempt_state==="succeeded"&&capturedMs!==null&&now.getTime()-capturedMs<15*60_000?"fresh":"stale";
    const git=gitHistory(item.workspace.canonical_repository,item.workspace.base_branch,now);
    allDates.push(...git.dates);
    return {
      key,name:displayNames[key]??key,repository:item.repository,
      boardUrl:`https://github.com/users/${encodeURIComponent(item.owner)}/projects/${item.project_number}`,
      managed:true,
      board:orchestrator==="available"&&poll?{
        backlog:status?.get(item.statuses.backlog)??0,active:status?.get(item.statuses.active)??0,
        review:status?.get(item.statuses.review)??0,done:status?.get(item.statuses.done)??0,
        deferred:status?.get(item.statuses.deferred)??0,
      }:null,
      runs:orchestrator==="available"?{
        working:["starting","running","handoff_pending","remote_owned"].reduce((sum,state)=>sum+(states?.get(state)??0),0),
        attention:["waiting_human","needs_attention"].reduce((sum,state)=>sum+(states?.get(state)??0),0),
        ciFailed:(ci.get(key)?.get("failed")??0)+(ci.get(key)?.get("missing")??0),
      }:null,
      poll:{capturedAt,state:pollState},
      git:{commits7:git.dates.filter(value=>value>=now.getTime()-7*86_400_000).length,
        commits30:git.dates.filter(value=>value>=now.getTime()-30*86_400_000).length,
        latestAt:git.latestAt,state:git.state},
    };
  });
  const kuramiGit=gitHistory(options.appRepository??appRoot,"main",now);
  allDates.push(...kuramiGit.dates);
  projects.push({key:"kurami",name:"Kurami",repository:"Shagon1k/Kurami",boardUrl:"https://github.com/Shagon1k/Kurami",
    managed:false,board:null,runs:null,poll:{capturedAt:null,state:"unavailable"},
    git:{commits7:kuramiGit.dates.filter(value=>value>=now.getTime()-7*86_400_000).length,
      commits30:kuramiGit.dates.filter(value=>value>=now.getTime()-30*86_400_000).length,
      latestAt:kuramiGit.latestAt,state:kuramiGit.state}});
  const start=mondayUtc(now);
  start.setUTCDate(start.getUTCDate()-11*7);
  const weeks:Week[]=Array.from({length:12},(_,index)=>{
    const week=new Date(start);week.setUTCDate(week.getUTCDate()+index*7);
    const next=new Date(week);next.setUTCDate(next.getUTCDate()+7);
    return {start:week.toISOString().slice(0,10),count:allDates.filter(value=>value>=week.getTime()&&value<next.getTime()).length};
  });
  const availableGit=projects.filter(project=>project.git.state==="available").length;
  return {generatedAt:now.toISOString(),projects,weeks,codex:collectCodexSnapshot({home:options.codexHome,now}),
    totals:{working:projects.reduce((sum,project)=>sum+(project.runs?.working??0),0),
      review:projects.reduce((sum,project)=>sum+(project.board?.review??0),0),
      attention:projects.reduce((sum,project)=>sum+(project.runs?.attention??0),0),
      commits30:projects.reduce((sum,project)=>sum+project.git.commits30,0)},
    sources:{orchestrator,git:availableGit===0?"unavailable":availableGit===projects.length?"available":"partial"}};
}
