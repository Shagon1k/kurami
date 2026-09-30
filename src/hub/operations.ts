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

export type HubAlert={id:string;severity:"warning"|"critical";code:string;subject:string;href?:string};
export type HubActivity={id:string;at:string;source:string;subject:string;event:string;href?:string};
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
  for(const row of projectStatus.runs){
    const subject=`${short(row.project)} #${row.issue_number}`;
    const href=safeLink(row.pull_request_url)??safeLink(`https://github.com/${row.repository}/issues/${row.issue_number}`);
    for(const issue of projectRunStatus(row).attention)alerts.push({id:`${prefixes[issue.code]}-${row.run_id}`,...issue,subject,href});
  }
  const cutoff=new Date(now.getTime()-7*86400_000).toISOString();
  const activity:HubActivity[]=readRows(dbPath,`SELECT h.sequence,h.occurred_at,h.to_state,r.project,r.issue_number,r.repository FROM run_state_history h JOIN runs r USING(run_id) WHERE h.occurred_at>=? ORDER BY h.sequence DESC LIMIT 20`,[cutoff]).map(row=>({
    id:`run-${row.sequence}`,at:row.occurred_at,source:"Projects",subject:`${short(row.project)} #${row.issue_number}`,event:short(row.to_state),href:safeLink(`https://github.com/${row.repository}/issues/${row.issue_number}`)}));
  for(const row of readRows(dbPath,`SELECT run_id,aggregate_state,COALESCE(completed_at,first_observed_at) AS at,pull_request_title,pull_request_url FROM run_ci_snapshots WHERE COALESCE(completed_at,first_observed_at)>=? ORDER BY at DESC LIMIT 10`,[cutoff]))activity.push({id:`ci-${row.run_id}`,at:row.at,source:"CI",subject:short(row.pull_request_title),event:short(row.aggregate_state),href:safeLink(row.pull_request_url)});
  for(const row of readRows(dbPath,`SELECT review_id,review_state,updated_at,pull_request_number,pull_request_url FROM run_ai_reviews WHERE updated_at>=? ORDER BY updated_at DESC LIMIT 10`,[cutoff]))activity.push({id:`review-${row.review_id}`,at:row.updated_at,source:"AI Review",subject:`PR #${row.pull_request_number}`,event:short(row.review_state),href:safeLink(row.pull_request_url)});
  for(const row of readRows(resolve(codexHome,"state_5.sqlite"),`SELECT id,title,created_at FROM threads WHERE created_at>=? ORDER BY created_at DESC LIMIT 20`,[Math.floor(Date.parse(cutoff)/1000)]))activity.push({id:`codex-${row.id}`,at:iso(row.created_at),source:"Codex",subject:short(row.title),event:"session_started"});
  for(const row of readRows(resolve(hermesHome,"state.db"),`SELECT id,title,source,started_at FROM sessions WHERE started_at>=? ORDER BY started_at DESC LIMIT 20`,[Date.parse(cutoff)/1000]))activity.push({id:`hermes-${row.id}`,at:iso(row.started_at),source:"Hermes",subject:short(row.title||row.source),event:"session_started"});
  for(const row of readRows(resolve(home,"state/briefing/briefing.db"),`SELECT attempt_id,edition_id,state,updated_at FROM briefing_run_attempts WHERE updated_at>=? ORDER BY updated_at DESC LIMIT 10`,[cutoff]))activity.push({id:`digest-${row.attempt_id}`,at:row.updated_at,source:"Digest",subject:short(row.edition_id),event:short(row.state)});
  for(const row of readRows(resolve(home,"state/briefing/briefing.db"),`SELECT id,edition_type,local_date,published_at FROM editions WHERE published_at>=? ORDER BY published_at DESC LIMIT 10`,[cutoff]))activity.push({id:`edition-${row.id}`,at:row.published_at,source:row.edition_type==="cinema"?"Cinema":"Daily",subject:short(row.local_date),event:"published"});
  for(const row of readRows(resolve(home,"state/briefing/briefing.db"),`SELECT addon_id,state,captured_at FROM addon_snapshots WHERE captured_at>=? AND addon_id IN ('weekly','stocks','cinema') ORDER BY captured_at DESC`,[cutoff]))activity.push({id:`addon-${row.addon_id}-${row.captured_at}`,at:row.captured_at,source:short(row.addon_id),subject:"",event:short(row.state)});
  activity.push(...readSystemActivity(home,cutoff),...collectCodexActivity(codexHome,now));
  return {health,healthStale,alerts:alerts.sort((a,b)=>Number(b.severity==="critical")-Number(a.severity==="critical")),
    activity:activity.filter(item=>Number.isFinite(Date.parse(item.at))&&Date.parse(item.at)<=now.getTime()).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,20)};
}
