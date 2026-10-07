// The ideas pool on Projects: a small block under the task table. Ideas arrive through chats (the kurami-ideas
// skill); here the owner reads them, adds notes, moves them and turns one into a task. Nothing here starts work. "Make it a task" files an issue in the chosen project
// (or Kurami) and records the link on the idea. The store and its rules live in src/system/ideas/ideas.ts.
import { githubBacklog, type BacklogClient } from "../orchestrator/integrations/github/backlog-capture.ts";
import { addIdeaNote, IdeaError, listIdeas, readIdea, setIdeaStatus, type Idea, type IdeaNote, type IdeaStatus } from "../system/ideas/ideas.ts";
import { formatSiteDate } from "../ui-library/foundations/date.ts";
import { escapeHtml as escape } from "../ui-library/foundations/html.ts";
import { renderButton, renderLinkButton } from "../ui-library/components/button.ts";
import { renderDisclosure } from "../ui-library/components/disclosure.ts";
import { renderSelectField, renderTextField } from "../ui-library/components/form.ts";
import { iconPath, renderIcon } from "../ui-library/components/icon.ts";
import { surfaceAttributes } from "../ui-library/components/surface.ts";
import { renderPill, type PillTone } from "../ui-library/components/pill.ts";
import { ProjectsActionError } from "./actions.ts";
import { captureTargets } from "./capture.ts";
import { tr, type Language } from "./i18n.ts";
import type { ProjectSummary } from "./model.ts";

export type IdeasView = { available: boolean; openCount: number; ideas: (Idea & { notes?: IdeaNote[] })[] };
/** Open ideas for the block, newest activity first, with their journals. */
export function collectIdeasView(home: string): IdeasView {
  return listIdeas(home, { open: true, limit: 20, notes: true });
}

const STATUS_TONE: Record<IdeaStatus, PillTone> = { new: "info", thinking: "warning", task: "success", parked: "neutral", closed: "neutral" };
const STATUS_LABEL: Record<IdeaStatus, string> = { new: "New idea", thinking: "Thinking", task: "Became a task", parked: "Parked", closed: "Closed" };
const HORIZON_LABEL: Record<string, string> = { someday: "Someday", month: "This month", soon: "Soon" };

/** Where an idea can belong: the managed projects, Kurami itself, or anything else in life. */
export function ideaAreas(projects: ProjectSummary[], lang: Language): { value: string; label: string }[] {
  return [...projects.map(project => ({ value: project.key, label: project.name })), { value: "kurami", label: "Kurami" }, { value: "other", label: tr("Other", lang) }];
}

const when = (value: string, lang: Language) => formatSiteDate(value, lang, false);

function journal(notes: IdeaNote[], lang: Language): string {
  const t = (key: string) => tr(key, lang);
  const line = (note: IdeaNote) => note.kind === "note" ? escape(note.text) : `${t("Status")}: ${escape(t(STATUS_LABEL[note.text.split(" ")[0] as IdeaStatus] ?? note.text))}`;
  return notes.length ? `<ol class="projects-idea__journal list-reset">${notes.slice(-8).map(note => `<li><time datetime="${escape(note.at)}">${escape(when(note.at, lang))}</time><span>${line(note)}</span></li>`).join("")}</ol>` : "";
}

function ideaBody(item: Idea & { notes?: IdeaNote[] }, projects: ProjectSummary[], lang: Language): string {
  const t = (key: string) => tr(key, lang), taskTargets = ideaAreas(projects, lang).filter(entry => entry.value !== "other");
  const field = (label: string, value: string | null) => value ? `<div class="projects-idea__field"><dt>${escape(t(label))}</dt><dd>${escape(value)}</dd></div>` : "";
  const fields = [field("What prompted it", item.context), field("First step", item.firstStep), field("Original message", item.original)].join("");
  const forms = `<div class="projects-idea__actions">
    <form class="projects-idea__form" data-idea-form="note" data-idea="${item.id}">${renderTextField({ name: "note", label: t("Add a note"), placeholder: t("A thought, a link, a decision"), required: true, maxLength: 2000, rows: 2 })}<div class="projects-idea__submit">${renderButton({ label: t("Add note"), variant: "subtle", size: "compact", type: "submit", busyLabel: "…" })}</div></form>
    <div class="projects-idea__row">
    <form class="projects-idea__form projects-idea__form--row" data-idea-form="status" data-idea="${item.id}">${renderSelectField({ name: "status", label: t("Status"), value: item.status, options: (["new", "thinking", "parked", "closed"] as const).map(value => ({ value, label: t(STATUS_LABEL[value]) })) })}${renderButton({ label: t("Save"), variant: "subtle", size: "compact", type: "submit", busyLabel: "…" })}</form>
    <form class="projects-idea__form projects-idea__form--row" data-idea-form="task" data-idea="${item.id}">${renderSelectField({ name: "target", label: t("Make it a task in"), value: taskTargets.some(entry => entry.value === item.area) ? item.area! : "kurami", options: taskTargets })}${renderButton({ label: t("Create issue"), variant: "secondary", size: "compact", type: "submit", busyLabel: "…", iconPath: iconPath("plus"), visibleLabel: true, attributes: { "data-haptic": "confirm" } })}</form>
    </div>
  </div>`;
  return `<div class="projects-idea">${fields ? `<dl class="projects-idea__fields">${fields}</dl>` : ""}${journal(item.notes ?? [], lang)}${item.taskUrl ? renderLinkButton({ label: t("Open the task"), href: item.taskUrl, variant: "link", iconPath: iconPath("arrow") }) : forms}</div>`;
}

