import { escapeHtml as escape } from "../ui-library/foundations/html.ts";
import { randomUUID } from "node:crypto";
import { renderDocument } from "../ui-library/patterns/page-shell.ts";
import { renderSiteHeader } from "../ui-library/patterns/site-header.ts";
import { kuramiSites } from "../ui-library/patterns/kurami-sites.ts";
import { renderThemeSwitch } from "../ui-library/components/theme-switch.ts";
import { renderButton, renderLinkButton } from "../ui-library/components/button.ts";
import { renderTable } from "../ui-library/components/table.ts";
import { renderSearchField, renderSelectField } from "../ui-library/components/form.ts";
import { renderCallout } from "../ui-library/components/callout.ts";
import { renderIcon, iconPath, type IconName } from "../ui-library/components/icon.ts";
import { renderDisclosure } from "../ui-library/components/disclosure.ts";
import { needsOwner, parseFilters, selectItems, type ProjectItem, type ProjectsSnapshot, type Signal } from "./model.ts";

const labels: Record<string, string> = {
  none: "—", unknown: "Неизвестно", pending: "Ожидается", queued: "В очереди", passed: "Пройден", failed: "Ошибка", missing: "Нет проверок",
  running: "Выполняется", ready: "Готово", outdated: "Устарело", superseded: "Устарело", succeeded: "Завершено", unverified: "Не подтверждено", expired: "Истекло",
  admission_pending: "Ожидает допуска", starting: "Запускается", waiting_human: "Ждёт вас", parked_review: "Готово к проверке",
  remote_owned: "У вас", handoff_pending: "Передача управления", needs_attention: "Нужно внимание", stopping: "Останавливается",
  cancelled: "Отменён", archived: "Завершён", rejected: "Не допущен", discarded: "Удалён", completed: "Завершён",
  review_ready: "Готово к проверке", ci_repair_queued: "Исправление CI в очереди", ci_repair_working: "Исправляет CI",
  review_fix_queued: "Исправления ревью в очереди", review_fix_working: "Исправляет замечания", review_fix_waiting: "Проверяет исправления",
  review_fix_resolving: "Закрывает замечания", preview_queued: "Превью в очереди", preview_ready: "Превью готово", preview_failed: "Ошибка превью",
  preview_stopping: "Останавливает превью", cancelling: "Отменяется", cancelled_work_preserved: "Работа сохранена",
  preview_required: "Ждёт просмотра превью",
  request_failed: "Не запущено",
  leased: "Ожидается", provisioning: "Запускается", releasing: "Останавливается", released: "Остановлено",
};
const label = (value: string | null) => value ? labels[value] ?? value : "—";
export function localTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Неизвестно";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Vilnius", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function signal(value: Signal): string {
  return `<span class="projects-signal projects-signal--${value.tone}">${escape(label(value.state))}</span>`;
}
function check(name: string, icon: IconName, value: Signal): string {
  return `<span class="projects-check">${renderIcon(icon)}<span class="projects-check-name">${name}</span>${signal(value)}</span>`;
}
function itemUrl(params: URLSearchParams, id?: string): string {
  const next = new URLSearchParams(params);
  next.delete("item");
  if (id) next.set("item", id);
  return "/" + (next.size ? `?${next}` : "");
}
function navigation(label: string, raw: string | null): string {
  if (!raw) return "";
  try { const url = new URL(raw); if (url.protocol !== "https:" || url.username || url.password) return ""; }
  catch { return ""; }
  return renderLinkButton({ label, href: raw, variant: "subtle", size: "compact" });
}

