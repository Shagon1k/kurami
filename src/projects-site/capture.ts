// Backlog capture: "Записать в бэклог" and Android's Share → Kurami open a short form on Projects; this
// turns it into a GitHub issue. Kurami itself is not a managed project, so its ideas become plain issues.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { githubBacklog, type BacklogClient, type BacklogTarget } from "../orchestrator/integrations/github/backlog-capture.ts";
import { WEB_ORIGIN } from "../web/routes.ts";
import { ProjectsActionError } from "./actions.ts";

export const KURAMI_REPOSITORY = "Shagon1k/kurami";
export type CaptureTarget = { key: string; name: string; target: BacklogTarget };
type Registry = { projects?: Record<string, { owner?: string; project_number?: number; repository?: string; status_field?: string; statuses?: { backlog?: string } }> };

/** Managed projects from the registry, then Kurami itself. */
export function captureTargets(home: string): CaptureTarget[] {
  const registry = parse(readFileSync(resolve(home, "config/projects.yaml"), "utf8")) as Registry;
  const managed = Object.entries(registry.projects ?? {}).flatMap(([key, project]) => project.repository && project.owner && project.project_number && project.status_field && project.statuses?.backlog
    ? [{ key, name: project.repository.split("/")[1]!, target: { repository: project.repository, board: { owner: project.owner, number: project.project_number, statusField: project.status_field, backlog: project.statuses.backlog } } }] : []);
  return [...managed, { key: "kurami", name: "Kurami", target: { repository: KURAMI_REPOSITORY } }];
}

/** Only pages of Kurami itself may be cited as the source. */
export function captureSource(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try { const url = new URL(value); return url.origin === WEB_ORIGIN ? url.href.slice(0, 500) : null; } catch { return null; }
}

export function createCaptureAction(options: { home: string; client?: BacklogClient; now?: () => Date }) {
  const client = options.client ?? githubBacklog, seen = new Map<string, { at: number; result: object }>();
  return async (input: unknown, _identity: string) => {
    const value = input as { project?: unknown; title?: unknown; note?: unknown; source?: unknown; shared?: unknown; key?: unknown };
    const target = captureTargets(options.home).find(entry => entry.key === value?.project);
    const title = typeof value?.title === "string" ? value.title.trim().replace(/\s+/g, " ") : "";
    const note = typeof value?.note === "string" ? value.note.trim() : "";
    const shared = typeof value?.shared === "string" ? value.shared.trim().slice(0, 1000) : "";
    if (!target) throw new ProjectsActionError(400, "Выбери проект.");
    if (title.length < 3 || title.length > 200) throw new ProjectsActionError(400, "Заголовок — от 3 до 200 символов.");
    if (note.length > 4000) throw new ProjectsActionError(400, "Описание слишком длинное.");
    if (typeof value.key !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(value.key)) throw new ProjectsActionError(400, "Некорректный запрос.");
    // A double tap or a retried request returns the issue already created.
    const now = (options.now?.() ?? new Date()).getTime();
    for (const [key, entry] of seen) if (now - entry.at > 30 * 60_000) seen.delete(key);
    const previous = seen.get(value.key);
    if (previous) return previous.result;
    const source = captureSource(value.source);
    const body = [note, shared && `> ${shared.replace(/\n/g, "\n> ")}`, source && `Страница: ${source}`, "_Записано через Kurami._"].filter(Boolean).join("\n\n");
    let issue;
    try { issue = await client.create(target.target, title, body); }
    catch { throw new ProjectsActionError(503, "GitHub сейчас недоступен. Текст сохранён в форме — попробуй ещё раз."); }
    const result = { state: "created", project: target.key, number: issue.number, url: issue.url, onBoard: issue.onBoard };
    seen.set(value.key, { at: now, result });
    return result;
  };
}
