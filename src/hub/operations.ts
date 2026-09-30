import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import type {HealthSurfaceSnapshot} from "../system/health/health-snapshot.ts";
import {readHealthStatus} from "../system/health/health-read-model.ts";
import {readSystemActivity} from "../core/activity.ts";
import {collectCodexActivity} from "./codex.ts";
import {parse} from "yaml";
import {projectRunStatus,readProjectStatus,type ProjectStatusReadModel} from "../orchestrator/projects/status-read-model.ts";
import {settingsSchema} from "../orchestrator/settings/settings-schema.ts";
import {codexLaunchUrl} from "../orchestrator/integrations/codex/deeplink.ts";
import {localDay} from "../core/codex-usage.ts";

export type HubAlert={id:string;severity:"warning"|"critical";code:string;subject:string;href?:string;group?:string;project?:string;title?:string;prNumber?:number;task?:boolean;next?:ProblemNext;actor?:"owner"|"agent"|"system";detail?:string};
export type ProblemNext="start_repair"|"wait_repair"|"reply"|"inspect_task"|"check_collector"|"check_project"|"inspect_health"|"restore_db";
export type HubActivity={id:string;at:string;source:string;subject:string;event:string;href?:string;group?:string;project?:string;agent?:string;sessionId?:string;result?:string;taskState?:string};
export type HubOperations={health:HealthSurfaceSnapshot|null;healthStale:boolean;alerts:HubAlert[];activity:HubActivity[]};

function json(path:string):any {try{return JSON.parse(readFileSync(path,"utf8"));}catch{return null;}}
function readRows(path:string,query:string,params:(string|number)[]=[]):any[] {
  if(!existsSync(path))return [];
  let db:DatabaseSync|undefined;
  try {db=new DatabaseSync(path,{readOnly:true,timeout:500});return db.prepare(query).all(...params);}
  catch{return [];}
  finally{db?.close();}
}
const short=(value:unknown)=>String(value??"").replace(/[\x00-\x1f]/g," ").slice(0,120);
const iso=(seconds:number)=>new Date(seconds*1000).toISOString();
const safeLink=(value:unknown)=>typeof value==="string"&&/^https:\/\/github\.com\/[A-Za-z0-9_./-]+$/.test(value)?value:undefined;

