// Engineering signals in Daily: a pull request in Human Review for more than a day is listed with its wait,
// a fresher one is not, the block renders only with something to say, and a missing database means no block.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { engineeringBrief, readEngineering } from "../../src/briefing/engineering/model.ts";
import { renderEngineeringBlock } from "../../src/briefing/engineering/render.ts";
import type { BriefingPayload } from "../../src/briefing/model.ts";

const app = resolve(import.meta.dirname, "../.."), home = mkdtempSync(join(tmpdir(), "kurami-engineering-"));
const now = new Date("2026-10-07T05:00:00.000Z"), hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
try {
  assert.equal(readEngineering(home, now, { week: false }), null, "no orchestrator database, no block");
  mkdirSync(join(home, "config"), { recursive: true });
  writeFileSync(join(home, "config/projects.yaml"), `version: 1\nprojects:\n  pickflick:\n    repository: Shagon1k/PickFlick\n    statuses: {backlog: Backlog, active: In progress, review: Human Review, done: Done, deferred: Deferred}\n`);
  execFileSync(process.execPath, [resolve(app, "src/orchestrator/state/init-run-store.ts")], { env: { ...process.env, KURAMI_HOME: home, ORCHESTRATOR_MIGRATIONS_DIR: resolve(app, "migrations") }, stdio: ["ignore", "ignore", "pipe"] });
  const database = new DatabaseSync(join(home, "state/orchestrator.db"));
  const item = (issue: number, title: string, enteredHoursAgo: number) => {
    database.prepare(`INSERT INTO project_items (project,item_id,content_id,content_type,repository,issue_number,title,url,status,present,first_seen_at,last_seen_at)
      VALUES ('pickflick',?,?,'Issue','Shagon1k/PickFlick',?,?,?,'Human Review',1,?,?)`).run(`item-${issue}`, `content-${issue}`, issue, title, `https://github.com/Shagon1k/PickFlick/issues/${issue}`, hoursAgo(100), now.toISOString());
    database.prepare(`INSERT INTO project_events (event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,title,url,from_status,to_status,payload_json,processing_state)
      VALUES (?,?,'pickflick',?,?,'Issue','Shagon1k/PickFlick',?,?,?,'In progress','Human Review','{}','processed')`).run(`event-${issue}`, hoursAgo(enteredHoursAgo), `item-${issue}`, `content-${issue}`, issue, title, `https://github.com/Shagon1k/PickFlick/issues/${issue}`);
    database.prepare(`INSERT INTO runs (run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
      VALUES (?,?,'pickflick',?,?,'Shagon1k/PickFlick',?,'autonomous','waiting_human','cli','live')`).run(`r_${issue}`, `event-${issue}`, `item-${issue}`, `content-${issue}`, issue);
    database.prepare(`INSERT INTO run_ci_snapshots (run_id,repository,pull_request_number,pull_request_url,pull_request_title,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
      VALUES (?,'Shagon1k/PickFlick',?,?,?,'abcdef1234','passed','[]','d',?,?,?)`).run(`r_${issue}`, issue + 100, `https://github.com/Shagon1k/PickFlick/pull/${issue + 100}`, title, hoursAgo(50), now.toISOString(), now.toISOString());
  };
  item(33, "Update watchlist", 50);
  item(34, "Fresh review", 3);
  database.close();

  const data = readEngineering(home, now, { week: false })!;
  assert.deepEqual(data.waiting, [{ project: "PickFlick", number: 133, title: "Update watchlist", url: "https://github.com/Shagon1k/PickFlick/pull/133", hours: 50 }]);
  assert.equal(data.week, null, "weekday: no weekly totals");

  const payload = { addons: { engineering: engineeringBrief(data, now.toISOString()) } } as unknown as BriefingPayload;
  const html = renderEngineeringBlock(payload);
  assert.match(html, /PR ждут тебя дольше суток: 1/);
  assert.match(html, /href="https:\/\/github\.com\/Shagon1k\/PickFlick\/pull\/133">PickFlick #133<\/a><span>Update watchlist<\/span><strong data-ui-figure>2 дн\.<\/strong>/);
  assert.equal(renderEngineeringBlock({ addons: { engineering: engineeringBrief({ waiting: [], week: null }, now.toISOString()) } } as unknown as BriefingPayload), "", "nothing to say, nothing shown");
  const sunday = renderEngineeringBlock({ addons: { engineering: engineeringBrief({ waiting: [], week: { completed: 5, measured: 4, medianTokens: 1_240_000, reworkPercent: 20.4 } }, now.toISOString()) } } as unknown as BriefingPayload);
  assert.match(sunday, /За неделю: <strong data-ui-figure>5<\/strong> задач завершено · медиана <strong data-ui-figure>1\.2M<\/strong> токенов на задачу · доработки 20%/);
  console.log(JSON.stringify({ ok: true, engineering: "waiting over a day, fresh excluded, empty hidden, weekly line" }));
} finally { rmSync(home, { recursive: true, force: true }); }
