import type {DatabaseSync} from "node:sqlite";
import type {UsageModel,UsageSnapshot} from "./rollout.ts";
// Technical phase wins over the temporary current-thread alias in run_resources.
export const USAGE_LINKS_SQL=`
  SELECT run_id,codex_thread_id AS thread_id,'implementation' AS stage FROM run_resources
  UNION SELECT run_id,previous_codex_thread_id,'implementation' FROM run_resources
  UNION SELECT run_id,predecessor_thread_id,'implementation' FROM run_autonomous_successions
  UNION SELECT run_id,successor_thread_id,'implementation' FROM run_autonomous_successions
  UNION SELECT run_id,codex_thread_id,'review' FROM run_ai_reviews
  UNION SELECT run_id,codex_thread_id,'fix_ci' FROM run_ci_repair_attempts
  UNION SELECT run_id,codex_thread_id,'fix_review' FROM run_review_fix_rounds
  UNION SELECT run_id,thread_id,CASE kind WHEN 'ci_repair' THEN 'fix_ci' ELSE 'fix_review' END FROM run_codex_tasks
  UNION SELECT h.run_id,j.value,'implementation' FROM run_state_history h,json_each(h.details_json) j
    WHERE json_valid(h.details_json) AND j.key IN
      ('codexThreadId','previousCodexThreadId','predecessorThreadId','successorThreadId','restoredCodexThreadId','restoredThreadId')
      AND j.type='text'
  UNION SELECT run_id,json_extract(details_json,'$.threadId'),'implementation' FROM run_state_history
    WHERE reason IN ('primary_attempt_failed','primary_attempt_interrupted','primary_retry_requested','primary_retry_unconfirmed','primary_retry_confirmed','primary_model_decision_required') AND json_valid(details_json)`;

export function usageSchemaReady(db:DatabaseSync):boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='usage_sessions'").get());
}

export type UsageStage="implementation"|"review"|"fix_review"|"fix_ci"|"unknown";
export type SessionUsage={stage:UsageStage;state:string;models:UsageModel[];shared:boolean;attempts:number|null;elapsedMs:number|null;outcome:string|null};
export type RunUsage={state:"pending"|"partial"|"complete"|"unavailable";terminal:boolean;input:number|null;cached:number|null;output:number|null;
  usd:number|null;unpriced:number;uncertain:number;elapsedMs:number|null;attempts:number;sessions:SessionUsage[];models:UsageModel[];
  checkedAt:string|null;rateDate:string|null;rateSource:string|null};
const terminal=(state:string)=>["archived","cancelled","discarded","completed","failed","rejected"].includes(state);

