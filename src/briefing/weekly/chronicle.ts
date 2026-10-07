// Weekly's view of the project chronicle (src/orchestrator/projects/chronicle.ts): the same week Hub shows,
// told in the Digest style at the end of the review. Nothing is rendered for a quiet week.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { readChronicle, type ChronicleDay, type ChronicleKind } from "../../orchestrator/projects/chronicle.ts";
import type { ProjectStatuses } from "../../orchestrator/projects/status-read-model.ts";
import { surfaceAttributes } from "../../ui-library/components/surface.ts";
import { escapeHtml as e } from "../ui/html.ts";
import { digestLanguage, digestText as t } from "../i18n.ts";

const WORDS: Record<ChronicleKind, [string, string]> = {
  started: ["взята в работу", "started"], review: ["отправлена на ревью", "sent to review"], returned: ["вернулась в работу", "returned to work"],
  done: ["завершена", "done"], ci_repair: ["исправление CI", "CI repair"], ai_review: ["AI Review", "AI Review"],
};

export function weeklyChronicle(home: string, now: Date): { days: ChronicleDay[]; names: Record<string, string> } | null {
  try {
    const registry = (parse(readFileSync(resolve(home, "config/projects.yaml"), "utf8")) as { projects?: Record<string, { statuses: ProjectStatuses; repository?: string }> }).projects ?? {};
    const days = readChronicle(resolve(home, "state/orchestrator.db"), registry, now);
    return days ? { days, names: Object.fromEntries(Object.entries(registry).map(([key, project]) => [key, project.repository?.split("/")[1] ?? key])) } : null;
  } catch { return null; }
}

export function renderWeeklyChronicle(chronicle: { days: ChronicleDay[]; names: Record<string, string> } | null): string {
  if (!chronicle?.days.length) return "";
  const date = (day: string) => new Intl.DateTimeFormat(digestLanguage() === "en" ? "en-GB" : "ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
  const days = chronicle.days.map(day => `<li><h3>${e(date(day.day))}</h3><ul>${day.events.map(event => `<li data-kind="${event.kind}"><strong>${e(chronicle.names[event.project] ?? event.project)}${event.issue ? ` #${event.issue}` : ""}</strong> ${e(t(...WORDS[event.kind]))}${event.title ? ` — ${e(event.title)}` : ""}</li>`).join("")}</ul></li>`).join("");
  return `<section class="weekly-chronicle"${surfaceAttributes("panel")} aria-labelledby="weekly-chronicle-heading"><h2 id="weekly-chronicle-heading">${t("Летопись проектов", "The week in projects")}</h2><ol class="weekly-chronicle__days" tabindex="0" aria-labelledby="weekly-chronicle-heading">${days}</ol></section>`;
}

export const WEEKLY_CHRONICLE_STYLES = `
.weekly-chronicle { margin-top: 36px; padding: 24px; border: 1px solid var(--border-default); background: var(--surface-panel); border-radius: var(--radius); }
.weekly-chronicle h2 { margin: 0 0 16px; }
/* A busy week scrolls inside the block instead of stretching the page (focusable, so the keyboard scrolls it too). */
.weekly-chronicle .weekly-chronicle__days { max-height: 26rem; overflow-y: auto; overscroll-behavior: contain; padding-inline-end: 6px; }
.weekly-chronicle__days:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 4px; }
.weekly-chronicle ol, .weekly-chronicle ul { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.weekly-chronicle h3 { margin: 0 0 6px; color: var(--text-muted); font-size: .8rem; font-weight: 600; }
.weekly-chronicle h3::first-letter { text-transform: uppercase; }
.weekly-chronicle li li { padding-inline-start: 14px; border-inline-start: 2px solid var(--border-default); font-size: .9rem; overflow-wrap: anywhere; }
.weekly-chronicle li li[data-kind="done"] { border-color: var(--status-success); }
.weekly-chronicle li li[data-kind="returned"] { border-color: var(--status-warning); }
`;
