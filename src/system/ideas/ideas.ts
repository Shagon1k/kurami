// The ideas pool: plans and thoughts that are not (yet) a task in any project, so they are not lost in a chat.
// Only the gist is required; the original message is kept verbatim, and the optional answers (what prompted it,
// where it belongs, a first step, when) let the owner come back without retelling it. Each idea has an
// append-only journal of notes and status changes. Capturing an idea never starts work: "make it a task" is
// a separate, explicit step that files an issue and records its link here.
// Stored in state/ideas.db; Projects shows and edits it, the Hermes skill kurami-ideas captures from Discord.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../../core/kurami-home.ts";

process.umask(0o077);

export const IDEA_STATUSES = ["new", "thinking", "task", "parked", "closed"] as const;
export type IdeaStatus = typeof IDEA_STATUSES[number];
export const OPEN_IDEA_STATUSES: readonly IdeaStatus[] = ["new", "thinking"];
export const IDEA_HORIZONS = ["someday", "month", "soon"] as const;
export type IdeaHorizon = typeof IDEA_HORIZONS[number];
export const IDEA_SOURCES = ["site", "discord", "cli"] as const;
export type IdeaSource = typeof IDEA_SOURCES[number];

export type Idea = {
  id: number; summary: string; original: string | null; context: string | null; area: string | null;
  firstStep: string | null; horizon: IdeaHorizon | null; status: IdeaStatus; taskUrl: string | null;
  source: IdeaSource; createdAt: string; updatedAt: string;
};
export type IdeaNote = { at: string; kind: "note" | "status"; text: string; actor: string };
export type IdeaInput = { summary: unknown; original?: unknown; context?: unknown; area?: unknown; firstStep?: unknown; horizon?: unknown; source?: unknown; key?: unknown };

export class IdeaError extends Error {}
const fail = (message: string): never => { throw new IdeaError(message); };

