import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { openOrchestratorDatabase } from "../../state/database.ts";
import { retryPrimary, type RetryProject } from "./retry-primary.ts";
import { orchestratorHome } from "./session-shared.ts";

const args=process.argv.slice(2);
const value=(flag:string)=>args[args.indexOf(flag)+1];
if(args.length!==5||args[0]!=="--run-id"||args[2]!=="--request-id"||args[4]!=="--apply")
  throw new Error("Usage: retry-primary-cli.ts --run-id ID --request-id ID --apply");
const database=openOrchestratorDatabase(resolve(orchestratorHome,"state/orchestrator.db"));
try {
  const runId=value("--run-id")!,requestId=value("--request-id")!;
  const run=database.prepare("SELECT project FROM runs WHERE run_id=?").get(runId);
  const registry=parse(readFileSync(resolve(orchestratorHome,"config/projects.yaml"),"utf8")) as {projects:Record<string,RetryProject>};
  const project=registry.projects[String(run?.project)];
  if(!project)throw new Error("Retry project is unavailable");
  console.log(JSON.stringify(retryPrimary(database,runId,requestId,project)));
} finally { database.close(); }
