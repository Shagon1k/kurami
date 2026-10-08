// The ideas pool on Projects: a small block under the task table. Ideas arrive through chats (the kurami-ideas
// skill); here the owner reads them and adds notes. Status changes and "make it a task" are asked in a chat. "Make it a task" files an issue in the chosen project
// (or Kurami) and records the link on the idea. The store and its rules live in src/system/ideas/ideas.ts.
import { addIdeaNote, IdeaError, listIdeas, type Idea, type IdeaNote, type IdeaStatus } from "../system/ideas/ideas.ts";
import { formatSiteDate } from "../ui-library/foundations/date.ts";
import { escapeHtml as escape } from "../ui-library/foundations/html.ts";
import { renderButton, renderLinkButton } from "../ui-library/components/button.ts";
import { renderDisclosure } from "../ui-library/components/disclosure.ts";
import { renderTextField } from "../ui-library/components/form.ts";
import { iconPath } from "../ui-library/components/icon.ts";
import { surfaceAttributes } from "../ui-library/components/surface.ts";
import { renderPill, type PillTone } from "../ui-library/components/pill.ts";
import { ProjectsActionError } from "./actions.ts";
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
  const t = (key: string) => tr(key, lang);
  const field = (label: string, value: string | null) => value ? `<div class="projects-idea__field"><dt>${escape(t(label))}</dt><dd>${escape(value)}</dd></div>` : "";
  const fields = [field("What prompted it", item.context), field("First step", item.firstStep), field("Original message", item.original)].join("");
  const forms = `<div class="projects-idea__actions">
    <form class="projects-idea__form" data-idea-form="note" data-idea="${item.id}">${renderTextField({ name: "note", label: t("Add a thought"), placeholder: t("A thought, a link, a decision"), required: true, maxLength: 2000, rows: 3 })}<div class="projects-idea__submit">${renderButton({ label: t("Add note"), variant: "secondary", type: "submit", busyLabel: "…" })}</div></form>
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
    : `<div class="projects-ideas__list">${view.ideas.map(item => renderDisclosure({ summary: item.summary, summaryHtml: ideaSummary(item, projects, lang), body: ideaBody(item, projects, lang), key: `idea:${item.id}`, group: "projects-ideas", className: "projects-ideas__item" })).join("")}</div>`;
  return `<section class="projects-ideas" id="projects-ideas" aria-labelledby="projects-ideas-title"${surfaceAttributes("panel")}><div class="projects-ideas__heading"><h2 id="projects-ideas-title">${escape(t("Ideas"))}</h2>${view?.openCount ? `<span class="projects-ideas__count">${view.openCount} ${escape(t(view.openCount === 1 ? "open idea" : "open ideas"))}</span>` : ""}<p class="projects-ideas__note">${escape(t("thoughts for later, not tasks"))}</p></div>${content}</section>`;
}

/** POST /api/ideas: a note on an idea. Moving an idea or making it a task is a chat request (the kurami-ideas skill). Errors are short Russian messages the page translates. */
export function createIdeasAction(options: { home: string; now?: () => Date }) {
  return async (input: unknown, actor: string) => {
    const value = (input ?? {}) as Record<string, unknown>, now = options.now?.() ?? new Date();
    try {
      const id = Number(value.id);
      if (value.action === "note") return { state: "noted", idea: addIdeaNote(options.home, id, value.note, actor, now) };
      throw new ProjectsActionError(400, "Некорректный запрос.");
    } catch (error) {
      if (error instanceof IdeaError) throw new ProjectsActionError(400, error.message === "Unknown idea" ? "Идея не найдена. Обнови страницу." : /gist/.test(error.message) ? "Суть идеи — от 3 до 200 символов." : "Проверь поля идеи.");
      throw error;
    }
  };
}
