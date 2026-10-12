import { parseReviewProfile, type ReviewProfile } from "../orchestrator/projects/reviews/profiles.ts";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../core/kurami-home.ts";
import { availableRunControls, requestRunControl, type Action } from "../orchestrator/controls/run.ts";
import { acknowledgePreview } from "../orchestrator/projects/previews/manager.ts";
import { reviewContextMatches } from "../orchestrator/controls/ai-review.ts";
import { ProjectsActionError, type ReviewResult } from "./actions.ts";
import { projectsRegistry } from "./snapshot.ts";
import { PROJECTS_STALE_AFTER_MS } from "./model.ts";
import {hasActivePrRequest} from "../orchestrator/controls/pr-boundary.ts";
import { openOrchestratorDatabase } from "../orchestrator/state/database.ts";

export const RUN_ACTIONS = ["take_control","preview_start","preview_stop","preview_reviewed","ci_repair","review_fix","recover_managed_task","stop","discard_local","discard_published"] as const;
export type RunAction = typeof RUN_ACTIONS[number];
export type RunActionInput = {runId:string;project:string;itemId:string;action:RunAction;fingerprint:string;key:string;confirmed:boolean;profile?:ReviewProfile};
export type RunActionView = {fingerprint:string;reason:string;actions:{action:RunAction;label:string;enabled:boolean;confirmation:string|null;hint:string|null;state:string|null}[]};
type Pending = {review_profile:ReviewProfile;request_id:string;action:string;request_state:string;requested_via:string};
type Run = Record<string,unknown> & {available_actions:string[]};
const labels: Record<RunAction,string> = {take_control:"Взять управление",preview_start:"Запустить превью",preview_stop:"Убрать превью",preview_reviewed:"Превью проверено",
  ci_repair:"Исправить CI",review_fix:"Исправить замечания",recover_managed_task:"Восстановить исправление",stop:"Отменить запуск",discard_local:"Удалить локальную работу",discard_published:"Закрыть draft PR и удалить работу"};
const destructive = new Set<RunAction>(["discard_local","discard_published"]);

function fingerprint(run: Run): string {
  return createHash("sha256").update(JSON.stringify([run.run_id,run.project,run.item_id,run.state,run.owner_state,run.stop_reason,run.execution_mode,
    run.resource_state,run.branch_name,run.worktree_path,run.codex_thread_id,run.previous_codex_thread_id,run.tmux_session_name,run.ci_head_sha,run.ci_pull_request_url,
    run.preview_lease_id,run.preview_state,run.preview_verified_head_sha,run.preview_artifact_digest,run.preview_expires_at,run.preview_reviewed_at])).digest("hex");
}
function readRun(database: DatabaseSync, runId: string, home: string, now: Date, profile: ReviewProfile = "general"): Run {
  return availableRunControls(database,runId,{home,now:now.getTime(),profile}) as Run;
}
function candidates(run: Run, now: Date): Set<string> {
  const choices = new Set(run.available_actions);
  if (run.stop_reason === "cancelled" && run.state === "needs_attention" && run.owner_state === "none") {
    choices.delete("take_control"); choices.delete("stop");
    choices.add(run.ci_pull_request_url ? "discard_published" : "discard_local");
  }
  if (run.preview_state === "running" && !run.preview_reviewed_at && Date.parse(String(run.preview_expires_at)) > now.getTime() &&
    run.preview_verified_head_sha && run.preview_verified_head_sha === run.ci_head_sha && !["rejected","cancelled","archived","failed"].includes(String(run.state)))
    choices.add("preview_reviewed");
  return choices;
}

