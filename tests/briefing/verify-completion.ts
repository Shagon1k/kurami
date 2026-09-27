import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { briefingPaths, initializeBriefingStore, openBriefingDatabase } from "../../src/briefing/store.ts";
import { startBriefingAttempt, recordBriefingRunStage } from "../../src/briefing/run-attempt.ts";
import { completionContext, resumeCompletion, assertCompletion } from "../../src/briefing/completion.ts";
import { cronEndedAfter } from "../../src/briefing/cron-observer.ts";
import { parseBriefingPayload } from "./payload-fixtures.ts";

const root = resolve(import.meta.dirname, "../.."), home = await mkdtemp(resolve(tmpdir(),"kurami-completion-"));
const paths = briefingPaths({KURAMI_HOME:home, BRIEFING_MIGRATIONS_DIR:resolve(root,"migrations/briefing")});
await initializeBriefingStore(paths);
const db = openBriefingDatabase(paths);
const editionId="daily:2026-09-17", at=new Date("2026-09-17T06:00:00Z");
const {attempt}=await startBriefingAttempt(db,paths,{editionId,mode:"scheduled",timeZone:"Europe/Vilnius",at});
const payload=parseBriefingPayload({
  schemaVersion:2, edition:{id:editionId,type:"daily",localDate:"2026-09-17",timezone:"Europe/Vilnius",generatedAt:at.toISOString(),status:"complete",retentionUntil:"2026-09-22T06:00:00Z"},
  hero:{title:"Утренний обзор"},mail:{state:"empty",items:[]},calendar:{state:"empty",events:[],allDayEvents:[]},
  weather:{state:"failed"},news:{state:"empty",pageSize:10,items:[]},sourceBatches:[],dataQuality:{state:"partial"},
});
const raw=JSON.stringify(payload), path=resolve(attempt.runDirectory,"payload.json");
await writeFile(path,raw);
for(const stage of ["live-collected","telegram-captured","capture-validated"] as const)recordBriefingRunStage(db,{attemptId:attempt.attemptId,stage});
recordBriefingRunStage(db,{attemptId:attempt.attemptId,stage:"editorialized",outputDigest:createHash("sha256").update(raw).digest("hex")});
assert.deepEqual((await completionContext(db,paths,editionId,attempt.attemptId)).pairs,[]);
await writeFile(path,raw+" ");
await assert.rejects(completionContext(db,paths,editionId,attempt.attemptId),/changed after acceptance/);
await writeFile(path,raw);
await assert.rejects(completionContext(db,paths,"daily:2026-09-16",attempt.attemptId),/matching production/);
assert.throws(()=>assertCompletion(db,editionId,attempt.attemptId),/not proven/);
recordBriefingRunStage(db,{attemptId:attempt.attemptId,stage:"failed",errorCode:"test_failure"});
await assert.rejects(completionContext(db,paths,editionId,attempt.attemptId),/explicitly resumed/);
assert.equal(resumeCompletion(db,editionId,attempt.attemptId).state,"editorialized");
assert.equal(db.prepare("SELECT state FROM briefing_run_stage_receipts WHERE attempt_id=? AND stage='failed'").get(attempt.attemptId)?.state,"failed");
assert.throws(()=>resumeCompletion(db,editionId,attempt.attemptId),/matching failed/);
db.close();

const hermes=resolve(home,"hermes");
await mkdir(resolve(hermes,"cron"),{recursive:true});
await writeFile(resolve(hermes,"cron/jobs.json"),JSON.stringify([{id:"daily-job",name:"kurami-daily-briefing"}]));
const executions=new DatabaseSync(resolve(hermes,"cron/executions.db"));
executions.exec("CREATE TABLE executions (job_id TEXT,status TEXT,claimed_at TEXT,finished_at TEXT)");
executions.prepare("INSERT INTO executions VALUES (?,?,?,?)").run("daily-job","running",at.toISOString(),null);
const env={HERMES_HOME:hermes};
assert.equal(await cronEndedAfter(paths,at.toISOString(),new Date("2026-09-17T06:15:00Z"),env),false);
executions.exec("UPDATE executions SET status='completed',finished_at='2026-09-17T06:12:00Z'");
assert.equal(await cronEndedAfter(paths,at.toISOString(),new Date("2026-09-17T06:15:00Z"),env),true);
assert.equal(await cronEndedAfter(paths,"2026-09-17T07:00:00Z",new Date("2026-09-17T07:05:00Z"),env),false);
executions.close();
const prompt=await readFile(resolve(root,"integrations/hermes/briefing-cron-prompt.md"),"utf8");
assert.match(prompt,/shouldRun flag is the ONLY/);
assert.match(prompt,/finish_daily_briefing/);
assert.match(prompt,/assert-complete/);
assert.match(prompt,/attached\s+`kurami-daily-briefing` skill/);
assert.match(prompt,/return \[SILENT\]/);
assert.match(prompt,/Do not hand-author the\s+derived presentation payload or invoke a separate UI skill/);
assert.doesNotMatch(prompt,/local hour is not 09|only at 09:00/);
console.log("Completion context, immutable editorial digest, failed-stage recovery, terminal assertion, cron exit observation and prompt contract verified.");
