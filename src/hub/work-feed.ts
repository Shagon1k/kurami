import type {HubAlert,HubActivity,ProblemNext} from "./operations.ts";
export type HubProblem={id:string;subject:string;title:string;project?:string;task:boolean;severity:"warning"|"critical";issues:HubAlert[];href?:string;actor:"owner"|"agent"|"system";next:ProblemNext};
export function problemQueue(alerts:HubAlert[]):HubProblem[] {
  const groups=new Map<string,HubProblem>();
  for(const alert of alerts){
    const task=["ci_unrepaired","review_unrepaired","run_attention","owner_input"].includes(alert.code);
    const id=alert.group??(alert.code==="health_issue"||alert.code.startsWith("health_")?"system:health":task&&alert.href?`task:${alert.href}`:alert.id);
    const defaults=alert.code==="poll_stale"?"check_project":alert.code==="orchestrator_unavailable"?"restore_db":alert.code==="health_issue"?"inspect_health":alert.code==="owner_input"?"reply":alert.code==="run_attention"?"inspect_task":task?"start_repair":"check_collector";
    const group=groups.get(id)??{id,subject:id==="system:health"?"System Health":alert.subject,title:alert.title??"",project:alert.project,task:alert.task??task,severity:alert.severity,issues:[],href:alert.href,actor:alert.actor??"owner",next:alert.next??defaults};
    if(alert.severity==="critical")group.severity="critical";
    if(!group.issues.some(issue=>issue.code===alert.code&&issue.subject===alert.subject))group.issues.push(alert);
    if(alert.next==="reply"||alert.next==="inspect_task"){group.next=alert.next;group.actor="owner";}
    groups.set(id,group);
  }
  return [...groups.values()].sort((a,b)=>Number(b.severity==="critical")-Number(a.severity==="critical"));
}
export type WorkItem={id:string;at:string;subject:string;project:string;agent:string;event:string;href?:string;result?:string;events:HubActivity[]};
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
    return {id,at:latest.at,subject:state.subject,project:latest.project??"other",agent:latest.agent??(["Codex","Hermes"].includes(latest.source)?latest.source:"Kurami"),event:latest.taskState??state.event,href:link?.href,result:items.find(item=>item.result)?.result,events:items.slice(0,50)};
  }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,100);
}
