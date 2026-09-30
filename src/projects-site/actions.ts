import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../core/kurami-home.ts";
import { inspectAiReview, reviewContextMatches } from "../orchestrator/controls/ai-review.ts";
import { projectsRegistry } from "./snapshot.ts";
import { PROJECTS_STALE_AFTER_MS } from "./model.ts";

export type ReviewInput = { runId: string; project: string; itemId: string; head: string; key: string };
export type ReviewResult = { state: "created" | "existing"; requestId: string; requestState: string };
export class ProjectsActionError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function parseReviewInput(value: unknown): ReviewInput {
  if (!value || typeof value !== "object") throw new ProjectsActionError(400, "Некорректный запрос.");
  const input = value as ReviewInput;
  if (![input.runId,input.project,input.itemId,input.head,input.key].every(field => typeof field === "string") ||
    !/^r_[A-Za-z0-9_]+$/.test(input.runId ?? "") || input.runId.length > 200 ||
    !/^[a-z0-9_-]+$/.test(input.project ?? "") || input.project.length > 100 ||
    typeof input.itemId !== "string" || !input.itemId || input.itemId.length > 200 ||
    !/^[a-f0-9]{7,64}$/.test(input.head ?? "") || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.key ?? ""))
    throw new ProjectsActionError(400, "Некорректный запрос.");
  return input;
}

/** Enqueues only; the controller owns worker startup and the existing Discord projection. */
export function requestProjectsReview(value: unknown, actor: string, options: { home?: string; now?: Date } = {}): ReviewResult {
  const input = parseReviewInput(value);
  const home = options.home ?? resolveKuramiHome(resolve(import.meta.dirname, "../../.."));
  const configs = projectsRegistry(resolve(home, "config/projects.yaml"));
  const project = configs[input.project];
  if (!project) throw new ProjectsActionError(409, "Проект больше недоступен. Обновите страницу.");
  const databasePath = resolve(home, "state/orchestrator.db");
  if (!existsSync(databasePath)) throw new ProjectsActionError(503, "Данные временно недоступны.");
  const database = new DatabaseSync(databasePath, { timeout: 1_000 });
  let began = false;
  try {
    database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE"); began = true;
    // Missing schema support fails before any write. The origin never runs migrations.
    database.prepare("SELECT request_id FROM run_control_project_context LIMIT 1").get();
    const idempotencyKey = "projects:" + createHash("sha256").update(JSON.stringify([actor,input.runId,input.head,input.key])).digest("hex");
    const previous = database.prepare("SELECT request_id,request_state FROM run_control_requests WHERE idempotency_key=?").get(idempotencyKey) as
      { request_id: string; request_state: string } | undefined;
    if (previous) { database.exec("COMMIT"); began = false; return { state: "existing", requestId: previous.request_id, requestState: previous.request_state }; }
    const inspection = inspectAiReview(database, input.runId);
    if (!inspection || inspection.project !== input.project || inspection.itemId !== input.itemId || inspection.repository.toLowerCase() !== project.repository.toLowerCase())
      throw new ProjectsActionError(409, "Запуск задачи изменился. Обновите страницу.");
    const now = (options.now ?? new Date()).getTime();
    const poll = database.prepare("SELECT last_captured_at,last_attempt_state FROM project_poll_state WHERE project=?").get(input.project) as { last_captured_at: string; last_attempt_state: string } | undefined;
    const age = now - Date.parse(poll?.last_captured_at ?? "");
    if (!poll || poll.last_attempt_state !== "succeeded" || !Number.isFinite(age) || age < 0 || age >= PROJECTS_STALE_AFTER_MS)
      throw new ProjectsActionError(409, "Синхронизация задерживается. Дождитесь свежих данных.");
    if (inspection.head !== input.head) throw new ProjectsActionError(409, "Коммит изменился. Обновите страницу перед AI Review.");
    const pr = new URL(inspection.prUrl ?? "https://invalid.local");
    if (pr.origin !== "https://github.com" || pr.username || pr.password || pr.search || pr.hash ||
      !new RegExp(`^/${project.repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pull/[1-9][0-9]*$`).test(pr.pathname))
      throw new ProjectsActionError(409, "Текущий PR не подтверждён. Обновите страницу.");
    const pending = database.prepare("SELECT request_id,request_state FROM run_control_requests WHERE run_id=? AND action='ai_review' AND request_state IN ('pending','processing')").get(input.runId) as { request_id: string; request_state: string } | undefined;
    if (pending) {
      if (!reviewContextMatches(database, pending.request_id, input.head, pr.href)) throw new ProjectsActionError(409, "Ревью другого коммита уже в очереди. Дождитесь его результата.");
      database.exec("COMMIT"); began = false; return { state: "existing", requestId: pending.request_id, requestState: pending.request_state };
    }
    if (!inspection.eligible) throw new ProjectsActionError(409, inspection.reason === "ready" ? "Для этого коммита AI Review уже готово." : "AI Review сейчас недоступно. Обновите страницу.");
    const requestId = `rq_${randomUUID().replaceAll("-", "")}`;
    database.prepare("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key) VALUES(?,?,'ai_review','projects',?)").run(requestId,input.runId,idempotencyKey);
    database.prepare("INSERT INTO run_control_project_context(request_id,actor_subject,expected_head_sha,expected_pull_request_url) VALUES(?,?,?,?)").run(requestId,actor,input.head,pr.href);
    database.exec("COMMIT"); began = false;
    return { state: "created", requestId, requestState: "pending" };
  } finally { if (began) database.exec("ROLLBACK"); database.close(); }
}
