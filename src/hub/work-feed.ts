import type {HubAlert,HubActivity,ProblemNext} from "./operations.ts";
export type HubProblem={id:string;subject:string;title:string;project?:string;itemId?:string;task:boolean;severity:"warning"|"critical";issues:HubAlert[];href?:string;actor:"owner"|"agent"|"system";next:ProblemNext};
export function problemQueue(alerts:HubAlert[]):HubProblem[] {
  const groups=new Map<string,HubProblem>();
  for(const alert of alerts){
    const task=["ci_unrepaired","review_unrepaired","run_attention","owner_input"].includes(alert.code);
    const id=alert.group??(alert.code==="health_issue"||alert.code.startsWith("health_")?"system:health":task&&alert.href?`task:${alert.href}`:alert.id);
    const defaults=alert.code==="poll_stale"?"check_project":alert.code==="orchestrator_unavailable"?"restore_db":alert.code==="health_issue"?"inspect_health":alert.code==="owner_input"?"reply":alert.code==="run_attention"?"inspect_task":task?"start_repair":"check_collector";
    const group=groups.get(id)??{id,subject:id==="system:health"?"System Health":alert.subject,title:alert.title??"",project:alert.project,itemId:alert.itemId,task:alert.task??task,severity:alert.severity,issues:[],href:alert.href,actor:alert.actor??"owner",next:alert.next??defaults};
    group.itemId??=alert.itemId;
    if(alert.severity==="critical")group.severity="critical";
    if(!group.issues.some(issue=>issue.code===alert.code&&issue.subject===alert.subject))group.issues.push(alert);
    if(alert.next==="reply"||alert.next==="inspect_task"){group.next=alert.next;group.actor="owner";}
    groups.set(id,group);
  }
  return [...groups.values()].sort((a,b)=>Number(b.severity==="critical")-Number(a.severity==="critical"));
}
export type ActivitySummary=HubActivity&{durationSeconds?:number;paired?:boolean};
export function summarizeActivity(events:HubActivity[]):ActivitySummary[] {
  const starts=new Map<string,HubActivity>();const paired=new Set<string>();const summaries:ActivitySummary[]=[];
  for(const event of [...events].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))){
    const key=event.sessionId&&event.turnId?`${event.sessionId}:${event.turnId}`:null;
    if(event.event==="task_started"&&key){starts.set(key,event);continue;}
    const start=key?starts.get(key):undefined;
    if(start&&["task_complete","turn_aborted"].includes(event.event)&&Date.parse(event.at)>=Date.parse(start.at)&&!paired.has(key!)){
      summaries.push({...event,durationSeconds:Math.round((Date.parse(event.at)-Date.parse(start.at))/1000),paired:true});paired.add(key!);
    }else summaries.push(event);
  }
  for(const [key,event] of starts)if(!paired.has(key))summaries.push(event);
  return summaries.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}
export type WorkItem={id:string;at:string;subject:string;project:string;agent:string;event:string;href?:string;result?:string;events:HubActivity[];summaryEvents:ActivitySummary[];limited:boolean};
export function workFeed(events:HubActivity[]):WorkItem[] {
  const groups=new Map<string,HubActivity[]>();
  for(const event of events){
    const id=event.group??`${event.source}:${event.subject||event.id}`;
    const group=groups.get(id)??[];if(!group.some(item=>item.id===event.id))group.push(event);groups.set(id,group);
  }
  return [...groups].map(([id,items])=>{
    items.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    const latest=items[0]!;
    const state=items.find(item=>item.source==="Projects")??latest;
    const link=items.find(item=>item.href?.includes("/pull/"))??items.find(item=>item.href);
    const currentRun=latest.currentRunId??latest.runId;
    const current=items.filter(item=>!currentRun||!item.runId||item.runId===currentRun);
    const ci=current.find(item=>item.source==="CI"),review=current.find(item=>item.source==="AI Review");
    const resultEvents=current.filter((item,index)=>current.findIndex(other=>other.source===item.source)===index);
    const resultEvent=resultEvents.find(item=>item.result);
    const result=resultEvent===review&&review?.head&&ci?.head&&review.head!==ci.head?"Review:outdated":resultEvent?.result;
    const retained=items.slice(0,50);
    return {id,at:latest.at,subject:state.subject.trim()||items.find(item=>item.subject.trim())?.subject.trim()||"",project:latest.project??"other",agent:latest.agent??(["Codex","Hermes"].includes(latest.source)?latest.source:"Kurami"),event:latest.taskState??state.event,href:link?.href,result,events:retained,summaryEvents:summarizeActivity(retained),limited:items.length>50||items.some(item=>item.limited===true)};
  }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,100);
}