export function renderProjectsDashboard(snapshot: ProjectsSnapshot, params = new URLSearchParams()): string {
  const filters = parseFilters(params);
  const items = selectItems(snapshot, filters);
  const selected = items.find(item => item.id === params.get("item") && (!params.get("project") || item.project === params.get("project")));
  const attention = snapshot.items.filter(item => needsOwner(item, snapshot.projects.find(project => project.key === item.project)!)).length;
  const active = snapshot.items.filter(item => item.status === snapshot.projects.find(project => project.key === item.project)?.statuses.active).length;
  const notice = snapshot.available ? "" : renderCallout({ tone: "warning", title: "Данные временно недоступны", body: "Попробуйте обновить страницу. Текущее состояние можно проверить в GitHub и Discord." });
  const freshness = snapshot.projects.map(project => `<li><a href="${escape(project.boardUrl)}">${escape(project.name)}</a><span class="projects-signal projects-signal--${project.freshness === "fresh" ? "neutral" : "warning"}">${project.freshness === "fresh" ? "Обновлено" : project.freshness === "stale" ? "Данные устарели" : "Нет снимка"} · ${escape(localTime(project.capturedAt))}</span></li>`).join("");
  const table = items.length ? renderTable({ className: "projects-table", stack: true, rowHeaders: true,
    columns: ["Задача", "GitHub", "Kurami", "Проверки"],
    rowClassNames: items.map(item => `projects-row${needsOwner(item, snapshot.projects.find(project => project.key === item.project)!) ? " projects-row--attention" : ""}${selected?.id === item.id && selected?.project === item.project ? " projects-row--selected" : ""}`),
    rows: items.map(item => {
      const project = snapshot.projects.find(project => project.key === item.project)!;
      const identifier = item.number ? `#${item.number}` : item.kind === "DraftIssue" ? "Черновик" : item.kind;
      const checks = [item.ci.state !== "none" ? check("CI", "ci", item.ci) : "", item.review.state !== "none" ? check("Review", "review", item.review) : "", item.preview.state !== "none" ? check("Превью", "preview", item.preview) : ""].join("");
      return [{ html: `<div class="projects-task" data-search="${escape(`${project.name} ${identifier} ${item.title} ${item.status ?? ""}`.toLowerCase())}"><div class="projects-task-meta">${renderIcon("project")}<span>${escape(project.name)}</span><span class="projects-task-id">${escape(identifier)}</span>${needsOwner(item, project) ? `<span class="projects-attention" title="Ждёт вашего решения">${renderIcon("alert")}<span class="sr-only">Ждёт вашего решения</span></span>` : ""}</div>${renderLinkButton({ label: item.title, ariaLabel: `Открыть ${identifier}: ${item.title}`, href: itemUrl(params, item.id), variant: "text", attributes: { "data-item-link": item.id } })}</div>` },
        { html: `<span class="projects-status">${escape(item.status ?? "Без статуса")}</span>` },
        { html: `<div class="projects-stage"><span>${escape(label(item.stage ?? item.runState))}</span>${item.owner === "cli" ? `<small>${renderIcon("cpu")}AI Agent</small>` : item.owner === "remote" ? "<small>Управляете вы</small>" : ""}</div>` },
        { html: checks ? `<div class="projects-checks">${checks}</div>` : '<span class="projects-signal projects-signal--neutral">—</span>' }];
    }) }) : renderCallout({ tone: "note", title: snapshot.available ? "Подходящих задач нет" : "Таблица недоступна", body: snapshot.available ? "Выберите другой проект или фильтр." : "Последний снимок задач сейчас прочитать не удалось." });
  const delayed = snapshot.projects.filter(project => project.freshness !== "fresh").length;
  return `<div class="projects-overview"><div class="projects-summary"><p>${renderIcon("project")}<span><strong data-visible-count>${items.length}</strong> из ${snapshot.items.length} задач</span></p><p>${renderIcon("work")}<span><strong>${active}</strong> в работе</span></p><p class="${attention ? "projects-attention" : ""}">${renderIcon("alert")}<span><strong>${attention}</strong> ждут вас</span></p></div>
    ${renderDisclosure({ className: "projects-freshness", summary: delayed ? `Синхронизация · задержки: ${delayed}` : "Синхронизация · актуально", body: `<ul class="list-reset">${freshness}</ul><p class="projects-update">Проверено ${escape(localTime(snapshot.generatedAt))} · Вильнюс · обновление каждые 30 секунд</p>` })}</div>
    ${notice}<div class="projects-grid${selected ? " projects-grid--detail" : ""}"><div class="projects-table-frame">${table}<p data-search-empty hidden>По вашему запросу ничего не найдено.</p></div>${selected ? detail(selected, params, snapshot.projects.find(project => project.key === selected.project)!.name) : ""}</div>`;
}

