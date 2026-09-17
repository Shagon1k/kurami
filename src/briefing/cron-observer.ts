import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BriefingPaths } from "./store.ts";

/** Read scheduler completion, never infer success from its response text. */
export async function cronEndedAfter(paths: BriefingPaths, attemptCreatedAt: string, at: Date, environment: NodeJS.ProcessEnv): Promise<boolean> {
  const hermes = environment.HERMES_HOME ?? resolve(paths.home, "../_core");
  try {
    const value = JSON.parse(await readFile(resolve(hermes, "cron/jobs.json"), "utf8"));
    const jobs = (Array.isArray(value) ? value : value.jobs) as Array<{id:string;name:string}>;
    const matches = jobs.filter(job => job.name === "kurami-daily-briefing");
    if (matches.length !== 1) return false;
    const database = new DatabaseSync(resolve(hermes, "cron/executions.db"), {readOnly:true});
    try {
      const row = database.prepare("SELECT status, finished_at FROM executions WHERE job_id = ? ORDER BY claimed_at DESC LIMIT 1").get(matches[0]!.id) as {status:string;finished_at:string|null}|undefined;
      if (!row || !["completed","failed"].includes(row.status) || !row.finished_at) return false;
      const finished = Date.parse(row.finished_at);
      return finished >= Date.parse(attemptCreatedAt) && finished <= at.getTime();
    } finally { database.close(); }
  } catch { return false; } // Old installations retain the 09:50/10:50 guard.
}