/** Reads the existing control menu. Paths and worker payloads never enter this view. */
export function projectRunActions(database: DatabaseSync, runId: string, home: string, now: Date, fresh: boolean, profile: ReviewProfile = "general"): RunActionView {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_action_requests'").get())
    return {fingerprint:"",reason:"unavailable",actions:[]};
  const run = readRun(database,runId,home,now,profile);
  const eligible = candidates(run,now);
  const prPending=hasActivePrRequest(database,runId);
  const requests = database.prepare("SELECT request_id,action,request_state,requested_via,review_profile FROM run_control_requests WHERE run_id=? ORDER BY rowid DESC").all(runId) as Pending[];
  const actions = RUN_ACTIONS.flatMap(action => {
    const latest = requests.find(request => request.action === action && (action !== "review_fix" || request.review_profile === profile));
    const pending = latest && ["pending","processing"].includes(latest.request_state);
    if (!eligible.has(action) && !pending && !["failed","rejected"].includes(latest?.request_state ?? "")) return [];
    const label = action === "take_control" ? run.take_control_autonomous ? "Продолжить автономно" : run.owner_state === "none" ? "Продолжить в Codex" : labels[action] :
      action === "preview_start" && run.preview_state === "running" ? "Продлить превью на 24 ч" : labels[action];
    return [{action,label,enabled:eligible.has(action) && fresh && run.execution_mode === "live" && !pending&&!prPending,confirmation:destructive.has(action) ?
      action === "discard_published" ? "Закрыть draft PR и удалить сохранённую ветку и локальную работу? Это действие нельзя отменить." : "Удалить сохранённую локальную работу? Это действие нельзя отменить." : null,
      hint:action === "take_control" && run.owner_state === "remote" ? "Нажатие подтверждает, что текущая Remote-задача завершена. Kurami запустит продолжение." :
        action === "take_control" && run.owner_state === "cli" ? "Kurami остановит текущий ход и передаст вам управление." : null,
      state:latest && ["pending","processing","failed","rejected"].includes(latest.request_state) ? latest.request_state : null}];
  });
  return {fingerprint:fingerprint(run),reason:fresh ? "eligible" : "stale",actions};
}

export function parseRunActionInput(value: unknown): RunActionInput {
  if (!value || typeof value !== "object") throw new ProjectsActionError(400,"Некорректный запрос действия.");
  const input = value as RunActionInput;
  if (![input.runId,input.project,input.itemId,input.action,input.fingerprint,input.key].every(field => typeof field === "string") ||
    !/^r_[A-Za-z0-9_]{1,198}$/.test(input.runId) || !/^[a-z0-9_-]{1,100}$/.test(input.project) || !input.itemId || input.itemId.length > 200 ||
    !RUN_ACTIONS.includes(input.action) || !/^[a-f0-9]{64}$/.test(input.fingerprint) || typeof input.confirmed !== "boolean" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.key))
    throw new ProjectsActionError(400,"Некорректный запрос действия.");
  try { const profile = parseReviewProfile(input.profile);
    if (profile !== "general" && input.action !== "review_fix") throw new Error();
    return {...input,profile};
  } catch { throw new ProjectsActionError(400,"Unsupported review profile."); }
}

