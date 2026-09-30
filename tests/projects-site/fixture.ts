import type { ProjectItem, ProjectsSnapshot } from "../../src/projects-site/model.ts";

export function syntheticProjectsSnapshot(): ProjectsSnapshot {
  const statuses = { backlog: "Backlog", active: "In progress", review: "Human Review", done: "Done", deferred: "Deferred" };
  const snapshot: ProjectsSnapshot = { generatedAt: "2026-09-30T10:00:00Z", available: true,
    projects: [
      { key: "alpha", name: "Alpha", repository: "Example/Alpha", boardUrl: "https://github.com/users/Example/projects/1", statuses, capturedAt: "2026-09-30T09:59:30Z", freshness: "fresh" },
      { key: "beta", name: "Beta", repository: "Example/Beta", boardUrl: "https://github.com/users/Example/projects/2", statuses, capturedAt: "2026-09-30T09:54:00Z", freshness: "stale" },
    ], items: [] };
  function item(index: number, fields: Partial<ProjectItem>): ProjectItem {
    return { id: `item-${index}`, project: "alpha", number: index, title: "Синтетическая задача", kind: "Issue", status: "Backlog",
      observedAt: snapshot.generatedAt, runUpdatedAt: null, runId: null, runState: null, stage: null, detail: null, owner: null,
      ci: { state: "none", tone: "neutral", head: null }, review: { state: "none", tone: "neutral", head: null, critical: 0, important: 0, suggestions: 0 },
      preview: { state: "none", tone: "neutral", head: null, expiresAt: null, reviewed: false }, attention: [],
      links: { issue: `https://github.com/Example/Alpha/issues/${index}`, pr: null, discord: null, review: null, preview: null }, ...fields };
  }
  snapshot.items = [
    item(12, { title: "Обновить экран поиска и проверить пустое состояние", status: "Human Review", runId: "r_review", runState: "parked_review", stage: "review_ready", runUpdatedAt: snapshot.generatedAt,
      detail: "Изменения готовы. Проверьте PR и текущий коммит перед запуском нового ревью.",
      ci: { state: "passed", tone: "success", head: "abcdef0123456789" },
      review: { state: "outdated", tone: "warning", head: "1234567890abcdef", critical: 0, important: 1, suggestions: 2 },
      links: { issue: "https://github.com/Example/Alpha/issues/12", pr: "https://github.com/Example/Alpha/pull/20", discord: "https://discord.com/channels/100/200", review: null, preview: null } }),
    item(13, { title: "Исправить сбой интеграционной проверки", status: "In progress", runId: "r_work", runState: "running", stage: "ci_repair_working", owner: "cli", runUpdatedAt: snapshot.generatedAt,
      ci: { state: "failed", tone: "failure", head: "abcdef0123456789" } }),
    item(24, { project: "beta", title: "Уточнить поведение формы перед продолжением", status: "In progress", runId: "r_attention", runState: "waiting_human", stage: "waiting_human",
      attention: [{ code: "owner_input", severity: "warning" }] }),
    item(25, { project: "beta", title: "Добавить длинное описание без потери переносов на мобильном экране", status: "Backlog" }),
    item(14, { title: "Завершённая задача", status: "Done", runState: "archived", stage: "completed" }),
  ];
  return snapshot;
}
