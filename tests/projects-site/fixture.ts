import type { ProjectItem, ProjectsSnapshot } from "../../src/projects-site/model.ts";

export function syntheticCiChecks(repository="Example/Alpha"): NonNullable<ProjectItem["ci"]["checks"]> {
  return ["Secret scan","Lint, type-check, test","Integration and runtime smoke","UI smoke","Production images","Delivery gate"].map((name,index)=>({name,state:"passed",detailsUrl:`https://github.com/${repository}/actions/runs/100/job/${200+index}#step:2:1`}));
}

export function syntheticProjectsSnapshot(): ProjectsSnapshot {
  const statuses = { backlog: "Backlog", active: "In progress", review: "Human Review", done: "Done", deferred: "Deferred" };
  const snapshot: ProjectsSnapshot = { generatedAt: "2026-09-30T10:00:00Z", available: true,
    projects: [
      { key: "alpha", name: "Alpha", color: "teal", repository: "Example/Alpha", boardUrl: "https://github.com/users/Example/projects/1", statuses, capturedAt: "2026-09-30T09:59:30Z", freshness: "fresh" },
      { key: "beta", name: "Beta", color: "violet", repository: "Example/Beta", boardUrl: "https://github.com/users/Example/projects/2", statuses, capturedAt: "2026-09-30T09:54:00Z", freshness: "stale" },
    ], items: [] };
  function item(index: number, fields: Partial<ProjectItem>): ProjectItem {
    return { id: `item-${index}`, project: "alpha", number: index, title: "Синтетическая задача", kind: "Issue", status: "Backlog",
      observedAt: snapshot.generatedAt, runUpdatedAt: null, runId: null, runState: null, stage: null, detail: null, owner: null,
      ci: { state: "none", tone: "neutral", head: null }, review: { state: "none", tone: "neutral", head: null, critical: 0, important: 0, suggestions: 0 },
      preview: { state: "none", tone: "neutral", head: null, expiresAt: null, reviewed: false }, attention: [],
      links: { issue: `https://github.com/Example/Alpha/issues/${index}`, pr: null, discord: null, review: null, preview: null }, ...fields };
  }
  snapshot.items = [
    item(12, { title: "Refresh search and cover the empty state", status: "Human Review", runId: "r_review", runState: "parked_review", stage: "review_ready", runUpdatedAt: snapshot.generatedAt,
      aiReview: { enabled: true, reason: "eligible", head: "abcdef0123456789" },
      statusChange: { enabled: true, reason: "eligible", choices: Object.entries(statuses).map(([role,value]) => ({value,label:value,hint:role === "done" ? "Kurami проверит условия завершения, включая обязательное превью." : ""})) },
      runActions: {fingerprint:"a".repeat(64),reason:"eligible",actions:[
        {action:"take_control",label:"Взять управление",enabled:true,confirmation:null,hint:null,state:null},
        {action:"preview_start",label:"Запустить превью",enabled:true,confirmation:null,hint:null,state:null},
        {action:"stop",label:"Отменить запуск",enabled:true,confirmation:null,hint:null,state:null},
      ]},
      detail: "Changes are ready. Check the PR and current commit before another review.",
      ci: { state: "passed", tone: "success", head: "abcdef0123456789", checks:syntheticCiChecks(), observedAt:snapshot.generatedAt },
      review: { state: "outdated", tone: "warning", head: "1234567890abcdef", critical: 0, important: 1, suggestions: 2 },
      links: { issue: "https://github.com/Example/Alpha/issues/12", pr: "https://github.com/Example/Alpha/pull/20", discord: "https://discord.com/channels/100/200", review: null, preview: null } }),
    item(13, { title: "Fix failing integration checks", status: "In progress", runId: "r_work", runState: "running", stage: "ci_repair_working", owner: "cli", runUpdatedAt: snapshot.generatedAt,
      ci: { state: "failed", tone: "failure", head: "abcdef0123456789",checks:syntheticCiChecks().map((check,index)=>({...check,state:index===1||index===5?"failed":"passed"})),observedAt:snapshot.generatedAt } }),
    item(24, { project: "beta", title: "Clarify form behaviour before continuing", status: "In progress", runId: "r_attention", runState: "waiting_human", stage: "waiting_human",
      attention: [{ code: "owner_input", severity: "warning" }] }),
    item(25, { project: "beta", title: "Handle longer descriptions on mobile", status: "Backlog" }),
    item(15, {title:"Add keyboard navigation",suggestedNext:{since:snapshot.generatedAt,rankedAt:snapshot.generatedAt,explanation:"Owner priority P1 · Ready to start"}}),
    item(14, { title: "Completed task", status: "Done", runState: "archived", stage: "completed" }),
  ];
  return snapshot;
}

export function syntheticStoppedWriterSnapshot(report: string | null = null): ProjectsSnapshot {
  const snapshot=syntheticProjectsSnapshot(),item=snapshot.items[0]!;
  item.title="Automate Nomination deadlines with durable reconciliation";
  item.status="In progress";item.owner="none";item.stage="waiting_human";
  item.detail="No PR is available for review. Local work is preserved.";
  item.ci={state:"pending",tone:"neutral",head:null,checks:[]};
  item.review={state:"none",tone:"neutral",head:null,critical:0,important:0,suggestions:0};
  item.reviews=undefined;item.reviewFix=undefined;
  item.aiReview={enabled:false,reason:"no_head",head:null};
  item.writerStop={report,threadId:"00000001-0000-4000-8000-000000000001"};
  item.links={...item.links,pr:null,review:null};
  item.runActions!.actions=item.runActions!.actions.filter(action=>action.action!=="preview_start");
  return snapshot;
}
