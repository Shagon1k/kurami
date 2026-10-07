// Ask Kurami: every topic answers from read-only stores, missing sources say "unavailable" instead of failing,
// the command accepts only known topics, and the skill names only the fixed read-only command.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { kuramiStatus } from "../src/system/ask/kurami-status.ts";

const app = resolve(import.meta.dirname, ".."), home = mkdtempSync(join(tmpdir(), "kurami-status-")), codexHome = join(home, "codex");
const now = new Date("2026-10-07T05:00:00Z");
try {
  const empty = kuramiStatus("overview", { home, codexHome, now }) as Record<string, { available: boolean }>;
  for (const topic of ["tasks", "health", "calendar"]) assert.equal(empty[topic]!.available, false, `${topic} without data is unavailable, not an error`);

  mkdirSync(join(home, "state/briefing"), { recursive: true });
  writeFileSync(join(home, "state/system-health-snapshot.json"), JSON.stringify({ checkedAt: now.toISOString(), ok: false, server: { cpuUsedPercent: 12, memoryUsedPercent: 40 }, disk: { usedPercent: 86, availableGiB: 20 }, issues: [{ severity: "warning", message: "Disk above 85%" }] }));
  const briefing = new DatabaseSync(join(home, "state/briefing/briefing.db"));
  briefing.exec("CREATE TABLE editions(edition_type TEXT, local_date TEXT, published_at TEXT, payload_json TEXT)");
  briefing.prepare("INSERT INTO editions VALUES('daily','2026-10-07',?,?)").run(now.toISOString(), JSON.stringify({ addons: { calendar: { data: { section: { state: "ready", fetchedAt: now.toISOString(),
    events: [{ title: "Standup", start: "2026-10-07T07:00:00Z", end: "2026-10-07T07:15:00Z", calendarLabel: "Work" }, { title: "Cancelled sync", start: "2026-10-07T09:00:00Z", end: "2026-10-07T09:30:00Z", status: "cancelled" }], allDayEvents: [{ title: "Birthday" }] } } } } }));
  briefing.close();

  assert.deepEqual(kuramiStatus("health", { home, codexHome, now }).health, { available: true, checkedAt: now.toISOString(), ok: false, cpuPercent: 12, memoryPercent: 40, diskPercent: 86, diskFreeGiB: 20, issues: ["warning: Disk above 85%"] });
  assert.deepEqual(kuramiStatus("calendar", { home, codexHome, now }).calendar, { available: true, date: "2026-10-07", state: "ready", fetchedAt: now.toISOString(),
    events: [{ start: "2026-10-07T07:00:00Z", end: "2026-10-07T07:15:00Z", title: "Standup", calendar: "Work" }], allDay: ["Birthday"] }, "cancelled events are left out");
  assert.deepEqual(Object.keys(kuramiStatus("limits", { home, codexHome, now })), ["ok", "topic", "at", "limits"], "one topic answers only that topic");

  const cli = spawnSync(process.execPath, [resolve(app, "src/system/ask/kurami-status.ts"), "health; rm -rf /"], { env: { ...process.env, KURAMI_HOME: home }, encoding: "utf8" });
  assert.equal(cli.status, 2, "unknown topics are refused");
  assert.equal(JSON.parse(execFileSync(process.execPath, [resolve(app, "src/system/ask/kurami-status.ts"), "health"], { env: { ...process.env, KURAMI_HOME: home }, encoding: "utf8" })).health.diskPercent, 86);

  const skill = readFileSync(resolve(app, "integrations/hermes/skills/kurami-status/SKILL.md"), "utf8");
  assert.match(skill, /^name: kurami-status$/m);
  assert.deepEqual([...skill.matchAll(/^STATUS=(.+)$/gm)].map(match => match[1]), ["/home/shagon1k/_hermes/_kurami/app/src/system/ask/kurami-status.ts"]);
  assert.match(readFileSync(resolve(app, "bin/sync-hermes-skills.sh"), "utf8"), /^  kurami-status$/m, "the skill is synced to Hermes");
  console.log(JSON.stringify({ ok: true, kuramiStatus: "topics, unavailable sources, cancelled events, refused topics, fixed skill command" }));
} finally { rmSync(home, { recursive: true, force: true }); }
