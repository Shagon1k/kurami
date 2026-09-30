import {DatabaseSync} from "node:sqlite";
import type {ThreadUsage} from "../../core/codex-usage.ts";

export type UsagePeriod={completed:number;measured:number;medianTokens:number|null;reworkPercent:number|null};
export type ProjectUsage={available:boolean;periods:Record<7|30,UsagePeriod>;projects:Record<string,Record<7|30,UsagePeriod>>};
type Run={run_id:string;project:string;item_id:string;state:string;created_at:string};
type Link={run_id:string;thread_id:string|null;phase:"main"|"review"|"repair"};
type Task={key:string;project:string;completedAt:number;tokens:number|null;rework:number|null};
export type UsageReader=(ids:readonly string[],until:Date)=>Map<string,ThreadUsage>;

function summarize(tasks:Task[]):UsagePeriod {
  const measured=tasks.filter(task=>task.tokens!==null&&task.rework!==null);
  const sorted=measured.map(task=>task.tokens!).sort((a,b)=>a-b);
  const total=sorted.reduce((sum,tokens)=>sum+tokens,0);
  const middle=Math.floor(sorted.length/2);
  return {completed:tasks.length,measured:measured.length,
    medianTokens:sorted.length?(sorted.length%2?sorted[middle]!:(sorted[middle-1]!+sorted[middle]!)/2):null,
    reworkPercent:total>0?100*measured.reduce((sum,task)=>sum+task.rework!,0)/total:null};
}

/** Cohorts use the first verified release, not board labels or session turn completion. */
export function readProjectUsage(path:string,projectKeys:readonly string[],now:Date,readUsage:UsageReader):ProjectUsage {
  const empty=()=>({completed:0,measured:0,medianTokens:null,reworkPercent:null});
  const result:ProjectUsage={available:false,periods:{7:empty(),30:empty()},projects:{}};
  let db:DatabaseSync|undefined;
  try {
    db=new DatabaseSync(path,{readOnly:true,timeout:1000});
    db.exec("BEGIN");
    const runs=db.prepare("SELECT run_id,project,item_id,state,created_at FROM runs").all() as Run[];
    const history=db.prepare(`SELECT run_id,occurred_at,details_json FROM run_state_history
      WHERE to_state='archived' AND reason='merged_worktree_release_completed' ORDER BY occurred_at`).all() as {run_id:string;occurred_at:string;details_json:string|null}[];
    const links=db.prepare(`
      SELECT run_id,codex_thread_id AS thread_id,'main' AS phase FROM run_resources
      UNION ALL SELECT run_id,previous_codex_thread_id,'main' FROM run_resources
      UNION ALL SELECT run_id,predecessor_thread_id,'main' FROM run_autonomous_successions
      UNION ALL SELECT run_id,successor_thread_id,'main' FROM run_autonomous_successions
      UNION ALL SELECT run_id,codex_thread_id,'review' FROM run_ai_reviews
      UNION ALL SELECT run_id,codex_thread_id,'repair' FROM run_ci_repair_attempts
      UNION ALL SELECT run_id,codex_thread_id,'repair' FROM run_review_fix_rounds`).all() as Link[];
    db.exec("COMMIT");db.close();db=undefined;
    const byRun=new Map(runs.map(run=>[run.run_id,run]));
    const identity=(run:Run)=>JSON.stringify([run.project,run.item_id]);
    const tasks=new Map<string,Task>();
    for(const entry of history){
      const run=byRun.get(entry.run_id),at=Date.parse(entry.occurred_at);
      if(!run||run.state!=="archived"||!Number.isFinite(at)||at>now.getTime())continue;
      let evidence:{completionVerified?:boolean;mergeEvidence?:string};
      try{evidence=JSON.parse(entry.details_json??"null");}catch{continue;}
      if(evidence?.completionVerified!==true||!["git_ancestry","github_pr"].includes(evidence.mergeEvidence??""))continue;
      const key=identity(run);
      if(!tasks.has(key)||at<tasks.get(key)!.completedAt)tasks.set(key,{key,project:run.project,completedAt:at,tokens:null,rework:null});
    }
    // A session assigned to different tasks cannot be apportioned safely.
    const owners=new Map<string,Set<string>>();
    const byTask=new Map<string,Map<string,Set<Link["phase"]>>>();
    for(const link of links){
      const run=byRun.get(link.run_id);
      if(!run||!link.thread_id)continue;
      const key=identity(run);
      const owner=owners.get(link.thread_id)??new Set<string>();owner.add(key);owners.set(link.thread_id,owner);
      const task=tasks.get(key);
      if(!task||Date.parse(run.created_at)>task.completedAt)continue;
      const sessions=byTask.get(key)??new Map<string,Set<Link["phase"]>>();
      const phases=sessions.get(link.thread_id)??new Set<Link["phase"]>();phases.add(link.phase);
      sessions.set(link.thread_id,phases);byTask.set(key,sessions);
    }
    const cohort=[...tasks.values()].filter(task=>projectKeys.includes(task.project)&&task.completedAt>=now.getTime()-30*86_400_000);
    for(const task of cohort){
      const sessions=byTask.get(task.key);
      if(!sessions?.size||![...sessions.values()].some(phases=>phases.has("main")&&!phases.has("review")&&!phases.has("repair")))continue;
      if([...sessions].some(([id,phases])=>owners.get(id)!.size!==1||phases.has("review")&&phases.has("repair")))continue;
      const usage=readUsage([...sessions.keys()],new Date(task.completedAt));
      if([...sessions.keys()].some(id=>usage.get(id)?.tokens==null||!usage.get(id)?.observed))continue;
      task.tokens=0;task.rework=0;
      for(const [id,phases] of sessions){
        const tokens=usage.get(id)!.tokens!;
        task.tokens+=tokens;
        // Technical phase wins over a temporary alias in run_resources.
        if(phases.has("repair"))task.rework+=tokens;
      }
    }
    result.available=true;
    for(const days of [7,30] as const){
      const selected=cohort.filter(task=>task.completedAt>=now.getTime()-days*86_400_000);
      result.periods[days]=summarize(selected);
      for(const project of projectKeys){
        result.projects[project]??={7:empty(),30:empty()};
        result.projects[project]![days]=summarize(selected.filter(task=>task.project===project));
      }
    }
  }catch{return result;}
  finally{db?.close();}
  return result;
}
