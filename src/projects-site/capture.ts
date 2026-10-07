// Quick capture: "+" in the header (and Android's Share → Kurami) opens one field — what should happen — and
// a project. The request is queued in the orchestrator database and a short worker outside this service's
// sandbox files the issue: Kurami fills the repository's issue form from the note (quick-capture.ts). The page
// polls the request until it shows the issue.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { captureTargets as orchestratorTargets, type CaptureTarget } from "../orchestrator/projects/capture/quick-capture.ts";
import { openOrchestratorDatabase } from "../orchestrator/state/database.ts";
import { WEB_ORIGIN } from "../web/routes.ts";
import { ProjectsActionError } from "./actions.ts";

export type { CaptureTarget };
export const KURAMI_REPOSITORY = "Shagon1k/kurami";
const exec = promisify(execFile);

/** Managed projects from the registry, then Kurami itself. */
export function captureTargets(home: string): CaptureTarget[] {
  return orchestratorTargets(home);
}

/** Only pages of Kurami itself may be cited as the source. */
export function captureSource(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try { const url = new URL(value); return url.origin === WEB_ORIGIN ? url.href.slice(0, 500) : null; } catch { return null; }
}

/** Starts the worker for one request as its own transient user unit (the service itself is sandboxed); its
 * PATH reaches codex in ~/.local/bin, as the project poller's does. */
export type CaptureStarter = (home: string, key: string) => Promise<void>;
const systemdStarter: CaptureStarter = async (home, key) => {
  const node = process.execPath, worker = resolve(home, "app/src/orchestrator/projects/capture/quick-capture.ts");
  await exec("systemd-run", ["--user", "--collect", "--quiet", `--unit=kurami-capture-${key.slice(0, 32)}`, "-p", `Environment=PATH=${dirname(node)}:${homedir()}/.local/bin:/usr/local/bin:/usr/bin:/bin`,
    "-p", `Environment=KURAMI_HOME=${home}`, "--", node, worker, "--key", key], { timeout: 10_000 });
};

type Row = { project: string; request_state: string; issue_number: number | null; issue_url: string | null; on_board: number | null; filled_by: string | null; error: string | null };

export function createCaptureAction(options: { home: string; start?: CaptureStarter; now?: () => Date }) {
  const start = options.start ?? systemdStarter;
  const database = () => {
    const path = resolve(options.home, "state/orchestrator.db");
    if (!existsSync(path)) throw new ProjectsActionError(503, "Данные временно недоступны.");
    return openOrchestratorDatabase(path, { timeoutMs: 1_000 });
  };
  const view = (key: string, row: Row) => ({ key, state: row.request_state, project: row.project, number: row.issue_number, url: row.issue_url, onBoard: row.on_board === 1, filledBy: row.filled_by, error: row.request_state === "failed" ? row.error : null });
  return {
    async submit(input: unknown, actor: string) {
      const value = input as { project?: unknown; text?: unknown; source?: unknown; shared?: unknown; key?: unknown };
      const text = typeof value?.text === "string" ? value.text.trim() : "";
      const shared = typeof value?.shared === "string" ? value.shared.trim().slice(0, 1000) : "";
      if (!captureTargets(options.home).some(entry => entry.key === value?.project)) throw new ProjectsActionError(400, "Выбери проект.");
      if (text.length < 3 || text.length > 4000) throw new ProjectsActionError(400, "Опиши задачу: от 3 до 4000 символов.");
      if (typeof value.key !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(value.key)) throw new ProjectsActionError(400, "Некорректный запрос.");
      const key = value.key, at = (options.now?.() ?? new Date()).toISOString(), db = database();
      try {
        // A double tap or a retried request returns the request already queued.
        const previous = db.prepare("SELECT * FROM project_capture_requests WHERE capture_key=?").get(key) as Row | undefined;
        if (previous) return view(key, previous);
        db.prepare(`INSERT INTO project_capture_requests (capture_key, project, actor_subject, request_text, shared_text, source_url, request_state, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`).run(key, value.project as string, actor, text, shared || null, captureSource(value.source), at, at);
      } finally { db.close(); }
      try { await start(options.home, key); }
      catch {
        const failed = database();
        try { failed.prepare("UPDATE project_capture_requests SET request_state='failed', error=?, updated_at=? WHERE capture_key=? AND request_state='queued'").run("Kurami не смогла взяться за запрос.", at, key); } finally { failed.close(); }
        throw new ProjectsActionError(503, "Kurami сейчас не может взяться за запрос. Текст сохранён в форме — попробуй ещё раз.");
      }
      return { key, state: "queued", project: value.project as string };
    },
    status(key: string) {
      if (!/^[a-zA-Z0-9-]{8,64}$/.test(key)) throw new ProjectsActionError(400, "Некорректный запрос.");
      const db = database();
      try {
        const row = db.prepare("SELECT * FROM project_capture_requests WHERE capture_key=?").get(key) as Row | undefined;
        if (!row) throw new ProjectsActionError(404, "Запрос не найден.");
        return view(key, row);
      } finally { db.close(); }
    },
  };
}
