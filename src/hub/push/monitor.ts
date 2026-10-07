// Which situations deserve a push, and sending each once. Two kinds: a problem that waits for the owner or
// is critical (from the same queue as Hub's attention list), and the morning Digest being published. The
// first pass after start only remembers what is already there, so a restart or a new phone is never
// flooded with old news.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { kuramiEntryHref } from "../../ui-library/patterns/kurami-sites.ts";
import { alertLabels } from "../render.ts";
import type { HubSnapshot } from "../snapshot.ts";
import { problemQueue } from "../work-feed.ts";
import { pushPaths, readSent, readSubscriptions, sendNotice, writeSent, type PushFetch, type PushNotice } from "./web-push.ts";

type Candidate = Omit<PushNotice, "id" | "at">;
const localized = (ru: string, en: string) => ({ ru, en });

export function problemNotices(snapshot: HubSnapshot): Candidate[] {
  return problemQueue(snapshot.operations?.alerts ?? []).filter(problem => problem.actor === "owner" || problem.severity === "critical").map(problem => {
    const codes = [...new Set(problem.issues.map(issue => issue.code))].sort();
    const reasons = (lang: 0 | 1) => codes.map(code => alertLabels[code]?.[lang] ?? code).join(" · ");
    const subject = problem.title ? `${problem.subject} · ${problem.title}` : problem.subject;
    const url = (lang: "ru" | "en") => problem.task && problem.project && problem.itemId
      ? `${kuramiEntryHref("projects", lang)}?project=${encodeURIComponent(problem.project)}&item=${encodeURIComponent(problem.itemId)}`
      : `${kuramiEntryHref("hub", lang)}#alerts-title`;
    return {
      key: `problem:${problem.id}:${codes.join(",")}`,
      title: localized(problem.actor === "owner" ? "Kurami ждёт тебя" : "Kurami: сбой", problem.actor === "owner" ? "Kurami needs you" : "Kurami: failure"),
      body: localized(`${subject}\n${reasons(0)}`.slice(0, 240), `${subject}\n${reasons(1)}`.slice(0, 240)),
      url: localized(url("ru"), url("en")),
    };
  });
}

/** Today's Daily, once it is published (read-only from the Digest store). */
export function digestNotice(home: string, now: Date): Candidate | null {
  const path = resolve(home, "state/briefing/briefing.db");
  if (!existsSync(path)) return null;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vilnius" }).format(now);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true, timeout: 1_000 });
    const row = database.prepare("SELECT local_date FROM editions WHERE edition_type='daily' AND local_date=? AND state IN ('complete','partial') AND published_at IS NOT NULL LIMIT 1").get(today) as { local_date: string } | undefined;
    if (!row) return null;
    return { key: `digest:${row.local_date}`, title: localized("Дайджест готов", "Digest is ready"), body: localized("Утренний выпуск можно читать.", "This morning's edition is ready to read."),
      url: localized(`${kuramiEntryHref("digest", "ru")}`, `${kuramiEntryHref("digest", "en")}`) };
  } catch { return null; } finally { database?.close(); }
}

/** One pass: sends what is new and remembers it. With no devices subscribed it only remembers. */
export async function pushPass(home: string, snapshot: HubSnapshot, options: { now?: Date; fetchImpl?: PushFetch } = {}): Promise<string[]> {
  const now = options.now ?? new Date();
  const candidates = [...problemNotices(snapshot), ...[digestNotice(home, now)].filter((notice): notice is Candidate => notice !== null)];
  const baseline = !existsSync(pushPaths(home).sent), sent = readSent(home, now), announced: string[] = [];
  const quiet = baseline || !readSubscriptions(home).length;
  for (const candidate of candidates) {
    if (sent[candidate.key]) { sent[candidate.key] = now.toISOString(); continue; }
    if (!quiet) { await sendNotice(home, candidate, options.fetchImpl, now); announced.push(candidate.key); }
    sent[candidate.key] = now.toISOString();
  }
  writeSent(home, sent);
  return announced;
}