/** The folded row: number, gist, then where it belongs, when, and the day it was saved. */
function ideaSummary(item: Idea, projects: ProjectSummary[], lang: Language): string {
  const t = (key: string) => tr(key, lang), area = ideaAreas(projects, lang).find(entry => entry.value === item.area)?.label;
  const tags = [item.status === "thinking" && renderPill({ label: t(STATUS_LABEL.thinking), tone: STATUS_TONE.thinking }), area && `<span>${escape(area)}</span>`,
    item.horizon && `<span>${escape(t(HORIZON_LABEL[item.horizon]!))}</span>`, `<time datetime="${escape(item.createdAt)}">${escape(when(item.createdAt, lang))}</time>`].filter(Boolean).join("");
  return `<span class="projects-idea__head"><span class="projects-idea__number">#${item.id}</span><span class="projects-idea__gist">${escape(item.summary)}</span><span class="projects-idea__tags">${tags}</span></span>`;
}

/** The block under the task table: open ideas, each folded; empty and unreadable states say so plainly. */
export function renderIdeasBlock(view: IdeasView | undefined, projects: ProjectSummary[], lang: Language): string {
  const t = (key: string) => tr(key, lang);
  const content = !view?.available ? `<p class="projects-ideas__empty">${escape(t("Ideas cannot be read right now."))}</p>`
    : !view.ideas.length ? `<p class="projects-ideas__empty">${escape(t("No open ideas. Tell any Kurami chat: “save an idea: …”."))}</p>`
    : `<div class="projects-ideas__list">${view.ideas.map(item => renderDisclosure({ summary: item.summary, summaryHtml: ideaSummary(item, projects, lang), body: ideaBody(item, projects, lang), key: `idea:${item.id}`, className: "projects-ideas__item" })).join("")}</div>`;
  return `<section class="projects-ideas" id="projects-ideas" aria-labelledby="projects-ideas-title"${surfaceAttributes("panel")}><div class="projects-ideas__heading">${renderIcon("spark", { tile: true })}<h2 id="projects-ideas-title">${escape(t("Ideas"))}</h2>${view?.openCount ? `<span class="projects-ideas__count">${view.openCount}</span>` : ""}<p class="projects-ideas__note">${escape(t("thoughts for later, not tasks"))}</p></div>${content}</section>`;
}

/** POST /api/ideas: note, status, task. Errors are short Russian messages the page translates. */
export function createIdeasAction(options: { home: string; client?: BacklogClient; now?: () => Date }) {
  const client = options.client ?? githubBacklog, inFlight = new Set<number>();
  return async (input: unknown, actor: string) => {
    const value = (input ?? {}) as Record<string, unknown>, now = options.now?.() ?? new Date();
    try {
      const id = Number(value.id);
      if (value.action === "note") return { state: "noted", idea: addIdeaNote(options.home, id, value.note, actor, now) };
      if (value.action === "status") {
        if (!["new", "thinking", "parked", "closed"].includes(String(value.status))) throw new ProjectsActionError(400, "Некорректный запрос.");
        return { state: "moved", idea: setIdeaStatus(options.home, id, value.status, actor, {}, now) };
      }
      if (value.action === "task") {
        const idea = readIdea(options.home, id);
        if (!idea) throw new ProjectsActionError(404, "Идея не найдена. Обнови страницу.");
        if (idea.status === "task" && idea.taskUrl) return { state: "task", idea, url: idea.taskUrl };
        const target = captureTargets(options.home).find(entry => entry.key === value.target);
        if (!target) throw new ProjectsActionError(400, "Выбери проект.");
        if (inFlight.has(id)) throw new ProjectsActionError(409, "Задача уже создаётся.");
        inFlight.add(id);
        try {
          const body = [idea.context && `**Что натолкнуло:** ${idea.context}`, idea.firstStep && `**Первый шаг:** ${idea.firstStep}`,
            idea.original && `> ${idea.original.replace(/\n/g, "\n> ")}`, `_Из пула идей Kurami (идея #${idea.id})._`].filter(Boolean).join("\n\n");
          let issue;
          try { issue = await client.create(target.target, idea.summary, body); }
          catch { throw new ProjectsActionError(503, "GitHub сейчас недоступен. Идея осталась в пуле — попробуй ещё раз."); }
          return { state: "task", idea: setIdeaStatus(options.home, id, "task", actor, { taskUrl: issue.url }, now), url: issue.url, onBoard: issue.onBoard };
        } finally { inFlight.delete(id); }
      }
      throw new ProjectsActionError(400, "Некорректный запрос.");
    } catch (error) {
      if (error instanceof IdeaError) throw new ProjectsActionError(400, error.message === "Unknown idea" ? "Идея не найдена. Обнови страницу." : /gist/.test(error.message) ? "Суть идеи — от 3 до 200 символов." : "Проверь поля идеи.");
      throw error;
    }
  };
}
