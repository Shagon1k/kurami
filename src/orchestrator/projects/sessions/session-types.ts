import type { ActionableReviewThread, SummaryOnlyReviewFinding } from "../../integrations/github/review-threads.ts";

export type Action =
  | "start"
  | "repair"
  | "cleanup-repair"
  | "review-fix"
  | "cleanup-review-fix"
  | "recover-managed-task"
  | "sync"
  | "inspect"
  | "cancel"
  | "park"
  | "handoff"
  | "finalize-stop";

export type Arguments = {
  action: Action;
  runId: string;
  requestId?: string;
  apply: boolean;
};

export type OrchestratorConfig = {
  version: number;
  mode: "dry_run" | "live";
  limits: {
    max_tmux_sessions_global: number;
  };
};

export type ProjectConfig = {
  owner: string;
  repository: string;
  statuses: {
    review: string;
  };
  workspace: {
    canonical_repository: string;
    worktree_root: string;
    branch_prefix: string;
    base_branch: string;
  };
};

export type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

export type SessionRun = {
  run_id: string;
  project: string;
  repository: string;
  issue_number: number;
  issue_title: string | null;
  issue_url: string | null;
  interaction_policy: "autonomous" | "human_control";
  run_state: string;
  stop_reason: "cancelled" | "completed" | null;
  owner_state: string;
  execution_mode: "dry_run" | "live";
  resource_state: string;
  worktree_path: string | null;
  branch_name: string | null;
  base_sha: string | null;
  tmux_session_name: string | null;
  codex_thread_id: string | null;
  previous_codex_thread_id: string | null;
  project_item_status: string | null;
  autonomous_successor_active: number;
};

export type StartPlan = {
  runId: string;
  project: string;
  repository: string;
  issueNumber: number;
  worktreePath: string;
  canonicalRepository: string;
  branchName: string;
  tmuxSessionName: string;
  launcherPath: string;
  codexBin: string;
  codexTitle: string;
  initialPrompt: string;
  repair: RepairContext | null;
  reviewFix: ReviewFixContext | null;
};

export type CiCheck = {
  name: string;
  state: "pending" | "passed" | "failed" | "missing" | "unknown";
  detailsUrl: string | null;
};

export type RepairContext = {
  requestId: string;
  attemptId: string;
  attemptNumber: number;
  sourceHeadSha: string;
  sourceCiState: "failed" | "missing";
  sourceChecks: CiCheck[];
  pullRequestNumber: number;
  pullRequestUrl: string;
};

export type ReviewFixContext = {
  requestId: string;
  roundId: string;
  roundNumber: number;
  sourceHeadSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  threads: ActionableReviewThread[];
  summaryOnlyFindings: SummaryOnlyReviewFinding[];
};

export type ReviewFixDeliveryRound = {
  round_id: string;
  round_number: number;
  round_state: string;
  source_head_sha: string;
  codex_thread_id: string;
  failure_reason: string | null;
};

export type ReviewFixOperation = {
  operation_state: "claimed" | "side_effect_succeeded" | "completed";
  request_id: string | null;
  task_codex_thread_id: string;
  previous_codex_thread_id: string;
  tmux_session_name: string | null;
  result_head_sha: string | null;
};
