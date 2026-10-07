// Quick capture ("+" in the header): the owner writes what should happen in a sentence or two; Kurami picks the
// fitting issue form of the project's repository (.github/ISSUE_TEMPLATE/*.yml), fills its fields from that text
// and files the issue (on the board in Backlog for a managed project). The model only writes the issue text: it
// runs read-only and returns JSON that is checked here; GitHub writes are this module's. When the model cannot
// help, the issue is filed as written, so a capture is never lost. One request per run: `--key <capture key>`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parse } from "yaml";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { runDetachedReview } from "../../integrations/codex/app-server.ts";
import { githubBacklog, type BacklogClient, type BacklogTarget } from "../../integrations/github/backlog-capture.ts";
import { openOrchestratorDatabase } from "../../state/database.ts";
import { serializeUntrustedPromptData } from "../../security/prompt-safety.ts";

process.umask(0o077);

export type FormField = { id: string; label: string; type: string; required: boolean; options?: string[] };
export type IssueForm = { file: string; name: string; description: string; title: string; labels: string[]; fields: FormField[] };
export type CaptureTarget = { key: string; name: string; target: BacklogTarget; workspace: string | null };
export type FilledIssue = { template: string | null; title: string; sections: { label: string; value: string }[]; labels: string[] };
type Fill = (instructions: string, schema: Record<string, unknown>) => Promise<unknown>;

/** The repository's issue forms; config.yml and anything unreadable are skipped. */
export function loadIssueForms(workspace: string | null): IssueForm[] {
  const directory = workspace ? resolve(workspace, ".github/ISSUE_TEMPLATE") : null;
  if (!directory || !existsSync(directory)) return [];
  return readdirSync(directory).filter(file => /\.ya?ml$/.test(file) && !/^config\.ya?ml$/.test(file)).sort().flatMap(file => {
    try {
      const form = parse(readFileSync(resolve(directory, file), "utf8")) as { name?: unknown; description?: unknown; title?: unknown; labels?: unknown; body?: unknown };
      if (typeof form?.name !== "string" || !Array.isArray(form.body)) return [];
      const fields = (form.body as { type?: string; id?: string; attributes?: { label?: string; options?: unknown[] }; validations?: { required?: boolean } }[])
        .filter(field => field.type && field.type !== "markdown" && typeof field.attributes?.label === "string")
        .map(field => ({ id: field.id ?? field.attributes!.label!, label: field.attributes!.label!, type: field.type!, required: field.validations?.required === true,
          ...(Array.isArray(field.attributes?.options) ? { options: field.attributes!.options!.map(option => typeof option === "string" ? option : String((option as { label?: string }).label ?? "")).filter(Boolean) } : {}) }));
      const labels = Array.isArray(form.labels) ? form.labels.filter((label): label is string => typeof label === "string") : typeof form.labels === "string" ? form.labels.split(",").map(label => label.trim()).filter(Boolean) : [];
      return [{ file, name: form.name, description: typeof form.description === "string" ? form.description : "", title: typeof form.title === "string" ? form.title : "", labels, fields }];
    } catch { return []; }
  });
}

export const FILL_SCHEMA = {
  type: "object", additionalProperties: false, required: ["template", "title", "sections"],
  properties: {
    template: { type: ["string", "null"], description: "The chosen form's file name, or null when no form fits or the repository has none" },
    title: { type: "string", minLength: 3, maxLength: 200 },
    sections: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string", maxLength: 4000 } } } },
  },
} as const;

