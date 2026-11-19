import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, isAbsolute } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadOwnerGitHubTokenFromFile } from "../../integrations/github/app-auth.ts";
import { ownerSourceEffects, type SourceEffects, type SourceProject } from "../worktrees/refresh-source.ts";
import { externalCiRepairCandidate, recoverExternalCiRepair } from "../../runtime/reconcile-ci-repair.ts";

type Candidate = NonNullable<ReturnType<typeof externalCiRepairCandidate>>;
function requireEvidence(ok: unknown): asserts ok {
  if (!ok) throw new Error("External CI recovery source refused");
}

/** Read-only: never fetch, reset, fast-forward, launch a worker or accept preview evidence. */
function validateLocal(project: SourceProject, candidate: Candidate, effects: SourceEffects): void {
  const worktree = String(candidate.worktree_path), branch = String(candidate.branch_name);
  const git = (directory: string, ...args: string[]) => execFileSync("git",
    ["-C", directory, "-c", "core.hooksPath=/dev/null", ...args],
    { encoding: "utf8", timeout: 20_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["ignore", "pipe", "ignore"] }).trim();
  const child = relative(realpathSync(project.workspace.worktree_root), worktree);
  requireEvidence(child && !child.startsWith("..") && !isAbsolute(child) && realpathSync(worktree) === worktree);
  const common = git(project.workspace.canonical_repository, "rev-parse", "--path-format=absolute", "--git-dir");
  requireEvidence(git(worktree, "rev-parse", "--show-toplevel") === worktree &&
    git(worktree, "rev-parse", "--path-format=absolute", "--git-common-dir") === common &&
    git(worktree, "rev-parse", "--path-format=absolute", "--git-dir").startsWith(common + "/worktrees/") &&
    git(worktree, "remote", "get-url", "origin").replace(/\.git$/u, "") === `https://github.com/${project.repository}` &&
    git(worktree, "branch", "--show-current") === branch &&
    git(worktree, "rev-parse", "HEAD") === candidate.head_sha &&
    git(worktree, "rev-parse", `refs/remotes/origin/${branch}`) === candidate.head_sha &&
    git(worktree, "status", "--porcelain", "--untracked-files=all") === "");
  effects.noWriter(worktree);
}

/** Lifecycle preflight outside a write transaction, followed by exact DB revalidation.
 * Independent owner tools must remain quiescent, as with managed-source admission. */
export async function reconcileExternalCiRepairs(database: DatabaseSync,
  projects: Record<string, { repository?: string; workspace?: SourceProject["workspace"] }>,
  home: string, createEffects: () => Promise<SourceEffects> = async () =>
    ownerSourceEffects(await loadOwnerGitHubTokenFromFile(home))): Promise<string[]> {
  const recovered: string[] = [];
  const rows = database.prepare("SELECT run_id FROM runs WHERE state='needs_attention' AND owner_state='none'").all();
  let effects: SourceEffects | undefined;
  for (const row of rows) {
    const candidate = externalCiRepairCandidate(database, String(row.run_id));
    if (!candidate) continue;
    const configured = projects[String(candidate.project)];
    if (!configured?.workspace || configured.repository !== candidate.repository) continue;
    const project = configured as SourceProject;
    try {
      effects ??= await createEffects();
      validateLocal(project, candidate, effects);
      const pull = effects.pull(project.repository, Number(candidate.pull_request_number));
      requireEvidence(pull.number === candidate.pull_request_number && pull.html_url === candidate.pull_request_url &&
        pull.state === "open" && pull.merged === false && pull.head?.sha === candidate.head_sha &&
        pull.head.ref === candidate.branch_name && pull.head.repo?.full_name === project.repository &&
        pull.base?.ref === project.workspace.base_branch && pull.base.repo?.full_name === project.repository);
      requireEvidence(effects.remoteHead(project.repository, String(candidate.branch_name)) === candidate.head_sha);
      // Network calls may have taken time or raced an owner edit. Never trust the snapshot alone.
      validateLocal(project, candidate, effects);
    } catch {
      // An unavailable/unsafe preflight is not a new failure of the archived worker.
      // Leave the existing attention cause and attempt untouched for the next poll.
      continue;
    }
    if (recoverExternalCiRepair(database, candidate)) recovered.push(String(candidate.run_id));
  }
  return recovered;
}
