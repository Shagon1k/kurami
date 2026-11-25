import {DatabaseSync} from "node:sqlite";
import {homedir} from "node:os";
import {resolve} from "node:path";
import {usageSchemaReady,USAGE_LINKS_SQL} from "./read-model.ts";
import {readUsageChunk,type Checkpoint,type UsageSnapshot} from "./rollout.ts";

function discover(db:DatabaseSync):void {
  // Limit new bindings per tick. Existing bindings are durable even after resource aliases change.
  const links=db.prepare(`SELECT * FROM (SELECT l.run_id,l.thread_id,
    CASE WHEN COUNT(DISTINCT CASE WHEN stage<>'implementation' THEN stage END)>1 THEN 'unknown'
      ELSE COALESCE(MAX(CASE WHEN stage<>'implementation' THEN stage END),'implementation') END AS resolved_stage
    FROM (${USAGE_LINKS_SQL}) l
    WHERE l.thread_id IS NOT NULL AND length(l.thread_id) BETWEEN 1 AND 120 AND l.thread_id NOT GLOB '*[^A-Za-z0-9_-]*'
    GROUP BY l.run_id,l.thread_id
    ) l WHERE NOT EXISTS(SELECT 1 FROM run_usage_sessions u WHERE u.run_id=l.run_id AND u.thread_id=l.thread_id AND u.stage=l.resolved_stage)
    LIMIT 100`).all() as {run_id:string;thread_id:string;resolved_stage:string}[];
  db.exec("BEGIN IMMEDIATE");
  try {
    for(const link of links){
      if(!/^[A-Za-z0-9_-]+$/.test(link.thread_id))continue;
      db.prepare("INSERT OR IGNORE INTO usage_sessions(thread_id) VALUES(?)").run(link.thread_id);
      db.prepare(`INSERT INTO run_usage_sessions(run_id,thread_id,stage) VALUES(?,?,?)
        ON CONFLICT(run_id,thread_id) DO UPDATE SET stage=excluded.stage`).run(link.run_id,link.thread_id,link.resolved_stage);
    }
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}

function sourceOutcome(db:DatabaseSync,threadId:string,turnId:string|undefined):{status:"completed"|"failed"|"cancelled"}[] {
  return db.prepare(`SELECT DISTINCT CASE status WHEN 'interrupted' THEN 'cancelled' ELSE status END AS status FROM (
    SELECT turn_id,turn_status AS status FROM run_codex_tasks WHERE thread_id=?
    UNION SELECT codex_turn_id,codex_turn_status FROM run_ai_reviews WHERE codex_thread_id=?
  ) WHERE status IS NOT NULL AND (? IS NULL OR turn_id=?)`).all(threadId,threadId,turnId??null,turnId??null) as {status:"completed"|"failed"|"cancelled"}[];
}

/** Runs after the controller's lifecycle work, without network calls or writes to Codex storage. */
export async function collectRunUsage(db:DatabaseSync,options:{home?:string;now?:Date;maxSessions?:number;chunkBytes?:number}={}):Promise<number> {
  if(!usageSchemaReady(db))return 0;
  discover(db);
  const now=options.now??new Date(),at=now.toISOString();
  const rows=db.prepare(`SELECT * FROM usage_sessions WHERE next_check_at<=? ORDER BY next_check_at,thread_id LIMIT ?`)
    .all(at,options.maxSessions??8) as {thread_id:string;checkpoint_json:string|null;snapshot_json:string|null;source_state:string;version:number}[];
  const home=options.home??process.env.CODEX_HOME??resolve(homedir(),".codex");
  let source:DatabaseSync|undefined;
  try {
    source=new DatabaseSync(resolve(home,"state_5.sqlite"),{readOnly:true,timeout:1000});
    for(const row of rows){
      let checkpoint:Checkpoint|null=null,snapshot:UsageSnapshot|null=null;
      let state="unavailable",delay=300_000;
      try {
        const thread=source.prepare("SELECT rollout_path FROM threads WHERE id=?").get(row.thread_id);
        if(typeof thread?.rollout_path!=="string")throw new Error("usage_rollout_missing");
        const window=db.prepare(`SELECT MIN(r.created_at) AS start,
          CASE WHEN MIN(r.state IN ('archived','cancelled','discarded','completed','failed','rejected'))=1 THEN
            MAX(COALESCE(r.archived_at,(SELECT occurred_at FROM run_state_history h WHERE h.run_id=r.run_id AND h.to_state=r.state ORDER BY sequence DESC LIMIT 1))) END AS end
          FROM runs r JOIN run_usage_sessions l USING(run_id) WHERE l.thread_id=?`).get(row.thread_id) as {start:string;end:string|null};
        const result=await readUsageChunk(thread.rollout_path,home,row.thread_id,
          row.checkpoint_json?JSON.parse(row.checkpoint_json):null,options.chunkBytes??1024*1024,Date.parse(window.start),window.end?Date.parse(window.end):null);
        checkpoint=result.checkpoint;snapshot=result.done||!row.snapshot_json?result.snapshot:null;
        const evidence=result.snapshot;
        const lastTurn=result.checkpoint.turns.at(-1)?.id;
        if(snapshot){
          const outcomes=sourceOutcome(db,row.thread_id,lastTurn);
          if(outcomes.length===1)snapshot.outcome=outcomes[0]!.status;
        }
        state=!evidence.events?(result.done?"unavailable":"pending"):evidence.partial?"partial":"complete";
        if(!evidence.events&&row.snapshot_json){snapshot=null;state="partial";}
        delay=result.done?300_000:60_000;
      }catch{state=row.snapshot_json?"partial":"unavailable";}
      // Optimistic fence: two overlapping controller ticks never add the same tokens twice.
      db.prepare(`UPDATE usage_sessions SET checkpoint_json=COALESCE(?,checkpoint_json),snapshot_json=COALESCE(?,snapshot_json),
        source_state=?,checked_at=?,next_check_at=?,version=version+1 WHERE thread_id=? AND version=?`)
        .run(checkpoint?JSON.stringify(checkpoint):null,snapshot?JSON.stringify(snapshot):null,state,at,
          new Date(now.getTime()+delay).toISOString(),row.thread_id,row.version);
    }
  }catch {
    // Keep previous totals; a temporarily missing Codex database is not zero usage.
    for(const row of rows)db.prepare(`UPDATE usage_sessions SET source_state=CASE WHEN snapshot_json IS NULL THEN 'unavailable' ELSE 'partial' END,
      checked_at=?,next_check_at=? WHERE thread_id=? AND version=?`).run(at,new Date(now.getTime()+300_000).toISOString(),row.thread_id,row.version);
  }finally{source?.close();}
  return rows.length;
}