export function ideasPath(home = resolveKuramiHome("/home/shagon1k/_hermes/_kurami")): string {
  return resolve(home, "state/ideas.db");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY,
  summary TEXT NOT NULL,
  original TEXT,
  context TEXT,
  area TEXT,
  first_step TEXT,
  horizon TEXT CHECK (horizon IN ('someday','month','soon')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','thinking','task','parked','closed')),
  task_url TEXT,
  source TEXT NOT NULL CHECK (source IN ('site','discord','cli')),
  capture_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idea_notes (
  id INTEGER PRIMARY KEY,
  idea_id INTEGER NOT NULL REFERENCES ideas(id),
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note','status')),
  text TEXT NOT NULL,
  actor TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idea_notes_by_idea ON idea_notes(idea_id, id);
CREATE TRIGGER IF NOT EXISTS idea_notes_append_only_update BEFORE UPDATE ON idea_notes BEGIN SELECT RAISE(ABORT, 'idea notes are append-only'); END;
CREATE TRIGGER IF NOT EXISTS idea_notes_append_only_delete BEFORE DELETE ON idea_notes BEGIN SELECT RAISE(ABORT, 'idea notes are append-only'); END;
`;

function writable(home: string): DatabaseSync {
  const path = ideasPath(home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path, { timeout: 5_000 });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  database.exec(SCHEMA);
  return database;
}

function text(value: unknown, label: string, max: number, min = 0): string | null {
  if (value === undefined || value === null || value === "") return min ? fail(`${label} is required`) : null;
  if (typeof value !== "string") fail(`${label} must be text`);
  const trimmed = (value as string).trim();
  if (trimmed.length < min) fail(min ? `${label} needs at least ${min} characters` : `${label} is empty`);
  if (trimmed.length > max) fail(`${label} is longer than ${max} characters`);
  return trimmed || null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T | null {
  if (value === undefined || value === null || value === "") return null;
  return (allowed as readonly unknown[]).includes(value) ? value as T : fail(`${label} must be one of: ${allowed.join(", ")}`);
}

type Row = { id: number; summary: string; original: string | null; context: string | null; area: string | null; first_step: string | null; horizon: IdeaHorizon | null; status: IdeaStatus; task_url: string | null; source: IdeaSource; created_at: string; updated_at: string };
const idea = (row: Row): Idea => ({ id: row.id, summary: row.summary, original: row.original, context: row.context, area: row.area, firstStep: row.first_step, horizon: row.horizon,
  status: row.status, taskUrl: row.task_url, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at });

/** Saves an idea. Only the gist is required; a repeated `key` returns the idea already saved. */
export function captureIdea(home: string, input: IdeaInput, actor: string, now = new Date()): Idea {
  const summary = text(input.summary, "The gist", 200, 3)!.replace(/\s+/g, " ");
  const original = text(input.original, "The original message", 4000), context = text(input.context, "What prompted it", 2000);
  const firstStep = text(input.firstStep, "The first step", 1000), horizon = oneOf(input.horizon, IDEA_HORIZONS, "When");
  const area = input.area === undefined || input.area === null || input.area === "" ? null
    : typeof input.area === "string" && /^[a-z0-9-]{1,64}$/.test(input.area) ? input.area : fail("Area must be a project key, kurami or other");
  const source = oneOf(input.source ?? "cli", IDEA_SOURCES, "Source")!;
  const key = input.key === undefined || input.key === null ? null
    : typeof input.key === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(input.key) ? input.key : fail("Invalid capture key");
  const database = writable(home);
  try {
    if (key) {
      const existing = database.prepare("SELECT * FROM ideas WHERE capture_key = ?").get(key) as Row | undefined;
      if (existing) return idea(existing);
    }
    const at = now.toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      const { lastInsertRowid } = database.prepare(`INSERT INTO ideas (summary, original, context, area, first_step, horizon, source, capture_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(summary, original, context, area, firstStep, horizon, source, key, at, at);
      database.prepare("INSERT INTO idea_notes (idea_id, at, kind, text, actor) VALUES (?, ?, 'status', 'new', ?)").run(lastInsertRowid, at, actor);
      database.exec("COMMIT");
      return idea(database.prepare("SELECT * FROM ideas WHERE id = ?").get(lastInsertRowid) as Row);
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  } finally { database.close(); }
}

/** Read-only view for pages: open ideas first (newest first), then the rest; no file means an empty pool. */
export function listIdeas(home: string, options: { open?: boolean; limit?: number; notes?: boolean } = {}): { available: boolean; ideas: (Idea & { notes?: IdeaNote[] })[]; openCount: number } {
  const path = ideasPath(home);
  if (!existsSync(path)) return { available: true, ideas: [], openCount: 0 };
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true, timeout: 1_000 });
    const open = OPEN_IDEA_STATUSES.map(status => `'${status}'`).join(",");
    const rows = database.prepare(`SELECT * FROM ideas ${options.open ? `WHERE status IN (${open})` : ""}
      ORDER BY status IN (${open}) DESC, updated_at DESC, id DESC LIMIT ?`).all(Math.min(Math.max(options.limit ?? 50, 1), 500)) as Row[];
    const { count } = database.prepare(`SELECT count(*) AS count FROM ideas WHERE status IN (${open})`).get() as { count: number };
    const notes = database.prepare("SELECT at, kind, text, actor FROM idea_notes WHERE idea_id = ? ORDER BY id");
    return { available: true, ideas: rows.map(row => options.notes ? { ...idea(row), notes: (notes.all(row.id) as IdeaNote[]).map(note => ({ ...note })) } : idea(row)), openCount: count };
  } catch { return { available: false, ideas: [], openCount: 0 }; }
  finally { database?.close(); }
}

export function readIdea(home: string, id: number): (Idea & { notes: IdeaNote[] }) | null {
  const path = ideasPath(home);
  if (!existsSync(path) || !Number.isSafeInteger(id) || id < 1) return null;
  const database = new DatabaseSync(path, { readOnly: true, timeout: 1_000 });
  try {
    const row = database.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as Row | undefined;
    if (!row) return null;
    const notes = (database.prepare("SELECT at, kind, text, actor FROM idea_notes WHERE idea_id = ? ORDER BY id").all(id) as IdeaNote[]).map(note => ({ ...note }));
    return { ...idea(row), notes };
  } finally { database.close(); }
}

