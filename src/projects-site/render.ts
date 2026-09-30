import { escapeHtml as escape } from "../ui-library/foundations/html.ts";
import { renderDocument } from "../ui-library/patterns/page-shell.ts";
import { renderSiteHeader } from "../ui-library/patterns/site-header.ts";
import { kuramiSites } from "../ui-library/patterns/kurami-sites.ts";
import { renderThemeSwitch } from "../ui-library/components/theme-switch.ts";
import { renderButton, renderLinkButton } from "../ui-library/components/button.ts";
import { renderTable } from "../ui-library/components/table.ts";
import { renderSearchField, renderSelectField } from "../ui-library/components/form.ts";
import { renderCallout } from "../ui-library/components/callout.ts";
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
  const table = items.length ? renderTable({ className: "projects-table", stack: true, rowHeaders: true, columns: ["Задача", "Проект", "Статус", "Kurami", "CI", "AI Review", "Превью"], rows: items.map(item => {
    const project = snapshot.projects.find(project => project.key === item.project)!;
    const identifier = item.number ? `#${item.number}` : item.kind === "DraftIssue" ? "Черновик" : item.kind;
    return [{ html: `<div class="projects-task" data-search="${escape(`${project.name} ${identifier} ${item.title} ${item.status ?? ""}`.toLowerCase())}">${renderLinkButton({ label: identifier, ariaLabel: `Открыть ${identifier}: ${item.title}`, href: itemUrl(params, item.id), variant: "subtle", size: "compact", attributes: { "data-item-link": item.id } })}<span>${escape(item.title)}</span>${needsOwner(item, project) ? '<small>Ждёт вашего решения</small>' : ""}</div>` }, project.name, item.status ?? "Без статуса",
      { html: `<div class="projects-stage"><span>${escape(label(item.stage ?? item.runState))}</span>${item.owner === "cli" ? "<small>AI Agent</small>" : item.owner === "remote" ? "<small>Управляете вы</small>" : ""}</div>` },
      { html: signal(item.ci) }, { html: `${signal(item.review)}${item.review.state === "ready" ? `<br><small>${item.review.critical + item.review.important + item.review.suggestions} замечаний</small>` : ""}` },
      { html: `${signal(item.preview)}${item.preview.state === "running" ? `<br><small>${item.preview.reviewed ? "Просмотрено" : "Не просмотрено"}</small>` : ""}` }];
  }) }) : renderCallout({ tone: "note", title: snapshot.available ? "Подходящих задач нет" : "Таблица недоступна", body: snapshot.available ? "Выберите другой проект или фильтр." : "Последний снимок задач сейчас прочитать не удалось." });
  return `<div class="projects-summary"><p><strong>${snapshot.items.length}</strong>всего задач</p><p><strong>${active}</strong>в работе</p><p><strong>${attention}</strong>ждут вас</p><p><strong data-visible-count>${items.length}</strong>показано</p></div>
    ${notice}${renderDisclosure({ className: "projects-freshness", summary: snapshot.projects.some(project => project.freshness !== "fresh") ? "Свежесть данных · есть задержки" : "Свежесть данных", body: `<ul class="list-reset">${freshness}</ul>`, open: snapshot.projects.some(project => project.freshness !== "fresh") })}
    <div class="projects-grid${selected ? " projects-grid--detail" : ""}"><div>${table}<p data-search-empty hidden>По вашему запросу ничего не найдено.</p></div>${selected ? detail(selected, params) : ""}</div>
    <p class="projects-update">Проверено ${escape(localTime(snapshot.generatedAt))} · время Вильнюса · обновление каждые 30 секунд</p>`;
}

