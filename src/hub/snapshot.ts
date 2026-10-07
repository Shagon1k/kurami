import {execFileSync} from "node:child_process";
import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {homedir} from "node:os";
import {collectHubOperations,type HubOperations} from "./operations.ts";
import {parse} from "yaml";
import {resolveKuramiHome} from "../core/kurami-home.ts";
import {collectCodexSnapshot,type CodexSnapshot} from "./codex.ts";
import {readProjectStatus} from "../orchestrator/projects/status-read-model.ts";
import {readProjectUsage,type ProjectUsage} from "../orchestrator/projects/usage-read-model.ts";
import {readThreadUsage} from "../core/codex-usage.ts";

type ProjectConfig={
  owner:string;project_number:number;repository:string;
  statuses:{backlog:string;active:string;review:string;done:string;deferred:string};
  workspace:{canonical_repository:string;base_branch:string};
};
type Registry={projects:Record<string,ProjectConfig>};

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
  operations?:HubOperations;
  usage?:ProjectUsage;
  commitDays?:Week[];
  commitRepositories?:Record<string,Week[]>;
  totals:{working:number;review:number;attention:number;commits30:number};
  sources:{orchestrator:"available"|"unavailable";git:"available"|"partial"|"unavailable"};
};

const appRoot=resolve(import.meta.dirname,"../..");
const fallbackHome=resolve(appRoot,"..");

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
  // Registry order is the display order (src/core/projects-registry.ts).
  const keys=Object.keys(config);
  const dbPath=resolve(home,"state/orchestrator.db");
  const projectStatus=readProjectStatus(dbPath,config,now);
  const orchestrator=projectStatus.available?"available":"unavailable";
  const allDates:number[]=[];
  const repositoryDates:Record<string,number[]>={};
  const projects:HubProject[]=keys.map(key=>{
    const item=config[key]!;
    const status=projectStatus.projects[key];
    const git=gitHistory(item.workspace.canonical_repository,item.workspace.base_branch,now);
    allDates.push(...git.dates);
    repositoryDates[key]=git.dates;
    return {
      key,name:item.repository.split("/")[1]??key,repository:item.repository,
      boardUrl:`https://github.com/users/${encodeURIComponent(item.owner)}/projects/${item.project_number}`,
      managed:true,
      board:status&&status.poll.state!=="unavailable"?status.board:null,
      runs:status?.runs??null,
      poll:status?.poll??{capturedAt:null,state:"unavailable"},
      git:{commits7:git.dates.filter(value=>value>=now.getTime()-7*86_400_000).length,
        commits30:git.dates.filter(value=>value>=now.getTime()-30*86_400_000).length,
        latestAt:git.latestAt,state:git.state},
    };
  });
  const kuramiGit=gitHistory(options.appRepository??appRoot,"main",now);
  allDates.push(...kuramiGit.dates);
  repositoryDates.kurami=kuramiGit.dates;
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
  const codexHome=options.codexHome??process.env.HUB_CODEX_HOME??process.env.CODEX_HOME??resolve(homedir(),".codex");
  const operations=collectHubOperations(home,codexHome,process.env.HERMES_HOME??"/home/shagon1k/_hermes/_core",now,projectStatus);
  for(const project of projects.filter(project=>project.managed&&project.poll.state!=="fresh"))operations.alerts.push({id:`poll-${project.key}`,severity:"warning",code:"poll_stale",subject:project.name,href:project.boardUrl});
  const cutoff=now.getTime()-30*86_400_000;
  const dailyCounts=(dates:number[])=>Array.from({length:30},(_,index)=>{
    const start=cutoff+index*86_400_000,end=start+86_400_000;
    return {start:new Date(start).toISOString(),count:dates.filter(at=>at>=start&&(index===29?at<=end:at<end)).length};
  });
  const commitDays=dailyCounts(allDates),commitRepositories=Object.fromEntries(Object.entries(repositoryDates).map(([key,dates])=>[key,dailyCounts(dates)]));
  const usage=readProjectUsage(dbPath,keys,now,(ids,until)=>readThreadUsage(codexHome,ids,until));
  return {generatedAt:now.toISOString(),projects,weeks,commitDays,commitRepositories,usage,codex:collectCodexSnapshot({home:codexHome,now}),operations,
    totals:{working:projects.reduce((sum,project)=>sum+(project.runs?.working??0),0),
      review:projects.reduce((sum,project)=>sum+(project.board?.review??0),0),
      attention:projects.reduce((sum,project)=>sum+(project.runs?.attention??0),0),
      commits30:projects.reduce((sum,project)=>sum+project.git.commits30,0)},
    sources:{orchestrator,git:availableGit===0?"unavailable":availableGit===projects.length?"available":"partial"}};
}
