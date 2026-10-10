import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openOrchestratorDatabase } from "../../src/orchestrator/state/database.ts";
import { claimProtocolTask, taskForSession } from "../../src/orchestrator/integrations/codex/task-store.ts";

export function protocolRepository() {
  const root = mkdtempSync(resolve(tmpdir(),"kurami-protocol-"));
  const canonical = resolve(root,"repo");
  const worktree = resolve(root,"worktree");
  const git = (...args:string[]) => execFileSync("git",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git("init","-q",canonical);
  // An empty fixture commit has no index/staging operations and stays in /tmp.
  const tree = git("-C",canonical,"mktree");
  const sha = execFileSync("git",["-C",canonical,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid",
    "commit-tree",tree,"-m","Disposable protocol fixture"],{encoding:"utf8"}).trim();
  git("-C",canonical,"update-ref","refs/heads/main",sha);
  git("-C",canonical,"worktree","add","-q","-b","fixture",worktree,"main");
  mkdirSync(resolve(root,"state"));
  const dbPath=resolve(root,"state/orchestrator.db");
  const database = openOrchestratorDatabase(dbPath);
  const migrations = resolve(import.meta.dirname,"../../migrations");
  for (const file of readdirSync(migrations).filter((name)=>/^\d+_.*\.sql$/u.test(name)).sort())
    database.exec(readFileSync(resolve(migrations,file),"utf8"));
  database.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,
    repository,issue_number,payload_json) VALUES ('event','2026-01-01','fixture','item','content','Issue','Fixture/Repo',1,'{}');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,
      interaction_policy,state,owner_state,execution_mode)
    VALUES ('run','event','fixture','item','content','Fixture/Repo',1,'autonomous','running','cli','live');`);
  database.prepare(`INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,base_sha,tmux_session_name)
    VALUES ('run','provisioned',?,'fixture',?,'cx-protocol-test')`).run(worktree,sha);
  const id=claimProtocolTask(database,"run","cx-protocol-test","ci_repair","run");
  return {root,canonical,worktree,database,dbPath,task:taskForSession(database,"cx-protocol-test")!,id};
}