export function captureInstructions(target: CaptureTarget, forms: IssueForm[], text: string, shared: string | null): string {
  return [
    `You turn the owner's quick note into one GitHub issue for ${target.name} (${target.target.repository}). Write in the owner's language.`,
    forms.length
      ? "Pick the one issue form below that fits, and fill its fields: one section per field you can fill, using the field's label exactly. Required fields must be filled; for a dropdown use one of its options. Do not invent facts the note does not support: write what is known and mark open questions as such. The title follows the form's title prefix if it has one."
      : "The repository has no issue forms: set template to null and write three short sections labelled «Что», «Зачем» and «Как понять, что готово» (or What / Why / Done when, in English).",
    "Return only JSON matching the schema. Never include secrets.",
    `Issue forms: ${serializeUntrustedPromptData(forms.map(form => ({ file: form.file, name: form.name, description: form.description, title: form.title, fields: form.fields })))}`,
    `Owner's note: ${serializeUntrustedPromptData({ text, shared })}`,
  ].join("\n\n");
}

/** Checks the model's answer against the forms; anything off is a failure, and the caller files the note as written. */
export function checkFilledIssue(answer: unknown, forms: IssueForm[]): FilledIssue {
  const value = (typeof answer === "string" ? JSON.parse(/```(?:json)?\s*([\s\S]*?)```/u.exec(answer)?.[1] ?? answer) : answer) as Partial<{ template: unknown; title: unknown; sections: unknown }>;
  const form = value.template === null ? null : forms.find(entry => entry.file === value.template);
  if (value.template !== null && !form) throw new Error("Unknown issue form");
  if (typeof value.title !== "string" || value.title.trim().length < 3 || value.title.length > 200) throw new Error("Invalid title");
  if (!Array.isArray(value.sections) || value.sections.length > 20) throw new Error("Invalid sections");
  const sections = value.sections.map(section => {
    const { label, value: text } = section as { label?: unknown; value?: unknown };
    if (typeof label !== "string" || typeof text !== "string" || text.length > 4000) throw new Error("Invalid section");
    if (form && !form.fields.some(field => field.label === label)) throw new Error(`Unknown field: ${label}`);
    return { label, value: text.trim() };
  }).filter(section => section.value);
  for (const field of form?.fields.filter(field => field.required) ?? []) if (!sections.some(section => section.label === field.label)) throw new Error(`Required field missing: ${field.label}`);
  return { template: form?.file ?? null, title: value.title.trim().replace(/\s+/g, " "), sections, labels: form?.labels ?? [] };
}

/** Issue-form markdown: "### Label" sections, then the owner's own words for the record. */
export function issueBody(filled: Pick<FilledIssue, "sections">, text: string, shared: string | null, source: string | null): string {
  const original = [text, shared && `> ${shared.replace(/\n/g, "\n> ")}`, source && `Страница: ${source}`].filter(Boolean).join("\n\n");
  return [...filled.sections.map(section => `### ${section.label}\n\n${section.value}`),
    `<details><summary>Исходная заметка</summary>\n\n${original}\n\n</details>`, "_Записано через Kurami._"].join("\n\n");
}

/** The note as written, when the model is unavailable or its answer fails the checks. */
export function plainIssue(text: string): { title: string; sections: { label: string; value: string }[] } {
  const firstLine = text.split("\n").find(line => line.trim())?.trim() ?? text.trim();
  return { title: (firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine) || "Заметка", sections: [] };
}

/** Managed projects from the registry, then Kurami itself; the workspace is where the issue forms live. */
export function captureTargets(home: string): CaptureTarget[] {
  const registry = (parse(readFileSync(resolve(home, "config/projects.yaml"), "utf8")) as { projects?: Record<string, { owner?: string; project_number?: number; repository?: string; status_field?: string; statuses?: { backlog?: string }; workspace?: { canonical_repository?: string } }> }).projects ?? {};
  const managed = Object.entries(registry).flatMap(([key, project]) => project.repository && project.owner && project.project_number && project.status_field && project.statuses?.backlog
    ? [{ key, name: project.repository.split("/")[1]!, workspace: project.workspace?.canonical_repository ?? null, target: { repository: project.repository, board: { owner: project.owner, number: project.project_number, statusField: project.status_field, backlog: project.statuses.backlog } } }] : []);
  return [...managed, { key: "kurami", name: "Kurami", workspace: resolve(home, "app"), target: { repository: "Shagon1k/kurami" } }];
}