/** A read-only projection of durable collector data; never opens Codex or parses logs. */
export function readRunUsage(db:DatabaseSync,runId:string):RunUsage {
  const run=db.prepare("SELECT state,created_at,archived_at FROM runs WHERE run_id=?").get(runId) as {state:string;created_at:string;archived_at:string|null}|undefined;
  const result:RunUsage={state:"pending",terminal:terminal(run?.state??""),input:null,cached:null,output:null,usd:null,unpriced:0,uncertain:0,
    elapsedMs:null,attempts:0,sessions:[],models:[],checkedAt:null,rateDate:null,rateSource:null};
  if(!run||!usageSchemaReady(db)){result.state="unavailable";return result;}
  if(result.terminal){
    const end=run.archived_at??(db.prepare(`SELECT occurred_at FROM run_state_history WHERE run_id=? AND to_state=? ORDER BY sequence DESC LIMIT 1`).get(runId,run.state)?.occurred_at as string|undefined);
    const duration=Date.parse(end??"")-Date.parse(run.created_at);
    if(Number.isFinite(duration)&&duration>=0)result.elapsedMs=duration;
  }
  const rows=db.prepare(`SELECT u.*,l.stage,(SELECT COUNT(DISTINCT run_id) FROM (
      SELECT run_id,thread_id FROM run_usage_sessions UNION SELECT run_id,thread_id FROM (${USAGE_LINKS_SQL})
    ) other WHERE other.thread_id=l.thread_id) AS owners
    FROM run_usage_sessions l JOIN usage_sessions u USING(thread_id) WHERE l.run_id=? ORDER BY l.thread_id`).all(runId) as
    {source_state:string;snapshot_json:string|null;checked_at:string|null;stage:UsageStage;owners:number}[];
  const undiscovered=db.prepare(`SELECT COUNT(DISTINCT thread_id) AS count FROM (${USAGE_LINKS_SQL}) expected
    WHERE expected.run_id=? AND thread_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM run_usage_sessions saved WHERE saved.run_id=expected.run_id AND saved.thread_id=expected.thread_id)`)
    .get(runId) as {count:number};
  result.attempts=undiscovered.count;
  let measured=0,partial=undiscovered.count>0||!result.terminal||!rows.some(row=>row.stage==="implementation");
  for(const row of rows){
    const saved:UsageSnapshot|null=row.snapshot_json?JSON.parse(row.snapshot_json):null;
    const shared=row.owners>1;
    const models=shared?[]:saved?.models??[];
    result.attempts+=shared?1:saved?.attempts??1;
    result.sessions.push({stage:row.stage,state:shared?"shared":row.source_state,models,shared,
      attempts:shared?null:saved?.attempts??null,elapsedMs:shared?null:saved?.elapsedMs??null,outcome:shared?null:saved?.outcome??null});
    if(row.checked_at&&(!result.checkedAt||row.checked_at<result.checkedAt))result.checkedAt=row.checked_at;
    if(shared||row.source_state!=="complete"||row.stage==="unknown")partial=true;
    if(!models.length)continue;
    measured++;
    result.rateDate=saved!.rateDate;result.rateSource=saved!.rateSource;
    for(const model of models){
      let target=result.models.find(target=>target.model===model.model);
      if(!target){target={model:model.model,input:0,cached:0,output:0,usd:null,unpriced:0,uncertain:0};result.models.push(target);}
      target.input+=model.input;target.cached+=model.cached;target.output+=model.output;
      target.unpriced+=model.unpriced;target.uncertain+=model.uncertain;
      if(model.usd!==null)target.usd=(target.usd??0)+model.usd;
    }
  }
  // Terminal technical attempts without a synchronized thread remain visibly incomplete.
  const missing=db.prepare(`SELECT
    (SELECT COUNT(*) FROM run_ai_reviews WHERE run_id=? AND codex_thread_id IS NULL)+
    (SELECT COUNT(*) FROM run_ci_repair_attempts WHERE run_id=? AND codex_thread_id IS NULL)+
    (SELECT COUNT(*) FROM run_review_fix_rounds WHERE run_id=? AND codex_thread_id IS NULL) AS count`).get(runId,runId,runId) as {count:number};
  result.attempts+=missing.count;
  partial ||= missing.count>0;
  if(measured){
    result.input=0;result.cached=0;result.output=0;
    for(const row of result.models){result.input+=row.input;result.cached+=row.cached;result.output+=row.output;
      result.unpriced+=row.unpriced;result.uncertain+=row.uncertain;if(row.usd!==null)result.usd=(result.usd??0)+row.usd;}
  }
  result.state=measured?(partial?"partial":"complete"):undiscovered.count>0||rows.some(row=>row.source_state==="pending")||!rows.length?"pending":"unavailable";
  if(!rows.length){
    const resource=db.prepare("SELECT codex_thread_id,previous_codex_thread_id FROM run_resources WHERE run_id=?").get(runId);
    result.state=undiscovered.count||resource?.codex_thread_id||resource?.previous_codex_thread_id?"pending":result.terminal?"unavailable":"pending";
  }
  const provider=db.prepare("SELECT primary_agent_provider FROM run_resources WHERE run_id=?").get(runId)?.primary_agent_provider;
  if(measured&&provider&&provider!=="codex")result.state="partial";
  return result;
}
