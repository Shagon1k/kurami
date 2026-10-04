import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../core/kurami-home.ts";
import { githubProjectFields, type ProjectFieldClient, type ProjectFieldSnapshot } from "../orchestrator/integrations/github/project-fields.ts";
import { ProjectsActionError } from "./actions.ts";
import { projectsRegistry } from "./snapshot.ts";
import { PROJECTS_STALE_AFTER_MS } from "./model.ts";
import {hasActivePrRequest} from "../orchestrator/controls/pr-boundary.ts";

import { observedStatusRequest, type StatusInput, type StatusResult, type StatusRequestRow, type StatusRequestState } from "./status-state.ts";
export type { StatusInput, StatusResult } from "./status-state.ts";
const activeStates = new Set<StatusRequestState>(["checking","writing","awaiting_sync","uncertain"]);
export function parseStatusInput(value: unknown): StatusInput {
  if (!value || typeof value !== "object") throw new ProjectsActionError(400,"Некорректный запрос статуса.");
  const input = value as StatusInput;
  if (![input.project,input.itemId,input.target,input.observedAt,input.key].every(field => typeof field === "string") ||
    !/^[a-z0-9_-]{1,100}$/.test(input.project) || !input.itemId || input.itemId.length > 200 || !input.target || input.target.length > 256 ||
    input.from !== null && (typeof input.from !== "string" || input.from.length > 256) ||
    input.observedAt.length > 64 || !Number.isFinite(Date.parse(input.observedAt)) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.key))
    throw new ProjectsActionError(400,"Некорректный запрос статуса.");
  return input;
}