type Row = { capture_key: string; project: string; request_text: string; shared_text: string | null; source_url: string | null; request_state: string };

/** Files one queued capture. Idempotent: a request that is no longer queued is left alone. */
export async function processCapture(home: string, key: string, deps: { fill?: Fill; client?: BacklogClient; now?: () => Date } = {}): Promise<{ state: string; number?: number; filledBy?: string }> {
  const database = openOrchestratorDatabase(resolve(home, "state/orchestrator.db"));
  const stamp = () => (deps.now?.() ?? new Date()).toISOString();
  try {
    const claimed = database.prepare("UPDATE project_capture_requests SET request_state='writing', updated_at=? WHERE capture_key=? AND request_state='queued'").run(stamp(), key);
    if (claimed.changes !== 1) return { state: "skipped" };
    const row = database.prepare("SELECT * FROM project_capture_requests WHERE capture_key=?").get(key) as Row;
    const target = captureTargets(home).find(entry => entry.key === row.project);
    if (!target) {
      database.prepare("UPDATE project_capture_requests SET request_state='failed', error=?, updated_at=? WHERE capture_key=?").run("Проект больше недоступен.", stamp(), key);
      return { state: "failed" };
    }
    const forms = loadIssueForms(target.workspace);
    let filled: FilledIssue | null = null, reason: string | null = null;
    for (let attempt = 1; attempt <= 2 && !filled; attempt++) {
      try { filled = checkFilledIssue(await (deps.fill ?? defaultFill(home, target, attempt))(captureInstructions(target, forms, row.request_text, row.shared_text), FILL_SCHEMA as unknown as Record<string, unknown>), forms); }
      catch (error) { reason = error instanceof Error ? error.message.slice(0, 300) : "fill failed"; }
    }
    const issue = filled ?? { ...plainIssue(row.request_text), template: null, labels: [] };
    try {
      const created = await (deps.client ?? githubBacklog).create(target.target, issue.title, issueBody(issue, row.request_text, row.shared_text, row.source_url), issue.labels);
      database.prepare(`UPDATE project_capture_requests SET request_state='created', template=?, filled_by=?, issue_number=?, issue_url=?, on_board=?, error=?, updated_at=? WHERE capture_key=?`)
        .run(issue.template, filled ? "kurami" : "plain", created.number, created.url, created.onBoard ? 1 : 0, filled ? null : reason, stamp(), key);
      return { state: "created", number: created.number, filledBy: filled ? "kurami" : "plain" };
    } catch {
      database.prepare("UPDATE project_capture_requests SET request_state='failed', error=?, updated_at=? WHERE capture_key=?").run("GitHub сейчас недоступен.", stamp(), key);
      return { state: "failed" };
    }
  } finally { database.close(); }
}

/** The read-only Codex turn the metadata proposals use; its JSON answer is checked by checkFilledIssue. */
function defaultFill(home: string, target: CaptureTarget, attempt: number): Fill {
  return async (instructions, schema) => {
    const codexBin = process.env.CODEX_BIN?.trim() || execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
    const result = await runDetachedReview(codexBin, { cwd: resolve(home, "app"), title: `${target.name} · quick capture · attempt ${attempt}/2`, instructions, outputSchema: schema, timeoutMs: 180_000 });
    return result.review;
  };
}

if (import.meta.main) {
  const index = process.argv.indexOf("--key"), key = index > 0 ? process.argv[index + 1] : undefined;
  if (!key || !/^[a-zA-Z0-9-]{8,64}$/.test(key)) { process.stderr.write(`${JSON.stringify({ ok: false, error: "Usage: quick-capture.ts --key <capture key>" })}\n`); process.exitCode = 2; }
  else processCapture(resolveKuramiHome("/home/shagon1k/_hermes/_kurami"), key).then(result => process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`))
    .catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`); process.exitCode = 1; });
}
