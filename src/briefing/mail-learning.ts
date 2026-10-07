// Mail that learns from what the owner does. Archiving from Daily counts against the sender; once a sender
// has been archived a few times and there is no decision yet, Daily proposes one rule ("show their mail as
// GENERAL?"). An accepted rule overrides the classification on every refresh; a declined one (class NULL) is
// never proposed again. Only addresses are stored (migrations/briefing/014_mail_learning.sql).
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import type { MailClass } from "./model.ts";

/** Archives before a rule is proposed. */
export const SUGGEST_AFTER_ARCHIVES = 4;

/** The address part of "Name <a@b.c>", lowercased; null when there is no usable address. */
export function senderKey(sender: unknown): string | null {
  if (typeof sender !== "string") return null;
  const address = (/<([^<>\s]+@[^<>\s]+)>/.exec(sender)?.[1] ?? (/^[^\s<>@]+@[^\s<>@]+$/.test(sender.trim()) ? sender.trim() : "")).toLowerCase();
  return address.length >= 3 && address.length <= 320 ? address : null;
}

export function recordArchived(database: DatabaseSync, senders: unknown[], at = new Date()): void {
  const statement = database.prepare(`INSERT INTO mail_sender_signals(sender,archived,updated_at) VALUES(?,1,?)
    ON CONFLICT(sender) DO UPDATE SET archived=archived+1, updated_at=excluded.updated_at`);
  for (const sender of senders) { const key = senderKey(sender); if (key) statement.run(key, at.toISOString()); }
}

export function senderRules(database: DatabaseSync): Record<string, MailClass> {
  const rows = database.prepare("SELECT sender,class FROM mail_sender_rules WHERE class IS NOT NULL").all() as { sender: string; class: MailClass }[];
  return Object.fromEntries(rows.map(row => [row.sender, row.class]));
}

/** The one sender most worth a rule now, or null. */
export function ruleSuggestion(database: DatabaseSync): { sender: string; archived: number } | null {
  const row = database.prepare(`SELECT s.sender, s.archived FROM mail_sender_signals s LEFT JOIN mail_sender_rules r USING(sender)
    WHERE r.sender IS NULL AND s.archived >= ? ORDER BY s.archived DESC, s.updated_at DESC LIMIT 1`).get(SUGGEST_AFTER_ARCHIVES) as { sender: string; archived: number } | undefined;
  return row ? { sender: row.sender, archived: row.archived } : null;
}

/** Records the owner's decision: a class, or null for "keep deciding per message". */
export function decideRule(database: DatabaseSync, sender: unknown, mailClass: MailClass | null, at = new Date()): string {
  const key = senderKey(sender);
  if (!key) throw new Error("Invalid sender");
  if (mailClass !== null && !["ACTION", "IMPORTANT", "GENERAL"].includes(mailClass)) throw new Error("Invalid mail class");
  database.prepare(`INSERT INTO mail_sender_rules(sender,class,decided_at) VALUES(?,?,?)
    ON CONFLICT(sender) DO UPDATE SET class=excluded.class, decided_at=excluded.decided_at`).run(key, mailClass, at.toISOString());
  return key;
}

/** The rules for a refresh, read-only; none when the store or its migration is not there yet. */
export function loadSenderRules(databasePath: string): Record<string, MailClass> {
  if (!existsSync(databasePath)) return {};
  let database: DatabaseSync | undefined;
  try { database = new DatabaseSync(databasePath, { readOnly: true, timeout: 2_000 }); return senderRules(database); }
  catch { return {}; } finally { database?.close(); }
}
