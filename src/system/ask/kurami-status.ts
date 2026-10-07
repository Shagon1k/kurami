// "Ask Kurami": one read-only answer about the current state, for the Hermes skill kurami-status. Topics:
// tasks (what waits for the owner or is failing, what is in progress), limits (Codex windows and when they
// run out at the current pace), health (server measurements and open issues), calendar (today's events from
// the current Daily edition) and overview (all of them, briefly). It opens every store read-only, writes
// nothing and starts nothing; questions that need an action go to kurami-run-control instead.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { collectCodexSnapshot } from "../../hub/codex.ts";
import { limitRunsOutAt } from "../../hub/render.ts";
import { projectRunStatus, readProjectStatus, type ProjectStatuses } from "../../orchestrator/projects/status-read-model.ts";

export const TOPICS = ["overview", "tasks", "limits", "health", "calendar"] as const;
export type Topic = typeof TOPICS[number];
type Options = { home: string; codexHome: string; now: Date };

function tasks({ home, now }: Options) {
  const registryPath = resolve(home, "config/projects.yaml");
  if (!existsSync(registryPath)) return { available: false };
  const registry = (parse(readFileSync(registryPath, "utf8")) as { projects?: Record<string, { statuses: ProjectStatuses; repository?: string }> }).projects ?? {};
  const status = readProjectStatus(resolve(home, "state/orchestrator.db"), registry, now);
  if (!status.available) return { available: false };
  const named = status.runs.map(run => ({ run, state: projectRunStatus(run), project: registry[run.project]?.repository?.split("/")[1] ?? run.project }));
  const entry = (item: (typeof named)[number]) => ({ task: `${item.project} #${item.run.issue_number}`, status: item.run.item_status, run: item.run.run_id, pullRequest: item.run.pull_request_url, reasons: item.state.attention.map(issue => issue.code) });
  return {
    available: true,
    waitingForOwner: named.filter(item => item.state.attention.some(issue => issue.code === "owner_input")).map(entry),
    failing: named.filter(item => item.state.attention.some(issue => issue.code !== "owner_input")).map(entry),
    inProgress: named.filter(item => item.state.working).map(item => `${item.project} #${item.run.issue_number}`),
    inReview: named.filter(item => item.run.item_status === registry[item.run.project]?.statuses.review).map(item => `${item.project} #${item.run.issue_number}`),
  };
}

function limits({ codexHome, now }: Options) {
  const codex = collectCodexSnapshot({ home: codexHome, now });
  return { available: codex.state === "available", observedAt: codex.updatedAt, windows: codex.limits.map(limit => ({
    windowMinutes: limit.windowMinutes, usedPercent: Math.round(limit.usedPercent), remainingPercent: Math.round(limit.remainingPercent),
    resetsAt: limit.resetsAt, runsOutBeforeResetAt: limitRunsOutAt(limit),
  })) };
}

function health({ home }: Options) {
  try {
    const value = JSON.parse(readFileSync(resolve(home, "state/system-health-snapshot.json"), "utf8")) as { checkedAt: string; ok: boolean; server: { cpuUsedPercent: number; memoryUsedPercent: number }; disk: { usedPercent: number; availableGiB: number }; issues: { severity: string; message: string }[] };
    return { available: true, checkedAt: value.checkedAt, ok: value.ok, cpuPercent: value.server.cpuUsedPercent, memoryPercent: value.server.memoryUsedPercent, diskPercent: value.disk.usedPercent, diskFreeGiB: value.disk.availableGiB, issues: value.issues.map(issue => `${issue.severity}: ${issue.message}`) };
  } catch { return { available: false }; }
}

function calendar({ home }: Options) {
  const path = resolve(home, "state/briefing/briefing.db");
  if (!existsSync(path)) return { available: false };
  const database = new DatabaseSync(path, { readOnly: true, timeout: 1_000 });
  try {
    const row = database.prepare("SELECT local_date,payload_json FROM editions WHERE edition_type='daily' AND published_at IS NOT NULL ORDER BY local_date DESC LIMIT 1").get() as { local_date: string; payload_json: string } | undefined;
    if (!row) return { available: false };
    const section = (JSON.parse(row.payload_json) as { addons?: { calendar?: { data?: { section?: { state?: string; fetchedAt?: string; events?: { title: string; start: string; end: string; calendarLabel?: string; status?: string }[]; allDayEvents?: { title: string }[] } } } } }).addons?.calendar?.data?.section;
    return { available: Boolean(section), date: row.local_date, state: section?.state ?? null, fetchedAt: section?.fetchedAt ?? null,
      events: (section?.events ?? []).filter(event => event.status !== "cancelled").map(event => ({ start: event.start, end: event.end, title: event.title, calendar: event.calendarLabel ?? null })),
      allDay: (section?.allDayEvents ?? []).map(event => event.title) };
  } catch { return { available: false }; } finally { database.close(); }
}

export function kuramiStatus(topic: Topic, options: Options): Record<string, unknown> {
  const parts = { tasks, limits, health, calendar };
  if (topic !== "overview") return { ok: true, topic, at: options.now.toISOString(), [topic]: parts[topic](options) };
  return { ok: true, topic, at: options.now.toISOString(), ...Object.fromEntries(Object.entries(parts).map(([name, read]) => [name, read(options)])) };
}

if (import.meta.main) {
  const topic = (process.argv[2] ?? "overview") as Topic;
  if (!TOPICS.includes(topic) || process.argv.length > 3) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: `Usage: kurami-status.ts [${TOPICS.join("|")}]` })}\n`);
    process.exitCode = 2;
  } else {
    const home = resolveKuramiHome("/home/shagon1k/_hermes/_kurami");
    process.stdout.write(`${JSON.stringify(kuramiStatus(topic, { home, codexHome: process.env.CODEX_HOME ?? resolve(homedir(), ".codex"), now: new Date() }))}\n`);
  }
}