/** Writes GitHub only. The normal poller retains exclusive ownership of item snapshots/events. */
export async function requestProjectStatus(value: unknown, actor: string, options: { home?: string; now?: () => Date; github?: ProjectFieldClient } = {}): Promise<StatusResult> {
  const input = parseStatusInput(value); const now = options.now ?? (() => new Date());
  const home = options.home ?? resolveKuramiHome(resolve(import.meta.dirname,"../../.."));
  const config = projectsRegistry(resolve(home,"config/projects.yaml"))[input.project];
  if (!config || !config.status_field || config.status_field.length > 256)
    throw new ProjectsActionError(409,"Статусы проекта изменились. Обновите страницу.");
  const databasePath = resolve(home,"state/orchestrator.db");
  if (!existsSync(databasePath)) throw new ProjectsActionError(503,"Данные временно недоступны.");
  const database = new DatabaseSync(databasePath,{ timeout:1_000 }); database.exec("PRAGMA foreign_keys=ON");
  const github = options.github ?? githubProjectFields;
  type Item = { status: string | null; last_seen_at: string; present: number; repository: string | null; content_type: string };
  const localItem = () => database.prepare("SELECT status,last_seen_at,present,repository,content_type FROM project_items WHERE project=? AND item_id=?").get(input.project,input.itemId) as Item | undefined;
  function validateLocal(): Item {
    const run=database.prepare("SELECT run_id FROM runs WHERE project=? AND item_id=? ORDER BY rowid DESC LIMIT 1").get(input.project,input.itemId) as {run_id:string}|undefined;
    if(run&&hasActivePrRequest(database,run.run_id))throw new ProjectsActionError(409,"GitHub is processing this PR action.");
    const item = localItem();
    if (!item?.present || !["Issue","PullRequest","DraftIssue"].includes(item.content_type) ||
      item.content_type !== "DraftIssue" && item.repository?.toLowerCase() !== config!.repository.toLowerCase())
      throw new ProjectsActionError(409,"Карточка больше недоступна в этом проекте.");
    const poll = database.prepare("SELECT last_captured_at,last_attempt_state FROM project_poll_state WHERE project=?").get(input.project) as {last_captured_at:string;last_attempt_state:string} | undefined;
    const age = now().getTime() - Date.parse(poll?.last_captured_at ?? "");
    if (!poll || poll.last_attempt_state !== "succeeded" || !Number.isFinite(age) || age < 0 || age >= PROJECTS_STALE_AFTER_MS)
      throw new ProjectsActionError(409,"Синхронизация задерживается. Дождитесь свежих данных.");
    if (item.status !== input.from || Date.parse(input.observedAt) > now().getTime() || now().getTime() - Date.parse(input.observedAt) >= PROJECTS_STALE_AFTER_MS)
      throw new ProjectsActionError(409,"Статус изменился или снимок устарел. Обновите страницу.");
    return item;
  }
  async function live(): Promise<ProjectFieldSnapshot> {
    const item = await github.read({owner:config!.owner,number:config!.project_number,fieldName:config!.status_field!,itemId:input.itemId});
    const local = localItem();
    if (item.itemId !== input.itemId || item.itemProjectId !== item.projectId || item.archived || !local?.present || item.kind !== local.content_type ||
      item.kind !== "DraftIssue" && item.repository?.toLowerCase() !== config!.repository.toLowerCase())
      throw new ProjectsActionError(409,"Карточка или её принадлежность проекту изменились.");
    return item;
  }
  const result = (row: StatusRequestRow): StatusResult => ({state:row.request_state,requestId:row.request_id,target:row.to_status});
  function setState(row: StatusRequestRow, state: StatusRequestState): StatusResult {
    database.prepare("UPDATE project_status_requests SET request_state=?,updated_at=? WHERE request_id=?").run(state,now().toISOString(),row.request_id);
    row.request_state=state; return result(row);
  }
  async function reconcile(row: StatusRequestRow): Promise<StatusResult> {
    const local = localItem();
    const observed = local ? observedStatusRequest(row,local.status,local.last_seen_at) : row.request_state;
    if (observed !== row.request_state) return setState(row,observed);
    if (!activeStates.has(row.request_state) || row.request_state === "awaiting_sync") return result(row);
    // A concurrent HTTP retry cannot replace an operation still executing. Restart recovery only reads GitHub.
    if (now().getTime() - Date.parse(row.updated_at) < 30_000) return result(row);
    try {
      const current = await live();
      if (current.status === row.to_status) return setState(row,"awaiting_sync");
      return setState(row,current.status === row.from_status ? "failed" : "conflict");
    } catch { return setState(row,"uncertain"); }
  }
  let row: StatusRequestRow;
  try {
    const key = "projects-status:" + createHash("sha256").update(JSON.stringify([actor,input.project,input.itemId,input.from,input.target,input.key])).digest("hex");
    const previous = database.prepare("SELECT * FROM project_status_requests WHERE idempotency_key=?").get(key) as StatusRequestRow | undefined;
    if (previous) return await reconcile(previous);
    if (!Object.values(config.statuses).includes(input.target))
      throw new ProjectsActionError(409,"Статусы проекта изменились. Обновите страницу.");
    database.exec("BEGIN IMMEDIATE");
    try {
      const active = database.prepare("SELECT * FROM project_status_requests WHERE project=? AND item_id=? AND request_state IN ('checking','writing','awaiting_sync','uncertain')").get(input.project,input.itemId) as StatusRequestRow | undefined;
      if (active) {
        const item = localItem(); const state = item ? observedStatusRequest(active,item.status,item.last_seen_at) : active.request_state;
        if (state !== active.request_state) setState(active,state);
        else {
          database.exec("COMMIT");
          if (active.to_status !== input.target || active.from_status !== input.from) throw new ProjectsActionError(409,"Предыдущее изменение статуса ещё не синхронизировано.");
          return await reconcile(active);
        }
      }
      validateLocal();
      row = {request_id:`psr_${randomUUID().replaceAll("-","")}`,project:input.project,item_id:input.itemId,from_status:input.from,to_status:input.target,
        request_state:"checking",client_key:input.key,updated_at:now().toISOString()};
      database.prepare("INSERT INTO project_status_requests(request_id,project,item_id,actor_subject,idempotency_key,client_key,from_status,to_status,request_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'checking',?,?)")
        .run(row.request_id,input.project,input.itemId,actor,key,input.key,input.from,input.target,row.updated_at,row.updated_at);
      database.exec("COMMIT");
    } catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
    let writing = false;
    try {
      const current = await live();
      if (current.status === input.target) return setState(row,"awaiting_sync");
      if (current.status !== input.from) return setState(row,"conflict");
      const matches = current.options.filter(option => option.name === input.target);
      if (matches.length !== 1) return setState(row,"conflict");
      validateLocal();
      const target = matches[0]!;
      const claim = database.prepare("UPDATE project_status_requests SET request_state='writing',github_project_id=?,github_field_id=?,github_option_id=?,github_item_updated_at=?,updated_at=? WHERE request_id=? AND request_state='checking'")
        .run(current.projectId,current.fieldId,target.id,current.updatedAt,now().toISOString(),row.request_id);
      if (claim.changes !== 1) throw new Error("Status write claim changed");
      row.request_state="writing"; writing=true;
      await github.write({projectId:current.projectId,fieldId:current.fieldId,itemId:input.itemId,optionId:target.id,mutationId:row.request_id});
      const confirmed = await live();
      if (confirmed.projectId !== current.projectId || confirmed.fieldId !== current.fieldId || confirmed.status !== input.target || confirmed.optionId !== target.id)
        return setState(row,"conflict");
      return setState(row,"awaiting_sync");
    } catch (error) { return setState(row,writing ? "uncertain" : error instanceof ProjectsActionError ? "conflict" : "failed"); }
  } finally { database.close(); }
}