function detail(item: ProjectItem, params: URLSearchParams): string {
  const links = navigation("Issue", item.links.issue) + navigation("PR", item.links.pr) + navigation("Discord", item.links.discord) + navigation("Review", item.links.review) + navigation("Preview", item.links.preview);
  return `<aside class="projects-detail" id="project-details" aria-labelledby="project-details-title" tabindex="-1"><div class="projects-detail-heading"><h2 id="project-details-title">${escape(item.title)}</h2>${renderLinkButton({ label: "Закрыть", href: itemUrl(params), variant: "subtle", size: "compact", attributes: { "data-item-close": true } })}</div>
    <dl><dt>Статус</dt><dd>${escape(item.status ?? "Без статуса")}</dd><dt>Kurami</dt><dd>${escape(label(item.stage ?? item.runState))}</dd>
      <dt>CI</dt><dd>${signal(item.ci)}</dd><dt>AI Review</dt><dd>${signal(item.review)}</dd><dt>Превью</dt><dd>${signal(item.preview)}</dd>
      ${item.ci.head ? `<dt>Коммит PR</dt><dd><code>${escape(item.ci.head.slice(0, 12))}</code></dd>` : ""}
      ${item.review.head ? `<dt>Коммит ревью</dt><dd><code>${escape(item.review.head.slice(0, 12))}</code></dd>` : ""}
      ${item.preview.expiresAt ? `<dt>Превью до</dt><dd>${escape(localTime(item.preview.expiresAt))}</dd>` : ""}
    </dl>${item.detail ? `<p>${escape(item.detail)}</p>` : ""}${item.review.state === "ready" ? `<p>Замечания: ${item.review.critical} критических, ${item.review.important} важных, ${item.review.suggestions} предложений.</p>` : ""}
    <div class="projects-links">${links}</div><p>Действия по задаче доступны в Discord и GitHub.</p><p class="projects-update">Состояние запуска: ${escape(localTime(item.runUpdatedAt))}</p></aside>`;
}

export function renderProjectsPage(snapshot: ProjectsSnapshot, params = new URLSearchParams()): string {
  const filters = parseFilters(params);
  const statuses = [...new Set(snapshot.items.map(item => item.status).filter((status): status is string => status !== null))].sort();
  const options = (values: { value: string; label: string }[]) => [{ value: "", label: "Все" }, ...values];
  return renderDocument({ lang: "ru", title: "Projects · Kurami", description: "Задачи и состояние работы по всем проектам.", favicon: "/assets/favicon.svg", styles: { href: "/assets/projects.css" }, themeScript: true,
    head: '<meta name="robots" content="noindex, nofollow"><script src="/assets/projects.js" defer></script>', skipLabel: "К содержанию",
    header: renderSiteHeader({ brand: { href: "/", ariaLabel: "Kurami Projects — все задачи", foxSrc: "/assets/kurami-fox.webp", suffix: "Projects" },
      nav: { label: "Представления", links: [{ href: "/", label: "Все задачи", current: "page" }] }, sites: kuramiSites("projects"), actions: renderThemeSwitch("ru") }),
    main: `<div class="projects-hero"><div><p class="projects-eyebrow">PROJECTS</p><h1>Все проекты. Одна таблица.</h1><p>Задачи, проверки и работа Kurami — с переходом к нужному действию.</p></div>${renderButton({ label: "Обновить", variant: "secondary", busyLabel: "Обновляем…", attributes: { "data-projects-refresh": true } })}</div>
      <form class="projects-filters" method="get">${renderSearchField({ name: "q", label: "Поиск", value: params.get("q") ?? "", placeholder: "Номер или название задачи" })}
        ${renderSelectField({ name: "project", label: "Проект", value: filters.project, options: options(snapshot.projects.map(project => ({ value: project.key, label: project.name }))) })}
        ${renderSelectField({ name: "view", label: "Показать", value: filters.view, options: [{ value: "all", label: "Все задачи" }, { value: "attention", label: "Ждут меня" }, { value: "active", label: "В работе" }, { value: "review", label: "На проверке" }] })}
        ${renderSelectField({ name: "status", label: "Статус", value: filters.status, options: options(statuses.map(status => ({ value: status, label: status }))) })}
        ${renderButton({ label: "Применить", variant: "subtle", type: "submit" })}</form>
      <p role="status" aria-live="polite" data-refresh-status></p><div id="projects-dashboard">${renderProjectsDashboard(snapshot, params)}</div>`,
    mainClass: "projects-page", footer: '<footer class="container projects-footer">Projects · Kurami</footer>',
  });
}