export function collectHubOperations(home:string,codexHome:string,hermesHome:string,now:Date,projectStatus?:ProjectStatusReadModel):HubOperations {
  const {health,active}=readHealthStatus(home);
  const cadence=json(resolve(home,"state/health-settings.json"))?.intervalMinutes;
  const interval=settingsSchema.health.allowedIntervals.includes(cadence)?cadence:settingsSchema.health.defaultIntervalMinutes;
  const healthStale=!health||now.getTime()-Date.parse(health.checkedAt)>Math.max(15,interval*2+5)*60_000;
  const alerts:HubAlert[]=[];
  if(healthStale)alerts.push({id:"health-stale",severity:"warning",code:health?"health_stale":"health_unavailable",subject:"System Health"});
  for(const [key,value] of Object.entries(active)){
    if(!value||typeof value!=="object")continue;
    const issue=value as {severity?:string;message?:string};
    if(!["warning","critical"].includes(issue.severity??"")||typeof issue.message!=="string")continue;
    alerts.push({id:key,severity:issue.severity as "warning"|"critical",code:"health_issue",subject:short(issue.message)});
  }
  const dbPath=resolve(home,"state/orchestrator.db");
  if(!projectStatus){
    try {projectStatus=readProjectStatus(dbPath,parse(readFileSync(resolve(home,"config/projects.yaml"),"utf8")).projects,now);}
    catch {projectStatus={available:false,runs:[],projects:{}};}
  }
  if(!projectStatus.available)alerts.push({id:"project-state-unavailable",severity:"warning",code:"orchestrator_unavailable",subject:"Project Orchestrator"});
  const prefixes={run_attention:"run",owner_input:"owner",ci_unrepaired:"ci",review_unrepaired:"review"};
  const metadata=new Map(readRows(dbPath,`SELECT r.run_id,r.project,r.issue_number,r.state,p.title,ci.pull_request_number,ci.pull_request_title,ci.checks_json FROM runs r LEFT JOIN project_items p ON p.project=r.project AND p.item_id=r.item_id LEFT JOIN run_ci_snapshots ci USING(run_id)`).map(row=>[row.run_id,row]));
  for(const row of projectStatus.runs){
    const subject=`${short(row.project)} #${row.issue_number}`;
    const href=safeLink(row.pull_request_url)??safeLink(`https://github.com/${row.repository}/issues/${row.issue_number}`);
    const status=projectRunStatus(row),info=metadata.get(row.run_id);
    for(const issue of status.attention){
      const busy=status.ciRepairCurrent||status.reviewFixBusy;
      const ownerAction=issue.code==="owner_input"?"reply":issue.code==="run_attention"||status.ciRepairBusy&&!status.ciRepairCurrent?"inspect_task":undefined;
      let checks:string|undefined;
      if(issue.code==="ci_unrepaired"){try{const parsed=JSON.parse(info?.checks_json??"[]");if(Array.isArray(parsed))checks=parsed.filter(check=>["failed","missing"].includes(check?.state)&&typeof check?.name==="string").slice(0,3).map(check=>short(check.name)).join(", ")||undefined;}catch{}}
      alerts.push({id:`${prefixes[issue.code]}-${row.run_id}`,...issue,subject,href,group:href??`task:${row.project}:${row.issue_number}`,project:row.project,task:true,title:short(info?.title||info?.pull_request_title),prNumber:info?.pull_request_number,
        actor:ownerAction?"owner":busy?"agent":"owner",next:ownerAction??(busy?"wait_repair":"start_repair"),
        detail:issue.code==="review_unrepaired"?String(status.majorFindings):checks});
    }
  }
  const cutoff=new Date(now.getTime()-7*86400_000).toISOString();
  const runContext=(runId:string)=>{
    const row=metadata.get(runId)??projectStatus.runs.find(run=>run.run_id===runId);
    const current=row&&projectStatus.runs.find(run=>run.project===row.project&&run.issue_number===row.issue_number);
    return row?{group:`task:${row.project}:${row.issue_number}`,project:short(row.project),agent:"Codex",taskState:current?.run_state??row.state,subject:short(row.title||row.pull_request_title||`Task #${row.issue_number}`)}:{};
  };
  const activity:HubActivity[]=readRows(dbPath,`SELECT h.sequence,h.run_id,h.occurred_at,h.to_state,r.project,r.issue_number,r.repository FROM run_state_history h JOIN runs r USING(run_id) WHERE h.occurred_at>=? ORDER BY h.sequence DESC LIMIT 150`,[cutoff]).map(row=>({
    id:`run-${row.sequence}`,at:row.occurred_at,source:"Projects",subject:`${short(row.project)} #${row.issue_number}`,event:short(row.to_state),href:safeLink(`https://github.com/${row.repository}/issues/${row.issue_number}`),...runContext(row.run_id)}));
  for(const row of readRows(dbPath,`SELECT run_id,aggregate_state,COALESCE(completed_at,first_observed_at) AS at,pull_request_title,pull_request_url FROM run_ci_snapshots WHERE COALESCE(completed_at,first_observed_at)>=? ORDER BY at DESC LIMIT 100`,[cutoff]))activity.push({id:`ci-${row.run_id}`,at:row.at,source:"CI",subject:short(row.pull_request_title),event:short(row.aggregate_state),href:safeLink(row.pull_request_url),result:`CI:${short(row.aggregate_state)}`,...runContext(row.run_id)});
  for(const row of readRows(dbPath,`SELECT review_id,run_id,review_state,updated_at,pull_request_number,pull_request_url,critical_count,important_count FROM run_ai_reviews WHERE updated_at>=? ORDER BY updated_at DESC LIMIT 100`,[cutoff]))activity.push({id:`review-${row.review_id}`,at:row.updated_at,source:"AI Review",subject:`PR #${row.pull_request_number}`,event:short(row.review_state),href:safeLink(row.pull_request_url),result:row.review_state==="ready"?`Review:${row.critical_count+row.important_count}`:undefined,...runContext(row.run_id)});
  for(const row of readRows(resolve(codexHome,"state_5.sqlite"),`SELECT id,title,created_at FROM threads WHERE created_at>=? ORDER BY created_at DESC LIMIT 100`,[Math.floor(Date.parse(cutoff)/1000)]))activity.push({id:`codex-${row.id}`,sessionId:row.id,group:`codex:${row.id}`,agent:"Codex",at:iso(row.created_at),source:"Codex",subject:short(row.title),event:"session_started"});
  for(const row of readRows(resolve(hermesHome,"state.db"),`SELECT id,title,source,started_at FROM sessions WHERE started_at>=? ORDER BY started_at DESC LIMIT 100`,[Date.parse(cutoff)/1000]))activity.push({id:`hermes-${row.id}`,sessionId:row.id,group:`hermes:${row.id}`,agent:"Hermes",at:iso(row.started_at),source:"Hermes",subject:short(row.title||row.source),event:"session_started"});
  for(const row of readRows(resolve(home,"state/briefing/briefing.db"),`SELECT attempt_id,edition_id,state,updated_at FROM briefing_run_attempts WHERE updated_at>=? ORDER BY updated_at DESC LIMIT 10`,[cutoff]))activity.push({id:`digest-${row.attempt_id}`,at:row.updated_at,source:"Digest",subject:short(row.edition_id),event:short(row.state)});
  let cinemaLinked=false;
  for(const row of readRows(resolve(home,"state/briefing/briefing.db"),`SELECT id,edition_type,local_date,published_at FROM editions WHERE published_at>=? ORDER BY published_at DESC LIMIT 10`,[cutoff])){
    const cinema=row.edition_type==="cinema";
    const href=cinema?(cinemaLinked?undefined:"https://digest.shagon1k.win/en/cinema"):/^\d{4}-\d{2}-\d{2}$/.test(row.local_date)?`https://digest.shagon1k.win/en/daily/${row.local_date}`:undefined;
    if(cinema)cinemaLinked=true;
    activity.push({id:`edition-${row.id}`,at:row.published_at,source:cinema?"Cinema":"Daily",subject:short(row.local_date),event:"published",href});
  }
  for(const row of readRows(resolve(home,"state/briefing/briefing.db"),`SELECT addon_id,state,captured_at FROM addon_snapshots WHERE captured_at>=? AND addon_id IN ('weekly','stocks','cinema') ORDER BY captured_at DESC`,[cutoff]))activity.push({id:`addon-${row.addon_id}-${row.captured_at}`,at:row.captured_at,source:short(row.addon_id),subject:"",event:short(row.state)});
  activity.push(...readSystemActivity(home,cutoff),...collectCodexActivity(codexHome,now));
  const links=[["run_resources","codex_thread_id"],["run_resources","previous_codex_thread_id"],["run_ai_reviews","codex_thread_id"],["run_ci_repair_attempts","codex_thread_id"],["run_review_fix_rounds","codex_thread_id"],["run_autonomous_successions","predecessor_thread_id"],["run_autonomous_successions","successor_thread_id"]].flatMap(([table,column])=>readRows(dbPath,`SELECT run_id,${column} AS thread_id FROM ${table} WHERE ${column} IS NOT NULL`));
  const owners=new Map<string,Map<string,ReturnType<typeof runContext>>>();
  for(const link of links){if(!link.thread_id)continue;const context=runContext(link.run_id);if(!context.group)continue;const owner=owners.get(link.thread_id)??new Map();owner.set(context.group,context);owners.set(link.thread_id,owner);}
  for(const item of activity){
    if(item.sessionId&&item.agent==="Codex"){const owner=owners.get(item.sessionId);if(owner?.size===1)Object.assign(item,[...owner.values()][0]);}
    if(item.sessionId&&item.agent==="Codex"&&!item.href)item.href=codexLaunchUrl(item.sessionId)??undefined;
    if(["Cinema","Daily","Digest","weekly","stocks","cinema"].includes(item.source)){
      const date=item.subject.match(/\d{4}-\d{2}-\d{2}/)?.[0]??localDay(Date.parse(item.at));
      const category=item.source==="Digest"?(item.subject.startsWith("cinema:")?"Cinema":"Daily"):item.source;
      item.group=`digest:${category.toLowerCase()}:${date??item.id}`;item.project="digest";item.agent="Kurami";
      item.subject=category[0]!.toUpperCase()+category.slice(1).toLowerCase()+" · "+date;
    }
  }
  return {health,healthStale,alerts:alerts.sort((a,b)=>Number(b.severity==="critical")-Number(a.severity==="critical")),
    activity:activity.filter(item=>Number.isFinite(Date.parse(item.at))&&Date.parse(item.at)<=now.getTime()).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,1000)};
}