function change(home: string, id: number, actor: string, now: Date, apply: (database: DatabaseSync, at: string, current: Row) => void): Idea {
  if (!Number.isSafeInteger(id) || id < 1) fail("Unknown idea");
  const database = writable(home);
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const current = database.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as Row | undefined;
      if (!current) fail("Unknown idea");
      const at = now.toISOString();
      apply(database, at, current!);
      database.prepare("UPDATE ideas SET updated_at = ? WHERE id = ?").run(at, id);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return idea(database.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as Row);
  } finally { database.close(); }
}

/** Adds a note to the idea's journal; notes are never edited or removed. */
export function addIdeaNote(home: string, id: number, note: unknown, actor: string, now = new Date()): Idea {
  const value = text(note, "The note", 2000, 1)!;
  return change(home, id, actor, now, (database, at) => {
    database.prepare("INSERT INTO idea_notes (idea_id, at, kind, text, actor) VALUES (?, ?, 'note', ?, ?)").run(id, at, value, actor);
  });
}

/** Moves the idea; "task" needs the issue it became. The change is journalled. */
export function setIdeaStatus(home: string, id: number, status: unknown, actor: string, options: { taskUrl?: unknown } = {}, now = new Date()): Idea {
  const next = oneOf(status, IDEA_STATUSES, "Status") ?? fail("Status is required");
  const taskUrl = options.taskUrl === undefined ? null : text(options.taskUrl, "Task link", 500);
  if (next === "task" && !(taskUrl && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(taskUrl))) fail("A task needs its GitHub issue link");
  return change(home, id, actor, now, (database, at, current) => {
    if (current.status === next) return;
    database.prepare("UPDATE ideas SET status = ?, task_url = COALESCE(?, task_url) WHERE id = ?").run(next, taskUrl, id);
    database.prepare("INSERT INTO idea_notes (idea_id, at, kind, text, actor) VALUES (?, ?, 'status', ?, ?)").run(id, at, taskUrl ? `${next} ${taskUrl}` : next, actor);
  });
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`--${name} needs a value`);
  return value;
}

/** CLI for the Hermes skill: capture, list, show, note, status. Prints one JSON object. */
export function runIdeasCli(args: string[], home = resolveKuramiHome("/home/shagon1k/_hermes/_kurami")): Record<string, unknown> {
  const [command, ...rest] = args, actor = option(rest, "actor") ?? "kurami";
  if (command === "capture") return { ok: true, idea: captureIdea(home, { summary: option(rest, "summary"), original: option(rest, "original"), context: option(rest, "context"), area: option(rest, "area"),
    firstStep: option(rest, "first-step"), horizon: option(rest, "when"), source: option(rest, "source") ?? "discord", key: option(rest, "key") }, actor) };
  if (command === "list") { const result = listIdeas(home, { open: rest.includes("--open"), limit: Number(option(rest, "limit") ?? 20) }); if (!result.available) fail("The ideas store cannot be read"); return { ok: true, ...result }; }
  const id = Number(rest[0]);
  if (command === "show") return { ok: true, idea: readIdea(home, id) ?? fail("Unknown idea") };
  if (command === "note") return { ok: true, idea: addIdeaNote(home, id, option(rest, "text"), actor) };
  if (command === "status") return { ok: true, idea: setIdeaStatus(home, id, option(rest, "to"), actor, { taskUrl: option(rest, "task-url") }) };
  return fail("Usage: ideas.ts capture --summary <text> [--original --context --area --first-step --when someday|month|soon --key] | list [--open] [--limit N] | show <id> | note <id> --text <text> | status <id> --to <status> [--task-url <issue>]");
}

if (import.meta.main) {
  try { process.stdout.write(`${JSON.stringify(runIdeasCli(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof IdeaError ? error.message : "The ideas store failed" })}\n`); process.exitCode = error instanceof IdeaError ? 2 : 1; }
}