/** One transaction joins owner intent to the shared queue or preview acknowledgement. */
export function requestProjectRunAction(value: unknown, actor: string, options: {home?:string;now?:Date} = {}): ReviewResult {
  const input = parseRunActionInput(value);
  if (destructive.has(input.action) && !input.confirmed) throw new ProjectsActionError(409,"Подтвердите удаление сохранённой работы.");
  const home = options.home ?? resolveKuramiHome(resolve(import.meta.dirname,"../../..")); const now = options.now ?? new Date();
  const project = projectsRegistry(resolve(home,"config/projects.yaml"))[input.project];
  if (!project) throw new ProjectsActionError(409,"Проект больше недоступен.");
  const path = resolve(home,"state/orchestrator.db");
  if (!existsSync(path)) throw new ProjectsActionError(503,"Данные временно недоступны.");
  const database = openOrchestratorDatabase(path,{timeoutMs:1000}); let began = false;
  try {
    database.exec("BEGIN IMMEDIATE"); began=true;
    const key = "projects-action:" + createHash("sha256").update(JSON.stringify([actor,input.runId,input.project,input.itemId,input.action,input.profile,input.fingerprint,input.key])).digest("hex");
    const previous = database.prepare("SELECT a.request_id,q.request_state FROM project_action_requests a LEFT JOIN run_control_requests q ON q.request_id=a.request_id WHERE a.idempotency_key=?").get(key) as {request_id:string|null;request_state:string|null} | undefined;
    if (previous) { database.exec("COMMIT"); began=false; return {state:"existing",requestId:previous.request_id ?? key,requestState:previous.request_state ?? "applied"}; }
    if(hasActivePrRequest(database,input.runId))throw new ProjectsActionError(409,"GitHub is processing this PR action.");
    const item = database.prepare("SELECT p.present,EXISTS(SELECT 1 FROM runs n WHERE n.project=r.project AND n.item_id=r.item_id AND n.rowid>r.rowid) AS superseded FROM runs r JOIN project_items p ON p.project=r.project AND p.item_id=r.item_id WHERE r.run_id=? AND r.project=? AND r.item_id=? AND lower(r.repository)=lower(?)").get(input.runId,input.project,input.itemId,project.repository) as {present:number;superseded:number} | undefined;
    if (!item?.present || item.superseded) throw new ProjectsActionError(409,"Запуск задачи изменился. Обновите страницу.");
    const poll = database.prepare("SELECT last_captured_at,last_attempt_state FROM project_poll_state WHERE project=?").get(input.project) as {last_captured_at:string;last_attempt_state:string} | undefined;
    const age = now.getTime()-Date.parse(poll?.last_captured_at ?? "");
    if (!poll || poll.last_attempt_state !== "succeeded" || !Number.isFinite(age) || age < 0 || age >= PROJECTS_STALE_AFTER_MS)
      throw new ProjectsActionError(409,"Синхронизация задерживается. Дождитесь свежих данных.");
    const run = readRun(database,input.runId,home,now,input.profile);
    if (run.execution_mode !== "live" || fingerprint(run) !== input.fingerprint)
      throw new ProjectsActionError(409,"Состояние запуска изменилось. Обновите страницу перед действием.");
    const pending = database.prepare("SELECT request_id,requested_via,request_state,review_profile FROM run_control_requests WHERE run_id=? AND action=? AND request_state IN ('pending','processing') ORDER BY rowid DESC LIMIT 1").get(input.runId,input.action) as Pending | undefined;
    let requestId: string | null = null; let requestState = "applied"; let existing = false;
    if (pending) {
      if (input.action === "review_fix" && pending.review_profile !== input.profile) throw new ProjectsActionError(409,"Another review profile is already queued. Wait for its result.");
      if (["ci_repair","review_fix"].includes(input.action) && !reviewContextMatches(database,pending.request_id,String(run.ci_head_sha),String(run.ci_pull_request_url)))
        throw new ProjectsActionError(409,"Действие другого коммита уже в очереди.");
      requestId=pending.request_id; requestState=pending.request_state; existing=true;
    } else {
      if (!candidates(run,now).has(input.action)) throw new ProjectsActionError(409,"Действие сейчас недоступно. Обновите страницу.");
      if (input.action === "preview_reviewed") acknowledgePreview(database,input.runId,"projects:"+createHash("sha256").update(actor).digest("hex"),true,{now:now.getTime()});
      else {
        try {
          const result = requestRunControl(database,input.runId,input.action as Action,"projects",true,{home,idempotencyKey:key,profile:input.profile});
          requestId=String(result.requestId ?? result.request_id); requestState=String(result.requestState ?? result.request_state); existing=result.action === "existing";
        } catch { throw new ProjectsActionError(409,"Действие больше недоступно. Обновите страницу."); }
        if (["ci_repair","review_fix"].includes(input.action)) {
          const pr = String(run.ci_pull_request_url); const head = String(run.ci_head_sha);
          if (!/^[a-f0-9]{7,64}$/.test(head) || !pr.startsWith(`https://github.com/${project.repository}/pull/`) || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(pr))
            throw new ProjectsActionError(409,"Текущий PR и коммит не подтверждены.");
          database.prepare("INSERT INTO run_control_project_context(request_id,actor_subject,expected_head_sha,expected_pull_request_url) VALUES(?,?,?,?)").run(requestId,actor,head,pr);
        }
      }
    }
    database.prepare("INSERT INTO project_action_requests(idempotency_key,run_id,actor_subject,action,fingerprint,confirmed,request_id,preview_lease_id) VALUES(?,?,?,?,?,?,?,?)")
      .run(key,input.runId,actor,input.action,input.fingerprint,Number(input.confirmed),requestId,input.action === "preview_reviewed" ? String(run.preview_lease_id) : null);
    database.exec("COMMIT"); began=false;
    return {state:existing ? "existing" : "created",requestId:requestId ?? key,requestState};
  } finally { if(began) database.exec("ROLLBACK"); database.close(); }
}