function detail(item: ProjectItem, params: URLSearchParams, projectName: string): string {
  const links = navigation("Issue", item.links.issue) + navigation("PR", item.links.pr) + navigation("Discord", item.links.discord) + navigation("Review", item.links.review) + navigation("Preview", item.links.preview);
  const reviewReasons: Record<string, string> = { pending: "Ревью или другое действие уже в работе.", unstable: "Ревью доступно после завершения текущей работы.", no_head: "Текущий коммит PR ещё не подтверждён.", ready: "Ревью этого коммита уже готово.", stale: "Дождитесь свежих данных синхронизации.", superseded: "Этот запуск больше не актуален." };
  const action = item.aiReview && item.runId ? `<div class="projects-review-action">${renderButton({ label: "AI Review", variant: "primary", disabled: !item.aiReview.enabled, busyLabel: "Отправляем…", attributes: { "data-review-run": item.runId, "data-review-project": item.project, "data-review-item": item.id, "data-review-head": item.aiReview.head ?? "", "data-review-key": randomUUID() } })}<p>${item.aiReview.enabled ? `Для коммита <code>${escape(item.aiReview.head?.slice(0,12) ?? "")}</code>` : escape(reviewReasons[item.aiReview.reason] ?? "Ревью сейчас недоступно.")}</p></div>` : "";
  return `<aside class="projects-detail" id="project-details" aria-labelledby="project-details-title" tabindex="-1"><p class="projects-detail-meta">${renderIcon("project")}${escape(projectName)} · ${item.number ? `#${item.number}` : "Черновик"}</p><div class="projects-detail-heading"><h2 id="project-details-title">${escape(item.title)}</h2>${renderLinkButton({ label: "Закрыть", href: itemUrl(params), variant: "subtle", size: "compact", attributes: { "data-item-close": true } })}</div>
    <dl><dt>Статус</dt><dd>${escape(item.status ?? "Без статуса")}</dd><dt>Kurami</dt><dd>${escape(label(item.stage ?? item.runState))}</dd>
      <dt>${renderIcon("ci")}CI</dt><dd>${signal(item.ci)}</dd><dt>${renderIcon("review")}AI Review</dt><dd>${signal(item.review)}</dd><dt>${renderIcon("preview")}Превью</dt><dd>${signal(item.preview)}</dd>
      ${item.ci.head ? `<dt>Коммит PR</dt><dd><code>${escape(item.ci.head.slice(0, 12))}</code></dd>` : ""}
      ${item.review.head ? `<dt>Коммит ревью</dt><dd><code>${escape(item.review.head.slice(0, 12))}</code></dd>` : ""}
      ${item.preview.expiresAt ? `<dt>Превью до</dt><dd>${escape(localTime(item.preview.expiresAt))}</dd>` : ""}
    </dl>${item.detail ? `<p>${escape(item.detail)}</p>` : ""}${item.review.state === "ready" ? `<p>Замечания: ${item.review.critical} критических, ${item.review.important} важных, ${item.review.suggestions} предложений.</p>` : ""}
    ${item.reviewRequestFailed ? renderCallout({ tone: "warning", title: "AI Review не запустилось", body: "Обновите данные и повторите запрос для текущего коммита PR." }) : ""}${action}<div class="projects-links">${links}</div>${item.runUpdatedAt ? `<p class="projects-update">Состояние запуска: ${escape(localTime(item.runUpdatedAt))}</p>` : ""}</aside>`;
}

export function renderProjectsPage(snapshot: ProjectsSnapshot, params = new URLSearchParams()): string {
  const filters = parseFilters(params);
  const statuses = [...new Set(snapshot.items.map(item => item.status).filter((status): status is string => status !== null))].sort();
  const options = (values: { value: string; label: string }[]) => [{ value: "", label: "Все" }, ...values];
  return renderDocument({ lang: "ru", title: "Projects · Kurami", description: "Задачи и состояние работы по всем проектам.", favicon: "/assets/favicon.svg", styles: { href: "/assets/projects.css" }, themeScript: true,
    head: '<meta name="robots" content="noindex, nofollow"><script src="/assets/projects.js" defer></script>', skipLabel: "К содержанию",
    header: renderSiteHeader({ brand: { href: "/", ariaLabel: "Kurami Projects — все задачи", foxSrc: "/assets/kurami-fox.webp", suffix: "Projects" },
      nav: { label: "Представления", links: [{ href: "/", label: "Все задачи", current: "page" }] }, sites: kuramiSites("projects"), actions: renderThemeSwitch("ru") }),
    main: `<h1 class="sr-only">Задачи</h1>
      <form class="projects-filters" method="get">${renderSearchField({ name: "q", label: "Поиск", value: params.get("q") ?? "", placeholder: "Номер или название задачи" })}
        ${renderSelectField({ name: "project", label: "Проект", value: filters.project, options: options(snapshot.projects.map(project => ({ value: project.key, label: project.name }))) })}
        ${renderSelectField({ name: "view", label: "Показать", value: filters.view, options: [{ value: "all", label: "Все задачи" }, { value: "attention", label: "Ждут меня" }, { value: "active", label: "В работе" }, { value: "review", label: "На проверке" }] })}
        ${renderSelectField({ name: "status", label: "Статус", value: filters.status, options: options(statuses.map(status => ({ value: status, label: status }))) })}
        <div class="projects-filter-actions">${renderButton({ label: "Применить", variant: "subtle", type: "submit" })}${renderButton({ label: "Обновить данные", ariaLabel: "Обновить данные", iconPath: iconPath("refresh"), variant: "icon", busyLabel: "…", attributes: { "data-projects-refresh": true } })}</div></form>
      <p role="status" aria-live="polite" data-refresh-status></p><div id="projects-dashboard">${renderProjectsDashboard(snapshot, params)}</div>`,
    mainClass: "projects-page", footer: "",
  });
}
